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
  }

  async ensureContext() {
    if (this.context) return this.context;
    const userDataDir = path.join(__dirname, '.browser-profile');
    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // must be visible so the user can log in manually
      channel: 'chrome', // use the system-installed Google Chrome (no download, less bot-detection)
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
    });
    // If the user closes the whole Chrome window, drop our handles so the next
    // request transparently relaunches with the saved login profile.
    this.context.on('close', () => {
      this.context = null;
      this.pages.clear();
    });
    return this.context;
  }

  // Returns a dedicated page for an adapter, creating it (and navigating to the
  // site home) on first use.
  async getPage(id, homeUrl) {
    await this.ensureContext();
    let page = this.pages.get(id);
    if (page && !page.isClosed()) return page;

    page = await this.context.newPage();
    this.pages.set(id, page);
    try {
      await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
      // Slow sites: continue anyway, adapter can wait for selectors itself.
    }
    return page;
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
    }
  }
}

export const browserManager = new BrowserManager();
