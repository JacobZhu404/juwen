import { Adapter } from './base.js';

// 小米 MiMo — Xiaomi MiMo Studio web chat (https://aistudio.xiaomimimo.com).
// mimo.xiaomi.com is only a marketing landing page; the real chat UI lives at
// aistudio.xiaomimimo.com. Selectors are best-effort; verify/tune with the
// inspector (GET /api/inspect/xiaomi) after logging in with a Xiaomi account.
export default new Adapter({
  id: 'xiaomi',
  name: '小米',
  homeUrl: 'https://aistudio.xiaomimimo.com/',
  stableMs: 2500,
  maxMs: 300000,
  genGraceMs: 10000, // bridge deep-think / web-search pauses mid-answer
  selectors: {
    input: 'textarea[placeholder], div[contenteditable="true"], textarea',
    submit: null, // Enter submits
    // MiMo renders the full answer (and a collapsed "已深度思考…" summary) inside
    // a .prose container. Must target ONLY .prose: when MiMo does web-search it
    // nests inner [class*="markdown"] sub-blocks, and a combined selector would
    // pick the last (nested) markdown fragment instead of the complete prose.
    response: '[class*="prose"]',
    // The only reliable "still generating" signal is the spinning loader icon;
    // there's no stable stop-button class. Without this the stream finalises on
    // the first mid-answer pause and captures only a fragment.
    generating: '[class*="animate-spin"]',
    newChat: '[class*="new-chat"], [class*="newChat"]',
    loggedOut: null,
  },
});
