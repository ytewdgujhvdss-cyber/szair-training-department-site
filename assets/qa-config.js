// 部署后端后，把下面地址换成你的真实后端地址，例如：
// Vercel: https://你的-vercel-域名/api/qa/ask
// Render: https://你的-render-域名/api/qa/ask
// 本地测试: http://localhost:3000/api/qa/ask
window.TRAINING_QA_API_URL = window.TRAINING_QA_API_URL || "https://training-qa-api.onrender.com/api/qa/ask";

// 当后端返回的来源没有 url 时，点击来源跳转的页面。
// Dify 场景下建议填写 Dify 共享应用地址或知识库页面，例如：
// https://cloud.dify.ai/app/xxxxxx 或 https://udify.app/xxxxxx
// 若留空，来源将显示为不可点击的文本。
window.TRAINING_QA_SHARED_KB_URL = window.TRAINING_QA_SHARED_KB_URL || "";
