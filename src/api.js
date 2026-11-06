// Client for SiteVero's POST /api/public/worker contract.
import { log } from './util.js';

const BASE = (process.env.SITEVERO_URL || '').replace(/\/$/, '');
const SECRET = process.env.WORKER_SECRET || '';

async function call(body, { retries = 2 } = {}) {
  if (!BASE || !SECRET) throw new Error('SITEVERO_URL and WORKER_SECRET must be set');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/public/worker`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': SECRET },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (res.ok) return json;
      // 4xx: our payload is wrong or the job is gone; retrying will not help.
      if (res.status >= 400 && res.status < 500) {
        const err = new Error(`worker API ${body.action} → ${res.status}: ${text.slice(0, 2000)}`);
        err.status = res.status;
        throw err;
      }
      lastErr = new Error(`worker API ${body.action} → ${res.status}: ${text.slice(0, 200)}`);
    } catch (e) {
      if (e.status) throw e;
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw lastErr;
}

export const api = {
  claim: (limit = 1) => call({ action: 'claim', limit }),
  complete: (payload) => call({ action: 'complete', ...payload }),
  uploadUrl: (scan_id, name) => call({ action: 'upload_url', scan_id, name }, { retries: 1 }),
  fail: (scan_id, error) => call({ action: 'fail', scan_id, error: String(error).slice(0, 1000) }),
  heartbeat: (scan_id) =>
    call({ action: 'heartbeat', scan_id }, { retries: 0 }).catch((e) => {
      // The contract lists heartbeat as optional; a 4xx here just means it is not implemented yet.
      log('debug', 'heartbeat not accepted', { scan_id, error: String(e.message || e) });
    }),
};
