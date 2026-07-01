import { Adapter } from './base.js';

// 问财 (Wencai / 同花顺问财) — https://www.iwencai.com/chat
// 同花顺旗下的金融大模型问答。选择器是 best-effort，登录后用
// GET /api/inspect/wencai 探测真实节点再微调。
export default new Adapter({
  id: 'wencai',
  name: '问财',
  homeUrl: 'https://www.iwencai.com/chat',
  // 问财没有可靠的「生成中」class 指示器：页面常驻 7 个 *loading* 节点
  // （懒加载占位、历史列表 chat-message-list-loading 等），与生成状态无关，
  // 所以 generating 设为 null，改用「答案文本稳定」来判定结束。检索阶段发生在
  // 思考阶段（此时 .aime-markdown 还没文本，sawAny 仍为 false），不会被误判完成。
  stableMs: 5000, // 答案稳定 5s 视为完成，给真正答案阶段的短暂停顿留余量
  maxMs: 300000,
  selectors: {
    input: 'div.ql-editor[contenteditable="true"], div[contenteditable="true"], textarea[placeholder], textarea',
    submit: null, // 回车提交
    // 模型回答是 .chat-response 容器内的 span.rich-text-container.aime-markdown。
    // 不能只用 [class*="markdown"]：回答之后还会追加一个「上述回答满意吗+推荐」
    // 的建议气泡(.suggest-item-container)，它同样是 aime-markdown，会成为 DOM
    // 里最后一个 markdown 节点，导致只取末节点的逻辑抓到 CTA 而非真正答案。
    // 限定在 .chat-response 内即可排除建议气泡，末节点就是最新一轮回答。
    response: '.chat-response .aime-markdown',
    newChat: '[class*="new-chat"], [class*="newChat"], [class*="create"]',
    generating: null, // 见上：无可靠指示器，靠文本稳定判定结束
    loggedOut: null,
  },
});
