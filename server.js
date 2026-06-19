import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserManager } from './browser.js';
import { adapters, adapterById } from './adapters/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5178;

const app = express();
app.use(express.json());
// no-cache so the browser always revalidates — front-end assets change often
// during selector tuning and we don't want a stale app.js masking fixes.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// List configured models.
app.get('/api/models', (_req, res) => {
  res.json(adapters.map((a) => ({ id: a.id, name: a.name, homeUrl: a.homeUrl })));
});

// Login status for every model.
app.get('/api/status', async (_req, res) => {
  const out = [];
  for (const a of adapters) {
    let loggedIn = false;
    try {
      const page = await browserManager.getPage(a.id, a.homeUrl);
      loggedIn = await a.isLoggedIn(page);
    } catch { /* ignore, report not-logged-in */ }
    out.push({ id: a.id, loggedIn });
  }
  res.json(out);
});

// Open/focus a model's tab so the user can log in manually.
app.post('/api/login/:id', async (req, res) => {
  const a = adapterById[req.params.id];
  if (!a) return res.status(404).json({ error: 'unknown model' });
  try {
    await browserManager.getPage(a.id, a.homeUrl);
    await browserManager.bringToFront(a.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Start a fresh conversation for the given models (or all). Used by the UI's
// "新对话" button so the next question starts a clean thread instead of
// continuing the current one.
app.post('/api/new', async (req, res) => {
  const ids = Array.isArray(req.body?.models) && req.body.models.length ? req.body.models : adapters.map((a) => a.id);
  await Promise.all(ids.map(async (id) => {
    const a = adapterById[id];
    if (!a) return;
    try {
      const page = await browserManager.getPage(a.id, a.homeUrl);
      await a.freshConversation(page);
    } catch { /* best-effort */ }
  }));
  res.json({ ok: true });
});

// Debug: dump the real DOM of a model's logged-in page so selectors can be
// tuned empirically. ?ask=你好 fills the first visible input and sends, ?wait=ms
// controls how long to wait for the answer before dumping.
app.get('/api/inspect/:id', async (req, res) => {
  const a = adapterById[req.params.id];
  if (!a) return res.status(404).json({ error: 'unknown model' });
  let info_err;
  try {
    const page = await browserManager.getPage(a.id, a.homeUrl);
    if (req.query.fresh) await page.goto(a.homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (req.query.ask) {
      // Use the adapter's real send path (Playwright fill + submit) so the
      // answer actually generates and its container becomes inspectable.
      await a.submitPrompt(page, req.query.ask).catch((e) => { info_err = String(e); });
      await page.waitForTimeout(Number(req.query.wait) || 9000);
    }
    const info = await page.evaluate(() => {
      const d = (el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 140),
        id: el.id || undefined,
        ph: el.getAttribute && el.getAttribute('placeholder') || undefined,
        testid: el.getAttribute && el.getAttribute('data-testid') || undefined,
        visible: el.offsetParent !== null,
      });
      const inputs = [...document.querySelectorAll('textarea, div[contenteditable="true"]')].map(d);
      const buttons = [...document.querySelectorAll('button, [role="button"]')]
        .filter((e) => e.offsetParent !== null).slice(0, 60)
        .map((e) => { const r = e.getBoundingClientRect();
          return { ...d(e), text: (e.innerText || '').trim().slice(0, 16),
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
      const blocks = [...document.querySelectorAll('div,article,section,p,li')]
        .map((el) => ({ el, len: (el.innerText || '').length }))
        .filter((o) => o.len > 40 && o.len < 8000)
        .sort((a, b) => b.len - a.len).slice(0, 12)
        .map((o) => ({ ...d(o.el), len: o.len, snippet: (o.el.innerText || '').replace(/\s+/g, ' ').slice(0, 70) }));
      return { url: location.href, inputs, buttons, blocks };
    });
    // Probe candidate response selectors: report match count + last match text.
    let probes;
    if (req.query.sel) {
      probes = await page.evaluate((sels) => sels.map((s) => {
        let nodes = [];
        try { nodes = [...document.querySelectorAll(s)]; } catch { return { sel: s, error: 'bad' }; }
        const withText = nodes.filter((n) => (n.innerText || '').trim().length > 0);
        const last = withText[withText.length - 1];
        return { sel: s, count: nodes.length, nonEmpty: withText.length,
          lastLen: last ? (last.innerText || '').length : 0,
          lastSnippet: last ? (last.innerText || '').replace(/\s+/g, ' ').slice(0, 90) : '' };
      }), req.query.sel.split('||'));
    }
    // Reverse-lookup: find the tightest elements whose text contains ?find=,
    // revealing the real answer-node tag/class on hashed-class sites.
    let finds;
    if (req.query.find) {
      finds = await page.evaluate((needle) => {
        return [...document.querySelectorAll('*')]
          .filter((el) => (el.innerText || '').includes(needle))
          .map((el) => ({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 160),
            testid: el.getAttribute('data-testid') || undefined, len: (el.innerText || '').length }))
          .sort((a, b) => a.len - b.len).slice(0, 8);
      }, req.query.find);
    }
    res.json({ ...info, sendError: info_err, probes, finds });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const send = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

    // Re-scrape a single model's current on-page answer without re-asking.
    if (msg.type === 'refresh' && msg.model) {
      const a = adapterById[msg.model];
      if (!a) return;
      send({ type: 'start', model: a.id });
      try {
        const page = await browserManager.getPage(a.id, a.homeUrl);
        if (!(await a.isLoggedIn(page))) {
          send({ type: 'error', model: a.id, error: '未登录，请先点击该模型的「登录」按钮' });
          return;
        }
        await a.rescrape(page, (delta, replace) => {
          send({ type: 'delta', model: a.id, delta, replace: !!replace });
        });
        send({ type: 'done', model: a.id });
      } catch (e) {
        send({ type: 'error', model: a.id, error: String(e?.message || e) });
      }
      return;
    }

    if (msg.type !== 'ask' || !msg.prompt) return;

    const selected = Array.isArray(msg.models) && msg.models.length
      ? adapters.filter((a) => msg.models.includes(a.id))
      : adapters;

    // Run every model concurrently; stream deltas as they arrive.
    await Promise.all(selected.map(async (a) => {
      send({ type: 'start', model: a.id });
      try {
        const page = await browserManager.getPage(a.id, a.homeUrl);
        if (!(await a.isLoggedIn(page))) {
          send({ type: 'error', model: a.id, error: '未登录，请先点击该模型的「登录」按钮' });
          return;
        }
        await a.ask(page, msg.prompt, (delta, replace) => {
          send({ type: 'delta', model: a.id, delta, replace: !!replace });
        });
        send({ type: 'done', model: a.id });
      } catch (e) {
        send({ type: 'error', model: a.id, error: String(e?.message || e) });
      }
    }));

    send({ type: 'all-done' });
  });
});

server.listen(PORT, () => {
  console.log(`\n  LLM Aggregator → http://localhost:${PORT}\n`);
  console.log('  首次使用：在网页里点每个模型的「登录」按钮，在弹出的浏览器里登录一次即可。\n');
  // Warm up the browser so the first request is faster.
  browserManager.ensureContext().catch(() => {});
});

process.on('SIGINT', async () => { await browserManager.close(); process.exit(0); });
process.on('SIGTERM', async () => { await browserManager.close(); process.exit(0); });
