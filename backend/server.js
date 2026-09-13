const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

// 引入我们的 Windows 专属纯 JS 加密本地数据库控制器
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. 让后端直接托管最前端的 index.html，形成完美独立的全栈服务
app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 2. 后端健康状态检查
app.get('/health', (req, res) => {
    res.status(200).json({ status: "alive", message: "小千的本地全栈管家已经成功在你的电脑上温暖上班啦！" });
});

// ================= 【3. 数据库数据本地拉取和同步接口】 =================

// 全量拉取本地已有的聊天记录
app.get('/api/chats', (req, res) => {
    res.json({ data: db.getChats() });
});

// 单条保存用户和AI的消息到本地
app.post('/api/chats', (req, res) => {
    const { session_id, role, content } = req.body;
    const chat = db.insertChat({ session_id, role, content });
    res.json({ success: true, data: chat });
});

// 静默清洗云端/本地重复数据
app.post('/api/chats/cleanup', (req, res) => {
    const { id } = req.body;
    db.deleteChatById(id);
    res.json({ success: true });
});

// 全量拉取本地待办碎碎念
app.get('/api/todos', (req, res) => {
    res.json({ data: db.getTodos() });
});

// 新增待办
app.post('/api/todos', (req, res) => {
    const { content, is_completed } = req.body;
    const todo = db.insertTodo({ content, is_completed });
    res.json({ success: true, data: todo });
});

// 更新待办
app.put('/api/todos', (req, res) => {
    const { id, is_completed } = req.body;
    db.updateTodo(id, is_completed);
    res.json({ success: true });
});

// 删除待办
app.delete('/api/todos/:id', (req, res) => {
    db.deleteTodo(req.params.id);
    res.json({ success: true });
});

// 全量拉取听书手札
app.get('/api/books', (req, res) => {
    res.json({ data: db.getBooks() });
});

// 新增图书记录
app.post('/api/books', (req, res) => {
    const { book_name, author } = req.body;
    const book = db.insertBook({ book_name, author });
    res.json({ success: true, data: book });
});

// 拉取记忆库
app.get('/api/memories', (req, res) => {
    res.json({ data: db.getMemories() });
});

// 归档记忆库
app.post('/api/memories', (req, res) => {
    const { memory_date, folder, memory, emotion, state } = req.body;
    const mem = db.insertMemory({ memory_date, folder, memory, emotion, state });
    res.json({ success: true, data: mem });
});


// ================= 【4. 核心大模型聊天接口，支持打字机流式输出】 =================
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
    console.log(`📡 全栈自托管服务已经成功在 http://localhost:${PORT} 开启运行啦`);
});
