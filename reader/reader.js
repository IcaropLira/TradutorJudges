/*
 * Hiraku Judges Translator - PDF reader.
 *
 * Opens a PDF statement (URL, file handed over by the content script, or a local file),
 * shows the original pages on one side and a reflowed, translatable version on the other.
 * Text is rebuilt from the PDF layout (shared/pdf-layout.js) into plain HTML - headings,
 * paragraphs, formulas, samples - and then translated by the same engine used on HTML
 * judges (shared/core.js): formulas and code become placeholders and are never sent.
 */
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

const api = globalThis.browser || globalThis.chrome;
const J = window.JudgeTr;
const L = J.pdfLayout;
const $ = (id) => document.getElementById(id);
const CONCURRENCY = 4;
const PARAMS = new URLSearchParams(location.search);
// embedded in a judge's page, in place of the site's own PDF viewer
const EMBED = PARAMS.get('embed') === '1';
if (EMBED) document.body.dataset.embed = '1';
if (/^(dark|light)$/.test(PARAMS.get('theme') || '')) document.documentElement.dataset.theme = PARAMS.get('theme');

pdfjsLib.GlobalWorkerOptions.workerSrc = api.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');

const S = {
  settings: { target: J.defaultTarget(navigator.language), service: 'google', keep: J.DEFAULT_KEEP, hoverOriginal: true },
  pdf: null,
  url: '',
  pages: [], // {num, page, width, height, el, canvas, rendered, renderTask, viewport}
  blocks: [], // {el, page, bbox, orig}
  sections: [], // {el, page, units|null, visible}
  translated: false,
  run: 0,
  queue: [],
  lanes: { active: 0 }, // requests in flight for the current run only
  progress: { done: 0, total: 0 },
  zoom: 1,
  // test hook: the end-to-end test provides a fake translator to avoid the network
  translateFn: typeof window.__jtTestTranslate === 'function' ? window.__jtTestTranslate : null,
};
window.__jtReader = S;

// ------------------------------------------------------------------ settings

async function loadSettings() {
  try {
    S.settings = { ...S.settings, ...(await api.storage.sync.get(S.settings)) };
  } catch (_) { /* defaults */ }
  try {
    const { readerLayout, readerZoom } = await api.storage.local.get({ readerLayout: 'split', readerZoom: 1 });
    setLayout(EMBED ? 'text' : readerLayout, false);
    S.zoom = readerZoom;
  } catch (_) { /* defaults */ }
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  let retranslate = false;
  for (const k of Object.keys(changes)) {
    if (!(k in S.settings)) continue;
    S.settings[k] = changes[k].newValue;
    if (k === 'target' || k === 'service') retranslate = true;
    if (k === 'target') $('target').value = S.settings.target;
  }
  if ('keep' in changes) {
    resetUnits();
    retranslate = true;
  }
  if ('hoverOriginal' in changes) refreshTitles();
  if (retranslate && S.translated) startTranslating();
});

// ------------------------------------------------------------------- toolbar

function setupToolbar() {
  $('lySplit').textContent = J.t('rdLayoutSplit');
  $('lyText').textContent = J.t('rdLayoutText');
  $('lyPdf').textContent = J.t('rdLayoutPdf');
  $('openTxt').textContent = J.t('rdOpen');
  $('dropTxt').textContent = J.t('rdDrop');
  $('urlGo').textContent = J.t('rdUrlGo');
  $('origLink').textContent = J.t('rdOriginalLink');
  $('openFull').textContent = '⤢ ' + J.t('rdOpenFull');
  $('openFull').hidden = !EMBED;
  $('openFull').addEventListener('click', async () => {
    // a new full-page reader for the same file (the bytes go through storage.session again)
    const params = new URLSearchParams();
    if (S.url) params.set('url', S.url);
    if (S.bytes) {
      const id = 'pdf:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      let bin = '';
      for (let i = 0; i < S.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, S.bytes.subarray(i, i + 0x8000));
      try {
        await api.storage.session.set({ [id]: btoa(bin) });
        params.set('blob', id);
      } catch (_) { /* the URL alone */ }
    }
    api.tabs.create({ url: api.runtime.getURL('reader/reader.html') + '?' + params.toString() });
  });
  document.documentElement.lang = J.uiLang(navigator.language) === 'pt' ? 'pt-BR' : 'en';
  for (const [code, name] of J.LANGS) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = name;
    $('target').appendChild(o);
  }
  $('target').value = S.settings.target;
  $('target').addEventListener('change', () => {
    S.settings.target = $('target').value;
    api.storage.sync.set({ target: S.settings.target }).catch(() => {});
    if (S.translated) startTranslating();
  });
  $('translate').addEventListener('click', toggleTranslate);
  renderTranslateButton();

  for (const b of $('layout').querySelectorAll('button')) {
    b.addEventListener('click', () => setLayout(b.dataset.layout, true));
  }
  $('zoomIn').addEventListener('click', () => setZoom(S.zoom * 1.15));
  $('zoomOut').addEventListener('click', () => setZoom(S.zoom / 1.15));

  $('file').addEventListener('change', () => {
    const f = $('file').files[0];
    if (f) openFile(f);
  });
  $('urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = $('urlInput').value.trim();
    if (u) openUrl(u);
  });
  $('drop').addEventListener('click', (e) => {
    if (e.target.closest('form,button,input')) return;
    if (document.body.dataset.state === 'empty') $('file').click();
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = Array.from(e.dataTransfer.files).find((x) => /pdf$/i.test(x.type) || /\.pdf$/i.test(x.name));
    if (f) openFile(f);
    else {
      const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (u && /^https?:/i.test(u.trim())) openUrl(u.trim());
    }
  });
  $('toc').addEventListener('change', () => {
    const b = S.blocks[Number($('toc').value)];
    $('toc').selectedIndex = 0;
    if (b) {
      b.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      showInPdf(b, true);
    }
  });

  // Alt+Shift+T (the extension command) while this tab is active
  api.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'reader-toggle') return;
    api.tabs.getCurrent().then((tab) => {
      if (tab && tab.id === msg.tabId && S.blocks.length) toggleTranslate();
    });
  });
}

function setLayout(layout, save) {
  if (!['split', 'text', 'pdf'].includes(layout)) layout = 'split';
  document.body.dataset.layout = layout;
  for (const b of $('layout').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
  if (save) api.storage.local.set({ readerLayout: layout }).catch(() => {});
  scheduleRelayout();
}

function setZoom(z) {
  S.zoom = Math.min(4, Math.max(0.3, z));
  api.storage.local.set({ readerZoom: S.zoom }).catch(() => {});
  scheduleRelayout();
}

function setStatus(text) {
  $('status').textContent = text || '';
}

function renderTranslateButton() {
  const b = $('translate');
  b.disabled = !S.blocks.length;
  document.body.dataset.translated = S.translated ? '1' : '';
  b.textContent = S.translated ? J.t('original') : J.t('translate');
  b.title = J.t('hint');
}

function showMessage(text, isError) {
  const m = $('msg');
  m.hidden = !text;
  m.textContent = text || '';
  m.style.color = isError ? '' : 'var(--muted)';
}

// ------------------------------------------------------------------- loading

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isPdfBytes(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

function nameFromUrl(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(p);
  } catch (_) {
    return '';
  }
}

async function openUrl(url) {
  S.url = url;
  document.body.dataset.state = 'loading';
  showMessage(J.t('rdLoading'), false);
  $('allow').hidden = true;
  let bytes;
  try {
    let res;
    try {
      // with cookies first (statements behind a login)...
      res = await fetch(url, { credentials: 'include' });
    } catch (_) {
      // ...then without: servers answering "Access-Control-Allow-Origin: *" refuse credentials
      res = await fetch(url, { credentials: 'omit' });
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    await showFetchError(url, e);
    return;
  }
  if (!isPdfBytes(bytes)) {
    document.body.dataset.state = 'empty';
    showMessage(J.t('rdNotPdf'), true);
    return;
  }
  await openBytes(bytes, { url, title: '' });
}

async function showFetchError(url, err) {
  document.body.dataset.state = 'empty';
  let origin = '';
  try {
    const u = new URL(url);
    if (/^https?:$/.test(u.protocol)) origin = u.origin;
  } catch (_) { /* invalid url */ }
  showMessage(J.t('rdFetchFail', { e: (err && err.message) || String(err) }), true);
  if (!origin || !api.permissions) return;
  const has = await api.permissions.contains({ origins: [origin + '/*'] }).catch(() => true);
  if (has) return;
  const b = $('allow');
  b.hidden = false;
  b.textContent = J.t('rdAllow', { h: new URL(origin).host });
  b.onclick = async (e) => {
    e.stopPropagation();
    const ok = await api.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
    if (ok) openUrl(url);
  };
}

async function openFile(file) {
  S.url = '';
  document.body.dataset.state = 'loading';
  showMessage(J.t('rdLoading'), false);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfBytes(bytes)) {
    document.body.dataset.state = 'empty';
    showMessage(J.t('rdNotPdf'), true);
    return;
  }
  await openBytes(bytes, { url: '', title: file.name });
}

async function openBytes(bytes, meta) {
  try {
    await loadDocument(bytes, meta);
  } catch (e) {
    console.warn('Hiraku Judges Translator: cannot open PDF', e);
    resetDocument();
    document.body.dataset.state = 'empty';
    setStatus('');
    showMessage(J.t('rdNotPdf') + ' (' + ((e && e.message) || e) + ')', true);
  }
}

async function loadDocument(bytes, meta) {
  resetDocument();
  S.bytes = bytes.slice(0);
  const vendor = api.runtime.getURL('vendor/pdfjs/');
  const pdf = await pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: vendor + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: vendor + 'standard_fonts/',
    isEvalSupported: false,
    fontExtraProperties: true,
  }).promise;
  S.pdf = pdf;

  let title = meta.title;
  if (!title) {
    try {
      const md = await pdf.getMetadata();
      title = (md && md.info && md.info.Title) || '';
    } catch (_) { /* no metadata */ }
  }
  title = title || nameFromUrl(meta.url) || 'PDF';
  $('docTitle').textContent = title;
  $('docTitle').title = meta.url || title;
  document.title = title + ' — Hiraku Judges Translator';
  if (meta.url && /^https?:/i.test(meta.url)) {
    $('origLink').href = meta.url;
    $('origLink').hidden = false;
    if (!EMBED) history.replaceState(null, '', '?' + new URLSearchParams({ url: meta.url }).toString());
  }

  document.body.dataset.state = 'loading';
  const layoutPages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    setStatus(J.t('rdReading', { n, t: pdf.numPages }));
    showMessage(J.t('rdReading', { n, t: pdf.numPages }), false);
    const page = await pdf.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    S.pages.push({ num: n, page, width: x1 - x0, height: y1 - y0 });
    let items = [];
    try {
      await page.getOperatorList(); // loads the fonts, so their real names are known
      const tc = await page.getTextContent();
      items = L.itemsFromTextContent(tc, (id) => {
        try {
          return page.commonObjs.has(id) ? page.commonObjs.get(id) : null;
        } catch (_) {
          return null;
        }
      });
    } catch (e) {
      console.warn('Hiraku Judges Translator: text extraction failed on page', n, e);
    }
    layoutPages.push({ width: x1 - x0, height: y1 - y0, items });
  }
  const result = L.analyze(layoutPages);
  buildPdfPane();
  buildTextPane(result, layoutPages);
  document.body.dataset.state = 'ready';
  showMessage('', false);
  setStatus('');
  renderTranslateButton();
  scheduleRelayout();
  // the reader was opened to translate: start right away
  if (S.blocks.length) startTranslating();
}

function resetDocument() {
  S.run++;
  S.queue = [];
  for (const p of S.pages) if (p.renderTask) p.renderTask.cancel();
  if (S.pdf) S.pdf.destroy().catch(() => {});
  S.pdf = null;
  S.pages = [];
  S.blocks = [];
  S.sections = [];
  S.translated = false;
  $('pdfPane').textContent = '';
  $('text').textContent = '';
  $('toc').hidden = true;
  $('origLink').hidden = true;
  renderTranslateButton();
}

// ----------------------------------------------------------------- PDF pane

let relayoutTimer = null;
function scheduleRelayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(relayout, 120);
}

function baseScale(p) {
  const pane = $('pdfPane');
  const avail = Math.max(200, pane.clientWidth - 24);
  return (avail / p.width) * S.zoom;
}

function relayout() {
  for (const p of S.pages) {
    if (!p.el) continue;
    const scale = baseScale(p);
    if (p.scale === scale) continue;
    p.scale = scale;
    p.viewport = p.page.getViewport({ scale });
    p.el.style.width = Math.floor(p.viewport.width) + 'px';
    p.el.style.height = Math.floor(p.viewport.height) + 'px';
    p.rendered = false;
  }
  for (const p of S.pages) if (p.visible) renderPage(p);
}

const pageObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const p = S.pages[Number(e.target.dataset.page)];
      if (!p) continue;
      p.visible = e.isIntersecting;
      if (p.visible) renderPage(p);
    }
  },
  { root: document.getElementById('pdfPane'), rootMargin: '600px 0px' }
);

function buildPdfPane() {
  const pane = $('pdfPane');
  S.pages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(i);
    const canvas = document.createElement('canvas');
    const hl = document.createElement('div');
    hl.className = 'hl';
    hl.hidden = true;
    el.append(canvas, hl);
    el.addEventListener('click', (e) => onPdfClick(p, e));
    pane.appendChild(el);
    p.el = el;
    p.canvas = canvas;
    p.hl = hl;
    pageObserver.observe(el);
  });
}

async function renderPage(p) {
  if (p.rendered || !p.viewport || p.rendering) return;
  p.rendering = true;
  const dpr = window.devicePixelRatio || 1;
  const vp = p.viewport;
  const c = p.canvas;
  c.width = Math.floor(vp.width * dpr);
  c.height = Math.floor(vp.height * dpr);
  const ctx = c.getContext('2d');
  try {
    p.renderTask = p.page.render({
      canvasContext: ctx,
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    });
    await p.renderTask.promise;
    p.rendered = p.scale === vp.scale;
  } catch (e) {
    if (!e || e.name !== 'RenderingCancelledException') console.warn('Hiraku Judges Translator: render failed', e);
  } finally {
    p.rendering = false;
    p.renderTask = null;
    if (!p.rendered && p.visible) renderPage(p);
  }
}

function rectOnPage(p, bbox) {
  if (!p.viewport) return null;
  const pad = 3;
  const [a, b, c, d] = p.viewport.convertToViewportRectangle([bbox.x0, bbox.y0, bbox.x1, bbox.y1]);
  return {
    left: Math.min(a, c) - pad,
    top: Math.min(b, d) - pad,
    width: Math.abs(c - a) + 2 * pad,
    height: Math.abs(d - b) + 2 * pad,
  };
}

let hlTimer = null;
function showInPdf(block, scroll) {
  for (const p of S.pages) if (p.hl) p.hl.hidden = true;
  const p = S.pages[block.page];
  if (!p || !p.hl) return;
  const r = rectOnPage(p, block.bbox);
  if (!r) return;
  Object.assign(p.hl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', opacity: '1' });
  p.hl.hidden = false;
  if (scroll && document.body.dataset.layout !== 'text') {
    const pane = $('pdfPane');
    const target = p.el.offsetTop + r.top - pane.clientHeight * 0.3;
    pane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
  clearTimeout(hlTimer);
  if (scroll) hlTimer = setTimeout(() => { p.hl.style.opacity = '0'; }, 2500);
}

function onPdfClick(p, e) {
  if (!p.viewport) return;
  const rect = p.el.getBoundingClientRect();
  const [, y] = p.viewport.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top);
  const idx = S.pages.indexOf(p);
  let best = null;
  let bestD = Infinity;
  for (const b of S.blocks) {
    if (b.page !== idx) continue;
    const d = y > b.bbox.y1 ? y - b.bbox.y1 : y < b.bbox.y0 ? b.bbox.y0 - y : 0;
    if (d < bestD) { bestD = d; best = b; }
  }
  if (!best) return;
  showInPdf(best, false);
  if (document.body.dataset.layout === 'pdf') return;
  best.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  flash(best.el);
}

function flash(el) {
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}

// ---------------------------------------------------------------- text pane

function mathNode(parts) {
  const span = document.createElement('span');
  span.className = 'm notranslate';
  span.setAttribute('translate', 'no');
  for (const part of parts) {
    const host = part.pos === 1 ? document.createElement('sup') : part.pos === -1 ? document.createElement('sub') : span;
    for (const piece of part.s.split(/([A-Za-z]+)/)) {
      if (!piece) continue;
      if (/^[A-Za-z]+$/.test(piece)) {
        const i = document.createElement('i');
        i.textContent = piece;
        host.appendChild(i);
      } else host.appendChild(document.createTextNode(piece));
    }
    if (host !== span) span.appendChild(host);
  }
  return span;
}

function appendRuns(el, runs) {
  for (const r of runs) {
    if (r.k === 't') el.appendChild(document.createTextNode(r.s));
    else if (r.k === 'c') {
      const c = document.createElement('code');
      c.textContent = r.s;
      el.appendChild(c);
    } else el.appendChild(mathNode(r.parts));
  }
}

function copyToClipboard(text, button) {
  const done = () => {
    button.textContent = J.t('copied');
    setTimeout(() => { button.textContent = J.t('copy'); }, 1200);
  };
  navigator.clipboard.writeText(text).then(done, () => {});
}

const PROBLEM_TITLE = /^(?:problem|problema|probl[eè]me|aufgabe|задача|задачa|题目|問題|문제)\s*[A-Z0-9]|^[A-Z]\s*[-.:–—]\s*\S|^[A-Z]\d?\s*$/iu;

function buildTextPane(result, layoutPages) {
  const root = $('text');
  const sections = [];
  for (let i = 0; i < S.pages.length; i++) {
    const sec = document.createElement('section');
    sec.className = 'pg';
    sec.dataset.page = String(i);
    const label = document.createElement('div');
    label.className = 'pg-label notranslate';
    label.setAttribute('translate', 'no');
    label.textContent = J.t('rdPage', { n: i + 1 });
    sec.appendChild(label);
    root.appendChild(sec);
    sections.push({ el: sec, page: i, units: null, visible: false });
  }
  S.sections = sections;

  result.blocks.forEach((b) => {
    let el;
    if (b.type === 'heading') {
      el = document.createElement(b.level === 1 ? 'h2' : 'h3');
      appendRuns(el, b.runs);
    } else if (b.type === 'para') {
      el = document.createElement('p');
      appendRuns(el, b.runs);
    } else {
      el = document.createElement('div');
      el.className = 'sample';
      if (b.caption && b.caption.length) {
        const cap = document.createElement('div');
        cap.className = 'cap';
        appendRuns(cap, b.caption);
        el.appendChild(cap);
      }
      const wrap = document.createElement('div');
      wrap.className = 'code';
      const pre = document.createElement('pre');
      pre.textContent = b.text;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy notranslate';
      btn.setAttribute('translate', 'no');
      btn.textContent = J.t('copy');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(b.text.endsWith('\n') ? b.text : b.text + '\n', btn);
      });
      wrap.append(pre, btn);
      el.appendChild(wrap);
    }
    el.classList.add('blk');
    const entry = { el, page: b.page, bbox: b.bbox, type: b.type, orig: el.textContent.replace(/\s+/g, ' ').trim() };
    el.dataset.i = String(S.blocks.length);
    S.blocks.push(entry);
    sections[b.page].el.appendChild(el);
  });

  // pages without any text: scanned images
  layoutPages.forEach((lp, i) => {
    if (lp.items.length) return;
    const p = document.createElement('p');
    p.className = 'notice notranslate';
    p.setAttribute('translate', 'no');
    p.textContent = J.t('rdNoText');
    sections[i].el.appendChild(p);
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('button,a')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the user is selecting text
    const el = e.target.closest('.blk');
    if (!el) return;
    showInPdf(S.blocks[Number(el.dataset.i)], true);
  });
  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.blk');
    if (el) showInPdf(S.blocks[Number(el.dataset.i)], false);
  });
  root.title = J.t('rdClickHint');

  // index of problems (contest sets) or sections
  const heads = S.blocks.filter((b) => b.type === 'heading');
  let toc = heads.filter((b) => PROBLEM_TITLE.test(b.orig));
  if (toc.length < 2) toc = [];
  const sel = $('toc');
  sel.textContent = '';
  if (toc.length) {
    const o = document.createElement('option');
    o.textContent = J.t('rdGoto');
    o.value = '';
    sel.appendChild(o);
    for (const b of toc) {
      const op = document.createElement('option');
      op.value = String(S.blocks.indexOf(b));
      op.textContent = b.orig.length > 60 ? b.orig.slice(0, 57) + '…' : b.orig;
      sel.appendChild(op);
    }
    sel.hidden = false;
  }

  for (const s of sections) sectionObserver.observe(s.el);
}

// --------------------------------------------------------------- translation

const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const s = S.sections[Number(e.target.dataset.page)];
      if (!s) continue;
      s.visible = e.isIntersecting;
      if (s.visible && S.translated) enqueueSection(s);
    }
  },
  { root: document.getElementById('textPane'), rootMargin: '150% 0px' }
);

function requestTranslate(text) {
  if (S.translateFn) return S.translateFn(text, S.settings.target);
  return api.runtime
    .sendMessage({ type: 'translate', text, target: S.settings.target, service: S.settings.service })
    .then((res) => {
      if (!res || !res.ok) throw new Error((res && res.error) || 'no response');
      return res.text;
    });
}

function unitsOf(section) {
  if (!section.units) {
    section.units = J.collectUnits([section.el], { keep: J.keepPattern(S.settings.keep) });
  }
  return section.units;
}

function resetUnits() {
  for (const s of S.sections) {
    if (!s.units) continue;
    for (const u of s.units) {
      J.showOriginal(u);
      u.anchor.remove();
    }
    s.units = null;
  }
  S.queue = [];
  refreshTitles();
}

function currentKey() {
  return `${S.settings.service}|${S.settings.target}|${S.settings.keep}`;
}

function enqueueSection(section) {
  const key = currentKey();
  for (const u of unitsOf(section)) {
    if (u.key === key) {
      J.showTranslated(u);
      continue;
    }
    if (u.queued === S.run) continue;
    u.queued = S.run;
    S.queue.push(u);
    S.progress.total++;
  }
  pump();
}

function pump() {
  const run = S.run;
  const key = currentKey();
  const lanes = S.lanes;
  while (lanes.active < CONCURRENCY && S.queue.length) {
    const u = S.queue.shift();
    lanes.active++;
    J.translateUnit(u, requestTranslate, { isCancelled: () => S.run !== run || !S.translated })
      .then(
        (r) => {
          if (r.mode !== 'cancelled' && S.run === run) u.key = key;
          if (r.mode === 'kept') S.progress.kept++;
        },
        (err) => {
          S.progress.failed++;
          S.progress.lastError = (err && err.message) || String(err);
        }
      )
      .finally(() => {
        lanes.active--;
        if (S.run !== run) return;
        S.progress.done++;
        updateProgress();
        refreshTitles();
        pump();
      });
  }
  updateProgress();
}

function updateProgress() {
  const p = S.progress;
  if (!S.translated) return setStatus('');
  if (p.done < p.total) setStatus(`${J.t('translating')} ${p.done}/${p.total}`);
  else if (p.failed && p.failed >= p.total) setStatus(J.t('error') + (p.lastError ? ': ' + p.lastError : ''));
  else if (p.failed || p.kept) setStatus(J.t('partial', { n: p.failed + p.kept }));
  else setStatus('');
}

function startTranslating() {
  S.run++;
  S.queue = [];
  S.lanes = { active: 0 };
  S.translated = true;
  S.progress = { done: 0, total: 0, failed: 0, kept: 0, lastError: '' };
  document.getElementById('text').lang = S.settings.target;
  renderTranslateButton();
  // visible sections first (the observer only reports changes)
  for (const s of S.sections) if (s.visible) enqueueSection(s);
  updateProgress();
}

function toggleTranslate() {
  if (S.translated) {
    S.translated = false;
    S.run++;
    S.queue = [];
    for (const s of S.sections) if (s.units) for (const u of s.units) J.showOriginal(u);
    document.getElementById('text').lang = '';
    renderTranslateButton();
    refreshTitles();
    setStatus('');
  } else startTranslating();
}

/** Tooltip with the original text on translated paragraphs. */
function refreshTitles() {
  const on = S.translated && S.settings.hoverOriginal;
  for (const b of S.blocks) {
    if (b.type === 'pre') continue;
    const translated = on && b.el.textContent.replace(/\s+/g, ' ').trim() !== b.orig;
    if (translated) b.el.title = b.orig;
    else b.el.removeAttribute('title');
  }
}

// ---------------------------------------------------------------------- main

window.addEventListener('resize', scheduleRelayout);

(async () => {
  setupToolbar();
  await loadSettings();
  $('target').value = S.settings.target;
  const params = PARAMS;
  const url = params.get('url') || '';
  const blob = params.get('blob');
  if (blob) {
    let data = null;
    try {
      const o = await api.storage.session.get(blob);
      data = o && o[blob];
      api.storage.session.remove(blob).catch(() => {});
    } catch (_) { /* fall back to the URL */ }
    if (data) {
      S.url = url;
      await openBytes(b64ToBytes(data), { url, title: params.get('title') || '' });
      return;
    }
  }
  if (url) {
    $('urlInput').value = url;
    openUrl(url);
  }
})();
