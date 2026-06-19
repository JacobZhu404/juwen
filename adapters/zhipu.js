import { Adapter } from './base.js';

// 智谱清言 (Zhipu GLM) — https://chatglm.cn
export default new Adapter({
  id: 'zhipu',
  name: '智谱',
  homeUrl: 'https://chatglm.cn/main/alltoolsdetail',
  stableMs: 3000,
  maxMs: 300000,
  selectors: {
    input: 'textarea.scroll-display-none, textarea, div[contenteditable="true"]',
    submit: null, // Enter submits
    response: '[class*="answer-content"]', // final answer node; a sibling of .thinking-content, so thinking is never captured
    newChat: '[class*="new-chat"], [class*="newChat"], [class*="new_chat"]',
    // Present only while GLM is working (incl. multi-step web search). Lets the
    // stream wait through long search pauses instead of finalizing on the
    // intermediate reasoning text. Verified: 0 at idle, ≥1 mid-generation.
    generating: '[class*="loading"]',
    loggedOut: null,
  },
});
