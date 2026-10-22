/*
 * Judge Translate - content script: floating translate button + orchestration.
 * Loaded on known judges (manifest) or injected on demand into any page (shortcut/popup).
 */
(() => {
  'use strict';
  const J = window.JudgeTr;
  if (window.__judgeTranslateLoaded || !J || !J.collectUnits) return;
  window.__judgeTranslateLoaded = true;

  const api = globalThis.browser || globalThis.chrome;
  const CONCURRENCY = 4;

  const adapter = J.findAdapter ? J.findAdapter(location.hostname) : null;
  let settings = { target: J.defaultTarget(navigator.language), service: 'google' };
  let units = [];
  let state = 'idle'; // idle | translating | translated | error
  let progress = { done: 0, total: 0 };
  let note = '';
  let run = null;
  let forceVisible = false;
  let host = null;
  let btn = null;

  // ----------------------------------------------------------------- settings

  const ready = (async () => {
    try {
      const s = await api.storage.sync.get({ target: settings.target, service: settings.service });
      settings = { ...settings, ...s };
    } catch (_) { /* keep defaults */ }
  })();

  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) if (k in settings) settings[k] = changes[k].newValue;
    });
  } catch (_) { /* storage events are optional */ }

  // ------------------------------------------------------------------- button

  const CSS = `
    :host { all: initial; }
    button {
      all: unset; box-sizing: border-box; position: fixed; right: 16px; bottom: 16px;
      z-index: 2147483647; display: flex; align-items: center; gap: 8px;
      padding: 9px 14px; border-radius: 999px; background: #1f6feb; color: #fff;
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.28); cursor: pointer; user-select: none;
      transition: transform .12s ease, background .2s ease;
    }
    button:hover { transform: translateY(-1px); }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 4px #1f6feb; }
    button[data-state="translating"] { background: #6e7681; }
    button[data-state="translated"] { background: #1a7f37; }
    button[data-state="error"] { background: #cf222e; }
    svg { width: 16px; height: 16px; flex: none; }
    button[data-state="translating"] svg { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media print { button { display: none; } }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } button[data-state="translating"] svg { animation: none; } }
  `;

  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6.5 8M12 5c-.5 3-3 6.5-7 8"/><path d="M13 21l4-9 4 9M14.4 18h5.2"/></svg>';

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'judge-translate-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = ICON + '<span class="lb"></span>';
    btn.addEventListener('click', () => { toggle(); });
    shadow.append(style, btn);
    (document.body || document.documentElement).appendChild(host);
    render();
  }

  function unmount() {
    if (host) host.remove();
    host = null;
    btn = null;
  }

  function render() {
    if (!btn) return;
    btn.dataset.state = state;
    const lb = btn.querySelector('.lb');
    let title = J.t('hint');
    if (state === 'idle') lb.textContent = J.t('translate');
    else if (state === 'translating') {
      lb.textContent = `${J.t('translating')} ${progress.done}/${progress.total}`;
      title = J.t('cancelHint');
    } else if (state === 'translated') {
      lb.textContent = J.t('original');
      if (note) title = note;
    } else {
      lb.textContent = J.t('error');
      title = note || title;
    }
    btn.title = title;
  }

  // -------------------------------------------------------------- translation

  async function requestTranslate(text) {
    const res = await api.runtime.sendMessage({
      type: 'translate',
      text,
      target: settings.target,
      service: settings.service,
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'no response');
    return res.text;
  }

  function getRoots() {
    const roots = adapter ? adapter.roots(document) : [];
    if (roots.length || (adapter && adapter.noGeneric)) return roots;
    return J.genericRoots(document);
  }

  function ensureUnits() {
    if (units.length && units.every((u) => u.anchor.isConnected)) return;
    for (const u of units) {
      J.showOriginal(u);
      u.anchor.remove();
    }
    units = J.collectUnits(getRoots());
  }

  async function pool(items, size, worker) {
    let i = 0;
    const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    });
    await Promise.all(lanes);
  }

  async function startTranslate() {
    await ready;
    ensureUnits();
    if (!units.length) { state = 'idle'; render(); return; }
    const myRun = { cancelled: false };
    run = myRun;
    state = 'translating';
    note = '';
    const key = `${settings.service}|${settings.target}`;
    const todo = units.filter((u) => u.key !== key);
    for (const u of units) if (u.key === key) J.showTranslated(u);
    progress = { done: units.length - todo.length, total: units.length };
    render();

    let failed = 0;
    let kept = 0;
    let lastError = '';
    await pool(todo, CONCURRENCY, async (u) => {
      if (myRun.cancelled) return;
      try {
        const r = await J.translateUnit(u, requestTranslate, { isCancelled: () => myRun.cancelled });
        if (r.mode === 'kept') kept++;
        if (r.mode !== 'cancelled') u.key = key;
      } catch (e) {
        failed++;
        lastError = (e && e.message) || String(e);
      }
      progress.done++;
      if (!myRun.cancelled) render();
    });
    if (myRun.cancelled) return;

    if (todo.length && failed === todo.length) {
      state = 'error';
      note = lastError;
    } else {
      state = 'translated';
      const left = failed + kept;
      note = left ? J.t('partial', { n: left }) : '';
    }
    render();
  }

  function showOriginalAll() {
    for (const u of units) J.showOriginal(u);
  }

  async function toggle() {
    if (state === 'translating') {
      run.cancelled = true;
      showOriginalAll();
      state = 'idle';
    } else if (state === 'translated') {
      showOriginalAll();
      state = 'idle';
    } else {
      await startTranslate();
      return;
    }
    render();
  }

  // ----------------------------------------------------------- wiring / events

  try {
    api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'toggle') {
        if (adapter && adapter.noGeneric && !adapter.roots(document).length) {
          sendResponse({ ok: true });
          return false;
        }
        forceVisible = true;
        mount();
        toggle().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
        return true;
      }
      return false;
    });
  } catch (_) { /* not in an extension context */ }

  function refreshVisibility() {
    // The statement lived in a frame/container that was replaced (e.g. switching problems):
    // forget the old units so the button goes back to "Translate" for the new content.
    if (units.length && state !== 'translating' && !units.every((u) => u.anchor.isConnected)) {
      units = [];
      state = 'idle';
      note = '';
      render();
    }
    const has = adapter && adapter.roots(document).length > 0;
    if (has || forceVisible) mount();
    else if (state === 'idle') unmount();
  }

  if (adapter) {
    refreshVisibility();
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refreshVisibility, 600);
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Changes inside iframes are invisible to this observer: poll on judges that use them.
    if (adapter.poll) setInterval(refreshVisibility, 1500);
  }
})();
