import { createHmac } from "node:crypto";

const demoKnowledge = [
  {
    keywords: ["课件", "模板", "审核", "标准"],
    answer: "一期建议先统一课件模板、内容结构、审核口径和版本管理。课件助手可以围绕模板中心、内容生成、场景切换、标准检查四个能力建设。",
    sources: ["AI课件助手", "标准化建设清单"]
  },
  {
    keywords: ["教员", "资质", "授权", "复训", "到期"],
    answer: "教员画像应覆盖基础身份、资质授权、授课记录、训练记录、内容贡献和风险预警。到期证照、待复训、授权冲突适合配置自动提醒。",
    sources: ["教员全生命周期画像", "近期风险提醒"]
  },
  {
    keywords: ["组织", "架构", "中心", "科室"],
    answer: "培训部以三个中心三个科室协同运行：飞行训练中心、乘务训练中心、模拟机维护中心，以及综合业务室、综合培训室、计划质控室。",
    sources: ["组织架构", "组织说明"]
  },
  {
    keywords: ["设备", "训练", "教室", "模拟机", "资源"],
    answer: "训练资源包括飞行训练设备、乘务训练设备和多场景培训教室。现有资料中包含 B737、A320 飞行模拟机、客舱模拟器、灭火模拟器、出口模拟器、CBT 教室和普通教室等。",
    sources: ["训练资源", "训练资源明细"]
  },
  {
    keywords: ["路线", "建设", "数字化", "智能化", "规划"],
    answer: "推荐按三步推进：先把纸质台账转成数字化底账，再让模板、流程、权限、台账和看板规范运行，最后在课件、画像、汇报、提醒等场景叠加 AI。",
    sources: ["建设路线", "一期实施重点"]
  }
];

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await answerQuestion(req.body || {});
    await notifyDingTalk(req.body || {}, result);
    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
}

async function answerQuestion(body) {
  const question = String(body.question || "").trim();
  if (!question) {
    return { answer: "请先输入问题。", sources: [] };
  }

  const provider = (process.env.QA_PROVIDER || "").toLowerCase();

  // 显式指定 provider 时优先走指定通道
  if (provider === "dify" && process.env.DIFY_API_KEY) {
    return askDify(question, body);
  }

  if (provider === "dingtalk" && hasDingTalkAssistantConfig()) {
    return askDingTalkAssistant(question, body);
  }

  if (provider === "ima" && hasImaConfig()) {
    return askIma(question, body);
  }

  // 未指定或指定无效时，按原有优先级兜底
  if (process.env.DIFY_API_KEY) {
    return askDify(question, body);
  }

  if (hasImaConfig()) {
    return askIma(question, body);
  }

  if (hasDingTalkAssistantConfig()) {
    return askDingTalkAssistant(question, body);
  }

  if (process.env.KNOWLEDGE_API_URL) {
    return askGenericKnowledgeApi(question, body);
  }

  return askDemoKnowledge(question);
}

function hasImaConfig() {
  return process.env.IMA_CLIENT_ID
    && process.env.IMA_API_KEY
    && process.env.IMA_KNOWLEDGE_BASE_ID;
}

async function askIma(question, body) {
  const baseUrl = (process.env.IMA_BASE_URL || "https://ima.qq.com/openapi/wiki/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/search_knowledge`, {
    method: "POST",
    headers: {
      "ima-openapi-clientid": process.env.IMA_CLIENT_ID,
      "ima-openapi-apikey": process.env.IMA_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      knowledge_base_id: process.env.IMA_KNOWLEDGE_BASE_ID,
      query: question,
      cursor: ""
    })
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`IMA search request failed: ${response.status} ${text}`);
  }

  if (!response.ok) {
    throw new Error(`IMA search request failed: ${response.status} ${JSON.stringify(data)}`);
  }

  if (data.code !== 0) {
    return {
      answer: `IMA 知识库搜索返回错误：code=${data.code}，msg=${data.msg || "无错误说明"}。请核对 IMA 凭证、知识库 ID 和接口权限。`,
      sources: ["IMA 知识库"]
    };
  }

  const list = data.data?.info_list || [];
  if (list.length === 0) {
    return {
      answer: "在 IMA 知识库中没有找到匹配内容。可以换个关键词试试，或补充更多文档到知识库。",
      sources: []
    };
  }

  const sources = await Promise.all(
    list
      .slice(0, 3)
      .map(async item => {
        const title = item.title || "未命名文档";
        const url = await getMediaUrl(item.media_id);
        return url ? { title, url } : { title };
      })
  );

  const context = list.slice(0, 5).map((item, idx) => ({
    index: idx + 1,
    title: item.title || "未命名文档",
    content: (item.highlight_content || "").replace(/\s+/g, " ").trim()
  }));

  let answer;
  if (hasLlmConfig()) {
    answer = await summarizeWithLlm(question, context);
  } else {
    answer = buildNaturalAnswer(question, context);
  }

  return { answer, sources };
}

function hasLlmConfig() {
  return process.env.LLM_API_KEY && process.env.LLM_API_URL;
}

async function getMediaUrl(mediaId) {
  if (!mediaId) return null;
  try {
    const baseUrl = (process.env.IMA_BASE_URL || "https://ima.qq.com/openapi/wiki/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/get_media_info`, {
      method: "POST",
      headers: {
        "ima-openapi-clientid": process.env.IMA_CLIENT_ID,
        "ima-openapi-apikey": process.env.IMA_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ media_id: mediaId })
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }

    if (!response.ok || data.code !== 0) {
      return null;
    }

    return data.data?.url_info?.url || null;
  } catch (error) {
    console.warn("getMediaUrl failed:", error.message);
    return null;
  }
}

async function summarizeWithLlm(question, context) {
  const prompt = `你是深圳航空培训部的知识库助手。请根据下面从知识库中检索到的资料，用自然、简洁的中文回答用户的问题。如果资料不足以给出准确答案，请明确说明。回答中不要重复罗列文档标题，要给出总结性的解释。

用户问题："""${question}"""

检索到的资料：
${context.map(c => `[${c.index}] ${c.title}\n${c.content || "（无摘要）"}`).join("\n\n")}

请用中文给出自然语言回答：`;

  const apiUrl = process.env.LLM_API_URL;
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.LLM_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一个专业的企业知识库问答助手，回答简洁、准确。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 800
    })
  });

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`LLM summarization failed: ${response.status} ${text}`);
  }

  if (!response.ok) {
    throw new Error(`LLM summarization failed: ${response.status} ${JSON.stringify(result)}`);
  }

  return result.choices?.[0]?.message?.content
    || result.result
    || result.output
    || result.text
    || "（LLM 未返回有效内容）";
}

function buildNaturalAnswer(question, context) {
  const titles = context.map(c => c.title);

  // 尝试提取共同主题
  const themes = inferThemes(titles);
  const hasContent = context.some(c => c.content);

  if (!hasContent) {
    // 没有高亮片段时，根据标题生成主题式总结
    let intro = `关于"${question}"，我在知识库中找到了一些相关资料。`;
    if (themes.length > 0) {
      intro += `主要涉及${themes.join("、")}等方面。`;
    }

    const categorized = categorizeTitles(titles);
    const lines = [intro, ""];
    for (const [category, items] of Object.entries(categorized)) {
      if (items.length > 0) {
        lines.push(`**${category}**：${items.join("、")}`);
      }
    }
    lines.push("", "由于这些资料以 PDF/Word 文档为主，暂时没有提取到具体段落摘要。如果你需要了解某个具体文件的内容，可以告诉我文件名或更具体的问题。");
    return lines.join("\n");
  }

  // 有高亮片段时，按段落组织
  const mainPoints = context
    .filter(c => c.content)
    .map((c, idx) => {
      const text = c.content.length > 180 ? c.content.slice(0, 180) + "……" : c.content;
      return `${idx + 1}. **${c.title}**：${text}`;
    });

  return `关于"${question}"，我在知识库中找到了相关资料，总结如下：\n\n`
    + mainPoints.join("\n\n")
    + "\n\n如需更详细的说明，可以告诉我具体想深入了解哪一部分。";
}

function inferThemes(titles) {
  const keywords = [
    { keys: ["飞行", "运行", "机组"], theme: "飞行运行与机组操作" },
    { keys: ["安全", "通告", "风险"], theme: "安全管理与风险通告" },
    { keys: ["课件", "培训", "教学", "教材"], theme: "培训教学与课件资料" },
    { keys: ["手册", "程序", "规范"], theme: "运行手册与程序规范" },
    { keys: ["教员", "资质", "训练"], theme: "教员资质与训练管理" },
    { keys: ["设备", "模拟机", "机务"], theme: "训练设备与模拟机" }
  ];

  const matched = new Set();
  const titleText = titles.join(" ");
  for (const item of keywords) {
    if (item.keys.some(k => titleText.includes(k))) {
      matched.add(item.theme);
    }
  }
  return Array.from(matched).slice(0, 3);
}

function categorizeTitles(titles) {
  const rules = [
    { name: "运行手册与程序", patterns: [/手册/, /程序/, /规范/, /R\d+/] },
    { name: "安全通告与通报", patterns: [/安全/, /通告/, /通报/, /风险/] },
    { name: "飞行操作与技术", patterns: [/飞行/, /机组/, /操作/, /机内/, /B737/] },
    { name: "培训与课件", patterns: [/课件/, /培训/, /教学/, /教材/, /讲义/] },
    { name: "其他资料", patterns: [/.*/] }
  ];

  const categorized = { "运行手册与程序": [], "安全通告与通报": [], "飞行操作与技术": [], "培训与课件": [], "其他资料": [] };
  for (const title of titles) {
    let assigned = false;
    for (const rule of rules) {
      if (rule.name === "其他资料" || rule.patterns.some(p => p.test(title))) {
        if (rule.name !== "其他资料" || !assigned) {
          categorized[rule.name].push(title);
          assigned = true;
          break;
        }
      }
    }
  }

  // 删除空类别
  for (const key of Object.keys(categorized)) {
    if (categorized[key].length === 0) delete categorized[key];
  }
  return categorized;
}

async function askDify(question, body) {
  const endpoint = process.env.DIFY_API_URL || "https://api.dify.ai/v1/chat-messages";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.DIFY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputs: {
        role: body.role || "",
        page: body.page || ""
      },
      query: question,
      response_mode: "blocking",
      user: body.user || "training-portal-user"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dify request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const sources = (data.metadata?.retriever_resources || [])
    .map(item => item.document_name || item.dataset_name)
    .filter(Boolean)
    .slice(0, 3);

  return {
    answer: data.answer || "知识库没有返回明确答案。",
    sources
  };
}

function hasDingTalkAssistantConfig() {
  return process.env.DINGTALK_ASSISTANT_ID
    && process.env.DINGTALK_CLIENT_ID
    && process.env.DINGTALK_CLIENT_SECRET;
}

async function askDingTalkAssistant(question, body) {
  const accessToken = await getDingTalkAccessToken();
  const robotAppKey = process.env.DINGTALK_ROBOT_APP_KEY || process.env.DINGTALK_ASSISTANT_ID;
  const response = await fetch(buildDingMiAskRobotUrl(), {
    method: "POST",
    headers: {
      "x-acs-dingtalk-access-token": accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question,
      robotAppKey,
      sessionUuid: body.sessionUuid || body.user || "training-portal-session",
      dingUserId: body.dingUserId || body.user || "training-portal-user"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      answer: `钉钉小蜜问答接口 HTTP 调用失败：${response.status}。返回内容：${text}`,
      sources: ["钉钉小蜜智能问答"]
    };
  }

  const data = await response.json();
  if (data.errcode && data.errcode !== 0) {
    return {
      answer: `钉钉小蜜问答接口返回错误：errcode=${data.errcode}，errmsg=${data.errmsg || "无错误说明"}。请核对 robotAppKey、接口路径和应用权限。`,
      sources: ["钉钉小蜜智能问答"]
    };
  }

  return {
    answer: extractDingTalkAnswer(data),
    sources: data.sources || data.references || ["钉钉小蜜智能问答"]
  };
}

function buildDingMiAskRobotUrl() {
  const baseUrl = (process.env.DINGTALK_SMART_QA_BASE_URL || "https://api.dingtalk.com").replace(/\/$/, "");
  const path = process.env.DINGTALK_SMART_QA_PATH || "/v1.0/dingmi/robots/ask";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function extractDingTalkAnswer(data) {
  const raw = data.result ?? data.answer ?? data.output ?? data.text;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    for (const key of ["content", "text", "answer", "reply"]) {
      if (typeof raw[key] === "string") return raw[key];
    }
  }

  return JSON.stringify(data, null, 2);
}

async function getDingTalkAccessToken() {
  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: process.env.DINGTALK_CLIENT_ID,
      appSecret: process.env.DINGTALK_CLIENT_SECRET
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DingTalk token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  if (!data.accessToken) {
    throw new Error("DingTalk token response did not include accessToken");
  }
  return data.accessToken;
}

async function askGenericKnowledgeApi(question, body) {
  const response = await fetch(process.env.KNOWLEDGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.KNOWLEDGE_API_KEY ? { "Authorization": `Bearer ${process.env.KNOWLEDGE_API_KEY}` } : {})
    },
    body: JSON.stringify({
      question,
      user: body.user,
      role: body.role,
      page: body.page
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Knowledge API request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    answer: data.answer || data.text || "知识库没有返回明确答案。",
    sources: data.sources || []
  };
}

function askDemoKnowledge(question) {
  const normalized = question.toLowerCase();
  const hit = demoKnowledge.find(item => item.keywords.some(keyword => normalized.includes(keyword.toLowerCase())));

  if (hit) {
    return hit;
  }

  return {
    answer: "演示知识库里暂时没有找到明确依据。正式接入后，可以把制度文件、课件规范、流程说明和常见问答上传到知识库，再由后端调用真实问答接口。",
    sources: ["演示知识库"]
  };
}

async function notifyDingTalk(body, result) {
  if (!process.env.DINGTALK_WEBHOOK) return;

  const title = "培训部知识库问答";
  const markdown = [
    `### ${title}`,
    "",
    `**提问人：** ${body.user || "网站用户"}`,
    "",
    `**问题：** ${body.question || ""}`,
    "",
    `**答案：** ${result.answer || ""}`
  ].join("\n");

  const response = await fetch(buildDingTalkWebhookUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { title, text: markdown }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`DingTalk notify failed: ${response.status} ${text}`);
  }
}

function buildDingTalkWebhookUrl() {
  if (!process.env.DINGTALK_SECRET) {
    return process.env.DINGTALK_WEBHOOK;
  }

  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${process.env.DINGTALK_SECRET}`;
  const sign = encodeURIComponent(
    createHmac("sha256", process.env.DINGTALK_SECRET).update(stringToSign).digest("base64")
  );

  return `${process.env.DINGTALK_WEBHOOK}&timestamp=${timestamp}&sign=${sign}`;
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigins = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://ytewdgujhvdss-cyber.github.io"
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
