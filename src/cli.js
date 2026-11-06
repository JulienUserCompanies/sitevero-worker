// Run a scan locally without the SiteVero API and print the `complete` payload.
//   node src/cli.js example.com --packs consent,gpc,accessibility,ai_transparency --region EU-FR --verified --out ./out
// Only scan sites you own or are authorised to test. Unverified mode (default) is homepage-only and sends no chat messages.
import { runScan } from './scan.js';
import { makeShotSaver } from './storage.js';
import { closeBrowser } from './browser.js';

const args = process.argv.slice(2);
const domain = args.find((a) => !a.startsWith('--'));
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
if (!domain) {
  console.error('Usage: node src/cli.js <domain> [--packs consent,gpc,accessibility,ai_transparency] [--region EU-FR] [--verified] [--chat-selector "<css>"] [--out ./out]');
  process.exit(1);
}
const packs = opt('packs', 'consent,gpc,accessibility,ai_transparency,security_hygiene').split(',');
const out = opt('out', null);
const scan = {
  id: `local-${Date.now()}`,
  packs,
  region: opt('region', 'EU-FR'),
  trigger: 'manual',
  site: {
    domain,
    verified: args.includes('--verified'),
    packs,
    regions: [opt('region', 'EU-FR')],
    chat_widget_selector: opt('chat-selector', null),
    chat_test_message: opt('chat-message', 'Hi, can you help me with my order?'),
    journeys: [],
    ai_systems: [],
  },
};

try {
  const result = await runScan(scan, makeShotSaver(scan.id, { localDir: out || undefined }));
  const payload = { action: 'complete', scan_id: scan.id, findings: result.findings };
  if (result.ai_systems.length) payload.ai_systems = result.ai_systems;
  if (result.trackers.length) payload.trackers = result.trackers;
  console.log(JSON.stringify({ payload, coverage: result.coverage }, null, 2));
  if (out) {
    const fs = await import('node:fs/promises');
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(`${out}/${scan.id}.json`, JSON.stringify({ payload, coverage: result.coverage }, null, 2));
  }
} finally {
  await closeBrowser();
}
