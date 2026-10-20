# Remote Radar – remote job filter for LinkedIn

A Chrome extension (Manifest V3) that adds a badge to every LinkedIn job card telling you whether a "remote" job is really open to you:

| Badge | Meaning |
|---|---|
| 🌍 **Worldwide** | Explicitly open to any country / time zone |
| ✅ **EU · fits you** | Restricted, but the restriction includes your country or region |
| 🔒 **US only** | Locked to one or more countries you're not in |
| 🧭 **LATAM only** / 🕒 **US time zones** | Region or time-zone requirement that doesn't match you |
| ❔ **Unclear · likely Germany** | No explicit rule, but clues point to a country (location, currency, required language, company country, local terms) — hover to see them |
| 🔎 **No restriction stated** | Description read, no location rule and no clues |
| 🏢 **On-site / Hybrid** | Not fully remote |

Hover a badge to see the exact sentence or clues it's based on. **Click a badge** to copy a report (verdict, reasons and the job text) — paste it in a chat if a badge looks wrong.

## Install (developer mode)

1. Unzip the folder.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `remote-radar` folder.
4. Pin the extension, click its icon and check **I can work from** (it guesses from your browser language).
5. Open LinkedIn Jobs and scroll — badges appear within a second or two.

Works in any Chromium browser (Chrome, Edge, Brave, Arc) on macOS, Windows and Linux.

## How it works

- `content.js` finds job cards (`data-occludable-job-id` / `data-job-id`, with a link-based fallback) and only checks the ones on or near the screen.
- For each one it fetches the posting from LinkedIn's public job-posting endpoint (falls back to the job page), **2 requests at a time with ~1 s gaps**, and pauses 60 s if LinkedIn answers 429.
- When you open a job, the description already on screen is used instead (no request).
- Badges appear on the left job list (above each title) and on the open job. If LinkedIn's markup changes, cards are also found by their "City (Remote)" line and the job ID is read from any attribute; if IDs can't be read, the bottom-left chip says so and offers **Copy diagnostics**.
- `rules.js` splits the text into sentences and looks for restriction signals ("must reside in", "authorized to work in", "W2", "Remote – US", "anywhere in the US", EST/PST hours, state names…) vs. global signals ("work from anywhere", "any country", Deel/EOR…). EEO and salary boilerplate is ignored. It also reads the work mode stated in the description ("☒ Hybrid", "3 days a week in the office") when it contradicts LinkedIn's "Remote" label. English, French, German, Spanish, Portuguese and Italian phrasing is covered; LinkedIn's UI labels are handled in EN/FR/ES/DE.
- Results are cached in `chrome.storage.local` for 14 days, so a job is never fetched twice.
- Nothing leaves the browser except requests to linkedin.com. No account, no server, no AI.

## Settings (popup)

- **I can work from** — decides what turns green.
- **Jobs I can't take** — Show / Dim / Hide the 🔒 ones.
- Options to also include region/time-zone mismatches and on-site/hybrid jobs.
- **Re-check all jobs** — clears the cache.

## Tests

```bash
node test/rules.test.js
```

## Known limits

- LinkedIn changes its markup often; selectors live at the top of `content.js` sections (`findCards`, `DETAIL_*`).
- Automated access is against LinkedIn's terms. The extension stays light (only visible cards, throttled, cached), but very heavy scrolling sessions could still get rate-limited.
- Keyword rules can't read every vague posting — that's what ❔ is for.

## Next steps

1. Shared cache backend (`jobId → verdict`) so each job is analyzed once for all users.
2. On-device AI (Chrome Prompt API / Gemini Nano) for ❔ jobs, with a cloud fallback.
3. Chrome Web Store listing (needs a privacy policy and screenshots).
