import { Adapter } from './base.js';

// DeepSeek — https://chat.deepseek.com
// Selectors are best-effort; verify with the inspector and adjust if the site
// changed. Comma-separated lists let the matcher fall back to generic targets.
export default new Adapter({
  id: 'deepseek',
  name: 'DeepSeek',
  homeUrl: 'https://chat.deepseek.com/',
  stableMs: 2500,
  maxMs: 300000,
  selectors: {
    input: 'textarea#chat-input, textarea[placeholder], div[contenteditable="true"]',
    submit: null, // Enter submits
    response: '.ds-markdown, div[class*="markdown"]',
    newChat: 'a[href="/"], [class*="new-chat"], [class*="newChat"]',
    generating: '[class*="stop"], [aria-label*="停止"]',
    loggedOut: null,
  },
});
