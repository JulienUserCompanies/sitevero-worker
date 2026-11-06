import { newScenarioContext, loadAndSettle } from './browser.js';
import { isOnSite } from './util.js';

const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)|\/(logout|log-out|signout|sign-out|cart\/add|wp-admin|wp-login)/i;

/**
 * Collect internal pages from the homepage: navigation links first, then other links,
 * one URL per path, same domain only. Journeys' start URLs are added by the caller.
 */
export async function discoverPages(url, domain, region, max) {
  if (max <= 1) return [url];
  const { context } = await newScenarioContext({ region });
  try {
    const page = await context.newPage();
    await loadAndSettle(page, url, 1500);
    const links = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const inNav = Boolean(a.closest('nav, header, [role="navigation"], footer'));
        out.push({ href: a.href, inNav });
      }
      return out;
    });
    const seen = new Set([normalise(url)]);
    const nav = [];
    const rest = [];
    for (const l of links) {
      if (!/^https?:/i.test(l.href) || SKIP.test(l.href) || !isOnSite(l.href, domain)) continue;
      const n = normalise(l.href);
      if (seen.has(n)) continue;
      seen.add(n);
      (l.inNav ? nav : rest).push(n);
    }
    const byDepth = (a, b) => new URL(a).pathname.split('/').length - new URL(b).pathname.split('/').length;
    return [url, ...nav.sort(byDepth), ...rest.sort(byDepth)].slice(0, max);
  } catch {
    return [url];
  } finally {
    await context.close().catch(() => {});
  }
}

function normalise(href) {
  const u = new URL(href);
  u.hash = '';
  // Drop tracking parameters so the same page is not scanned twice.
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}
