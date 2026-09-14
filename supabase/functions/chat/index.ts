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

// hex 音频 <-> 字节
function hexToBytes(hex: string): Uint8Array {
  const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as number[]);
  }
  return btoa(bin);
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

    // ---------- 分支一·A：用文字描述「设计」一个专属音色（MiniMax） ----------
    if (body.action === "designVoice") {
      const mmKey = Deno.env.get("MINIMAX_API_KEY");
      const mmGroup = Deno.env.get("MINIMAX_GROUP_ID") || "";
      if (!mmKey) return jsonError("服务端未配置 MINIMAX_API_KEY");
      const prompt = String(body.prompt || "").trim().slice(0, 500);
      const previewText = String(body.preview_text || "我是小千。今天也辛苦了，早点休息，别熬太晚。").slice(0, 300);
      if (!prompt) return jsonError("prompt 为空");

      const url = `https://api.minimaxi.com/v1/voice_design${mmGroup ? "?GroupId=" + encodeURIComponent(mmGroup) : ""}`;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${mmKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, preview_text: previewText, aigc_watermark: false }),
        });
        const j = await r.json();
        const vid = j.voice_id || (j.data && j.data.voice_id) || "";
        const hex = j.trial_audio || (j.data && j.data.trial_audio) || "";
        let audio = "";
        if (hex) { try { audio = "data:audio/mp3;base64," + bytesToBase64(hexToBytes(hex)); } catch (_) {} }
        return jsonOk({ ok: !!vid, voice_id: vid, audio, base_resp: j.base_resp || null });
      } catch (e) {
        return jsonError(`音色设计失败：${String(e)}`);
      }
    }

    // ---------- 分支一·B：文字转语音 ----------
    if (body.action === "tts") {
      const text = String(body.text || "").trim().slice(0, 800);
      if (!text) return jsonError("text 为空");

      const mmKey = Deno.env.get("MINIMAX_API_KEY");
      const mmGroup = Deno.env.get("MINIMAX_GROUP_ID") || "";
      const mmVoiceEnv = Deno.env.get("MINIMAX_VOICE_ID") || "";
      const sfKey = Deno.env.get("SILICON_API_KEY");
      const elKey = Deno.env.get("ELEVEN_API_KEY");
      const elVoice = Deno.env.get("ELEVEN_VOICE_ID");

      const wantVoice = String(body.voice || "").trim();
      const speed = Number(body.speed) > 0 ? Number(body.speed) : 0.95;
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 40000);

      // 选择使用哪家：voice 前缀优先
      let useMM = false;
      let mmVoice = mmVoiceEnv;
      let useSF = false;
      let sfVoice = "FunAudioLLM/CosyVoice2-0.5B:charles";

      if (wantVoice.startsWith("minimax:")) { useMM = true; mmVoice = wantVoice.slice(8); }
      else if (wantVoice.startsWith("speech:") || /CosyVoice/i.test(wantVoice)) { useSF = true; sfVoice = wantVoice; }
      else if (mmKey && mmVoiceEnv) { useMM = true; }
      else if (sfKey) { useSF = true; }
      if (useMM && !mmKey) { useMM = false; useSF = !!sfKey; }

      try {
        // ① MiniMax（用文字设计出来的专属声音）
        if (useMM && mmKey) {
          const url = `https://api.minimaxi.com/v1/t2a_v2${mmGroup ? "?GroupId=" + encodeURIComponent(mmGroup) : ""}`;
          const r = await fetch(url, {
            method: "POST",
            signal: ctl.signal,
            headers: { "Authorization": `Bearer ${mmKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: Deno.env.get("MINIMAX_MODEL") || "speech-02-hd",
              text,
              stream: false,
              language_boost: "auto",
              output_format: "hex",
              voice_setting: { voice_id: mmVoice, speed, vol: 1, pitch: 0 },
              audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
            }),
          });
          const j = await r.json();
          const hex = j && j.data && j.data.audio;
          if (!hex) return jsonError(`MiniMax 出错: ${JSON.stringify(j).slice(0, 400)}`);
          return new Response(hexToBytes(hex), {
            headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
          });
        }

        // ② 硅基流动（国内直连、便宜）
        if ((useSF || !useMM) && sfKey) {
          const voice = sfVoice || Deno.env.get("SILICON_VOICE") || "FunAudioLLM/CosyVoice2-0.5B:charles";
          const model = voice.startsWith("speech:") ? "FunAudioLLM/CosyVoice2-0.5B" : voice.split(":")[0];
          const r = await fetch("https://api.siliconflow.cn/v1/audio/speech", {
            method: "POST",
            signal: ctl.signal,
            headers: { "Authorization": `Bearer ${sfKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, input: text, voice, response_format: "mp3" }),
          });
          if (!r.ok || !r.body) {
            let m = "";
            try { m = await r.text(); } catch (_) {}
            return jsonError(`硅基流动出错 (${r.status}): ${m}`);
          }
          return new Response(r.body, {
            headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
          });
        }

        // ③ ElevenLabs（海外）
        if (elKey && elVoice) {
          const model = Deno.env.get("ELEVEN_MODEL") || "eleven_multilingual_v2";
          const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`, {
            method: "POST",
            signal: ctl.signal,
            headers: { "xi-api-key": elKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
            body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
          });
          if (!r.ok || !r.body) {
            let m = "";
            try { m = await r.text(); } catch (_) {}
            return jsonError(`ElevenLabs 出错 (${r.status}): ${m}`);
          }
          return new Response(r.body, {
            headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
          });
        }

        return jsonError("服务端还没配置语音 Key（MINIMAX_API_KEY / SILICON_API_KEY）");
      } catch (e) {
        return jsonError(`语音合成失败：${String(e)}`);
      } finally {
        clearTimeout(tm);
      }
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
