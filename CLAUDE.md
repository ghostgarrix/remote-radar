# Remote Radar – notes for agents

Chrome MV3 extension that badges LinkedIn job cards (worldwide / country-locked / unclear…). No build step, no server, no AI: plain JS loaded unpacked from this folder.

## Files
- `rules.js` – classifier (text → verdict) and badge text/icons. Pure logic, unit-tested.
- `content.js` – finds job cards, fetches descriptions, renders badges, diagnostics chip.
- `popup.*` – settings. `test/rules.test.js` + `test/fixtures/*.txt` – tests.

## Rules
- **Run `node test/rules.test.js` after any change to `rules.js`.** It must stay green.
- **Every wrong badge becomes a fixture.** Add the job text to `test/fixtures/` and a test case before fixing the rule. Fix the rule, not the fixture.
- **A wrong green badge is worse than a grey one.** When unsure, return unclear (🤔), never worldwide.
- **You can't open LinkedIn.** Don't claim a DOM/selector fix works. Say it's untested and ask the user to reload (⟳ in `chrome://extensions`, then refresh the tab) and paste **Copy diagnostics** or a badge report.
- **LinkedIn markup changes often and class names are obfuscated.** Don't select on class names. Use `data-*`/`aria-*`, URLs, `componentkey`, or visible text. Keep `findCards` fallbacks.
- **Stay light on LinkedIn.** Keep the throttle (2 concurrent, ~1 s gaps), the 429 pause, the cache, and only fetch cards near the viewport. Never add bulk or background crawling.
- **Privacy:** nothing leaves the browser except requests to linkedin.com. No analytics, no remote code (MV3), no new permissions without asking the user.
- **Bump `version` in `manifest.json`** for any user-visible change. If cached verdicts could be stale after a rules change, bump `RULES_VERSION` in `rules.js`.
- **Keep README in sync** with badges, settings and install steps (install = Load unpacked on the repo folder, not a zip).
- **Match the surrounding style.** No dependencies, no bundler, minimal comments.
- **Don't commit or push unless asked.** Diagnostics pasted by the user may contain LinkedIn member tokens: don't put them in fixtures or commits.
