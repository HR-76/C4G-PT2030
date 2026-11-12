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

**F4. Recolha controlada.** Primeira recolha com limite de 5 resultados pelo ecrã Fontes, revisão humana das oportunidades em `REVIEW`, depois o limite de 100. A agenda diária (04:00, conta de serviço) é uma decisão posterior.

## Progresso

- **F1 implementada e provada num PostgreSQL 18 temporário (12/11/2026):** comando `upgrade` do [instalador de staging](../../backend/scripts/staging/install.js). Central 035 → 050 e tenant 033 → 040 em cerca de 20 segundos, preflight aprovado em cada passo, repetível, `install` e `person` continuam a funcionar depois e a API fica pronta (`/health/ready` 200). Por aplicar na VPS.
- **F2 implementada e provada com a fonte de teste num PostgreSQL 18 temporário (12/11/2026), sem chamadas externas:** o `install` instala o esquema `pgboss` da Central (que não faz parte das migrações) e cria a fila `funding-tenders-refresh`; modo `live-staging` na política de recolha e no worker, restrito à base `c4g_central_staging` do anfitrião `c4g-postgres` com TLS verificado, `NODE_ENV=production` e uma aprovação que nomeia o limite (`staging-eu-funding-tenders-5` ou `-100`); `env --collection 5|100` é a única forma de o ligar; worker no compose sob o perfil `collection`; o ecrã Fontes passa a tratar `live-staging` como configurado. Ensaio de ponta a ponta com a fonte de teste no Central 050: pedido, fila, worker, execução `SUCCESS`, observação e identidade gravadas, e o leitor do catálogo pronto. Frontend: 969 testes e build aprovados. Backend: 3114 testes, 3105 aprovados, 9 ignorados.
- **Defeito encontrado e corrigido:** o preflight de oportunidades da Central ([preflight.js](../../backend/src/opportunities/preflight.js)) recusava com `OPPORTUNITY_SCHEMA_DRIFT` qualquer Central nas versões 048 a 050, o que impedia o worker de arrancar, porque esses pacotes não estavam mapeados e o 049 acrescenta a tabela `pt2030_document_upload`. Teste de regressão em `f12OpportunityPreflight.test.js` (falha sem a correção). Pelo código, o worker local teria o mesmo problema na Central 050; não o verifiquei no ambiente local.
- F3 e F4 não iniciadas. A recolha ensaiada usou o caminho sem o escritor EU v2 (`OPPORTUNITY_EU_WRITER` desligado); a configuração do escritor continua por decidir.

## Critérios de aceitação

- F1: `preflightCentral` e `preflightTenant` aprovados na 050 e na 040; Central e tenant registam a mesma versão; `/health/ready` com 200; páginas que dependem das migrações 034 a 040 abrem; nenhum dado existente alterado; repetir o comando não altera nada.
- F2: o worker recusa arrancar sem a aprovação explícita de staging e com qualquer base ou anfitrião fora dos nomeados; os testes cobrem as recusas; as proteções do ensaio local continuam como estão.
- F3: `euWriterStatus.js` devolve `WRITER_ALIGNED`; a fonte EU deixa de estar `QUIESCED`; histórico de controlo e auditoria registados.
- F4: uma recolha de 5 resultados cria execuções, observações e proveniência; as oportunidades aparecem no Catálogo e no Dashboard apenas depois de aceites; o ecrã Fontes mostra a última execução.
- Em todas as fases: nenhum segredo em Git, logs ou saídas; cada passo repetível e com marcador de versão.

## Por confirmar

1. **Fontes na F4:** só `EU_FUNDING_TENDERS` (proposta) ou também CORDIS, Erasmus+ e Interreg, que exigem a aprovação «fontes oficiais» e mais pedidos externos.
2. **Chamadas externas:** a VPS contacta a API pública da Comissão Europeia, sem credenciais, cerca de 12 pedidos por varredura de 100. Autorização por escrito antes da F4.
3. **Pacotes 043 a 045 em staging:** o local aplica-os porque o histórico do corpus EU antigo o exige. Em staging não há esse histórico; a proposta é aplicá-los na mesma, para o esquema coincidir com o local e o escritor estar disponível.

## Fora de âmbito

Importação Portugal 2030 (R2 e ClamAV), PDFs de faturação (R2), e-mail e produção. Os pacotes 049 e 050 criam só o esquema; os respetivos runtimes ficam desligados.
