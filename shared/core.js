/*
 * Judge Translate - core
 *
 * Turns the already-rendered DOM of a problem statement into "units" (runs of inline
 * content). Everything that must never reach the translator (formulas, code, samples,
 * images...) is swapped for numeric placeholders such as ⟦3⟧; inline formatting
 * (<b>, <a>...) becomes a ⟦n⟧ ... ⟦/n⟧ pair. The translated string is validated
 * (every placeholder present exactly once, pairs properly nested) and the ORIGINAL
 * DOM nodes are moved back in place - formulas are never rebuilt from text.
 *
 * Works in the browser (global JudgeTr) and in Node (module.exports) for the tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JudgeTr = Object.assign(root.JudgeTr || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPEN = '⟦'; // ⟦
  const CLOSE = '⟧'; // ⟧

  // ---------------------------------------------------------------- selectors

  // Things that are copied back untouched (never sent to the translator).
  const ATOM_SELECTOR = [
    // MathJax v2 / v3, KaTeX, MathML
    '.MathJax', '.MathJax_Preview', '.MathJax_Display', '.MathJax_SVG', '.MathJax_SVG_Display',
    '.MathJax_CHTML', '.MathJax_Error', 'mjx-container', 'mjx-assistive-mml',
    '.katex', '.katex-display', '.katex-mathml', 'math',
    'script[type^="math/"]',
    // code and literals
    'code', 'pre', 'kbd', 'samp', 'var', 'tt', 'sub', 'sup',
    // controls and embedded content
    'textarea', 'input', 'select', 'button', 'img', 'svg', 'canvas', 'video', 'audio',
    'iframe', 'object', 'embed',
    // judge specific
    '.tex-span', '.tex-font-style-tt', '.sample-tests', '.input-output-copier',
    // explicit opt-out
    '[translate="no"]', '.notranslate',
  ].join(',');

  // Never part of a sentence: skipped (acts as a boundary).
  const IGNORE_SELECTOR = 'script,style,noscript,template,head,title,meta,link';

  const BLOCK_TAG_LIST = [
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CAPTION', 'CENTER', 'DD', 'DETAILS',
    'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'HR', 'LEGEND', 'LI', 'MAIN', 'MENU',
    'NAV', 'OL', 'OPTION', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT',
    'TH', 'THEAD', 'TR', 'UL',
  ];
  const BLOCK_TAGS = new Set(BLOCK_TAG_LIST);
  const BLOCK_SELECTOR = BLOCK_TAG_LIST.map((t) => t.toLowerCase()).concat('br').join(',');

  // Raw TeX that was not (yet) typeset by MathJax/KaTeX.
  const TEX_SOURCES = [
    String.raw`\$\$\$[\s\S]*?\$\$\$`, // Codeforces
    String.raw`\$\$[\s\S]+?\$\$`,
    String.raw`\\\([\s\S]+?\\\)`,
    String.raw`\\\[[\s\S]+?\\\]`,
    // $...$ with the pandoc rule: no space inside the delimiters, closing $ not followed by a digit
    String.raw`\$(?=\S)(?:\\[\s\S]|[^$\\\n])+?(?<=\S)\$(?!\d)`,
  ];
  const TEX_SOURCE = TEX_SOURCES.join('|');

  // ----------------------------------------------------------------- helpers

  function isBlockTag(el) {
    return BLOCK_TAGS.has(el.tagName);
  }

  function isHidden(el) {
    if (el.hidden) return true;
    const win = el.ownerDocument && el.ownerDocument.defaultView;
    if (!win || !win.getComputedStyle) return false;
    const cs = win.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }

  // Short italic text is a variable name in legacy statements (<i>n</i>), not prose.
  function isVarLike(el) {
    return el.matches('i,em,.tex-font-style-it,.tex-font-style-sl') && (el.textContent || '').trim().length <= 2;
  }

  function isAtom(el) {
    return el.matches(ATOM_SELECTOR) || isVarLike(el);
  }

  function hasLetters(s) {
    return /\p{L}/u.test(s);
  }

  function splitTex(s) {
    const out = [];
    const re = new RegExp(TEX_SOURCE, 'g');
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) out.push({ tex: false, s: s.slice(last, m.index) });
      out.push({ tex: true, s: m[0] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ tex: false, s: s.slice(last) });
    return out;
  }

  function setChildren(el, kids) {
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const k of kids) el.appendChild(k);
  }

  // ---------------------------------------------------------------- encoding

  /**
   * Encode a run of sibling nodes. Returns null when there is nothing to translate.
   * table: id -> {kind:'node', nodes[]} | {kind:'lit', value} | {kind:'el', el}
   */
  function encodeRun(nodes) {
    const table = new Map();
    const parts = [];
    const inner = []; // [element, original child array] for every formatting element
    let nextId = 1;

    function pushText(s) {
      if (!s) return;
      const last = parts[parts.length - 1];
      if (last && last.k === 't') last.s += s;
      else parts.push({ k: 't', s });
    }

    function walk(list) {
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (n.nodeType === 3) {
          for (const seg of splitTex(n.nodeValue)) {
            if (seg.tex) {
              const id = nextId++;
              table.set(id, { kind: 'lit', value: seg.s });
              parts.push({ k: 'a', id });
            } else pushText(seg.s);
          }
        } else if (n.nodeType === 1) {
          if (isAtom(n)) {
            // MathJax emits preview + rendered + <script> siblings: one formula, one token
            const group = [n];
            while (i + 1 < list.length && list[i + 1].nodeType === 1 && isAtom(list[i + 1])) group.push(list[++i]);
            const id = nextId++;
            table.set(id, { kind: 'node', nodes: group });
            parts.push({ k: 'a', id });
          } else {
            const id = nextId++;
            const kids = Array.from(n.childNodes);
            table.set(id, { kind: 'el', el: n });
            inner.push([n, kids]);
            parts.push({ k: 'o', id });
            walk(kids);
            parts.push({ k: 'c', id });
          }
        }
        // comments are ignored (kept in the original layout only)
      }
    }

    walk(nodes);

    for (const p of parts) if (p.k === 't') p.s = p.s.replace(/\s+/g, ' ');
    if (!parts.some((p) => p.k === 't' && hasLetters(p.s))) return null;

    let text = parts
      .map((p) => (p.k === 't' ? p.s : p.k === 'c' ? OPEN + '/' + p.id + CLOSE : OPEN + p.id + CLOSE))
      .join('');
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    text = text.trim();
    return { text, lead, trail, table, inner };
  }

  // ---------------------------------------------------------------- decoding

  function normalizeTokens(s) {
    return String(s)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(
        /(?:⟦|〚|［［|\[\[)\s*(\/?)\s*(\d+)\s*(?:⟧|〛|］］|\]\])/g,
        (_, slash, id) => OPEN + slash + id + CLOSE
      );
  }

  /** Validate the translated string. Returns parts or null if anything is off. */
  function parseTranslated(str, table) {
    const norm = normalizeTokens(str);
    const re = /⟦(\/?)(\d+)⟧/g;
    const parts = [];
    const seen = new Set();
    const opened = new Set();
    const closed = new Set();
    const stack = [];
    let last = 0;
    let m;
    while ((m = re.exec(norm))) {
      if (m.index > last) parts.push({ k: 't', s: norm.slice(last, m.index) });
      last = re.lastIndex;
      const id = Number(m[2]);
      const entry = table.get(id);
      if (!entry) return null;
      if (m[1]) {
        if (entry.kind !== 'el' || stack[stack.length - 1] !== id) return null;
        stack.pop();
        closed.add(id);
        parts.push({ k: 'c', id });
      } else if (entry.kind === 'el') {
        if (opened.has(id)) return null;
        opened.add(id);
        stack.push(id);
        parts.push({ k: 'o', id });
      } else {
        if (seen.has(id)) return null;
        seen.add(id);
        parts.push({ k: 'a', id });
      }
    }
    if (last < norm.length) parts.push({ k: 't', s: norm.slice(last) });
    if (stack.length) return null;
    for (const [id, entry] of table) {
      if (entry.kind === 'el' ? !(opened.has(id) && closed.has(id)) : !seen.has(id)) return null;
    }
    for (const p of parts) if (p.k === 't' && /[⟦⟧]/.test(p.s)) return null;
    return parts;
  }

  function buildLayout(doc, parts, table) {
    const top = [];
    const inner = [];
    const stack = [{ children: top }];
    const cur = () => stack[stack.length - 1].children;
    for (const p of parts) {
      if (p.k === 't') cur().push(doc.createTextNode(p.s));
      else if (p.k === 'a') {
        const e = table.get(p.id);
        if (e.kind === 'node') for (const n of e.nodes) cur().push(n);
        else cur().push(doc.createTextNode(e.value));
      } else if (p.k === 'o') {
        const el = table.get(p.id).el.cloneNode(false);
        const rec = { el, children: [] };
        cur().push(el);
        inner.push(rec);
        stack.push(rec);
      } else stack.pop();
    }
    return { top, inner: inner.map((r) => [r.el, r.children]) };
  }

  // ------------------------------------------------------------------- units

  function makeUnit(run) {
    const enc = encodeRun(run);
    if (!enc) return null;
    const parent = run[0].parentNode;
    const anchor = run[0].ownerDocument.createComment('jt');
    parent.insertBefore(anchor, run[0]);
    return {
      anchor,
      enc,
      current: run.slice(),
      origLayout: { top: run.slice(), inner: enc.inner },
      transLayout: null,
      key: null,
    };
  }

  /** Split the given roots into translatable units (document order). */
  function collectUnits(roots, opts) {
    const skipSel = (opts && opts.skipSelector) || null;
    const units = [];
    const visited = new Set();

    function walkBlock(el) {
      if (visited.has(el)) return;
      visited.add(el);
      let run = [];
      const flush = () => {
        if (run.length) {
          const u = makeUnit(run);
          if (u) units.push(u);
          run = [];
        }
      };
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3 || node.nodeType === 8) { run.push(node); continue; }
        if (node.nodeType !== 1) continue;
        if (skipSel && node.matches(skipSel)) { flush(); continue; }
        if (isAtom(node)) {
          if (isBlockTag(node)) flush(); else run.push(node);
          continue;
        }
        if (node.matches(IGNORE_SELECTOR) || isHidden(node)) { flush(); continue; }
        if (isBlockTag(node) || node.tagName === 'BR') {
          flush();
          if (node.tagName !== 'BR') walkBlock(node);
          continue;
        }
        if (node.querySelector(BLOCK_SELECTOR)) { flush(); walkBlock(node); continue; }
        run.push(node);
      }
      flush();
    }

    for (const r of roots) walkBlock(r);
    return units;
  }

  function applyLayout(unit, layout) {
    const anchor = unit.anchor;
    if (!anchor.parentNode) return;
    for (const n of unit.current) if (n.parentNode) n.parentNode.removeChild(n);
    for (const [el, kids] of layout.inner) setChildren(el, kids);
    let ref = anchor;
    for (const n of layout.top) {
      ref.parentNode.insertBefore(n, ref.nextSibling);
      ref = n;
    }
    unit.current = layout.top.slice();
  }

  function showOriginal(unit) {
    applyLayout(unit, unit.origLayout);
  }

  function showTranslated(unit) {
    if (unit.transLayout) applyLayout(unit, unit.transLayout);
  }

  /** Last resort: translate only the prose between placeholders, one piece at a time. */
  async function translatePlain(enc, translate) {
    const pieces = enc.text.split(/(⟦\/?\d+⟧)/);
    const out = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (i % 2 === 1 || !hasLetters(p)) { out.push(p); continue; }
      const lead = p.match(/^\s*/)[0];
      const trail = p.match(/\s*$/)[0];
      const t = await translate(p.trim());
      out.push(lead + String(t).trim() + trail);
    }
    return enc.lead + out.join('') + enc.trail;
  }

  /**
   * Translate one unit and put the result in the DOM.
   * Ladder: full (placeholders) -> plain (prose pieces only) -> kept original.
   * Resolves to {mode: 'full'|'plain'|'kept'}; rejects if the translation service fails.
   */
  async function translateUnit(unit, translate, opts) {
    const isCancelled = (opts && opts.isCancelled) || (() => false);
    const enc = unit.enc;
    let parts = null;
    let mode = 'full';
    try {
      const out = await translate(enc.text);
      if (isCancelled()) return { mode: 'cancelled' };
      parts = parseTranslated(enc.lead + String(out).trim() + enc.trail, enc.table);
    } catch (_) {
      parts = null;
    }
    if (!parts) {
      mode = 'plain';
      const out = await translatePlain(enc, translate);
      if (isCancelled()) return { mode: 'cancelled' };
      parts = parseTranslated(out, enc.table);
    }
    if (!parts) return { mode: 'kept' };
    unit.transLayout = buildLayout(unit.anchor.ownerDocument, parts, enc.table);
    applyLayout(unit, unit.transLayout);
    return { mode };
  }

  function genericRoots(doc) {
    const cands = Array.from(doc.querySelectorAll('main,[role="main"],article'));
    const tops = cands.filter((c) => !cands.some((o) => o !== c && o.contains(c)));
    const good = tops.filter((c) => (c.textContent || '').trim().length > 200);
    return good.length ? good : [doc.body];
  }

  return {
    collectUnits,
    translateUnit,
    showOriginal,
    showTranslated,
    genericRoots,
    // exported for tests
    encodeRun,
    parseTranslated,
    splitTex,
    normalizeTokens,
  };
});
