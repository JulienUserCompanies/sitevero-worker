// Uploads evidence screenshots to the private `evidence` bucket.
// Preferred: the `upload_url` worker action returns a signed upload link, so the worker never holds
// a database key. Fallback (deprecated): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
import { api } from './api.js';
import { log } from './util.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function makeShotSaver(scanId, { localDir } = {}) {
  let signedUploadsWork = true;
  return async function saveShot(name, buffer) {
    if (!buffer) return null;
    const file = `${name.replace(/[^a-z0-9_.-]/gi, '_')}_${Math.floor(Date.now() / 1000)}.png`;
    const path = `scans/${scanId}/${file}`;

    if (localDir) {
      const fs = await import('node:fs/promises');
      const full = `${localDir}/${path}`;
      await fs.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      await fs.writeFile(full, buffer);
      return path;
    }

    if (signedUploadsWork && process.env.SITEVERO_URL) {
      try {
        const res = await api.uploadUrl(scanId, file);
        const url = res?.signed_url || res?.signedUrl || res?.upload_url || res?.url;
        if (!url) throw new Error(`no upload URL in response: ${JSON.stringify(res).slice(0, 200)}`);
        const put = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-upsert': 'true' }, body: buffer });
        if (!put.ok) throw new Error(`upload HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
        return res?.path || path;
      } catch (e) {
        if (e.status === 400 || e.status === 404) signedUploadsWork = false; // action not available on this app version
        log('warn', 'signed screenshot upload failed', { error: String(e.message || e) });
      }
    }

    if (SUPABASE_URL && KEY) {
      try {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/evidence/${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${KEY}`, apikey: KEY, 'content-type': 'image/png', 'x-upsert': 'true' },
          body: buffer,
        });
        if (res.ok) return path;
        log('warn', 'screenshot upload failed', { status: res.status });
      } catch (e) {
        log('warn', 'screenshot upload error', { error: String(e) });
      }
    }
    return null; // screenshots are optional evidence; the finding is still reported
  };
}
