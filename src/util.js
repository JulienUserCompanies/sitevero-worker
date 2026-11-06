export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(level, msg, extra) {
  const line = { t: new Date().toISOString(), level, msg, ...(extra || {}) };
  // One JSON object per line: easy to read in Cloud Run / Railway logs.
  // stderr keeps stdout clean for the CLI JSON output; container platforms collect both.
  console.error(JSON.stringify(line));
}

export function envInt(name, fallback) {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

export function normaliseDomain(domain) {
  return String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./i, '')
    .toLowerCase();
}

/** True if `url` is on the site's domain or one of its subdomains. */
export function isOnSite(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const d = normaliseDomain(domain);
    return host === d || host.endsWith('.' + d);
  } catch {
    return false;
  }
}

export function homepageUrl(domain) {
  const d = String(domain || '').trim();
  if (/^https?:\/\//i.test(d)) return d;
  return `https://${d}/`;
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Keep the first and last characters of a value so it can be matched, never stored in full. */
export function mask(value) {
  const s = String(value ?? '');
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}…${s.slice(-2)} (${s.length} chars)`;
}

export function humanDuration(expiresEpochSeconds) {
  if (!expiresEpochSeconds || expiresEpochSeconds < 0) return 'session';
  const days = Math.round((expiresEpochSeconds * 1000 - Date.now()) / 86400000);
  if (days <= 0) return 'less than a day';
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
