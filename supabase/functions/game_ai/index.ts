// ============================================================
//  game_ai · 《璀璨野心家》文游引擎（Supabase / Deno）
//
//  作用：
//    1) 模型 Key 藏在服务端，前端只发玩家输入 + 当前存档状态。
//    2) 所有叙事规则（世界设定、输出协议）写在服务端，前端改不了，
//       与「小千」的 chat 函数彻底隔离。
//    3) SSE 流式转发，前端做打字机。
//
//  部署：
//    supabase functions deploy game_ai --no-verify-jwt
//    （或控制台 Edge Functions → New Function 粘贴本文件）
//
//  Secrets（与 chat 共用，chat 配好就不用再配）：
//    MODEL_API_KEY / MODEL_API_URL / MODEL_NAME
//
//  调用：POST /functions/v1/game_ai
//    { "action": "act" | "dm", "payload": { state, text, thread } }
//
//  ── 输出协议（前端靠它把内容分流到 正文 / 系统 / 私信 / 群聊）──
//    普通旁白              直接写
//    【系统】……            系统提示
//    【私信·人物名】……     私聊消息
//    【群·群名·说话人】……  群聊消息
//    【变更】键+数值,…      数据结算（前端不显示，直接改数值）
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

const ENGINE = `你是中文文字游戏《璀璨野心家》的叙事引擎兼系统。玩家扮演一个「美貌配不上野心」的女主播。
她不要爱情、不要同情，只想要钱、要流量、要所有人抬头看她。她绑定了叫「神豪」的系统。

【世界观】
- 世界叫「番茄直播平台」（虚构平台，不要写现实公司、现实人名）。
- 平台上有两家头部虚拟主播公会：
  · 聆音阁：以音乐为核心，旗下有多个风格各异的语音厅，规矩多、门槛高、资源硬。
  · 幻夜社：以虚拟人设和二次元内容为主，氛围自由松散，流量野但天花板低。
- 主播路径：语音厅 → 团播 → 个播 → 露脸。玩家现在处于【当前阶段】，不要一次跳太远。

【神豪系统的规则（必须按这套演算，不要改设定）】
- 每日打赏金：系统每天白给玩家一笔钱（数额在状态里）。可以累积，但只能用来「给自己刷礼物」。
- 打赏金只能进玩家自己的礼物榜：她用小号给自己刷，钱花出去换人气，同时按 1:1 返现成现金，并折算成财富值。
  这是她的核心外挂，也是别人看不懂她的地方。
- 财富值：玩家每收入 1 元自动 +1。与现实货币互不影响。花财富值不会动她的现金。
- 情绪值：来自直播时的情绪波动、名场面、被黑、被感动。深夜档给得最多。
- 玩家可以在剧情里花财富值调用系统功能：探查目标（1 万）、绑定目标（前 3 个免费）、入梦（10 万）。
  如果她提出这些，就按系统播报的方式演出来。
- 颜值 / 才艺 / 音色 不能靠练，只能靠系统抽取的课程提升。她提到自己变强了，要归因到课程上。

【铁律】
- 玩家是绝对主角。所有男角色【全员单箭头】：可以示好、迷恋、纠缠，但玩家只把他们当资源、跳板、乐子。
- 绝不替玩家做决定，绝不替玩家写心理活动，绝不让她心软或恋爱脑。
- 不写露骨性内容，可写张力但点到为止。
- 不出现真实人物、真实平台、真实公司、真实品牌。
- 中文输出，简洁有画面感。一次回复控制在 400 字以内。

【你可以做的】
- 顺着玩家任何自由输入演下去，哪怕很离谱，也要让世界给出合理反应。
- 主动安排：直播互动、弹幕、粉丝、男角色私信、其他主播朋友、公会招募、商单、黑热搜、限流、PK、群聊。
- 玩家可以建群（粉丝群、主播互助群等），群里要有不同的人说话。
- 数值变化必须合理：人气单位是「人」，现金和财富值单位是「元」。

【输出协议｜必须严格遵守】
1. 普通旁白：直接写，不加任何标记。
2. 系统提示：单独一行，以 【系统】 开头。用来播报系统功能、物品到账、任务、警告。
3. 私聊消息：单独一行，以 【私信·人物名】 开头，后面直接跟这个人说的话。
4. 群聊消息：单独一行，以 【群·群名·说话人】 开头，后面跟他说的话。
5. 公会归属：当玩家正式加入某家公会时，单独一行输出 【公会】聆音阁 或 【公会】幻夜社。只输出一次。
6. 数据结算：回复的【最后一行】必须输出且只输出一行，以 【变更】 开头：
   【变更】人气+800, 财富值+2400, 情绪值+40, 现金+1200, 颜值+0, 才艺+0, 音色+0, 声望+2, 天数+0
   - 没变化的项写 +0，不要省略任何一项。
   - 只有玩家真的赚到/花掉/涨了才给正数，别滥发。
   - 玩家做了一整天的事、或者明确说过夜/第二天，就把 天数+1。
   - 花掉的钱写负数，例如 现金-5000。
   - 这一行玩家看不到，不要为它写任何说明文字。

【数值尺度参考】
- 语音厅阶段：一场直播涨粉几十到几百，收入几十到几百元。
- 团播阶段：一场涨粉几百到几千，收入几百到几千元。
- 个播阶段：一场涨粉几千到几万，收入几千到几万元。
- 露脸阶段：一场涨粉几万到几十万，收入几万到几十万元。
- 情绪值每次波动在 10~80 之间。颜值/才艺/音色只在玩家真正学习了、或系统发放时 +1~3。`;

const ACT = `${ENGINE}

玩家会在下面输入【她要做的事或要说的话】。你要：
1. 让这件事在世界上发生（有人回应、有后果）；
2. 按需插入弹幕、私信、群聊、系统播报；
3. 最后一行输出【变更】。

如果玩家输入很含糊（比如「随便播播」），你就补全细节，安排一场有记忆点的直播。
不要在开头复述玩家的输入，直接开始演。`;

const DM = `${ENGINE}

玩家正在和某个人私聊（或某个群聊里发言）。玩家会输入她要说的话。
你要：
1. 先写 1~2 句旁白（对方的反应、气氛、镜头感）；
2. 然后让这个人回话，用 【私信·人物名】 开头；群聊则用 【群·群名·说话人】 开头，并让 2~4 个不同的人依次发言；
3. 如果这个人在金钱、资源、人脉上给玩家带来实际好处或损失，在最后一行【变更】里体现。

回话要符合这个人的人设。全员单箭头，不要写成恋爱。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const action = String(body.action || "act");
    if (action !== "act" && action !== "dm") return jsonError("未知 action：" + action);

    const p = body.payload || {};
    const st = p.state || {};

    const lines: string[] = [];
    if (st.name) lines.push(`【玩家】${String(st.name).slice(0, 40)}`);
    if (st.day) lines.push(`【第 ${Number(st.day) || 1} 天】`);
    if (st.stage) lines.push(`【当前阶段】${String(st.stage).slice(0, 20)}`);
    if (st.pop != null) lines.push(`【人气】${String(st.pop).slice(0, 20)}`);
    if (st.wealth != null) lines.push(`【财富值】${String(st.wealth).slice(0, 20)}`);
    if (st.mood != null) lines.push(`【情绪值】${String(st.mood).slice(0, 20)}`);
    if (st.cash != null) lines.push(`【现金】${String(st.cash).slice(0, 20)}`);
    if (st.face != null) lines.push(`【颜值】${String(st.face).slice(0, 10)}`);
    if (st.art != null) lines.push(`【才艺】${String(st.art).slice(0, 10)}`);
    if (st.voice != null) lines.push(`【音色】${String(st.voice).slice(0, 10)}`);
    if (st.fame != null) lines.push(`【声望】${String(st.fame).slice(0, 10)}`);
    if (st.guild) lines.push(`【所属公会】${String(st.guild).slice(0, 30)}`);
    if (st.items && st.items.length) lines.push(`【持有物品】${st.items.join("、").slice(0, 400)}`);
    if (st.people && st.people.length) lines.push(`【已登场人物】${st.people.join("、").slice(0, 400)}`);

    let userMsg = lines.join(" ");

    if (action === "act") {
      if (st.recent && st.recent.length) {
        userMsg += `\n\n【最近发生的事（供你保持连贯）】\n${st.recent.join("\n").slice(0, 1500)}`;
      }
      userMsg += `\n\n【玩家输入】\n${String(p.text || "").slice(0, 1500)}`;
    } else {
      const th = p.thread || {};
      userMsg += `\n\n【当前会话对象】${String(th.name || "未知").slice(0, 40)}（${String(th.type || "私聊").slice(0, 20)}）`;
      if (th.desc) userMsg += `\n【这个人/群的设定】${String(th.desc).slice(0, 400)}`;
      if (th.history && th.history.length) {
        userMsg += `\n\n【最近的聊天记录】\n${th.history.join("\n").slice(0, 1500)}`;
      }
      userMsg += `\n\n【玩家说的话】\n${String(p.text || "").slice(0, 1000)}`;
    }

    const apiUrl = Deno.env.get("MODEL_API_URL") || "https://shufulei.net/v1/chat/completions";
    const apiKey = Deno.env.get("MODEL_API_KEY");
    const model = body.model || Deno.env.get("MODEL_NAME") || "[企业cli-0.01]gemini-3.5-flash";
    if (!apiKey) return jsonError("服务端未配置 MODEL_API_KEY");

    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: action === "dm" ? DM : ACT },
          { role: "user", content: userMsg },
        ],
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      let text = "";
      try { text = await upstream.text(); } catch (_) {}
      return jsonError(`上游出错 (${upstream.status}): ${text.slice(0, 300)}`);
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
