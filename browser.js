import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A single persistent browser context holds cookies/localStorage for every
// site, so logins survive restarts. Each adapter drives its own page (tab).
class BrowserManager {
  constructor() {
    this.context = null;
    this.pages = new Map(); // adapter id -> Page
    this._contextPromise = null;
    this._pageLoading = new Map(); // adapter id -> in-flight Promise<Page>
  }

  async ensureContext() {
    if (this.context) return this.context;
    if (this._contextPromise) return this._contextPromise;
    this._contextPromise = (async () => {
      const userDataDir = path.join(__dirname, '.browser-profile');
      const ctx = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // must be visible so the user can log in manually
        channel: 'chrome', // use the system-installed Google Chrome (no download, less bot-detection)
        viewport: null,
        args: [
          '--disable-blink-features=AutomationControlled',
          // Launch the window minimized so warm-up / lazy opens don't steal
          // focus from whatever the user is doing. They can click the Dock
          // icon (or the model's "登录" button, which calls bringToFront) to
          // raise it when they actually need to interact.
          '--start-minimized',
        ],
      });
      // If the user closes the whole Chrome window, drop our handles so the next
      // request transparently relaunches with the saved login profile.
      ctx.on('close', () => {
        this.context = null;
        this.pages.clear();
        this._pageLoading.clear();
        this._contextPromise = null;
      });
      this.context = ctx;
      return ctx;
    })();
    return this._contextPromise;
  }

  // Cheap, side-effect-free lookup: returns the cached page for an adapter or
  // null. Used by /api/status so a status poll never causes a fresh tab to pop
  // open — only explicit user actions (登录 / 提问 / 新对话) trigger opens.
  getCachedPage(id) {
    const p = this.pages.get(id);
    return p && !p.isClosed() ? p : null;
  }

  // Returns a dedicated page for an adapter, creating it (and navigating to the
  // site home) on first use. Concurrent callers for the same id share a single
  // in-flight Promise — without this, two parallel callers both see an empty
  // cache, both call context.newPage(), and the site opens twice.
  async getPage(id, homeUrl) {
    await this.ensureContext();
    const cached = this.pages.get(id);
    if (cached && !cached.isClosed()) return cached;
    const inflight = this._pageLoading.get(id);
    if (inflight) return inflight;
    const promise = (async () => {
      const page = await this.context.newPage();
      this.pages.set(id, page);
      try {
        await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch {
        // Slow sites: continue anyway, adapter can wait for selectors itself.
      }
      return page;
    })().finally(() => this._pageLoading.delete(id));
    this._pageLoading.set(id, promise);
    return promise;
  }

  async bringToFront(id) {
    const page = this.pages.get(id);
    if (page && !page.isClosed()) await page.bringToFront();
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.pages.clear();
      this._pageLoading.clear();
      this._contextPromise = null;
    }
  }
}

export const browserManager = new BrowserManager();
