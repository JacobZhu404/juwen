import { Adapter } from './base.js';

// 通义千问 (Qwen) — https://chat.qwen.ai
export default new Adapter({
  id: 'qwen',
  name: '千问',
  homeUrl: 'https://chat.qwen.ai/',
  stableMs: 3000,
  maxMs: 300000,
  selectors: {
    input: 'textarea#chat-input, textarea[placeholder], div[contenteditable="true"]',
    submit: null, // Enter submits
    response: '.response-message-content.phase-answer', // answer phase only; excludes the thinking/search phase
    newChat: '[class*="new-chat"], [class*="newChat"]',
    generating: '.stop-button', // present only while generating; gone when complete

    loggedOut: null,
  },
});
