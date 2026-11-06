// Mock of SiteVero's /api/public/worker, enforcing the validation rules from the contract.
import http from 'node:http';

const SEVERITY = new Set(['critical', 'serious', 'moderate', 'minor']);
const FIX = new Set(['code', 'tag_manager', 'consent_tool', 'content', null]);
const PACKS = new Set(['consent', 'gpc', 'accessibility', 'ai_transparency', 'security_hygiene']);
const AI_TYPES = new Set(['chatbot', 'voice_agent', 'generated_media', 'other']);
const DISCLOSURE = new Set(['pass', 'fail', 'unchecked']);

function onDomain(url, domain) {
  try {
    const h = new URL(url).hostname;
    return h === domain || h.endsWith('.' + domain);
  } catch { return false; }
}

export function validateComplete(body, scan) {
  const errs = [];
  if (scan.status !== 'running') errs.push('scan not running');
  if (!Array.isArray(body.findings)) errs.push('findings must be an array');
  for (const [i, f] of (body.findings || []).entries()) {
    const at = `findings[${i}]`;
    if (!PACKS.has(f.pack)) errs.push(`${at}.pack invalid`);
    if (!scan.packs.includes(f.pack)) errs.push(`${at}.pack not requested`);
    if (typeof f.rule_id !== 'string' || f.rule_id.length < 1 || f.rule_id.length > 200) errs.push(`${at}.rule_id length`);
    if (!SEVERITY.has(f.severity)) errs.push(`${at}.severity`);
    if (typeof f.title !== 'string' || f.title.length < 1 || f.title.length > 500) errs.push(`${at}.title length`);
    if (typeof f.description !== 'string' || f.description.length > 20000) errs.push(`${at}.description`);
    if (!Array.isArray(f.law_refs) || f.law_refs.some((x) => typeof x !== 'string')) errs.push(`${at}.law_refs`);
    if (f.page_url && !/^https?:\/\//.test(f.page_url)) errs.push(`${at}.page_url`);
    if (typeof f.evidence !== 'object' || f.evidence === null) errs.push(`${at}.evidence`);
    if (!FIX.has(f.fix_type ?? null)) errs.push(`${at}.fix_type`);
    if (f.status !== 'open') errs.push(`${at}.status`);
  }
  if (body.ai_systems) {
    if (!scan.packs.includes('ai_transparency')) errs.push('ai_systems without ai_transparency pack');
    for (const [i, s] of body.ai_systems.entries()) {
      if (!AI_TYPES.has(s.type)) errs.push(`ai_systems[${i}].type`);
      if (typeof s.name !== 'string' || !s.name.length || s.name.length > 200) errs.push(`ai_systems[${i}].name`);
      if (typeof s.vendor !== 'string' || s.vendor.length > 200) errs.push(`ai_systems[${i}].vendor`);
      if (!onDomain(s.page_url, scan.site.domain.replace(/^https?:\/\//, '').replace(/[:/].*$/, ''))) errs.push(`ai_systems[${i}].page_url off-domain`);
      if (!DISCLOSURE.has(s.disclosure_status)) errs.push(`ai_systems[${i}].disclosure_status`);
    }
  }
  // Contract update (Oct 2026): rule ids must start with their pack's prefix; optional coverage object.
  const PREFIX = { consent: 'consent.', gpc: 'gpc.', accessibility: 'a11y.', ai_transparency: 'ai.', security_hygiene: 'security.' };
  for (const [i, f] of (body.findings || []).entries()) if (!String(f.rule_id).startsWith(PREFIX[f.pack])) errs.push(`findings[${i}].rule_id "${f.rule_id}" does not match pack prefix`);
  if (body.coverage !== undefined) {
    const c = body.coverage;
    if (typeof c !== 'object' || c === null) errs.push('coverage must be an object');
    else {
      if (!Array.isArray(c.pages)) errs.push('coverage.pages must be an array');
      if (!Array.isArray(c.scenarios)) errs.push('coverage.scenarios must be an array');
      if (!Array.isArray(c.not_tested) || c.not_tested.some((n) => !n.item || !n.reason)) errs.push('coverage.not_tested items need item and reason');
    }
  }
  // Tracker Map schema (contract additions, Nov 2026)
  if (body.trackers !== undefined) {
    if (!Array.isArray(body.trackers) || body.trackers.length > 1000) errs.push('trackers must be an array of at most 1000');
    const CAT = new Set(['essential', 'functional', 'analytics', 'marketing', 'unknown']);
    const RT = new Set(['script', 'pixel', 'iframe', 'xhr', 'cookie', 'other']);
    for (const [i, t] of (body.trackers || []).entries()) {
      const at = `trackers[${i}]`;
      if (typeof t.host !== 'string' || !t.host.length || t.host.length > 253 || !/^[a-z0-9.-]+$/i.test(t.host)) errs.push(`${at}.host`);
      if (t.vendor !== undefined && (typeof t.vendor !== 'string' || t.vendor.length > 200)) errs.push(`${at}.vendor`);
      if (t.category !== undefined && !CAT.has(t.category)) errs.push(`${at}.category`);
      if (t.resource_type !== undefined && !RT.has(t.resource_type)) errs.push(`${at}.resource_type`);
      if (t.country !== undefined && t.country !== null && !/^[A-Z]{2}$/i.test(t.country)) errs.push(`${at}.country`);
      if (t.outside_eea !== undefined && t.outside_eea !== null && typeof t.outside_eea !== 'boolean') errs.push(`${at}.outside_eea`);
      for (const k of ['loads_before_consent', 'loads_after_reject', 'sets_cookies']) if (t[k] !== undefined && typeof t[k] !== 'boolean') errs.push(`${at}.${k}`);
      if (t.example_url !== undefined && t.example_url !== null && (typeof t.example_url !== 'string' || t.example_url.length > 2048 || !/^https?:\/\//.test(t.example_url))) errs.push(`${at}.example_url`);
      if (t.pages_seen !== undefined && (!Number.isInteger(t.pages_seen) || t.pages_seen < 1 || t.pages_seen > 100000)) errs.push(`${at}.pages_seen`);
    }
  }
  const allowed = new Set(['action', 'scan_id', 'findings', 'ai_systems', 'coverage', 'trackers']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) errs.push(`unexpected top-level field "${k}"`);
  return errs;
}

export function startMockApi({ port, secret, scans }) {
  const queue = [...scans];
  const results = {};
  let resolveAll;
  const done = new Promise((r) => (resolveAll = r));
  const finish = () => { if (Object.keys(results).length === scans.length) resolveAll(results); };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'PUT' && req.url.startsWith('/upload/')) {
        uploads.push(decodeURIComponent(req.url.slice(8).split('?')[0]));
        return send(200, { Key: 'evidence/' + req.url.slice(8) });
      }
      if (req.url !== '/api/public/worker' || req.method !== 'POST') return send(404, { error: 'not found' });
      if (req.headers['x-worker-secret'] !== secret) return send(401, { error: 'unauthorized' });
      const body = JSON.parse(raw || '{}');
      if (body.action === 'claim') {
        const n = Math.min(Math.max(body.limit || 1, 1), 10);
        const out = queue.splice(0, n).map((s) => ({ ...s, status: 'running', started_at: new Date().toISOString() }));
        out.forEach((s) => (results[s.id] = { scan: s }));
        // keep results keyed only when completed/failed
        out.forEach((s) => delete results[s.id]);
        out.forEach((s) => (running[s.id] = s));
        return send(200, { scans: out, ai_rules: [], consent_rules: [], consent_scenarios: [] });
      }
      if (body.action === 'heartbeat') return running[body.scan_id] ? send(200, { ok: true }) : send(404, { error: 'unknown scan' });
      if (body.action === 'upload_url') {
        if (!running[body.scan_id]) return send(409, { error: 'scan not running' });
        if (!body.name || /\.\.|\//.test(body.name)) return send(400, { error: 'unsafe name' });
        const path = `scans/${body.scan_id}/${body.name}`;
        return send(200, { signed_url: `http://localhost:${port}/upload/${encodeURIComponent(path)}?token=t`, path });
      }
      if (body.action === 'complete') {
        const scan = running[body.scan_id];
        if (!scan) return send(404, { error: 'unknown scan' });
        const errs = validateComplete(body, scan);
        if (errs.length) return send(422, { error: 'validation failed', details: errs });
        delete running[body.scan_id];
        results[body.scan_id] = { status: 'completed', body };
        send(200, { ok: true });
        return finish();
      }
      if (body.action === 'fail') {
        delete running[body.scan_id];
        results[body.scan_id] = { status: 'failed', error: body.error };
        send(200, { ok: true });
        return finish();
      }
      send(400, { error: 'unknown action' });
    });
  });
  const running = {};
  const uploads = [];
  server.listen(port);
  return { done, uploads, close: () => server.close() };
}
