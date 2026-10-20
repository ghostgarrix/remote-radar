---
name: add-fixture
description: Turn a pasted Remote Radar badge report (from clicking a badge) into a regression test, then fix the rule. Use when the user says a badge is wrong and pastes a "Remote Radar … report".
---

# add-fixture

Input: a pasted report that starts with `Remote Radar <version> report — job <id>`. It has the badge shown, verdict, places, lean, workplace, a `Card:` line (title | location | home country) and the job text after `--- description ---`.

1. **Read the report.** Note what the badge said and, from the user's message, what it should have said. If the expected verdict isn't stated, ask.
2. **Save the text.** Write everything after `--- description ---` to `test/fixtures/<company-or-topic>.txt` (lowercase, hyphens). Use the description only, never the report header. Skip this when a short inline string reproduces the problem.
3. **Add the case** to the `cases` array in `test/rules.test.js`, following its format:
   `['label', { title, location, workplace?, description: fx('file.txt') }, { verdict, places?, lean?, workplace?, note? }]`
   Take `title` and `location` from the `Card:` line.
4. **Run `node test/rules.test.js` and confirm the new case fails** for the reason the user reported. If it passes, the rule isn't the problem: the cause is likely in `content.js` (card or description extraction), so say that instead of changing rules.
5. **Fix `rules.js`.** Make the smallest general change, not one aimed only at this posting. Prefer returning unclear over worldwide when unsure.
6. **Re-run all tests.** All must pass, old cases included. If an old case now fails, revisit the fix rather than editing that case.
7. **Bump `RULES_VERSION`** in `rules.js` so stale cached verdicts are recomputed, and bump `version` in `manifest.json`.
8. **Report** what the badge said before and after, which rule changed, and the test count. Remind the user to reload the extension and refresh LinkedIn.

Rules:
- Remove any `guideJobs:`/`ACoAA…` tokens, tracking IDs and personal data from text before saving it as a fixture.
- Don't commit unless asked.
