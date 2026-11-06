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
  /^\s*(accept( all| all cookies| cookies)?|allow( all)?( cookies)?|agree( and close)?|i agree|i accept|got it|ok(ay)?|accept (&|and) (close|continue)|agree (&|and) (close|continue|proceed)|tout accepter|accepter( et fermer| et continuer| tout)?|j'accepte( tout)?|alle akzeptieren|akzeptieren|alle cookies akzeptieren|zustimmen|aceptar( todo| todas)?|acepto|accetta( tutto| tutti)?|accetto|alles accepteren|accepteren|aceitar( tudo)?|zaakceptuj( wszystko)?)\s*$/i;
export const REJECT_RE =
  /^\s*(reject( all)?( cookies)?|decline( all)?|deny( all)?|refuse( all)?|disagree|only (necessary|essential)( cookies)?|necessary only|essential only|use necessary cookies only|tout refuser|tout rejeter|rejeter( tout)?|refuser( tout| et fermer)?|continuer sans accepter|alle ablehnen|ablehnen|nur (notwendige|erforderliche)( cookies)?|rechazar( todo| todas)?|rifiuta( tutto| tutti)?|alles weigeren|weigeren|rejeitar( tudo)?|odrzuć( wszystko)?)\s*$/i;
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
 * Some sites stack banners (e.g. a consent tool plus an ad vendor's own banner). Click `kind`
 * on the first, then keep going while another banner offers the same choice (max 3).
 * Returns the labels clicked, in order.
 */
export async function clickThroughBanners(page, first, kind) {
  const clicked = [];
  let btn = first;
  for (let i = 0; i < 3 && btn; i++) {
    const label = ((await btn.locator.innerText().catch(() => '')) || kind).trim().slice(0, 40);
    try {
      await clickButton(btn);
      clicked.push(`${label} (${btn.cmp})`);
    } catch {
      break;
    }
    await sleep(1000);
    btn = await findButton(page, kind);
  }
  return clicked;
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
        if (w.transcend && typeof w.transcend.showConsentManager === 'function') { w.transcend.showConsentManager(); return 'open:Transcend'; }
      } catch (e) { return null; }
      return null;
    })
    .catch(() => null);
  if (viaApi && viaApi.startsWith('open:')) {
    // The consent tool's own preferences dialog was opened; reject from there like a visitor would.
    await sleep(2000);
    const reject = await findButton(page, 'reject');
    if (reject) {
      await clickButton(reject);
      return { done: true, method: `ui: ${viaApi.slice(5)} preferences reopened, then reject` };
    }
    return { done: false, method: `${viaApi.slice(5)} preferences opened but no reject option found` };
  }
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
    const up = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null; // crosses shadow roots
    let root = null;
    for (let n = el; n && n !== document.body; n = up(n)) {
      if (n.matches && n.matches('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')) { root = n; break; }
    }
    if (!root) {
      for (let n = el; n && n !== document.body; n = up(n)) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') { root = n; break; }
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
      let a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; // focus inside shadow DOM
      if (!a || a === document.body) return { d: 'body', inBanner: false, isBtn: false };
      const up = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
      let inside = false;
      for (let n = a; n; n = up(n)) if (n.hasAttribute && n.hasAttribute('data-sitevero-banner')) { inside = true; break; }
      const d =
        a.tagName.toLowerCase() +
        (a.id ? '#' + a.id : '') +
        (a.getAttribute('aria-label') ? `[aria-label="${a.getAttribute('aria-label').slice(0, 40)}"]` : '') +
        (a.innerText ? ` "${a.innerText.trim().slice(0, 40)}"` : '');
      return { d, inBanner: inside };
    });
    seq.push((f.inBanner ? '[banner] ' : '') + f.d);
    if (f.inBanner && reachedAt === null) reachedAt = i;
    if (info.modal && !f.inBanner && f.d !== 'body') escapedModal = true;
  }
  return { tested: true, reachedAt, focus_sequence: seq, modal: info.modal, escapedModal };
}
