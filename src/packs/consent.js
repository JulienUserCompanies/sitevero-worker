import { newScenarioContext, loadAndSettle, settle, trackingCookies, trackingStorage, screenshot } from '../browser.js';
import { detectBanner, clickButton, withdrawConsent, keyboardTest } from '../cmp.js';
import { CONSENT_CATEGORIES } from '../trackers.js';
import { finding } from '../rules.js';
import { uniqBy, log } from '../util.js';

const MAX_REQ = 40;

function summarise(hits) {
  const vendors = [...new Set(hits.map((h) => h.vendor))];
  return { vendors, list: vendors.slice(0, 6).join(', ') + (vendors.length > 6 ? ` and ${vendors.length - 6} more` : '') };
}

function evidenceRequests(hits) {
  return uniqBy(hits, (h) => h.host + h.path)
    .slice(0, MAX_REQ)
    .map(({ at, host, path, type, vendor, category }) => ({ at, host, path, type, vendor, category }));
}

function cmpHint(cmp) {
  switch (cmp) {
    case 'OneTrust':
      return 'In OneTrust, check that each tag is assigned to the right cookie category, that "Reject all" is linked to those categories, and that Google Consent Mode defaults to "denied".';
    case 'Cookiebot':
      return 'In Cookiebot, run a new scan and make sure each script uses data-cookieconsent with the right category (or is gated by the Cookiebot GTM template), and enable Google Consent Mode with default "denied".';
    case 'Didomi':
      return 'In Didomi, link each vendor to a purpose and fire tags only from Didomi GTM events or consent callbacks; default Google Consent Mode to "denied".';
    case 'Usercentrics':
      return 'In Usercentrics, map each service to a data processing service entry and gate tags with the Usercentrics GTM template; default Google Consent Mode to "denied".';
    default:
      return 'In your consent tool and tag manager, set every analytics and advertising tag to fire only after the matching consent category is granted, and set Google Consent Mode defaults to "denied" before any tag loads.';
  }
}

/**
 * Runs consent scenarios. Returns { findings, coverage, banner }.
 * ctx: { url, site, region, verified, saveShot(name, buffer) }
 */
export async function runConsent(ctx) {
  const findings = [];
  const coverage = { scenarios: {} };
  let bannerInfo = { visible: false, cmp: 'unknown' };

  // ---- Scenario: no_interaction ------------------------------------------------
  {
    const { context, recorder } = await newScenarioContext({ region: ctx.region });
    try {
      const page = await context.newPage();
      await loadAndSettle(page, ctx.url);
      const banner = await detectBanner(page);
      bannerInfo = { visible: banner.visible, cmp: banner.cmp, accept_found: Boolean(banner.accept), reject_found: Boolean(banner.reject) };
      const hits = recorder.trackerHits(CONSENT_CATEGORIES);
      const cookies = await trackingCookies(context, CONSENT_CATEGORIES);
      const storage = await trackingStorage(page, CONSENT_CATEGORIES);
      await ctx.observe?.('before_consent', recorder.since(), context);
      const shot = await ctx.saveShot('consent_no_interaction', await screenshot(page));
      coverage.scenarios.no_interaction = { ran: true, banner: bannerInfo, tracker_requests: hits.length, tracking_cookies: cookies.length };

      if (hits.length || cookies.length) {
        const s = summarise([...hits, ...cookies]);
        findings.push(
          finding('consent.tracking_before_choice', {
            title: 'Tracking starts before a consent choice',
            description:
              `Before the visitor made any choice${banner.visible ? ' on the cookie banner' : ' (no cookie banner was found)'}, ` +
              `the page contacted ${s.vendors.length} tracking service${s.vendors.length === 1 ? '' : 's'} (${s.list}). ` +
              `${hits.length} tracking request${hits.length === 1 ? '' : 's'} and ${cookies.length} tracking cookie${cookies.length === 1 ? '' : 's'} were recorded.`,
            page_url: ctx.url,
            scenario: `no_interaction: clean browser profile, page loaded, banner not touched (${ctx.region})`,
            screenshot_path: shot,
            evidence: { banner_state: banner.visible ? `visible, no choice made (${banner.cmp})` : 'no consent banner detected', requests: evidenceRequests(hits), cookies },
            fix_suggestion: cmpHint(banner.cmp),
          })
        );
      }
      if (storage.length) {
        findings.push(
          finding('consent.storage-before-consent', {
            title: 'Tracking identifiers stored in the browser before consent',
            description: `Tracking libraries wrote ${storage.length} identifier${storage.length === 1 ? '' : 's'} to local or session storage before any consent choice (${summarise(storage).list}). Browser storage counts as "storing information on the device" under ePrivacy rules, like cookies.`,
            page_url: ctx.url,
            scenario: `no_interaction (${ctx.region})`,
            screenshot_path: shot,
            evidence: { banner_state: banner.visible ? 'visible, no choice made' : 'no consent banner detected', local_storage: storage },
            fix_suggestion: 'Load these libraries only after consent, or configure them to keep identifiers in memory until consent is given.',
          })
        );
      }

      // Keyboard access to the banner.
      if (banner.visible) {
        const kb = await keyboardTest(page, banner);
        coverage.scenarios.no_interaction.keyboard = kb.tested ? { reached_banner_at_tab: kb.reachedAt, modal: kb.modal } : { tested: false, note: kb.note };
        if (kb.tested && (kb.reachedAt === null || kb.escapedModal)) {
          findings.push(
            finding('consent.banner-focus', {
              title: kb.reachedAt === null ? 'Cookie banner cannot be reached with the keyboard' : 'Keyboard focus leaves the cookie dialog',
              description:
                kb.reachedAt === null
                  ? 'Pressing Tab 20 times from the top of the page never reached the cookie banner buttons. Keyboard and screen-reader users cannot make or change a consent choice, so their consent is not freely given.'
                  : 'The cookie banner is marked as a modal dialog, but keyboard focus moves to page content behind it. Keyboard users can end up interacting with a page they cannot see.',
              page_url: ctx.url,
              scenario: `no_interaction, keyboard only (${ctx.region})`,
              screenshot_path: shot,
              evidence: { banner_state: `visible (${banner.cmp})`, focus_sequence: kb.focus_sequence },
              fix_suggestion:
                kb.reachedAt === null
                  ? 'Place the banner early in the DOM (or move focus to it when it opens) so Accept, Reject and Settings are the first focusable elements.'
                  : 'When the banner is a modal dialog, move focus into it on open, keep focus inside it until a choice is made, and return focus to the page afterwards.',
            })
          );
        }
      }
    } catch (e) {
      coverage.scenarios.no_interaction = { ran: false, error: String(e.message || e) };
      log('warn', 'no_interaction failed', { error: String(e) });
    } finally {
      await context.close().catch(() => {});
    }
  }

  // Without a reject button, the next scenarios cannot run.
  // ---- Scenario: reject_reload -------------------------------------------------
  {
    const { context, recorder } = await newScenarioContext({ region: ctx.region });
    try {
      const page = await context.newPage();
      await loadAndSettle(page, ctx.url);
      const banner = await detectBanner(page);
      if (!banner.reject) {
        coverage.scenarios.reject_reload = { ran: false, note: banner.visible ? 'banner found but no "Reject" option on the first layer' : 'no consent banner found' };
      } else {
        const beforeKeys = new Set((await trackingCookies(context, CONSENT_CATEGORIES)).map((c) => c.name + '|' + c.domain));
        const rejectLabel = ((await banner.reject.locator.innerText().catch(() => '')) || 'Reject').trim().slice(0, 40);
        await clickButton(banner.reject);
        recorder.mark();
        await page.reload({ waitUntil: 'load' });
        await settle(page);
        // Also visit a couple of internal pages: some tags only fire on specific pages.
        const extra = (ctx.extraPages || []).slice(0, 2);
        for (const u of extra) {
          await page.goto(u, { waitUntil: 'load' }).catch(() => {});
          await settle(page, 2500);
        }
        const hits = recorder.trackerHits(CONSENT_CATEGORIES);
        // Only cookies that appeared after the reject click; leftovers from before the choice are reported by no_interaction.
        const cookies = (await trackingCookies(context, CONSENT_CATEGORIES)).filter((c) => !beforeKeys.has(c.name + '|' + c.domain));
        await ctx.observe?.('after_reject', recorder.since(), context);
        const shot = await ctx.saveShot('consent_reject_reload', await screenshot(page));
        coverage.scenarios.reject_reload = { ran: true, reject_method: banner.reject.method, pages: [ctx.url, ...extra], tracker_requests: hits.length, tracking_cookies: cookies.length };
        if (hits.length || cookies.length) {
          const s = summarise([...hits, ...cookies]);
          findings.push(
            finding('consent.tracking_after_reject', {
              title: 'Tracking continues after "Reject all"',
              description: `After the visitor clicked "${rejectLabel}" and the page was reloaded, ${s.vendors.length} tracking service${s.vendors.length === 1 ? '' : 's'} still received data (${s.list}). This is the issue regulators sanction most often.`,
              page_url: ctx.url,
              scenario: `reject_reload: clicked Reject, reloaded${extra.length ? `, visited ${extra.length} more page(s)` : ''} (${ctx.region})`,
              screenshot_path: shot,
              evidence: { banner_state: `rejected via ${banner.reject.method} (${banner.cmp})`, requests: evidenceRequests(hits), cookies },
              fix_suggestion: cmpHint(banner.cmp),
            })
          );
        }
      }
    } catch (e) {
      coverage.scenarios.reject_reload = { ran: false, error: String(e.message || e) };
      log('warn', 'reject_reload failed', { error: String(e) });
    } finally {
      await context.close().catch(() => {});
    }
  }

  // ---- Scenario: accept_all (reference run, no finding by itself) --------------
  // ---- Scenario: accept_withdraw ----------------------------------------------
  {
    const { context, recorder } = await newScenarioContext({ region: ctx.region });
    try {
      const page = await context.newPage();
      await loadAndSettle(page, ctx.url);
      const banner = await detectBanner(page);
      if (!banner.accept) {
        coverage.scenarios.accept_all = { ran: false, note: 'no "Accept" button found' };
        coverage.scenarios.accept_withdraw = { ran: false, note: 'needs an "Accept" button' };
      } else {
        recorder.mark();
        await clickButton(banner.accept);
        await settle(page);
        const acceptedHits = recorder.trackerHits(CONSENT_CATEGORIES);
        await ctx.observe?.('other', recorder.since(), context); // full inventory after Accept
        coverage.scenarios.accept_all = { ran: true, tracker_vendors_after_accept: summarise(acceptedHits).vendors };

        const w = await withdrawConsent(page);
        if (!w.done) {
          coverage.scenarios.accept_withdraw = { ran: false, note: w.method };
        } else {
          await context.clearCookies({ name: /^_ga|^_gid|^_fbp|^_gcl|^_ttp|^_uet|^_clck|^_hj/ }).catch(() => {});
          recorder.mark();
          await page.reload({ waitUntil: 'load' });
          await settle(page);
          const hits = recorder.trackerHits(CONSENT_CATEGORIES);
          const shot = await ctx.saveShot('consent_accept_withdraw', await screenshot(page));
          coverage.scenarios.accept_withdraw = { ran: true, method: w.method, tracker_requests: hits.length };
          if (hits.length) {
            const s = summarise(hits);
            findings.push(
              finding('consent.withdrawal_ignored', {
                title: 'Tracking continues after consent is withdrawn',
                description: `The visitor accepted, then withdrew consent (${w.method}). After reloading, ${s.vendors.length} tracking service${s.vendors.length === 1 ? '' : 's'} still received data (${s.list}). Withdrawing consent must be as easy and as effective as giving it.`,
                page_url: ctx.url,
                scenario: `accept_withdraw: accepted, withdrew consent, reloaded (${ctx.region})`,
                screenshot_path: shot,
                evidence: { banner_state: `accepted then withdrawn via ${w.method}`, requests: evidenceRequests(hits) },
                fix_suggestion: `Make sure withdrawing consent updates the consent state for every tag and stops them on the next page load. ${cmpHint(banner.cmp)}`,
              })
            );
          }
        }
      }
    } catch (e) {
      coverage.scenarios.accept_withdraw = coverage.scenarios.accept_withdraw || { ran: false, error: String(e.message || e) };
      log('warn', 'accept_withdraw failed', { error: String(e) });
    } finally {
      await context.close().catch(() => {});
    }
  }

  return { findings, coverage, banner: bannerInfo };
}
