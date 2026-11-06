// End-to-end test: fixture sites + mock SiteVero API + the real worker process.
import { spawn } from 'node:child_process';
import { startFixtures } from './fixture-server.js';
import { startMockApi } from './mock-api.js';
import { startTlsFixtures } from './tls-fixture.js';

const SECRET = 'test-secret';
const PACKS = ['consent', 'gpc', 'accessibility', 'ai_transparency'];
const site = (domain, verified) => ({
  domain, verified, regions: ['EU-FR'], packs: PACKS,
  chat_widget_selector: null, chat_test_message: 'Hi, can you help me with my order?',
  journeys: [], ai_systems: [],
});
const scans = [
  { id: 'scan-bad', org_id: 'o', site_id: 's1', status: 'queued', trigger: 'manual', packs: PACKS, region: 'EU-FR', finding_id: null, site: site('http://localhost:8099', true) },
  { id: 'scan-good', org_id: 'o', site_id: 's2', status: 'queued', trigger: 'manual', packs: PACKS, region: 'EU-FR', finding_id: null, site: site('http://localhost:8100', true) },
  { id: 'scan-sec-bad', org_id: 'o', site_id: 's3', status: 'queued', trigger: 'manual', packs: ['security_hygiene'], region: 'EU-FR', finding_id: null, site: { ...site('https://localhost:8443', false), packs: ['security_hygiene'] } },
  { id: 'scan-sec-good', org_id: 'o', site_id: 's4', status: 'queued', trigger: 'manual', packs: ['security_hygiene'], region: 'EU-FR', finding_id: null, site: { ...site('https://localhost:8444', false), packs: ['security_hygiene'] } },
];

const stopFixtures = startFixtures(8099, 8100);
const stopTls = startTlsFixtures(8443, 8444);
const api = startMockApi({ port: 8199, secret: SECRET, scans });
const worker = spawn(process.execPath, ['src/index.js'], {
  env: { ...process.env, SCAN_IGNORE_HTTPS_ERRORS: 'true', SITEVERO_URL: 'http://localhost:8199', WORKER_SECRET: SECRET, POLL_INTERVAL_MS: '500', SETTLE_MS: '1200', CHAT_WAIT_MS: '3000', MAX_PAGES: '3', WORKER_CONCURRENCY: '2' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const logs = [];
worker.stdout.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));

const timeout = setTimeout(() => { console.error('TIMEOUT'); console.error(logs.slice(-20).join('\n')); process.exit(1); }, 240000);
const results = await api.done;
clearTimeout(timeout);
worker.kill('SIGTERM');
api.close();
stopFixtures();
stopTls();

const ids = (r) => (r.body?.findings || []).map((f) => f.rule_id).sort();
const bad = results['scan-bad'];
const good = results['scan-good'];
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

console.log('\nBAD site findings:', ids(bad));
console.log('BAD ai_systems:', JSON.stringify(bad.body?.ai_systems));
console.log('GOOD site findings:', ids(good));
console.log('GOOD ai_systems:', JSON.stringify(good.body?.ai_systems), '\n');

check(bad.status === 'completed', 'bad site scan accepted by the API (contract validation passed)');
for (const r of ['consent.tracking_before_choice', 'consent.tracking_after_reject', 'consent.withdrawal_ignored', 'consent.storage-before-consent', 'consent.banner-focus', 'gpc.ad-pixel-ignores-signal', 'a11y.image-alt', 'a11y.contrast', 'a11y.link-name', 'ai.chat.disclosure_missing', 'ai.media.label_missing'])
  check(ids(bad).includes(r), `bad site → ${r}`);
check(good.status === 'completed', 'good site scan accepted by the API');
check(!ids(good).some((r) => r.startsWith('consent.') || r.startsWith('gpc.') || r.startsWith('ai.')), 'good site → no consent, GPC or AI findings (no false positives)');
check((good.body?.ai_systems || []).some((s) => s.disclosure_status === 'pass'), 'good site → chatbot disclosure recorded as pass');
check(!ids(good).some((r) => ['a11y.image-alt', 'a11y.contrast', 'a11y.link-name'].includes(r)), 'good site → no image-alt, contrast or link-name findings');
const shots = (bad.body?.findings || []).filter((f) => f.screenshot_path);
check(shots.length > 0 && shots.every((f) => api.uploads.includes(f.screenshot_path)), `screenshots uploaded through signed upload_url links (${api.uploads.length} files)`);
check(Array.isArray(bad.body?.coverage?.scenarios) && bad.body.coverage.scenarios.some((s) => s.scenario === 'reject_reload' && s.ran), 'coverage ("What we tested") sent and lists the reject_reload scenario');
// Tracker Map
const tr = (r, host) => (r.body?.trackers || []).find((t) => t.host === host);
const ga = tr(bad, 'www.google-analytics.com');
const fb = tr(bad, 'connect.facebook.net');
check(Array.isArray(bad.body?.trackers) && bad.body.trackers.length >= 3, `tracker map sent (${bad.body?.trackers?.length} hosts on the bad site)`);
check(ga && ga.loads_before_consent && ga.category === 'analytics' && ga.vendor === 'Google Analytics' && ga.country === 'US' && ga.outside_eea === true, 'tracker map: Google Analytics flagged as loading before consent, US vendor');
check(fb && fb.loads_after_reject && fb.category === 'marketing', 'tracker map: Meta pixel flagged as loading after Reject');
check(!(good.body?.trackers || []).some((t) => t.loads_before_consent || t.loads_after_reject), 'tracker map: good site has no tracker before consent or after Reject');

// Security Hygiene
const secBad = results['scan-sec-bad'];
const secGood = results['scan-sec-good'];
console.log('\nSECURITY bad findings:', ids(secBad));
console.log('SECURITY good findings:', ids(secGood));
check(secBad.status === 'completed' && secGood.status === 'completed', 'security scans accepted by the API');
for (const r of ['security.csp_missing', 'security.hsts_missing', 'security.frame_options_missing', 'security.cookie_insecure', 'security.tls_expiring', 'security.tls_weak'])
  check(ids(secBad).includes(r), `bad HTTPS site → ${r}`);
check(ids(secGood).length === 0, 'good HTTPS site → no security findings');
const ck = secBad.body?.findings.find((f) => f.rule_id === 'security.cookie_insecure');
check(ck && ck.evidence.cookie_name === 'sessionid' && !ck.evidence.cookies.some((c) => c.cookie_name === 'theme') && !/abc123xyz789/.test(JSON.stringify(ck)), 'insecure cookie evidence: names sessionid only, value masked');
const te = secBad.body?.findings.find((f) => f.rule_id === 'security.tls_expiring');
check(te && te.evidence.days_remaining <= 10 && te.evidence.days_remaining >= 8, `certificate expiry detected (${te?.evidence.days_remaining} days remaining)`);
const tw = secBad.body?.findings.find((f) => f.rule_id === 'security.tls_weak');
check(tw && tw.evidence.protocols_accepted.join() === 'TLS 1.0,TLS 1.1', `old TLS versions detected (${tw?.evidence.protocols_accepted})`);
console.log('Tracker example:', JSON.stringify(ga));

console.log('\nCoverage summary (good site):', JSON.stringify({ pages: good.body?.coverage?.pages, scenarios: good.body?.coverage?.scenarios?.length, not_tested: good.body?.coverage?.not_tested }, null, 1));

const tb = bad.body?.findings.find((f) => f.rule_id === 'consent.tracking_after_reject');
if (tb) console.log('\nExample finding:\n' + JSON.stringify(tb, null, 2).slice(0, 2500));
console.log(`\n${failures ? failures + ' check(s) failed' : 'All checks passed'}`);
process.exit(failures ? 1 : 0);
