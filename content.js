/*!
 * Remote Radar — content script for LinkedIn Jobs.
 * Finds job cards, fetches each description in the background (throttled, cached),
 * classifies it with rules.js and puts a badge at the top of the card.
 *
 * LinkedIn ships several job-list layouts and changes markup often, so card
 * detection is deliberately tolerant: it collects job IDs from data attributes,
 * links (/jobs/view/ID, ?currentJobId=ID) and URNs (jobPosting:ID), then climbs
 * to the enclosing card.
 */
(() => {
  'use strict';
  if (window.__remoteRadarLoaded) return;
  window.__remoteRadarLoaded = true;

  const RR = globalThis.RemoteRadar;
  const VERSION = chrome.runtime.getManifest().version;
  const ORIGIN = location.origin.includes('linkedin.com') ? location.origin : 'https://www.linkedin.com';
  const TTL_MS = 14 * 24 * 3600 * 1000;
  const MAX_CONCURRENT = 2;
  const GAP_MS = 700;          // pause between requests (+ random jitter)
  const RATE_PAUSE_MS = 60000; // back off for a minute on HTTP 429
  const NEAR_VIEWPORT_PX = 600;

  let settings = { ...RR.DEFAULT_SETTINGS };
  const results = new Map(); // jobId -> classification
  const meta = new Map();    // jobId -> { title, location, workplace }
  const lookedUp = new Set();
  const queue = [];
  const queued = new Set();
  let active = 0;
  let pausedUntil = 0;
  let lastCards = new Map();
  const stats = { orphans: 0, orphanSample: null, workplaceLeaves: 0, scans: 0, cards: 0, fetchOk: 0, fetchEmpty: 0, fetchErr: 0, lastStatus: null, lastError: null, detail: 'none' };

  const alive = () => {
    try { return !!chrome.runtime && !!chrome.runtime.id; } catch (_) { return false; }
  };
  const log = (...a) => console.debug('[Remote Radar]', ...a);
  const onJobsPage = () => location.pathname.startsWith('/jobs');

  // ---------------------------------------------------------------- settings
  async function loadSettings() {
    try {
      settings = { ...RR.DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(RR.DEFAULT_SETTINGS)) };
    } catch (e) { log(e); }
    if (!settings.homeCountry) settings.homeCountry = RR.guessHomeCountry(navigator.languages || [navigator.language]);
  }

  // ------------------------------------------------------------------- cache
  async function hydrate(ids) {
    const todo = ids.filter((id) => !results.has(id) && !lookedUp.has(id));
    if (!todo.length) return;
    todo.forEach((id) => lookedUp.add(id));
    try {
      const got = await chrome.storage.local.get(todo.map((id) => RR.CACHE_PREFIX + id));
      const now = Date.now();
      for (const id of todo) {
        const e = got[RR.CACHE_PREFIX + id];
        if (e && now - e.t < TTL_MS) results.set(id, e.r);
      }
    } catch (e) { log(e); }
  }

  function store(id, r, persist) {
    results.set(id, r);
    if (persist && alive()) chrome.storage.local.set({ [RR.CACHE_PREFIX + id]: { r, t: Date.now() } }).catch(() => {});
  }

  async function pruneCache() {
    try {
      const { rrLastPrune = 0 } = await chrome.storage.local.get('rrLastPrune');
      if (Date.now() - rrLastPrune < 24 * 3600 * 1000) return;
      const all = await chrome.storage.local.get(null);
      const now = Date.now();
      const stale = Object.keys(all).filter((k) => /^rr\d+:/.test(k) && (!k.startsWith(RR.CACHE_PREFIX) || now - (all[k].t || 0) > TTL_MS));
      if (stale.length) await chrome.storage.local.remove(stale);
      await chrome.storage.local.set({ rrLastPrune: now });
    } catch (e) { log(e); }
  }

  // ------------------------------------------------------------- job cards
  const JOB_LINK = /\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/;
  const ID_IN_TEXT = [JOB_LINK, /[?&]currentJobId=(\d{6,})/, /jobPosting[:(%3A]+(\d{6,})/i, /^(\d{6,})$/];
  const ID_SOURCES = [
    ['[data-occludable-job-id]', 'data-occludable-job-id'],
    ['[data-job-id]', 'data-job-id'],
    ['a[href*="/jobs/view/"]', 'href'],
    ['a[href*="currentJobId="]', 'href'],
    ['[data-entity-urn*="obPosting"]', 'data-entity-urn'],
    ['[data-urn*="obPosting"]', 'data-urn'],
    ['[componentkey*="obPosting"]', 'componentkey'],
    ['[data-view-name="job-card"]', null],
  ];
  const CARD_SEL = '[data-occludable-job-id], li, [role="listitem"], [data-view-name="job-card"], [role="button"]';

  function idFrom(value) {
    if (!value) return null;
    for (const re of ID_IN_TEXT) {
      const m = String(value).match(re);
      if (m) return m[1];
    }
    return null;
  }

  function idOfElement(el, attr) {
    if (attr) return idFrom(el.getAttribute(attr));
    // Card marked by view name only: look for an ID inside it.
    for (const [sel, a] of ID_SOURCES) {
      if (!a) continue;
      const inner = el.matches(sel) ? el : el.querySelector(sel);
      const id = inner && idFrom(inner.getAttribute(a));
      if (id) return id;
    }
    return null;
  }

  function detailRoot() {
    const d = findDetailDescription();
    if (!d) return null;
    // Climb to the panel holding the title + description, but never up to the job list itself.
    let n = d;
    for (let i = 0; i < 10 && n.parentElement; i++) {
      const p = n.parentElement;
      if (p.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="], [data-occludable-job-id]').length > 3) break;
      n = p;
      if (n.querySelector('h1')) break;
    }
    return n;
  }

  function cardFor(el) {
    let card = el.closest(CARD_SEL);
    // Prefer the outermost list item that still looks like a single card.
    while (card && card.parentElement) {
      const up = card.parentElement.closest(CARD_SEL);
      if (!up || (up.textContent || '').length > 1500 || up.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]').length > 3) break;
      card = up;
    }
    if (card && (card.textContent || '').length <= 2500) return card;
    // Last resort: climb a few levels until the block looks like a card.
    let n = el;
    for (let i = 0; i < 8 && n.parentElement; i++) {
      n = n.parentElement;
      const len = (n.textContent || '').trim().length;
      if (len > 1500) return null;
      if (len > 40 && n.getBoundingClientRect().height > 40) return n;
    }
    return null;
  }

  // IDs hidden in attributes (data-job-id="urn:li:jobPosting:123…", componentkey, hrefs…).
  const ATTR_ID = /(?:jobPosting|job[-_]?id|jobs\/view\/(?:[^/?#]*-)?|currentJobId=)\D{0,6}(\d{8,12})/i;
  const BIG_ID = /(?<!\d)([3-9]\d{9})(?!\d)/; // LinkedIn job IDs are ~10 digits starting at 3+ (unix timestamps start with 1)

  function scanIds(card) {
    const els = [card, ...card.querySelectorAll('*')].slice(0, 150);
    let loose = null;
    for (const el of els) {
      if (el.closest && el.closest('.rr-wrap')) continue;
      for (const a of el.attributes) {
        const v = a.value;
        if (!v || v.length > 400) continue;
        const m = v.match(ATTR_ID);
        if (m) return m[1];
        if (!loose && /^(?:data-|componentkey|id$|href$|aria-)/i.test(a.name)) {
          const b = v.match(BIG_ID);
          if (b) loose = b[1];
        }
      }
    }
    return loose;
  }

  // Cards recognised by their "City, Country (Remote)" line, whatever the markup around it.
  const WP_LEAF = /\((?:remote|hybrid|on-?site|à distance|a distance|hybride|sur site|en remoto|remoto|híbrido|hibrido|presencial|vor ort|homeoffice|fernarbeit)\)\s*$/i;

  function workplaceLeaves(detail) {
    const out = [];
    document.querySelectorAll('span, div, p, li, strong').forEach((el) => {
      if (el.children.length > 1) return;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 140 || !WP_LEAF.test(t)) return;
      if (el.closest('h1, .rr-wrap, .rr-chip') || (detail && detail.contains(el))) return;
      if (el.firstElementChild && WP_LEAF.test((el.firstElementChild.textContent || '').trim())) return; // keep the innermost
      out.push(el);
    });
    return out;
  }

  function cardFromLeaf(leaf, leaves) {
    let last = leaf;
    for (let n = leaf.parentElement, i = 0; n && i < 12; n = n.parentElement, i++) {
      if ((n.textContent || '').length > 1500) break;
      if (leaves.filter((l) => n.contains(l)).length > 1) break; // would swallow a neighbouring card
      last = n;
      if (n.tagName === 'LI' || n.getAttribute('role') === 'listitem') break;
    }
    return last === leaf ? null : last;
  }

  function findCards() {
    const out = new Map();
    const taken = new Set();
    const detail = detailRoot();
    const put = (id, card) => {
      if (!id || !card || out.has(id) || taken.has(card)) return;
      out.set(id, card);
      taken.add(card);
    };

    // 1) known attributes / links / URNs
    for (const [sel, attr] of ID_SOURCES) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.closest('.rr-wrap, .rr-chip')) return;
        if (detail && detail.contains(el)) return;
        const id = idOfElement(el, attr);
        if (!id || out.has(id)) return;
        put(id, cardFor(el));
      });
    }

    // 2) fallback: find cards by their location line, read the job ID from any attribute
    const leaves = workplaceLeaves(detail);
    let orphans = 0;
    stats.orphanSample = null;
    for (const leaf of leaves) {
      const card = cardFromLeaf(leaf, leaves);
      if (!card || (card.textContent || '').trim().length < 20) continue;
      if ([...taken].some((c) => c === card || c.contains(card) || card.contains(c))) continue;
      const id = scanIds(card);
      if (id) put(id, card);
      else {
        orphans++;
        if (!stats.orphanSample) stats.orphanSample = card;
      }
    }
    stats.orphans = orphans;
    stats.workplaceLeaves = leaves.length;
    return out;
  }

  function readCardMeta(card) {
    const text = card.innerText || card.textContent || '';
    const lines = text.split('\n').map((s) => s.trim()).filter((s) => s && !/^(?:🌍|✅|🔒|🧭|🕒|🤔|🏢|Checking remote)/u.test(s));
    const a = card.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
    let title = ((a && (a.getAttribute('aria-label') || a.innerText)) || lines[0] || '').trim().split('\n')[0];
    title = title.replace(/\s+with verification$/i, '');
    const location = lines.find((l) => /\([^)]+\)\s*$/.test(l) && RR.workplaceOf(l)) || '';
    return { title, location, workplace: RR.workplaceOf(location || text) };
  }

  const hasContent = (card) => (card.textContent || '').trim().length > 20;

  function nearViewport(el) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) {
      const c = el.firstElementChild;
      return c ? nearViewport(c) : false;
    }
    return r.bottom > -NEAR_VIEWPORT_PX && r.top < window.innerHeight + NEAR_VIEWPORT_PX;
  }

  // ------------------------------------------------------- fetch & classify
  function blockText(root) {
    let out = '';
    const BLOCK = /^(P|LI|BR|DIV|H[1-6]|UL|OL|TR|SECTION|ARTICLE)$/;
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName)) {
          const b = BLOCK.test(c.tagName);
          if (b) out += '\n';
          walk(c);
          if (b) out += '\n';
        }
      }
    })(root);
    return out.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  }

  const DESC_SEL = '.show-more-less-html__markup, .description__text, #job-details, .jobs-description__content, .jobs-description-content__text, .jobs-box__html-content';

  function longestText(obj, depth = 0) {
    if (!obj || depth > 12) return '';
    if (typeof obj === 'string') return obj;
    let best = '';
    for (const [k, v] of Object.entries(obj)) {
      const t = typeof v === 'string' ? (k === 'text' ? v : '') : longestText(v, depth + 1);
      if (t.length > best.length) best = t;
    }
    return best;
  }

  function extractDescription(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.querySelector(DESC_SEL);
    if (el) return blockText(el);
    // Logged-in job pages may embed the posting as JSON in <code> blocks.
    let best = '';
    doc.querySelectorAll('code').forEach((c) => {
      const raw = c.textContent || '';
      if (raw.length < 300 || raw.length > 2e6 || !raw.includes('"text"')) return;
      try {
        const t = longestText(JSON.parse(raw));
        if (t.length > best.length) best = t;
      } catch (_) { /* not JSON */ }
    });
    return best.length > 300 ? best : '';
  }

  async function get(url) {
    const res = await fetch(url, { credentials: 'include' });
    stats.lastStatus = res.status;
    if (res.status === 429) throw Object.assign(new Error('rate limited'), { rateLimited: true });
    return res.ok ? res.text() : '';
  }

  async function fetchDescription(id) {
    // Public job-posting endpoint first (light HTML fragment), full job page as fallback.
    const guest = await get(`${ORIGIN}/jobs-guest/jobs/api/jobPosting/${id}`);
    const text = guest ? extractDescription(guest) : '';
    if (text.length > 40) return text;
    const page = await get(`${ORIGIN}/jobs/view/${id}/`);
    const full = page ? extractDescription(page) : '';
    return full.length > text.length ? full : text;
  }

  function enqueue(id) {
    if (results.has(id) || queued.has(id)) return;
    queued.add(id);
    queue.push(id);
    pump();
  }

  function pump() {
    if (!alive()) return;
    const wait = pausedUntil - Date.now();
    if (wait > 0) { setTimeout(pump, wait + 50); return; }
    while (active < MAX_CONCURRENT && queue.length) {
      const id = queue.shift();
      active++;
      processJob(id).finally(() => {
        active--;
        setTimeout(pump, GAP_MS + Math.random() * 500);
      });
    }
  }

  async function processJob(id) {
    if (results.has(id)) { queued.delete(id); return; }
    try {
      const description = await fetchDescription(id);
      keepText(id, description);
      if (description) stats.fetchOk++; else stats.fetchEmpty++;
      const r = RR.classify({ ...(meta.get(id) || {}), description });
      store(id, r, r.hasDescription);
      queued.delete(id);
    } catch (err) {
      if (err && err.rateLimited) {
        pausedUntil = Date.now() + RATE_PAUSE_MS;
        queue.unshift(id);
        updateChip();
        return;
      }
      stats.fetchErr++;
      stats.lastError = String((err && err.message) || err);
      log('fetch failed', id, err);
      queued.delete(id);
      store(id, RR.classify(meta.get(id) || {}), false);
    }
    renderId(id);
    updateChip();
  }

  // ---------------------------------------------------------------- render
  function badgeKey(id) {
    const r = results.get(id);
    const ev = r ? RR.evaluate(r, settings.homeCountry) : null;
    return { ev, key: ev ? `${id}|${ev.tone}|${ev.text}|${ev.tip}` : `${id}|loading` };
  }

  const texts = new Map(); // jobId -> description (memory only, for "copy report")
  const keepText = (id, t) => {
    texts.set(id, String(t || '').slice(0, 8000));
    if (texts.size > 200) texts.delete(texts.keys().next().value);
  };

  async function copyReport(id, btn) {
    const label = btn.textContent;
    btn.textContent = '📋 Copying…';
    let desc = texts.get(id);
    if (!desc) {
      try { desc = await fetchDescription(id); keepText(id, desc); } catch (_) { desc = ''; }
    }
    const r = results.get(id);
    const ev = r && RR.evaluate(r, settings.homeCountry);
    const m = meta.get(id) || {};
    const report = [
      `Remote Radar ${VERSION} report — job ${id}`,
      `Badge: ${ev ? ev.icon + ' ' + ev.text : '?'} | verdict: ${r && r.verdict} | places: ${((r && r.places) || []).map((p) => p.label).join(',') || '-'} | lean: ${(r && r.lean) || '-'} | workplace: ${(r && r.workplace) || '-'}`,
      `Why: ${(r && r.evidence) || '-'}`,
      `Clues: ${((r && r.clues) || []).join('; ') || '-'} | Notes: ${((r && r.notes) || []).join(' / ') || '-'}`,
      `Card: ${m.title || ''} | ${m.location || ''} | home: ${settings.homeCountry}`,
      '--- description ---',
      desc || '(could not load the description)',
    ].join('\n');
    let msg = '📋 Report copied';
    try { await navigator.clipboard.writeText(report); } catch (_) { console.log(report); msg = '📋 Printed in console'; }
    btn.textContent = msg;
    setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1600);
  }

  function makeBadge(ev, key, extraClass, id) {
    const wrap = document.createElement('div');
    wrap.className = 'rr-wrap' + (extraClass ? ' ' + extraClass : '');
    wrap.dataset.key = key;
    const b = document.createElement('span');
    if (!ev) {
      b.className = 'rr-badge rr-grey rr-loading';
      b.textContent = 'Checking remote…';
    } else {
      b.className = `rr-badge rr-${ev.tone}`;
      b.textContent = `${ev.icon} ${ev.text}`;
      b.title = `${ev.tip}\n\nClick: copy a report (handy if this badge looks wrong)`;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyReport(id, b);
      });
    }
    wrap.appendChild(b);
    return wrap;
  }

  // ------------------------------------------------------- company & block list
  // The company comes from the card's /company/ link, else from the line right under the title.
  function companyOf(card, id) {
    const m = meta.get(id) || {};
    if (m.company) return m.company;
    let name = '';
    for (const a of card.querySelectorAll('a[href*="/company/"]')) {
      const t = (a.textContent || '').trim();
      if (t && t.length <= 80) { name = t; break; }
    }
    if (!name && m.title) {
      const lines = (card.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const i = lines.findIndex((l) => norm(l) === norm(m.title));
      const next = i >= 0 ? lines.slice(i + 1).find((l) => !/verif/i.test(l)) : '';
      if (next && next.length <= 80 && !RR.workplaceOf(next) && !/\(\s*[^)]+\)\s*$/.test(next)) name = next;
    }
    if (name) meta.set(id, { ...m, company: name });
    return name;
  }

  const visibleLeaf = (root, text) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.children.length || el.closest('.rr-wrap, .rr-block')) continue;
      if ((el.textContent || '').trim() !== text) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) return el; // skips screen-reader-only copies of the name
    }
    return null;
  };

  function ensureBlockLink(card, company) {
    const old = card.querySelector('.rr-block');
    if (!company) { if (old) old.remove(); return; }
    if (old && old.dataset.company === company) return;
    if (old) old.remove();
    const el = visibleLeaf(card, company);
    if (!el) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rr-block';
    btn.dataset.company = company;
    btn.title = `Hide all jobs from ${company}`;
    btn.setAttribute('aria-label', `Block ${company}`);
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); blockCompany(company); });
    const p = el.parentElement;
    const host = el.tagName === 'A' && p && p !== card && (p.textContent || '').trim() === (el.textContent || '').trim() ? p : el;
    if (host.tagName === 'A') host.after(btn); else host.appendChild(btn);
  }

  function saveBlocked(list) {
    settings.blockedCompanies = list;
    renderAll();
    if (alive()) chrome.storage.sync.set({ blockedCompanies: list }).catch((e) => log(e));
  }

  function blockCompany(name) {
    const before = settings.blockedCompanies || [];
    saveBlocked(RR.isBlockedCompany(name, before) ? before : [...before, name]);
    toast(`Blocked ${name}`, () => saveBlocked((settings.blockedCompanies || []).filter((b) => !RR.isBlockedCompany(name, [b]))));
  }

  function toast(text, undo) {
    document.querySelectorAll('.rr-toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'rr-toast';
    const msg = document.createElement('span');
    msg.textContent = text;
    const u = document.createElement('button');
    u.type = 'button';
    u.textContent = 'Undo';
    u.addEventListener('click', () => { undo(); t.remove(); });
    t.append(msg, u);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
  }

  const leafWith = (root, text) => {
    const t = (text || '').trim();
    if (!t) return null;
    for (const el of root.querySelectorAll('*')) {
      if (el.children.length || el.closest('.rr-wrap')) continue;
      const x = (el.textContent || '').trim();
      if (x && (x === t || (t.length > 8 && x.includes(t)))) return el;
    }
    return null;
  };
  const lcaOf = (a, b) => {
    const up = new Set();
    for (let n = a; n; n = n.parentElement) up.add(n);
    for (let n = b; n; n = n.parentElement) if (up.has(n)) return n;
    return null;
  };

  // Put the badge in the text column of the card, just above the job title.
  // Falls back to the very top of the card, which works whatever the inner markup is.
  function placeBadge(card, wrap, id) {
    const m = meta.get(id) || {};
    let titleEl = card.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
    const tl = titleEl ? (titleEl.textContent || '').trim().length : 0;
    if (!titleEl || tl === 0 || tl > 200) titleEl = leafWith(card, m.title);
    if (titleEl) {
      const locEl = leafWith(card, m.location);
      let column = locEl ? lcaOf(titleEl, locEl) : null;
      if (!column || column === titleEl || !card.contains(column)) {
        column = titleEl.parentElement;
        while (column && column !== card && column.children.length < 2) column = column.parentElement;
      }
      if (column && card.contains(column) && column !== titleEl) {
        const cs = getComputedStyle(column);
        const row = (/flex/.test(cs.display) && !/column/.test(cs.flexDirection)) || /grid/.test(cs.display);
        if (!row) {
          let branch = titleEl;
          while (branch.parentElement && branch.parentElement !== column) branch = branch.parentElement;
          if (branch.parentElement === column) { branch.before(wrap); return; }
        }
      }
    }
    card.prepend(wrap);
  }

  function render(card, id) {
    let wrap = card.querySelector('.rr-wrap');
    if (!settings.enabled) {
      if (wrap) wrap.remove();
      const b = card.querySelector('.rr-block');
      if (b) b.remove();
      card.classList.remove('rr-hidden');
      return;
    }
    const { ev, key } = badgeKey(id);
    if (!wrap || wrap.dataset.key !== key) {
      if (wrap) wrap.remove();
      wrap = makeBadge(ev, key, '', id);
      placeBadge(card, wrap, id);
    }
    const company = companyOf(card, id);
    card.classList.toggle('rr-hidden', RR.isBlockedCompany(company, settings.blockedCompanies) || RR.hides(ev, settings));
    ensureBlockLink(card, company);
  }

  function renderId(id) {
    const card = lastCards.get(id);
    if (card && card.isConnected) render(card, id);
    else scheduleScan();
    if (id === currentJobId()) renderDetailBadge(id);
  }

  function renderAll() {
    for (const [id, card] of lastCards) if (card.isConnected) render(card, id);
    const id = currentJobId();
    if (id) renderDetailBadge(id);
  }

  // ---------------------------------------------------- open job (detail panel)
  function currentJobId() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams.get('currentJobId');
      if (q && /^\d+$/.test(q)) return q;
      const m = u.pathname.match(JOB_LINK);
      return m ? m[1] : null;
    } catch (_) { return null; }
  }

  const DETAIL_DESC_SEL = '#job-details, .jobs-description__content, .jobs-description-content__text, .jobs-box__html-content, [data-testid="expandable-text-box"]';
  const DETAIL_TITLE_SEL = '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .jobs-search__job-details--container h1, .jobs-details h1, .job-view-layout h1';
  const ABOUT_JOB = /^(about the job|à propos de l[’']offre d[’']emploi|à propos du poste|acerca del empleo|sobre el empleo|info zum job|über den job|informazioni sull[’']offerta di lavoro|sobre a vaga)$/i;

  function findDetailDescription() {
    const direct = document.querySelector(DETAIL_DESC_SEL);
    if (direct && (direct.innerText || '').trim().length > 100) return direct;
    // Language-based fallback: the block under the "About the job" heading.
    for (const h of document.querySelectorAll('h1, h2, h3, h4, span, strong')) {
      if (h.children.length > 2) continue;
      if (!ABOUT_JOB.test((h.textContent || '').trim())) continue;
      let n = h;
      for (let i = 0; i < 5 && n.parentElement; i++) {
        const p = n.parentElement;
        // Never grow into a block that also holds the job list or the job title.
        if (p.querySelector('h1, [data-occludable-job-id], [role="list"], a[href*="currentJobId="]')) break;
        n = p;
        if ((n.innerText || '').trim().length > 300) break;
      }
      if (n !== h && (n.innerText || '').trim().length > 100) return n;
    }
    return null;
  }

  function detailTitleEl(descEl) {
    let n = descEl;
    for (let i = 0; i < 10 && n; i++) {
      n = n.parentElement;
      const h = n && n.querySelector('h1');
      if (h) return h;
    }
    return document.querySelector(DETAIL_TITLE_SEL);
  }

  const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let lastDetailSig = '';

  function handleDetail() {
    const id = currentJobId();
    if (!id) { stats.detail = 'no job open'; return; }
    const descEl = findDetailDescription();
    if (!descEl) { stats.detail = 'description not found'; return; }
    const text = (descEl.innerText || '').trim();
    if (text.length < 100) { stats.detail = 'description too short'; return; }
    const h1 = detailTitleEl(descEl);
    const title = h1 ? h1.innerText.trim() : '';

    // While switching jobs the panel can briefly show the previous posting: make sure titles match.
    const known = meta.get(id);
    if (known && known.title && title) {
      const a = norm(known.title), b = norm(title);
      if (a && b && !a.includes(b) && !b.includes(a)) { stats.detail = 'waiting for panel'; return; }
    }
    stats.detail = 'ok';
    keepText(id, text);

    const sig = `${id}:${text.length}`;
    if (sig !== lastDetailSig) {
      lastDetailSig = sig;
      let m = known;
      if (!m) {
        const top = h1 ? (h1.closest('section, [class*="top-card"]') || h1.parentElement) : null;
        const topText = top ? top.innerText.slice(0, 800) : '';
        m = { title, location: '', workplace: RR.workplaceOf(topText) };
      }
      store(id, RR.classify({ ...m, description: text }), true);
      const card = lastCards.get(id);
      if (card && card.isConnected) render(card, id);
    }
    renderDetailBadge(id);
  }

  function renderDetailBadge(id) {
    const descEl = findDetailDescription();
    const h1 = descEl ? detailTitleEl(descEl) : document.querySelector(DETAIL_TITLE_SEL);
    let w = document.querySelector('.rr-wrap.rr-detail');
    if (!settings.enabled || !h1 || !results.has(id)) {
      if (w && (!settings.enabled || !h1)) w.remove();
      return;
    }
    const { ev, key } = badgeKey(id);
    const ref = h1.closest('a') || h1;
    if (w && w.dataset.key === key && w.nextElementSibling === ref) return;
    if (w) w.remove();
    w = makeBadge(ev, key, 'rr-detail', id);
    ref.before(w);
  }

  // ------------------------------------------------------- status chip & diagnostics
  let chip = null;
  let chipClosed = false;

  function ensureChip() {
    if (chipClosed || !settings.enabled || !onJobsPage()) {
      if (chip) chip.remove();
      chip = null;
      return null;
    }
    if (chip && chip.isConnected) return chip;
    chip = document.createElement('div');
    chip.className = 'rr-chip';
    chip.innerHTML = '<button class="rr-chip-main" type="button"></button><button class="rr-chip-copy" type="button" title="Copy diagnostics to send to the developer">Copy diagnostics</button><button class="rr-chip-x" type="button" title="Hide until next page load">×</button>';
    chip.querySelector('.rr-chip-main').addEventListener('click', () => chip.classList.toggle('rr-open'));
    chip.querySelector('.rr-chip-x').addEventListener('click', () => { chipClosed = true; chip.remove(); chip = null; });
    chip.querySelector('.rr-chip-copy').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(diagnostics());
        btn.textContent = 'Copied ✓';
      } catch (_) {
        console.log(diagnostics());
        btn.textContent = 'Printed to console';
      }
      setTimeout(() => (btn.textContent = 'Copy diagnostics'), 2000);
    });
    document.body.appendChild(chip);
    return chip;
  }

  function updateChip() {
    const c = ensureChip();
    if (!c) return;
    const checked = [...lastCards.keys()].filter((id) => results.has(id)).length;
    const main = c.querySelector('.rr-chip-main');
    const paused = pausedUntil > Date.now() ? ' · paused (LinkedIn rate limit)' : '';
    main.textContent = stats.cards
      ? `📡 Remote Radar · ${checked}/${stats.cards} jobs checked${paused}`
      : stats.orphans
        ? `📡 Remote Radar · ${stats.orphans} jobs found, can't read their IDs — click for help`
        : '📡 Remote Radar · no job cards found yet';
    c.classList.toggle('rr-warn', !stats.cards && stats.scans > 2);
  }

  function diagnostics() {
    const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch (_) { return 'err'; } };
    const sample = (() => {
      const first = lastCards.values().next().value;
      const el = first || document.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="], [data-occludable-job-id], [data-job-id]');
      const node = first || (el && (el.closest('li') || el.parentElement && el.parentElement.parentElement));
      if (!node) return '(no candidate element)';
      return node.outerHTML.replace(/\s(?:class|style)="[^"]{60,}"/g, ' class="…"').replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').slice(0, 2500);
    })();
    const unbadged = (() => {
      const detail = detailRoot();
      const items = [...document.querySelectorAll('main li, main [role="listitem"], main [role="button"]')].filter((n) => {
        const len = (n.innerText || '').trim().length;
        return len > 30 && len < 1500 && !n.querySelector('.rr-wrap') && !n.closest('.rr-wrap, .rr-chip')
          && !(detail && (detail.contains(n) || n.contains(detail)))
          && ![...lastCards.values()].some((c) => c.contains(n) || n.contains(c));
      });
      const clean = (n) => n.outerHTML.replace(/\s(?:class|style)="[^"]{60,}"/g, ' class="…"').replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').slice(0, 1800);
      return `${items.length} candidates\n` + (items.slice(0, 3).map(clean).join('\n---\n') || '(none)');
    })();
    const listSample = (() => {
      const items = [...document.querySelectorAll('main li, [role="list"] > *')].filter((n) => (n.innerText || '').trim().length > 30).slice(0, 2);
      return items.map((n) => n.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').slice(0, 1500)).join('\n---\n') || '(none)';
    })();
    return [
      `Remote Radar ${VERSION} diagnostics`,
      `URL path: ${location.pathname}${location.search ? ' (has query)' : ''}`,
      `UI language: ${document.documentElement.lang || '?'} | browser: ${navigator.language}`,
      `Location-line leaves: ${stats.workplaceLeaves} | cards without readable ID: ${stats.orphans}`,
      `Cards found: ${stats.cards} | checked: ${[...lastCards.keys()].filter((id) => results.has(id)).length} | scans: ${stats.scans}`,
      `Fetch ok/empty/error: ${stats.fetchOk}/${stats.fetchEmpty}/${stats.fetchErr} | last HTTP status: ${stats.lastStatus} | last error: ${stats.lastError}`,
      `Queue: ${queue.length} waiting, ${active} running${pausedUntil > Date.now() ? ', paused' : ''}`,
      `Detail panel: ${stats.detail} | currentJobId: ${currentJobId()}`,
      `Selector counts: occludable=${count('[data-occludable-job-id]')} data-job-id=${count('[data-job-id]')} view-links=${count('a[href*="/jobs/view/"]')} currentJobId-links=${count('a[href*="currentJobId="]')} urn=${count('[data-entity-urn*="obPosting"],[data-urn*="obPosting"],[componentkey*="obPosting"]')} li=${count('main li')} role-button=${count('main [role="button"]')}`,
      '',
      '--- first card / candidate ---',
      sample,
      '',
      '--- card whose job ID could not be read ---',
      stats.orphanSample ? stats.orphanSample.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').slice(0, 2500) : '(none)',
      '',
      '--- list items with no badge and no card ---',
      unbadged,
      '',
      '--- list items sample ---',
      listSample,
    ].join('\n');
  }

  // ------------------------------------------------------------------ scan
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan().catch((e) => { stats.lastError = String(e && e.message); log(e); });
    }, 200);
  }

  async function scan() {
    if (!alive()) { stop(); return; }
    if (!onJobsPage()) { ensureChip(); return; }
    stats.scans++;
    if (!settings.enabled) { lastCards = findCards(); renderAll(); ensureChip(); return; }

    const cards = findCards();
    lastCards = cards;
    stats.cards = cards.size;
    await hydrate([...cards.keys()]);

    for (const [id, card] of cards) {
      if (!hasContent(card)) continue; // virtualised placeholder, not rendered yet
      const m = meta.get(id);
      if (!m || !m.location) {
        const fresh = readCardMeta(card);
        if (fresh.title || fresh.location) meta.set(id, fresh);
      }
      if (RR.isBlockedCompany(companyOf(card, id), settings.blockedCompanies)) { render(card, id); continue; } // no lookup for blocked companies
      if (!results.has(id)) {
        const mm = meta.get(id) || {};
        if (mm.workplace === 'onsite' || mm.workplace === 'hybrid') store(id, RR.classify(mm), true);
        else if (nearViewport(card)) enqueue(id);
      }
      render(card, id);
    }
    handleDetail();
    updateChip();
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of [...m.addedNodes, ...m.removedNodes]) {
        if (n.nodeType !== 1) continue;
        if (n.classList && (n.classList.contains('rr-chip') || n.classList.contains('rr-block') || n.classList.contains('rr-toast') || (n.classList.contains('rr-wrap') && m.addedNodes.length))) continue;
        return scheduleScan();
      }
    }
  });

  let interval = null;
  function stop() {
    observer.disconnect();
    if (interval) clearInterval(interval);
  }

  // -------------------------------------------------------------- boot
  async function init() {
    await loadSettings();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Scrolling happens inside LinkedIn's own list container, so listen in the capture phase.
    let scrollTimer = null;
    document.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(scheduleScan, 250);
    }, { capture: true, passive: true });
    interval = setInterval(() => { if (!document.hidden) scheduleScan(); }, 2500); // SPA navigation safety net
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (const [k, { newValue }] of Object.entries(changes)) if (k in RR.DEFAULT_SETTINGS) settings[k] = newValue;
        if (!settings.homeCountry) settings.homeCountry = RR.guessHomeCountry(navigator.languages || [navigator.language]);
        renderAll();
        scheduleScan();
      } else if (area === 'local' && changes.rrEpoch) {
        results.clear();
        lookedUp.clear();
        queued.clear();
        queue.length = 0;
        lastDetailSig = '';
        document.querySelectorAll('.rr-wrap').forEach((w) => w.remove());
        scheduleScan();
      }
    });
    pruneCache();
    scan().catch((e) => log(e));
    log(`v${VERSION} loaded`);
  }

  init();
})();
