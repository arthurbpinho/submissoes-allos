# Submissões Allos

Editais de revista, inscrição e envio de textos, avaliação por IA, revisão com
marcações e publicação. Endereço: **submissao.allos.org.br** (admin em `/admin`).

Mesma base do all_OS / allosvendas (Express + React/Vite, mesma identidade
visual), trocando os arquivos JSON por **SQLite** (`node:sqlite`, nativo do Node).

## Rodar localmente

Requer **Node 22.5 ou mais novo** (por causa do `node:sqlite`).

```bash
cp .env.example .env   # preencha JWT_SECRET e ADMIN_INITIAL_PASSWORD (entre aspas se tiver #)
npm install
npm run dev            # API na 3001 + site na http://localhost:5173
npm test               # 47 testes
```

- Site: http://localhost:5173 · Admin: http://localhost:5173/admin (usuário `admin`,
  senha do `ADMIN_INITIAL_PASSWORD`; ela só vale no primeiro boot, quando o banco é criado).
- **Sem `OPENAI_API_KEY`, o app roda em modo demonstração**: a avaliação sai na hora,
  com notas e textos fictícios, para navegar o fluxo inteiro sem custo. Para testar o
  portão nesse modo, escreva no texto `[[elimina]]` (nota 0) ou `[[alerta]]` (nota 1).
- Com a chave, `AVALIACAO_MODO=batch` usa a Batch API (até 24h) e `AVALIACAO_MODO=direto`
  faz chamadas normais (minutos), útil para testar.
- O banco fica em `server/data/submissoes.db`. Para começar do zero, pare o servidor e apague esse arquivo.

## O fluxo

| Etapa | Quem | O que acontece |
|---|---|---|
| Edital | admin | Cria em **Editais**: textos, limites de palavras, limiar de descarte (opcional), **abre em / fecha em / fica no ar até**, chave *publicado* e chave *inscrições* (fecha antes do prazo, como no `/processoseletivopsi`). |
| Inscrição | autor | Na home, **Participar** → cadastro (nome, sobrenome, curso, faculdade, período, e-mail, senha com as 5 regras, consentimento). |
| Envio | autor | No painel, anexa o **.txt** (com consentimento) → status *Texto enviado* + **e-mail 1**. |
| Avaliação | sistema | Sozinho: *enviado* → *em avaliação* (lote submetido) → pronto para o admin. O autor continua vendo *em avaliação*. |
| Decisão | admin | Em **Avaliação** (lista ordenada pelo total), lê as regras do edital, as notas e o feedback da IA, edita o feedback, escreve pedidos de correção (opcional) e **aprova ou reprova**. Mostra a prévia do e-mail antes. → **e-mail 2**. Reprovado termina aqui. |
| Revisão | admin | Em **Revisão**, seleciona trechos do texto: destaque em 5 cores, sublinhar, cortar, comentar. Rascunho salvo sozinho. **Enviar correção** → e-mail de correção. Ou **aceitar** o texto direto. |
| Correção | autor | Em `/correcao`, corrige o texto **no próprio site**, com as marcações acompanhando o que é digitado. Marca "Corrigi" ou "Não vou corrigir" (com justificativa), escreve observações e envia. Também pode carregar um .txt novo. |
| Conferência | admin | Vê as respostas, as marcações no texto corrigido e **o que mudou** (diff). Manda nova rodada ou aceita. |
| Diagramação / publicação | admin | Manual por enquanto: *Diagramado* → *Publicar* com o link da revista. O autor vê o link no painel. |

E-mails: só os do fluxo — texto recebido, decisão (aprovado/reprovado) e pedido de correção
(um por rodada). Sem o Microsoft Entra configurado, **nada sai**: cada e-mail fica registrado em
**Admin → E-mails** como "não configurado", com a prévia, e pode ser reenviado depois.

## Avaliação por IA

Estrutura do quadro branco do pipeline (a mesma do all_OS) com os critérios e a régua do documento
"Avaliador da revista" (`.prompts/Avaliador da revista — *.md`):

```
metacomando → princípios → [resumo do edital + texto]        ← prefixo comum dos 10 nós (cache)
fase 1 · portão: critério 10, Regras do edital, régua 0/1/2 (pior ocorrência)
         0 → eliminado: os critérios 1–9 NÃO rodam (economia); o admin ainda decide
         1 → segue, com o sinal "Conferir regra" para o admin
         2 → segue
fase 2 · critérios 1–9, cegos, em paralelo, régua 0–5 (referência: artigo publicado)
agregador (código): total 0–45 = Relevância (1–3) + Rigor (4–6) + Escrita (7–9), 0–15 cada
sintetizador (IA): feedback ao autor, neutro quanto à decisão
```

- **Por que o portão vai antes:** o que pesa no custo de cada nó é a *saída* (o raciocínio);
  o cache só barateia a *entrada*. Cortar os eliminados poupa os outros nove nós. Empata com o
  paralelo em ~3% de eliminação; com 30% economiza ~24%. Custo: até dois lotes por texto.
- **Cache:** os dez nós mandam a mesma mensagem `developer` (metacomando, princípios, edital e
  texto); a régua e o critério vão na mensagem `user`, no fim. `prompt_cache_key` por submissão.
- **Sem nota de corte:** como no guia, a escolha é comparativa e humana. A lista de Avaliação vem
  ordenada pelo total, e o total e os três terços ganham cor pela **posição no lote** do edital
  (20% de cima verde, 20% de baixo vermelho), a partir de 5 textos avaliados. O edital tem um
  **limiar de descarte** opcional: abaixo dele, o texto ganha o sinal "abaixo do limiar".
- **Divergências do guia, decididas na conversa:** a nota 0 do portão não reprova sozinha (todo
  aprovado/reprovado passa pelo admin), e o resumo do edital vai também para os nós 1–9 (custa
  nada: está no prefixo em cache).
- Nó com saída fora do formato é refeito numa chamada normal (até 3 vezes). Lote recusado por
  fila cheia (`token_limit_exceeded`) ou expirado volta para a fila na mesma fase; erro definitivo
  fica visível no detalhe da submissão, com o botão **Reavaliar**.
- **Limite importante:** o modelo não tem internet. Ele aponta *sinais* de referência inventada e
  de plágio, mas não confere em bases. Integrações sugeridas no guia (relatório de similaridade e
  checagem de DOI como insumos do critério 10) ficam para depois.

### Prompts

Moram no banco, nunca no repositório (ficam fora do git). Os arquivos em `.prompts/` são
semeados no primeiro boot; depois disso, edite em **Admin → Prompts** (cada salvamento é uma
versão nova; cada avaliação grava qual versão usou, inclusive entre as duas fases).

| Slot | Arquivo semente | Conteúdo |
|---|---|---|
| Metacomando | `metacomando.md` | o "cabeçalho comum" que o guia deixou por escrever |
| Princípios | `principios.md` | contra os vícios típicos de IA ao avaliar |
| Régua geral | `regua.md` | a régua 0–5 do guia, literal, + formato `ANÁLISE` / `FALTOU` / `NOTA` |
| Régua do portão | `regua_portao.md` | a régua 0/1/2 do guia, literal, + formato `ANÁLISE` / `NOTA` |
| Critérios | `criterios.md` | os 10 critérios do documento, **sem alteração** (um teste confere) |
| Sintetizador | `sintetizador.md` | feedback ao autor (`{{EDITAL}}`, `{{TEXTO}}`, `{{PORTAO}}`, `{{ANALISES}}`) |

Para trocar os critérios, cole o documento em Admin → Prompts → Critérios: seções `## N. Nome`,
de 1 a 10, cada uma com a prosa do critério. O 10 é sempre o portão; 1–3, 4–6 e 7–9 são os terços.

### Calibração (do guia, antes do primeiro lote real)

Rodar os textos de teste com perfil conhecido (bonito e vazio, empírico sem brilho, ensaio
hermético…) e medir **consistência** (mesmo texto duas vezes: no máximo um nível de diferença),
**inflação** (com texto de aluno, a maioria entre 1 e 2) e **peso efetivo** dos terços.

## Estrutura

```
server/index.js        boot, segurança, auth, rotas públicas e do autor
server/rotas-admin.js  rotas do painel
server/db.js           SQLite: esquema (migrações), consultas, transações
server/regras.js       senha, editais, status, texto (puro)
server/pipeline.js     prompts, montagem dos nós, parsers, agregador (puro)
server/avaliacao.js    fila, Batch API, modo direto/demonstração, varredor
server/anotacoes.js    validação e reposicionamento das marcações (puro)
server/email.js        Microsoft Graph + modelos de e-mail
server/servicos.js     eventos, caixa de saída, erros, visões
client/src/pages/      site, painel do autor, correção; admin/ com as telas do painel
tests/                 vitest: regras, pipeline, anotações, fluxo completo e lote (OpenAI falsa)
```

**Uma instância só** (SQLite num volume). Não aumente as réplicas.

## Pendências (combinadas para depois)

- [ ] Gerador de edital com IA (card "em breve" em Admin → Editais)
- [ ] Páginas de política de privacidade, termos de uso e edital de pesquisa (links já apontam para elas)
- [ ] Sistema de formatação e diagramação (hoje as etapas são manuais)
- [ ] Autenticação do Microsoft Entra para o envio de e-mail (variáveis `GRAPH_*` e `MAIL_FROM`)
- [ ] Calibrar com os textos de teste do guia e definir o limiar de descarte no primeiro lote real
- [ ] Relatório de similaridade e checagem de DOI como insumos do critério 10 (sugestão do guia)
- [ ] Deploy no Railway (volume em `/data`, `DATA_DIR=/data`, `NODE_ENV=production`, Node ≥ 22.5)
- [ ] Recuperação de senha do autor (precisa do e-mail funcionando)
