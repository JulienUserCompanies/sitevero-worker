// Security Hygiene pack (security_hygiene): response headers, server-set cookie flags, TLS certificate and versions.
// These are good-practice checks: a missing header is not a legal breach by itself, so severities are kept
// moderate and descriptions say so. Rule ids follow the SiteVero contract (prefix "security.").
import tls from 'node:tls';
import { newScenarioContext } from '../browser.js';
import { finding } from '../rules.js';
import { isOnSite, mask, envInt, log } from '../util.js';

const NOTE = 'Security good-practice check. On its own this is not a legal breach; it is evidence of the "appropriate technical measures" that GDPR Article 32 (and NIS2 Article 21, for organisations in scope) ask for.';
const KEEP_HEADERS = ['server', 'content-type', 'content-security-policy', 'content-security-policy-report-only', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];
const SESSION_COOKIE = /sess|sid$|^sid|auth|token|jwt|login|remember/i;

export async function runSecurity(ctx) {
  const findings = [];
  const coverage = { pages: [] };
  const pages = (ctx.pages || [ctx.url]).slice(0, envInt('SECURITY_PAGES', 3));
  const docs = new Map(); // page url -> { headers, status }
  const setCookies = []; // { url, header }

  const { context } = await newScenarioContext({ region: ctx.region });
  try {
    context.on('response', async (res) => {
      try {
        const req = res.request();
        const url = res.url();
        if (!isOnSite(url, ctx.site.domain)) return;
        const arr = await res.headersArray();
        for (const h of arr) if (h.name.toLowerCase() === 'set-cookie') for (const line of h.value.split('\n')) setCookies.push({ url, header: line });
        if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame()) {
          const headers = {};
          for (const h of arr) headers[h.name.toLowerCase()] = h.value;
          docs.set(url, { headers, status: res.status() });
        }
      } catch {}
    });
    const page = await context.newPage();
    for (const url of pages) {
      try {
        const res = await page.goto(url, { waitUntil: 'load' });
        const finalUrl = res?.url() || url;
        const meta = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content || null).catch(() => null);
        const d = docs.get(finalUrl) || docs.get(url) || { headers: {}, status: res?.status() };
        coverage.pages.push({ url: finalUrl, status: d.status });
        checkHeaders(findings, finalUrl, d.headers, meta);
      } catch (e) {
        coverage.pages.push({ url, error: String(e.message || e) });
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  checkCookies(findings, ctx.url, setCookies);

  if (ctx.url.startsWith('https://')) {
    const u = new URL(ctx.url);
    const port = Number(u.port) || 443;
    coverage.tls = await checkTls(findings, ctx.url, u.hostname, port);
  } else {
    coverage.tls = { tested: false, note: 'site not served over HTTPS' };
  }
  return { findings: mergeByRule(findings), coverage };
}

function pickHeaders(h) {
  const out = {};
  for (const k of KEEP_HEADERS) if (h[k] !== undefined) out[k] = String(h[k]).slice(0, 500);
  return out;
}

function checkHeaders(findings, url, h, metaCsp) {
  const evidence = { page_url: url, response_headers: pickHeaders(h) };
  const csp = h['content-security-policy'] || metaCsp || '';
  if (!csp) {
    findings.push(finding('security.csp_missing', {
      pack: 'security_hygiene', severity: 'moderate',
      title: 'No Content Security Policy',
      description: `The page sends no Content-Security-Policy header or meta tag${h['content-security-policy-report-only'] ? ' (only a report-only policy, which does not block anything)' : ''}. Any injected or compromised script can run and read what visitors type. ${NOTE}`,
      page_url: url, evidence,
      fix_suggestion: "Add a Content-Security-Policy header. Start in report-only mode to find what your pages load, then enforce it, e.g. default-src 'self'; script-src 'self' <your tag manager and vendors>; frame-ancestors 'self'.",
    }));
  }
  if (url.startsWith('https://')) {
    const m = /max-age=(\d+)/i.exec(h['strict-transport-security'] || '');
    if (!m || Number(m[1]) === 0) {
      findings.push(finding('security.hsts_missing', {
        pack: 'security_hygiene', severity: 'moderate',
        title: 'HTTPS not enforced with HSTS',
        description: `The page is served over HTTPS but without a Strict-Transport-Security header, so a visitor's first request can be downgraded to unencrypted HTTP on hostile networks. ${NOTE}`,
        page_url: url, evidence,
        fix_suggestion: "Send 'Strict-Transport-Security: max-age=31536000; includeSubDomains' on every HTTPS response (add 'preload' only once all subdomains support HTTPS).",
      }));
    }
  }
  if (!h['x-frame-options'] && !/frame-ancestors/i.test(h['content-security-policy'] || '')) {
    findings.push(finding('security.frame_options_missing', {
      pack: 'security_hygiene', severity: 'minor',
      title: 'Page can be framed by other sites',
      description: `Neither X-Frame-Options nor a CSP frame-ancestors directive is set, so other sites can embed this page in a hidden frame (clickjacking). ${NOTE}`,
      page_url: url, evidence,
      fix_suggestion: "Add the CSP directive frame-ancestors 'self' (or the header X-Frame-Options: SAMEORIGIN).",
    }));
  }
}

function checkCookies(findings, homepage, setCookies) {
  const seen = new Map();
  for (const { url, header } of setCookies) {
    const [pair, ...attrs] = header.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const a = attrs.map((x) => x.toLowerCase());
    if (a.some((x) => x.startsWith('max-age=0') || /expires=thu, 01 jan 1970/.test(x))) continue; // deletion
    const missing = [];
    if (url.startsWith('https://') && !a.includes('secure')) missing.push('Secure');
    if (SESSION_COOKIE.test(name) && !a.includes('httponly')) missing.push('HttpOnly'); // only where scripts should not read it
    if (!a.some((x) => x.startsWith('samesite='))) missing.push('SameSite');
    if (!missing.length || seen.has(name)) continue;
    const masked = [`${name}=${mask(value)}`, ...attrs].join('; ');
    seen.set(name, { cookie_name: name, set_cookie_header: masked, missing_flags: missing, url });
  }
  if (!seen.size) return;
  const cookies = [...seen.values()];
  const first = cookies[0];
  findings.push(finding('security.cookie_insecure', {
    pack: 'security_hygiene', severity: 'moderate',
    title: cookies.length === 1 ? 'Cookie set without Secure, HttpOnly or SameSite' : `${cookies.length} cookies set without Secure, HttpOnly or SameSite`,
    description: `Your server sets ${cookies.map((c) => `"${c.cookie_name}" (missing ${c.missing_flags.join(', ')})`).slice(0, 8).join('; ')}. HttpOnly is only checked for cookies whose name suggests a session or login. ${NOTE}`,
    page_url: homepage,
    evidence: { cookie_name: first.cookie_name, set_cookie_header: first.set_cookie_header, missing_flags: first.missing_flags, cookies },
    fix_suggestion: "Add '; Secure; SameSite=Lax' to every cookie your server sets, and '; HttpOnly' to session and login cookies that JavaScript does not need to read.",
  }));
}

function connect(host, port, opts) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 8000, ...opts }, () => {
      const out = { ok: true, protocol: sock.getProtocol(), cert: sock.getPeerCertificate() };
      sock.end();
      resolve(out);
    });
    sock.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

async function checkTls(findings, url, host, port) {
  const main = await connect(host, port, {});
  if (!main.ok) return { tested: false, note: `TLS connection failed: ${main.error}` };
  const cert = main.cert || {};
  const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
  const days = validTo ? Math.floor((validTo - Date.now()) / 86400000) : null;
  const issuer = [cert.issuer?.O, cert.issuer?.CN].filter(Boolean).join(' / ') || 'unknown';
  const result = { tested: true, protocol: main.protocol, valid_to: validTo?.toISOString(), days_remaining: days, issuer };

  if (days !== null && days < 21) {
    findings.push(finding('security.tls_expiring', {
      pack: 'security_hygiene', severity: 'serious',
      title: days < 0 ? 'TLS certificate has expired' : 'TLS certificate expires within 21 days',
      description: days < 0
        ? `The certificate expired ${-days} day${days === -1 ? '' : 's'} ago. Browsers show a security warning and many visitors cannot reach the site.`
        : `The site's certificate expires in ${days} day${days === 1 ? '' : 's'}. If it is not renewed, browsers will block the site with a security warning.`,
      page_url: url,
      evidence: { issuer, valid_to: validTo.toISOString(), days_remaining: days },
      fix_suggestion: 'Renew the certificate now and turn on automatic renewal (most hosts and Let\'s Encrypt clients support it).',
    }));
  }

  // Old protocol versions: try a handshake limited to TLS 1.0 and to TLS 1.1.
  const accepted = [];
  for (const v of ['TLSv1', 'TLSv1.1']) {
    const r = await connect(host, port, { minVersion: v, maxVersion: v, ciphers: 'DEFAULT@SECLEVEL=0' });
    if (r.ok) accepted.push(v === 'TLSv1' ? 'TLS 1.0' : 'TLS 1.1');
  }
  result.old_protocols_accepted = accepted;
  if (accepted.length) {
    findings.push(finding('security.tls_weak', {
      pack: 'security_hygiene', severity: 'serious',
      title: 'Outdated TLS version accepted',
      description: `The server still accepts ${accepted.join(' and ')}, which have known weaknesses and were deprecated in 2021 (RFC 8996). ${NOTE}`,
      page_url: url,
      evidence: { protocols_accepted: accepted, negotiated_by_default: main.protocol },
      fix_suggestion: 'Disable TLS 1.0 and 1.1 in your web server, load balancer or CDN settings, and allow only TLS 1.2 and 1.3.',
    }));
  }
  log('debug', 'tls checked', result);
  return result;
}

/** One finding per rule (the app de-duplicates on site + rule + page): keep the first page, list the others. */
function mergeByRule(findings) {
  const by = new Map();
  for (const f of findings) {
    const g = by.get(f.rule_id);
    if (!g) { by.set(f.rule_id, { ...f, evidence: { ...f.evidence, pages: [f.page_url] } }); continue; }
    if (!g.evidence.pages.includes(f.page_url)) g.evidence.pages.push(f.page_url);
  }
  return [...by.values()];
}
