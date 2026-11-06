// Finds and operates cookie banners: known consent platforms first, then text matching in 8 languages.
import { sleep } from './util.js';

const KNOWN = [
  { cmp: 'OneTrust', accept: '#onetrust-accept-btn-handler', reject: '#onetrust-reject-all-handler', root: '#onetrust-banner-sdk' },
  { cmp: 'Cookiebot', accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept', reject: '#CybotCookiebotDialogBodyButtonDecline', root: '#CybotCookiebotDialog' },
  { cmp: 'Didomi', accept: '#didomi-notice-agree-button', reject: '#didomi-notice-disagree-button, .didomi-continue-without-agreeing', root: '#didomi-notice' },
  { cmp: 'Usercentrics', accept: '[data-testid="uc-accept-all-button"]', reject: '[data-testid="uc-deny-all-button"]', root: '#usercentrics-root' },
  { cmp: 'Quantcast', accept: '.qc-cmp2-summary-buttons button[mode="primary"]', reject: '.qc-cmp2-summary-buttons button[mode="secondary"]', root: '.qc-cmp2-container' },
  { cmp: 'TrustArc', accept: '#truste-consent-button', reject: '#truste-consent-required', root: '#truste-consent-track' },
  { cmp: 'iubenda', accept: '.iubenda-cs-accept-btn', reject: '.iubenda-cs-reject-btn', root: '#iubenda-cs-banner' },
  { cmp: 'Axeptio', accept: '#axeptio_btn_acceptAll', reject: '#axeptio_btn_dismiss', root: '#axeptio_overlay' },
  { cmp: 'Complianz', accept: '.cmplz-btn.cmplz-accept', reject: '.cmplz-btn.cmplz-deny', root: '#cmplz-cookiebanner-container' },
  { cmp: 'CookieYes', accept: '.cky-btn-accept', reject: '.cky-btn-reject', root: '.cky-consent-container' },
  { cmp: 'Osano', accept: '.osano-cm-accept-all', reject: '.osano-cm-denyAll, .osano-cm-deny', root: '.osano-cm-dialog' },
  { cmp: 'Termly', accept: '[data-tid="banner-accept"]', reject: '[data-tid="banner-decline"]', root: '#termly-code-snippet-support' },
  { cmp: 'Borlabs', accept: '#BorlabsCookieBox a[data-cookie-accept-all]', reject: '#BorlabsCookieBox a[data-cookie-refuse]', root: '#BorlabsCookieBox' },
];

export const ACCEPT_RE =
  /^\s*(accept( all| all cookies| cookies)?|allow( all)?( cookies)?|agree( and close)?|i agree|i accept|got it|ok(ay)?|tout accepter|accepter( et fermer| tout)?|j'accepte|alle akzeptieren|akzeptieren|alle cookies akzeptieren|zustimmen|aceptar( todo| todas)?|acepto|accetta( tutto| tutti)?|accetto|alles accepteren|accepteren|aceitar( tudo)?|zaakceptuj( wszystko)?)\s*$/i;
export const REJECT_RE =
  /^\s*(reject( all)?( cookies)?|decline( all)?|deny( all)?|refuse( all)?|disagree|only (necessary|essential)( cookies)?|necessary only|essential only|use necessary cookies only|tout refuser|refuser( tout)?|continuer sans accepter|alle ablehnen|ablehnen|nur (notwendige|erforderliche)( cookies)?|rechazar( todo| todas)?|rifiuta( tutto| tutti)?|alles weigeren|weigeren|rejeitar( tudo)?|odrzuć( wszystko)?)\s*$/i;
export const SETTINGS_RE =
  /(cookie (settings|preferences)|privacy (settings|preferences|choices)|manage (cookies|consent|preferences)|your privacy choices|consent preferences|gérer (les )?cookies|paramètres (des )?cookies|préférences (des )?cookies|cookie-einstellungen|datenschutzeinstellungen|configuración de cookies|preferencias de cookies|impostazioni (dei )?cookie|cookie-instellingen)/i;

/** Locate a consent button of a given kind ('accept' | 'reject') in the page or any frame. */
export async function findButton(page, kind) {
  for (const k of KNOWN) {
    const sel = k[kind];
    if (!sel) continue;
    for (const frame of page.frames()) {
      const loc = frame.locator(sel).first();
      if (await isVisible(loc)) return { locator: loc, cmp: k.cmp, method: 'known_selector', selector: sel, frame };
    }
  }
  const re = kind === 'accept' ? ACCEPT_RE : REJECT_RE;
  for (const frame of page.frames()) {
    for (const role of ['button', 'link']) {
      const loc = frame.getByRole(role, { name: re });
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 5); i++) {
        const cand = loc.nth(i);
        if (await isVisible(cand)) return { locator: cand, cmp: guessCmp(frame), method: 'text_match', frame };
      }
    }
  }
  return null;
}

async function isVisible(loc) {
  try {
    return (await loc.count()) > 0 && (await loc.isVisible());
  } catch {
    return false;
  }
}

function guessCmp(frame) {
  const u = frame.url();
  if (/privacy-mgmt\.com|sp_message/.test(u)) return 'Sourcepoint';
  if (/consensu\.org/.test(u)) return 'IAB TCF';
  return 'unknown';
}

export async function detectBanner(page) {
  const accept = await findButton(page, 'accept');
  const reject = await findButton(page, 'reject');
  return {
    visible: Boolean(accept || reject),
    cmp: accept?.cmp !== 'unknown' ? accept?.cmp : reject?.cmp || 'unknown',
    accept,
    reject,
  };
}

export async function clickButton(btn) {
  await btn.locator.scrollIntoViewIfNeeded().catch(() => {});
  await btn.locator.click({ timeout: 8000 });
  await sleep(1500);
}

/**
 * Withdraw consent after an earlier "Accept": reopen the preferences UI and reject,
 * or fall back to the consent platform's own JavaScript API.
 * Returns { done: boolean, method: string }.
 */
export async function withdrawConsent(page) {
  // 1. A visible "cookie settings" link or floating button.
  for (const frame of page.frames()) {
    for (const role of ['link', 'button']) {
      const loc = frame.getByRole(role, { name: SETTINGS_RE });
      if ((await loc.count().catch(() => 0)) > 0 && (await loc.first().isVisible().catch(() => false))) {
        try {
          await loc.first().click({ timeout: 5000 });
          await sleep(1500);
          const reject = await findButton(page, 'reject');
          if (reject) {
            await clickButton(reject);
            return { done: true, method: 'ui: settings link, then reject' };
          }
        } catch {}
      }
    }
  }
  // 2. Consent platform APIs.
  const viaApi = await page
    .evaluate(() => {
      const w = window;
      try {
        if (w.OneTrust && typeof w.OneTrust.RejectAll === 'function') { w.OneTrust.RejectAll(); return 'cmp_api: OneTrust.RejectAll()'; }
        if (w.Cookiebot && typeof w.Cookiebot.withdraw === 'function') { w.Cookiebot.withdraw(); return 'cmp_api: Cookiebot.withdraw()'; }
        if (w.Didomi && typeof w.Didomi.setUserDisagreeToAll === 'function') { w.Didomi.setUserDisagreeToAll(); return 'cmp_api: Didomi.setUserDisagreeToAll()'; }
        if (w.UC_UI && typeof w.UC_UI.denyAllConsents === 'function') { w.UC_UI.denyAllConsents(); return 'cmp_api: UC_UI.denyAllConsents()'; }
      } catch (e) { return null; }
      return null;
    })
    .catch(() => null);
  if (viaApi) {
    await sleep(1500);
    return { done: true, method: viaApi };
  }
  return { done: false, method: 'no settings link or supported consent API found' };
}

/**
 * Keyboard test: press Tab up to `maxTabs` times from the top of the page and record where focus goes.
 * Returns { tested, reachedAt, focus_sequence, modal, escapedModal, note }.
 */
export async function keyboardTest(page, banner, maxTabs = 20) {
  const btn = banner.accept || banner.reject;
  if (!btn) return { tested: false, note: 'no banner button found' };
  if (btn.frame !== page.mainFrame()) return { tested: false, note: 'banner is inside an iframe; keyboard test not run' };

  // Tag the banner root so we can tell whether focus is inside it.
  const info = await btn.locator.evaluate((el) => {
    let root = el.closest('[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
    if (!root) {
      let n = el;
      while (n && n !== document.body) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') { root = n; break; }
        n = n.parentElement;
      }
    }
    root = root || el.parentElement;
    root.setAttribute('data-sitevero-banner', '1');
    return { modal: root.getAttribute('aria-modal') === 'true' };
  });

  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.mouse.click(1, 1).catch(() => {});

  const seq = [];
  let reachedAt = null;
  let escapedModal = false;
  for (let i = 1; i <= maxTabs; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { d: 'body', inBanner: false, isBtn: false };
      const d =
        a.tagName.toLowerCase() +
        (a.id ? '#' + a.id : '') +
        (a.getAttribute('aria-label') ? `[aria-label="${a.getAttribute('aria-label').slice(0, 40)}"]` : '') +
        (a.innerText ? ` "${a.innerText.trim().slice(0, 40)}"` : '');
      const inBanner = Boolean(a.closest('[data-sitevero-banner]'));
      return { d, inBanner };
    });
    seq.push((f.inBanner ? '[banner] ' : '') + f.d);
    if (f.inBanner && reachedAt === null) reachedAt = i;
    if (info.modal && !f.inBanner && f.d !== 'body') escapedModal = true;
  }
  return { tested: true, reachedAt, focus_sequence: seq, modal: info.modal, escapedModal };
}
