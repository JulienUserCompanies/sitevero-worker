# SiteVero scanner worker

The external service that runs SiteVero's browser tests. It claims queued scans from
`POST /api/public/worker`, visits the site in real Chromium browsers, and submits findings
with evidence. It follows the worker contract exactly (`claim` → `complete` / `fail`, optional `heartbeat`).

## What it tests

| Pack | Scenario | Rule IDs it can raise |
|---|---|---|
| **consent** | `no_interaction`: clean profile, banner untouched | `consent.tracking_before_choice`, `consent.storage-before-consent`, `consent.banner-focus` |
| | `reject_reload`: click Reject, reload, visit 2 more pages | `consent.tracking_after_reject` |
| | `accept_all` → `accept_withdraw`: accept, withdraw (settings link or consent-tool API), reload | `consent.withdrawal_ignored` |
| **gpc** | `gpc_on`: California profile, `Sec-GPC: 1` + `navigator.globalPrivacyControl` | `gpc.ad-pixel-ignores-signal` (advertising/social only; analytics alone is not flagged) |
| **accessibility** | axe-core WCAG 2.0–2.2 A/AA on up to `MAX_PAGES` pages, banner dismissed | `a11y.contrast`, `a11y.image-alt`, `a11y.link-name`, plus `a11y.<axe-rule-id>` for every other axe rule |
| **ai_transparency** | Chat widget detection (13 vendors), open, send test message, read reply | `ai.chat.disclosure_missing`, `ai.chat.disclosure_ambiguous` |
| | Image metadata (IPTC "trainedAlgorithmicMedia", C2PA/JUMBF) and nearby text | `ai.media.label_missing`, `ai.media.c2pa_missing` |
| **security_hygiene** | Response headers on up to `SECURITY_PAGES` (3) pages, cookies set by your own server, TLS handshake tests | `security.csp_missing`, `security.hsts_missing`, `security.frame_options_missing`, `security.cookie_insecure`, `security.tls_expiring` (< 21 days), `security.tls_weak` (TLS 1.0/1.1 accepted) |

How it decides:
- **Trackers** are matched by host against `src/trackers.js` (about 100 hosts, plus cookie and storage-key patterns). Consent tools and tag managers never count as tracking.
- **Banners** are found through 13 known consent tools (OneTrust, Cookiebot, Didomi, Usercentrics, Quantcast, TrustArc, iubenda, Axeptio, Complianz, CookieYes, Osano, Termly, Borlabs), then by button text in 8 languages, including iframes and open shadow DOM.
- **Cookies after Reject** only count if they appeared after the click. Leftovers from before the choice belong to `tracking_before_choice`.
- **Chat**: a disclosure in the greeting or first reply passes. An automatic reply with no AI wording fails. Vague wording ("virtual assistant") is `ambiguous`. No reply within `CHAT_WAIT_MS` stays `unchecked`, because it may be human live chat.
- **AI images**: SiteVero never guesses from the picture. It only reports images whose own metadata says they are AI-generated, or pages your team declared as using generated media.

- **Security** checks are good-practice evidence, not legal breaches: header findings are sent as moderate/minor, and descriptions say so. HttpOnly is only required for cookies whose name suggests a session or login (analytics cookies set by JavaScript cannot be HttpOnly). Cookie values are masked.

**Tracker Map.** Every scan also sends `trackers`: one row per third-party host seen in any scenario, with vendor, category (`marketing`, `analytics`, `functional`, `essential`, `unknown`), whether it loaded before consent or after "Reject all", whether it set cookies, and the number of pages it appeared on. `country` is the **vendor's home country** (e.g. Google → US, Criteo → FR), not the server IP location, and `outside_eea` follows from it; unknown vendors get `country: null` and `outside_eea: null` (unknown).

**Verified vs unverified sites.** Unverified sites get a homepage-only scan with no journeys, and no chat message is sent. Verified sites get up to `MAX_PAGES` pages, journey start URLs, and the full chat test.

## Run the tests

```bash
npm install
npm test          # starts two local test sites + a mock SiteVero API, runs the real worker, checks 33 expectations, including HTTPS test sites with an expiring certificate and TLS 1.0
```

The "bad" test site must trigger every consent, GPC, AI and core accessibility rule. The "good" site must produce no consent, GPC or AI findings.

## Scan one site from the command line (no API needed)

```bash
node src/cli.js yoursite.com --out ./out                 # unverified mode: homepage only, no chat message
node src/cli.js yoursite.com --verified --out ./out      # full mode: only for sites you own or may test
```

This prints the exact `complete` payload plus a `coverage` summary, and saves screenshots under `./out/scans/...`.

## Deploy

1. In Lovable Cloud, set `WORKER_SECRET` to a long random string.
2. Deploy this folder as a container, with the variables from `.env.example`:
   - **Railway**: New Project → Deploy from GitHub repo → it detects the Dockerfile. Add the variables. 1 GB RAM per concurrent scan.
   - **Google Cloud Run**: `gcloud run deploy sitevero-worker --source . --region europe-west1 --no-allow-unauthenticated --min-instances 1 --max-instances 1 --memory 2Gi --cpu 2 --no-cpu-throttling --set-env-vars PORT=8080,...`. Keep **one always-on instance with CPU always allocated**, because the worker polls in the background.
3. Queue a scan in the app. The worker logs (JSON lines) show `scan start`, each `pack start`, and `scan complete` with a coverage summary.

### Free option: Google Cloud Run Jobs (runs every 15 minutes, then stops)

With `RUN_ONCE=true` the worker processes every queued scan and exits, so you only pay for the minutes it works.
Cloud Run's monthly free tier for jobs (240,000 vCPU-seconds and 450,000 GiB-seconds) covers roughly 800–1,000 scans a month
at 1 vCPU / 2 GiB, including the empty runs every 15 minutes. A billing account with a card is required; set a budget alert at €1.

```bash
gcloud run jobs deploy sitevero-worker --source . --region europe-west1 \
  --cpu 1 --memory 2Gi --task-timeout 30m --max-retries 0 \
  --set-env-vars RUN_ONCE=true,SITEVERO_URL=https://YOUR-APP,WORKER_SECRET=YOUR-SECRET
```

Then in the Google Cloud console: Cloud Run → Jobs → sitevero-worker → **Triggers** → Add scheduler trigger → `*/15 * * * *`.
Scans start within 15 minutes of being queued. (For production, store `WORKER_SECRET` in Secret Manager and use `--set-secrets`.)

### Free option: your own computer (for testing)

Install Node.js 20+, then in this folder: `npm install`, `npx playwright install chromium`,
set `SITEVERO_URL` and `WORKER_SECRET`, and run `npm start`. Scans run while the computer is on.

## What the worker sends besides findings

- **Screenshots** go through the `upload_url` action (a signed upload link per file), so the worker holds no database key.
- **Coverage** ("What we tested") goes with every `complete`: `pages`, `scenarios` (`{pack, scenario, ran, note}`), `not_tested` (`{pack, item, reason}`) and raw `details`. A clean result is therefore evidence too.
- **Heartbeat** every 60 seconds while a scan runs, so the app can mark stuck scans as failed after 15 minutes.

Scale with `WORKER_CONCURRENCY` (2–3 per 2 GB instance) or more instances. Claims are atomic, so several workers never take the same scan.

## Limits to know

- **Location**: region profiles set language, time zone and geolocation. Real IP location needs `PROXY_*` variables; findings say when a run had no regional proxy (GPC).
- **Tracker list**: curated, not exhaustive. For production coverage, add DuckDuckGo Tracker Radar or Disconnect's list in `src/trackers.js`.
- **Logged-in journeys**: journey `steps` are not executed yet; only `start_url` is scanned.
- **Accessibility**: automated tests find roughly a third to a half of WCAG issues; findings say so.
- **Chat transcripts** are rebuilt from visible widget text and may include interface labels.
- **Ethics**: scan only sites whose owner asked for it. Unverified mode is a single, ordinary page visit per scenario.
