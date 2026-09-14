// ============================================================
//  林间一盏灯 · 模型中转 + 链接读取 Edge Function（Supabase / Deno）
//  作用：
//    1) 把模型 API Key 藏到服务端，前端不再暴露；
//       以 SSE 流式把回复原样转发给网页，实现打字机效果。
//    2) action="readUrl" 时，服务端抓取一个网页，返回标题/摘要/正文摘录
//       （前端拿不到跨域网页，只能走服务端）。
//
//  部署后，在 index.html 里把 EDGE_FN_URL 填成：
//    https://<你的项目ref>.supabase.co/functions/v1/chat
//
//  需要在 Supabase 后台配置的 Secrets：
//    MODEL_API_KEY   （必填）你的模型 Key
//    MODEL_API_URL   （可选，默认 https://shufulei.net/v1/chat/completions）
//    MODEL_NAME      （可选，默认 [企业cli-0.01]gemini-3.5-flash）
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function jsonOk(obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function jsonError(message: string) {
  return jsonOk({ error: { message } });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } });
}

// 从 HTML 里抽 标题 / 摘要 / 正文纯文本
function extractHtml(html: string) {
  const meta = (prop: string) => {
    const a = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i"));
    if (a) return decodeEntities(a[1].trim());
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${prop}["']`, "i"));
    if (b) return decodeEntities(b[1].trim());
    return "";
  };
  const nameMeta = (n: string) => {
    const a = html.match(new RegExp(`<meta[^>]+name=["']${n}["'][^>]*content=["']([^"']*)["']`, "i"));
    if (a) return decodeEntities(a[1].trim());
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${n}["']`, "i"));
    if (b) return decodeEntities(b[1].trim());
    return "";
  };
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta("og:title") || (tm ? decodeEntities(tm[1].trim()) : "");
  const description = meta("og:description") || nameMeta("description");
  const image = meta("og:image");

  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text).replace(/\s+/g, " ").trim();

  return { title, description, image, text };
}

async function readUrl(rawUrl: string) {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "链接格式不对" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "只支持 http/https 链接" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(u.toString(), {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    const ctype = (resp.headers.get("content-type") || "").toLowerCase();
    const finalUrl = resp.url || u.toString();

    if (!ctype.includes("html") && !ctype.includes("text")) {
      return { ok: false, reason: `这个链接不是网页（${ctype || "未知类型"}）`, finalUrl };
    }
    const html = await resp.text();
    const { title, description, image, text } = extractHtml(html);

    // 反爬/需要登录的判定：正文过短且没有摘要
    const genericTitle = /小红书|验证|安全验证|captcha|登录/i.test(title) && !description;
    const blocked = (!description && text.length < 300) || genericTitle;

    // 众所周知"脚本渲染 + 反爬"的站点：抓到的大概率只是导航/页脚，不是正文
    const suspectSpa = /(^|\.)(xiaohongshu|xhslink|weibo|douyin|toutiao|zhihu|jianshu|xiaohongshu)\./i.test(u.hostname)
      || /xiaohongshu|xhslink/i.test(u.hostname);

    return {
      ok: true,
      finalUrl,
      status: resp.status,
      title: title.slice(0, 200),
      description: description.slice(0, 500),
      image: image.slice(0, 500),
      text: text.slice(0, 6000),
      blocked,
      suspectSpa,
    };
  } catch (e) {
    return { ok: false, reason: `抓取失败：${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();

    // ---------- 分支一：读取网页 ----------
    if (body.action === "readUrl") {
      if (!body.url) return jsonError("缺少 url 参数");
      const r = await readUrl(String(body.url));
      return jsonOk(r);
    }

    // ---------- 分支二：正常模型转发 ----------
    const messages = body.messages;
    const model = body.model || Deno.env.get("MODEL_NAME") || "[企业cli-0.01]gemini-3.5-flash";
    const apiUrl = Deno.env.get("MODEL_API_URL") || "https://shufulei.net/v1/chat/completions";
    const apiKey = Deno.env.get("MODEL_API_KEY");

    if (!apiKey) return jsonError("服务端未配置 MODEL_API_KEY");
    if (!messages || !Array.isArray(messages)) return jsonError("messages 参数不正确");

    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!upstream.ok || !upstream.body) {
      let text = "";
      try { text = await upstream.text(); } catch (_) {}
      return jsonError(`上游出错 (${upstream.status}): ${text}`);
    }

    return new Response(upstream.body, {
      headers: {
        ...CORS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e) {
    return jsonError(String(e));
  }
});
