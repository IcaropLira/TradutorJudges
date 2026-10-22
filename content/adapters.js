/*
 * Judge Translate - site adapters.
 * Each adapter says where the statement lives on a judge. `tiers` are tried in order;
 * the first tier that matches anything wins. Pages without an adapter (or where the
 * adapter finds nothing) fall back to a generic "main content" heuristic, so the
 * shortcut / popup button still works on any site.
 *
 * Codeforces, AtCoder and CSES are the first-class targets. The others are best-effort
 * selectors: if a judge changes its markup, fix the selector here (one line).
 */
(function () {
  'use strict';
  const J = (self.JudgeTr = self.JudgeTr || {});

  const ADAPTERS = [
    { id: 'codeforces', host: /(^|\.)codeforces\.com$|^codeforc\.es$/, tiers: [['.problem-statement'], ['.ttypography']] },
    { id: 'atcoder', host: /(^|\.)atcoder\.jp$/, tiers: [['#task-statement']] },
    { id: 'cses', host: /(^|\.)cses\.fi$/, tiers: [['.title-block', '.md']] },
    { id: 'kattis', host: /(^|\.)kattis\.com$/, tiers: [['.problembody']] },
    { id: 'spoj', host: /(^|\.)spoj\.com$/, tiers: [['#problem-body']] },
    { id: 'timus', host: /(^|\.)timus\.ru$/, tiers: [['.problem_content']] },
    { id: 'dmoj', host: /(^|\.)dmoj\.ca$/, tiers: [['.content-description']] },
    {
      id: 'boj',
      host: /(^|\.)acmicpc\.net$/,
      tiers: [['#problem-body'], ['#problem_description', '#problem_input', '#problem_output', '#problem_hint']],
    },
    { id: 'leetcode', host: /(^|\.)leetcode\.com$/, tiers: [['[data-track-load="description_content"]']] },
    // vjudge shows the statement inside a same-origin <iframe>: read the frame bodies directly.
    // noGeneric: never fall back to translating the surrounding page chrome.
    { id: 'vjudge', host: /(^|\.)vjudge\.net$/, tiers: [], frames: true, noGeneric: true, poll: true },
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

  J.findAdapter = findAdapter;
  J.adapterIds = ADAPTERS.map((a) => a.id);
})();
