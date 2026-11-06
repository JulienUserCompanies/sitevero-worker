import { chromium } from 'playwright';
import { classifyHost, classifyCookie, classifyStorageKey } from './trackers.js';
import { humanDuration, mask, truncate, sleep, envInt } from './util.js';

// Region profiles. Locale and timezone change what many consent tools show.
// Real IP geolocation needs an egress proxy per region: set PROXY_EU_FR, PROXY_DE, PROXY_UK, PROXY_US_CA
// (for example http://user:pass@host:port). Without a proxy the scan runs from the worker's own IP.
export const REGIONS = {
  'EU-FR': { locale: 'fr-FR', timezoneId: 'Europe/Paris', acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8', geolocation: { latitude: 48.8566, longitude: 2.3522 } },
  DE: { locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8', geolocation: { latitude: 52.52, longitude: 13.405 } },
  UK: { locale: 'en-GB', timezoneId: 'Europe/London', acceptLanguage: 'en-GB,en;q=0.9', geolocation: { latitude: 51.5072, longitude: -0.1276 } },
  'US-CA': { locale: 'en-US', timezoneId: 'America/Los_Angeles', acceptLanguage: 'en-US,en;q=0.9', geolocation: { latitude: 34.0522, longitude: -118.2437 } },
};

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

let browserPromise = null;
export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-default-browser-check'],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close().catch(() => {});
  }
}

/**
 * Fresh, isolated browser profile for one scenario.
 * @param {object} opts { region, gpc: boolean }
 */
export async function newScenarioContext({ region = 'EU-FR', gpc = false } = {}) {
  const browser = await getBrowser();
  const profile = REGIONS[region] || REGIONS['EU-FR'];
  const proxyServer = process.env[`PROXY_${region.replace('-', '_')}`];
  const headers = { 'Accept-Language': profile.acceptLanguage };
  if (gpc) headers['Sec-GPC'] = '1';

  const context = await browser.newContext({
    userAgent: process.env.SCAN_USER_AGENT || DEFAULT_UA,
    locale: profile.locale,
    timezoneId: profile.timezoneId,
    geolocation: profile.geolocation,
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: headers,
    // Only for local test fixtures with self-signed certificates. Never set in production.
    ignoreHTTPSErrors: process.env.SCAN_IGNORE_HTTPS_ERRORS === 'true',
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
  });
  if (gpc) {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
    });
  }
  context.setDefaultNavigationTimeout(envInt('NAV_TIMEOUT_MS', 45000));
  context.setDefaultTimeout(15000);
  const recorder = new Recorder(context);
  return { context, recorder, region, proxied: Boolean(proxyServer) };
}

/** Records every network request a context makes, with timestamps. */
export class Recorder {
  constructor(context) {
    this.context = context;
    this.requests = [];
    this.markIndex = 0;
    context.on('request', (req) => {
      let u;
      try {
        u = new URL(req.url());
      } catch {
        return;
      }
      if (!/^https?:$/.test(u.protocol)) return;
      let pageUrl = null;
      try { pageUrl = req.frame().page()?.url() || null; } catch {}
      this.requests.push({
        at: new Date().toISOString(),
        page: pageUrl,
        host: u.hostname,
        path: truncate(u.pathname + u.search, 200),
        type: mapType(req.resourceType()),
        url: req.url(),
      });
    });
  }
  /** Start a new observation window (e.g. after reload). */
  mark() {
    this.markIndex = this.requests.length;
  }
  since() {
    return this.requests.slice(this.markIndex);
  }
  /** Known tracker requests in the current window, filtered by category set. */
  trackerHits(categories) {
    const hits = [];
    for (const r of this.since()) {
      const c = classifyHost(r.host, r.path);
      if (c && categories.has(c.category)) hits.push({ ...r, vendor: c.vendor, category: c.category });
    }
    return hits;
  }
}

function mapType(t) {
  if (t === 'script') return 'script';
  if (t === 'image') return 'image';
  if (t === 'xhr' || t === 'fetch') return 'xhr';
  if (t === 'ping' || t === 'beacon') return 'beacon';
  if (t === 'document') return 'document';
  if (t === 'stylesheet' || t === 'font') return 'asset';
  return t;
}

export async function trackingCookies(context, categories) {
  const cookies = await context.cookies();
  const out = [];
  for (const c of cookies) {
    const cls = classifyCookie(c.name) || (classifyHost(c.domain.replace(/^\./, '')) ?? null);
    if (cls && categories.has(cls.category)) {
      out.push({
        name: c.name,
        domain: c.domain,
        set_at: new Date().toISOString(),
        expires: humanDuration(c.expires),
        value: mask(c.value),
        vendor: cls.vendor,
        category: cls.category,
      });
    }
  }
  return out;
}

export async function trackingStorage(page, categories) {
  let keys = [];
  try {
    keys = await page.evaluate(() => {
      const ks = [];
      try {
        for (let i = 0; i < localStorage.length; i++) ks.push(['local', localStorage.key(i)]);
      } catch {}
      try {
        for (let i = 0; i < sessionStorage.length; i++) ks.push(['session', sessionStorage.key(i)]);
      } catch {}
      return ks;
    });
  } catch {
    return [];
  }
  const out = [];
  for (const [area, key] of keys) {
    const cls = classifyStorageKey(key);
    if (cls && categories.has(cls.category)) {
      out.push({ key, area, set_at: new Date().toISOString(), vendor: cls.vendor, category: cls.category });
    }
  }
  return out;
}

/** Load a page and give tags time to fire (including scroll-triggered ones). */
export async function loadAndSettle(page, url, settleMs = envInt('SETTLE_MS', 4000)) {
  await page.goto(url, { waitUntil: 'load' });
  await settle(page, settleMs);
}

export async function settle(page, settleMs = envInt('SETTLE_MS', 4000)) {
  await page.waitForLoadState('networkidle', { timeout: settleMs + 4000 }).catch(() => {});
  await page.mouse.wheel(0, 600).catch(() => {});
  await sleep(settleMs);
}

export async function screenshot(page) {
  try {
    return await page.screenshot({ type: 'png', fullPage: false });
  } catch {
    return null;
  }
}
