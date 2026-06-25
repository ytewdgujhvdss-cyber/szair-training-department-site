# 部署知识库问答后端

当前 GitHub Pages 只能托管静态页面，不能运行 `/api/qa/ask`。要让右下角“知识库助手”真正回答，需要部署后端。

## 推荐方案：Vercel

1. 把本项目推送到 GitHub。
2. 在 Vercel 导入这个仓库。
3. 在 Vercel 项目设置里添加环境变量（只启用一种知识库方案即可）。

### 方案 A：Dify（生成式回答，推荐）

```text
DIFY_API_KEY=app-xxxxxxxx
DIFY_API_URL=https://api.dify.ai/v1/chat-messages
```

### 方案 B：ima 知识库（直接复用已有 ima 知识库）

1. 访问 https://ima.qq.com/agent-interface，进入“开放接口”页面。
2. 使用 ima 客户端扫码或登录后，创建应用以获取：
   - ClientId（`ima-openapi-clientid`）
   - ApiKey（`ima-openapi-apikey`）
3. 通过 openapi 接口获取真正可用的知识库 ID：

   ```bash
   curl -X POST https://ima.qq.com/openapi/wiki/v1/get_addable_knowledge_base_list \
     -H "ima-openapi-clientid: your_client_id" \
     -H "ima-openapi-apikey: your_api_key" \
     -H "Content-Type: application/json" \
     -d '{"cursor":"","limit":20}'
   ```

   返回的 `addable_knowledge_base_list[].id` 才是 `IMA_KNOWLEDGE_BASE_ID` 要填的值。注意：ima 客户端里看到的知识库 ID 与 openapi 返回的 ID 可能不同，必须以 openapi 返回的为准。
4. 把培训制度、课件规范、流程说明、常见问答、设备手册、教员资质说明等文档上传到该知识库，确保能被正常解析分片。

```text
IMA_CLIENT_ID=your_client_id
IMA_API_KEY=your_api_key
IMA_KNOWLEDGE_BASE_ID=your_kb_id
IMA_BASE_URL=https://ima.qq.com/openapi/wiki/v1
```

说明：ima 的 `search_knowledge` 接口是按关键词检索，返回命中文档的标题与高亮片段。当前后端会把这些片段直接返回给前端。如需更自然的“总结式回答”，可以：
- 在 ima 里开启“智能问答”并把机器人配置为总结模式；或
- 后端拿到搜索结果后再调用一次 LLM 做答案生成。

### 方案 C：钉钉小蜜

```text
DINGTALK_ASSISTANT_ID=xxxxxxxx
DINGTALK_CLIENT_ID=dingxxxxxxxx
DINGTALK_CLIENT_SECRET=xxxxxxxx
DINGTALK_ROBOT_APP_KEY=xxxxxxxx
```

如果同步问答记录到钉钉群：

```text
DINGTALK_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=xxxxxxxx
DINGTALK_SECRET=SECxxxxxxxx
```

### 方案 D：演示知识库（无需配置）

如果先用演示知识库，可以不填任何知识库变量，后端会返回基于关键词的演示答案。

---

4. 部署后测试：

```bash
curl -X POST https://你的-vercel-域名/api/qa/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"课件模板怎么统一？","user":"测试用户"}'
```

5. 如果继续使用 GitHub Pages 作为首页，把 `assets/qa-config.js` 改为：

```js
window.TRAINING_QA_API_URL = "https://你的-vercel-域名/api/qa/ask";
```

6. 再推送 GitHub Pages，首页地址不变，后端接口即生效。

## 另一种方案

也可以直接把应用首页地址改成 Vercel 域名：

```text
https://你的-vercel-域名/
```

这样页面和 API 在同一域名，`assets/qa-config.js` 可以保持空值。

## 本地开发测试

```bash
cp .env.example .env
# 编辑 .env 填入对应的环境变量
node server.js
```

然后用 curl 测试：

```bash
curl -X POST http://localhost:3000/api/qa/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"课件模板怎么统一？","user":"测试用户"}'
```

## 安全提醒

- `.env` 文件不要提交到 GitHub仓库。
- 不要把 Dify / ima / 钉钉的真实密钥写进前端代码或公开文档。
- Vercel 环境变量应标记为“Sensitive”或只在 Build/Runtime 环境使用。
