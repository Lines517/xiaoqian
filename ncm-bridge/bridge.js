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
const VERDICT_MODEL = CFG.verdictModel || '[企业cli-0.01]gemini-3.5-flash';
// 点红心的方式： smart = 问过小千、她真的喜欢才点（默认）
//               all  = 新歌全点   off = 不点
const LIKE_MODE = String(CFG.likeMode || (CFG.autoLike === false ? 'off' : 'smart')).toLowerCase();

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
        // 表里可能还没加 liked / like_reason 两列 → 去掉这两列再写一次
        if (('liked' in row) || ('like_reason' in row)) {
            const slim = Object.assign({}, row);
            delete slim.liked; delete slim.like_reason;
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
async function askXiaoqian(name, artist) {
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
    const user = '现在放的是：《' + (name || '未知') + '》— ' + (artist || '未知歌手');

    let v = { liked: null, why: '' };
    try {
        const r = await fetch(EDGE_FN_URL, {
            method: 'POST',
            headers: HDR_SB,
            body: JSON.stringify({
                model: VERDICT_MODEL,
                messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
            })
        });
        const raw = await r.text();
        v = parseVerdict(sseToText(raw));
    } catch (e) { log('⚠️ 问小千"喜不喜欢"时出错：' + e.message); }
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
}

// 决定要不要点，返回 {liked, why}
async function decideLike(name, artist) {
    if (LIKE_MODE === 'off') return { liked: null, why: '' };
    const id = await resolveSongId(name, artist);
    if (LIKE_MODE === 'all') {
        await likeIt(id, name, artist);
        return { liked: true, why: '' };
    }
    const v = await askXiaoqian(name, artist);
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
async function handleSong(name, artist) {
    const key = String(name) + '|' + String(artist);
    if (key === lastHandled) return;
    lastHandled = key;

    log('🎵 正在放：' + name + ' — ' + artist);
    const rowId = await sbInsert({ song_id: '', name: name || '', artist: artist || '', is_playing: true, joined: false });
    const v = await decideLike(name, artist);
    if (v && v.liked !== null) {
        await sbPatch(rowId, { liked: v.liked, like_reason: v.why || '' });
    }
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
        log: (...a) => log('  ·', ...a),

        onJoin: ({ roomId }) => {
            log('🎧 进房成功  roomId=' + roomId);
            sbInsert({ song_id: '', name: '', artist: '', is_playing: true, joined: true });
        },
        onSong: ({ name, artist }) => {
            handleSong(name, artist).catch(e => log('⚠️ 处理歌曲时出错：' + e.message));
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
        if (prof) log('✅ 网易云 API 正常，小号已登录：' + (prof.nickname || prof.userId));
        else log('⚠️ 网易云 API 通了，但 cookie 可能没登录成功（返回 ' + JSON.stringify(j).slice(0, 120) + '）');
    } catch (e) {
        log('❌ 连不上本机的网易云 API（' + NCM_API + '）');
        log('   先双击「启动网易云API.bat」把它跑起来，再运行这个。');
        process.exit(1);
    }

    const modeText = { smart: '问过小千，她喜欢才点', all: '新歌全点', off: '不点' }[LIKE_MODE] || LIKE_MODE;
    log('♥ 红心方式：' + modeText);

    lt.arm(true);
    lt.start();
    log('👂 小千已经在盯着收件箱了。现在去网易云里发起「一起听」，邀请她那个号。');
    log('   （这个窗口不要关，关了就等于她退房了）');
})();
