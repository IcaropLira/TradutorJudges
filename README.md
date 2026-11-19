<p align="center"><img src="icons/logo.svg" alt="Hiraku Judges Translator" height="180"></p>

# Hiraku Judges Translator

Extensão para Chrome/Edge/Firefox (Manifest V3) que traduz enunciados de programação competitiva com um clique, **sem estragar fórmulas, código e exemplos**. Funciona com enunciados em HTML e também com os judges que publicam o enunciado **em PDF** (UVa, ICPC Live Archive, Codeforces Gym, alguns problemas do SPOJ, conjuntos de regionais…).

## O que faz

**Enunciados em HTML** (Codeforces, AtCoder, CSES, Kattis, SPOJ, Timus, DMOJ, BOJ, LeetCode, vjudge, QOJ)
- Botão flutuante **Traduzir** / **Ver original**, ou o atalho `Alt+Shift+T`.
- Fórmulas (MathJax/KaTeX/TeX cru), `<code>`, `<pre>` e exemplos viram marcadores `⟦n⟧` e nunca são enviados ao tradutor; os nós originais são recolocados no lugar.
- **Original ao passar o mouse**: cada parágrafo traduzido mostra o texto original como dica.
- **Botões “Copiar”** nos exemplos dos judges que não têm (SPOJ, Timus, CSES, UVa, vjudge).
- Em qualquer outro site: botão do popup ou `Alt+Shift+T`.

**Enunciados em PDF**
- **Visualizadores de PDF dentro do site** (como o do vjudge para problemas da UVa): o botão **Traduzir** troca o visualizador, no mesmo lugar da página, pela versão traduzida; **Ver original** traz o visualizador de volta. A extensão acha o PDF pelo link “PDF” da página, pelos atributos do visualizador ou pelas requisições que o próprio visualizador fez (funciona mesmo sem `.pdf` na URL). A tradução acompanha o tema claro/escuro do site e some sozinha quando você troca de problema.
- Nos judges, todo link/embed de PDF ganha um botão **Traduzir PDF** (e o botão flutuante vira “Traduzir PDF” quando a página só tem o PDF, como na UVa).
- Com o PDF aberto direto no navegador: `Alt+Shift+T`, o botão do popup, ou clique direito → *Traduzir este PDF*. Também funciona em qualquer link `.pdf` pelo menu de contexto.
- O **leitor** mostra o PDF original de um lado e o texto reconstruído e traduzido do outro:
  - parágrafos, títulos, fórmulas (fontes de matemática do LaTeX/Word detectadas e preservadas, com sub/sobrescritos), `código` inline;
  - exemplos de entrada/saída como blocos copiáveis, inclusive na tabela lado a lado dos PDFs do ICPC;
  - cabeçalhos e números de página repetidos são removidos;
  - clique num parágrafo para destacar o trecho no PDF (e clique no PDF para achar o parágrafo);
  - menu **Ir para…** com os problemas de um caderno de prova inteiro;
  - tradução preguiçosa: só traduz as páginas que você está vendo (bom para PDFs de 30 páginas e para não estourar o limite do Google);
  - layouts lado a lado / só texto / só PDF, zoom, abrir arquivo local ou arrastar e soltar.
- PDFs que exigem login (Gym privado, contests) funcionam: o próprio site baixa o PDF com seus cookies e entrega ao leitor.
- PDF de outro site sem permissão? O leitor oferece o botão **Permitir acesso a …** (permissão opcional, pedida só quando precisa).
- PDF escaneado (só imagem) não tem texto: o leitor avisa e mostra o original.

**Termos mantidos em inglês**: no popup há uma lista (padrão: `string, substring, array, subarray, bitmask`) de palavras que ficam como estão. Chega de “corda” no lugar de *string*.

**Serviços**: Google Translate (sem chave) ou DeepL (com chave da API, guardada só localmente). Traduções ficam em cache.

## Gerar e instalar

```sh
npm install
npm run build      # gera dist/chrome, dist/firefox e os .zip de cada um
npm run check      # testes + build + validação do pacote do Firefox (web-ext lint)
```

O manifesto fica em `manifest.base.json`; o `build.mjs` gera o de cada navegador (service worker no Chrome; background scripts, ID e declaração de dados no Firefox).

**Chrome / Edge / Brave**: `chrome://extensions` → ative *Modo do desenvolvedor* → *Carregar sem compactação* → escolha `dist/chrome`. Para PDFs locais (`file://`), ative *Permitir acesso a URLs de arquivo* nos detalhes da extensão. Para a Chrome Web Store, envie `dist/hiraku-judges-translator-<versão>-chrome.zip`.

**Firefox (140+)**: `about:debugging#/runtime/this-firefox` → *Carregar extensão temporária* → escolha `dist/firefox/manifest.json` (fica até fechar o navegador). Para instalar de vez, o Firefox exige a extensão assinada: envie `dist/hiraku-judges-translator-<versão>-firefox.zip` no addons.mozilla.org (listada ou só para distribuição própria). O ID usado é `hiraku-judges-translator@icaroplira`; troque com `GECKO_ID=... npm run build`.
No Firefox, a extensão declara envio de *conteúdo de sites* porque o texto do enunciado vai para o serviço de tradução (Google/DeepL) quando você pede a tradução.

## Privacidade

O desenvolvedor não coleta nada; o texto do enunciado só vai para o serviço de tradução escolhido, quando você pede. Veja [PRIVACY.pt-BR.md](PRIVACY.pt-BR.md) / [PRIVACY.md](PRIVACY.md). Respostas do formulário das lojas: [docs/STORE_LISTING.md](docs/STORE_LISTING.md).

## Estrutura

| Arquivo | Papel |
|---|---|
| `shared/core.js` | Motor de tradução: transforma o DOM em unidades com marcadores, valida a resposta e recoloca os nós originais. |
| `shared/pdf-layout.js` | Análise de layout do PDF: linhas, colunas, parágrafos, títulos, fórmulas, exemplos, cabeçalhos repetidos. Funções puras (testadas em Node). |
| `reader/` | Leitor de PDF (pdf.js + motor de tradução). |
| `content/adapters.js` | Onde fica o enunciado em cada judge + detecção de PDFs. |
| `content/content.js` | Botão flutuante, botões de PDF e de copiar, orquestração. |
| `background.js` | Chamadas de tradução, cache, atalho, menu de contexto, abertura do leitor. |
| `vendor/pdfjs/` | pdf.js 4.10 (Apache-2.0), embutido porque o MV3 proíbe código remoto. |

Se um judge mudar o HTML, normalmente basta ajustar um seletor em `content/adapters.js`.

## Logo

Os ícones (`icons/`) são gerados por `scripts/make-logo.py` (SVG no estilo das logos Hiraku: degradê rosa → lilás → roxo, brilhos de quatro pontas). Para regenerar os PNGs: `python3 scripts/make-logo.py icons` e converta com `rsvg-convert` (16/32 a partir de `icon-small.svg`, 48/128 a partir de `icon.svg`).

## Testes

```sh
npm install
npm test
```

Os testes rodam a extração do leitor em PDFs de exemplo (`test/fixtures`: estilo UVa em LaTeX, caderno do ICPC com exemplos em tabela, PDF estilo Word/SPOJ) e o motor de tradução com jsdom. Para atualizar o pdf.js: `npm install pdfjs-dist@<versão> && npm run vendor`.
