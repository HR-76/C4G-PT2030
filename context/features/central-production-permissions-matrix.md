# Central: levantamento e matriz de permissões de produção

Estado: **Matriz aprovada; implementação local em revisão**, 15/11/2026. O utilizador autorizou a migração, o código e testes em PostgreSQL descartável, sem alterar o staging. A execução em produção não foi realizada. Ver [implementação e operação](central-production-permissions-implementation.md).

Base analisada: commit `736e3a5e28904bb001ad07113853b816bfabbfa1`. Análise estática do código, composição produtiva, SQL e manifests; não é uma medição das ACL da VPS nem uma prova PostgreSQL. O [índice de evidência](../reviews/central-production-permissions-20261115/inventory.json) contém 879 referências lexicais a relações e 213 ocorrências de GRANT, com ficheiro e linha. Inclui caminhos opcionais e SQL dinâmico: não é uma lista de grants a executar.

## 1. Conclusão e âmbito

Não atribuir ao login da API todos os privilégios hoje cobertos por `postgres`. Separar leitura, comandos funcionais, autoridade, publicação do catálogo, envio de email e instalação. Reutilizar os mecanismos restritos existentes antes de criar novas permissões.

Primeira versão conforme [plano de produção](production-transition-plan.md): criação manual e PT2030, sem recolha europeia nem documentos das candidaturas; PDFs de faturação e originais PT2030 continuam incluídos. Funcionalidades opcionais de email/faturação recebem permissões apenas quando selecionadas na release. O código atual já contém a Central 056 e histórico de email: os documentos anteriores que terminam na 052/053 não são inventário suficiente.

Esta matriz é um **destino com alterações de composição e código**. Não é uma troca imediata de `CENTRAL_DATABASE_URL`. Também não elimina a administração privilegiada necessária à instalação das migrações existentes: elimina-a dos processos que servem pedidos e executam trabalho funcional.

## 2. O que o código realmente faz

| Caminho | Ligação efetiva | Consequência |
| --- | --- | --- |
| `productionComposition.js`, `config/centralDb.js` | `CENTRAL_DATABASE_URL` | Mistura prontidão, leituras, logs, PT2030, oportunidades, PDFs e funções de email. É a ligação a decompor. |
| Identidade, sessões e memberships | `AUTHORITY_DATABASE_URL`, através de `authorityCoordinator` | `sessionRegistry` substitui o pool recebido pelo pool coordenado; não conceder DML de sessões ao login Central por inferir apenas o argumento da factory. |
| Admissão, convites, perfis de acesso, eliminação de utilizadores e comandos de faturação | Coordenador de autoridade | SQL registado em `authorityProtocolQueries.js`, executado pelo protocolo fechado `authority_api.execute(text,text[],text)`. Não requer DML direto no login da API. |
| Catálogo de consulta | Login dedicado, `SET LOCAL ROLE c4g_catalog_reader` | Já existe validação exata do login e das ACL. Preservar a separação. |
| Diretório tenant sem documentos | `createTenantDirectoryRepository(centralPool)` | Consulta nove relações; explica o erro em `organization_provisioning` com o login limitado. |
| Diretório tenant com documentos | `tenantDirectoryReader` + autoridade | Já existe leitura restrita pela migração 031. Proposta: usá-la também sem documentos. Não é necessário começar por conceder SELECT genérico às nove relações. |
| Publicação de oportunidades | Pool Central e `SET LOCAL ROLE c4g_opportunity_central_runtime` | O papel existente inclui capacidades de recolha que ficam fora da primeira versão; separar o papel produtivo e adaptar os pontos de seleção. |
| Worker de validação de faturação | `BILLING_VALIDATION_DATABASE_URL` | Já exige login limitado e papel dedicado; recusa pertença ao runtime Central e à autoridade. |
| Convites: processo IPC | `memberRuntime.js` / `memberWorker.js` | API coordena as escritas Central; processo filho trata identidade/email/projeção tenant. Não lhe dar uma ligação Central administrativa por conveniência. |

Fontes principais: [composição](../../backend/src/productionComposition.js), [sessões](../../backend/src/security/sessionRegistry.js), [protocolo](../../backend/src/security/authorityProtocolQueries.js), [runtime tenant](../../backend/src/config/opportunityRuntime.js), [leitor restrito](../../backend/src/security/tenantDirectoryReader.js).

## 3. Matriz de ligações proposta

Nomes `c4g_prod_*` abaixo são **propostos**, não instalados. Papéis funcionais novos são NOLOGIN. Todos os logins de serviço: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, sem propriedade de bases, schemas, tabelas ou funções, sem ADMIN/GRANT OPTION. Sem pertença a owners ou migrators.

| Login / consumidor | Superfície permitida | Fora da superfície |
| --- | --- | --- |
| `c4g_prod_api_read` / leituras Central | Metadados de prontidão; projeções explícitas de organização, pessoas, memberships, faturação e administração | Escritas, sessões completas, referências de credenciais, tabelas de autoridade, fila |
| `c4g_authority_runtime` / coordenador | Perfil existente `c4g_authority_runtime`, metadados e EXECUTE do protocolo fechado | SQL arbitrário, DML direto, SET ROLE owner, funções de outros módulos |
| `c4g_prod_catalog_read` / catálogo | Perfil existente `c4g_catalog_reader`, seleção explícita em transação read-only | Originais PT2030, candidatas privadas, PII, escrita, autoridade |
| `c4g_prod_catalog_authoring` / manual e PT2030 | Novo papel funcional de autoria: objetos exatos da secção 4; verificação restrita do administrador e append de auditoria | Recolha, filas, escritores EU, credenciais tenant, alteração de memberships |
| `c4g_prod_api_commands` / PDFs, templates, complemento, validação | EXECUTE das funções enumeradas na secção 5, leituras auxiliares estritamente necessárias | DML nas tabelas protegidas, comandos de autoridade genéricos, claim de email de faturação |
| `c4g_prod_logs` / coletor | INSERT em `platform_support_event`; leitura apenas no perfil de administração | UPDATE/DELETE de logs; escrita no ledger de auditoria |
| `c4g_prod_billing_mail` / processo separado, se ativado | Papel existente `c4g_billing_validation_worker`; claim/finish restritos | Leitura direta de contas, sessões ou tenants; edição de faturação |
| `c4g_prod_email_retention` / rotina, se histórico ativado | Só EXECUTE de `email_delivery_retention()` | Leitura de destinatários, alteração de templates, envio |
| Provisionamento/migração / execução operacional separada | Criar bases, aplicar schemas, publicar bindings e perfis pelo instalador | Credenciais montadas na API, worker de email ou leitor do catálogo |

Pools separados dentro do mesmo processo reduzem privilégios de cada ligação, mas **não isolam um processo comprometido que detenha todas as credenciais**. A API continua a ser componente confiável. Workers e provisionamento ficam em processos e configurações separados. Limitar o total de conexões: não replicar `max=20` por cada pool novo.

Para papéis novos, preferência por login NOINHERIT e `SET LOCAL ROLE` dentro de transação, com `SET TRUE, INHERIT FALSE, ADMIN FALSE`. Adaptação obrigatória dos métodos que hoje fazem `pool.query` fora de transação. Não alterar mecanicamente os contratos existentes: autoridade mantém o padrão validado do seu perfil; catálogo mantém o login NOINHERIT com única pertença e SET explícito. Prontidão antes do SET precisa de privilégio de metadados explícito ou de transação própria no perfil de observação.

## 4. Matriz de dados e operações

S = SELECT; I = INSERT; U = UPDATE nas colunas indicadas; E = EXECUTE. A coluna de destino não equivale a conceder as operações ao login genérico. Objetos `public.*` salvo schema indicado. Não usar wildcards no SQL de implantação.

| Capacidade | Objetos observados | Necessidade / destino proposto |
| --- | --- | --- |
| Prontidão | `c4g_database_identity`, `c4g_schema_migration`; catálogos `pg_catalog` | S nas duas relações; introspeção de ACL, funções, constraints, roles e memberships usada pelos manifests. `databaseReadiness.js` chama `pg_control_system()`; resolver explicitamente com observador restrito, sem conceder `pg_monitor` ou privilégios administrativos por arrasto. |
| Diretório funcional | `organization`, `global_user`, `organization_membership` | S de projeções para organização, diretório, destinatários de alertas/notificações e listagens administrativas. Inicialmente o código lê tabelas diretamente; destino: views/ports com colunas e âmbito explícitos. Sem I/U/D. |
| Verificação do Admin C4G | `application_session`, `global_user`, `platform_admin_assignment` | Hoje SELECT direto e, em escritas de catálogo/PT2030, locks. Destino: E de verificador restrito que valida sessão/ator, devolve só a evidência necessária e mantém locks até ao commit. Não dar UPDATE em utilizadores para satisfazer o lock. |
| Sessões e identidade | `auth_identity_ref`, `global_user`, `platform_admin_assignment`, `application_session`, `application_session_store`, `oidc_transaction` | S/I/U e limpeza D necessária ao protocolo **dentro da autoridade**. Login externo só E do protocolo e metadados; sem SELECT genérico do conteúdo das sessões. |
| Resolução tenant | `organization`, `tenant`, `organization_provisioning`, `tenant_workload_binding`, `tenant_workload_connection_version`, `organization_connection_version`, `tenant_database_generation`, `tenant_schema_state`, `tenant_health_observation` | Estas são as nove relações da query antiga. Preferir `tenantDirectoryQueries.resolve` via migração 031: não usa `organization_provisioning` nem health; restringe organização/workload e estado. Não conceder escrita nem enumeração de credenciais. |
| Logs operacionais | `platform_support_event` | I do coletor e S administrativo. Sequência, se existir na definição efetiva, apenas USAGE da sequência concreta. Nunca ALL SEQUENCES. |
| Faturação: consultas | `billing_account`, `billing_account_version`, `billing_cycle`, `billing_fiscal_document`, `billing_payment_record`, `organization` | S nas projeções efetivamente usadas; dados internos de conta não entram no port do cliente. Comandos continuam na autoridade. |
| Faturação: comandos | `billing_activity`, `billing_command_receipt`, `billing_cycle_revision`, `billing_fiscal_document_revision` e relações anteriores | S/I/U do owner dentro do protocolo de autoridade, conforme queries registadas; **nenhum DML direto adicional** no login Central. |
| PDFs de faturação | `billing_document_file` e relações de documento/ciclo/organização | S após autorização; E `billing_pdf_admin`, `billing_attach_pdf`. Sem I/U/D direto em `billing_document_file`. |
| Templates/logótipos | `email_template_version`, `email_logo_version`, organização e destinatário de teste | S de versões; E dos verificadores e comandos de versão. Sem U/D de versões, sem leitura global de emails apenas para enviar um teste. |
| Histórico de envios | Funções `email_delivery_*` | E por consumidor: begin/finish no produtor, list na administração, retention na rotina. Sem SELECT/DML direto nas tabelas de histórico. |
| Complemento da oportunidade | `opportunity_complement_version` | S; E `opportunity_complement_write`. Sem U/D de versões. Recolha de portugal2030.pt não acrescenta autorização SQL. |
| Manual atual | `opportunity_catalog.opportunity`, `revision`, `provenance`, `idempotency_record`; auditoria | S/I para o percurso de criação `manualAuthoring` → `repositorySupport.create`, sem U/D nestas relações por causa desse percurso. `manualAuthoring.js` usa `RESET ROLE` para auditar: remover a dependência de privilégios do login base, mantendo a mesma transação. Não confundir esta rota com o arquivo candidato manual v2 nem com métodos update/archive do repository partilhado. |
| Original e pré-visualização PT2030 | `opportunity_catalog.pt2030_document_upload`, `pt2030_plan_preview` | S/I, sem U/D. Objetos privados, nunca acessíveis ao leitor de catálogo. ACL exata hoje exige `c4g_opportunity_central_runtime`; papel novo requer atualização versionada do verificador. |
| Stage PT2030 | `opportunity_catalog.pt2030_plan_identity`, `pt2030_plan_revision`, `pt2030_plan_import`, `pt2030_plan_observation` | S/I; U apenas `revision_number,latest_revision_id` em `pt2030_plan_identity`. Sem DELETE. |
| Aceitação PT2030 v2 | `opportunity_catalog.opportunity`, `revision`, `source_identity_v2`, `source_observation_v2`, `accepted_receipt_v2`, `revision_evidence_v2`, `revision_concept_v2`, `revision_allocation_v2`, `revision_allocation_concept_v2`, `revision_financial_detail_v2`, `revision_deadline_v2` | S/I; U restrito em `opportunity` para revisão/projeção e observação. Confirmar aprovação, idempotência e autoridade antes/depois. As tabelas derivadas e recibos são append-only para este perfil. |
| Leitura do catálogo | `opportunity_catalog.opportunity`, `revision`, `funding_identity`, `revision_allocation_v2`, `revision_financial_detail_v2`, `revision_concept_v2`, `revision_allocation_concept_v2`, `revision_deadline_v2` | S pelo papel já existente. Verificações privadas ou reconciliações que precisem de outros objetos usam outro port; não ampliar este leitor. |
| Auditoria de negócio | Funções `audit.prepare_append_v1`, `append_event_v1`, `prepare_platform_append_v1`, `append_platform_event_v1` | E só das variantes usadas por cada capacidade; sem I/U/D direto no ledger, sem alterar partições em runtime. |

A lista de U observada em `acceptedRepository.js` é: `current_revision_id, revision_number, row_version, current_schema_version, title, funder_name, programme_name, call_reference, official_url, opening_date, closing_date, quality_score, quality_bucket, content_digest, normalization_version, quality_rule_version, updated_at, last_v2_observed_at`. Isto é a capacidade do escritor partilhado, não autorização para aceitar alterações PT2030: o serviço atual aceita apenas candidatas NEW. A implementação deve provar que o papel para a primeira release não introduz um percurso de atualização não aprovado. Proposta mínima: separar a operação NEW dos caminhos de atualização/reobservação antes de fixar os grants; incluir apenas os updates alcançáveis na operação autorizada. Locks em oportunidades existentes também devem ser medidos, sem conceder U geral para os satisfazer.

Relações lidas por reconciliação v2 (`funding_identity`, `funding_resolution`) não justificam escrita da recolha. Permitir apenas S se o percurso de aceitação da release efetivamente as consultar. `manual_v2_candidate`, `activation_plan_v2`, `activation_decision_v2` pertencem a capacidades opcionais: nenhuma concessão automática por estarem no repositório.

## 5. Funções de comando a distribuir explicitamente

As assinaturas exatas abaixo já constam no SQL versionado. Novos papéis precisam de grants versionados e de revisão dos verificadores, não apenas pertença ao amplo `c4g_central_runtime`.

| Consumidor | Funções |
| --- | --- |
| Autoridade | `authority_api.execute(text,text[],text)`; lista fechada de queries e protocolo de commit existentes, sem adicionar SQL arbitrário |
| Autoridade de publicação v2 | `authority_api.opportunity_v2_administrator(text,uuid)`; preservar validação de política e autenticação recente no adaptador |
| PDFs | `public.billing_pdf_admin(text,uuid)`; `public.billing_attach_pdf(text,uuid,uuid,uuid,uuid,text,integer,text,uuid,integer)` |
| Templates | `public.email_platform_admin(text,uuid)`; `public.email_organization_admin(text,uuid,uuid)`; `public.email_template_write(text,uuid,text,uuid,uuid,text,text,text,text,uuid,integer)` |
| Logótipo | `public.email_logo_write(text,uuid,uuid,uuid,text,text,integer,integer,bytea,uuid,integer)` |
| Complemento | `public.opportunity_complement_write(text,uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,boolean,uuid,integer)` |
| Validação da ficha de faturação | `public.billing_validation_read(text,uuid,uuid,boolean)`; `public.billing_validation_request(text,uuid,uuid,uuid,uuid,uuid)`; `public.billing_validation_confirm(text,uuid,uuid,uuid,uuid)` |
| Worker de email de faturação | `public.billing_validation_email_claim()`; `public.billing_validation_email_finish(uuid,uuid,boolean)` |
| Registo de envio de convite | `public.email_delivery_begin(uuid,uuid,text,boolean)`; `public.email_delivery_finish(uuid,text)` |
| Consulta de envios | `public.email_delivery_list(text,uuid,timestamptz,uuid,text)` |
| Retenção de envios | `public.email_delivery_retention()` |

A retenção de email corre hoje num timer da API e durante `ready()` em `deliveryRuntime.js`. Retirá-la dessa ligação exige alteração real de composição; retirar só o grant impediria a prontidão com o histórico ligado. Separar a rotina é proposta, não facto atual.

O email de recuperação e as suas versões vivem no Keycloak. O serviço usa a API restrita do provider; **não precisa de acesso SQL à base do Keycloak através da Central**. Permissões Resend/R2 também não são grants PostgreSQL.

## 6. Fronteiras que não devem ser alargadas

1. **Diretório:** adotar o leitor restrito existente independentemente de `documentsEnabled`; configuração server-side de organizações/workload própria, sem obrigar a ligar documentos. Verificar os consumidores que esperam métodos adicionais e o comportamento em READ_ONLY; não substituir a factory às cegas.
2. **Locks de autorização:** a query `authoritySql + FOR SHARE OF s,u,a` em PT2030 e o verificador de `fundingTenders/repository.js` não funcionam só com SELECT. PostgreSQL exige UPDATE em pelo menos uma coluna para row locks. Preferir função fechada com owner NOLOGIN e permissões internas mínimas, na mesma transação da escrita, sem conceder UPDATE de contas ao chamador. [Referência PostgreSQL 17](https://www.postgresql.org/docs/17/sql-select.html).
3. **Funções SECURITY DEFINER:** owner NOLOGIN não selecionável pelo serviço, search_path fixo, objetos qualificados, EXECUTE retirado de PUBLIC, validação de ator/organização/idempotência, sem SQL dinâmico arbitrário. Não criar função que aceite SQL ou tabela do chamador.
4. **Dados partilhados:** retirar superutilizador não cria isolamento por organização. SELECT global em `organization_membership` continua global. Ports autorizados e contexto server-side, mais testes cruzados, são necessários; vistas só com colunas não substituem filtro/autorização por organização.
5. **Fila:** sem `pgboss`, `async_exec` ou worker de recolha para a primeira release por simples herança. A importação PT2030 central não é o worker tenant `OPPORTUNITY_IMPORTS_RUNTIME=f12-xlsx`; não provisionar este último por confundir os nomes.
6. **Sem privilégios genéricos:** nada de ALL TABLES, ALL FUNCTIONS, owners, migrators, `pg_read_all_data`, `pg_write_all_data`, CREATE schema, TEMP, TRUNCATE, CREATE EXTENSION ou alteração de roles nos logins funcionais. Considerar também privilégios efetivos via PUBLIC e todas as pertenças transitivas.
7. **Instalação e recuperação:** bootstrap privilegiado apenas fora do runtime; criação de tenants e rotação/publicação de ligações por processo operacional próprio. Plano de backup/restauro separado; não partilhar o login de backup com a API.

## 7. Lacunas concretas para implementar

| Lacuna | Tratamento proposto |
| --- | --- |
| Readiness chama função de observação física | Medir `pg_control_system()` com o perfil limitado; expor só a identidade necessária ou conceder EXECUTE exato ao observador se aprovado. Não presumir que o preflight 052 prova este percurso. |
| SQL de diretório fora do protocolo quando documentos estão desligados | Generalizar a seleção do leitor 031 e manter o âmbito server-side. |
| Verificações administrativas leem sessões diretamente | Migrar para verificador fechado, preservando locks e revalidação. Leituras administrativas de pessoas permanecem distintas. |
| API injeta `centralPool` em todos os módulos | Introduzir dependências/pools por capacidade; mapear readiness, encerramento e orçamentos de ligações. |
| Escritor seleciona `c4g_opportunity_central_runtime` fixo | Novo perfil de autoria sem recolha, seleção interna fechada e validação exata. Não aceitar nome de role via HTTP. |
| Código manual usa `RESET ROLE` para auditar | Auditoria autorizada no papel funcional, mesma transação; RESET nunca recupera privilégio administrativo. |
| ACL e fingerprints fixados | Nova migração/pacote, pins e admissão de produção próprios, incluindo grafo de memberships. Não editar 052 nem reutilizar a flag `C4G_STAGING_CENTRAL_RUNTIME_LOGINS`. |
| ACL PT2030 aceita apenas dois grantees atuais | Versionar `centralImportSecurity` e snapshots com a migração; não contornar o verificador para admitir um papel novo. |
| Papel Central acumula leituras e funções de várias features | Novos perfis com allowlists positivas. Não usar a pertença ao papel antigo como atalho para a matriz. |
| Número de migração | Reservar após verificar a cadeia atual; **não chamar 053** à migração nova, pois 053–056 já têm outros contratos. |

## 8. Verificação necessária antes de ativar

1. Fixar commit, versões PostgreSQL e manifest da release. Construir uma base descartável com instalação de raiz e outro cenário com upgrade; gates externos têm autorização própria. Não usar a VPS para descobrir grants por tentativa.
2. Produzir ACL efetivas por login: atributos, propriedades, memberships transitivas com INHERIT/SET/ADMIN, privilégios PUBLIC, schemas, tabelas, colunas, sequências, funções e RLS. Inventário estático não substitui esta consulta.
3. Provar permissões positivas com as factories reais: login/logout/revogação, diretório tenant sem documentos, dashboard, pessoas, administração, manual, PT2030 upload→preview→stage→aceitação→catálogo, faturação/PDF e features de email selecionadas.
4. Provar recusas: login de leitura não escreve; catálogo não lê PII/originais; autoria não escreve memberships nem faz recolha; worker de email não lê tabelas nem administra contas; runtime não altera roles/schema; nenhum SET ROLE owner/migrator ou fallback administrativo funciona.
5. Provar duas organizações, utilizador suspenso, membership revogada, sessão expirada, concorrência entre revogação e publicação, replay idempotente e rollback da escrita+auditoria. Não remover locks para fazer passar o teste de permissões.
6. COMMIT/ROLLBACK e exceções devolvem o role esperado ao pool; cada pool mostra `session_user/current_user` previstos e `rolsuper=false`. Rotação de credencial e drenagem não reintroduzem login anterior.
7. Preflight passa com ACL exata; alterações de grant/owner/função/membership são recusadas. Regressões de catalogue-reader e originais privados mantêm-se ativas.
8. Ensaio de staging com carga representativa durante 24 h, incluindo as features opcionais selecionadas, sem `permission denied` e com percursos funcionais. `ready=200` sozinho não é critério suficiente.

## 9. Decisões propostas para revisão

- Aprovar a separação de perfis da secção 3 e a ausência de DML de autoridade no login Central comum.
- Reutilizar o leitor restrito 031 fora da funcionalidade documental.
- Criar papel de autoria manual/PT2030 sem as capacidades de recolha do papel atual.
- Fechar a matriz através de funções/ports restritos para verificações administrativas com locks, em vez de UPDATE direto em contas.
- Separar retenção de email do runtime HTTP; conceder features opcionais apenas no perfil da release que as selecionar.

Após estas escolhas, o próximo entregável é o contrato de migração com grants exatos por objeto/coluna/função, alterações de composição e gates positivos/negativos. Ainda não existe SQL de implantação aprovado nem prova de que um login com esta proposta arranque a aplicação atual sem alterações.
