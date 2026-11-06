// HTTPS test sites for the Security Hygiene pack.
//   BAD  (8443): certificate expires in 10 days, accepts TLS 1.0, no security headers, insecure session cookie.
//   GOOD (8444): 90-day certificate, TLS 1.2+ only, CSP + HSTS + frame protection, cookie with all flags.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function makeCert(dir, name, days) {
  const key = path.join(dir, `${name}.key`);
  const crt = path.join(dir, `${name}.crt`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', String(days), '-subj', '/CN=localhost/O=SiteVero Test CA', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

const PAGE = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><header><nav><a href="/about">About us</a></nav></header><main><h1>${title}</h1><p>Test page.</p></main></body></html>`;

export function startTlsFixtures(badPort = 8443, goodPort = 8444) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tls-'));
  const badCert = makeCert(dir, 'bad', 10);
  const goodCert = makeCert(dir, 'good', 90);

  const bad = https.createServer({ ...badCert, minVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' }, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': ['sessionid=abc123xyz789; Path=/', 'theme=dark; Path=/; Secure; SameSite=Lax'] });
    res.end(PAGE('Bad security'));
  }).listen(badPort);

  const good = https.createServer({ ...goodCert, minVersion: 'TLSv1.2' }, (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-frame-options': 'SAMEORIGIN',
      'set-cookie': 'sessionid=abc123xyz789; Path=/; Secure; HttpOnly; SameSite=Lax',
    });
    res.end(PAGE('Good security'));
  }).listen(goodPort);

  return () => { bad.close(); good.close(); fs.rmSync(dir, { recursive: true, force: true }); };
}
