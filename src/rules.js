// Rule registry mirroring the SiteVero contract (section 5). Severity and law references
// can be overridden by the rule lists returned from the `claim` action.

export const RULES = {
  // consent
  'consent.tracking_before_choice': { pack: 'consent', severity: 'critical', fix_type: 'tag_manager', law_refs: ['ePrivacy Art. 5(3)', 'GDPR Art. 6'] },
  'consent.tracking_after_reject': { pack: 'consent', severity: 'critical', fix_type: 'consent_tool', law_refs: ['ePrivacy Art. 5(3)', 'GDPR Art. 6', 'GDPR Art. 7'] },
  'consent.withdrawal_ignored': { pack: 'consent', severity: 'serious', fix_type: 'consent_tool', law_refs: ['GDPR Art. 7(3)'] },
  'consent.storage-before-consent': { pack: 'consent', severity: 'moderate', fix_type: 'code', law_refs: ['ePrivacy Art. 5(3)', 'GDPR Art. 7'] },
  'consent.banner-focus': { pack: 'consent', severity: 'serious', fix_type: 'consent_tool', law_refs: ['WCAG 2.2 SC 2.4.3', 'GDPR Art. 7(3)'] },
  // gpc
  'gpc.ad-pixel-ignores-signal': { pack: 'gpc', severity: 'critical', fix_type: 'code', law_refs: ['CCPA §1798.135', 'CCPA Regs §7025'] },
  // security hygiene (good-practice checks; severities deliberately moderate)
  'security.csp_missing': { pack: 'security_hygiene', severity: 'moderate', fix_type: 'code', law_refs: ['GDPR Art. 32', 'NIS2 Art. 21 (if in scope)'] },
  'security.hsts_missing': { pack: 'security_hygiene', severity: 'moderate', fix_type: 'code', law_refs: ['GDPR Art. 32', 'NIS2 Art. 21 (if in scope)'] },
  'security.frame_options_missing': { pack: 'security_hygiene', severity: 'minor', fix_type: 'code', law_refs: ['GDPR Art. 32', 'NIS2 Art. 21 (if in scope)'] },
  'security.cookie_insecure': { pack: 'security_hygiene', severity: 'moderate', fix_type: 'code', law_refs: ['GDPR Art. 32'] },
  'security.tls_expiring': { pack: 'security_hygiene', severity: 'serious', fix_type: 'code', law_refs: ['GDPR Art. 32', 'NIS2 Art. 21 (if in scope)'] },
  'security.tls_weak': { pack: 'security_hygiene', severity: 'serious', fix_type: 'code', law_refs: ['GDPR Art. 32', 'NIS2 Art. 21 (if in scope)'] },
  // ai transparency
  'ai.chat.disclosure_missing': { pack: 'ai_transparency', severity: 'serious', fix_type: 'content', law_refs: ['EU AI Act Art. 50(1)'] },
  'ai.chat.disclosure_late': { pack: 'ai_transparency', severity: 'moderate', fix_type: 'content', law_refs: ['EU AI Act Art. 50(1)', 'EU AI Act Art. 50(5)'] },
  'ai.chat.disclosure_ambiguous': { pack: 'ai_transparency', severity: 'minor', fix_type: 'content', law_refs: ['EU AI Act Art. 50(1)'] },
  'ai.media.label_missing': { pack: 'ai_transparency', severity: 'moderate', fix_type: 'code', law_refs: ['EU AI Act Art. 50(4)', 'EU AI Act Art. 50(2)'] },
  'ai.media.c2pa_missing': { pack: 'ai_transparency', severity: 'minor', fix_type: 'code', law_refs: ['EU AI Act Art. 50(2)'] },
};

// axe-core rule ids that map onto the named SiteVero accessibility rules.
export const AXE_TO_RULE = {
  'color-contrast': 'a11y.contrast',
  'link-name': 'a11y.link-name',
  'image-alt': 'a11y.image-alt',
};

let overrides = {};
/** Accept rule lists from the claim response (shape not fixed by the contract, so read defensively). */
export function loadOverrides(claimResponse) {
  overrides = {};
  const lists = [claimResponse?.consent_rules, claimResponse?.ai_rules].filter(Array.isArray);
  for (const list of lists) {
    for (const r of list) {
      const id = r?.rule_id || r?.id;
      if (!id) continue;
      overrides[id] = {
        ...(r.severity || r.default_severity ? { severity: r.severity || r.default_severity } : {}),
        ...(r.fix_type ? { fix_type: r.fix_type } : {}),
        ...(Array.isArray(r.law_refs) ? { law_refs: r.law_refs } : {}),
      };
    }
  }
}

const SEVERITIES = new Set(['critical', 'serious', 'moderate', 'minor']);
const FIX_TYPES = new Set(['code', 'tag_manager', 'consent_tool', 'content']);

/** Build a finding object exactly as `complete` expects. */
export function finding(rule_id, f) {
  const base = { ...(RULES[rule_id] || {}), ...(overrides[rule_id] || {}) };
  const severity = SEVERITIES.has(f.severity) ? f.severity : SEVERITIES.has(base.severity) ? base.severity : 'moderate';
  const fix_type = FIX_TYPES.has(f.fix_type) ? f.fix_type : FIX_TYPES.has(base.fix_type) ? base.fix_type : null;
  return {
    pack: f.pack || base.pack,
    rule_id,
    severity,
    title: String(f.title).slice(0, 500),
    description: String(f.description || '').slice(0, 20000),
    law_refs: f.law_refs || base.law_refs || [],
    page_url: f.page_url,
    scenario: f.scenario || null,
    evidence: f.evidence || {},
    screenshot_path: f.screenshot_path || null,
    fix_suggestion: f.fix_suggestion || null,
    fix_type,
    status: 'open',
  };
}
