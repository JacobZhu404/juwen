import { Adapter } from './base.js';

// 文心一言 (ERNIE Bot, Baidu) — https://yiyan.baidu.com
export default new Adapter({
  id: 'wenxin',
  name: '文心',
  homeUrl: 'https://yiyan.baidu.com/',
  stableMs: 3000,
  maxMs: 300000, // long detailed answers can take well over 2 min; was 120000
  genGraceMs: 10000, // bridge deep-thinking pauses before finalizing
  selectors: {
    input: 'div[contenteditable="true"], textarea',
    submit: null, // Enter submits
    response: '.md-stream-desktop', // final-answer node; excludes the deep-thinking trace
    newChat: '[class*="new-chat"], [class*="newChat"], [class*="new_dialog"]',
    generating: '[class*="stop"], [class*="generating"]',
    // Baidu passport login modal: the phone-verification form only renders when
    // the session has lapsed. The chat input stays visible behind it, so this
    // is what actually distinguishes logged-out from logged-in.
    loggedOut: '.pass-form-item, .pass-item-timer',
  },
});
