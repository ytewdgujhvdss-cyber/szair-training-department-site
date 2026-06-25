// 部署后端后，把下面地址换成你的真实后端地址，例如：
// Vercel: https://你的-vercel-域名/api/qa/ask
// Render: https://你的-render-域名/api/qa/ask
// 本地测试: http://localhost:3000/api/qa/ask
window.TRAINING_QA_API_URL = window.TRAINING_QA_API_URL || "https://training-qa-api.onrender.com/api/qa/ask";

// 当某个来源没有原文直链时（例如订阅知识库），点击来源跳转到的 ima 共享知识库页面
window.TRAINING_QA_SHARED_KB_URL = window.TRAINING_QA_SHARED_KB_URL || "https://ima.qq.com/wiki/?shareId=bbe207edc532702d12be453f0a2a28845c93a77a750806b42ec3922e7400ea00";
