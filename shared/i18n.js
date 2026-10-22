/* Judge Translate - UI strings and language list (browser global JudgeTr / Node module). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JudgeTr = Object.assign(root.JudgeTr || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STR = {
    pt: {
      translate: 'Traduzir',
      original: 'Ver original',
      translating: 'Traduzindo',
      error: 'Erro ao traduzir',
      hint: 'Atalho: Alt+Shift+T',
      cancelHint: 'Clique para cancelar',
      partial: '{n} trecho(s) mantido(s) no original',
      popupTitle: 'Judge Translate',
      translatePage: 'Traduzir esta página',
      target: 'Traduzir para',
      service: 'Serviço',
      deeplKey: 'Chave da API do DeepL',
      popupHint: 'Funciona nos judges conhecidos automaticamente. Em qualquer outro site, use este botão ou Alt+Shift+T.',
    },
    en: {
      translate: 'Translate',
      original: 'Show original',
      translating: 'Translating',
      error: 'Translation failed',
      hint: 'Shortcut: Alt+Shift+T',
      cancelHint: 'Click to cancel',
      partial: '{n} passage(s) kept in the original',
      popupTitle: 'Judge Translate',
      translatePage: 'Translate this page',
      target: 'Translate to',
      service: 'Service',
      deeplKey: 'DeepL API key',
      popupHint: 'Works automatically on known judges. On any other site, use this button or Alt+Shift+T.',
    },
  };

  const LANGS = [
    ['pt', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['en', 'English'],
    ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'],
    ['ru', 'Русский'], ['uk', 'Українська'], ['pl', 'Polski'], ['tr', 'Türkçe'],
    ['nl', 'Nederlands'], ['id', 'Bahasa Indonesia'], ['vi', 'Tiếng Việt'],
    ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文 (简体)'], ['zh-TW', '中文 (繁體)'],
    ['ar', 'العربية'], ['hi', 'हिन्दी'],
  ];

  function uiLang(nav) {
    return /^pt/i.test(nav || '') ? 'pt' : 'en';
  }

  function t(key, vars) {
    const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
    let s = (STR[uiLang(nav)] || STR.en)[key] || STR.en[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
    return s;
  }

  /** Default target language from the browser language, limited to the supported list. */
  function defaultTarget(nav) {
    const n = String(nav || 'pt');
    if (/^pt-PT/i.test(n)) return 'pt-PT';
    if (/^pt/i.test(n)) return 'pt';
    const exact = LANGS.find(([c]) => c.toLowerCase() === n.toLowerCase());
    if (exact) return exact[0];
    const base = n.split('-')[0].toLowerCase();
    const hit = LANGS.find(([c]) => c.toLowerCase() === base);
    return hit ? hit[0] : 'pt';
  }

  return { STR, LANGS, uiLang, t, defaultTarget };
});
