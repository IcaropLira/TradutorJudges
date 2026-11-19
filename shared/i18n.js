/* Hiraku Judges Translator - UI strings and language list (browser global JudgeTr / Node module). */
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
      popupTitle: 'Hiraku Judges Translator',
      translatePage: 'Traduzir esta página',
      target: 'Traduzir para',
      service: 'Serviço',
      deeplKey: 'Chave da API do DeepL',
      popupHint: 'Funciona nos judges conhecidos automaticamente. Em qualquer outro site, use este botão ou Alt+Shift+T.',
      translatePdf: 'Traduzir PDF',
      translatePdfHint: 'Abrir o enunciado em PDF no leitor com tradução',
      openReader: 'Abrir leitor de PDF',
      keep: 'Manter em inglês',
      keepHint: 'Separados por vírgula. Ex.: string, array',
      hoverOriginal: 'Mostrar o original ao passar o mouse',
      copy: 'Copiar',
      copied: 'Copiado!',
      rdOpen: 'Abrir arquivo',
      rdDrop: 'Arraste um PDF aqui, clique para escolher um arquivo, ou cole o link do PDF:',
      rdUrlGo: 'Abrir',
      rdLoading: 'Carregando PDF…',
      rdReading: 'Lendo página {n} de {t}…',
      rdNoText: 'Esta página não tem texto selecionável (provavelmente é uma imagem escaneada). Veja o original ao lado.',
      rdNotPdf: 'O endereço não devolveu um PDF. Talvez seja preciso estar logado no site: abra o PDF no navegador, salve e abra o arquivo aqui.',
      rdFetchFail: 'Não consegui baixar o PDF ({e}).',
      rdAllow: 'Permitir acesso a {h}',
      rdPage: 'Página {n}',
      rdGoto: 'Ir para…',
      rdLayoutSplit: 'Lado a lado',
      rdLayoutText: 'Só texto',
      rdLayoutPdf: 'Só PDF',
      rdOriginalLink: 'PDF original',
      rdClickHint: 'Clique num parágrafo para ver o trecho no PDF',
      rdOpenFull: 'Abrir no leitor',
      viewerNoPdf: 'Não encontrei o arquivo PDF deste visualizador. Use o botão PDF do site e depois Alt+Shift+T, ou abra o leitor pelo popup.',
    },
    en: {
      translate: 'Translate',
      original: 'Show original',
      translating: 'Translating',
      error: 'Translation failed',
      hint: 'Shortcut: Alt+Shift+T',
      cancelHint: 'Click to cancel',
      partial: '{n} passage(s) kept in the original',
      popupTitle: 'Hiraku Judges Translator',
      translatePage: 'Translate this page',
      target: 'Translate to',
      service: 'Service',
      deeplKey: 'DeepL API key',
      popupHint: 'Works automatically on known judges. On any other site, use this button or Alt+Shift+T.',
      translatePdf: 'Translate PDF',
      translatePdfHint: 'Open the PDF statement in the translating reader',
      openReader: 'Open PDF reader',
      keep: 'Keep in English',
      keepHint: 'Comma separated. E.g. string, array',
      hoverOriginal: 'Show the original on hover',
      copy: 'Copy',
      copied: 'Copied!',
      rdOpen: 'Open file',
      rdDrop: 'Drop a PDF here, click to choose a file, or paste the PDF link:',
      rdUrlGo: 'Open',
      rdLoading: 'Loading PDF…',
      rdReading: 'Reading page {n} of {t}…',
      rdNoText: 'This page has no selectable text (probably a scanned image). See the original on the side.',
      rdNotPdf: 'The address did not return a PDF. You may need to be logged in: open the PDF in the browser, save it and open the file here.',
      rdFetchFail: 'Could not download the PDF ({e}).',
      rdAllow: 'Allow access to {h}',
      rdPage: 'Page {n}',
      rdGoto: 'Go to…',
      rdLayoutSplit: 'Side by side',
      rdLayoutText: 'Text only',
      rdLayoutPdf: 'PDF only',
      rdOriginalLink: 'Original PDF',
      rdClickHint: 'Click a paragraph to see it in the PDF',
      rdOpenFull: 'Open in reader',
      viewerNoPdf: 'Could not find the PDF file behind this viewer. Use the site\'s PDF button and then Alt+Shift+T, or open the reader from the popup.',
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
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
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

  // Words competitive programmers usually keep in English (translators turn "string" into "corda").
  const DEFAULT_KEEP = 'string, strings, substring, substrings, array, arrays, subarray, subarrays, bitmask';

  return { STR, LANGS, uiLang, t, defaultTarget, DEFAULT_KEEP };
});
