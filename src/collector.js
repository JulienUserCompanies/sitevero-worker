// Builds the Tracker Map (`trackers` in the `complete` payload) from every scenario's network log.
//
// Country / outside_eea: we report the VENDOR's home country (where the company is established),
// not the server IP location. IP geolocation of CDNs is unreliable, and for GDPR transfers what
// matters is the receiving company and its safeguards (e.g. EU–US Data Privacy Framework).
// Unknown vendors get country null and outside_eea null (= unknown; allowed since the Nov 2026 schema change).
import { classifyHost, classifyCookie } from './trackers.js';
import { isOnSite } from './util.js';

const EEA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']);

// Home country of the company behind each vendor name used in trackers.js and FUNCTIONAL_HOSTS.
const VENDOR_HQ = {
  'Google Analytics': 'US', 'Google Ads / DoubleClick': 'US', 'Google Ads': 'US', 'Google AdSense': 'US', 'Google Tag Manager': 'US',
  'Google Fonts': 'US', 'Google Hosted Libraries': 'US', 'Google Maps': 'US', 'Google reCAPTCHA': 'US', 'Google': 'US', 'YouTube': 'US',
  'Meta Pixel': 'US', 'Meta': 'US', 'Microsoft Advertising': 'US', 'Microsoft Clarity': 'US',
  'LinkedIn Insight': 'US', 'X (Twitter) Ads': 'US', 'Pinterest Tag': 'US', 'Snap Pixel': 'US', 'Reddit Pixel': 'US',
  Criteo: 'FR', Xandr: 'US', Taboola: 'US', Outbrain: 'US', 'Amazon Ads': 'US', 'The Trade Desk': 'US', Magnite: 'US', PubMatic: 'US',
  'Index Exchange': 'CA', OpenX: 'US', Quantcast: 'US', Comscore: 'US', 'Oracle BlueKai': 'US', 'Adobe Audience Manager': 'US',
  'Adobe Advertising': 'US', 'Adobe Analytics': 'US', LiveRamp: 'US', BidSwitch: 'US', Equativ: 'FR', Awin: 'DE', Impact: 'US',
  Mixpanel: 'US', Amplitude: 'US', Segment: 'US', Heap: 'US', Kameleoon: 'FR', Optimizely: 'US', 'AB Tasty': 'FR',
  'HubSpot Analytics': 'US', HubSpot: 'US', 'HubSpot Ads': 'US', 'Salesforce Pardot': 'US', Marketo: 'US', Clearbit: 'US', '6sense': 'US',
  'Oracle Eloqua': 'US', Hotjar: 'MT', FullStory: 'US', Mouseflow: 'DK', Contentsquare: 'FR', Smartlook: 'CZ', LogRocket: 'US',
  'Quantum Metric': 'US', OneTrust: 'US', Cookiebot: 'DK', Usercentrics: 'DE', Sourcepoint: 'US', Didomi: 'FR', iubenda: 'IT',
  TrustArc: 'US', Axeptio: 'FR', CookieYes: 'GB', Osano: 'US', Transcend: 'US', Stripe: 'US', Cloudflare: 'US', jsDelivr: null,
  unpkg: null, Intercom: 'US', Zendesk: 'US', Drift: 'US', Tidio: 'US', LiveChat: 'US', Crisp: 'FR', Vimeo: 'US',
};

// Common third parties that are not tracking (category "functional").
const FUNCTIONAL_HOSTS = {
  'fonts.googleapis.com': 'Google Fonts', 'fonts.gstatic.com': 'Google Fonts', 'ajax.googleapis.com': 'Google Hosted Libraries',
  'maps.googleapis.com': 'Google Maps', 'www.gstatic.com': 'Google', 'www.recaptcha.net': 'Google reCAPTCHA',
  'www.youtube.com': 'YouTube', 'i.ytimg.com': 'YouTube', 'player.vimeo.com': 'Vimeo',
  'js.stripe.com': 'Stripe', 'm.stripe.network': 'Stripe', 'cdnjs.cloudflare.com': 'Cloudflare', 'challenges.cloudflare.com': 'Cloudflare',
  'cdn.jsdelivr.net': 'jsDelivr', 'unpkg.com': 'unpkg',
  'widget.intercom.io': 'Intercom', 'js.intercomcdn.com': 'Intercom', 'static.zdassets.com': 'Zendesk', 'js.driftt.com': 'Drift',
  'code.tidio.co': 'Tidio', 'cdn.livechatinc.com': 'LiveChat', 'client.crisp.chat': 'Crisp',
};

const CATEGORY = { advertising: 'marketing', social: 'marketing', analytics: 'analytics', session_replay: 'analytics', consent: 'essential', tag_manager: 'functional' };
const RESOURCE = { script: 'script', image: 'pixel', beacon: 'pixel', document: 'iframe', xhr: 'xhr' };

function baseDomain(host) {
  const parts = host.split('.');
  // Handles co.uk-style suffixes well enough for cookie matching.
  const n = parts.length >= 3 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}

export function makeCollector(domain) {
  const hosts = new Map();
  const cookieDomains = new Set();
  const cookieVendors = new Set();

  async function observe(kind, requests, context) {
    for (const r of requests) {
      if (!r.host || isOnSite(`https://${r.host}/`, domain)) continue; // first-party
      if (!/^[a-z0-9.-]+$/i.test(r.host) || r.host.length > 253) continue;
      let e = hosts.get(r.host);
      if (!e) {
        e = { host: r.host.toLowerCase(), types: {}, pages: new Set(), before: false, afterReject: false, example: r.url, path: r.path };
        hosts.set(r.host, e);
      }
      e.types[r.type] = (e.types[r.type] || 0) + 1;
      if (r.page && /^https?:/.test(r.page)) e.pages.add(r.page.split('#')[0]);
      if (kind === 'before_consent') e.before = true;
      if (kind === 'after_reject') e.afterReject = true;
    }
    if (context) {
      for (const c of await context.cookies().catch(() => [])) {
        const d = c.domain.replace(/^\./, '').toLowerCase();
        if (!isOnSite(`https://${d}/`, domain)) cookieDomains.add(d);
        else {
          const cls = classifyCookie(c.name);
          if (cls) cookieVendors.add(cls.vendor);
        }
      }
    }
  }

  function trackers() {
    const out = [];
    for (const e of hosts.values()) {
      const cls = classifyHost(e.host, e.path);
      const fnVendor = FUNCTIONAL_HOSTS[e.host];
      const vendor = cls?.vendor || fnVendor || '';
      const category = cls ? CATEGORY[cls.category] || 'unknown' : fnVendor ? 'functional' : 'unknown';
      const topType = Object.entries(e.types).sort((a, b) => b[1] - a[1])[0]?.[0];
      const country = vendor && VENDOR_HQ[vendor] !== undefined ? VENDOR_HQ[vendor] : null;
      const b = baseDomain(e.host);
      const setsCookies =
        [...cookieDomains].some((d) => d === e.host || e.host.endsWith('.' + d) || d === b || d.endsWith('.' + b)) ||
        (vendor && cookieVendors.has(vendor));
      out.push({
        host: e.host,
        vendor: vendor.slice(0, 200),
        category,
        resource_type: RESOURCE[topType] || 'other',
        country,
        outside_eea: country ? !EEA.has(country) : null,
        loads_before_consent: e.before,
        loads_after_reject: e.afterReject,
        sets_cookies: Boolean(setsCookies),
        example_url: e.example && e.example.length <= 2048 ? e.example : null,
        pages_seen: Math.min(Math.max(e.pages.size, 1), 100000),
      });
    }
    // Most relevant first, capped at the contract's 1,000 items.
    const rank = (t) => (t.loads_after_reject ? 4 : 0) + (t.loads_before_consent ? 2 : 0) + (t.category === 'marketing' ? 1 : 0);
    return out.sort((a, b) => rank(b) - rank(a) || a.host.localeCompare(b.host)).slice(0, 1000);
  }

  return { observe, trackers };
}
