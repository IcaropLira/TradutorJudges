(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const J = window.JudgeTr;
  const $ = (id) => document.getElementById(id);

  $('title').textContent = J.t('popupTitle');
  $('page').textContent = J.t('translatePage');
  $('lblTarget').textContent = J.t('target');
  $('lblService').textContent = J.t('service');
  $('lblKey').textContent = J.t('deeplKey');
  $('hint').textContent = J.t('popupHint');

  for (const [code, name] of J.LANGS) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = name;
    $('target').appendChild(o);
  }

  function syncKeyRow() {
    $('keyRow').hidden = $('service').value !== 'deepl';
  }

  (async () => {
    const s = await api.storage.sync.get({ target: J.defaultTarget(navigator.language), service: 'google' });
    const l = await api.storage.local.get({ deeplKey: '' });
    $('target').value = s.target;
    $('service').value = s.service;
    $('deeplKey').value = l.deeplKey;
    syncKeyRow();
  })();

  $('target').addEventListener('change', () => api.storage.sync.set({ target: $('target').value }));
  $('service').addEventListener('change', () => {
    syncKeyRow();
    api.storage.sync.set({ service: $('service').value });
  });
  // The key stays in local storage on purpose: it is never synced to other devices.
  $('deeplKey').addEventListener('change', () => api.storage.local.set({ deeplKey: $('deeplKey').value.trim() }));

  $('page').addEventListener('click', async () => {
    await api.runtime.sendMessage({ type: 'toggle-active-tab' });
    window.close();
  });
})();
