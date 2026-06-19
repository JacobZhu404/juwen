import { Adapter } from './base.js';

// Kimi (Moonshot) — https://kimi.com
export default new Adapter({
  id: 'kimi',
  name: 'Kimi',
  homeUrl: 'https://kimi.com/',
  stableMs: 2500,
  maxMs: 240000,
  genGraceMs: 15000, // bridge mid-answer web-search pauses
  selectors: {
    input: 'div.chat-input-editor[contenteditable="true"], div[contenteditable="true"], textarea',
    submit: null,
    // Clean final-answer node — works well for normal questions. NOTE: when
    // Kimi enters its agentic "deep research" mode (multi tool-calls, triggered
    // by complex prompts) it rebuilds the answer DOM through several phases and
    // this scraping approach only captures the truncated intro. No reliable fix
    // found; recommend turning off Kimi's deep-research/search mode for those.
    response: '.markdown',
    newChat: '[class*="new-chat"], [class*="newChat"], a[href="/chat"]',
    generating: '[class*="stop"], [class*="generating"]',
    loggedOut: null,
  },
});
