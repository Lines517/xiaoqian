// ============================================================
//  林间一盏灯 · 模型中转 Edge Function（Supabase / Deno）
//  作用：把模型 API Key 藏到服务端，前端不再暴露；
//        并以 SSE 流式把回复原样转发给网页，实现打字机效果。
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

function jsonError(message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
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
