import { AxeBuilder } from '@axe-core/playwright';
import { newScenarioContext, loadAndSettle, screenshot } from '../browser.js';
import { detectBanner, clickButton } from '../cmp.js';
import { finding, AXE_TO_RULE } from '../rules.js';
import { truncate, log } from '../util.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const IMPACT = { critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor' };
const MAX_ELEMENTS = 20;

function lawRefs(tags) {
  const refs = [];
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
    if (m) {
      const sc = `${m[1]}.${m[2]}.${m[3]}`;
      refs.push(`WCAG 2.2 SC ${sc}`, `EN 301 549 §9.${sc}`);
    }
  }
  return [...new Set(refs)];
}

function element(node, ruleId) {
  const el = { selector: node.target.map(String).join(' '), html: truncate(node.html, 300) };
  if (ruleId === 'color-contrast') {
    const d = node.any?.[0]?.data || {};
    if (d.contrastRatio) el.ratio = d.contrastRatio;
    if (d.fontSize) el.font_size = d.fontSize;
    if (d.bgColor) el.background = d.bgColor;
    if (d.fgColor) el.foreground = d.fgColor;
    if (d.expectedContrastRatio) el.required = d.expectedContrastRatio;
  }
  return el;
}

/**
 * Runs axe-core (WCAG 2.0–2.2 A/AA rules) on each page after dismissing the cookie banner with "Reject".
 * One finding per axe rule, listing every page and element affected, because most issues come from
 * shared components and are fixed once.
 */
export async function runAccessibility(ctx) {
  const byRule = new Map();
  const coverage = { pages: [] };
  const { context, recorder } = await newScenarioContext({ region: ctx.region });
  try {
    const page = await context.newPage();
    let dismissed = false;
    for (const url of ctx.pages) {
      try {
        await loadAndSettle(page, url, 1500);
        if (!dismissed) {
          const b = await detectBanner(page);
          if (b.reject) {
            await clickButton(b.reject).catch(() => {});
            dismissed = true;
          }
        }
        const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        coverage.pages.push({ url, violations: result.violations.length, passes: result.passes.length, incomplete: result.incomplete.length });
        let shot = null;
        for (const v of result.violations) {
          if (!byRule.has(v.id)) {
            if (!shot) shot = await ctx.saveShot(`a11y_${coverage.pages.length}`, await screenshot(page));
            byRule.set(v.id, { v, pages: [], elements: [], count: 0, firstPage: url, shot });
          }
          const g = byRule.get(v.id);
          g.pages.push({ url, count: v.nodes.length });
          g.count += v.nodes.length;
          for (const n of v.nodes) if (g.elements.length < MAX_ELEMENTS) g.elements.push({ page: url, ...element(n, v.id) });
        }
      } catch (e) {
        coverage.pages.push({ url, error: String(e.message || e) });
      }
    }
    await ctx.observe?.('other', recorder.requests, context); // inventory across all scanned pages
  } catch (e) {
    log('warn', 'accessibility failed', { error: String(e) });
    coverage.error = String(e.message || e);
  } finally {
    await context.close().catch(() => {});
  }

  const findings = [];
  for (const [id, g] of byRule) {
    const ruleId = AXE_TO_RULE[id] || `a11y.${id}`;
    findings.push(
      finding(ruleId, {
        pack: 'accessibility',
        severity: IMPACT[g.v.impact] || 'moderate',
        fix_type: id === 'image-alt' ? 'content' : 'code',
        title: `${g.v.help} (${g.count} element${g.count === 1 ? '' : 's'} on ${g.pages.length} page${g.pages.length === 1 ? '' : 's'})`,
        description: `${g.v.description}. Found ${g.count} time${g.count === 1 ? '' : 's'} across ${g.pages.length} page${g.pages.length === 1 ? '' : 's'}. Automated test (axe-core); some accessibility issues can only be confirmed by manual review.`,
        law_refs: [...lawRefs(g.v.tags), 'EAA (Directive (EU) 2019/882)', 'ADA Title III'],
        page_url: g.firstPage,
        scenario: `Automated WCAG 2.2 A/AA check, desktop 1280×800, cookie banner dismissed (${ctx.region})`,
        screenshot_path: g.shot,
        evidence: { count: g.count, pages: g.pages, elements: g.elements, axe_rule: id, help_url: g.v.helpUrl, note: 'Calculated under desktop viewport (1280x800)' },
        fix_suggestion: `${g.v.help}. See ${g.v.helpUrl} for the exact requirement and code examples. If the elements share a component or template, fix it there once.`,
      })
    );
  }
  return { findings, coverage };
}
