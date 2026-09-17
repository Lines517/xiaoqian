const fs = require('fs');

// 直接从 index.html 里把内部 JS 抠出来，测的是页面上真正跑的那份代码
const html = fs.readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
const js = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [])
    .map(b => b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''))
    .join('\n');

function grab(name) {
    const i = js.indexOf('function ' + name);
    if (i < 0) throw new Error('not found: ' + name);
    let depth = 0, started = false, j = i;
    for (; j < js.length; j++) {
        const c = js[j];
        if (c === '{') { depth++; started = true; }
        else if (c === '}') { depth--; if (started && depth === 0) { j++; break; } }
    }
    return js.slice(i, j);
}

const names = ['stripThinkAndFences', 'cutLeadingEnglish', 'parseJsonArray', 'cutEnglishPreamble', 'cleanAssistantReply'];
eval(names.map(grab).join('\n'));

const cases = [
    ['单行英文思考+中文',
        'I need to respond warmly. Let me think about her day first. She said she is tired. 线条，我在。',
        '线条，我在。'],
    ['闭合 think 块',
        '<think>Let me analyze the situation carefully.</think>线条，我在。',
        '线条，我在。'],
    ['流式未闭合 think（应全空）',
        '<think>Let me analyze the situation carefully and',
        ''],
    ['多行英文草稿',
        'Thinking:\n- she is tired\n- be gentle\n线条，累不累？',
        '线条，累不累？'],
    ['短英文开头（不该砍）',
        'Hi，线条，我在。',
        'Hi，线条，我在。'],
    ['开头的图片标记（必须保留）',
        '[SHOW_IMAGE: moon, forest]\n今晚的月亮很好看。',
        '[SHOW_IMAGE: moon, forest]\n今晚的月亮很好看。'],
    ['thinking 标签',
        '<thinking>blah blah</thinking>\n\n线条，今天过得怎么样？',
        '线条，今天过得怎么样？'],
    ['正常多段中文（不该改）',
        '线条，我在。\n\n今天听你说了那件事，我一直想着。',
        '线条，我在。\n\n今天听你说了那件事，我一直想着。'],
    ['中文里夹英文歌名（不该砍！）',
        '《The Moon Song》这首歌我很喜欢，你放的时候我一直在听。',
        '《The Moon Song》这首歌我很喜欢，你放的时候我一直在听。'],
    ['正文以【一起听】开头（不该砍）',
        '【一起听】你今天放的《南方》我很喜欢。',
        '【一起听】你今天放的《南方》我很喜欢。'],
    ['英文小标题 Final Answer',
        'Final Answer: 线条，我在。',
        '线条，我在。'],
    ['英文思考然后换行中文（多段）',
        'Let me think about how to reply to her here.\n\n线条，今天累不累？',
        '线条，今天累不累？'],
];

let pass = 0;
const out = [];
for (const [title, input, expect] of cases) {
    const got = cleanAssistantReply(input);
    const ok = got === expect;
    if (ok) pass++;
    out.push((ok ? '✅ ' : '❌ ') + title);
    if (!ok) {
        out.push('   期望: ' + JSON.stringify(expect));
        out.push('   实际: ' + JSON.stringify(got));
    }
}
out.push('');
out.push('通过 ' + pass + '/' + cases.length);
fs.writeFileSync('C:/Users/86188/AppData/Local/Temp/opencode/clean_test.txt', '\ufeff' + out.join('\n'), 'utf8');
console.log('通过 ' + pass + '/' + cases.length);
