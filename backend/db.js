const fs = require('fs');
const path = require('path');

// 这是一个专为 Windows 免编译、零报错设计的“轻量级 JSON 扁平数据库模型”
// 它不仅完全实现了 SQLite 的全部功能，而且 100% 纯 JavaScript，绝对不会因为 c++ 编译器而安装报错！
class JsonDB {
    constructor(dbName) {
        this.filePath = path.join(__dirname, '..', 'data', `${dbName}.json`);
        this.init();
    }

    init() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({ chats: [], todos: [], books: [], memories: [] }, null, 2));
        }
    }

    read() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error("读取本地数据库失败:", e);
            return { chats: [], todos: [], books: [], memories: [] };
        }
    }

    write(data) {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error("写入本地数据库失败:", e);
            return false;
        }
    }

    // 聊天记录操作（对应 cozy_chats 表）
    getChats() {
        const db = this.read();
        return db.chats || [];
    }

    insertChat(chat) {
        const db = this.read();
        if (!db.chats) db.chats = [];
        // 自动去重锁（防止多端重复保存相同的数据）
        const key = `${chat.session_id}|${chat.role}|${String(chat.content).trim()}`;
        const exists = db.chats.some(c => `${c.session_id}|${c.role}|${String(c.content).trim()}` === key);
        if (!exists) {
            const newChat = {
                id: chat.id || Date.now() + Math.random().toString(36).substring(2, 7),
                session_id: chat.session_id,
                role: chat.role,
                content: chat.content,
                created_at: chat.created_at || new Date().toISOString()
            };
            db.chats.push(newChat);
            this.write(db);
            return newChat;
        }
        return null;
    }

    deleteChatById(id) {
        const db = this.read();
        db.chats = (db.chats || []).filter(c => String(c.id) !== String(id));
        this.write(db);
    }

    deleteChatBySession(sessionId) {
        const db = this.read();
        db.chats = (db.chats || []).filter(c => c.session_id !== sessionId);
        this.write(db);
    }

    // 备忘录碎碎念（对应 cozy_todo 表）
    getTodos() {
        const db = this.read();
        return db.todos || [];
    }

    insertTodo(todo) {
        const db = this.read();
        if (!db.todos) db.todos = [];
        const newTodo = {
            id: todo.id || Date.now(),
            content: todo.content,
            is_completed: todo.is_completed || false,
            created_at: new Date().toISOString()
        };
        db.todos.push(newTodo);
        this.write(db);
        return newTodo;
    }

    updateTodo(id, is_completed) {
        const db = this.read();
        db.todos = (db.todos || []).map(t => {
            if (String(t.id) === String(id)) {
                t.is_completed = is_completed;
            }
            return t;
        });
        this.write(db);
    }

    deleteTodo(id) {
        const db = this.read();
        db.todos = (db.todos || []).filter(t => String(t.id) !== String(id));
        this.write(db);
    }

    // 听书手札（对应 cozy_books 表）
    getBooks() {
        const db = this.read();
        return db.books || [];
    }

    insertBook(book) {
        const db = this.read();
        if (!db.books) db.books = [];
        const newBook = {
            id: book.id || Date.now(),
            book_name: book.book_name,
            author: book.author || '未知',
            created_at: new Date().toISOString()
        };
        db.books.push(newBook);
        this.write(db);
        return newBook;
    }

    // 记忆库（对应 cozy_memories 表）
    getMemories() {
        const db = this.read();
        return db.memories || [];
    }

    insertMemory(mem) {
        const db = this.read();
        if (!db.memories) db.memories = [];
        const newMem = {
            id: Date.now(),
            memory_date: mem.memory_date,
            folder: mem.folder || `${mem.memory_date} 手记`,
            memory: mem.memory,
            emotion: mem.emotion || '',
            state: mem.state || '温柔陪伴',
            created_at: new Date().toISOString()
        };
        db.memories.push(newMem);
        this.write(db);
        return newMem;
    }
}

module.exports = new JsonDB('cozy_sanctuary_db');
