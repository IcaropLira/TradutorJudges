import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const C = require('../shared/core.js');

function dom(html) {
  const { window } = new JSDOM(`<!doctype html><body><div id="r">${html}</div></body>`);
  return window.document;
}

test('keepPattern keeps whole words only, case-insensitive', () => {
  const re = C.keepPattern('string, array , a.b');
  const marked = 'A string, an Array, substring, a.b, axb'.replace(re, '[$&]');
  assert.equal(marked, 'A [string], an [Array], substring, [a.b], axb');
  assert.equal(C.keepPattern(''), null);
});

test('kept words become placeholders and come back untouched', async () => {
  const doc = dom('<p>Given a string <var>s</var> and an array.</p>');
  const units = C.collectUnits([doc.getElementById('r')], { keep: C.keepPattern('string, array') });
  assert.equal(units.length, 1);
  assert.equal(units[0].enc.text, 'Given a ⟦1⟧ ⟦2⟧ and an ⟦3⟧.');
  await C.translateUnit(units[0], async () => 'Dada uma ⟦1⟧ ⟦2⟧ e um ⟦3⟧.');
  assert.equal(doc.querySelector('p').textContent, 'Dada uma string s e um array.');
  assert.equal(C.originalText(units[0]), 'Given a string s and an array.');
  C.showOriginal(units[0]);
  assert.equal(doc.querySelector('p').textContent, 'Given a string s and an array.');
});

test('a translator that drops a placeholder falls back to translating the prose only', async () => {
  const doc = dom('<p>Print <code>YES</code> if possible.</p>');
  const [u] = C.collectUnits([doc.getElementById('r')], {});
  const r = await C.translateUnit(u, async (t) => (t.includes('⟦') ? 'Imprima SIM se possível.' : t.toUpperCase()));
  assert.equal(r.mode, 'plain');
  assert.equal(doc.querySelector('p').textContent, 'PRINT YES IF POSSIBLE.');
  assert.ok(doc.querySelector('p code'), 'the original <code> node is back in place');
});
