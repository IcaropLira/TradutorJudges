/*
 * Hiraku Judges Translator - background.
 * Does the network calls (the content script never talks to the translation services),
 * keeps a persistent cache, handles the Alt+Shift+T shortcut / popup button, and opens
 * PDF statements in the translating reader (reader/reader.html).
 */
'use strict';

const api = globalThis.browser || globalThis.chrome;

const CONTENT_FILES = ['shared/i18n.js', 'shared/core.js', 'content/adapters.js', 'content/content.js'];
const MAX_CACHE = 1500;

// ------------------------------------------------------------------- cache

let cache = null;
let saveTimer = null;

async function loadCache() {
  if (cache) return cache;
  try {
    const s = await api.storage.local.get({ cache: {} });
    cache = new Map(Object.entries(s.cache || {}));
  } catch (_) {
    cache = new Map();
  }
  return cache;
}

function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    api.storage.local.set({ cache: Object.fromEntries(cache) }).catch(() => {});
  }, 800);
}

// ---------------------------------------------------------------- services

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? ': ' + String(body).slice(0, 160) : ''}`);
    this.status = status;
  }
}

async function googleTranslate(text, target) {
  const form = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text });
  let res = await fetch('https://translate.googleapis.com/translate_a/single', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: form,
  });
  if (!res.ok && text.length < 1500) {
    res = await fetch('https://translate.googleapis.com/translate_a/single?' + form.toString());
  }
  if (!res.ok) throw new HttpError(res.status);
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('unexpected response');
  return data[0].map((seg) => (seg && typeof seg[0] === 'string' ? seg[0] : '')).join('');
}

const DEEPL_TARGETS = {
  pt: 'PT-BR', 'pt-PT': 'PT-PT', en: 'EN-US', 'zh-CN': 'ZH-HANS', 'zh-TW': 'ZH-HANT',
};

async function deeplTranslate(text, target, key) {
  if (!key) throw new Error('DeepL API key not set');
  const base = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await fetch(base + '/v2/translate', {
    method: 'POST',
    headers: { Authorization: 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: [text],
      target_lang: DEEPL_TARGETS[target] || target.toUpperCase(),
      preserve_formatting: true,
    }),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''));
  const data = await res.json();
  return data.translations[0].text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const permanent = e && [400, 401, 403, 456].includes(e.status);
      if (permanent || i >= tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

async function handleTranslate({ text, target, service }) {
  const key = `${service}|${target}|${text}`;
  const c = await loadCache();
  if (c.has(key)) return c.get(key);
  let out;
  if (service === 'deepl') {
    const { deeplKey } = await api.storage.local.get({ deeplKey: '' });
    out = await withRetry(() => deeplTranslate(text, target, deeplKey.trim()));
  } else {
    out = await withRetry(() => googleTranslate(text, target));
  }
  if (typeof out !== 'string' || !out.trim()) throw new Error('empty translation');
  c.set(key, out);
  saveCacheSoon();
  return out;
}

// -------------------------------------------------------------- PDF reader

const READER = 'reader/reader.html';
const MAX_INLINE_PDF = 7 * 1024 * 1024; // base64 must fit in storage.session (10 MB)

function looksLikePdfUrl(url) {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) && /\.pdf$/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

function isReaderUrl(url) {
  return typeof url === 'string' && url.startsWith(api.runtime.getURL(READER));
}

/**
 * Open the reader for a PDF. `data` (base64) is the file already downloaded by the content
 * script with the page's cookies (judges that need a login); it is handed over through
 * storage.session so it never touches the URL or disk.
 */
async function openReader({ url, data, title }, openerTab) {
  const params = new URLSearchParams();
  if (url) params.set('url', url);
  if (title) params.set('title', title);
  if (data && data.length <= MAX_INLINE_PDF * 1.37) {
    const id = 'pdf:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try {
      await api.storage.session.set({ [id]: data });
      params.set('blob', id);
    } catch (_) { /* too big or unavailable: the reader downloads it from the URL */ }
  }
  const create = { url: api.runtime.getURL(READER) + '?' + params.toString() };
  if (openerTab) {
    create.index = openerTab.index + 1;
    create.openerTabId = openerTab.id;
  }
  await api.tabs.create(create);
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Download a PDF with the extension's host permissions (cookies first, then without). */
async function fetchPdf(url) {
  let res;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch (_) {
    res = await fetch(url, { credentials: 'omit' });
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const head = String.fromCharCode.apply(null, bytes.subarray(0, 1024));
  if (!head.includes('%PDF-')) throw new Error('not a PDF');
  if (bytes.length > MAX_INLINE_PDF) throw new Error('PDF too large');
  return bytesToBase64(bytes);
}

/**
 * Ask every frame of the tab, in the page's own JS world, what PDFs it loaded: the resource
 * timing list is not visible to content scripts, and pdf.js' viewer app keeps its URL there.
 * Returns [{url, strong}] where strong = surely the document being shown.
 */
async function probePdfFrames(tabId) {
  if (tabId == null || !api.scripting) return [];
  let results = [];
  try {
    results = await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        const out = [];
        try {
          const app = globalThis.PDFViewerApplication;
          if (app && (app.url || app.baseUrl)) out.push({ url: new URL(app.url || app.baseUrl, location.href).href, strong: true });
        } catch (_) { /* no pdf.js app */ }
        try {
          for (const e of performance.getEntriesByType('resource')) {
            if (!/^(fetch|xmlhttprequest|other|iframe|embed|object)$/.test(e.initiatorType)) continue;
            const pdfLike = /\.pdf(?:$|[?#])/i.test(e.name) || /[/=_-]pdf(?:$|[/?#&])/i.test(e.name);
            if (/\.(m?js|css|wasm|png|jpe?g|gif|svg|woff2?|ttf|json|bcmap|pfb)(?:$|[?#])/i.test(e.name)) continue;
            if (pdfLike || (/^(fetch|xmlhttprequest)$/.test(e.initiatorType) && e.transferSize > 2000)) out.push({ url: e.name, strong: pdfLike });
          }
        } catch (_) { /* no resource timing */ }
        return out;
      },
    });
  } catch (_) {
    return [];
  }
  const seen = new Set();
  const list = [];
  for (const r of results || []) for (const x of r.result || []) if (!seen.has(x.url)) { seen.add(x.url); list.push(x); }
  return list;
}

async function stashPdf(data) {
  const id = 'pdf:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await api.storage.session.set({ [id]: data });
  return id;
}

// ------------------------------------------------------- toggle on a page

async function toggleInTab(tabOrId) {
  const tab = typeof tabOrId === 'object' ? tabOrId : await api.tabs.get(tabOrId).catch(() => null);
  if (!tab) return;
  const tabId = tab.id;
  if (isReaderUrl(tab.url)) {
    api.runtime.sendMessage({ type: 'reader-toggle', tabId }).catch(() => {});
    return;
  }
  if (looksLikePdfUrl(tab.url)) {
    await openReader({ url: tab.url }, tab);
    return;
  }
  try {
    await api.tabs.sendMessage(tabId, { type: 'toggle' });
    return;
  } catch (_) { /* no content script yet: unknown site, inject below */ }
  try {
    await api.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    await api.tabs.sendMessage(tabId, { type: 'toggle' });
  } catch (e) {
    console.warn('Hiraku Judges Translator: cannot run on this page', e);
  }
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// (no keyboard commands on Firefox for Android)
if (api.commands) {
  api.commands.onCommand.addListener(async (cmd) => {
    if (cmd !== 'toggle-translate') return;
    const tab = await activeTab();
    if (tab) await toggleInTab(tab);
  });
}

// ----------------------------------------------------------- context menu

const PDF_LINK_PATTERNS = ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.pdf#*', '*://*/*.PDF', '*://*/*.PDF?*', 'file:///*.pdf'];

function setupMenus() {
  if (!api.contextMenus) return;
  const ui = /^pt/i.test(api.i18n && api.i18n.getUILanguage ? api.i18n.getUILanguage() : '');
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: 'jt-pdf-link',
      title: ui ? 'Traduzir este PDF (Hiraku Judges Translator)' : 'Translate this PDF (Hiraku Judges Translator)',
      contexts: ['link'],
      targetUrlPatterns: PDF_LINK_PATTERNS,
    });
    api.contextMenus.create({
      id: 'jt-pdf-page',
      title: ui ? 'Traduzir este PDF (Hiraku Judges Translator)' : 'Translate this PDF (Hiraku Judges Translator)',
      contexts: ['page', 'frame'],
      documentUrlPatterns: PDF_LINK_PATTERNS,
    });
  });
}

api.runtime.onInstalled.addListener(setupMenus);
api.runtime.onStartup && api.runtime.onStartup.addListener(setupMenus);

if (api.contextMenus) {
  api.contextMenus.onClicked.addListener((info, tab) => {
    const url = info.menuItemId === 'jt-pdf-link' ? info.linkUrl : info.frameUrl || info.pageUrl;
    if (url) openReader({ url }, tab);
  });
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'translate') {
    handleTranslate(msg).then(
      (text) => sendResponse({ ok: true, text }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }
  if (msg.type === 'open-pdf') {
    openReader(msg, _sender && _sender.tab).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }
  if (msg.type === 'fetch-pdf') {
    fetchPdf(msg.url).then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }
  if (msg.type === 'probe-pdf-frames') {
    probePdfFrames(_sender && _sender.tab && _sender.tab.id).then((urls) => sendResponse({ ok: true, urls }), () => sendResponse({ ok: false, urls: [] }));
    return true;
  }
  if (msg.type === 'stash-pdf') {
    stashPdf(msg.data).then(
      (id) => sendResponse({ ok: true, id }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }
  if (msg.type === 'open-reader') {
    api.tabs.create({ url: api.runtime.getURL(READER) }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'toggle-active-tab') {
    activeTab()
      .then((tab) => (tab ? toggleInTab(tab) : null))
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
