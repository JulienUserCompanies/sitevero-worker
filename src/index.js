// Worker loop: claim → scan → complete / fail.
import http from 'node:http';
import { api } from './api.js';
import { runScan } from './scan.js';
import { makeShotSaver } from './storage.js';
import { loadOverrides } from './rules.js';
import { closeBrowser } from './browser.js';
import { log, sleep, envInt } from './util.js';

const POLL_MS = envInt('POLL_INTERVAL_MS', 15000);
const CONCURRENCY = Math.min(Math.max(envInt('WORKER_CONCURRENCY', 1), 1), 10);
const SCAN_TIMEOUT_MS = envInt('SCAN_TIMEOUT_MS', 12 * 60 * 1000); // below the app's 15-minute stale limit
const HEARTBEAT_MS = envInt('HEARTBEAT_MS', 60000);
const SEND_COVERAGE = process.env.SEND_COVERAGE !== 'false'; // the app accepts "coverage" since the Oct 2026 contract update
const RUN_ONCE = process.env.RUN_ONCE === 'true';

let stopping = false;
let active = 0;

async function processScan(scan) {
  const hb = setInterval(() => api.heartbeat(scan.id), HEARTBEAT_MS);
  const started = Date.now();
  try {
    log('info', 'scan start', { scan_id: scan.id, domain: scan.site?.domain, packs: scan.packs, trigger: scan.trigger });
    const result = await Promise.race([
      runScan(scan, makeShotSaver(scan.id)),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`Scan exceeded ${Math.round(SCAN_TIMEOUT_MS / 60000)} minutes`)), SCAN_TIMEOUT_MS)),
    ]);
    const payload = { scan_id: scan.id, findings: result.findings };
    if (result.ai_systems.length) payload.ai_systems = result.ai_systems;
    if (result.trackers?.length) payload.trackers = result.trackers;
    if (SEND_COVERAGE) payload.coverage = result.coverage;
    await api.complete(payload);
    log('info', 'scan complete', { scan_id: scan.id, findings: result.findings.length, ai_systems: result.ai_systems.length, trackers: result.trackers?.length || 0, ms: Date.now() - started, coverage: result.coverage });
  } catch (e) {
    log('error', 'scan failed', { scan_id: scan.id, error: String(e.message || e) });
    await api.fail(scan.id, e.message || e).catch((err) => log('error', 'could not report failure', { error: String(err) }));
  } finally {
    clearInterval(hb);
  }
}

async function loop() {
  log('info', 'worker started', { concurrency: CONCURRENCY, poll_ms: POLL_MS, run_once: RUN_ONCE });
  while (!stopping) {
    const free = CONCURRENCY - active;
    if (free > 0) {
      try {
        const res = await api.claim(free);
        loadOverrides(res);
        for (const scan of res?.scans || []) {
          active++;
          processScan(scan).finally(() => active--);
        }
        if (!res?.scans?.length) {
          // RUN_ONCE: process everything queued, then exit (Cloud Run Jobs, cron, GitHub Actions).
          if (RUN_ONCE) { stopping = true; continue; }
          await sleep(POLL_MS);
        } else await sleep(1000);
      } catch (e) {
        log('error', 'claim failed', { error: String(e.message || e) });
        if (RUN_ONCE) { process.exitCode = 1; stopping = true; continue; }
        await sleep(POLL_MS);
      }
    } else {
      await sleep(2000);
    }
  }
  while (active > 0) await sleep(1000);
  await closeBrowser();
  log('info', 'worker stopped');
  process.exit(process.exitCode || 0);
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log('info', 'shutdown requested; finishing running scans', { active });
    stopping = true;
  });
}

// Health endpoint for platforms that expect an HTTP port (Cloud Run services, Railway).
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, active, stopping }));
    })
    .listen(Number(process.env.PORT));
}

loop();
