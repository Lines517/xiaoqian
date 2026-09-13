const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 配置跨域许可，上线后可以限制只能你的前端网页访问它
app.use(cors());
app.use(express.json());

// 1. 后端上班状态健康检查接口
app.get('/health', (req, res) => {
    res.status(200).json({ status: "alive", message: "小千的后端管家正在温暖运行中..." });
});

// 2. 核心聊天接口（支持 SSE 打字机逐字吐出流式对话）
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "消息格式不正确" });
    }

    const API_KEY = process.env.API_KEY;
    const API_URL = process.env.API_URL || "https://shufulei.net/v1/chat/completions";
    const API_MODEL = process.env.API_MODEL || "[企业cli-0.01]gemini-3.5-flash";

    if (!API_KEY) {
        return res.status(500).json({ error: "服务器未配置 API_KEY，请检查环境变量设置" });
    }

    // 设置服务器发送事件 (SSE) 相关的响应头，开启打字机效果传输
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
                stream: true // 开启流式打字机通道！
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            res.write(`data: ${JSON.stringify({ error: `模型接口出错: ${errText}` })}\n\n`);
            return res.end();
        }

        // 处理流式文本传输
        response.body.on('data', chunk => {
            const chunkStr = chunk.toString();
            // 直接透传大模型返回的SSE块给前端
            res.write(chunkStr);
        });

        response.body.on('end', () => {
            res.end();
        });

        response.body.on('error', (err) => {
            console.error("数据流传输中发生错误:", err);
            res.end();
        });

    } catch (e) {
        console.error("调用大模型出错:", e);
        res.write(`data: ${JSON.stringify({ error: `后端调用失败: ${e.message}` })}\n\n`);
        res.end();
    }
});

// 如果是在 Vercel 的 Serverless 环境下运行，直接导出 Express app，不执行 .listen
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(PORT, () => {
        console.log(`📡 后端服务已在 http://localhost:${PORT} 成功运行`);
    });
}

