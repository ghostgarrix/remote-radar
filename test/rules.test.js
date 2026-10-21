// Run: node test/rules.test.js
const fs = require('fs');
const path = require('path');
const RR = require('../rules.js');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const US = 'United States (Remote)';
const FILLER = 'We build fintech products with React and Node. Great team, flexible hours and learning budget.';

// expect: { verdict, places?: [...exact], lean?: substring, workplace?, note?: substring }
const cases = [
  // ---- original rules
  ['US only, authorization', { title: 'Senior React Native Engineer', location: US, description: 'We are a fully remote team.\nYou must be authorized to work in the United States without sponsorship.' }, { verdict: 'restricted', places: ['US'] }],
  ['Anywhere in the US', { title: 'Frontend Engineer', location: US, description: 'This role is remote from anywhere in the U.S. We offer great benefits.' }, { verdict: 'restricted', places: ['US'] }],
  ['Title says Remote US', { title: 'Mobile Engineer (Remote - US)', location: US, description: 'Build cool stuff with React Native and TypeScript for millions of users across many platforms.' }, { verdict: 'restricted', places: ['US'] }],
  ['Worldwide', { title: 'React Developer', location: US, description: 'We are a distributed company. You can work from anywhere in the world, as long as you overlap 4 hours with the team. We hire contractors via Deel.' }, { verdict: 'worldwide' }],
  ['Company based in US but hires globally', { title: 'Engineer', location: US, description: 'Our company is based in New York, but we hire globally. Candidates from any country are welcome.' }, { verdict: 'worldwide' }],
  ['Europe only', { title: 'Engineer', location: 'European Union (Remote)', description: 'This position is open to candidates based in Europe only.' }, { verdict: 'restricted', places: ['Europe'] }],
  ['Canada residents', { title: 'Dev', location: 'Canada (Remote)', description: 'Applicants must reside in Canada. Ce poste est en télétravail.' }, { verdict: 'restricted', places: ['Canada'] }],
  ['US or Canada', { title: 'Dev', location: US, description: 'Remote within the US or Canada.' }, { verdict: 'restricted', places: ['US', 'Canada'] }],
  ['Time zone', { title: 'Dev', location: US, description: 'You must be available to work during EST hours.' }, { verdict: 'restricted', places: ['US time zones'] }],
  ['Region from LinkedIn location', { title: 'Dev', location: 'EMEA (Remote)', description: FILLER }, { verdict: 'restricted', places: ['EMEA'] }],
  ['Unclear, US location', { title: 'Dev', location: US, description: FILLER }, { verdict: 'unclear', lean: 'US' }],
  ['On-site from card', { title: 'Dev', location: 'Paris (On-site)', workplace: 'onsite' }, { verdict: 'onsite' }],
  ['EEO boilerplate ignored', { title: 'Dev', location: US, description: 'We welcome people from anywhere in the world to apply. We are an equal opportunity employer and do not discriminate based on national origin in the United States.' }, { verdict: 'worldwide' }],
  ['About US heading', { title: 'Dev', location: US, description: 'ABOUT US\nWe hire talent worldwide, work from anywhere.' }, { verdict: 'worldwide' }],
  ['Outside the US not possible', { title: 'Dev', location: US, description: 'Unfortunately we are not able to hire outside the US at this time.' }, { verdict: 'restricted', places: ['US'] }],
  ['French: résider en France', { title: 'Développeur React', location: 'France (À distance)', description: 'Poste en full remote. Vous devez résider en France.' }, { verdict: 'restricted', places: ['France'] }],
  ['W2 + state', { title: 'Engineer', location: 'Texas, United States (Remote)', description: 'This is a W2 position. Must live in Texas or California.' }, { verdict: 'restricted', places: ['US'] }],
  ['Salary sentence ignored', { title: 'Engineer', location: US, description: 'Work from anywhere, any time zone. The salary range for US-based candidates is $150k-$180k.' }, { verdict: 'worldwide' }],

  // ---- real postings that were "unclear" in v1
  ['Fuse: "we hire globally"', { title: 'Senior Backend Engineer', location: 'United Kingdom (Remote)', workplace: 'remote', description: fx('fuse.txt') }, { verdict: 'worldwide', note: 'office' }],
  ['German AI firm: German + € + Sparkasse', { title: 'AI Engineer', location: '', workplace: 'remote', description: fx('german-ai.txt') }, { verdict: 'unclear', lean: 'Germany' }],
  ['Teladoc: ☒ Hybrid in description', { title: 'Senior Frontend Developer', location: 'Canada (Remote)', workplace: 'remote', description: fx('teladoc.txt') }, { verdict: 'onsite', workplace: 'hybrid', lean: 'Canada', note: 'description says hybrid' }],
  ['Teladoc without card label', { title: 'Senior Frontend Developer', location: '', description: fx('teladoc.txt') }, { verdict: 'onsite', workplace: 'hybrid' }],

  // ---- new rules
  ['£ salary only → likely UK', { title: 'Dev', location: '', description: 'Salary: £60,000 - £75,000. ' + FILLER }, { verdict: 'unclear', lean: 'UK' }],
  ['C$ salary → likely Canada', { title: 'Dev', location: '', description: 'Compensation: C$120,000. ' + FILLER }, { verdict: 'unclear', lean: 'Canada' }],
  ['No clues → no lean', { title: 'Dev', location: '', description: FILLER + ' We value curiosity and ownership in everything we do together.' }, { verdict: 'unclear', lean: null }],
  ['German: Wohnsitz in Deutschland', { title: 'Entwickler', location: 'Deutschland (Remote)', description: 'Bewerber müssen ihren Wohnsitz in Deutschland haben. Wir bieten flexible Arbeitszeiten und ein tolles Team.' }, { verdict: 'restricted', places: ['Germany'] }],
  ['German: von überall', { title: 'Entwickler', location: '', description: 'Du kannst von überall arbeiten, ganz ortsunabhängig. Wir freuen uns auf deine Bewerbung und viele spannende Projekte.' }, { verdict: 'worldwide' }],
  ['Spanish: residir en España', { title: 'Desarrollador', location: '', description: 'Debes residir en España para esta posición. Ofrecemos trabajo remoto y equipo internacional con muchos proyectos.' }, { verdict: 'restricted', places: ['Spain'] }],
  ['Heading noise not counted', { title: 'Dev', location: US, description: 'About the job\n' + FILLER + ' Join a team that cares about quality, growth and shipping great products.' }, { verdict: 'unclear', lean: 'US' }],
  ['"remote or hybrid" is not hybrid', { title: 'Dev', location: US, description: 'This is a remote or hybrid role depending on your preference. ' + FILLER }, { verdict: 'unclear', workplaceNot: 'hybrid' }],
  ['"hybrid cloud" is not hybrid work', { title: 'Dev', location: US, description: 'Experience with hybrid cloud infrastructure and Kubernetes is a plus. ' + FILLER }, { verdict: 'unclear' }],
  ['3 days in the office → hybrid', { title: 'Dev', location: US, workplace: 'remote', description: 'We expect three days a week in the office, with the rest of the week remote. ' + FILLER }, { verdict: 'onsite', workplace: 'hybrid' }],
  ['"Remote ☒" checkbox stays remote', { title: 'Dev', location: US, workplace: 'remote', description: 'Work Environment ☐ Office ☐ Hybrid ☒ Remote. ' + FILLER }, { verdict: 'unclear' }],
  // ---- detection of "remote, but only in country X"
  ['No sponsorship, no country named → country of the card', { title: 'Dev', location: 'Germany (Remote)', description: 'This is a fully remote role. Candidates must be legally authorized to work without sponsorship. ' + FILLER }, { verdict: 'restricted', places: ['Germany'] }],
  ['"authorized to work" but no card country → stays unclear', { title: 'Dev', location: '', description: 'This is a fully remote role. Candidates must be legally authorized to work without sponsorship. ' + FILLER }, { verdict: 'unclear' }],
  ['Authorized to work in their country of residence is not a restriction', { title: 'Dev', location: 'Germany (Remote)', description: 'Candidates must be legally authorized to work in their country of residence. We hire globally and are fully remote. ' + FILLER }, { verdict: 'worldwide' }],
  ['We offer visa sponsorship is not a restriction', { title: 'Dev', location: 'Germany (Remote)', description: 'We can sponsor visas for the right candidate and are authorized to work with many talents. ' + FILLER }, { verdict: 'unclear' }],
  ['Germany-based', { title: 'Dev', location: '', description: 'We are looking for a Germany-based engineer to join our remote team. ' + FILLER }, { verdict: 'restricted', places: ['Germany'] }],
  ['US-based', { title: 'Dev', location: '', description: 'This is a US-based remote position. ' + FILLER }, { verdict: 'restricted', places: ['US'] }],
  ['Work remotely from Germany', { title: 'Dev', location: '', description: 'You will work remotely from Germany with occasional team events. ' + FILLER }, { verdict: 'restricted', places: ['Germany'] }],
  ['Work from home in Spain', { title: 'Dev', location: '', description: 'You can work from home in Spain and join our offices twice a year. ' + FILLER }, { verdict: 'restricted', places: ['Spain'] }],
  ['German residents', { title: 'Dev', location: '', description: 'Only German residents can be considered for this remote role. ' + FILLER }, { verdict: 'restricted', places: ['Germany'] }],
  ['French work permit', { title: 'Dev', location: '', description: 'You need a valid French work permit to apply for this remote role. ' + FILLER }, { verdict: 'restricted', places: ['France'] }],
  ['Company based in Germany is not a rule', { title: 'Dev', location: '', description: 'We are a Germany-based company with a distributed team. ' + FILLER }, { verdict: 'unclear' }],
  ['LinkedIn location "Worldwide"', { title: 'Dev', location: 'Worldwide (Remote)', description: FILLER }, { verdict: 'worldwide' }],
];

let fail = 0;
for (const [name, input, exp] of cases) {
  const r = RR.classify(input);
  const got = r.places.map((p) => p.label);
  const problems = [];
  if (r.verdict !== exp.verdict) problems.push(`verdict ${r.verdict} ≠ ${exp.verdict}`);
  if (exp.places && (got.length !== exp.places.length || !exp.places.every((p) => got.includes(p)))) problems.push(`places [${got}] ≠ [${exp.places}]`);
  if ('lean' in exp) {
    if (exp.lean === null ? r.lean : !(r.lean || '').includes(exp.lean)) problems.push(`lean "${r.lean}" ≠ "${exp.lean}"`);
  }
  if (exp.workplace && r.workplace !== exp.workplace) problems.push(`workplace ${r.workplace} ≠ ${exp.workplace}`);
  if (exp.workplaceNot && r.workplace === exp.workplaceNot) problems.push(`workplace should not be ${exp.workplaceNot}`);
  if (exp.note && !r.notes.some((n) => n.toLowerCase().includes(exp.note))) problems.push(`no note containing "${exp.note}" (notes: ${JSON.stringify(r.notes)})`);
  if (problems.length) fail++;
  const extra = r.lean ? ` lean=${r.lean}` : '';
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${name}  → ${r.verdict}${r.workplace && r.verdict === 'onsite' ? '/' + r.workplace : ''} [${got.join(', ')}]${extra}${problems.length ? '\n        ' + problems.join(' | ') + '\n        evidence: ' + r.evidence + ' | clues: ' + (r.clues || []).join('; ') : ''}`);
}

// What the badge says for a user in France
console.log('\nBadge text for a user in France:');
const show = (label, input) => { const e = RR.evaluate(RR.classify(input), 'France'); console.log(` ${label.padEnd(10)} ${e.tone.padEnd(6)} ${e.icon} ${e.text}`); return e; };
const byName = Object.fromEntries(cases.map(([n, i]) => [n, i]));
const eEU = show('Europe', byName['Europe only']);
const eUS = show('US only', byName['US only, authorization']);
const eTZ = show('EST hours', byName['Time zone']);
show('Fuse', byName['Fuse: "we hire globally"']);
show('German AI', byName['German AI firm: German + € + Sparkasse']);
show('Teladoc', byName['Teladoc: ☒ Hybrid in description']);
show('No clues', byName['No clues → no lean']);
if (eEU.tone !== 'green' || eUS.tone !== 'red' || eTZ.tone !== 'orange') { console.log('FAIL  evaluate() tones'); fail++; }
const g = RR.evaluate(RR.classify(byName['German AI firm: German + € + Sparkasse']), 'France');
if (g.text !== 'Unclear · likely Germany') { console.log('FAIL  German badge text:', g.text); fail++; }
const n = RR.evaluate(RR.classify(byName['No clues → no lean']), 'France');
if (n.text !== 'No restriction stated') { console.log('FAIL  no-clue badge text:', n.text); fail++; }
console.log(' guess fr-FR →', RR.guessHomeCountry(['fr-FR']), '| guess fr →', RR.guessHomeCountry(['fr']));

const cmp = (label, ok) => { if (!ok) { console.log('FAIL ', label); fail++; } };
const evOf = (name) => RR.evaluate(RR.classify(byName[name]), 'France');
const base = { enabled: true, mode: 'show', includeOrange: false, includeOnsite: false };
const greenEv = eEU, redEv = eUS, orangeEv = eTZ, unclearEv = n;
cmp('show hides nothing', ![greenEv, redEv, orangeEv, unclearEv].some((e) => RR.hides(e, base)));
cmp('greens: keeps green', !RR.hides(greenEv, { ...base, mode: 'greens' }));
cmp('greens: hides red/orange/unclear/onsite', [redEv, orangeEv, unclearEv, evOf('Teladoc: ☒ Hybrid in description')].every((e) => RR.hides(e, { ...base, mode: 'greens' })));
cmp('greens: still-loading card stays visible', !RR.hides(null, { ...base, mode: 'greens' }));
cmp('hide: hides red only by default', RR.hides(redEv, { ...base, mode: 'hide' }) && !RR.hides(orangeEv, { ...base, mode: 'hide' }) && !RR.hides(unclearEv, { ...base, mode: 'hide' }));
cmp('hide + includeOrange', RR.hides(orangeEv, { ...base, mode: 'hide', includeOrange: true }));
cmp('disabled hides nothing', !RR.hides(redEv, { ...base, enabled: false, mode: 'greens' }));
cmp('legacy "dim" setting hides nothing', !RR.hides(redEv, { ...base, mode: 'dim' }));
cmp('company match ignores case, accents, punctuation, legal suffix', RR.isBlockedCompany('Société  Générale, S.A.', ['societe generale']) && RR.isBlockedCompany('Acme Inc.', ['ACME']));
cmp('company match is exact, not substring', !RR.isBlockedCompany('Meta Platforms', ['Meta']) && !RR.isBlockedCompany('Apple Bank', ['apple']));
cmp('empty names never match', !RR.isBlockedCompany('', ['']) && !RR.isBlockedCompany('Acme', []));

const onsite = (loc, home) => RR.evaluate(RR.classify({ title: 'Dev', location: loc, workplace: loc.includes('Hybrid') ? 'hybrid' : 'onsite' }), home);
cmp('on-site in your country is green', onsite('Paris (On-site)', 'France').tone === 'green' && onsite('Paris (On-site)', 'France').text === 'On-site · France');
cmp('on-site abroad is red', onsite('Paris (On-site)', 'Germany').tone === 'red');
cmp('French UI: Allemagne (Hybrid) is Germany', onsite('Allemagne (Hybrid)', 'France').tone === 'red' && onsite('Allemagne (Hybrid)', 'Germany').tone === 'green');
cmp('on-site, unknown country stays grey', onsite('Somewhere (On-site)', 'France').tone === 'grey');
cmp('on-site still counted as on-site for hiding', onsite('Paris (On-site)', 'France').block === 'onsite');

const total = cases.length + 3 + 11 + 5;
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
