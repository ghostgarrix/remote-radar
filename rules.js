/*!
 * Remote Radar — classification rules.
 * Pure functions, no network, no AI. Shared by the content script and the popup.
 */
(function (root) {
  'use strict';

  const RULES_VERSION = 2;
  const CACHE_PREFIX = `rr${RULES_VERSION}:`;

  const DEFAULT_SETTINGS = {
    enabled: true,
    homeCountry: '',      // '' = guess from browser language
    mode: 'dim',          // what to do with jobs you can't take: 'show' | 'dim' | 'hide'
    includeOrange: false, // also dim/hide region & time-zone mismatches
    includeOnsite: false, // also dim/hide on-site & hybrid jobs
  };

  // ---------------------------------------------------------------------------
  // Unicode-aware regex helper: `\b` in our sources becomes a real word boundary
  // that also works around accented letters (É, á, ö...).
  // ---------------------------------------------------------------------------
  const UB = '(?:(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}]))';
  const rx = (src, flags = 'i') => new RegExp(src.replace(/\\b/g, UB), flags + 'u');

  // ---------------------------------------------------------------------------
  // Places. kind: 'country' | 'region' | 'tz'
  // Acronyms (US, UK, EU, EST...) are case-sensitive on purpose.
  // ---------------------------------------------------------------------------
  const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'West Virginia', 'Wisconsin', 'Wyoming'];
  // "ABOUT US", "JOIN US"... in all-caps headings are not the country.
  const NOT_US = '(?<!(?:ABOUT|JOIN|CONTACT|WITH|FOR|TO|OF|LET|HELP|TELL|GIVE|SEND|BY|AMONG|MEET|CALL|FOLLOW|EMAIL|AT) )';

  const P = (label, kind, ...res) => ({ label, kind, res });
  const PLACES = [
    // --- countries
    P('US', 'country',
      rx(NOT_US + '\\bUS\\b', ''), rx('\\bUSA\\b', ''),
      rx('\\bunited states\\b|\\bétats[- ]unis\\b|\\bestados unidos\\b|\\bamerican (?:citizens?|residents?)\\b'),
      rx('\\b(?:' + US_STATES.join('|') + ')\\b')),
    P('Canada', 'country', rx('\\bcanad(?:a|ian|ians|á|ienne|iens|ien)\\b')),
    P('Mexico', 'country', rx('(?<!new )\\bmexico\\b|\\bméxico\\b|\\bmexique\\b')),
    P('Brazil', 'country', rx('\\b(?:brazil|brasil|brésil)\\b')),
    P('Argentina', 'country', rx('\\b(?:argentina|argentine)\\b')),
    P('Colombia', 'country', rx('\\b(?:colombia|colombie)\\b')),
    P('Chile', 'country', rx('\\bchile\\b')),
    P('UK', 'country', rx('\\bUK\\b', ''), rx('\\bunited kingdom\\b|\\bgreat britain\\b|\\bengland\\b|\\broyaume[- ]uni\\b|\\bbritish\\b')),
    P('Ireland', 'country', rx('\\b(?:ireland|irlande)\\b')),
    P('France', 'country', rx('\\bfrance\\b')),
    P('Germany', 'country', rx('\\b(?:germany|deutschland|allemagne|alemania)\\b')),
    P('Spain', 'country', rx('\\b(?:spain|españa|espagne)\\b')),
    P('Portugal', 'country', rx('\\bportugal\\b')),
    P('Italy', 'country', rx('\\b(?:italy|italia|italie)\\b')),
    P('Netherlands', 'country', rx('\\b(?:netherlands|holland|pays[- ]bas|nederland)\\b')),
    P('Belgium', 'country', rx('\\b(?:belgium|belgique|belgië)\\b')),
    P('Switzerland', 'country', rx('\\b(?:switzerland|suisse|schweiz)\\b')),
    P('Austria', 'country', rx('\\b(?:austria|autriche|österreich)\\b')),
    P('Poland', 'country', rx('\\b(?:poland|pologne|polska)\\b')),
    P('Romania', 'country', rx('\\b(?:romania|roumanie)\\b')),
    P('Czechia', 'country', rx('\\b(?:czech republic|czechia|tchéquie)\\b')),
    P('Greece', 'country', rx('\\b(?:greece|grèce)\\b')),
    P('Sweden', 'country', rx('\\b(?:sweden|suède)\\b')),
    P('Norway', 'country', rx('\\b(?:norway|norvège)\\b')),
    P('Denmark', 'country', rx('\\b(?:denmark|danemark)\\b')),
    P('Finland', 'country', rx('\\b(?:finland|finlande)\\b')),
    P('Morocco', 'country', rx('\\b(?:morocco|maroc)\\b')),
    P('Algeria', 'country', rx('\\b(?:algeria|algérie)\\b')),
    P('Tunisia', 'country', rx('\\b(?:tunisia|tunisie)\\b')),
    P('Egypt', 'country', rx('\\b(?:egypt|égypte)\\b')),
    P('Nigeria', 'country', rx('\\bnigeria\\b')),
    P('South Africa', 'country', rx('\\b(?:south africa|afrique du sud)\\b')),
    P('Israel', 'country', rx('\\b(?:israel|israël)\\b')),
    P('UAE', 'country', rx('\\bUAE\\b', ''), rx('\\bunited arab emirates\\b|\\bdubai\\b')),
    P('Turkey', 'country', rx('\\b(?:türkiye|turquie)\\b')),
    P('India', 'country', rx('\\bindia\\b|\\binde\\b')),
    P('Pakistan', 'country', rx('\\bpakistan\\b')),
    P('Philippines', 'country', rx('\\bphilippines\\b')),
    P('Singapore', 'country', rx('\\b(?:singapore|singapour)\\b')),
    P('Japan', 'country', rx('\\b(?:japan|japon)\\b')),
    P('Australia', 'country', rx('\\b(?:australia|australie)\\b')),
    P('New Zealand', 'country', rx('\\b(?:new zealand|nouvelle[- ]zélande)\\b')),
    // --- regions
    P('EU', 'region', rx('\\bEU\\b', ''), rx('\\beuropean union\\b|\\bunion européenne\\b')),
    P('Europe', 'region', rx('\\beurope\\b|\\beuropean\\b|\\beuropéen(?:ne)?s?\\b')),
    P('EMEA', 'region', rx('\\bEMEA\\b')),
    P('LATAM', 'region', rx('\\blatam\\b|\\blatin america\\b|\\bamérique latine\\b|\\blatinoamérica\\b')),
    P('APAC', 'region', rx('\\bAPAC\\b|\\basia[- ]pacific\\b')),
    P('North America', 'region', rx('\\bnorth america\\b|\\bamérique du nord\\b')),
    P('Americas', 'region', rx('\\bthe americas\\b')),
    P('DACH', 'region', rx('\\bDACH\\b', '')),
    // --- time zones
    P('US time zones', 'tz',
      rx('\\b(?:EST|EDT|PST|PDT|CST|CDT|MST|MDT)\\b', ''),
      rx('\\b(?:eastern|pacific|central|mountain) (?:standard |daylight )?time\\b|\\b(?:eastern|pacific|central|mountain) (?:time ?zones?|hours)\\b'),
      rx('\\bUS (?:business |working |office )?(?:hours|time ?zones?)\\b', '')),
    P('European time zones', 'tz',
      rx('\\b(?:CET|CEST|WET|EET)\\b', ''),
      rx('\\b(?:central )?european (?:time ?zones?|hours|business hours|time)\\b|\\bfuseau horaire européen\\b')),
  ];

  // Which restriction labels count as "includes you", per home country.
  const EU_MEMBERS = ['France', 'Germany', 'Spain', 'Portugal', 'Italy', 'Netherlands', 'Belgium', 'Austria', 'Poland', 'Romania', 'Sweden', 'Denmark', 'Finland', 'Ireland', 'Czechia', 'Greece'];
  const HOME_REGIONS = {};
  EU_MEMBERS.forEach((c) => (HOME_REGIONS[c] = ['EU', 'Europe', 'EMEA', 'European time zones']));
  ['UK', 'Switzerland', 'Norway'].forEach((c) => (HOME_REGIONS[c] = ['Europe', 'EMEA', 'European time zones']));
  ['Morocco', 'Algeria', 'Tunisia'].forEach((c) => (HOME_REGIONS[c] = ['EMEA', 'European time zones']));
  ['Egypt', 'Nigeria', 'South Africa', 'Israel', 'UAE', 'Turkey'].forEach((c) => (HOME_REGIONS[c] = ['EMEA']));
  ['US', 'Canada'].forEach((c) => (HOME_REGIONS[c] = ['North America', 'Americas', 'US time zones']));
  HOME_REGIONS.Mexico = ['North America', 'Americas', 'LATAM', 'US time zones'];
  ['Brazil', 'Argentina', 'Colombia', 'Chile'].forEach((c) => (HOME_REGIONS[c] = ['LATAM', 'Americas']));
  ['India', 'Pakistan', 'Philippines', 'Singapore', 'Japan', 'Australia', 'New Zealand'].forEach((c) => (HOME_REGIONS[c] = ['APAC']));
  ['Germany', 'Austria', 'Switzerland'].forEach((c) => (HOME_REGIONS[c] = [...HOME_REGIONS[c], 'DACH']));

  const DISPLAY_NAME = { US: 'United States', UK: 'United Kingdom', UAE: 'United Arab Emirates' };
  const ISO = { FR: 'France', DE: 'Germany', ES: 'Spain', PT: 'Portugal', IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', AT: 'Austria', PL: 'Poland', RO: 'Romania', SE: 'Sweden', DK: 'Denmark', FI: 'Finland', IE: 'Ireland', CZ: 'Czechia', GR: 'Greece', GB: 'UK', CH: 'Switzerland', NO: 'Norway', MA: 'Morocco', DZ: 'Algeria', TN: 'Tunisia', EG: 'Egypt', NG: 'Nigeria', ZA: 'South Africa', IL: 'Israel', AE: 'UAE', TR: 'Turkey', US: 'US', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina', CO: 'Colombia', CL: 'Chile', IN: 'India', PK: 'Pakistan', PH: 'Philippines', SG: 'Singapore', JP: 'Japan', AU: 'Australia', NZ: 'New Zealand' };

  const HOME_OPTIONS = Object.keys(HOME_REGIONS)
    .map((label) => ({ value: label, name: DISPLAY_NAME[label] || label }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ---------------------------------------------------------------------------
  // Signal patterns
  // ---------------------------------------------------------------------------
  const RESTRICT = rx('\\b(?:must|only|exclusively|required?|requires|requirement|eligible|eligibility|authori[sz]ed|authori[sz]ation|work(?:ing)? permit|right to work|reside|resides|residing|residen(?:ce|t|ts|cy)|citizens?|citizenship|green card|W-?2|1099|clearance|limited to|restricted to|hiring (?:in|from)|open to (?:candidates|applicants|people|those) (?:in|from|based|located|living)|(?:candidates|applicants) (?:in|from|based|located|living)|you (?:are|live|reside) in|based (?:in|out of)|located (?:in|within)|living in|physically|uniquement|seulement|obligatoire|résid(?:er|ant|ence|ents?)|basée? (?:en|au|aux|à|dans)|située? (?:en|au|aux|à|dans)|autorisation de travail|permis de travail|domiciliée?|ansässig|wohnhaft|wohnsitz|arbeitserlaubnis|arbeitsgenehmigung|ausschließlich|residir|residente|residencia|permiso de trabajo|únicamente|somente|autorização de trabalho|permesso di lavoro|residenza)\\b');
  const COMPANY_SUBJECT = rx("\\b(?:we|we're|we are|our|company|startup|headquarter(?:s|ed)?|HQ|offices?|founded|the team is)\\b");
  const CANDIDATE = rx("\\b(?:must|only|eligible|authori[sz]ed|reside|residing|citizens?|(?:candidates?|applicants?) (?:must|should|need)|you (?:must|need|should|will need)|you(?:'re| are) (?:based|located))\\b");
  const STRONG = rx('\\b(?:must|only|required to|eligible|authori[sz]ed)\\b');
  const BOILERPLATE = rx('equal (?:employment )?opportunit|national origin|regardless of (?:race|age|sex|gender|religion)|without regard to|salary|compensation|pay (?:range|transparency|scale)|base pay|E-Verify|reasonable accommodation|privacy (?:policy|notice)|fair chance|ordinance|\\bCCPA\\b|\\bGDPR\\b|benefits? (?:include|package)|401\\(?k');
  const US_BENEFITS = rx('E-Verify|401\\(?k\\)?|\\bHSA\\b|\\bFSA\\b|\\bPTO\\b.*\\b(?:medical|dental)\\b|\\bmedical, dental\\b');
  const WORLDWIDE_STRONG = rx("\\b(?:anywhere in the world|(?:work|working|remote(?:ly)?|live) from anywhere|from anywhere(?! in)|wherever you (?:are|live|want)|any countr(?:y|ies)|any time ?zones?|all time ?zones?|location[- ](?:independent|agnostic)|regardless of (?:your )?(?:location|where you live|country)|international candidates|candidates (?:from|in) any|worldwide remote|remote[ ,(-]*(?:worldwide|anywhere|global)|globally remote|fully remote,? (?:worldwide|globally|anywhere)|partout dans le monde|n'importe où|où que vous soyez|depuis n'importe|hir(?:e|es|ing) (?:\\w+ )?(?:globally|worldwide|internationally|from anywhere|across the (?:globe|world)|in (?:any|all) countr(?:y|ies))|globally distributed|team members (?:in|across) (?:over |more than )?\\d+ countries|weltweit remote|von überall(?: aus)?|ortsunabhängig|desde cualquier (?:lugar|parte|país)|en cualquier (?:lugar|parte|país) del mundo|de qualquer (?:lugar|país)|da qualsiasi (?:luogo|paese)|depuis n'importe quel pays)\\b");
  const WORLDWIDE_SOFT = rx('\\b(?:worldwide|world-wide|globally|global team|across the (?:globe|world)|around the (?:globe|world)|international(?:ly)?|fully distributed)\\b');
  const WW_CONTEXT = rx('\\b(?:remote|hire|hiring|recruit|candidates?|applicants?|location|based|live|work from|open to|talent|contractors?|télétravail|candidat)\\b');
  const EOR = rx('\\b(?:deel|remote\\.com|oyster ?hr|papaya global|velocity global|multiplier|employer of record|EOR)\\b');
  const OUTSIDE_BEFORE = rx('\\boutside (?:of )?(?:the )?$');
  const NEGATION = rx("\\b(?:not|unable|cannot|can't|can not|don't|do not|won't|no)\\b");
  const ANYWHERE_BEFORE = rx('\\b(?:anywhere|everywhere|remote(?:ly)?)\\s+(?:in|within|across|throughout|from)\\s+(?:the\\s+)?(?:continental\\s+)?$');
  const REMOTE_WORD = rx('\\b(?:remote|remotely|à distance|télétravail|teletrabajo|remoto|location|localisation|lieu)\\b');
  const TZ_CONTEXT = rx('\\b(?:overlap|hours|time ?zones?|timezone|between|during|aligned|available|core|schedule|must|required|work(?:ing)?)\\b');

  // Workplace type as LinkedIn shows it on cards, in several UI languages.
  const WORKPLACE_RE = /\((remote|hybrid|on-site|onsite|à distance|a distance|hybride|sur site|en remoto|remoto|híbrido|hibrido|presencial|vor ort|homeoffice|fernarbeit)\)/i;
  const WORKPLACE_LINE = /^(remote|hybrid|on-site|onsite|à distance|hybride|sur site|en remoto|remoto|híbrido|presencial|vor ort)$/i;

  function workplaceOf(text) {
    if (!text) return null;
    let m = text.match(WORKPLACE_RE);
    if (!m) {
      const line = text.split('\n').map((s) => s.trim()).find((s) => WORKPLACE_LINE.test(s));
      if (!line) return null;
      m = [line, line];
    }
    const w = m[1].toLowerCase();
    if (/remote|distance|remoto|homeoffice|fernarbeit/.test(w)) return 'remote';
    if (/hybr|híbr/.test(w)) return 'hybrid';
    return 'onsite';
  }

  // Work mode written in the description itself ("Work Environment ☐ Office ☐ Remote ☒ Hybrid").
  const MODE_OF = (w) => (/remote/i.test(w) ? 'remote' : /hybrid/i.test(w) ? 'hybrid' : 'onsite');
  const CHECKED_MODE = /[☒☑]\s*(remote|hybrid|on-?site|in-?office|office)\b/i;
  const HYBRID_PHRASE = rx('\\b(?:hybrid (?:role|position|job|work(?:ing)?|model|schedule|set-?up|environment|policy|arrangement|basis|mode)|(?:is|as) a hybrid|hybrid \\((?:office|remote|on-?site|in-?office)|(?:[2-5]|two|three|four) days? (?:a|per|each|every) week (?:in|at) (?:the |our )?(?:office|on-?site)|(?:[2-5]|two|three|four) days? (?:in|at) the office|in-?office (?:[2-5]|two|three|four) days)\\b');
  const ONSITE_PHRASE = rx('\\b(?:(?:is|as) an? (?:on-?site|in-?office|office-based) (?:role|position|job)|on-?site (?:role|position) only|this (?:role|position) is (?:fully )?(?:on-?site|office-based|in-?office)|(?:fully|100%) on-?site|présentiel obligatoire|poste (?:en )?présentiel|vor ort (?:in|erforderlich))\\b');
  const NEG_MODE = rx("\\b(?:not|no|non|isn't|aren't|never|without|remote or hybrid|hybrid or remote|remote or on-?site|on-?site or remote)\\b");
  const OFFICE_NOTE = rx('\\b(?:office[- ]based|in[- ]office|on-?site|on[- ]campus|in the office|at the office)\\b');
  const HEADING_NOISE = /^(?:about the job|about us|about the company|about the role|job description|à propos de l[’']offre d[’']emploi|à propos du poste|à propos de nous|acerca del empleo|sobre el empleo|info zum job|über den job|informazioni sull[’']offerta di lavoro|sobre a vaga)\s*:?$/i;

  // Returns { mode: 'remote'|'hybrid'|'onsite', text } when the description states the work mode explicitly.
  function workplaceFromText(description) {
    const text = normalize(description);
    const c = text.match(CHECKED_MODE);
    if (c) return { mode: MODE_OF(c[1]), text: c[0].trim(), checked: true };
    for (const s of sentences(text)) {
      if (NEG_MODE.test(s) && !/(?:is|as) an? (?:on-?site|in-?office|office-based)/i.test(s)) continue;
      if (HYBRID_PHRASE.test(s)) return { mode: 'hybrid', text: s };
      if (ONSITE_PHRASE.test(s)) return { mode: 'onsite', text: s };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Soft location clues, used to say "likely X" when no explicit rule is found.
  // ---------------------------------------------------------------------------
  const LANGS = 'German|French|Spanish|Portuguese|Italian|Dutch|Polish|Swedish|Danish|Norwegian|Finnish|Greek|Czech|Romanian|Hebrew|Turkish|Japanese';
  const LANG_COUNTRY = { german: 'Germany', french: 'France', spanish: 'Spain', portuguese: 'Portugal', italian: 'Italy', dutch: 'Netherlands', polish: 'Poland', swedish: 'Sweden', danish: 'Denmark', norwegian: 'Norway', finnish: 'Finland', greek: 'Greece', czech: 'Czechia', romanian: 'Romania', hebrew: 'Israel', turkish: 'Turkey', japanese: 'Japan' };
  const LANG_REQ = rx('\\b(?:fluent|fluency|native|proficien(?:t|cy)|strong|excellent|good|advanced|business[- ]level|working knowledge of|command of|knowledge of|written and spoken|spoken and written)\\b[^.\\n;]{0,30}?\\b(' + LANGS + ')\\b|\\b(' + LANGS + ')(?:[- ]speaking|[- ]language| (?:and|&|or) English)\\b|\\bspeak(?:ing)? (' + LANGS + ')\\b');

  const eu = (region, member) => ({ Europe: region, ...Object.fromEntries(EU_MEMBERS.map((c) => [c, member])) });
  const CURRENCY = [
    [rx('€|\\bEUR\\b', ''), eu(2, 1), '€ currency'],
    [rx('£|\\bGBP\\b', ''), { UK: 2 }, '£ currency'],
    [rx('\\bC\\$|\\bCA\\$|\\bCAD\\b|\\bCDN\\$', ''), { Canada: 3 }, 'Canadian dollars'],
    [rx('\\bA\\$|\\bAU\\$|\\bAUD\\b', ''), { Australia: 3 }, 'Australian dollars'],
    [rx('\\bNZ\\$|\\bNZD\\b', ''), { 'New Zealand': 3 }, 'NZ dollars'],
    [rx('\\bCHF\\b', ''), { Switzerland: 3 }, 'Swiss francs'],
    [rx('\\b(?:SEK)\\b', ''), { Sweden: 3 }, 'Swedish krona'],
    [rx('\\b(?:NOK)\\b', ''), { Norway: 3 }, 'Norwegian krone'],
    [rx('\\b(?:DKK)\\b', ''), { Denmark: 3 }, 'Danish krone'],
    [rx('\\bPLN\\b|zł', ''), { Poland: 3 }, 'Polish złoty'],
    [rx('\\bR\\$|\\bBRL\\b', ''), { Brazil: 3 }, 'Brazilian reais'],
    [rx('\\bMXN\\b|\\bMX\\$', ''), { Mexico: 3 }, 'Mexican pesos'],
    [rx('₹|\\bINR\\b|\\bLPA\\b|\\blakhs?\\b', ''), { India: 3 }, 'Indian rupees'],
    [rx('\\bS\\$|\\bSGD\\b', ''), { Singapore: 3 }, 'Singapore dollars'],
    [rx('\\bAED\\b', ''), { UAE: 3 }, 'UAE dirhams'],
    [rx('\\bZAR\\b', ''), { 'South Africa': 3 }, 'South African rand'],
    [rx('₪|\\bILS\\b', ''), { Israel: 3 }, 'Israeli shekels'],
    [rx('\\bUS\\$|\\bUSD\\b', ''), { US: 1 }, 'US dollars'],
  ];
  const LOCAL_TERMS = [
    [rx('\\b(?:Sparkassen?|Volksbank|Betriebsrente|Krankenversicherung|Urlaubstage|Betriebsrat|Kündigungsfrist)\\b'), 'Germany', 'German terms'],
    [rx('\\b(?:mutuelle|RTT|CDI|tickets? restaurant|convention collective)\\b'), 'France', 'French employment terms'],
    [rx('\\b(?:RRSP|RESP)\\b', ''), 'Canada', 'Canadian benefits (RRSP)'],
    [rx('\\b(?:NHS|statutory (?:sick|maternity)|Companies House)\\b', ''), 'UK', 'UK terms'],
    [rx('\\b(?:superannuation|PAYG)\\b'), 'Australia', 'Australian terms'],
    [rx('\\b(?:Eircode|PRSI)\\b', ''), 'Ireland', 'Irish terms'],
  ];
  const CITIES = {
    UK: ['London', 'Manchester', 'Edinburgh', 'Glasgow', 'Bristol', 'Birmingham', 'Leeds', 'Cambridge', 'Oxford'],
    Germany: ['Berlin', 'Munich', 'München', 'Hamburg', 'Frankfurt', 'Cologne', 'Köln', 'Stuttgart', 'Düsseldorf'],
    France: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nantes', 'Bordeaux', 'Lille'],
    Netherlands: ['Amsterdam', 'Rotterdam', 'Utrecht', 'Eindhoven'],
    Ireland: ['Dublin'], Spain: ['Madrid', 'Barcelona'], Portugal: ['Lisbon', 'Lisboa', 'Porto'], Italy: ['Milan', 'Milano', 'Rome', 'Roma'],
    Switzerland: ['Zurich', 'Zürich', 'Geneva', 'Genève'], Austria: ['Vienna', 'Wien'], Belgium: ['Brussels', 'Bruxelles'],
    Sweden: ['Stockholm'], Denmark: ['Copenhagen'], Norway: ['Oslo'], Finland: ['Helsinki'], Poland: ['Warsaw', 'Krakow', 'Kraków', 'Wrocław'],
    Canada: ['Toronto', 'Vancouver', 'Montreal', 'Montréal', 'Ottawa', 'Calgary', 'Edmonton', 'Quebec', 'Québec'],
    US: ['San Francisco', 'Seattle', 'Austin', 'Boston', 'Chicago', 'Los Angeles', 'Denver', 'Atlanta', 'Miami', 'Silicon Valley', 'Bay Area', 'NYC', 'Brooklyn'],
    Australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'], India: ['Bangalore', 'Bengaluru', 'Mumbai', 'Hyderabad', 'Pune', 'Chennai'],
    Israel: ['Tel Aviv'], Brazil: ['São Paulo', 'Sao Paulo', 'Rio de Janeiro'], Mexico: ['Mexico City', 'Ciudad de México'], Argentina: ['Buenos Aires'], Colombia: ['Bogotá', 'Bogota', 'Medellín'],
  };
  const CITY_RES = Object.entries(CITIES).map(([label, names]) => [rx('\\b(?:' + names.join('|') + ')\\b', ''), label]);

  const countMatches = (place, text) => {
    let n = 0;
    for (const re of place.res) n += (text.match(new RegExp(re.source, re.flags + 'g')) || []).length;
    return n;
  };

  // lines: description sentences that are NOT legal/salary boilerplate; full: whole text.
  function leanClues(full, lines, hint, usWeak) {
    const scores = new Map();
    const add = (label, w, why) => {
      if (!w) return;
      const e = scores.get(label) || { s: 0, why: [] };
      e.s += w;
      if (!e.why.includes(why)) e.why.push(why);
      scores.set(label, e);
    };
    if (hint) {
      for (const p of findPlaces(hint)) if (p.kind === 'country') add(p.label, 2, `LinkedIn location: ${hint}`);
      for (const [re, label] of CITY_RES) if (re.test(hint)) add(label, 2, `LinkedIn location: ${hint}`);
    }
    const body = lines.join('\n');
    for (const place of PLACES) {
      if (place.kind !== 'country') continue;
      const n = countMatches(place, body);
      if (n >= 2) add(place.label, n >= 5 ? 3 : n >= 3 ? 2 : 1, `mentions ${DISPLAY_NAME[place.label] || place.label} ×${n}`);
    }
    for (const [re, weights, why] of CURRENCY) if (re.test(full)) for (const [label, w] of Object.entries(weights)) add(label, w, why);
    const lm = full.match(LANG_REQ);
    if (lm) {
      const lang = (lm[1] || lm[2] || lm[3] || '').toLowerCase();
      if (LANG_COUNTRY[lang]) add(LANG_COUNTRY[lang], 2, `${lang[0].toUpperCase() + lang.slice(1)} language`);
    }
    for (const [re, label, why] of LOCAL_TERMS) if (re.test(full)) add(label, 2, why);
    for (const [re, label] of CITY_RES) { const m = full.match(re); if (m) add(label, 1, `mentions ${m[0]}`); }
    if (usWeak) add('US', 2, 'US-style benefits (401k, E-Verify…)');

    const ranked = [...scores.entries()].filter(([, e]) => e.s >= 2).sort((a, b) => b[1].s - a[1].s);
    if (!ranked.length) return null;
    const top = ranked[0][1].s;
    const winners = ranked.filter(([, e]) => e.s === top).slice(0, 2);
    return { lean: winners.map(([l]) => l).join('/'), clues: [...new Set(winners.flatMap(([, e]) => e.why))].slice(0, 4) };
  }

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------
  function normalize(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\bU\.S\.A\.?/g, 'USA')
      .replace(/\bU\.S\.?(?=\W|$)/g, 'US')
      .replace(/\bU\.K\.?(?=\W|$)/g, 'UK')
      .replace(/[ \t]+/g, ' ');
  }

  function sentences(text) {
    return normalize(text)
      .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9ÀÂÉÈÊÎÔÛÇ"“(])|\s[•·▪●]\s|;\s/u)
      .map((s) => s.replace(/^[\s•·▪●\-–*]+/, '').trim())
      .filter((s) => s.length > 2 && !HEADING_NOISE.test(s));
  }

  function findPlaces(s) {
    const found = [];
    for (const place of PLACES) {
      let best = -1;
      for (const re of place.res) {
        const m = re.exec(s);
        if (m && (best < 0 || m.index < best)) best = m.index;
      }
      if (best >= 0) found.push({ label: place.label, kind: place.kind, index: best });
    }
    // "European Union" also matches "Europe": keep the more specific one.
    if (found.some((p) => p.label === 'EU')) {
      return found.filter((p) => p.label !== 'Europe' || !/union/i.test(s));
    }
    return found;
  }

  const clip = (s, n = 220) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || null);

  // ---------------------------------------------------------------------------
  // classify({ title, location, workplace, description }) -> result
  //   verdict: 'worldwide' | 'restricted' | 'unclear' | 'onsite'
  // ---------------------------------------------------------------------------
  function classify(input) {
    const { title = '', location = '', workplace = null, description = '' } = input || {};
    const hint = String(location || '').replace(WORKPLACE_RE, '').replace(/\s+/g, ' ').trim().replace(/[·,]$/, '') || null;
    const out = {
      v: RULES_VERSION,
      verdict: 'unclear',
      workplace: workplace || null,
      places: [],
      evidence: null,
      hint,
      notes: [],
      hasDescription: String(description).trim().length > 100,
    };

    if (workplace === 'onsite' || workplace === 'hybrid') {
      out.verdict = 'onsite';
      return out;
    }

    const lines = [...(title ? [normalize(title)] : []), ...sentences(description)];
    const bodyLines = lines.filter((s) => !(BOILERPLATE.test(s) && !STRONG.test(s)));
    const full = normalize(`${title}\n${description}`);

    // The description can contradict LinkedIn's "Remote" label ("Work Environment ☒ Hybrid").
    const dm = out.hasDescription ? workplaceFromText(description) : null;
    if (dm && dm.mode !== 'remote') {
      out.verdict = 'onsite';
      out.workplace = dm.mode;
      out.evidence = clip(dm.text);
      if (workplace === 'remote') out.notes.push(`LinkedIn lists this job as remote, but the description says ${dm.mode === 'hybrid' ? 'hybrid' : 'on-site'}`);
      const l = leanClues(full, bodyLines, hint, lines.filter((x) => US_BENEFITS.test(x)).length);
      if (l) { out.lean = l.lean; out.clues = l.clues; }
      return out;
    }

    const restr = new Map(); // label -> { label, kind, score, evidence }
    const addR = (p, w, s) => {
      const e = restr.get(p.label) || { label: p.label, kind: p.kind, score: 0, evidence: null };
      e.score += w;
      if (!e.evidence || w >= 3) e.evidence = e.evidence && e.score - w >= 3 ? e.evidence : s;
      restr.set(p.label, e);
    };
    let ww = 0;
    let wwEvidence = null;
    let usWeak = 0;

    for (const s of lines) {
      if (BOILERPLATE.test(s) && !STRONG.test(s)) {
        if (US_BENEFITS.test(s)) usWeak++;
        continue;
      }
      if (US_BENEFITS.test(s)) usWeak++;

      const places = findPlaces(s);
      const wwScore = WORLDWIDE_STRONG.test(s) ? 3 : WORLDWIDE_SOFT.test(s) && WW_CONTEXT.test(s) ? 2 : 0;

      if (!places.length) {
        if (wwScore) {
          ww += wwScore;
          wwEvidence = wwEvidence || s;
        } else if (EOR.test(s)) {
          ww += 1;
          wwEvidence = wwEvidence || s;
        }
        continue;
      }

      let restrictive = false;
      let inclusive = false;
      for (const p of places) {
        const before = s.slice(Math.max(0, p.index - 45), p.index);
        if (OUTSIDE_BEFORE.test(before)) {
          if (NEGATION.test(s)) restrictive = true;
          else inclusive = true;
        } else if (ANYWHERE_BEFORE.test(before)) {
          restrictive = true;
        }
      }
      if (inclusive && !restrictive) {
        ww += 2;
        wwEvidence = wwEvidence || s;
        continue;
      }
      if (wwScore && !restrictive) {
        ww += wwScore;
        wwEvidence = wwEvidence || s;
        continue;
      }
      if (!restrictive) {
        const shortLine = s.length <= 80 && REMOTE_WORD.test(s);
        const companyOnly = COMPANY_SUBJECT.test(s) && !CANDIDATE.test(s);
        restrictive = shortLine || (RESTRICT.test(s) && !companyOnly);
      }
      if (!restrictive && places.every((p) => p.kind === 'tz') && TZ_CONTEXT.test(s)) restrictive = true;
      if (!restrictive) continue;

      for (const p of places) addR(p, 3, s);
    }

    // LinkedIn location literally says "Worldwide" / "Anywhere".
    if (hint && /\b(?:worldwide|anywhere|globally|global|everywhere)\b/i.test(hint)) {
      ww += 3;
      wwEvidence = wwEvidence || `LinkedIn location: ${hint}`;
    }

    // LinkedIn location set to a region ("EMEA (Remote)", "European Union (Remote)").
    const locPlaces = hint ? findPlaces(hint) : [];
    const locRegions = locPlaces.filter((p) => p.kind === 'region');
    const locCountries = locPlaces.filter((p) => p.kind === 'country');

    const strong = [...restr.values()].filter((e) => e.score >= 3);
    if (strong.length) {
      out.verdict = 'restricted';
      const rank = { country: 0, region: 1, tz: 2 };
      strong.sort((a, b) => rank[a.kind] - rank[b.kind]);
      out.places = strong.map(({ label, kind }) => ({ label, kind }));
      out.evidence = clip(strong[0].evidence);
    } else if (ww >= 3) {
      out.verdict = 'worldwide';
      out.evidence = clip(wwEvidence);
    } else if (locRegions.length && !locCountries.length) {
      out.verdict = 'restricted';
      out.places = locRegions.map(({ label, kind }) => ({ label, kind }));
      out.evidence = `LinkedIn location: ${hint}`;
    } else {
      out.verdict = 'unclear';
      if (wwEvidence) out.evidence = clip(wwEvidence);
      const l = leanClues(full, bodyLines, hint, usWeak);
      if (l) { out.lean = l.lean; out.clues = l.clues; }
    }

    // Office perks / campus mentions are worth a heads-up even when the job is listed as remote.
    const off = lines.find((x) => OFFICE_NOTE.test(x) && !/\b(?:no|not|without)\b/i.test(x));
    if (off) out.notes.push(`Mentions office work: “${clip(off, 110)}”`);
    return out;
  }

  // ---------------------------------------------------------------------------
  // evaluate(result, homeCountry) -> what the badge should look like for this user
  //   tone: 'green' | 'orange' | 'red' | 'grey'
  //   block: null | 'red' | 'orange' | 'onsite'   (what the hide/dim settings act on)
  // ---------------------------------------------------------------------------
  function summarize(places) {
    const countries = places.filter((p) => p.kind === 'country');
    const regions = places.filter((p) => p.kind === 'region');
    const pick = countries.length ? countries : regions.length ? regions : places;
    const labels = pick.map((p) => p.label);
    return labels.length > 3 ? `${labels.slice(0, 3).join('/')} +${labels.length - 3}` : labels.join('/');
  }

  function evaluate(r, home) {
    if (!r) return null;
    const mine = new Set(home ? [home, ...(HOME_REGIONS[home] || [])] : []);
    const src = r.hasDescription ? 'Based on the job description' : 'Based on the job card only';
    const tip = (lines) => [...lines.filter(Boolean), src].join('\n');
    const quote = r.evidence ? `“${r.evidence}”` : null;

    switch (r.verdict) {
      case 'worldwide':
        return { tone: 'green', icon: '🌍', text: 'Worldwide', tip: tip([quote, ...(r.notes || [])]), block: null };
      case 'onsite':
        return { tone: 'grey', icon: '🏢', text: r.workplace === 'hybrid' ? 'Hybrid' : 'On-site', tip: tip(['Not a fully remote job', ...(r.notes || []), quote, r.clues && r.clues.length ? `Likely ${r.lean} (${r.clues.join('; ')})` : null]), block: 'onsite' };
      case 'restricted': {
        const label = summarize(r.places);
        const all = r.places.map((p) => DISPLAY_NAME[p.label] || p.label).join(', ');
        if (r.places.some((p) => mine.has(p.label))) {
          return { tone: 'green', icon: '✅', text: `${label} · fits you`, tip: tip([`Restricted to: ${all}`, quote, ...(r.notes || [])]), block: null };
        }
        const kinds = new Set(r.places.map((p) => p.kind));
        if (kinds.has('country')) return { tone: 'red', icon: '🔒', text: `${label} only`, tip: tip([`Restricted to: ${all}`, quote, ...(r.notes || [])]), block: 'red' };
        if (kinds.has('region')) return { tone: 'orange', icon: '🧭', text: `${label} only`, tip: tip([`Restricted to: ${all}`, quote, ...(r.notes || [])]), block: 'orange' };
        return { tone: 'orange', icon: '🕒', text: label, tip: tip([`Time-zone requirement: ${all}`, quote, ...(r.notes || [])]), block: 'orange' };
      }
      default: {
        const clues = r.clues && r.clues.length ? `Clues: ${r.clues.join('; ')}` : null;
        const base = ['No explicit location rule found.', clues, !clues && r.hint ? `LinkedIn location: ${r.hint}` : null, ...(r.notes || []), quote];
        if (r.lean) return { tone: 'grey', icon: '🤔', text: `Unclear · likely ${r.lean}`, tip: tip(base), block: null };
        if (r.hasDescription) return { tone: 'grey', icon: '🔎', text: 'No restriction stated', tip: tip(base), block: null };
        return { tone: 'grey', icon: '🤔', text: 'Unclear', tip: tip(base), block: null };
      }
    }
  }

  function guessHomeCountry(languages) {
    for (const l of languages || []) {
      try {
        const region = new Intl.Locale(l).maximize().region;
        if (region && ISO[region]) return ISO[region];
      } catch (_) { /* ignore */ }
    }
    return '';
  }

  const API = {
    RULES_VERSION, CACHE_PREFIX, DEFAULT_SETTINGS, HOME_OPTIONS, HOME_REGIONS,
    classify, evaluate, workplaceOf, guessHomeCountry, findPlaces, sentences,
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.RemoteRadar = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
