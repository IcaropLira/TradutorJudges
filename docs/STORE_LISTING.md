# Página da loja — descrição

Cole no campo **Descrição** da página de detalhes (Chrome Web Store) e no campo de descrição do addons.mozilla.org.
Regra da Chrome Web Store: nada de listas de sites/marcas e nenhuma palavra repetida mais de 5 vezes (violação “Yellow Argon”). Cite poucos judges, dentro de frases, uma vez cada.

**Resumo (o campo curto vem do manifesto):** Translate competitive programming statements, HTML or PDF, on Codeforces, AtCoder, UVa, vjudge and more. Formulas stay intact.

## Português (Brasil)
```
Leia enunciados de programação competitiva no seu idioma sem perder o que importa: fórmulas, código e exemplos continuam intactos.

Como funciona
Em sites como Codeforces e AtCoder, um botão aparece no canto da página. Um clique troca o enunciado pela tradução; outro clique volta ao original. O atalho Alt+Shift+T faz o mesmo em qualquer site.

Enunciados que só existem em arquivo
Muitos arquivos de problemas, como a UVa e os cadernos de prova de maratonas, publicam o enunciado em PDF. A extensão abre esse arquivo num leitor próprio, com a página original de um lado e o texto traduzido do outro. Se o site mostra o arquivo dentro da própria página, caso do vjudge, a tradução aparece no mesmo lugar.

O que é preservado
• Fórmulas matemáticas, variáveis e índices
• Trechos de código e valores literais (YES, NO)
• Exemplos de entrada e saída, com botão para copiar
• Figuras e desenhos do enunciado

Do seu jeito
• Escolha o idioma de destino e o serviço (Google Tradutor ou DeepL com a sua chave)
• Defina palavras que ficam em inglês (por exemplo, string e array)
• Passe o mouse sobre um parágrafo traduzido para ver o texto original
• Clique num parágrafo para ver o trecho correspondente no documento original

Privacidade
Sem conta, sem rastreamento e sem servidor do desenvolvedor. O texto do enunciado só é enviado ao serviço de tradução escolhido quando você pede a tradução; fórmulas e exemplos nunca são enviados.
Política completa: https://github.com/IcaropLira/TradutorJudges/blob/main/PRIVACY.pt-BR.md

Projeto independente, sem vínculo com os sites de problemas, com o Google ou com o DeepL.
```

## English
```
Read competitive programming problem statements in your own language without losing what matters: formulas, code and sample tests stay intact.

How it works
On sites such as Codeforces and AtCoder, a button appears in the corner of the page. One click swaps the statement for its translation; another click brings the original back. The Alt+Shift+T shortcut does the same on any site.

Statements that only exist as files
Many problem archives, such as UVa and contest problem sets, publish statements as PDF files. The extension opens the file in its own reader, with the original page on one side and the translated text on the other. When a site shows the file inside its own page, as vjudge does, the translation appears right there.

What is preserved
• Math formulas, variables and subscripts
• Code snippets and literal values such as YES and NO
• Sample inputs and outputs, with a copy button
• Figures and drawings

Your way
• Choose the target language and the service (Google Translate, or DeepL with your own key)
• Keep chosen words in English (for example, string and array)
• Hover over a translated paragraph to see the original text
• Click a paragraph to see the matching part of the original document

Privacy
No account, no tracking and no developer server. The statement text is only sent to the translation service you chose when you ask for a translation; formulas and samples are never sent.
Full policy: https://github.com/IcaropLira/TradutorJudges/blob/main/PRIVACY.md

Independent project, not affiliated with any online judge, Google or DeepL.
```

# Chrome Web Store — aba Privacidade

Textos prontos para colar (em inglês, que é o que a equipe de revisão lê).

**Single purpose**
> Translate competitive programming problem statements on online judges (web pages and PDF files) into the user's language on request, keeping math formulas, code and sample tests unchanged.

**Permission justifications**

| Permissão | Justificativa |
|---|---|
| `storage` | Saves the user's settings (target language, translation service, words to keep in English, show-original-on-hover, optional DeepL API key), a local cache of translations, and the PDF reader's layout and zoom. storage.session briefly holds a PDF file while it is handed from the judge's page to the extension's PDF reader. |
| `activeTab` | When the user presses the extension's shortcut (Alt+Shift+T) or the "Translate this page" button in the popup on a site that is not one of the supported judges, the translator is added to that tab only, after that explicit user action. |
| `scripting` | Used with activeTab to inject the translator into the current tab on request (sites outside the supported list), and on judge pages that display a PDF statement in their own embedded viewer, to read which PDF that viewer loaded (the page's resource list) so the statement can be translated in place. No remote code is executed; only scripts bundled with the extension. |
| `contextMenus` | Adds a "Translate this PDF" item to the right-click menu on PDF links and PDF pages, which opens the PDF in the extension's translating reader. |
| Host permission | The supported judges (codeforces.com, atcoder.jp, cses.fi, open.kattis.com, spoj.com, acm.timus.ru, dmoj.ca, acmicpc.net, leetcode.com, vjudge.net, onlinejudge.org, icpcarchive.ecs.baylor.edu, qoj.ac): content scripts add the translate button, find PDF statements and add copy buttons to samples; the extension downloads PDF statements from these sites to translate them. translate.googleapis.com, api-free.deepl.com, api.deepl.com: the statement text is sent to the translation service the user selected, only when the user asks for a translation. Optional access to other sites is requested at runtime, per site, only when the user opens a PDF hosted elsewhere. |

**Data usage** (marque só estas duas):
- ☑ **Conteúdo do site**: o texto do enunciado vai para o serviço de tradução escolhido, só quando o usuário pede.
- ☑ **Informações de autenticação**: a chave de API do DeepL (opcional) fica no aparelho e só é enviada ao DeepL para autenticar os pedidos do próprio usuário. (Marcar é a escolha conservadora; se preferir não marcar, seria preciso remover o suporte ao DeepL.)
- ☐ todo o resto (identificação pessoal, saúde, financeiro, comunicações pessoais, local, histórico da Web, atividade do usuário).
- Marque as três declarações (não vende dados; não usa para fins fora do propósito; não usa para crédito/empréstimo).

**Privacy policy URL:** `https://github.com/IcaropLira/TradutorJudges/blob/main/PRIVACY.md`

# Firefox (addons.mozilla.org)

**Coleta de dados (declarada no manifesto):** `websiteContent` obrigatório: o texto do enunciado é transmitido ao serviço de tradução escolhido quando o usuário traduz. O Firefox mostra isso na instalação.

**Política de privacidade:** cole o conteúdo de `PRIVACY.md` no campo de política, ou o link acima.

**Notas para o revisor** (o pacote inclui o pdf.js minificado, que gera avisos de `Function`/`import` no validador):
> The bundled vendor/pdfjs files are the unmodified pdf.js 4.10.38 release (pdfjs-dist on npm, Apache-2.0), used to read PDF statements locally. It is loaded with isEvalSupported: false. Source and build steps: https://github.com/IcaropLira/TradutorJudges (npm install && npm run vendor && npm run build).
