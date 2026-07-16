import { Adapter } from './base.js';

// 九方灵犀 (FinSphere Agent, 九方智投) — https://www.9fzt.com/FinSphereAgent.html
// 对话 UI 整个跑在一个跨域 iframe (jzai.techgp.cn) 里，主页面只是外壳，所以用
// frameUrlPattern 让 base 把所有元素查询都指向该 iframe。输入框是 Ant Design
// Sender 组件的 textarea，回车发送。
export default new Adapter({
  id: 'finsphere',
  name: '九方灵犀',
  homeUrl: 'https://www.9fzt.com/FinSphereAgent.html',
  frameUrlPattern: 'jzai.techgp.cn',
  // 九方灵犀带「深度思考(R1)」，思考+检索工具阶段可能持续较久；答案文本稳定 4s
  // 视为完成（没有可靠的「生成中」指示器，靠文本稳定判定）。
  stableMs: 4000,
  maxMs: 300000,
  selectors: {
    input: 'textarea.ant-sender-input, textarea[placeholder]',
    // Ant Sender 的发送按钮是个 div（图标+“发送”），未输入时带 senderButtonDisabled；
    // 类名含 CSS-modules 哈希后缀，用前缀匹配并排除 Disabled。回车也能发，作为兜底。
    submit: '[class*="senderButton"]:not([class*="Disabled"])',
    // 最终答案渲染在 .markdown-body 里。深度思考/工具检索的过程文本也是 markdown，
    // 但带 utils_item_blank 这个类，用 :not() 排除，只留最终答案节点。答案节点在
    // 思考阶段还不存在，所以流式抓取不会把思考过程当答案。多轮时取最后一个=最新答案。
    response: '.markdown-body:not([class*="utils_item_blank"])',
    newChat: '[class*="newChat"], [class*="new-chat"]',
    generating: null, // 无可靠指示器，靠文本稳定判定结束
    loggedOut: null,
  },
});
