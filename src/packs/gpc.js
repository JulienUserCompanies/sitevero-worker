import { newScenarioContext, loadAndSettle, settle, trackingCookies, screenshot } from '../browser.js';
import { SALE_SHARE_CATEGORIES } from '../trackers.js';
import { finding } from '../rules.js';
import { uniqBy, log } from '../util.js';

/**
 * GPC scenario: a California visitor whose browser sends Sec-GPC: 1 and exposes
 * navigator.globalPrivacyControl = true. Under CCPA this is a valid opt-out of sale/sharing,
 * so advertising and social pixels must not receive data. Analytics alone is not flagged.
 */
export async function runGpc(ctx) {
  const findings = [];
  const coverage = {};
  const { context, recorder, proxied } = await newScenarioContext({ region: 'US-CA', gpc: true });
  try {
    const page = await context.newPage();
    await loadAndSettle(page, ctx.url);
    for (const u of (ctx.extraPages || []).slice(0, 2)) {
      await page.goto(u, { waitUntil: 'load' }).catch(() => {});
      await settle(page, 2500);
    }
    const signalSeen = await page.evaluate(() => navigator.globalPrivacyControl === true).catch(() => null);
    const hits = recorder.trackerHits(SALE_SHARE_CATEGORIES);
    const cookies = await trackingCookies(context, SALE_SHARE_CATEGORIES);
    await ctx.observe?.('other', recorder.requests, context);
    const shot = await ctx.saveShot('gpc_on', await screenshot(page));
    coverage.gpc_on = { ran: true, region: 'US-CA', egress_proxy: proxied, signal_exposed: signalSeen, sale_share_requests: hits.length, sale_share_cookies: cookies.length };

    if (hits.length || cookies.length) {
      const vendors = [...new Set([...hits, ...cookies].map((h) => h.vendor))];
      findings.push(
        finding('gpc.ad-pixel-ignores-signal', {
          title: 'Advertising pixels ignore the Global Privacy Control opt-out',
          description:
            `A visitor from California with Global Privacy Control switched on (Sec-GPC: 1) loaded the site. ` +
            `${vendors.length} advertising or social service${vendors.length === 1 ? '' : 's'} still received data (${vendors.slice(0, 6).join(', ')}). ` +
            `Under the CCPA, a GPC signal is a valid request to opt out of the sale or sharing of personal information.` +
            (proxied ? '' : ' Note: this run used California browser settings but not a California IP address; sites that geolocate by IP may behave differently.'),
          page_url: ctx.url,
          scenario: 'gpc_on: Sec-GPC: 1 header and navigator.globalPrivacyControl = true, no banner interaction (US-CA)',
          screenshot_path: shot,
          evidence: {
            request_headers: { 'Sec-GPC': '1' },
            requests: uniqBy(hits, (h) => h.host + h.path)
              .slice(0, 40)
              .map(({ at, host, path, type, vendor }) => ({ at, host, path, type, vendor })),
            cookies,
            note: `Tracker fired despite navigator.globalPrivacyControl = ${signalSeen} and Sec-GPC: 1`,
          },
          fix_suggestion:
            'Read navigator.globalPrivacyControl (and the Sec-GPC header on the server) before loading advertising tags. In Google Tag Manager, add a trigger exception or set ad_storage, ad_user_data and ad_personalization to "denied" when GPC is on; most consent tools have a "honour GPC" setting that must be enabled for US visitors.',
        })
      );
    }
  } catch (e) {
    coverage.gpc_on = { ran: false, error: String(e.message || e) };
    log('warn', 'gpc failed', { error: String(e) });
  } finally {
    await context.close().catch(() => {});
  }
  return { findings, coverage };
}
