import { Adapter } from './base.js';

// 文心一言 (ERNIE Bot, Baidu) — https://yiyan.baidu.com
export default new Adapter({
  id: 'wenxin',
  name: '文心',
  homeUrl: 'https://chat.baidu.com/?enter_type=yiyan_site',
  stableMs: 3000,
  maxMs: 300000, // long detailed answers can take well over 2 min; was 120000
  genGraceMs: 10000, // bridge deep-thinking pauses before finalizing
  selectors: {
    input: 'div[contenteditable="true"], textarea',
    submit: null, // Enter submits
    // chat.baidu.com renders each reply's markdown in .cosd-markdown, wrapped by
    // .answer-container (the old .md-stream-desktop node is gone). Scoping to
    // .answer-container keeps us to answers only — never the question bubble or
    // the deep-thinking trace. streamResponse takes the last match = newest reply.
    response: '.answer-container .cosd-markdown',
    newChat: '[class*="new-chat"], [class*="newChat"], [class*="new_dialog"]',
    generating: '[class*="stop"], [class*="generating"]',
    // Baidu passport login modal: the phone-verification form only renders when
    // the session has lapsed. The chat input stays visible behind it, so this
    // is what actually distinguishes logged-out from logged-in.
    loggedOut: '.pass-form-item, .pass-item-timer',
  },
});
