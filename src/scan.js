// Runs one claimed scan: page discovery, then each requested rule pack.
import { runConsent } from './packs/consent.js';
import { runGpc } from './packs/gpc.js';
import { runAccessibility } from './packs/accessibility.js';
import { runAi } from './packs/ai.js';
import { runSecurity } from './packs/security.js';
import { makeCollector } from './collector.js';
import { discoverPages } from './pages.js';
import { homepageUrl, isOnSite, envInt, log } from './util.js';

/**
 * @param {object} scan  one item from claim().scans
 * @param {function} saveShot (name, buffer) => storage path | null
 * @returns {Promise<{findings: object[], ai_systems: object[], coverage: object}>}
 */
export async function runScan(scan, saveShot) {
  const site = scan.site || {};
  const packs = new Set(scan.packs || site.packs || []);
  const region = scan.region || site.regions?.[0] || 'EU-FR';
  const verified = site.verified === true;
  const url = homepageUrl(site.domain);
  const started = Date.now();

  // Unverified sites get a light, homepage-only scan: no journeys, no chat messages.
  const maxPages = verified ? envInt('MAX_PAGES', 10) : 1;
  let pages = await discoverPages(url, site.domain, region, maxPages);
  if (verified) {
    for (const j of site.journeys || []) {
      if (j.start_url && isOnSite(j.start_url, site.domain) && !pages.includes(j.start_url)) pages.push(j.start_url);
    }
  }
  const extraPages = pages.slice(1, 3);
  const collector = makeCollector(site.domain);
  const ctx = { url, site, region, verified, pages, extraPages, saveShot, observe: collector.observe };

  const findings = [];
  let ai_systems = [];
  const coverage = { region, verified, pages, packs: {} };

  const steps = [
    ['consent', runConsent],
    ['gpc', runGpc],
    ['accessibility', runAccessibility],
    ['ai_transparency', runAi],
    ['security_hygiene', runSecurity],
  ];
  for (const [name, fn] of steps) {
    if (!packs.has(name)) continue;
    const t = Date.now();
    log('info', 'pack start', { scan_id: scan.id, pack: name });
    const res = await fn(ctx);
    findings.push(...res.findings);
    if (res.aiSystems) ai_systems = res.aiSystems;
    coverage.packs[name] = { ...res.coverage, findings: res.findings.length, ms: Date.now() - t };
  }

  // Contract rules: every finding's pack must be requested; AI systems only with the AI pack, on the site's domain.
  const clean = findings.filter((f) => packs.has(f.pack) && (!f.page_url || isOnSite(f.page_url, site.domain)));
  if (!packs.has('ai_transparency')) ai_systems = [];
  ai_systems = ai_systems.filter((s) => isOnSite(s.page_url, site.domain));

  coverage.duration_ms = Date.now() - started;
  // Tracker Map: only meaningful when we observed traffic (consent, GPC, accessibility or AI packs ran).
  const trackers = collector.trackers();
  return { findings: clean, ai_systems, trackers, coverage: summariseCoverage(coverage, packs, verified, region) };
}

/**
 * The `coverage` object sent with `complete` ("What we tested"):
 *   pages:      URLs tested
 *   scenarios:  [{ pack, scenario, ran, note? }]
 *   not_tested: [{ pack, item, reason }]
 *   details:    raw per-pack data for debugging
 */
function summariseCoverage(c, packs, verified, region) {
  const scenarios = [];
  const not_tested = [];
  const add = (pack, scenario, info = {}) => {
    const ran = info.ran !== false && !info.error;
    const note = info.error || info.note;
    scenarios.push({ pack, scenario, ran, ...(note ? { note: String(note).slice(0, 300) } : {}) });
    if (!ran) not_tested.push({ pack, item: scenario, reason: String(note || 'not run').slice(0, 300) });
  };

  const consent = c.packs.consent?.scenarios || {};
  for (const s of ['no_interaction', 'reject_reload', 'accept_all', 'accept_withdraw']) if (packs.has('consent')) add('consent', s, consent[s] || { ran: false, note: 'not reached' });
  if (consent.no_interaction?.keyboard?.tested === false) not_tested.push({ pack: 'consent', item: 'banner keyboard test', reason: consent.no_interaction.keyboard.note });
  if (packs.has('gpc')) add('gpc', 'gpc_on', c.packs.gpc?.gpc_on || { ran: false, note: 'not reached' });
  for (const p of c.packs.accessibility?.pages || []) add('accessibility', `axe WCAG 2.2 A/AA: ${p.url}`, p.error ? { error: p.error } : {});
  for (const ch of c.packs.ai_transparency?.chat || []) {
    if (ch.error) add('ai_transparency', `chat check: ${ch.page}`, { error: ch.error });
    else if (!ch.detected) add('ai_transparency', `chat detection: ${ch.page}`, { note: 'no chat widget detected' });
    else if (ch.tested === false) add('ai_transparency', `chat conversation: ${ch.page}`, { ran: false, note: ch.note });
    else add('ai_transparency', `chat conversation: ${ch.page}`, ch.status === 'unchecked' ? { note: 'no automatic reply received; may be human live chat' } : {});
  }
  for (const m of c.packs.ai_transparency?.media || []) add('ai_transparency', `image provenance: ${m.page}`, m.error ? { error: m.error } : {});
  if (packs.has('security_hygiene')) {
    const s = c.packs.security_hygiene || {};
    for (const p of s.pages || []) add('security_hygiene', `response headers and cookies: ${p.url}`, p.error ? { error: p.error } : {});
    add('security_hygiene', 'TLS certificate and protocol versions', s.tls?.tested === false ? { ran: false, note: s.tls.note } : s.tls ? {} : { ran: false, note: 'not reached' });
  }

  if (!verified) {
    not_tested.push({ pack: 'all', item: 'pages beyond the homepage and journeys', reason: 'domain not verified' });
    if (packs.has('ai_transparency')) not_tested.push({ pack: 'ai_transparency', item: 'sending a test chat message', reason: 'domain not verified' });
  }
  // Where the visit really came from: a regional proxy, or the worker's own hosting location
  // (set WORKER_LOCATION to the hosting country, e.g. NL for Railway "EU West (Amsterdam)").
  const EEA = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO'];
  const where = (process.env.WORKER_LOCATION || '').toUpperCase();
  const euRegion = region === 'EU-FR' || region === 'DE';
  if (process.env[`PROXY_${region.replace('-', '_')}`]) {
    // real regional IP address: nothing to report
  } else if (euRegion && EEA.includes(where)) {
    scenarios.push({ pack: 'all', scenario: `visit from an EU IP address (worker hosted in ${where})`, ran: true, note: 'consent tools that geolocate visitors treat this as an EU visit; country-specific behaviour may differ' });
  } else {
    not_tested.push({ pack: 'all', item: `visit from an IP address in ${region}`, reason: where ? `worker hosted in ${where}; language, time zone and location settings were emulated` : 'no regional proxy configured; language, time zone and location settings were emulated' });
  }
  return {
    region, verified, duration_ms: c.duration_ms,
    // Keys used in the app's contract example:
    pages_tested: c.pages,
    scenarios_run: scenarios.filter((s) => s.ran).map((s) => s.scenario),
    not_tested,
    // Richer detail (stored as-is by the app):
    pages: c.pages, scenarios, details: c.packs,
  };
}
