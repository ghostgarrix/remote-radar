(async () => {
  'use strict';
  const RR = globalThis.RemoteRadar;
  const $ = (id) => document.getElementById(id);

  const s = { ...RR.DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(RR.DEFAULT_SETTINGS)) };
  const guessed = RR.guessHomeCountry(navigator.languages || [navigator.language]);

  // Home country
  const home = $('home');
  home.add(new Option('Choose your country…', ''));
  for (const o of RR.HOME_OPTIONS) home.add(new Option(o.name, o.value));
  home.value = s.homeCountry || guessed || '';
  home.addEventListener('change', () => chrome.storage.sync.set({ homeCountry: home.value }));

  // Toggles
  $('enabled').checked = s.enabled;
  $('enabled').addEventListener('change', (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
  for (const k of ['includeOrange', 'includeOnsite']) {
    $(k).checked = s[k];
    $(k).addEventListener('change', (e) => chrome.storage.sync.set({ [k]: e.target.checked }));
  }
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === (s.mode === 'hide' ? 'hide' : 'show');
    r.addEventListener('change', () => chrome.storage.sync.set({ mode: r.value }));
  });

  // Cache stats / reset
  async function stats() {
    const all = await chrome.storage.local.get(null);
    const n = Object.keys(all).filter((k) => k.startsWith(RR.CACHE_PREFIX)).length;
    $('stats').textContent = n ? `${n} job${n > 1 ? 's' : ''} checked` : 'No jobs checked yet';
  }
  $('clear').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => /^rr\d+:/.test(k)));
    await chrome.storage.local.set({ rrEpoch: Date.now() }); // tells open LinkedIn tabs to re-check
    stats();
  });
  stats();
})();
