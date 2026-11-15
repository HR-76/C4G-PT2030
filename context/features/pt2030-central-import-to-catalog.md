# Carregamento central PT2030: do ficheiro ao Catálogo

Estado em 15/11/2026: **importação recuperada no staging; reimportação validada**. **Único teste pendente deste percurso: criação de oportunidades novas no staging.** Pedido pelo utilizador («carregar o ficheiro e levar para oportunidades e para o catálogo»). Decisões: (1) só candidatas novas, confirmada pelo utilizador; (2) Catálogo central comum e (3) o mesmo administrador C4G aceita, adotadas a partir das propostas deste contrato porque o utilizador respondeu «sim» sem as contrariar. Estende [central-import-upload-preview.md](central-import-upload-preview.md), que ficou deliberadamente em pré-visualização. Contexto: [staging completo](staging-completion-plan.md).

## Recuperação e reimportação validadas no staging — 15/11/2026

- Publicação executada pelo utilizador no terminal Hostinger: API `c4g-staging-api:c262040-pt2030-entity-type-055-v2`, compatível com a Central `055_entity_type_edit`. A correção anterior limitada à 054 deixou de chegar após a publicação da 055. A validação explícita da 055 devolveu `VALIDACAO_OK`; foi acrescentada essa versão à lista da importação na imagem ativa. O código do repositório usa a seleção de versões compatíveis do manifesto.
- Após a recriação, o contentor ficou em `created`; o arranque explícito devolveu `running`, zero reinícios, sem erro e readiness `READY`. O utilizador confirmou que o campo para carregar o Excel voltou a aparecer.
- O ficheiro chegou à revisão. A captura fornecida mostra as linhas visíveis como «Já aceite» e o botão «Não há oportunidades novas». O utilizador confirmou que todas estavam aceites e pediu o registo da reimportação como validada: reconhecimento das oportunidades existentes, sem proposta de novas aceitações ou duplicados. Não foi fornecida uma contagem total nem feita uma auditoria SQL independente neste ensaio.
- **Importação recuperada e reimportação validada**, com base nos resultados do terminal, captura da interface e confirmação do utilizador. Este ensaio não criou oportunidades novas.
- **Pendente apenas o teste de criação de oportunidades novas no staging:** carregar um ficheiro com avisos ainda ausentes do catálogo, rever e aceitar as novas candidatas, confirmar a presença no Catálogo e Dashboard e repetir para verificar que passam a «Já aceite».

As secções datadas abaixo preservam a evolução e as validações anteriores; as referências a implantação ou prova em staging pendentes descrevem esses momentos, não o estado atual.

## Estado inicial medido (código lido em 12/11/2026, antes da implementação)

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

## Regressão de disponibilidade após Central 054 (15/11/2026)

A lista de esquemas admitidos pela disponibilidade parava na Central 053. A 054 de validação de faturação herda o contrato da importação, mas era recusada antes das verificações de armazenamento e antivírus, resultando em `available:false` e na mensagem genérica da página.

Aceitação da correção: admitir explicitamente a 054, conservando a validação real do fingerprint e da segurança SQL; manter a recusa de esquemas inválidos, tabelas/permissões em falta e dependências indisponíveis. Testar disponibilidade em preview e catálogo. Não ativar serviços, aplicar migrações nem importar dados. A ocorrência no staging da imagem exige confirmação da versão instalada e da resposta autenticada da API.

Continuação em 15/11: com a 055 agora registada no checkout, substituir a lista manual por versões do manifesto que sejam admissíveis em runtime, declarem `centralImportSecurity` e descendam da migração de importação segundo `supportsCentralVersion`. Não admitir versões desconhecidas, anteriores à importação ou de ramos incompatíveis. A seleção não dispensa o fingerprint nem as verificações de segurança existentes. Regressões explícitas nas versões 049, 054 e 055, nos dois modos.

Diagnóstico confirmado pelo utilizador no terminal Hostinger: API `c262040-billing-v1`, Central `054_billing_account_validation` aplicada em 15/11/2026 00:25 UTC, modo `catalog`, ClamAV saudável, readiness `READY`; o código da API ainda enumera apenas as versões 049–053. Assim, a recusa da 054 explica a indisponibilidade neste ambiente. Publicação da correção ainda pendente. Na continuação local: 22 testes de runtime/upload/aceitação aprovados, lint aprovado; suite frontend concluída com 1126 aprovados e um timeout em ApplicationPartners.

Validação local: duas regressões falharam antes e passaram após a alteração; 4 testes de runtime, 6 de upload, 8 de aceitação e 6 HTTP aprovados. Os testes de disponibilidade cobrem também recusa de drift, tabelas/permissões ausentes e armazenamento/antivírus indisponíveis. Build aprovado. Lint global encontrou duas chaves duplicadas em `frontend/src/api/api.js`, ficheiro com alterações concorrentes fora deste incremento. Suites completas iniciadas e interrompidas por sobrecarga e falhas alheias; tentativa com concorrência limitada voltou a apresentar timeout em `ApplicationPartners`. Não se declara aprovação das suites completas nem validação no staging; nenhum deploy ou migração executado.

## Implementação (12/11/2026)

- Modo `CENTRAL_PT2030_IMPORT_RUNTIME=catalog` (além de `preview`, que continua só pré-visualização). O `env --storage` de staging passa a gerar `catalog`.
- Rotas em `portugal2030/uploadHttp.js`: `POST /:id/stage`, `GET /staged/:importId` (revisão), `POST /staged/:importId/accept`. Executor em `portugal2030/catalogAcceptance.js`, sobre o repositório de aceitação genérico, a autoridade e a auditoria da ativação. Sem migração.
- Revisão: cada linha é `ACCEPTABLE` (nova), `ALREADY_ACCEPTED`, `NEEDS_REVIEW` (alterada ou bloqueada, com motivos) ou `REJECTED`. Só as `ACCEPTABLE` são escritas.
- Interface: `Imports/CentralImportCatalog.jsx`, depois da pré-visualização («Gravar candidatas», revisão paginada, «Aceitar N oportunidades novas no Catálogo»).
- **Prova** (PostgreSQL 18, Central 050, folha oficial de 177 linhas, armazenamento e antivírus simulados, tudo o resto real): carregar, pré-visualizar (177 válidas), gravar (177 criadas), rever (177 novas), aceitar (177 criadas em cerca de 10 s, 0 falhas), 177 recibos e eventos de auditoria; Catálogo e Dashboard mostram-nas com fonte `PORTUGAL2030_PLAN`; repetir a importação dá 177 «já aceites» e nenhuma nova, sem duplicados; digest errado é recusado (`PT2030_BATCH_STALE`); sessão inexistente é recusada.
- Testes: 7 do executor, 4 das rotas, 5 da interface, mais o teste de modo da página. Backend 3140 (3131 aprovados, 9 ignorados), lint e build aprovados. Frontend 980 de 981: `ApplicationPartners` falha de forma intermitente só sob carga na suite completa e passa isoladamente; não foi tocado.
- **Por provar:** nunca corrido com o R2 e o ClamAV reais nesta ação (o envio e a pré-visualização já foram provados na VPS); a aceitação em staging real exige o ambiente com `CENTRAL_PT2030_IMPORT_RUNTIME=catalog`; alterações em reimportações ficam por rever (decisão 1) e não há ainda ecrã para as resolver.
