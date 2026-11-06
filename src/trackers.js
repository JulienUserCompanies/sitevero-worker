// Curated tracker host list used to classify network requests.
// Categories:
//   advertising   - ad networks, retargeting pixels, conversion tracking (counts as "sale/share" for CCPA)
//   social        - social network pixels and widgets that track (also "sale/share")
//   analytics     - audience measurement and product analytics
//   session_replay- session recording / heatmaps
//   tag_manager   - tag containers: loading them is not tracking by itself, so they never create findings
//   consent       - consent management platforms: always allowed
//
// Matching is by host suffix: "doubleclick.net" matches "stats.g.doubleclick.net".
// Extend this list, or replace it with DuckDuckGo Tracker Radar, for production coverage.

export const TRACKERS = {
  // Google
  'google-analytics.com': { vendor: 'Google Analytics', category: 'analytics' },
  'analytics.google.com': { vendor: 'Google Analytics', category: 'analytics' },
  'doubleclick.net': { vendor: 'Google Ads / DoubleClick', category: 'advertising' },
  'googleadservices.com': { vendor: 'Google Ads', category: 'advertising' },
  'googlesyndication.com': { vendor: 'Google AdSense', category: 'advertising' },
  'adservice.google.com': { vendor: 'Google Ads', category: 'advertising' },
  'googletagmanager.com': { vendor: 'Google Tag Manager', category: 'tag_manager' },
  // Meta
  'connect.facebook.net': { vendor: 'Meta Pixel', category: 'social' },
  'facebook.com': { vendor: 'Meta', category: 'social', pathHint: /\/tr\b|\/tr\/|\/plugins\// },
  // Microsoft
  'bat.bing.com': { vendor: 'Microsoft Advertising', category: 'advertising' },
  'clarity.ms': { vendor: 'Microsoft Clarity', category: 'session_replay' },
  // TikTok, LinkedIn, X, Pinterest, Snap, Reddit
  'analytics.tiktok.com': { vendor: 'TikTok Pixel', category: 'social' },
  'px.ads.linkedin.com': { vendor: 'LinkedIn Insight', category: 'social' },
  'snap.licdn.com': { vendor: 'LinkedIn Insight', category: 'social' },
  'static.ads-twitter.com': { vendor: 'X (Twitter) Ads', category: 'social' },
  'ads-twitter.com': { vendor: 'X (Twitter) Ads', category: 'social' },
  'analytics.twitter.com': { vendor: 'X (Twitter) Ads', category: 'social' },
  't.co': { vendor: 'X (Twitter) Ads', category: 'social' },
  'ct.pinterest.com': { vendor: 'Pinterest Tag', category: 'social' },
  's.pinimg.com': { vendor: 'Pinterest Tag', category: 'social', pathHint: /\/ct\// },
  'tr.snapchat.com': { vendor: 'Snap Pixel', category: 'social' },
  'sc-static.net': { vendor: 'Snap Pixel', category: 'social' },
  'redditstatic.com': { vendor: 'Reddit Pixel', category: 'social', pathHint: /\/ads\// },
  'alb.reddit.com': { vendor: 'Reddit Pixel', category: 'social' },
  // Ad tech
  'criteo.com': { vendor: 'Criteo', category: 'advertising' },
  'criteo.net': { vendor: 'Criteo', category: 'advertising' },
  'adnxs.com': { vendor: 'Xandr', category: 'advertising' },
  'taboola.com': { vendor: 'Taboola', category: 'advertising' },
  'outbrain.com': { vendor: 'Outbrain', category: 'advertising' },
  'amazon-adsystem.com': { vendor: 'Amazon Ads', category: 'advertising' },
  'adsrvr.org': { vendor: 'The Trade Desk', category: 'advertising' },
  'rubiconproject.com': { vendor: 'Magnite', category: 'advertising' },
  'pubmatic.com': { vendor: 'PubMatic', category: 'advertising' },
  'casalemedia.com': { vendor: 'Index Exchange', category: 'advertising' },
  'openx.net': { vendor: 'OpenX', category: 'advertising' },
  'quantserve.com': { vendor: 'Quantcast', category: 'advertising' },
  'scorecardresearch.com': { vendor: 'Comscore', category: 'analytics' },
  'bluekai.com': { vendor: 'Oracle BlueKai', category: 'advertising' },
  'demdex.net': { vendor: 'Adobe Audience Manager', category: 'advertising' },
  'everesttech.net': { vendor: 'Adobe Advertising', category: 'advertising' },
  'rlcdn.com': { vendor: 'LiveRamp', category: 'advertising' },
  'bidswitch.net': { vendor: 'BidSwitch', category: 'advertising' },
  'smartadserver.com': { vendor: 'Equativ', category: 'advertising' },
  'teads.tv': { vendor: 'Teads', category: 'advertising' },
  'awin1.com': { vendor: 'Awin', category: 'advertising' },
  'adroll.com': { vendor: 'AdRoll (NextRoll)', category: 'advertising' },
  'zenaps.com': { vendor: 'Awin', category: 'advertising' },
  'impactradius-event.com': { vendor: 'Impact', category: 'advertising' },
  // Analytics
  'omtrdc.net': { vendor: 'Adobe Analytics', category: 'analytics' },
  '2o7.net': { vendor: 'Adobe Analytics', category: 'analytics' },
  'mixpanel.com': { vendor: 'Mixpanel', category: 'analytics' },
  'mxpnl.com': { vendor: 'Mixpanel', category: 'analytics' },
  'amplitude.com': { vendor: 'Amplitude', category: 'analytics' },
  'segment.com': { vendor: 'Segment', category: 'analytics' },
  'segment.io': { vendor: 'Segment', category: 'analytics' },
  'heap.io': { vendor: 'Heap', category: 'analytics' },
  'heapanalytics.com': { vendor: 'Heap', category: 'analytics' },
  'kameleoon.eu': { vendor: 'Kameleoon', category: 'analytics' },
  'kameleoon.io': { vendor: 'Kameleoon', category: 'analytics' },
  'optimizely.com': { vendor: 'Optimizely', category: 'analytics' },
  'abtasty.com': { vendor: 'AB Tasty', category: 'analytics' },
  'matomo.cloud': { vendor: 'Matomo Cloud', category: 'analytics' },
  'eloqua.com': { vendor: 'Oracle Eloqua', category: 'advertising' },
  'hs-analytics.net': { vendor: 'HubSpot Analytics', category: 'analytics' },
  'hs-scripts.com': { vendor: 'HubSpot', category: 'analytics' },
  'hsadspixel.net': { vendor: 'HubSpot Ads', category: 'advertising' },
  'pardot.com': { vendor: 'Salesforce Pardot', category: 'advertising' },
  'marketo.net': { vendor: 'Marketo', category: 'advertising' },
  'mktoresp.com': { vendor: 'Marketo', category: 'advertising' },
  'clearbit.com': { vendor: 'Clearbit', category: 'advertising' },
  '6sc.co': { vendor: '6sense', category: 'advertising' },
  // Session replay
  'hotjar.com': { vendor: 'Hotjar', category: 'session_replay' },
  'hotjar.io': { vendor: 'Hotjar', category: 'session_replay' },
  'fullstory.com': { vendor: 'FullStory', category: 'session_replay' },
  'mouseflow.com': { vendor: 'Mouseflow', category: 'session_replay' },
  'contentsquare.net': { vendor: 'Contentsquare', category: 'session_replay' },
  'smartlook.com': { vendor: 'Smartlook', category: 'session_replay' },
  'logrocket.io': { vendor: 'LogRocket', category: 'session_replay' },
  'quantummetric.com': { vendor: 'Quantum Metric', category: 'session_replay' },
  // Consent platforms (never findings)
  'cookielaw.org': { vendor: 'OneTrust', category: 'consent' },
  'onetrust.com': { vendor: 'OneTrust', category: 'consent' },
  'cookiebot.com': { vendor: 'Cookiebot', category: 'consent' },
  'usercentrics.eu': { vendor: 'Usercentrics', category: 'consent' },
  'privacy-mgmt.com': { vendor: 'Sourcepoint', category: 'consent' },
  'privacy-center.org': { vendor: 'Didomi', category: 'consent' },
  'didomi.io': { vendor: 'Didomi', category: 'consent' },
  'consensu.org': { vendor: 'IAB TCF', category: 'consent' },
  'iubenda.com': { vendor: 'iubenda', category: 'consent' },
  'trustarc.com': { vendor: 'TrustArc', category: 'consent' },
  'axept.io': { vendor: 'Axeptio', category: 'consent' },
  'cookieyes.com': { vendor: 'CookieYes', category: 'consent' },
  'osano.com': { vendor: 'Osano', category: 'consent' },
  'transcend.io': { vendor: 'Transcend', category: 'consent' },
};

// Cookie names set by tracking libraries on the site's own domain (first-party tracking).
export const TRACKING_COOKIES = [
  { re: /^_ga($|_)/, vendor: 'Google Analytics', category: 'analytics' },
  { re: /^_gid$/, vendor: 'Google Analytics', category: 'analytics' },
  { re: /^_gcl_/, vendor: 'Google Ads', category: 'advertising' },
  { re: /^_fbp$|^_fbc$/, vendor: 'Meta Pixel', category: 'social' },
  { re: /^_ttp$|^_tt_enable_cookie$/, vendor: 'TikTok Pixel', category: 'social' },
  { re: /^__gads$|^__gpi$/, vendor: 'Google Ads', category: 'advertising' },
  { re: /^_uetsid$|^_uetvid$/, vendor: 'Microsoft Advertising', category: 'advertising' },
  { re: /^_clck$|^_clsk$/, vendor: 'Microsoft Clarity', category: 'session_replay' },
  { re: /^_hj/, vendor: 'Hotjar', category: 'session_replay' },
  { re: /^_pin_unauth$|^_pinterest_/, vendor: 'Pinterest Tag', category: 'social' },
  { re: /^_scid/, vendor: 'Snap Pixel', category: 'social' },
  { re: /^li_fat_id$|^_li_/, vendor: 'LinkedIn Insight', category: 'social' },
  { re: /^ajs_(anonymous|user)_id$/, vendor: 'Segment', category: 'analytics' },
  { re: /^mp_.*_mixpanel$/, vendor: 'Mixpanel', category: 'analytics' },
  { re: /^amp_/, vendor: 'Amplitude', category: 'analytics' },
  { re: /^hubspotutk$|^__hstc$|^__hssc$/, vendor: 'HubSpot', category: 'analytics' },
  { re: /^kameleoonVisitorCode$/, vendor: 'Kameleoon', category: 'analytics' },
  { re: /^_pk_id|^_pk_ses/, vendor: 'Matomo', category: 'analytics' },
  { re: /^ELOQUA$/, vendor: 'Oracle Eloqua', category: 'advertising' },
];

// localStorage / sessionStorage keys written by tracking libraries.
export const TRACKING_STORAGE = [
  { re: /^_gcl_/, vendor: 'Google Ads', category: 'advertising' },
  { re: /^_hj/, vendor: 'Hotjar', category: 'session_replay' },
  { re: /^ajs_/, vendor: 'Segment', category: 'analytics' },
  { re: /^amp_|^AMP_/, vendor: 'Amplitude', category: 'analytics' },
  { re: /^mp_/, vendor: 'Mixpanel', category: 'analytics' },
  { re: /^_ttp|^tt_/, vendor: 'TikTok Pixel', category: 'social' },
  { re: /^_fbp/, vendor: 'Meta Pixel', category: 'social' },
  { re: /^kameleoon/i, vendor: 'Kameleoon', category: 'analytics' },
  { re: /^_clck|^_clsk/, vendor: 'Microsoft Clarity', category: 'session_replay' },
];

// Categories that count as tracking for consent findings.
export const CONSENT_CATEGORIES = new Set(['advertising', 'social', 'analytics', 'session_replay']);
// Categories that count as "sale or sharing" for CCPA / GPC findings.
export const SALE_SHARE_CATEGORIES = new Set(['advertising', 'social']);

export function classifyHost(host, path = '') {
  const h = host.toLowerCase();
  for (const [suffix, info] of Object.entries(TRACKERS)) {
    if (h === suffix || h.endsWith('.' + suffix)) {
      if (info.pathHint && !info.pathHint.test(path)) continue;
      return { ...info, matched: suffix };
    }
  }
  return null;
}

export function classifyCookie(name) {
  return TRACKING_COOKIES.find((c) => c.re.test(name)) || null;
}

export function classifyStorageKey(key) {
  return TRACKING_STORAGE.find((c) => c.re.test(key)) || null;
}
