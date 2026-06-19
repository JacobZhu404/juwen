import { Adapter } from './base.js';

// 腾讯元宝 (Tencent Yuanbao / Hunyuan) — https://yuanbao.tencent.com
export default new Adapter({
  id: 'yuanbao',
  name: '元宝',
  homeUrl: 'https://yuanbao.tencent.com/chat/',
  stableMs: 5000, // searches the web before answering; a longer stable window avoids finalizing on the user-echo bubble
  maxMs: 300000,
  genGraceMs: 15000, // pauses mid-answer to search; bridge the gap before finalizing
  selectors: {
    input: 'div.ql-editor[contenteditable="true"], div[contenteditable="true"], textarea',
    submit: null, // Enter submits
    response: '.agent-chat__bubble--ai', // AI bubble only; the user echo uses .agent-chat__bubble--human
    newChat: '[class*="new-chat"], [class*="newChat"], [class*="create"]',
    generating: '[class*="loading"]', // 0 at idle, present while answering/searching; verified empirically
    loggedOut: null,
  },
});
