import { createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname);

await loadLocalEnv();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

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

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/qa/ask") {
      const body = await readJson(req);
      const result = await answerQuestion(body);
      await notifyDingTalk(body, result);
      return sendJson(res, result);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(url.pathname, res, req.method === "HEAD");
    }

    sendJson(res, { error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: "Server error" }, 500);
  }
}).listen(port, host, () => {
  console.log(`Training portal running at http://${host}:${port}`);
});

async function loadLocalEnv() {
  try {
    const envPath = join(rootDir, ".env");
    const text = await readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

async function answerQuestion(body) {
  const question = String(body.question || "").trim();
  if (!question) {
    return { answer: "请先输入问题。", sources: [] };
  }

  if (process.env.DIFY_API_KEY) {
    return askDify(question, body);
  }

  if (hasDingTalkAssistantConfig()) {
    return askDingTalkAssistant(question, body);
  }

  if (process.env.KNOWLEDGE_API_URL) {
    return askGenericKnowledgeApi(question, body);
  }

  return askDemoKnowledge(question);
}

function hasDingTalkAssistantConfig() {
  return process.env.DINGTALK_ASSISTANT_ID
    && process.env.DINGTALK_CLIENT_ID
    && process.env.DINGTALK_CLIENT_SECRET;
}

async function askDingTalkAssistant(question, body) {
  const accessToken = await getDingTalkAccessToken();
  const robotAppKey = process.env.DINGTALK_ROBOT_APP_KEY || process.env.DINGTALK_ASSISTANT_ID;
  const apiUrl = buildDingMiAskRobotUrl();
  const response = await fetch(apiUrl, {
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
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  return url.toString();
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

  const url = buildDingTalkUrl();
  const response = await fetch(url, {
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

function buildDingTalkUrl() {
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

function readJson(req) {
  return new Promise((resolveJson, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolveJson(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(pathname, res, headOnly = false) {
  const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const allowed = requestedPath === "/index.html" || requestedPath.startsWith("/assets/");
  if (!allowed) {
    return sendJson(res, { error: "Not found" }, 404);
  }

  const filePath = normalize(join(rootDir, requestedPath));

  if (!filePath.startsWith(rootDir)) {
    return sendJson(res, { error: "Forbidden" }, 403);
  }

  try {
    await access(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    if (headOnly) return res.end();
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, { error: "Not found" }, 404);
  }
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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
