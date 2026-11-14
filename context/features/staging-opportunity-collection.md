# Recolha de oportunidades no staging

Estado: proposta de 12/11/2026, pedida pelo utilizador («Recolha real»). Os pontos marcados com **confirmar** dependem de decisão dele; a fase F4 exige autorização expressa no momento da primeira chamada externa. Ambiente: [staging na VPS](staging-vps-deployment.md).

## Estado medido

- Ecrã Administração C4G → Fontes de oportunidades: as quatro fontes dizem «indisponível». A API de staging corre com `FUNDING_TENDERS_SOURCE=unconfigured` e não há worker.
- O worker de recolha ([fundingTendersWorker.js](../../backend/src/config/fundingTendersWorker.js)) só arranca como ensaio local: exige `NODE_ENV=development`, a base `c4g_central_dev` em `localhost:5432` e uma aprovação fixa. Não existe hoje um worker de recolha para staging ou produção.
- No ambiente local a Central está na 050, a fonte EU está `QUIESCED` (fence 7) e o escritor registado está desatualizado face ao mapeamento v2.1 ([plano de reativação](../references/opportunity-v2/eu-writer-v2.1-reactivation.md)). O catálogo local tem 178 oportunidades do corpus PT2030 e **zero** oportunidades EU: a recolha EU também está por reativar em local.
- O staging está na Central 035 e no tenant 033. A recolha EU atual (escritor v2) exige os pacotes Central 036 a 045 e a fila `pg-boss`.

## Fases

**F1. Esquemas ao nível do local, sem chamadas externas.** Central 035 → 050 e tenant 033 → 040, pelos mesmos pacotes e executores registados que o ambiente local usa, aplicados pelo instalador de staging. Cada passo verifica o preflight da versão que acabou de aplicar.

**F2. Worker de recolha em staging.** Instalar a fila `pg-boss` na Central, acrescentar um perfil de staging às proteções do worker (aprovação explícita por variável, base e anfitrião nomeados, sem `NODE_ENV=development`) e correr o worker num contentor próprio. Nenhuma recolha automática.

**F3. Escritor EU v2.1.** Reconfigurar o escritor e retomar a fonte pelo percurso administrativo existente (sessão atual, CSRF, autenticação recente), conforme o plano de reativação. Ato humano e auditado.

**F4. Recolha.** O utilizador decidiu a 12/11/2026 que a recolha tem de trazer **todos** os registos da fonte, não uma amostra («ao irmos buscar dados temos de ir buscar todos os que existem»). Faz-se com a cobertura durável: cada pedido administrativo inicia um ciclo que recolhe páginas de 100 e as encadeia até esgotar a fonte (`--collection all`). O ensaio de 5 resultados (`--collection 5`) existe para uma primeira verificação. Revisão humana das oportunidades em `REVIEW`, se o escritor EU v2 for ativado. A agenda diária (04:00, conta de serviço) é uma decisão posterior.

## Progresso

- **F1 implementada e provada num PostgreSQL 18 temporário (12/11/2026):** comando `upgrade` do [instalador de staging](../../backend/scripts/staging/install.js). Central 035 → 050 e tenant 033 → 040 em cerca de 20 segundos, preflight aprovado em cada passo, repetível, `install` e `person` continuam a funcionar depois e a API fica pronta (`/health/ready` 200). Por aplicar na VPS.
- **F2 implementada e provada com a fonte de teste num PostgreSQL 18 temporário (12/11/2026), sem chamadas externas:** o `install` instala o esquema `pgboss` da Central (que não faz parte das migrações) e cria a fila `funding-tenders-refresh`; modo `live-staging` na política de recolha e no worker, restrito à base `c4g_central_staging` do anfitrião `c4g-postgres` com TLS verificado, `NODE_ENV=production` e uma aprovação que nomeia o limite (`staging-eu-funding-tenders-5` ou `-100`); `env --collection 5|100` é a única forma de o ligar; worker no compose sob o perfil `collection`; o ecrã Fontes passa a tratar `live-staging` como configurado. Ensaio de ponta a ponta com a fonte de teste no Central 050: pedido, fila, worker, execução `SUCCESS`, observação e identidade gravadas, e o leitor do catálogo pronto. Frontend: 969 testes e build aprovados. Backend: 3114 testes, 3105 aprovados, 9 ignorados.
- **Defeito encontrado e corrigido:** o preflight de oportunidades da Central ([preflight.js](../../backend/src/opportunities/preflight.js)) recusava com `OPPORTUNITY_SCHEMA_DRIFT` qualquer Central nas versões 048 a 050, o que impedia o worker de arrancar, porque esses pacotes não estavam mapeados e o 049 acrescenta a tabela `pt2030_document_upload`. Teste de regressão em `f12OpportunityPreflight.test.js` (falha sem a correção). Pelo código, o worker local teria o mesmo problema na Central 050; não o verifiquei no ambiente local.
- **Recolha completa ligada (12/11/2026).** A API de produção (`server.js`) nunca dava às rotas das Fontes a configuração de cobertura, pelo que um pedido só recolhia uma página mesmo com `FUNDING_TENDERS_COVERAGE=durable-v1`; passa a lê-la do registo de migrações da Central (`configuredCoverage`, com teste). `env --collection all` fixa a aprovação de 100 e a cobertura durável. Ensaio no Central 050 com a fonte de teste: pedido, fila, worker e ciclo concluído com `SUCCESS`. O instalador passou a recusar-se a terminar em silêncio se o processo sair sem concluir (`STAGING_INSTALL_INTERRUPTED`), depois de uma `upgrade` ter parado no tenant 035 numa execução que não consegui reproduzir; repetida, retomou e concluiu.
- **Recolha real corrigida para staging (12/11/2026):** ver «Resultado final da D1». F3 (escritor EU v2) fica fora do staging por decisão; F4 (execução real) só com nova autorização do utilizador.

## Escritor EU v2: passos verificados e lacunas (12/11/2026)

Verificado no código e nos runbooks ([eu-writer-runbook.md](../references/opportunity-v2/eu-writer-runbook.md)). A recolha real falha hoje porque os registos reais da UE não trazem financiador e o percurso v1 exige `funderName` (`OPPORTUNITY_INVALID_INPUT`). O percurso certo é o escritor canónico v2. Passos e estado:

1. **Variáveis do escritor** (`OPPORTUNITY_EU_WRITER=canonical-v2`, `OPPORTUNITY_ACTIVATION_RUNTIME=authenticated-v2`, `FUNDING_TENDERS_ENRICHMENT=verified-v1`, com `FUNDING_TENDERS_RUNTIME=central` e cobertura `durable-v1`) na API e no worker. **Falta** no `env --collection`.
2. **Saúde do worker visível à API.** `euSourceControl.ready()` é falso sem um fornecedor `workerHealth` com capacidade, política `eu-existing-v2.0` e digest. O `server.js` de produção não o fornece (só o ambiente local, por ficheiro de heartbeat). **Falta**: mecanismo de saúde para staging/produção.
3. **Percurso administrativo** (só API, sem ecrã): consultar `sources/eu`, configurar o escritor com `QUIESCED` e sem runs pendentes, retomar com fence exata; exige sessão, CSRF e autenticação recente. Estado inicial do controlo numa Central nova: **por verificar**. **Falta** decidir se se cria ecrã.
4. **Resultado do escritor v2:** novas identidades ficam sempre em `REVIEW`, nunca entram no catálogo sozinhas. A publicação HTTP está limitada ao executor da chamada 11145 e o runbook diz que **não existe executor genérico para novos IDs**. Sem decisão de produto, o Catálogo e o Dashboard continuam sem oportunidades da UE mesmo com a recolha a funcionar.

### Decisões de produto pendentes (não resolver por inferência)

- **D1.** Quem aceita as oportunidades da UE e como: (a) criar o executor genérico de aceitação para novos IDs, com revisão humana; (b) aceitação automática das identidades novas em staging, só para testar; (c) deixá-las em fila de revisão visível, sem catálogo, por agora.
- **D2.** Ecrã administrativo para configurar/retomar a fonte e ver a fila de revisão, ou manter só API.
- **D3.** Mecanismo de saúde do worker para produção (tabela na Central em vez de ficheiro).

### D1 decidida: aceitação automática só em staging (12/11/2026)

Verificado no código, antes de implementar:

- O Catálogo e o Dashboard leem `opportunity_catalog.opportunity` diretamente (`fundingTenders/repository.js`, `list`/`get`, já com suporte a snapshots v2). Qualquer oportunidade aceite aparece; **não** é preciso publicar nenhuma «geração» (`catalog_read` é o leitor unificado novo, desligado).
- Uma bandeira no escritor **não chega**. A função SQL `begin_eu_writer_v2` (Central 043) só autoriza `ACCEPTED` para uma oportunidade v2 já existente (exige `current_revision_id`/`row_version` e o `UPDATE` com `row_version+1`). O escritor v2 não pode criar oportunidades, e mudar isso exigiria uma migração nova com novos fingerprints.
- A criação passa pelo repositório de aceitação genérico (`opportunities/v2/acceptedRepository.js`), o mesmo que a criação manual e o executor 11145 usam. Os guardas do escritor só atuam em oportunidades que já têm identidade `EU_FUNDING_TENDERS`, por isso criar a primeira revisão por este repositório é permitido; as atualizações seguintes voltam ao escritor v2.

**Resultado final da D1 (12/11/2026): o aceitador foi descartado, a solução é mais simples.** O caminho do aceitador só funciona com a fonte EU em `QUIESCED`: com o escritor v2 ativo, os guardas da Central recusam o recibo de aceitação (`accepted_receipt_v2`) de uma oportunidade que já tem identidade da UE, o que obrigaria a suspender, quiescer, aceitar e retomar a cada recolha. Em vez disso, em staging **não se usa o escritor v2**: a recolha segue o percurso v1 existente (o mesmo do ensaio com fonte de teste), e o único defeito era o financiador em falta. O worker de `live-staging` etiqueta o registo com «Financiador não indicado pela fonte (recolha de staging)» (`fundingTenders/funderLabel.js`), como o modo fixture já faz com um financiador sintético; um financiador que a fonte traga nunca é substituído. Provado num PostgreSQL 18 temporário na Central 050: o mesmo registo real sem financiador falha com `OPPORTUNITY_INVALID_INPUT` sem etiqueta e cria-se com ela; o Catálogo lista os registos e o Dashboard conta-os; o ciclo de cobertura durável conclui com `SUCCESS` e é repetível sem duplicar. Consequência: `--collection all` **não precisa** das variáveis do escritor v2, nem de saúde do worker, nem de passos administrativos. Registos criados assim ficam v1; para provar o escritor v2 mais tarde, repor a base de staging. Para produção nada disto vale: aí é o escritor v2 com revisão humana (executor genérico por especificar).

Desenho descartado (só staging, desligado por omissão): um **aceitador de staging** que, depois de cada ciclo, lê as decisões `REVIEW` cujo único motivo é `NEW_IDENTITY_REQUIRES_REVIEW`, carrega o snapshot canónico arquivado (`candidateRepositoryV2`), faz `preview` (ação `NEW`) e `accept` com o `previewDigest`, com portas de autoridade e auditoria próprias. Qualquer outro motivo (conflito, identidade ambígua, mapeamento alterado, correções editoriais) continua em revisão humana. Ativado só por `--collection all` mais uma variável de staging explícita, recusado fora do anfitrião e da base de staging, como o `live-staging`. **Não é desenho de produção:** aí as novas identidades continuam a exigir revisão humana (executor genérico, por especificar).

Passos de implementação: (1) variáveis do escritor v2 no `env --collection`; (2) saúde do worker visível à API; (3) aceitador de staging com testes, incluindo registos sem financiador; (4) ensaio de ponta a ponta num PostgreSQL 18 isolado; (5) só então recolha real, com a autorização do utilizador.

Por verificar antes de (3): como o `activationComposition.js` compõe as portas `authorize`, `verifyApproval` e `audit` para o executor 11145, e se o estado inicial do controlo da fonte EU numa Central nova permite configurar o escritor.

## Critérios de aceitação

- F1: `preflightCentral` e `preflightTenant` aprovados na 050 e na 040; Central e tenant registam a mesma versão; `/health/ready` com 200; páginas que dependem das migrações 034 a 040 abrem; nenhum dado existente alterado; repetir o comando não altera nada.
- F2: o worker recusa arrancar sem a aprovação explícita de staging e com qualquer base ou anfitrião fora dos nomeados; os testes cobrem as recusas; as proteções do ensaio local continuam como estão.
- F3: `euWriterStatus.js` devolve `WRITER_ALIGNED`; a fonte EU deixa de estar `QUIESCED`; histórico de controlo e auditoria registados.
- F4: uma recolha de 5 resultados cria execuções, observações e proveniência; as oportunidades aparecem no Catálogo e no Dashboard apenas depois de aceites; o ecrã Fontes mostra a última execução.
- Em todas as fases: nenhum segredo em Git, logs ou saídas; cada passo repetível e com marcador de versão.

## Por confirmar

1. **Fontes na F4:** só `EU_FUNDING_TENDERS` (proposta) ou também CORDIS, Erasmus+ e Interreg, que exigem a aprovação «fontes oficiais» e mais pedidos externos.
2. **Chamadas externas:** a VPS contacta a API pública da Comissão Europeia, sem credenciais, cerca de 12 pedidos por varredura de 100. O utilizador autorizou (12/11/2026) primeiro 5 resultados por execução e depois pediu a recolha de todos os registos; cada recolha só corre quando o administrador carrega em «Atualizar agora».
3. **Pacotes 043 a 045 em staging:** o local aplica-os porque o histórico do corpus EU antigo o exige. Em staging não há esse histórico; a proposta é aplicá-los na mesma, para o esquema coincidir com o local e o escritor estar disponível.

## Fora de âmbito

Importação Portugal 2030 (R2 e ClamAV), PDFs de faturação (R2), e-mail e produção. Os pacotes 049 e 050 criam só o esquema; os respetivos runtimes ficam desligados.

## Outras fontes em staging (12/11/2026)

Pedido do utilizador, depois da recolha completa da UE (1188 recebidos = 519 vigentes criados + 669 excluídos só com prazos passados, 0 falhados, ciclo `SUCCESS` em 12 páginas e 26 s). Acrescentada a aprovação de staging `staging-all-sources-100` (`env --collection all-sources`, que também fixa a cobertura durável): admite, além da Funding & Tenders, o CORDIS (Horizon e Euratom), o Erasmus+ e as duas fontes oficiais (Interreg Europe e POCTEP), com os mesmos limites (100 por página). Sem a aprovação nova nada muda: `all` e `5` continuam só com a Funding & Tenders.

- **Prova** (PostgreSQL 18, Central 050, cobertura durável, respostas simuladas ou capturas reais guardadas dos testes, nenhuma chamada externa): as cinco fontes terminam `SUCCESS`; o Interreg Europe reconhece 3 chamadas encerradas e cria 0; o POCTEP lê 10 chamadas e cria a única ainda vigente, com o financiador da própria fonte; o Erasmus+ cria os seus registos quando a resposta traz registos desse programa e rejeita, e bem, registos de outro programa (o primeiro ensaio falhou por a simulação devolver Horizon ao pedido do Erasmus+). O Catálogo lista as fontes e filtra por `POCTEP`.
- **O que a recolha chama**: Funding & Tenders (CORDIS e Erasmus+ são pedidos à mesma API com filtro de programa), `interregeurope.eu` (um Excel) e `poctep.eu` (duas páginas da API WordPress). São anfitriões novos em relação à autorização anterior.
- **Consultas individuais**: depois de cada varredura, os registos conhecidos do mesmo programa que a varredura não voltou a ver são consultados um a um. Na VPS devem ser poucos (a varredura acabou de ver todos os vigentes), mas não está medido; acompanhar o número de execuções.
- **Duplicação**: o CORDIS e o Erasmus+ são recortes da mesma API e dos mesmos identificadores da Funding & Tenders, por isso não devem acrescentar registos novos aos 519; o esperado é «sem alterações».
- Testes: `stagingFundingWorkerTarget`, `stagingInstaller`. Backend 3159, frontend 1003.
