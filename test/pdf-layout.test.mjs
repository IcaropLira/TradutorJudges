import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const L = require('../shared/pdf-layout.js');
const dir = path.dirname(new URL(import.meta.url).pathname);
const fontsDir = path.resolve(dir, '../node_modules/pdfjs-dist/standard_fonts/') + '/';

/** Same extraction the reader does, in Node. */
async function analyzeFile(name) {
  const data = new Uint8Array(fs.readFileSync(path.join(dir, 'fixtures', name)));
  const doc = await getDocument({ data, fontExtraProperties: true, disableFontFace: true, verbosity: 0, standardFontDataUrl: fontsDir }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    await page.getOperatorList();
    const tc = await page.getTextContent();
    const [x0, y0, x1, y1] = page.view;
    pages.push({ width: x1 - x0, height: y1 - y0, items: L.itemsFromTextContent(tc, (id) => (page.commonObjs.has(id) ? page.commonObjs.get(id) : null)) });
  }
  return L.analyze(pages);
}

// ⟦formula⟧ and `code` markers make the expectations readable
const show = (b) =>
  b.type === 'pre'
    ? b.text
    : b.runs.map((r) => (r.k === 't' ? r.s : r.k === 'c' ? '`' + r.s + '`' : '⟦' + L.runsText([r]) + '⟧')).join('');

test('classifyFont', () => {
  assert.deepEqual(L.classifyFont('ABCDEF+CMMI10'), { math: true, mono: false, bold: false, italic: false });
  assert.equal(L.classifyFont('XYZABC+CMTT10').mono, true);
  assert.equal(L.classifyFont('Courier-Bold').bold, true);
  assert.equal(L.classifyFont('Times-Italic').italic, true);
  assert.equal(L.classifyFont('QWERTY+CMR10').math, false);
  assert.equal(L.classifyFont('CMSY10').mono, false); // pdf.js flags CMSY as monospace: name wins
});

test('UVa-style LaTeX statement', async () => {
  const { blocks } = await analyzeFile('uva.pdf');
  const s = blocks.map((b) => `${b.type}: ${show(b)}`);
  assert.equal(s[0], 'heading: 12429 – Finding Magic Triplets');
  assert.match(s[1], /^para: Given a positive integer ⟦n⟧ and a modulus ⟦k⟧, count the number of triplets ⟦\(a, b, c\)⟧ such that ⟦1 ≤ a ≤ b ≤ c ≤ n⟧ and ⟦a \+ b\^2 ≡ c\^3⟧ \(mod ⟦k⟧\)\. This is/);
  assert.match(s[1], /joined back into a single paragraph/); // wrapped lines rejoined
  assert.match(s[2], /^para: A second paragraph starts here\./); // indentation starts a paragraph
  assert.equal(s[3], 'heading: Input');
  assert.match(s[4], /⟦1 ≤ n, k ≤ 10\^5⟧\.$/); // superscript kept, sentence period left outside
  assert.match(s[6], /print “Case ⟦x: y⟧” where ⟦x⟧/);
  const pres = blocks.filter((b) => b.type === 'pre').map((b) => b.text);
  assert.deepEqual(pres, ['2\n10 7\n1 1', 'Case 1: 27\nCase 2: 1']);
});

test('ICPC-style set: side-by-side samples, inline code, several problems', async () => {
  const { blocks } = await analyzeFile('icpc.pdf');
  const s = blocks.map((b) => `${b.type}: ${show(b)}`);
  assert.match(s.find((x) => x.startsWith('para: Output')), /Output `YES` if it is possible, and `NO` otherwise\./);
  assert.ok(s.some((x) => /weight ⟦w_i⟧\./.test(x)));
  const pres = blocks.filter((b) => b.type === 'pre');
  assert.equal(pres.length, 2);
  assert.equal(L.runsText(pres[0].caption), 'Sample Input 1');
  assert.equal(pres[0].text, '4 1 2 3 0\n3 1 1 1');
  assert.equal(L.runsText(pres[1].caption), 'Sample Output 1');
  assert.equal(pres[1].text, 'YES\nNO');
  assert.deepEqual(
    blocks.filter((b) => b.type === 'heading' && /^Problem/.test(show(b))).map((b) => [b.page, show(b)]),
    [[0, 'Problem A: Apples'], [1, 'Problem B: Bridges']]
  );
});

test('Word/SPOJ-style PDF: italic variables, running header and page numbers dropped', async () => {
  const { blocks } = await analyzeFile('word.pdf');
  const s = blocks.map(show);
  assert.ok(!s.some((x) => /SPOJ Regional Contest/.test(x)), 'running header removed');
  assert.ok(!s.some((x) => /^\d+$/.test(x)), 'page numbers removed');
  assert.match(s[1], /You are given a string ⟦S⟧ of length ⟦n⟧\. Find the longest substring/);
  assert.equal(blocks.filter((b) => b.type === 'pre')[0].text, 'Input:\n3\nabcabc\n\nOutput:\n3');
});

test('labels inside a drawing do not become paragraphs', async () => {
  const { blocks } = await analyzeFile('bridges.pdf');
  const s = blocks.map(show);
  assert.ok(!s.some((x) => /^[\d\s]{1,4}$/.test(x)), 'no stray node numbers: ' + JSON.stringify(s.slice(0, 8)));
  assert.ok(s.includes('Figure 1: the fragile bridges are drawn thicker.'));
  // the figure sits in the gap between these two paragraphs
  const i = s.findIndex((x) => x.startsWith('The kingdom of Arcadia'));
  assert.equal(s[i + 1], 'Figure 1: the fragile bridges are drawn thicker.');
  assert.ok(blocks[i].bbox.y0 - blocks[i + 1].bbox.y1 > 50);
});
