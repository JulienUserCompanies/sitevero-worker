import { newScenarioContext, loadAndSettle, screenshot } from '../browser.js';
import { detectBanner, clickButton } from '../cmp.js';
import { finding } from '../rules.js';
import { sleep, truncate, isOnSite, log, envInt } from '../util.js';

// Chat vendors: how to recognise them and how to open them through their own JS API.
const CHAT_VENDORS = [
  { vendor: 'Intercom', hosts: ['widget.intercom.io', 'js.intercomcdn.com', 'api-iam.intercom.io'], global: 'Intercom', open: () => window.Intercom('show') },
  { vendor: 'Zendesk', hosts: ['static.zdassets.com', 'ekr.zdassets.com'], global: 'zE', open: () => { try { window.zE('messenger', 'open'); } catch (e) { window.zE.activate && window.zE.activate(); } } },
  { vendor: 'Drift', hosts: ['js.driftt.com', 'js.drift.com'], global: 'drift', open: () => window.drift.api && window.drift.api.openChat() },
  { vendor: 'Tidio', hosts: ['code.tidio.co'], global: 'tidioChatApi', open: () => window.tidioChatApi.open() },
  { vendor: 'HubSpot Chat', hosts: ['js.usemessages.com'], global: 'HubSpotConversations', open: () => window.HubSpotConversations.widget.open() },
  { vendor: 'LiveChat', hosts: ['cdn.livechatinc.com'], global: 'LiveChatWidget', open: () => window.LiveChatWidget.call('maximize') },
  { vendor: 'Crisp', hosts: ['client.crisp.chat'], global: '$crisp', open: () => window.$crisp.push(['do', 'chat:open']) },
  { vendor: 'Freshchat', hosts: ['wchat.freshchat.com'], global: 'fcWidget', open: () => window.fcWidget.open() },
  { vendor: 'Ada', hosts: ['static.ada.support'], global: 'adaEmbed', open: () => window.adaEmbed.toggle() },
  { vendor: 'Gorgias', hosts: ['config.gorgias.chat'], global: 'GorgiasChat', open: () => window.GorgiasChat.open() },
  { vendor: 'Chatbase', hosts: ['www.chatbase.co'], global: 'chatbase', open: () => window.chatbase && window.chatbase('open') },
  { vendor: 'Voiceflow', hosts: ['cdn.voiceflow.com'], global: 'voiceflow', open: () => window.voiceflow.chat.open() },
  { vendor: 'Botpress', hosts: ['cdn.botpress.cloud'], global: 'botpress', open: () => window.botpress.open && window.botpress.open() },
];

// Words that tell a visitor they are talking to an AI or automated system (8 languages).
const CLEAR_AI_RE =
  /\b(AI|A\.I\.|artificial intelligence|chat ?bot|bot|automated assistant|AI[- ]powered|intelligence artificielle|IA|robot conversationnel|künstliche intelligenz|KI|KI-assistent|inteligencia artificial|intelligenza artificiale|kunstmatige intelligentie|inteligência artificial|virtual agent powered by AI)\b/i;
const VAGUE_RE = /\b(virtual assistant|digital assistant|assistant virtuel|assistente virtuale|virtueller assistent|asistente virtual|digitale assistent)\b/i;

const AI_SOURCE_RE = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/;
const AI_LABEL_RE =
  /(AI[- ]generated|generated (with|by) AI|made with AI|created with AI|image générée par (l'?)?IA|généré par (l'?)?IA|KI-generiert|mit KI erstellt|generad[oa] (con|por) IA|generat[oa] (con|dall'?)\s?IA|AI-gegenereerd)/i;

/**
 * AI transparency (EU AI Act Art. 50): chat assistants and labelled AI media.
 * The visible-message test is only run on verified sites, because it sends a real message.
 */
export async function runAi(ctx) {
  const findings = [];
  const aiSystems = [];
  const coverage = { chat: [], media: [] };

  const chatPages = new Set([ctx.url]);
  const mediaPages = new Set();
  for (const s of ctx.site.ai_systems || []) {
    if (!s.page_url || !isOnSite(s.page_url, ctx.site.domain)) continue;
    if (s.type === 'chatbot' || s.type === 'voice_agent') chatPages.add(s.page_url);
    if (s.type === 'generated_media') mediaPages.add(s.page_url);
  }

  // ---- Chat assistants ----------------------------------------------------------
  for (const pageUrl of chatPages) {
    const { context, recorder } = await newScenarioContext({ region: ctx.region });
    try {
      const page = await context.newPage();
      await loadAndSettle(page, pageUrl);
      const banner = await detectBanner(page);
      if (banner.accept) await clickButton(banner.accept).catch(() => {}); // chat widgets often load only after consent
      await sleep(3000);

      const hosts = new Set(recorder.requests.map((r) => r.host));
      let vendor = null;
      for (const v of CHAT_VENDORS) {
        const viaHost = v.hosts.some((h) => [...hosts].some((x) => x === h || x.endsWith('.' + h)));
        const viaGlobal = await page.evaluate((g) => typeof window[g] !== 'undefined', v.global).catch(() => false);
        if (viaHost || viaGlobal) { vendor = v; break; }
      }
      const declared = (ctx.site.ai_systems || []).find((s) => s.page_url === pageUrl && (s.type === 'chatbot' || s.type === 'voice_agent'));
      if (!vendor && !ctx.site.chat_widget_selector && !declared) {
        coverage.chat.push({ page: pageUrl, detected: false });
        continue;
      }
      const name = declared?.name || (vendor ? `${vendor.vendor} chat` : 'Chat widget');
      const vendorName = declared?.vendor || vendor?.vendor || 'unknown';

      if (!ctx.verified) {
        aiSystems.push({ type: 'chatbot', name, vendor: vendorName, page_url: pageUrl, disclosure_status: 'unchecked' });
        coverage.chat.push({ page: pageUrl, detected: true, vendor: vendorName, tested: false, note: 'site not verified: conversation test skipped' });
        continue;
      }

      // Open the widget: site-configured selector first, then the vendor's API.
      let opened = false;
      if (ctx.site.chat_widget_selector) {
        for (const frame of page.frames()) {
          const loc = frame.locator(ctx.site.chat_widget_selector).first();
          if ((await loc.count().catch(() => 0)) > 0) {
            await loc.click({ timeout: 5000 }).then(() => (opened = true)).catch(() => {});
            if (opened) break;
          }
        }
      }
      if (!opened && vendor) opened = await page.evaluate(vendor.open).then(() => true).catch(() => false); // runs via DevTools protocol, so page CSP does not block it
      await sleep(4000);

      const before = await widgetText(page, vendor);
      const sent = opened ? await sendMessage(page, ctx.site.chat_test_message || 'Hi, can you help me with my order?') : false;
      await sleep(envInt('CHAT_WAIT_MS', 20000));
      const after = await widgetText(page, vendor);
      const reply = newText(before, after);
      const shot = await ctx.saveShot('ai_chat', await screenshot(page));

      const transcript = [];
      const t0 = new Date().toISOString();
      if (before.trim()) transcript.push({ at: t0, role: 'assistant', text: truncate(before.trim(), 800) });
      if (sent) transcript.push({ at: t0, role: 'visitor', text: ctx.site.chat_test_message || 'Hi, can you help me with my order?' });
      if (reply.trim()) transcript.push({ at: new Date().toISOString(), role: 'assistant', text: truncate(reply.trim(), 800) });

      let status = 'unchecked';
      let rule = null;
      const greetingClear = CLEAR_AI_RE.test(before);
      const replyClear = CLEAR_AI_RE.test(reply);
      const vague = VAGUE_RE.test(before + ' ' + reply);
      const automatedReply = reply.trim().length > 20;

      if (greetingClear) status = 'pass';
      else if (automatedReply && replyClear) { status = 'pass'; } // disclosed at the first interaction
      else if (automatedReply && vague) { status = 'fail'; rule = 'ai.chat.disclosure_ambiguous'; }
      else if (automatedReply) { status = 'fail'; rule = 'ai.chat.disclosure_missing'; }
      // No reply within the wait window: probably human live chat or offline. Leave unchecked.

      aiSystems.push({ type: 'chatbot', name, vendor: vendorName, page_url: pageUrl, disclosure_status: status });
      coverage.chat.push({ page: pageUrl, detected: true, vendor: vendorName, opened, message_sent: sent, automated_reply: automatedReply, status });

      if (rule) {
        findings.push(
          finding(rule, {
            pack: 'ai_transparency',
            title: rule === 'ai.chat.disclosure_missing' ? 'Chat assistant does not say it is an AI' : 'Chat assistant uses vague wording instead of saying it is an AI',
            description:
              rule === 'ai.chat.disclosure_missing'
                ? `The ${vendorName} chat on this page answered automatically within ${Math.round(envInt('CHAT_WAIT_MS', 20000) / 1000)} seconds, but neither the greeting nor the first reply told the visitor they were talking to an AI system.`
                : `The ${vendorName} chat describes itself with terms like "virtual assistant" but never states it is an AI system. Article 50 requires people to be told clearly that they are interacting with AI, unless it is obvious.`,
            page_url: pageUrl,
            scenario: `Opened chat (${opened ? 'ok' : 'failed'}), sent test message, waited for reply (${ctx.region})`,
            screenshot_path: shot,
            evidence: { transcript, content_credentials: null, note: 'Transcript reconstructed from visible widget text before and after the test message; it may include interface labels.' },
            fix_suggestion: `Start the conversation with a clear disclosure, for example: "Hi, I'm ${declared?.name || 'the assistant'}, an AI assistant. I can make mistakes. Ask for a person at any time." In ${vendorName}, set this in the bot's greeting or introduction message, not only in a footer or terms link.`,
          })
        );
      }
    } catch (e) {
      coverage.chat.push({ page: pageUrl, error: String(e.message || e) });
      log('warn', 'ai chat check failed', { error: String(e) });
    } finally {
      await context.close().catch(() => {});
    }
  }

  // ---- AI-generated media -------------------------------------------------------
  // Pages: everything scanned for accessibility plus pages declared as using generated media.
  const pagesForMedia = new Set([...(ctx.pages || [ctx.url]).slice(0, envInt('MEDIA_PAGES', 5)), ...mediaPages]);
  for (const pageUrl of pagesForMedia) {
    const { context } = await newScenarioContext({ region: ctx.region });
    try {
      const page = await context.newPage();
      await loadAndSettle(page, pageUrl, 1500);
      const images = await page.evaluate(() =>
        [...document.images]
          .filter((i) => i.currentSrc && i.naturalWidth >= 200 && i.naturalHeight >= 150)
          .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
          .slice(0, 12)
          .map((i) => {
            const fig = i.closest('figure');
            const near = [i.alt, i.title, i.getAttribute('aria-label'), fig?.innerText, i.parentElement?.innerText].filter(Boolean).join(' | ');
            return { src: i.currentSrc, near: near.slice(0, 400) };
          })
      );
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 50000)).catch(() => '');
      const declared = mediaPages.has(pageUrl);
      let anyCredentials = false;
      const checked = [];
      for (const img of images) {
        const meta = await inspectImage(context, img.src);
        checked.push({ src: img.src, ...meta });
        if (meta.c2pa) anyCredentials = true;
        if (meta.ai_source && !AI_LABEL_RE.test(img.near)) {
          findings.push(
            finding('ai.media.label_missing', {
              pack: 'ai_transparency',
              title: 'AI-generated image shown without a visible label',
              description: 'The image file itself declares it was created with generative AI (IPTC digital source type "trainedAlgorithmicMedia" in its metadata), but no visible "AI-generated" label was found next to it. If the image depicts realistic people, places or events, Article 50(4) requires disclosure.',
              page_url: pageUrl,
              scenario: `Image metadata and surrounding text inspected (${ctx.region})`,
              evidence: { media_url: img.src, content_credentials: meta.c2pa ? 'present' : 'absent', metadata_markers: meta.markers, nearby_text: img.near, note: 'Detection relies on metadata written by the generating tool; SiteVero does not classify images by appearance.' },
              fix_suggestion: 'Add a visible caption such as "AI-generated image" next to the image (figcaption or overlay), and keep the provenance metadata when resizing or compressing.',
            })
          );
        }
      }
      coverage.media.push({ page: pageUrl, images_checked: checked.length, declared_generated_media: declared, content_credentials_found: anyCredentials });

      if (declared) {
        aiSystems.push({ type: 'generated_media', name: 'Generated media', vendor: '', page_url: pageUrl, disclosure_status: AI_LABEL_RE.test(pageText) ? 'pass' : 'fail' });
        if (!AI_LABEL_RE.test(pageText)) {
          findings.push(
            finding('ai.media.label_missing', {
              pack: 'ai_transparency',
              title: 'Page with declared AI-generated media has no visible AI label',
              description: 'Your team marked this page as showing AI-generated media, but no visible wording such as "AI-generated" was found on the page.',
              page_url: pageUrl,
              scenario: `Visible text inspected (${ctx.region})`,
              evidence: { content_credentials: anyCredentials ? 'present' : 'absent', note: 'Based on the AI system registered in SiteVero for this page.' },
              fix_suggestion: 'Add a visible caption such as "AI-generated image" next to each generated image or video.',
            })
          );
        }
        if (images.length && !anyCredentials) {
          findings.push(
            finding('ai.media.c2pa_missing', {
              pack: 'ai_transparency',
              title: 'AI-generated media served without provenance data',
              description: `None of the ${checked.length} main images on this page carries C2PA content credentials. Article 50(2) requires generative AI outputs to be marked in a machine-readable way; image pipelines often strip this data when resizing.`,
              page_url: pageUrl,
              scenario: `Image files downloaded and inspected for C2PA/JUMBF data (${ctx.region})`,
              evidence: { content_credentials: 'absent', media_url: checked[0]?.src, note: `Checked ${checked.length} images for C2PA (JUMBF) data.` },
              fix_suggestion: 'Keep C2PA content credentials from the generating tool, and configure your CDN or image optimiser not to strip metadata from these images.',
            })
          );
        }
      }
    } catch (e) {
      coverage.media.push({ page: pageUrl, error: String(e.message || e) });
    } finally {
      await context.close().catch(() => {});
    }
  }

  return { findings, aiSystems, coverage };
}

/** All visible text from chat iframes plus open dialogs in the main frame. */
async function widgetText(page, vendor) {
  const parts = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    // Only frames that belong to the chat: the vendor's own hosts, or a frame with a message box.
    // This keeps rotating ads and other iframes out of the transcript.
    let host = '';
    try { host = new URL(frame.url()).hostname; } catch {}
    const vendorFrame = vendor && vendor.hosts.some((h) => host === h || host.endsWith('.' + h.split('.').slice(-2).join('.')));
    const hasInput = await frame.locator('textarea, [contenteditable="true"]').count().catch(() => 0);
    if (!vendorFrame && !hasInput) continue;
    const t = await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    if (t) parts.push(t);
  }
  const main = await page
    .evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="log"], [aria-live]')].map((e) => e.innerText).join('\n'))
    .catch(() => '');
  if (main) parts.push(main);
  return parts.join('\n');
}

function newText(before, after) {
  const seen = new Set(before.split('\n').map((l) => l.trim()));
  return after
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !seen.has(l))
    .join('\n');
}

async function sendMessage(page, text) {
  for (const frame of page.frames()) {
    const box = frame.locator('textarea:visible, [contenteditable="true"]:visible, input[type="text"]:visible').last();
    if ((await box.count().catch(() => 0)) === 0) continue;
    try {
      await box.click({ timeout: 4000 });
      await box.fill(text).catch(async () => { await page.keyboard.type(text); });
      await page.keyboard.press('Enter');
      return true;
    } catch {}
  }
  return false;
}

/** Download an image (first 2 MB) and look for C2PA/JUMBF data and IPTC AI source markers. */
async function inspectImage(context, src) {
  try {
    const res = await context.request.get(src, { timeout: 15000, maxRedirects: 3 });
    if (!res.ok()) return { error: `HTTP ${res.status()}` };
    const buf = (await res.body()).subarray(0, 2 * 1024 * 1024);
    const ascii = buf.toString('latin1');
    const markers = [];
    const c2pa = /c2pa|jumb/.test(ascii);
    if (c2pa) markers.push('c2pa/jumbf');
    const m = AI_SOURCE_RE.exec(ascii);
    if (m) markers.push(m[0]);
    return { c2pa, ai_source: Boolean(m), markers };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}
