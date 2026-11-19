/*
 * Hiraku Judges Translator - site adapters.
 * Each adapter says where the statement lives on a judge. `tiers` are tried in order;
 * the first tier that matches anything wins. Pages without an adapter (or where the
 * adapter finds nothing) fall back to a generic "main content" heuristic, so the
 * shortcut / popup button still works on any site.
 *
 * Codeforces, AtCoder and CSES are the first-class targets. The others are best-effort
 * selectors: if a judge changes its markup, fix the selector here (one line).
 *
 * `copy`: add "Copy" buttons above the <pre> samples (judges that have none of their own).
 * Judges that publish statements as PDF (UVa, ICPC Live Archive, Codeforces Gym, some SPOJ
 * problems...) need no selector: the content script finds the PDF links / embeds itself.
 */
(function () {
  'use strict';
  const J = (self.JudgeTr = self.JudgeTr || {});

  const ADAPTERS = [
    { id: 'codeforces', host: /(^|\.)codeforces\.com$|^codeforc\.es$/, tiers: [['.problem-statement'], ['.ttypography']] },
    { id: 'atcoder', host: /(^|\.)atcoder\.jp$/, tiers: [['#task-statement']] },
    { id: 'cses', host: /(^|\.)cses\.fi$/, tiers: [['.title-block', '.md']], copy: true },
    { id: 'kattis', host: /(^|\.)kattis\.com$/, tiers: [['.problembody']] },
    { id: 'spoj', host: /(^|\.)spoj\.com$/, tiers: [['#problem-body']], copy: true },
    { id: 'timus', host: /(^|\.)timus\.ru$/, tiers: [['.problem_content']], copy: true },
    { id: 'dmoj', host: /(^|\.)dmoj\.ca$/, tiers: [['.content-description']] },
    {
      id: 'boj',
      host: /(^|\.)acmicpc\.net$/,
      tiers: [['#problem-body'], ['#problem_description', '#problem_input', '#problem_output', '#problem_hint']],
    },
    { id: 'leetcode', host: /(^|\.)leetcode\.com$/, tiers: [['[data-track-load="description_content"]']] },
    // vjudge shows the statement inside a same-origin <iframe>: read the frame bodies directly.
    // noGeneric: never fall back to translating the surrounding page chrome.
    { id: 'vjudge', host: /(^|\.)vjudge\.net$/, tiers: [], frames: true, noGeneric: true, poll: true, copy: true },
    // UVa: the statement is a PDF (older problems: an HTML page in a frame).
    { id: 'uva', host: /(^|\.)onlinejudge\.org$/, tiers: [], frames: true, noGeneric: true, poll: true, copy: true },
    // PDF-only archives: nothing to translate in the page itself, only the PDF button.
    { id: 'livearchive', host: /(^|\.)icpcarchive\.ecs\.baylor\.edu$/, tiers: [], noGeneric: true },
    { id: 'qoj', host: /(^|\.)qoj\.ac$/, tiers: [['.uoj-article']], noGeneric: true },
  ];

  function frameBodies(doc) {
    const out = [];
    for (const f of doc.querySelectorAll('iframe')) {
      try {
        const b = f.contentDocument && f.contentDocument.body;
        if (b && (b.textContent || '').trim().length > 60) out.push(b);
      } catch (_) { /* cross-origin frame: not reachable */ }
    }
    return out;
  }

  function dedupe(els) {
    const uniq = Array.from(new Set(els));
    return uniq.filter((e) => !uniq.some((o) => o !== e && o.contains(e)));
  }

  function findAdapter(hostname) {
    const a = ADAPTERS.find((x) => x.host.test(hostname));
    if (!a) return null;
    return {
      id: a.id,
      noGeneric: !!a.noGeneric,
      poll: !!a.poll,
      copy: !!a.copy,
      roots(doc) {
        for (const tier of a.tiers) {
          const found = [];
          for (const sel of tier) found.push(...doc.querySelectorAll(sel));
          if (found.length) return dedupe(found);
        }
        return a.frames ? frameBodies(doc) : [];
      },
    };
  }

  // ------------------------------------------------------------ PDF statements

  const PDF_PATH = /\.pdf$/i;

  function pdfUrlOf(raw, base) {
    if (!raw) return null;
    try {
      const u = new URL(raw, base);
      if (!/^(https?|file):$/.test(u.protocol)) return null;
      return u;
    } catch (_) {
      return null;
    }
  }

  function sameOriginDocs(doc) {
    const out = [doc];
    for (const f of doc.querySelectorAll('iframe,frame')) {
      try {
        const d = f.contentDocument;
        if (d && d.documentElement) out.push(...sameOriginDocs(d));
      } catch (_) { /* cross-origin */ }
    }
    return out;
  }

  /**
   * Every PDF reference in the page: embedded ones first (that is usually the statement),
   * then links. Returns [{url, el, embedded, title}]; the same URL may appear once per element.
   */
  function findPdfs(doc) {
    const seen = new Set();
    const out = [];
    const add = (url, el, embedded) => {
      if (!url) return;
      const k = url.href + '|' + (el ? '' : 'frame');
      if (el ? seen.has(el) : seen.has(k)) return;
      seen.add(el || k);
      out.push({ url: url.href, el, embedded, title: decodeURIComponent(url.pathname.split('/').pop() || '') });
    };
    for (const d of sameOriginDocs(doc)) {
      const base = d.baseURI;
      // a frame that *is* a PDF
      if (d !== doc && d.contentType === 'application/pdf') {
        const fe = d.defaultView && d.defaultView.frameElement;
        add(pdfUrlOf(d.URL, base), fe || null, true);
      }
      for (const el of d.querySelectorAll('iframe[src],frame[src],embed[src],object[data]')) {
        const u = pdfUrlOf(el.getAttribute('src') || el.getAttribute('data'), base);
        if (!u) continue;
        const typed = /pdf/i.test(el.getAttribute('type') || '');
        if (typed || PDF_PATH.test(u.pathname)) add(u, el, true);
      }
      for (const a of d.querySelectorAll('a[href]')) {
        const u = pdfUrlOf(a.getAttribute('href'), base);
        if (!u) continue;
        if (PDF_PATH.test(u.pathname) || /pdf/i.test(a.getAttribute('type') || '')) add(u, a, false);
      }
    }
    out.sort((a, b) => Number(b.embedded) - Number(a.embedded));
    return out;
  }

  // ------------------------------------------------------ embedded PDF viewers

  // pdf.js (and viewers built on it) render pages as canvases plus an invisible text layer.
  const VIEWER_MARKS = '.pdfViewer, .textLayer, #viewerContainer, [data-page-number] canvas, .react-pdf__Document, pdf-viewer, ngx-extended-pdf-viewer';
  const PDF_ICON = '.fa-file-pdf, .fa-file-pdf-o, [class*="file-pdf"], [class*="pdf-icon"]';

  function looksLikePdfResource(name) {
    return /\.pdf(?:$|[?#])/i.test(name) || /[/=_-]pdf(?:$|[/?#&])/i.test(name);
  }

  /** URLs this document fetched that look like PDFs (resource timing survives the viewer's own JS). */
  function fetchedPdfs(d) {
    const out = [];
    try {
      const perf = d.defaultView && d.defaultView.performance;
      for (const e of perf ? perf.getEntriesByType('resource') : []) {
        if (/^(fetch|xmlhttprequest|other|iframe|embed|object)$/.test(e.initiatorType) && looksLikePdfResource(e.name)) out.push(e.name);
      }
    } catch (_) { /* no resource timing */ }
    return out;
  }

  /** Links labelled "PDF" (vjudge's "PDF" button, UVa's "Download as PDF"...) even without a .pdf path. */
  function pdfLabelledLinks(d) {
    const out = [];
    for (const a of d.querySelectorAll('a[href]')) {
      const label = (a.textContent || '').trim();
      if (/^(?:download\s+(?:as\s+)?)?pdf$|^baixar\s+pdf$/i.test(label) || a.querySelector(PDF_ICON) || looksLikePdfResource(a.href)) {
        const u = pdfUrlOf(a.getAttribute('href'), d.baseURI);
        if (u && !u.href.startsWith(d.URL.split('#')[0] + '#')) out.push(u.href);
      }
    }
    return out;
  }

  /** The element in its own document that holds a viewer living in that same document. */
  function viewerBox(d) {
    const pages = d.querySelector('.pdfViewer, .react-pdf__Document, pdf-viewer, ngx-extended-pdf-viewer') ||
      (d.querySelector('.textLayer, [data-page-number] canvas') || {}).parentElement;
    if (!pages) return null;
    // climb to the scrolling box (or a reasonably large wrapper) that contains the toolbar too
    let el = pages;
    for (let p = pages.parentElement; p && p !== d.body; p = p.parentElement) {
      el = p;
      const cs = d.defaultView.getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.clientHeight > 200) {
        // include a sibling toolbar (search box, zoom select) when it sits right above
        const parent = p.parentElement;
        if (parent && parent !== d.body && parent.querySelector('input, select') && parent.clientHeight < p.clientHeight + 160) el = parent;
        break;
      }
    }
    return el;
  }

  /**
   * Embedded PDF viewers in the page. For each: `box` is the element (in the top document)
   * to swap for the translation, `candidates` the URLs that may be the PDF, best first.
   */
  function findPdfViewers(doc) {
    const out = [];
    for (const d of sameOriginDocs(doc)) {
      if (!d.querySelector(VIEWER_MARKS)) continue;
      // the frame holding the viewer, as seen from the top document
      let box = null;
      let w = d.defaultView;
      if (d === doc) box = viewerBox(d);
      else {
        while (w && w.frameElement && w.frameElement.ownerDocument !== doc) w = w.frameElement.ownerDocument.defaultView;
        box = w && w.frameElement;
        // the viewer fills only part of its frame: swap just the viewer when the frame has other content
        const inner = viewerBox(d);
        if (inner && d.body && (d.body.innerText || '').length - (inner.innerText || '').length > 400) box = inner;
      }
      if (!box || out.some((v) => v.box === box)) continue;
      const cands = [];
      const push = (u) => { if (u && !cands.includes(u)) cands.push(u); };
      for (const el of d.querySelectorAll('[data-url],[data-src],[data-pdf],[data-file]')) {
        const raw = el.getAttribute('data-pdf') || el.getAttribute('data-file') || el.getAttribute('data-url') || el.getAttribute('data-src');
        const u = pdfUrlOf(raw, d.baseURI);
        if (u && looksLikePdfResource(u.href)) push(u.href);
      }
      fetchedPdfs(d).forEach(push);
      if (d !== doc) fetchedPdfs(doc).forEach(push);
      for (const p of findPdfs(d)) push(p.url);
      pdfLabelledLinks(d).forEach(push);
      if (d !== doc) {
        pdfLabelledLinks(doc).forEach(push);
        for (const p of findPdfs(doc)) push(p.url);
      }
      // last resort: everything the viewer fetched (checked for "%PDF" before use)
      try {
        for (const e of d.defaultView.performance.getEntriesByType('resource')) {
          if (/^(fetch|xmlhttprequest)$/.test(e.initiatorType) && e.transferSize > 2000) push(e.name);
        }
      } catch (_) { /* ignore */ }
      out.push({ box, doc: d, candidates: cands });
    }
    return out;
  }

  J.findAdapter = findAdapter;
  J.findPdfs = findPdfs;
  J.findPdfViewers = findPdfViewers;
  J.adapterIds = ADAPTERS.map((a) => a.id);
})();
