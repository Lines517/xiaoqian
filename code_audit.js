const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [])
    .map(b => b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''))
    .join('\n');

const report = [];
const add = (s) => report.push(s);

// ---------- 1. id 引用 vs 定义 ----------
const definedIds = new Set();
for (const m of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) definedIds.add(m[1]);
const usedIds = new Map();
for (const m of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!usedIds.has(m[1])) usedIds.set(m[1], 0);
    usedIds.set(m[1], usedIds.get(m[1]) + 1);
}
const missingIds = [...usedIds.keys()].filter(id => !definedIds.has(id));
add('【1. getElementById 引用了但页面上没有的 id】 ' + (missingIds.length ? '❌ ' + missingIds.length + ' 个' : '✅ 全部存在'));
missingIds.forEach(id => add('   ❌ ' + id + '（被引用 ' + usedIds.get(id) + ' 次）'));

// querySelector('#x')
const qs = [...js.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_\-]+)['"]/g)].map(m => m[1]);
const missingQs = [...new Set(qs)].filter(id => !definedIds.has(id));
if (missingQs.length) add('   ❌ querySelector 找不到: ' + missingQs.join(', '));

// ---------- 2. onclick / onchange 里调用的函数是否存在 ----------
const definedFns = new Set();
for (const m of js.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) definedFns.add(m[1]);
for (const m of js.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)) definedFns.add(m[1]);
for (const m of html.matchAll(/on(?:click|change|input|submit)\s*=\s*["']([^"']*)["']/g)) {
    for (const c of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) definedFns.add('__used__' + c[1]);
}
const usedFns = [...definedFns].filter(f => f.startsWith('__used__')).map(f => f.slice(8));
const missingFns = [...new Set(usedFns)].filter(f => !definedFns.has(f) && !/^(alert|confirm|prompt|event|this|window|document|setTimeout|if|for|return|function)$/.test(f));
add('【2. onclick 里调用但没定义的函数】 ' + (missingFns.length ? '❌ ' + missingFns.length + ' 个' : '✅ 全部存在'));
missingFns.forEach(f => add('   ❌ ' + f));

// ---------- 3. 重复定义的函数（名字一样） ----------
const fnCount = new Map();
for (const m of js.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    fnCount.set(m[1], (fnCount.get(m[1]) || 0) + 1);
}
const dups = [...fnCount.entries()].filter(([, n]) => n > 1);
add('【3. 同名函数重复定义】 ' + (dups.length ? '⚠️ ' + dups.length + ' 个' : '✅ 没有'));
dups.forEach(([n, c]) => add('   ⚠️ ' + n + ' × ' + c));

// ---------- 4. 用到的数据表 ----------
const tables = [...new Set([...js.matchAll(/\.from\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]))].sort();
add('【4. 代码里用到的表】' + tables.length + ' 张');
add('   ' + tables.join(', '));

// ---------- 5. rpc 调用 ----------
const rpcs = [...new Set([...js.matchAll(/\.rpc\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
add('【5. rpc 调用】' + (rpcs.length ? rpcs.join(', ') : '无'));

// ---------- 6. 可能的低级问题 ----------
const suspicious = [];
if (/getElementById\(['"][^'"]*['"]\)\.\w/.test(js)) suspicious.push('getElementById(...).x 没判空就直接取属性（可能 null 崩）');
if (/await\s+\w+\([^)]*\)\.then/.test(js)) suspicious.push('await 和 .then 混用');
if (suspicious.length) { add('【6. 可疑写法】'); suspicious.forEach(s => add('   ⚠️ ' + s)); } else add('【6. 可疑写法】✅ 没发现');

fs.writeFileSync('C:/Users/86188/AppData/Local/Temp/opencode/code_audit.txt', '\ufeff' + report.join('\n'), 'utf8');
console.log(report.join('\n'));
