# Privacy Policy — Hiraku Judges Translator

_Last updated: 2026-11-18 · Português: [PRIVACY.pt-BR.md](PRIVACY.pt-BR.md)_

Hiraku Judges Translator is a browser extension that translates competitive programming problem statements (web pages and PDF files) on online judges. This policy explains what it does with your data. The short version: **the developer collects nothing.** There is no server, no account, no analytics and no tracking.

## What stays on your device
- **Settings** (target language, translation service, words kept in English, "show original on hover") are kept in the extension's storage (`storage.sync`, which your browser may sync between your own devices).
- **Your DeepL API key**, if you choose DeepL, is kept in `storage.local` and is never synced. It only leaves the browser to authenticate requests to DeepL (see below).
- **A cache of translations** (up to 1,500 translated passages) and the reader's layout and zoom are kept locally so work is not repeated.
- **PDF files** opened in the reader are handed from the page to the reader through temporary in-memory storage (`storage.session`) and are discarded when the browser closes.

You can delete all of this at any time by uninstalling the extension or clearing its data.

## What is sent over the network, and only when you ask
- **Translation.** When you click *Translate* (or press Alt+Shift+T), the text of the statement on the current page or PDF is sent **directly from your browser** to the service you chose:
  - **Google Translate** (`translate.googleapis.com`), or
  - **DeepL** (`api-free.deepl.com` / `api.deepl.com`), authenticated with your own API key.

  Formulas, code and sample inputs/outputs are replaced by placeholders before sending and are **not** transmitted. Words in your "keep in English" list are not transmitted either. These services handle the text under their own policies: [Google](https://policies.google.com/privacy), [DeepL](https://www.deepl.com/privacy). The extension's developer never receives this text.
- **PDF statements.** To translate a PDF statement, the extension downloads that PDF **from the site that publishes it** (for example a judge's own server), with your normal session on that site so statements that require login also work. The file is processed locally and is not sent anywhere else. For sites outside the built-in list, the browser asks for your permission first.

No other network requests are made. The extension does not load or run remote code (the PDF library, pdf.js, is bundled with it).

## What the extension does not do
It does not collect personal information, browsing history, credentials or identifiers; it does not use its own cookies; it does not sell, share or transfer data to third parties other than the translation service you choose, and only to translate.

## Permissions, in plain words
- `storage`: keep your settings and the local caches.
- `activeTab` and `scripting`: when you press the shortcut or the popup button on a site that is not in the built-in list, add the translator to that tab only; on judge pages that show a PDF in their own viewer, find out which PDF that viewer loaded so it can be translated in place.
- `contextMenus`: the "Translate this PDF" item when you right-click a PDF link or page.
- Access to the supported judges (Codeforces, AtCoder, CSES, Kattis, SPOJ, Timus, DMOJ, Baekjoon, LeetCode, vjudge, UVa, ICPC Live Archive, QOJ): show the translate button and translate statements there, and download their PDF statements.
- Access to `translate.googleapis.com`, `api-free.deepl.com`, `api.deepl.com`: send statement text to the translation service you chose.
- Optional access to other sites: requested only if you open a PDF from a site outside the list, and only for that site.

## Children
The extension is not directed at children and does not collect personal data from anyone.

## Changes
If this policy changes, the new version will be published in this repository with an updated date.

## Contact
Open an issue at <https://github.com/IcaropLira/TradutorJudges/issues>.

_Hiraku Judges Translator is an independent, unofficial project. It is not affiliated with, endorsed by or sponsored by any online judge, Google or DeepL._
