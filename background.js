/*
 * Judge Translate - background.
 * Does the network calls (the content script never talks to the translation services),
 * keeps a persistent cache, and handles the Alt+Shift+T shortcut / popup button.
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

// ------------------------------------------------------- toggle on a page

async function toggleInTab(tabId) {
  try {
    await api.tabs.sendMessage(tabId, { type: 'toggle' });
    return;
  } catch (_) { /* no content script yet: unknown site, inject below */ }
  try {
    await api.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    await api.tabs.sendMessage(tabId, { type: 'toggle' });
  } catch (e) {
    console.warn('Judge Translate: cannot run on this page', e);
  }
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

api.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-translate') return;
  const tab = await activeTab();
  if (tab) await toggleInTab(tab.id);
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'translate') {
    handleTranslate(msg).then(
      (text) => sendResponse({ ok: true, text }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }
  if (msg.type === 'toggle-active-tab') {
    activeTab()
      .then((tab) => (tab ? toggleInTab(tab.id) : null))
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
