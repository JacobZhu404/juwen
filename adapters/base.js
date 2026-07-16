// Generic, config-driven adapter. Each LLM site supplies selectors + URLs;
// the shared logic here handles login detection, starting a fresh chat,
// submitting the prompt, and streaming the answer back as it grows.
//
// Selectors below are best-effort defaults. Chinese LLM sites change their DOM
// often and ship obfuscated class names, so expect to tune `config.selectors`
// per site using the page inspector. The streaming loop itself is site-agnostic.

export class Adapter {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.homeUrl = config.homeUrl;
    this.selectors = config.selectors;
    this.submitKey = config.submitKey || 'Enter';
    // Some sites (九方灵犀) render the whole chat UI inside a cross-origin
    // iframe; the main document is just a shell. When frameUrlPattern is set we
    // resolve the matching child frame and run every element query/evaluate
    // against it. Navigation (goto/bringToFront) and keyboard input stay on the
    // top page — keyboard events reach whatever element is focused, including
    // one inside the frame. When unset, _content() returns the page unchanged,
    // so every other adapter behaves exactly as before.
    this.frameUrlPattern = config.frameUrlPattern || null;
    this.config = config;
  }

  // Resolve the surface that holds the chat DOM: the matching iframe when
  // frameUrlPattern is configured, otherwise the page itself. Polls briefly
  // because the frame attaches asynchronously after navigation.
  async _content(page) {
    if (!this.frameUrlPattern) return page;
    for (let i = 0; i < 40; i++) {
      const f = page.frames().find((fr) => (fr.url() || '').includes(this.frameUrlPattern));
      if (f) return f;
      await page.waitForTimeout(250);
    }
    return page; // fall back to page so callers still get a usable surface
  }

  // Logged in if the prompt input is present and a known "login" affordance is not.
  async isLoggedIn(page) {
    const ctx = await this._content(page);
    let input = await ctx.$(this.selectors.input);
    // iframe-hosted SPAs (九方灵犀) can still be hydrating right after
    // navigation, so the textarea isn't in the DOM the instant the ask handler
    // gates on login. Give it a brief wait — only for frame adapters, so
    // ordinary sites' status checks stay instant.
    if (!input && this.frameUrlPattern) {
      input = await ctx.waitForSelector(this.selectors.input, { timeout: 8000 }).catch(() => null);
    }
    if (!input) return false;
    if (this.selectors.loggedOut) {
      const out = await ctx.$(this.selectors.loggedOut);
      if (out) return false;
    }
    return true;
  }

  // Reuse whatever conversation is already open. We only navigate to the home
  // URL if the prompt input isn't already on the page (e.g. first run, or the
  // tab drifted elsewhere) — that keeps each question in the same running
  // thread instead of spawning a brand-new chat every time. Carried-over
  // context is fine; streamResponse uses a baseline so it won't re-emit the
  // previous turn's answer.
  async openConversation(page) {
    const ctx0 = await this._content(page);
    const ready = await ctx0.$(this.selectors.input).then((el) => !!el).catch(() => false);
    if (ready) return;
    try {
      await page.goto(this.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch { /* continue; selector wait below will guard */ }
    const ctx = await this._content(page);
    await ctx.waitForSelector(this.selectors.input, { timeout: 20000 });
  }

  // Explicitly start a brand-new conversation (drops carried-over context).
  // Triggered by the UI's "新对话" button — the counterpart to openConversation.
  async freshConversation(page) {
    try {
      await page.goto(this.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch { /* continue; selector wait below will guard */ }
    const ctx = await this._content(page);
    if (this.selectors.newChat) {
      const btn = await ctx.$(this.selectors.newChat);
      if (btn && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
    }
    await ctx.waitForSelector(this.selectors.input, { timeout: 20000 }).catch(() => {});
  }

  // Snapshot of the current answers: the last-response text plus how many
  // non-empty response nodes exist. Used as a baseline so a continued
  // conversation doesn't stream back the previous answer — and so a brand-new
  // answer that happens to be word-for-word identical to the previous one (common
  // when retrying the same question) is still recognised via the node count.
  async responseBaseline(page) {
    const sel = this.selectors.response;
    const ctx = await this._content(page);
    try {
      return await ctx.evaluate((s) => {
        const nodes = [...document.querySelectorAll(s)].filter((n) => (n.innerText || '').trim().length > 0);
        return { text: nodes.length ? (nodes[nodes.length - 1].innerText || '') : '', count: nodes.length };
      }, sel);
    } catch { return { text: '', count: 0 }; }
  }

  // Read the current text of an input handle (works for textarea and
  // contenteditable). Used to verify a fill actually landed.
  async readInput(handle) {
    return handle.evaluate((el) => {
      if (el.value !== undefined && el.tagName === 'TEXTAREA') return el.value;
      return el.innerText || el.textContent || '';
    }).catch(() => '');
  }

  // Pick the real chat box among visible matches. Some sites expose several:
  // 智谱 injects a hidden WAF <textarea>; 豆包 has a second empty-class textarea
  // (voice helper) next to the real one. Prefer a placeholder-bearing or
  // contenteditable element over a bare textarea.
  async pickInput(page, sel) {
    const candidates = await page.$$(sel);
    let best = null, bestScore = -1;
    for (const c of candidates) {
      if (!(await c.isVisible().catch(() => false))) continue;
      const score = await c.evaluate((el) => {
        let s = 0;
        if (el.getAttribute && el.getAttribute('placeholder')) s += 2;
        if (el.getAttribute && el.getAttribute('contenteditable') === 'true') s += 2;
        const cls = (el.className || '').toString();
        if (/input|editor|chat|prompt|textarea/i.test(cls)) s += 1;
        return s;
      }).catch(() => 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  async submitPrompt(page, prompt) {
    const sel = this.selectors.input;
    const ctx = await this._content(page);
    await ctx.waitForSelector(sel, { timeout: 20000 });
    // Distinctive end-of-prompt marker, whitespace-stripped so it survives
    // editors that reflow newlines into <p>/<br> (元宝's Quill) — comparing raw
    // text would spuriously fail on the literal "\n" inside the tail.
    const norm = (s) => (s || '').replace(/\s+/g, '');
    const tail = norm(prompt).slice(-8);

    // Re-query the element on each attempt: React sites (文心/元宝) detach and
    // re-mount the input between query and action, which makes a cached
    // elementHandle throw "Element is not attached to the DOM".
    let filled = false;
    let lastErr = '';
    for (let i = 0; i < 4 && !filled; i++) {
      const input = await this.pickInput(ctx, sel);
      if (!input) { await page.waitForTimeout(200); continue; }
      try {
        await input.click({ timeout: 4000 });
        // fill() sets the whole value at once. Unlike type(), it does NOT emit
        // per-character key events, so newlines stay literal instead of each
        // one firing Enter (= premature send).
        await input.fill(prompt).catch((e) => { lastErr = String(e?.message || e); });
        // Rich contenteditable editors (Kimi's div.chat-input-editor, 文心) keep
        // their own document model and silently ignore fill(), so the box looks
        // filled but the framework state stays empty and Enter sends nothing.
        // Detect that and fall back to insertText, which fires real beforeinput/
        // input events the editor honors (newlines stay literal, no premature
        // send).
        let got = await this.readInput(input);
        if (!norm(got).includes(tail)) {
          await input.fill('').catch(() => {});
          await input.click({ timeout: 4000 }).catch(() => {});
          await page.keyboard.insertText(prompt);
          await page.waitForTimeout(150); // let the editor reflow before re-reading
          got = await this.readInput(input);
        }
        if (!norm(got).includes(tail)) { lastErr = lastErr || '输入内容未生效'; await page.waitForTimeout(250); continue; }
        // Frameworks that mirror the DOM into their own state (豆包's textarea,
        // contenteditable editors) won't enable the send button until they see
        // input/change events, so fire them explicitly.
        await input.evaluate((el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        filled = true;
      } catch (e) {
        lastErr = String(e?.message || e);
        await page.waitForTimeout(200);
      }
    }
    if (!filled) {
      // A human-verification overlay (豆包 captcha) covers the page and steals
      // every click. Surface a clear instruction and pop the tab forward so the
      // user can solve it, instead of the opaque "couldn't fill" error.
      if (this.selectors.verify) {
        const v = await ctx.$(this.selectors.verify);
        if (v && await v.isVisible().catch(() => false)) {
          await page.bringToFront().catch(() => {});
          throw new Error('检测到人机验证，请在弹出的浏览器窗口里完成验证后重试');
        }
      }
      // Marketing / feature-promotion modal blocks the chat UI.
      if (this.selectors.popup) {
        const p = await ctx.$(this.selectors.popup);
        if (p && await p.isVisible().catch(() => false)) {
          await page.bringToFront().catch(() => {});
          throw new Error(`${this.name}弹窗出现，请手动关闭后重试`);
        }
      }
      throw new Error('无法填入输入框' + (lastErr ? `（${lastErr}）` : ''));
    }

    // Give the framework a tick to enable the send button.
    await page.waitForTimeout(200);

    if (this.selectors.submit) {
      const send = await ctx.$(this.selectors.submit);
      if (send && await send.isVisible().catch(() => false)) {
        const ok = await send.click({ timeout: 5000 }).then(() => true).catch(() => false);
        if (ok) return;
      }
    }
    await page.keyboard.press(this.submitKey);
  }

  // Poll the last response container and emit text deltas. Resolves when the
  // text has been stable for `stableMs` (no streaming token for that long) or
  // when `maxMs` elapses.
  async streamResponse(page, onDelta, { stableMs = 2500, maxMs = 120000, baseline = '', baselineCount = 0, genGraceMs = 8000 } = {}) {
    const sel = this.selectors.response;
    const ctx = await this._content(page);
    const start = Date.now();
    let last = '';
    let lastChange = Date.now();
    let sawAny = false;
    let everGen = false;     // did we ever see the generating indicator?
    let genGoneSince = 0;    // when the indicator last disappeared (0 = present now)

    while (Date.now() - start < maxMs) {
      let text = '';
      let count = 0;
      try {
        const snap = await ctx.evaluate((s) => {
          const nodes = [...document.querySelectorAll(s)].filter((n) => (n.innerText || '').trim().length > 0);
          return { text: nodes.length ? (nodes[nodes.length - 1].innerText || '') : '', count: nodes.length };
        }, sel);
        text = snap.text; count = snap.count;
      } catch { /* page navigated mid-poll; retry */ }

      // Until the new answer node appears, the last-response node still holds the
      // PREVIOUS turn's answer. Suppress it so we don't stream stale text into a
      // continued conversation. Two ways to know the new answer has arrived: the
      // text differs from the baseline, OR a new response node was added (count
      // grew) — the latter catches answers identical to the previous one (e.g. a
      // retry of the same question), which text comparison alone would hide.
      if (text && text === baseline && count <= baselineCount) text = '';

      if (text && text !== last) {
        // Always emit the full current snapshot and let the client replace its
        // buffer. Streaming markdown re-renders rewrite earlier text in place,
        // so prefix-diffing produces duplicated/garbled output (智谱). A full
        // replace is robust against any reflow.
        onDelta(text, true);
        last = text;
        lastChange = Date.now();
        sawAny = true;
      }

      // Track the generating indicator. Agentic models (Kimi/元宝/千问) drop it
      // mid-answer while they pause to search the web, then resume a new answer
      // segment. So we don't trust the first disappearance — we require it to
      // stay gone for genGraceMs, which bridges those gaps instead of
      // finalizing on the user-visible "searching…" pause.
      if (this.selectors.generating) {
        const gen = await ctx.$(this.selectors.generating);
        if (gen) { everGen = true; genGoneSince = 0; }
        else if (genGoneSince === 0) { genGoneSince = Date.now(); }
      }

      if (sawAny && Date.now() - lastChange > stableMs) {
        if (this.selectors.generating) {
          const goneLongEnough = genGoneSince && (Date.now() - genGoneSince > genGraceMs);
          // Seen the indicator at least once → wait for a sustained absence.
          // Never seen it (wrong selector / instant answer) → fall back to plain
          // text-stability over a comfortably long window.
          if (everGen ? goneLongEnough : (Date.now() - lastChange > Math.max(stableMs, genGraceMs))) break;
        } else {
          break;
        }
      }
      await page.waitForTimeout(400);
    }
    return last;
  }

  // Re-read the model's current on-page answer WITHOUT sending anything, and
  // stream it back. Used by the UI's "刷新" button to recover a complete answer
  // when the original stream finalised early but the site itself kept writing.
  // baseline is empty so we report whatever is currently on screen, and we keep
  // polling until it's stable in case generation is still finishing.
  async rescrape(page, onDelta) {
    await this.openConversation(page);
    return this.streamResponse(page, onDelta, {
      stableMs: this.config.stableMs,
      maxMs: this.config.maxMs,
      genGraceMs: this.config.genGraceMs,
      baseline: '',
      baselineCount: 0,
    });
  }

  // Full cycle for one question.
  async ask(page, prompt, onDelta) {
    await this.openConversation(page);
    // Remember the current answer (and how many answers exist) so streamResponse
    // can tell the new reply apart from the one already on screen in this
    // continued conversation.
    const base = await this.responseBaseline(page);
    await this.submitPrompt(page, prompt);
    // Some sites (文心) only reveal their login wall when you actually try to
    // send — passive status shows "logged in" but the prompt stays stuck in the
    // box. Detect that here so the UI shows a clear re-login prompt instead of
    // silently streaming an empty answer.
    if (this.selectors.loggedOut) {
      await page.waitForTimeout(800);
      const wallCtx = await this._content(page);
      const wall = await wallCtx.$(this.selectors.loggedOut);
      if (wall && await wall.isVisible().catch(() => false)) {
        throw new Error('登录已失效，请点击该模型的「登录」按钮重新登录');
      }
    }
    return this.streamResponse(page, onDelta, {
      stableMs: this.config.stableMs,
      maxMs: this.config.maxMs,
      genGraceMs: this.config.genGraceMs,
      baseline: base.text,
      baselineCount: base.count,
    });
  }
}
