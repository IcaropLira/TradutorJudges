/*
 * Hiraku Judges Translator - PDF layout analysis.
 *
 * Input: the positioned text items of each PDF page (as given by pdf.js) plus a font
 * classification. Output: an ordered list of blocks - headings, paragraphs, and
 * preformatted samples - where formulas and inline code are kept as separate runs so the
 * translator never sees them.
 *
 * Coordinates are PDF user space (origin bottom-left, y grows upwards).
 * Pure functions: runs in the reader page and in Node for the tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JudgeTr = Object.assign(root.JudgeTr || {}, { pdfLayout: api });
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------- fonts

  const MATH_FONT = /^(cmmi|cmsy|cmex|cmbsy|cmmib|msam|msbm|eufm|eurm|eusm|rsfs|wasy|stmary|lmmi|lmsy|lmex|latinmodern-?math|newcm-?math|stixmath|stix-?math|stixtwomath|xits-?math|cambria-?math|asana|symbol|mtmi|mtsy|mtex|rtxmi|rtxsy|txmi|txsy|txex|pxmi|pxsy|pxex|zxmi|ntxmi|ntxsy|esint|bbold|dsrom|mathematicalpi|euclid|mt-?extra|mathtime)/i;
  const MONO_FONT = /(courier|mono|consol|inconsolata|menlo|typewriter|cmtt|cmsltt|sftt|lmtt|txtt|pcrr|nimbusmon|lucidaconsole|lucidasanstypewriter|sourcecode|firacode|hack|andale|letter\s*gothic|ocr-?[ab]|fixedsys|cousine|\btt\d)/i;
  const BOLD_FONT = /(bold|black|heavy|semibold|demi|cmbx|cmb\d|sfbx|lmbx|[-,]bd\b|bx\d)/i;
  const ITALIC_FONT = /(italic|oblique|cmti|cmsl|sfti|sfsl|lmti|[-,]it\b|[-,]ital)/i;

  /** Classify a PDF font from its PostScript name (subset prefix like "ABCDEF+" ignored). */
  function classifyFont(name, extra) {
    const n = String(name || '').replace(/^[A-Z]{6}\+/, '');
    const math = MATH_FONT.test(n);
    return {
      math,
      mono: !math && MONO_FONT.test(n),
      bold: BOLD_FONT.test(n) || !!(extra && extra.bold),
      italic: ITALIC_FONT.test(n) || !!(extra && extra.italic),
    };
  }

  // ----------------------------------------------------------------- helpers

  const LETTER = /\p{L}/u;
  const median = (a) => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  };

  function weightedMode(pairs) {
    // pairs: [value, weight]
    const m = new Map();
    for (const [v, w] of pairs) m.set(v, (m.get(v) || 0) + w);
    let best = 0;
    let bw = -1;
    for (const [v, w] of m) if (w > bw) { best = v; bw = w; }
    return best;
  }

  // ------------------------------------------------------------------- lines

  function buildLines(items) {
    const sizes = items.map((i) => i.size);
    const typical = median(sizes) || 10;
    const big = items.filter((i) => i.size >= typical * 0.88).sort((a, b) => b.y - a.y || a.x - b.x);
    const small = items.filter((i) => i.size < typical * 0.88);
    const lines = [];
    for (const it of big) {
      let hit = null;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
        const l = lines[k];
        if (Math.abs(l.base - it.y) <= 0.45 * Math.max(l.size, it.size)) { hit = l; break; }
      }
      if (hit) {
        hit.items.push(it);
        if (it.size > hit.size) { hit.size = it.size; hit.base = it.y; }
      } else lines.push({ base: it.y, size: it.size, items: [it] });
    }
    for (const it of small) {
      let hit = null;
      let best = Infinity;
      for (const l of lines) {
        const d = Math.abs(l.base - it.y);
        // horizontally inside or right next to the line
        const xs = l.items.map((i) => i.x);
        const minX = Math.min(...xs) - l.size * 2;
        const maxX = Math.max(...l.items.map((i) => i.x + i.w)) + l.size * 2;
        if (d <= 0.75 * l.size && d < best && it.x >= minX && it.x <= maxX) { best = d; hit = l; }
      }
      if (hit) hit.items.push(it);
      else lines.push({ base: it.y, size: it.size, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      for (const it of l.items) {
        it.pos = 0;
        if (it.size < l.size * 0.9) {
          if (it.y - l.base > 0.18 * l.size) it.pos = 1;
          else if (l.base - it.y > 0.08 * l.size) it.pos = -1;
        }
      }
    }
    lines.sort((a, b) => b.base - a.base);
    return lines;
  }

  /** Split a line into segments at large horizontal gaps (table columns). */
  function splitSegments(line, pageWidth) {
    const segs = [];
    let cur = null;
    const limit = Math.max(5 * line.size, 0.08 * pageWidth);
    for (const it of line.items) {
      if (cur) {
        const gap = it.x - cur.x1;
        if (gap > limit) { segs.push(cur); cur = null; }
      }
      if (!cur) cur = { base: line.base, size: line.size, items: [], x0: it.x, x1: it.x + it.w };
      cur.items.push(it);
      cur.x1 = Math.max(cur.x1, it.x + it.w);
    }
    if (cur) segs.push(cur);
    for (const s of segs) {
      let chars = 0;
      let mono = 0;
      let bold = 0;
      for (const it of s.items) {
        const n = it.s.replace(/\s/g, '').length;
        chars += n;
        if (it.font.mono) mono += n;
        if (it.font.bold) bold += n;
      }
      s.chars = chars;
      s.mono = chars ? mono / chars : 0;
      s.bold = chars ? bold / chars : 0;
      s.text = plainText(s.items);
      s.multi = segs.length > 1;
    }
    return segs;
  }

  function plainText(items) {
    let out = '';
    let prev = null;
    for (const it of items) {
      if (prev && needSpace(prev, it, out)) out += ' ';
      out += it.s;
      prev = it;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function needSpace(prev, it, soFar) {
    if (/\s$/.test(soFar) || /^\s/.test(it.s)) return false;
    const gap = it.x - (prev.x + prev.w);
    return gap > 0.15 * Math.max(prev.size, it.size);
  }

  // ------------------------------------------------------- headers / footers

  const PAGE_NUM = /^(?:page\s*|p[aá]gina\s*|стр\.?\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(?:\s*(?:\/|of|de|из)\s*\d{1,4})?$/i;

  function dropRunningText(pages) {
    const n = pages.length;
    const seen = new Map();
    const edge = (p, s) => s.base > p.height * 0.9 || s.base < p.height * 0.08;
    const key = (s) => s.text.replace(/\d+/g, '#').toLowerCase();
    for (const p of pages) {
      const keys = new Set();
      for (const s of p.segs) if (edge(p, s)) keys.add(key(s));
      for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const p of pages) {
      p.segs = p.segs.filter((s) => {
        if (!edge(p, s)) return true;
        if (PAGE_NUM.test(s.text)) return false;
        const c = seen.get(key(s)) || 0;
        return !(n >= 3 && c >= 3 && c >= n * 0.5);
      });
    }
  }

  // ------------------------------------------------------------------ blocks

  const BULLET = /^(?:[•◦▪‣·\-–*]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\([ivx]+\))\s/i;

  function segKind(s, body) {
    if (s.mono >= 0.8) return 'pre';
    const short = s.text.length <= 80 && !/[.,;:]$/.test(s.text);
    if (s.size >= body * 1.15 && s.text.length <= 140) return 'heading';
    if (s.bold >= 0.8 && short && s.text.length >= 2) return 'heading';
    return 'para';
  }

  function overlapX(a0, a1, b0, b1) {
    return Math.min(a1, b1) - Math.max(a0, b0);
  }

  function blocksForPage(page, pageIndex, body, rightEdge) {
    const blocks = [];
    let open = [];
    const segs = page.segs.slice().sort((a, b) => b.base - a.base || a.x0 - b.x0);
    for (const s of segs) {
      const kind = segKind(s, body);
      let target = null;
      for (const b of open) {
        if (b.kind !== kind) continue;
        const last = b.lines[b.lines.length - 1];
        const gap = last.base - s.base;
        if (gap <= 0.3 * s.size) continue; // same baseline: another column
        const size = Math.max(s.size, last.size);
        const maxGap = kind === 'pre' ? 3.6 * size : kind === 'heading' ? 1.6 * size : 1.6 * size;
        if (gap > maxGap) continue;
        if (b.multi !== s.multi && kind !== 'pre') continue;
        const ov = overlapX(b.x0, b.x1, s.x0, s.x1);
        const aligned = Math.abs(b.x0 - s.x0) < 2 * size;
        if (s.multi || b.multi ? !aligned : ov <= 0 && !aligned) continue;
        if (kind === 'heading' && Math.abs(last.size - s.size) > 0.5) continue;
        if (kind === 'para') {
          if (s.x0 > b.lineX0 + 0.8 * s.size && s.x0 - b.lineX0 < 6 * s.size) continue; // first-line indent
          if (BULLET.test(s.text)) continue;
          const ends = /[.:!?]["')\]]?$/.test(last.text);
          if (ends && last.x1 < Math.min(b.x1, rightEdge) - 4 * s.size) continue; // short last line
          if (Math.abs(last.size - s.size) > 0.2 * s.size && !s.multi) continue;
        }
        target = b;
        break;
      }
      if (target) {
        target.lines.push(s);
        target.x0 = Math.min(target.x0, s.x0);
        target.x1 = Math.max(target.x1, s.x1);
        target.lineX0 = s.x0;
      } else {
        target = { kind, page: pageIndex, lines: [s], x0: s.x0, x1: s.x1, lineX0: s.x0, multi: s.multi };
        blocks.push(target);
        open.push(target);
      }
      // a line that crosses another open block ends it
      open = open.filter((b) => b === target || overlapX(b.x0, b.x1, s.x0, s.x1) <= 0);
    }

    // short labels right above a sample ("Sample Input 1") become its caption
    for (const b of blocks) {
      if (b.kind !== 'pre') continue;
      const top = b.lines[0];
      let best = null;
      for (const c of blocks) {
        if (c === b || c.caption || c.kind === 'pre' || c.captionOf) continue;
        if (c.lines.length !== 1 || c.lines[0].text.length > 40) continue;
        const l = c.lines[0];
        const gap = l.base - top.base;
        if (gap <= 0 || gap > 2.6 * top.size) continue;
        if (Math.abs(l.x0 - b.x0) > 2.5 * top.size && overlapX(l.x0, l.x1, b.x0, b.x1) <= 0) continue;
        if (c.kind === 'heading' && !b.multi && !c.multi) continue; // real section titles stay headings
        if (!best || gap < best.gap) best = { c, gap };
      }
      if (best) { b.caption = best.c; best.c.captionOf = b; }
    }

    const out = blocks.filter((b) => !b.captionOf);
    const topOf = (b) => (b.caption ? b.caption.lines[0].base : b.lines[0].base);
    out.sort((a, b) => {
      const d = topOf(b) - topOf(a);
      if (Math.abs(d) > 0.5 * body) return d;
      return a.x0 - b.x0;
    });
    return out;
  }

  // -------------------------------------------------------------------- runs

  function pieces(lines) {
    const out = [];
    lines.forEach((l, li) => {
      if (li > 0) {
        const prev = out[out.length - 1];
        const first = l.items[0];
        if (prev && /\p{L}-$/u.test(prev.s) && first && /^\p{Ll}/u.test(first.s)) prev.s = prev.s.slice(0, -1);
        else out.push({ s: ' ', font: {}, pos: 0 });
      }
      let prevIt = null;
      let text = '';
      for (const it of l.items) {
        if (prevIt && needSpace(prevIt, it, text)) { out.push({ s: ' ', font: {}, pos: 0 }); text += ' '; }
        out.push({ s: it.s, font: it.font, pos: it.pos || 0 });
        text += it.s;
        prevIt = it;
      }
    });
    return out;
  }

  const NO_LETTERS = /^[^\p{L}]+$/u;
  const VAR_LIKE = /^\p{L}{1,2}[^\p{L}\p{N}\s]*$/u;

  function tokens(ps) {
    const toks = [];
    for (const p of ps) {
      for (const s of p.s.split(/(\s+)/)) {
        if (!s) continue;
        if (/^\s+$/.test(s)) { toks.push({ s: ' ', space: true }); continue; }
        const math = !!p.font.math || p.pos !== 0 || (!!p.font.italic && !p.font.mono && VAR_LIKE.test(s));
        toks.push({ s, pos: p.pos, math, code: !math && !!p.font.mono });
      }
    }
    // collapse spaces
    const out = [];
    for (const t of toks) {
      if (t.space && (!out.length || out[out.length - 1].space)) continue;
      out.push(t);
    }
    while (out.length && out[out.length - 1].space) out.pop();
    return out;
  }

  function absorbMath(toks) {
    const cand = (t) => !t.space && !t.math && !t.code && NO_LETTERS.test(t.s) && !/^[“”"'‘’«»]+$/.test(t.s);
    const stops = (t) => /[.;:!?]$/.test(t.s);
    // forward
    let prev = null;
    for (const t of toks) {
      if (t.space) continue;
      if (cand(t) && prev && prev.math && !prev.stop) { t.math = true; t.stop = stops(t); }
      prev = t;
    }
    // backward
    let next = null;
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i];
      if (t.space) continue;
      if (cand(t) && next && next.math && !/[.;:!?]/.test(t.s)) t.math = true;
      next = t;
    }
  }

  function toRuns(lines) {
    const toks = tokens(pieces(lines));
    absorbMath(toks);
    const runs = [];
    const kindOf = (t) => (t.math ? 'm' : t.code ? 'c' : 't');
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      let k;
      if (t.space) {
        // a space between two math tokens belongs to the formula
        const a = toks[i - 1];
        const b = toks[i + 1];
        k = a && b && kindOf(a) === kindOf(b) && kindOf(a) !== 't' ? kindOf(a) : 't';
      } else k = kindOf(t);
      let last = runs[runs.length - 1];
      if (!last || last.k !== k) { last = k === 'm' ? { k, parts: [] } : { k, s: '' }; runs.push(last); }
      if (k === 'm') {
        const pos = t.space ? 0 : t.pos || 0;
        const lp = last.parts[last.parts.length - 1];
        if (lp && lp.pos === pos) lp.s += t.s;
        else last.parts.push({ s: t.s, pos });
      } else last.s += t.s;
    }
    // trailing sentence punctuation (and an unbalanced ")") goes back to the text
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (r.k !== 'm') continue;
      let moved = '';
      for (;;) {
        const lp = r.parts[r.parts.length - 1];
        if (!lp || lp.pos !== 0) break;
        const all = r.parts.map((p) => p.s).join('');
        const ch = lp.s.slice(-1);
        const unbalanced = ch === ')' && (all.match(/\)/g) || []).length > (all.match(/\(/g) || []).length;
        if (!/[.,;:!?”"’»\s]/.test(ch) && !unbalanced) break;
        if (all.trim().length <= 1) break;
        moved = ch + moved;
        lp.s = lp.s.slice(0, -1);
        if (!lp.s) r.parts.pop();
      }
      if (moved) {
        const nx = runs[i + 1];
        if (nx && nx.k === 't') nx.s = moved + nx.s;
        else runs.splice(i + 1, 0, { k: 't', s: moved });
      }
    }
    return runs.filter((r) => (r.k === 'm' ? r.parts.some((p) => p.s.trim()) : r.s.length));
  }

  function preText(b) {
    const ws = [];
    for (const l of b.lines) for (const it of l.items) {
      const n = it.s.length;
      if (n && it.font.mono) ws.push(it.w / n);
    }
    const cw = median(ws) || b.lines[0].size * 0.525;
    const minX = Math.min(...b.lines.map((l) => l.x0));
    const spacing = (() => {
      const g = [];
      for (let i = 1; i < b.lines.length; i++) g.push(b.lines[i - 1].base - b.lines[i].base);
      return g.length ? Math.min(...g) : b.lines[0].size * 1.2;
    })();
    const rows = [];
    b.lines.forEach((l, i) => {
      if (i > 0) {
        const gap = b.lines[i - 1].base - l.base;
        const blanks = Math.round(gap / spacing) - 1;
        for (let k = 0; k < Math.min(blanks, 3); k++) rows.push('');
      }
      let row = '';
      for (const it of l.items) {
        const col = Math.max(0, Math.round((it.x - minX) / cw));
        if (row.length < col) row += ' '.repeat(col - row.length);
        else if (row.length && !/\s$/.test(row) && !/^\s/.test(it.s) && it.x - minX > row.length * cw + 0.3 * cw) row += ' ';
        row += it.s;
      }
      rows.push(row.replace(/\s+$/, ''));
    });
    return rows.join('\n');
  }

  function bbox(lines) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const l of lines) {
      x0 = Math.min(x0, l.x0);
      x1 = Math.max(x1, l.x1);
      y0 = Math.min(y0, l.base - 0.3 * l.size);
      y1 = Math.max(y1, l.base + 0.9 * l.size);
    }
    return { x0, y0, x1, y1 };
  }

  /**
   * Convert pdf.js getTextContent() output to layout items.
   * fontOf(loadedName) -> {name, bold?, italic?} | null (from page.commonObjs).
   */
  function itemsFromTextContent(tc, fontOf) {
    const cache = new Map();
    const fontFor = (id) => {
      if (!cache.has(id)) {
        const f = fontOf(id) || {};
        const st = (tc.styles && tc.styles[id]) || {};
        const c = classifyFont(f.name || '', f);
        // last resort for fonts without a usable name
        if (!f.name && st.fontFamily === 'monospace') c.mono = true;
        cache.set(id, c);
      }
      return cache.get(id);
    };
    const out = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.str) continue;
      const [a, b, c, d, e, f] = it.transform;
      if (Math.abs(b) > 0.01 * Math.abs(a) + 1e-6) continue; // rotated text (watermarks, axis labels)
      const size = Math.hypot(c, d) || Math.hypot(a, b);
      out.push({ s: it.str, x: e, y: f, w: it.width, size, font: fontFor(it.fontName) });
    }
    return out;
  }

  // ------------------------------------------------------------------- entry

  /**
   * pages: [{width, height, items: [{s, x, y, w, size, font: {math, mono, bold, italic}}]}]
   * returns {bodySize, blocks: [{type, page, level?, bbox, runs?, text?, caption?}]}
   */
  function analyze(pagesIn) {
    const pages = pagesIn.map((p) => ({
      width: p.width,
      height: p.height,
      items: p.items
        .filter((i) => i.s && i.s.trim() && i.size > 0.5)
        .map((i) => ({ ...i, s: i.s.replace(/ /g, ' ') })),
    }));
    const body = weightedMode(
      pages.flatMap((p) => p.items.filter((i) => !i.font.mono).map((i) => [Math.round(i.size * 2) / 2, i.s.length]))
    ) || 10;

    for (const p of pages) {
      p.lines = buildLines(p.items);
      p.segs = p.lines.flatMap((l) => splitSegments(l, p.width));
    }
    dropRunningText(pages);

    const out = [];
    pages.forEach((p, idx) => {
      const ends = p.segs.filter((s) => s.mono < 0.8 && !s.multi).map((s) => s.x1);
      const rightEdge = ends.length ? ends.sort((a, b) => a - b)[Math.floor(ends.length * 0.9)] : p.width;
      for (const b of blocksForPage(p, idx, body, rightEdge)) {
        const lines = b.caption ? b.caption.lines.concat(b.lines) : b.lines;
        const blk = { type: b.kind, page: idx, bbox: bbox(lines) };
        if (b.kind === 'pre') {
          blk.text = preText(b);
          if (b.caption) blk.caption = toRuns(b.caption.lines);
        } else {
          blk.runs = toRuns(b.lines);
          if (b.kind === 'heading') {
            const size = Math.max(...b.lines.map((l) => l.size));
            blk.level = size >= body * 1.35 ? 1 : 2;
          }
        }
        out.push(blk);
      }
    });
    return { bodySize: body, blocks: out };
  }

  /** Plain text of a run list (for tests / tooltips). */
  function runsText(runs) {
    return (runs || [])
      .map((r) => (r.k === 'm' ? r.parts.map((p) => (p.pos === 1 ? '^' : p.pos === -1 ? '_' : '') + p.s).join('') : r.s))
      .join('');
  }

  return { classifyFont, analyze, runsText, itemsFromTextContent };
});
