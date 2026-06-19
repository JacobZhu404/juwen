import { Adapter } from './base.js';

// 豆包 (Doubao, ByteDance) — https://www.doubao.com
export default new Adapter({
  id: 'doubao',
  name: '豆包',
  homeUrl: 'https://www.doubao.com/chat/',
  stableMs: 3000,
  maxMs: 120000,
  selectors: {
    input: 'textarea.semi-input-textarea, textarea[placeholder], textarea',
    submit: '#flow-end-msg-send', // icon-only send button (Enter does not submit)
    response: '.md-box-root', // markdown answer body; excludes suggested-question chips
    newChat: '[data-testid="create_conversation_button"], [class*="new-chat"], [class*="newChat"]',
    generating: '[class*="stop"], [data-testid*="stop"]',
    loggedOut: null,
    // 豆包 throws an anti-bot CAPTCHA overlay when it suspects automation; it
    // covers the page and intercepts clicks, so sending silently fails.
    verify: '#captcha_container',
  },
});
