const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. 让后端直接托管 index.html（这样你访问网址，直接就能打开页面了！）
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: "alive", message: "小千的后端管家正在温暖运行中..." });
});

app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "消息格式不正确" });
    }

    const API_KEY = process.env.API_KEY || "fHHaJSoscSQPLyygDFWvE9SvoM7CN3Z3i1BpbTiMwNTtbjx0";
    const API_URL = process.env.API_URL || "https://shufulei.net/v1/chat/completions";
    const API_MODEL = process.env.API_MODEL || "[企业cli-0.01]gemini-3.5-flash";

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: API_MODEL,
                messages: messages,
                stream: true
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            res.write(`data: ${JSON.stringify({ error: `模型接口出错: ${errText}` })}\n\n`);
            return res.end();
        }

        response.body.on('data', chunk => {
            res.write(chunk.toString());
        });

        response.body.on('end', () => { res.end(); });
        response.body.on('error', () => { res.end(); });

    } catch (e) {
        res.write(`data: ${JSON.stringify({ error: `后端调用失败: ${e.message}` })}\n\n`);
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`📡 全栈服务已在 http://localhost:${PORT} 成功运行`);
});
