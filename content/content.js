/*
 * Hiraku Judges Translator - content script: floating translate button + orchestration.
 * Loaded on known judges (manifest) or injected on demand into any page (shortcut/popup).
 *
 * Besides HTML statements it finds PDF statements (UVa, Codeforces Gym, ICPC archives...)
 * and opens them in the extension's PDF reader, which translates them.
 */
(() => {
  'use strict';
  const J = window.JudgeTr;
  if (window.__judgeTranslateLoaded || !J || !J.collectUnits) return;
  window.__judgeTranslateLoaded = true;

  const api = globalThis.browser || globalThis.chrome;
  const CONCURRENCY = 4;
  const MAX_INLINE_PDF = 7 * 1024 * 1024;
  const isPdfDocument = document.contentType === 'application/pdf';

  const adapter = J.findAdapter ? J.findAdapter(location.hostname) : null;
  let settings = {
    target: J.defaultTarget(navigator.language),
    service: 'google',
    keep: J.DEFAULT_KEEP,
    hoverOriginal: true,
  };
  let units = [];
  let state = 'idle'; // idle | translating | translated | error
  let progress = { done: 0, total: 0 };
  let note = '';
  let run = null;
  let forceVisible = false;
  let host = null;
  let btn = null;
  let mode = 'html'; // html | pdf | viewer: what the floating button does
  let pdfs = [];
  let viewers = []; // embedded PDF viewers (pdf.js) found in the page
  let inline = null; // {box, doc, frame, prevDisplay}: translation shown in place of a viewer

  // ----------------------------------------------------------------- settings

  const ready = (async () => {
    try {
      const s = await api.storage.sync.get(settings);
      settings = { ...settings, ...s };
    } catch (_) { /* keep defaults */ }
  })();

  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) if (k in settings) settings[k] = changes[k].newValue;
      if ('keep' in changes && state !== 'translating') resetUnits();
      if ('hoverOriginal' in changes) setHoverTitles(state === 'translated' && settings.hoverOriginal);
    });
  } catch (_) { /* storage events are optional */ }

  // ------------------------------------------------------------------- button

  const CSS = `
    :host { all: initial; }
    button {
      all: unset; box-sizing: border-box; position: fixed; right: 16px; bottom: 16px;
      z-index: 2147483647; display: flex; align-items: center; gap: 8px;
      padding: 9px 14px; border-radius: 999px; background: #c8186f; color: #fff;
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.28); cursor: pointer; user-select: none;
      transition: transform .12s ease, background .2s ease;
    }
    button:hover { transform: translateY(-1px); }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 4px #c8186f; }
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
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
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
    const icon = new DOMParser().parseFromString(ICON, 'image/svg+xml').documentElement;
    const lb = document.createElement('span');
    lb.className = 'lb';
    btn.append(document.importNode(icon, true), lb);
    btn.addEventListener('click', () => { onButton(); });
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
    if (mode === 'pdf' && state === 'idle') {
      lb.textContent = J.t('translatePdf');
      btn.title = J.t('translatePdfHint') + (pdfs[0] ? ` (${pdfs[0].title})` : '');
      return;
    }
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

  function onButton() {
    if (mode === 'viewer') {
      toggleInline();
      return;
    }
    if (mode === 'pdf' && state === 'idle') {
      if (pdfs[0]) openPdf(pdfs[0].url, pdfs[0].title);
      return;
    }
    toggle();
  }

  // ---------------------------------------------------------------- PDF reader

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /**
   * Open a PDF in the reader. Same-origin PDFs are downloaded here first, with the page's
   * cookies, so statements behind a login (Codeforces Gym, private contests) also work.
   */
  async function openPdf(url, title) {
    let data = null;
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin) {
        const res = await fetch(u.href, { credentials: 'include' });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const head = new Uint8Array(buf.slice(0, 5));
          const isPdf = String.fromCharCode(...head) === '%PDF-';
          if (isPdf && buf.byteLength <= MAX_INLINE_PDF) data = toBase64(buf);
        }
      }
    } catch (_) { /* the reader will try the URL itself */ }
    try {
      await api.runtime.sendMessage({ type: 'open-pdf', url, data, title });
    } catch (_) { /* extension reloaded: nothing to do */ }
  }

  const CHIP_STYLE =
    'display:inline-block;margin:0 0 0 6px;padding:2px 8px;border-radius:999px;background:#c8186f;' +
    'color:#fff;font:600 11px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;' +
    'vertical-align:middle;text-decoration:none;user-select:none;white-space:nowrap;';

  /** A small "Translate PDF" chip right after every PDF link / above every embedded PDF. */
  function decoratePdfs() {
    for (const p of pdfs) {
      const el = p.el;
      if (!el || el.dataset.jtPdf || !el.isConnected) continue;
      el.dataset.jtPdf = '1';
      const doc = el.ownerDocument;
      const chip = doc.createElement('a');
      chip.href = '#';
      chip.className = 'jt-pdf-chip notranslate';
      chip.setAttribute('translate', 'no');
      chip.setAttribute('role', 'button');
      chip.style.cssText = CHIP_STYLE;
      chip.textContent = '⇄ ' + J.t('translatePdf');
      chip.title = J.t('translatePdfHint');
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPdf(p.url, p.title);
      });
      if (p.embedded) {
        const bar = doc.createElement('div');
        bar.className = 'jt-pdfbar notranslate';
        bar.style.cssText = 'margin:4px 0;text-align:left;';
        chip.style.margin = '0';
        bar.appendChild(chip);
        el.parentNode && el.parentNode.insertBefore(bar, el);
      } else {
        el.insertAdjacentElement('afterend', chip);
      }
    }
  }

  // ------------------------------------------------- PDF viewers in the page

  async function bytesFrom(url) {
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin) {
        const res = await fetch(u.href, { credentials: 'include' });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (new TextDecoder('latin1').decode(new Uint8Array(buf.slice(0, 1024))).includes('%PDF-')) {
            return buf.byteLength <= MAX_INLINE_PDF ? toBase64(buf) : null;
          }
          return null; // same origin and not a PDF: no need to ask the background
        }
      }
    } catch (_) { /* try through the extension */ }
    try {
      const r = await api.runtime.sendMessage({ type: 'fetch-pdf', url });
      return r && r.ok ? r.data : null;
    } catch (_) {
      return null;
    }
  }

  function isDark(el) {
    const win = el.ownerDocument.defaultView;
    for (let e = el; e; e = e.parentElement) {
      const m = win.getComputedStyle(e).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m) continue;
      const [r, g, b, a = 1] = m.map(Number);
      if (a < 0.5) continue;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
    }
    return win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function removeInline() {
    if (!inline) return;
    if (inline.frame) inline.frame.remove();
    if (inline.box) inline.box.style.display = inline.prevDisplay;
    inline = null;
  }

  function hideInline() {
    if (!inline) return;
    inline.frame.style.display = 'none';
    inline.box.style.display = inline.prevDisplay;
  }

  /** Swap the site's PDF viewer for the translated text (and back). */
  async function toggleInline() {
    const v = viewers[0];
    if (!v) return;
    if (state === 'translating') return;
    if (state === 'translated') {
      hideInline();
      state = 'idle';
      render();
      return;
    }
    if (inline && inline.doc === v.doc && inline.box.isConnected) {
      inline.box.style.display = 'none';
      inline.frame.style.display = 'block';
      state = 'translated';
      render();
      return;
    }
    removeInline();
    state = 'translating';
    progress = { done: 0, total: v.candidates.length };
    note = '';
    render();
    // what the frames themselves loaded (seen only from the page's own world)
    let candidates = v.candidates.slice();
    try {
      const r = await api.runtime.sendMessage({ type: 'probe-pdf-frames' });
      const probed = (r && r.urls) || [];
      const strong = probed.filter((x) => x.strong).map((x) => x.url);
      const weak = probed.filter((x) => !x.strong).map((x) => x.url);
      candidates = [...new Set([...strong, ...candidates, ...weak])];
    } catch (_) { /* keep what the DOM gave */ }
    progress = { done: 0, total: candidates.length };
    let found = null;
    for (const url of candidates) {
      const data = await bytesFrom(url);
      progress.done++;
      render();
      if (data) { found = { url, data }; break; }
    }
    if (!found) {
      state = 'error';
      note = J.t('viewerNoPdf');
      render();
      return;
    }
    let id = null;
    try {
      const r = await api.runtime.sendMessage({ type: 'stash-pdf', data: found.data });
      id = r && r.ok ? r.id : null;
    } catch (_) { /* below */ }
    if (!id) {
      state = 'error';
      note = J.t('viewerNoPdf');
      render();
      return;
    }
    const box = v.box;
    const d = box.ownerDocument;
    const height = Math.max(520, Math.min(box.getBoundingClientRect().height || 0, (d.defaultView.innerHeight || 900) * 1.2));
    const params = new URLSearchParams({ embed: '1', blob: id, url: found.url, theme: isDark(box.parentElement || box) ? 'dark' : 'light' });
    const frame = d.createElement('iframe');
    frame.className = 'jt-inline-reader';
    frame.src = api.runtime.getURL('reader/reader.html') + '?' + params.toString();
    frame.setAttribute('allow', 'clipboard-write');
    frame.title = 'Hiraku Judges Translator';
    frame.style.cssText = `display:block;width:100%;height:${Math.round(height)}px;border:0;border-radius:6px;background:transparent;`;
    inline = { box, doc: v.doc, frame, prevDisplay: box.style.display };
    box.parentNode.insertBefore(frame, box.nextSibling);
    box.style.display = 'none';
    state = 'translated';
    note = '';
    render();
  }

  // -------------------------------------------------------------- copy samples

  function copyText(text, button) {
    const done = () => {
      const old = button.textContent;
      button.textContent = J.t('copied');
      setTimeout(() => { button.textContent = old; }, 1200);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (_) { /* ignore */ }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function addCopyButtons(roots) {
    for (const r of roots) {
      for (const pre of r.querySelectorAll('pre')) {
        if (pre.dataset.jtCopy || pre.closest('.jt-copybar')) continue;
        if (!(pre.textContent || '').trim()) continue;
        pre.dataset.jtCopy = '1';
        const doc = pre.ownerDocument;
        const bar = doc.createElement('div');
        bar.className = 'jt-copybar notranslate';
        bar.setAttribute('translate', 'no');
        bar.style.cssText = 'text-align:right;margin:2px 0;line-height:1;';
        const b = doc.createElement('a');
        b.href = '#';
        b.setAttribute('role', 'button');
        b.style.cssText = CHIP_STYLE + 'background:#6e7681;';
        b.textContent = J.t('copy');
        b.addEventListener('click', (e) => {
          e.preventDefault();
          let t = pre.innerText.replace(/\r/g, '');
          if (!t.endsWith('\n')) t += '\n';
          copyText(t, b);
        });
        bar.appendChild(b);
        pre.parentNode.insertBefore(bar, pre);
      }
    }
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

  function resetUnits() {
    setHoverTitles(false);
    for (const u of units) {
      J.showOriginal(u);
      u.anchor.remove();
    }
    units = [];
    if (state === 'translated' || state === 'error') state = 'idle';
    note = '';
    render();
  }

  function ensureUnits() {
    if (units.length && units.every((u) => u.anchor.isConnected)) return;
    resetUnits();
    units = J.collectUnits(getRoots(), { keep: J.keepPattern(settings.keep) });
  }

  /** "Show original on hover": the block holding a translated passage gets it as a tooltip. */
  function setHoverTitles(on) {
    const byParent = new Map();
    for (const u of units) {
      const p = u.anchor.parentNode;
      if (!p || p.nodeType !== 1) continue;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(u);
    }
    for (const [p, list] of byParent) {
      if (on && list.some((u) => u.transLayout)) {
        const text = list.map((u) => J.originalText(u)).join('\n');
        if (text.length > 1500) continue;
        if (!('jtTitle' in p.dataset)) p.dataset.jtTitle = p.getAttribute('title') || '';
        p.setAttribute('title', text);
      } else if ('jtTitle' in p.dataset) {
        if (p.dataset.jtTitle) p.setAttribute('title', p.dataset.jtTitle);
        else p.removeAttribute('title');
        delete p.dataset.jtTitle;
      }
    }
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
      setHoverTitles(settings.hoverOriginal);
    }
    render();
  }

  function showOriginalAll() {
    setHoverTitles(false);
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

  function refreshPdfs() {
    pdfs = J.findPdfs ? J.findPdfs(document) : [];
    if (adapter) decoratePdfs();
  }

  try {
    api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'toggle') {
        // a PDF viewer embedded in the page (vjudge, contest sites...): translate in place
        if (J.findPdfViewers && !isPdfDocument) {
          viewers = J.findPdfViewers(document);
          if (viewers.length || mode === 'viewer') {
            mode = 'viewer';
            forceVisible = true;
            mount();
            toggleInline().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
            return true;
          }
        }
        // a PDF opened directly in the browser's viewer
        if (isPdfDocument) {
          openPdf(location.href, document.title);
          sendResponse({ ok: true });
          return false;
        }
        const roots = adapter ? adapter.roots(document) : [];
        if (adapter && adapter.noGeneric && !roots.length) {
          refreshPdfs();
          if (pdfs[0]) openPdf(pdfs[0].url, pdfs[0].title);
          sendResponse({ ok: true });
          return false;
        }
        if (!roots.length && state === 'idle') {
          // unknown site without a statement but with a PDF: open the PDF instead
          refreshPdfs();
          const embedded = pdfs.find((p) => p.embedded);
          const generic = J.collectUnits(J.genericRoots(document), {});
          const textLen = generic.reduce((n, u) => n + u.enc.text.length, 0);
          for (const u of generic) u.anchor.remove();
          if (embedded && textLen < 400) {
            openPdf(embedded.url, embedded.title);
            sendResponse({ ok: true });
            return false;
          }
        }
        forceVisible = true;
        mode = 'html';
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
    viewers = J.findPdfViewers ? J.findPdfViewers(document) : [];
    // the problem changed under our translation (another problem loaded in the viewer)
    // (compared by document: while hidden, the viewer's box may be found as a different element)
    if (inline && (!inline.box.isConnected || !inline.frame.isConnected || !viewers.some((v) => v.doc === inline.doc))) {
      removeInline();
      if (state !== 'translating') { state = 'idle'; note = ''; render(); }
    }
    if (viewers.length) {
      if (mode !== 'viewer' && state !== 'translating') {
        if (state === 'translated') showOriginalAll();
        mode = 'viewer';
        state = inline && inline.frame.style.display !== 'none' ? 'translated' : 'idle';
        render();
      }
      mount();
      return;
    }
    if (mode === 'viewer' && state !== 'translating') { mode = 'html'; state = 'idle'; render(); }
    const roots = adapter ? adapter.roots(document) : [];
    if (adapter && adapter.copy) addCopyButtons(roots);
    refreshPdfs();
    const has = roots.length > 0;
    const newMode = !has && !forceVisible && pdfs.length ? 'pdf' : 'html';
    if (newMode !== mode && state === 'idle') { mode = newMode; render(); }
    if (has || forceVisible || (mode === 'pdf' && pdfs.length)) mount();
    else if (state === 'idle') unmount();
  }

  if (adapter && !isPdfDocument) {
    refreshVisibility();
    let timer = null;
    new MutationObserver((records) => {
      // ignore our own insertions (chips, copy bars)
      if (records.every((r) => Array.from(r.addedNodes).every((n) => n.nodeType === 1 && /jt-|judge-translate/.test(n.className + ' ' + n.id)))) return;
      clearTimeout(timer);
      timer = setTimeout(refreshVisibility, 600);
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Changes inside iframes are invisible to this observer: poll on judges that use them.
    if (adapter.poll) setInterval(refreshVisibility, 1500);
  }
})();
