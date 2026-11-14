# Carregamento central PT2030: do ficheiro ao Catálogo

Estado: **implementado e provado numa base isolada em 12/11/2026**, por implantar na VPS. Pedido pelo utilizador («carregar o ficheiro e levar para oportunidades e para o catálogo»). Decisões: (1) só candidatas novas, confirmada pelo utilizador; (2) Catálogo central comum e (3) o mesmo administrador C4G aceita, adotadas a partir das propostas deste contrato porque o utilizador respondeu «sim» sem as contrariar. Estende [central-import-upload-preview.md](central-import-upload-preview.md), que ficou deliberadamente em pré-visualização. Contexto: [staging completo](staging-completion-plan.md).

## Estado medido (código lido em 12/11/2026)

O percurso tem quatro degraus e só o primeiro está ligado:

1. **Carregar e pré-visualizar** (`/api/admin/directory/imports/portugal2030`): feito, provado em staging com R2 e ClamAV reais.
2. **Gravar candidatas** (`stage()` em `portugal2030/centralImport.js`, que escreve `pt2030_plan_identity` e `pt2030_plan_revision`): o serviço existe e tem testes, mas **nenhuma rota o expõe** (`uploadRuntime.js` só compõe `preview`).
3. **Aprovar**: o percurso de ativação (`activation_plan_v2`) não serve: o localizador recusa `PORTUGAL2030_PLAN` de propósito (`OPPORTUNITY_V2_DOCUMENT_PIPELINE_REQUIRED`, `activationArchive.js`) e a tabela só admite fontes UE, Interreg, POCTEP e `C4G_MANUAL` (CHECK de `source_code`). Admitir PT2030 ali exige uma migração nova da Central e novos fingerprints.
4. **Aceitar no Catálogo**: o repositório de aceitação genérico (`acceptedRepository.js`) aceita qualquer snapshot v2 válido, e o Catálogo e o Dashboard leem `opportunity_catalog.opportunity` diretamente. O que falta é uma rota e um executor com as portas de autoridade e auditoria. A publicação HTTP está hoje limitada à chamada 11145.

## Desenho (sem migração)

Reutilizar o que existe e acrescentar só o que falta:

- **Rota de gravação** `POST …/portugal2030/:requestId/stage` com `{sheetName, previewDigest, requestId}`: chama `stage()`. Devolve criadas, inalteradas, alteradas, a rever e rejeitadas.
- **Aceitação em lote por importação**, executor próprio em `portugal2030/` com o repositório de aceitação genérico:
  - `GET …/imports/:importId/review`: lista as candidatas aceitáveis e um `batchDigest` que liga o conteúdo de todas.
  - `POST …/imports/:importId/accept` com `{requestId, batchDigest}`: recalcula o digest no servidor; se divergir, recusa (`PT2030_BATCH_STALE`). A decisão humana é este pedido explícito do administrador C4G, com sessão atual, CSRF e autenticação recente (a mesma política das outras ações de ativação).
  - Cada candidata é aceite na sua própria transação, com identificador de pedido derivado de `(importId, externalIdentifier, contentDigest)`: repetir o pedido não duplica nem altera nada, e uma falha numa linha não desfaz as outras. O resultado do lote diz quantas foram criadas, quantas falharam e porquê.
  - Auditoria na cadeia da plataforma (`OPPORTUNITY_CREATED` por oportunidade), com a importação como âmbito.
- **Interface** (`Import.jsx`): depois da pré-visualização, «Gravar candidatas», depois um resumo da importação (criadas, inalteradas, alteradas, rejeitadas) e «Aceitar no Catálogo», com resultado por linha.

## Critérios de aceitação

1. Só o administrador C4G com sessão válida grava e aceita; aceitar exige ainda a autenticação recente que a política da implantação define para ações privilegiadas (em staging, início de sessão nos últimos 5 minutos; o MFA continua a ser escolha pessoal). Qualquer outro papel recebe recusa sem efeito.
2. Gravar sem pré-visualização prévia, com `previewDigest` diferente ou com a folha trocada é recusado; repetir o mesmo pedido devolve o mesmo resultado sem duplicar.
3. Aceitar com `batchDigest` desatualizado (candidatas mudaram) é recusado sem escrever nada.
4. Cada oportunidade aceite aparece no Catálogo e conta no Dashboard, com fonte `PORTUGAL2030_PLAN`, ligações oficiais preservadas e datas previstas tal como na pré-visualização; nenhum montante é inferido.
5. Repetir a mesma importação não cria duplicados: as já aceites ficam `UNCHANGED`.
6. Uma linha rejeitada na pré-visualização nunca é aceite; uma falha numa candidata não impede as restantes e fica identificada com o código.
7. Cada aceitação gera um recibo e um evento de auditoria; nenhum segredo, caminho de ficheiro ou conteúdo da folha entra em logs.
8. Prova num PostgreSQL 18 isolado, Central 050, com a folha de referência de 177 linhas ou fixture claramente sintética: carregar, pré-visualizar, gravar, aceitar, repetir, e leitura pelo Catálogo e pelo Dashboard. Suite backend e frontend, lint e build aprovados.

## Decisões por confirmar

1. **Candidatas alteradas.** Numa reimportação, uma linha cujo conteúdo mudou (ou que pede revisão): (a) fica por rever e **não** é aceite neste incremento (proposta: só se criam as novas); (b) cria uma revisão nova da oportunidade já aceite. A (a) é a mais segura e evita sobrepor edições editoriais.
2. **Visibilidade.** Proposta: as oportunidades vão para o Catálogo central comum (o carregamento é de Super Admin C4G, sem entidade selecionada), e não privadas de uma organização como dizia o desenho antigo do piloto.
3. **Quem aceita.** Proposta: o mesmo administrador C4G que grava; sem segundo aprovador neste incremento.

## Fora de âmbito

Migração nova da Central, publicação automática sem decisão humana, importação por organização, avisos oficiais Portugal 2030 (`PORTUGAL2030_NOTICE`), ligação à recolha automática. Em produção a decisão 3 pode exigir segundo aprovador.

## Implementação (12/11/2026)

- Modo `CENTRAL_PT2030_IMPORT_RUNTIME=catalog` (além de `preview`, que continua só pré-visualização). O `env --storage` de staging passa a gerar `catalog`.
- Rotas em `portugal2030/uploadHttp.js`: `POST /:id/stage`, `GET /staged/:importId` (revisão), `POST /staged/:importId/accept`. Executor em `portugal2030/catalogAcceptance.js`, sobre o repositório de aceitação genérico, a autoridade e a auditoria da ativação. Sem migração.
- Revisão: cada linha é `ACCEPTABLE` (nova), `ALREADY_ACCEPTED`, `NEEDS_REVIEW` (alterada ou bloqueada, com motivos) ou `REJECTED`. Só as `ACCEPTABLE` são escritas.
- Interface: `Imports/CentralImportCatalog.jsx`, depois da pré-visualização («Gravar candidatas», revisão paginada, «Aceitar N oportunidades novas no Catálogo»).
- **Prova** (PostgreSQL 18, Central 050, folha oficial de 177 linhas, armazenamento e antivírus simulados, tudo o resto real): carregar, pré-visualizar (177 válidas), gravar (177 criadas), rever (177 novas), aceitar (177 criadas em cerca de 10 s, 0 falhas), 177 recibos e eventos de auditoria; Catálogo e Dashboard mostram-nas com fonte `PORTUGAL2030_PLAN`; repetir a importação dá 177 «já aceites» e nenhuma nova, sem duplicados; digest errado é recusado (`PT2030_BATCH_STALE`); sessão inexistente é recusada.
- Testes: 7 do executor, 4 das rotas, 5 da interface, mais o teste de modo da página. Backend 3140 (3131 aprovados, 9 ignorados), lint e build aprovados. Frontend 980 de 981: `ApplicationPartners` falha de forma intermitente só sob carga na suite completa e passa isoladamente; não foi tocado.
- **Por provar:** nunca corrido com o R2 e o ClamAV reais nesta ação (o envio e a pré-visualização já foram provados na VPS); a aceitação em staging real exige o ambiente com `CENTRAL_PT2030_IMPORT_RUNTIME=catalog`; alterações em reimportações ficam por rever (decisão 1) e não há ainda ecrã para as resolver.
