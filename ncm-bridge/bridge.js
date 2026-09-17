// ============================================================
//  小千 · 网易云「一起听」桥接
//  作用：让 AI 账号进你的「一起听」房间，然后
//        ① 把"正在放什么"写进你的小灯（Supabase 表 cozy_music）
//        ② 可选：给新歌自动点红心（写进小号"我喜欢的音乐"）
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
const NCM_API = (CFG.apiBase || 'http://127.0.0.1:3000').replace(/\/$/, '');
const HDR_NCM = { cookie: String(CFG.cookie || '') };

function ts() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
function log(...a) { console.log('[' + ts() + ']', ...a); }

// ---------- 写进小灯 ----------
async function sbWrite(row) {
    if (!SB_KEY) return;
    try {
        await fetch(SB_URL + '/rest/v1/cozy_music', {
            method: 'POST',
            headers: {
                'apikey': SB_KEY,
                'Authorization': 'Bearer ' + SB_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(row)
        });
    } catch (e) { log('⚠️ 写小灯失败:', e.message); }
}

// ---------- 找到歌 id（用来点红心）----------
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

// ---------- 给这首歌点红心 ----------
const likedIds = new Set();
async function autoLikeIfWanted(name, artist) {
    if (!CFG.autoLike) return;
    const id = await resolveSongId(name, artist);
    if (!id || likedIds.has(String(id))) return;
    likedIds.add(String(id));
    try {
        const r = await fetch(NCM_API + '/like?id=' + id + '&like=true&timestamp=' + Date.now(), { headers: HDR_NCM });
        const j = await r.json();
        if (j && j.code === 200) log('  ♥ 已给这首歌点红心：' + name + ' — ' + artist);
        else log('  ⚠️ 点红心失败：' + JSON.stringify(j).slice(0, 120));
    } catch (e) { log('  ⚠️ 点红心出错:', e.message); }
}

// ---------- 启动 ----------
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
            sbWrite({ song_id: '', name: '', artist: '', is_playing: true, joined: true });
        },
        onSong: ({ name, artist }) => {
            log('🎵 正在放：' + name + ' — ' + artist);
            sbWrite({ song_id: '', name: name || '', artist: artist || '', is_playing: true, joined: false });
            autoLikeIfWanted(name, artist);
        },
        onLeave: ({ code }) => {
            log('🚪 房间结束了（code=' + code + '）');
            sbWrite({ song_id: '', name: '', artist: '', is_playing: false, joined: false });
        }
    });
} catch (e) {
    console.error('\n❌ 加载 ncm-listen-together 失败：' + e.message);
    console.error('   先在 ncm-bridge 目录里跑一次： npm install\n');
    process.exit(1);
}

// ---------- 先自检：本机的网易云 API 通不通 / cookie 有没有效 ----------
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

    lt.arm(true);
    lt.start();
    log('👂 小千已经在盯着收件箱了。现在去网易云里发起「一起听」，邀请她那个号。');
    log('   （这个窗口不要关，关了就等于她退房了）');
})();
