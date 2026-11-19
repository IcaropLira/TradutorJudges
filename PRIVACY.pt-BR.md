# Política de Privacidade — Hiraku Judges Translator

_Última atualização: 2026-11-18 · English: [PRIVACY.md](PRIVACY.md)_

O Hiraku Judges Translator é uma extensão de navegador que traduz enunciados de programação competitiva (páginas e arquivos PDF) em judges online. Esta política explica o que ela faz com os seus dados. Resumindo: **o desenvolvedor não coleta nada.** Não há servidor, conta, análise de uso nem rastreamento.

## O que fica no seu dispositivo
- **Configurações** (idioma de destino, serviço de tradução, palavras mantidas em inglês, "mostrar o original ao passar o mouse") ficam no armazenamento da extensão (`storage.sync`, que o navegador pode sincronizar entre os seus próprios dispositivos).
- **Sua chave de API do DeepL**, se você escolher o DeepL, fica em `storage.local` e nunca é sincronizada. Ela só sai do navegador para autenticar pedidos ao DeepL (veja abaixo).
- **Um cache de traduções** (até 1.500 trechos) e o layout/zoom do leitor ficam guardados localmente para não repetir trabalho.
- **Arquivos PDF** abertos no leitor passam da página para o leitor por um armazenamento temporário em memória (`storage.session`), apagado quando o navegador fecha.

Você pode apagar tudo isso a qualquer momento desinstalando a extensão ou limpando os dados dela.

## O que é enviado pela rede, e só quando você pede
- **Tradução.** Quando você clica em *Traduzir* (ou usa Alt+Shift+T), o texto do enunciado da página ou do PDF atual é enviado **diretamente do seu navegador** ao serviço escolhido:
  - **Google Tradutor** (`translate.googleapis.com`), ou
  - **DeepL** (`api-free.deepl.com` / `api.deepl.com`), autenticado com a sua própria chave de API.

  Fórmulas, código e exemplos de entrada/saída são trocados por marcadores antes do envio e **não** são transmitidos, assim como as palavras da sua lista "manter em inglês". Esses serviços tratam o texto conforme as próprias políticas: [Google](https://policies.google.com/privacy), [DeepL](https://www.deepl.com/privacy). O desenvolvedor da extensão nunca recebe esse texto.
- **Enunciados em PDF.** Para traduzir um PDF, a extensão baixa o arquivo **do próprio site que o publica** (por exemplo, o servidor do judge), com a sua sessão normal nesse site, para que enunciados que exigem login também funcionem. O arquivo é processado localmente e não é enviado a nenhum outro lugar. Para sites fora da lista embutida, o navegador pede a sua permissão antes.

Nenhuma outra requisição de rede é feita. A extensão não carrega nem executa código remoto (a biblioteca de PDF, pdf.js, vem dentro dela).

## O que a extensão não faz
Não coleta informações pessoais, histórico de navegação, credenciais ou identificadores; não usa cookies próprios; não vende, compartilha nem transfere dados a terceiros além do serviço de tradução que você escolher, e apenas para traduzir.

## Permissões, em português claro
- `storage`: guardar suas configurações e os caches locais.
- `activeTab` e `scripting`: quando você usa o atalho ou o botão do popup num site fora da lista, colocar o tradutor só naquela aba; em páginas de judges que mostram o PDF no próprio visualizador, descobrir qual PDF esse visualizador carregou para traduzi-lo no lugar.
- `contextMenus`: o item "Traduzir este PDF" ao clicar com o botão direito num link ou página de PDF.
- Acesso aos judges suportados (Codeforces, AtCoder, CSES, Kattis, SPOJ, Timus, DMOJ, Baekjoon, LeetCode, vjudge, UVa, ICPC Live Archive, QOJ): mostrar o botão de tradução, traduzir os enunciados e baixar os enunciados em PDF.
- Acesso a `translate.googleapis.com`, `api-free.deepl.com`, `api.deepl.com`: enviar o texto do enunciado ao serviço escolhido.
- Acesso opcional a outros sites: pedido só se você abrir um PDF de um site fora da lista, e só para aquele site.

## Crianças
A extensão não é direcionada a crianças e não coleta dados pessoais de ninguém.

## Mudanças
Se esta política mudar, a nova versão será publicada neste repositório com a data atualizada.

## Contato
Abra uma issue em <https://github.com/IcaropLira/TradutorJudges/issues>.

_O Hiraku Judges Translator é um projeto independente e não oficial. Não é afiliado, endossado nem patrocinado por nenhum judge online, pelo Google ou pelo DeepL._
