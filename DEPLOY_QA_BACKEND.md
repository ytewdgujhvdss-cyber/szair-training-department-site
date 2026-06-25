# 部署知识库问答后端

当前 GitHub Pages 只能托管静态页面，不能运行 `/api/qa/ask`。要让右下角“知识库助手”真正回答，需要部署后端。

## 推荐方案：Vercel

1. 把本项目推送到 GitHub。
2. 在 Vercel 导入这个仓库。
3. 在 Vercel 项目设置里添加环境变量。

如果先用演示知识库，可以不填任何知识库变量。

如果接 Dify：

```text
DIFY_API_KEY=app-xxxxxxxx
DIFY_API_URL=https://api.dify.ai/v1/chat-messages
```

如果接钉钉小蜜：

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

4. 部署后测试：

```bash
curl -X POST https://你的-vercel-域名/api/qa/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"课件模板怎么统一？","user":"测试用户"}'
```

5. 如果继续使用 GitHub Pages 作为钉钉首页，把 `assets/qa-config.js` 改为：

```js
window.TRAINING_QA_API_URL = "https://你的-vercel-域名/api/qa/ask";
```

6. 再推送 GitHub Pages，钉钉应用不用重新配置首页地址。

## 另一种方案

也可以直接把钉钉应用首页地址改成 Vercel 域名：

```text
https://你的-vercel-域名/
```

这样页面和 API 在同一域名，`assets/qa-config.js` 可以保持空值。
