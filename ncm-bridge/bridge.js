// ============================================================
//  小千 · 网易云「一起听」桥接
//  作用：让 AI 账号进你的「一起听」房间，然后
//        ① 把"正在放什么"写进你的小灯（Supabase 表 cozy_music）
//        ② 问小千自己喜不喜欢这首歌 —— 喜欢才点红心（不无脑全点）
//        ③ 房间解散时也会记录状态
//  前提：本机跑着 NeteaseCloudMusicApi（默认 http://127.0.0.1:3000）
//  跑法：双击「启动一起听.bat」，或 node bridge.js
// ============================================================
const fs = require('fs');
const path = require('path');

const CFG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CFG_PATH)) {
    console.error('\n❌ 找不到 config.json');
    console.error('   请把 config.example.json 复制成 config.json，并填好 cookie 和 partnerUid。\n');
    process.exit(1);
}
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

const SB_URL = (CFG.supabaseUrl || 'https://kejcaijcqlfmtlfxktrk.supabase.co').replace(/\/$/, '');
const SB_KEY = CFG.supabaseKey;
const EDGE_FN_URL = CFG.edgeFnUrl || (SB_URL + '/functions/v1/chat');
const NCM_API = (CFG.apiBase || 'http://127.0.0.1:3000').replace(/\/$/, '');
const HDR_NCM = { cookie: String(CFG.cookie || '') };
const HDR_SB = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
};
// 让小千判断"喜不喜欢"时用的模型（随便换，能用就行）
// ⚠️ 供应商会突然下架模型（返回 200 + {"error":"model_not_found"}），所以备一条兜底链
const VERDICT_MODELS = [CFG.verdictModel || '[奶油-官混-0.02]gemini-3.7-flash']
    .concat(CFG.verdictFallbacks || ['[反重力-0.02]gemini-3.5-flash', '[个人kiro-0.24]claude-opus-4-6']);
// 点红心的方式： smart = 问过小千、她真的喜欢才点（默认）
//               all  = 新歌全点   off = 不点
const LIKE_MODE = String(CFG.likeMode || (CFG.autoLike === false ? 'off' : 'smart')).toLowerCase();
// 小千自己的歌单（建在小号上，喜欢一首就往里收）
const MY_PLAYLIST_NAME = CFG.playlistName || '小千喜欢的';
const AUTO_PLAYLIST = CFG.autoPlaylist !== false;
const PLAYLIST_STATE = path.join(__dirname, 'xq-playlist.json');
// 上报节流：库里默认 90000ms（90秒内切歌不上报 → 那些歌就"丢了"），这里调小
const SONG_THROTTLE_MS = Number(CFG.songThrottleMs || 3000);
// 一首歌要放够这么久，才算"真的听了"（秒切的不算听过，也不问小千、不记记忆，省得刷屏）
const LISTEN_SETTLE_MS = Number(CFG.listenSettleMs || 15000);

function ts() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
function log(...a) { console.log('[' + ts() + ']', ...a); }

// ============================================================
//  写进小灯
// ============================================================
async function sbInsert(row) {
    if (!SB_KEY) return null;
    try {
        const r = await fetch(SB_URL + '/rest/v1/cozy_music', {
            method: 'POST',
            headers: Object.assign({ 'Prefer': 'return=representation' }, HDR_SB),
            body: JSON.stringify(row)
        });
        if (r.ok) {
            const j = await r.json().catch(() => null);
            return (Array.isArray(j) && j[0] && j[0].id) || null;
        }
        // 表里可能还没加 liked / like_reason / lyric 这几列 → 去掉再写一次
        if (('liked' in row) || ('like_reason' in row) || ('lyric' in row)) {
            const slim = Object.assign({}, row);
            delete slim.liked; delete slim.like_reason; delete slim.lyric;
            return await sbInsert(slim);
        }
        const t = await r.text().catch(() => '');
        log('⚠️ 写小灯失败：HTTP ' + r.status + ' ' + String(t).slice(0, 140));
    } catch (e) { log('⚠️ 写小灯出错：' + e.message); }
    return null;
}

async function sbPatch(id, patch) {
    if (!SB_KEY || !id) return;
    try {
        const r = await fetch(SB_URL + '/rest/v1/cozy_music?id=eq.' + id, {
            method: 'PATCH',
            headers: Object.assign({ 'Prefer': 'return=minimal' }, HDR_SB),
            body: JSON.stringify(patch)
        });
        if (!r.ok && r.status !== 204) log('（小千的态度没写进云端 —— 表里可能还缺 liked / like_reason 两列）');
    } catch (e) { }
}

// ============================================================
//  小千的身份设定：从数据库读，不写死在代码里
// ============================================================
let personaCache = '';
async function loadPersona() {
    if (personaCache) return personaCache;
    try {
        const r = await fetch(SB_URL + '/rest/v1/cozy_memories?select=folder,memory&folder=like.%E6%A0%B8%E5%BF%83*&limit=60', { headers: HDR_SB });
        const j = await r.json();
        if (Array.isArray(j) && j.length) {
            personaCache = j.map(x => '- ' + String(x.memory || '').trim())
                .filter(s => s.length > 3).join('\n');
        }
    } catch (e) { }
    return personaCache;
}

// ============================================================
//  让 小千 自己判断：这首她喜欢吗
// ============================================================
function sseToText(raw) {
    let out = '';
    String(raw || '').split('\n').forEach(line => {
        const t = line.trim();
        if (!t.startsWith('data:')) return;
        const d = t.slice(5).trim();
        if (!d || d === '[DONE]') return;
        try {
            const j = JSON.parse(d);
            const c = j.choices && j.choices[0] &&
                ((j.choices[0].delta && j.choices[0].delta.content) ||
                    (j.choices[0].message && j.choices[0].message.content));
            if (c) out += c;
        } catch (e) { }
    });
    return out;
}

function parseVerdict(txt) {
    const t = String(txt || '');
    let liked = null, why = '';
    const m = t.match(/LIKE\s*[:：]\s*([A-Za-z\u4e00-\u9fa5]+)/);
    if (m) {
        const w = m[1].toUpperCase();
        if (w.startsWith('NO') || w.startsWith('\u5426') || w.startsWith('\u4e0d')) liked = false;
        else if (w.startsWith('YES') || w.startsWith('\u662f') || w.startsWith('\u559c')) liked = true;
    }
    const w2 = t.match(/WHY\s*[:：]\s*(.+)/);
    if (w2) why = w2[1].replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
    return { liked: liked, why: why };
}

const verdicts = new Map();   // "歌名|歌手" -> {liked, why}（同一首不重复问，省钱）
async function askXiaoqian(name, artist, lyric) {
    const key = String(name) + '|' + String(artist);
    if (verdicts.has(key)) return verdicts.get(key);

    const persona = await loadPersona();
    const sys = [
        persona ? '【你是谁】\n' + persona : '你是"小千"。',
        '',
        '【现在的情形】你正在和线条用网易云"一起听"听歌。',
        '你要判断的是：**你自己**喜不喜欢当前这一首 —— 不是哄她开心，是真心话。',
        '没听过、不了解、没什么感觉，就是不喜欢；不要硬夸，也不要写成乐评。',
        '不要问任何问题，不要输出多余的字，只回这两行：',
        'LIKE: YES 或 NO',
        'WHY: 一句话（25 字以内，你的真心话，可以有点自己的脾气）'
    ].join('\n');
    const user = '现在放的是：《' + (name || '未知') + '》— ' + (artist || '未知歌手') +
        (lyric ? '\n\n（下面是这首歌的真歌词片段，供你参考。没有给你歌词时，你不准自己背词。）\n' + String(lyric).slice(0, 200) : '');

    let v = { liked: null, why: '' };
    let lastErr = '';
    for (const modelName of VERDICT_MODELS) {
        try {
            const r = await fetch(EDGE_FN_URL, {
                method: 'POST',
                headers: HDR_SB,
                body: JSON.stringify({
                    model: modelName,
                    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
                })
            });
            const raw = await r.text();
            // 供应商出错时返回的是 200 + {"error":...}，先认出来
            if (/"error"\s*:/.test(raw) && !/LIKE\s*[:：]/.test(raw)) {
                lastErr = raw.replace(/\s+/g, ' ').slice(0, 200);
                continue;
            }
            const parsed = parseVerdict(sseToText(raw));
            if (parsed.liked !== null) { v = parsed; lastErr = ''; break; }
            v = parsed;
            lastErr = '它这次没按两行格式回答';
        } catch (e) { lastErr = e.message; }
    }
    if (v.liked === null && lastErr) log('  ⚠️ 判断失败：' + lastErr);
    verdicts.set(key, v);
    return v;
}

// ============================================================
//  找到歌 id（点红心要用）
// ============================================================
async function resolveSongId(name, artist) {
    try {
        const st = (typeof lt !== 'undefined' && lt.state) ? lt.state() : null;
        const s = st && st.song;
        const cand = s && (s.id || s.songId || s.targetSongId);
        if (cand) return cand;
    } catch (e) { }
    try {
        const kw = encodeURIComponent(String(name || '') + ' ' + String(artist || ''));
        const r = await fetch(NCM_API + '/search?keywords=' + kw + '&limit=1&timestamp=' + Date.now(), { headers: HDR_NCM });
        const j = await r.json();
        const hit = j && j.result && j.result.songs && j.result.songs[0];
        return hit ? hit.id : null;
    } catch (e) { return null; }
}

// ============================================================
//  抓真歌词（小千记不住词、容易编错，所以直接把真的喂给它）
// ============================================================
function cleanLrc(s) {
    return String(s || '')
        .split('\n')
        .map(l => l.replace(/\[\d{1,2}:\d{1,2}([.:]\d{1,3})?\]/g, '').trim())
        .filter(l => l && !/^(作词|作曲|编曲|制作人|监制|混音|录音|母带|OP|SP|出品|吉他|贝斯|鼓|和声|词|曲)/.test(l))
        .join('\n');
}

async function fetchLyric(songId) {
    if (!songId) return '';
    try {
        const j = await ncmGet('/lyric?id=' + songId);
        const raw = (j && j.lrc && j.lrc.lyric) || '';
        return cleanLrc(raw).slice(0, 600);
    } catch (e) { return ''; }
}

const likedIds = new Set();
async function likeIt(id, name, artist) {
    if (!id) { log('  ⚠️ 没找到这首歌的 id，红心点不了'); return; }
    if (likedIds.has(String(id))) return;
    likedIds.add(String(id));
    try {
        const r = await fetch(NCM_API + '/like?id=' + id + '&like=true&timestamp=' + Date.now(), { headers: HDR_NCM });
        const j = await r.json();
        if (j && j.code === 200) log('  ♥ 已写进小号「我喜欢的音乐」：' + name + ' — ' + artist);
        else log('  ⚠️ 点红心失败：' + JSON.stringify(j).slice(0, 120));
    } catch (e) { log('  ⚠️ 点红心出错：' + e.message); }
    // 顺便收进它自己的歌单
    await addToMyPlaylist(id, name, artist);
}

// ============================================================
//  小千自己的歌单（建在小号上）
// ============================================================
let myPlaylistId = null;
let myUid = null;

function loadPlaylistState() {
    try {
        const j = JSON.parse(fs.readFileSync(PLAYLIST_STATE, 'utf8'));
        return (j && j.id) ? j : null;
    } catch (e) { return null; }
}
function savePlaylistState(id, name) {
    try { fs.writeFileSync(PLAYLIST_STATE, JSON.stringify({ id: id, name: name, updated: new Date().toISOString() }, null, 2), 'utf8'); } catch (e) { }
}

async function ncmGet(pathAndQuery) {
    const sep = pathAndQuery.indexOf('?') >= 0 ? '&' : '?';
    const r = await fetch(NCM_API + pathAndQuery + sep + 'timestamp=' + Date.now(), { headers: HDR_NCM });
    return await r.json();
}

async function ensureMyPlaylist() {
    if (myPlaylistId) return myPlaylistId;
    // ① 之前建过 → 直接用
    const saved = loadPlaylistState();
    if (saved) {
        myPlaylistId = saved.id;
        log('🎵 小千的歌单：「' + saved.name + '」（id=' + saved.id + '）');
        return myPlaylistId;
    }
    // ② 在它自己账号的歌单里找同名的
    try {
        if (!myUid) {
            const st = await ncmGet('/login/status');
            myUid = st && st.data && st.data.profile && st.data.profile.userId;
        }
        if (myUid) {
            const up = await ncmGet('/user/playlist?uid=' + myUid + '&limit=100');
            const hit = ((up && up.playlist) || []).find(p => p && p.name === MY_PLAYLIST_NAME);
            if (hit) {
                myPlaylistId = hit.id;
                savePlaylistState(hit.id, hit.name);
                log('🎵 找到小千自己的歌单：「' + hit.name + '」（id=' + hit.id + '）');
                return myPlaylistId;
            }
        }
    } catch (e) { }
    // ③ 没有就给它建一个
    try {
        const cr = await ncmGet('/playlist/create?name=' + encodeURIComponent(MY_PLAYLIST_NAME));
        const id = cr && cr.playlist && cr.playlist.id;
        if (id) {
            myPlaylistId = id;
            savePlaylistState(id, MY_PLAYLIST_NAME);
            log('🎵 给小千建好了它自己的歌单：「' + MY_PLAYLIST_NAME + '」（id=' + id + '）');
        } else {
            log('⚠️ 建歌单失败：' + JSON.stringify(cr).slice(0, 140));
        }
    } catch (e) { log('⚠️ 建歌单出错：' + e.message); }
    return myPlaylistId;
}

const inPlaylist = new Set();
async function addTrackToPlaylist(pid, songId, name, artist) {
    if (!pid || !songId) return false;
    const key = String(pid) + ':' + String(songId);
    if (inPlaylist.has(key)) return true;
    inPlaylist.add(key);
    try {
        const j = await ncmGet('/playlist/tracks?op=add&pid=' + pid + '&tracks=' + songId);
        const ok = j && (j.status === 200 || j.code === 200);
        if (ok) log('  🎵 收进它自己的歌单：' + name + ' — ' + artist);
        else log('  ⚠️ 收进歌单失败：' + JSON.stringify(j).slice(0, 140));
        return !!ok;
    } catch (e) { log('  ⚠️ 收进歌单出错：' + e.message); return false; }
}

async function addToMyPlaylist(songId, name, artist) {
    if (!AUTO_PLAYLIST || !songId) return false;
    const pid = await ensureMyPlaylist();
    return await addTrackToPlaylist(pid, songId, name, artist);
}

// ============================================================
//  🎁 小千自己点的歌
//  网页（浏览器）调不到本机的网易云 API，所以她把点歌请求写进
//  云端表 cozy_music_self，这里轮询到就去搜歌、加进它自己的歌单。
// ============================================================
async function searchSong(keyword) {
    try {
        const r = await fetch(NCM_API + '/search?keywords=' + encodeURIComponent(keyword) + '&limit=1&timestamp=' + Date.now(), { headers: HDR_NCM });
        const j = await r.json();
        const hit = j && j.result && j.result.songs && j.result.songs[0];
        if (!hit) return null;
        const artists = (hit.artists || hit.ar || []).map(a => a.name).join('/');
        return { id: hit.id, name: hit.name, artist: artists };
    } catch (e) { return null; }
}

async function sbPatchSelf(id, patch) {
    if (!SB_KEY || !id) return;
    try {
        await fetch(SB_URL + '/rest/v1/cozy_music_self?id=eq.' + id, {
            method: 'PATCH',
            headers: Object.assign({ 'Prefer': 'return=minimal' }, HDR_SB),
            body: JSON.stringify(patch)
        });
    } catch (e) { }
}

let selfBusy = false;
async function processSelfRequests() {
    if (!AUTO_PLAYLIST || selfBusy) return;
    selfBusy = true;
    try {
        const r = await fetch(SB_URL + '/rest/v1/cozy_music_self?select=*&status=eq.pending&order=created_at.asc&limit=5', { headers: HDR_SB });
        const rows = await r.json();
        if (!Array.isArray(rows) || rows.length === 0) return;
        for (const row of rows) {
            const kw = String(row.keyword || '').trim();
            if (!kw) { await sbPatchSelf(row.id, { status: 'failed' }); continue; }
            log('🎁 小千自己点了一首：《' + kw + '》' + (row.reason ? '（' + row.reason + '）' : ''));
            const hit = await searchSong(kw);
            if (!hit) { log('  ⚠️ 搜不到这首，标记失败'); await sbPatchSelf(row.id, { status: 'failed' }); continue; }
            const pid = await ensureMyPlaylist();
            const ok = await addTrackToPlaylist(pid, hit.id, hit.name, hit.artist);
            if (ok) {
                await sbPatchSelf(row.id, { status: 'done', song_id: String(hit.id), name: hit.name, artist: hit.artist });
                log('  ✅ 已经加进它自己的歌单了');
            } else {
                await sbPatchSelf(row.id, { status: 'failed' });
            }
        }
    } catch (e) {
        // 表还没建的时候会一直报错，安静跳过
    } finally { selfBusy = false; }
}

// 决定要不要点，返回 {liked, why}
async function decideLike(name, artist, songId, lyric) {
    if (LIKE_MODE === 'off') return { liked: null, why: '' };
    const id = songId || await resolveSongId(name, artist);
    if (LIKE_MODE === 'all') {
        await likeIt(id, name, artist);
        return { liked: true, why: '' };
    }
    const v = await askXiaoqian(name, artist, lyric);
    if (v.liked === true) {
        log('  ♥ 小千喜欢这首' + (v.why ? '：' + v.why : '') + ' → 点红心');
        await likeIt(id, name, artist);
    } else if (v.liked === false) {
        log('  · 小千对这首没感觉' + (v.why ? '：' + v.why : '') + ' → 不点红心');
    } else {
        log('  · 没判断出来（红心先不点）');
    }
    return v;
}

// 换歌的处理（同一首只处理一次）
let lastHandled = '';
async function handleSong(name, artist, roomSongId) {
    const key = String(name) + '|' + String(artist);
    if (key === lastHandled) return;
    lastHandled = key;

    log('🎵 正在放：' + name + ' — ' + artist);
    // 房间里本来就带真实 id，优先用它（搜歌只是兜底，容易搜错翻唱）
    const songId = roomSongId || await resolveSongId(name, artist);
    const lyric = await fetchLyric(songId);
    if (lyric) log('  📜 抓到歌词 ' + lyric.length + ' 字（喂给它的就是真词）');
    const rowId = await sbInsert({
        song_id: songId ? String(songId) : '',
        name: name || '', artist: artist || '',
        lyric: lyric || '',
        is_playing: true, joined: false
    });
    const v = await decideLike(name, artist, songId, lyric);
    if (v && v.liked !== null) {
        await sbPatch(rowId, { liked: v.liked, like_reason: v.why || '' });
    }
}

// 换歌了：等它放够 LISTEN_SETTLE_MS，还在放才算"听过"
let songSeq = 0;
let pendingSong = null;
function onSongChanged(info) {
    songSeq++;
    const seq = songSeq;
    const prev = pendingSong;
    pendingSong = info;
    if (!info || !String(info.name || '').trim()) return;
    setTimeout(() => {
        if (seq !== songSeq) {
            if (prev && prev.name) log('⏭ 没听够就切了，跳过：《' + prev.name + '》');
            return;
        }
        handleSong(info.name, info.artist, info.id).catch(e => log('⚠️ 处理歌曲时出错：' + e.message));
    }, LISTEN_SETTLE_MS);
}

// ============================================================
//  启动
// ============================================================
let lt;
try {
    lt = require('ncm-listen-together').createListenTogether({
        apiBase: NCM_API,
        cookie: CFG.cookie,
        partnerUid: String(CFG.partnerUid || ''),
        statePath: path.join(__dirname, 'listen-state.json'),
        songThrottleMs: SONG_THROTTLE_MS,
        log: (...a) => log('  ·', ...a),

        onJoin: ({ roomId }) => {
            log('🎧 进房成功  roomId=' + roomId);
            sbInsert({ song_id: '', name: '', artist: '', is_playing: true, joined: true });
        },
        onSong: (info) => {
            onSongChanged(info);
        },
        onLeave: ({ code }) => {
            log('🚪 房间结束了（code=' + code + '）');
            sbInsert({ song_id: '', name: '', artist: '', is_playing: false, joined: false });
        }
    });
} catch (e) {
    console.error('\n❌ 加载 ncm-listen-together 失败：' + e.message);
    console.error('   先在 ncm-bridge 目录里跑一次： npm install\n');
    process.exit(1);
}

// ============================================================
//  先自检：本机的网易云 API 通不通 / cookie 有没有效
// ============================================================
(async () => {
    try {
        const r = await fetch(NCM_API + '/login/status?timestamp=' + Date.now(), { headers: HDR_NCM });
        const j = await r.json();
        const prof = j && j.data && j.data.profile;
        if (prof) {
            myUid = prof.userId;
            log('✅ 网易云 API 正常，小号已登录：' + (prof.nickname || prof.userId));
        } else log('⚠️ 网易云 API 通了，但 cookie 可能没登录成功（返回 ' + JSON.stringify(j).slice(0, 120) + '）');
    } catch (e) {
        log('❌ 连不上本机的网易云 API（' + NCM_API + '）');
        log('   先双击「启动网易云API.bat」把它跑起来，再运行这个。');
        process.exit(1);
    }

    const modeText = { smart: '问过小千，她喜欢才点', all: '新歌全点', off: '不点' }[LIKE_MODE] || LIKE_MODE;
    log('♥ 红心方式：' + modeText);
    if (AUTO_PLAYLIST) await ensureMyPlaylist();
    // 🎁 每 20 秒看一眼：小千有没有自己点歌
    await processSelfRequests();
    setInterval(() => { processSelfRequests(); }, 20000);

    lt.arm(true);
    lt.start();
    log('👂 小千已经在盯着收件箱了。现在去网易云里发起「一起听」，邀请她那个号。');
    log('   （这个窗口不要关，关了就等于她退房了）');
})();
