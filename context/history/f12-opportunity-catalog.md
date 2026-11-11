# F12 — Catálogo de Oportunidades — núcleo manual, proveniência e deduplicação determinística

## Identificação

- Nome: **F12 — Catálogo de Oportunidades — núcleo manual, proveniência e deduplicação determinística**
- Tipo: `Feature`
- Estado: `Complete` — revisão humana final aprovada; F12-AC-01–32 PASS no âmbito local autorizado.
- Feature de origem: `context/features/opportunity-catalog.md`

### Inventário do identificador

| Identificador | Situação vinculativa ou histórica |
| --- | --- |
| F0 | Fundação/mitigação Legacy publicada; não reutilizar. |
| F1 | Fundação de testes concluída e publicada. |
| F2 | Identidade e sessão segura concluída. |
| F3 | Membership e contexto organizacional concluída. |
| F4 | Família tenancy: F4.0–F4.3 concluídas; F4.4/F4.5 reservadas. |
| F5 | Autorização funcional concluída. |
| F6 | Reserva histórica de auditoria, obsoleta mas publicada; não reutilizar sem reconciliação. |
| F7 | Auditoria append-only concluída; a referência histórica a documentos foi substituída por F11. |
| F8 | Privacidade e retenção reservada no roadmap histórico. |
| F9 | Execução assíncrona concluída. |
| F10 | Observabilidade concluída; deriva da reserva histórica “Segredos e operação”. |
| F11 | Armazenamento privado de documentos concluído. |
| F12+ | Nenhuma utilização, reserva, branch, PR, decisão, pesquisa ou histórico encontrada. |

F12 é o primeiro identificador verdadeiramente livre após o inventário de contexto, referências históricas e Git. Não renumera nem reutiliza contratos publicados. O conflito documental histórico F6/F7 e o alias antigo de documentos permanecem registados, mas não afetam F12.

## Objetivo

Criar a primeira fundação funcional do catálogo de oportunidades, permitindo oportunidades centrais e oportunidades privadas por organização, introduzidas manualmente com dados sintéticos, com proveniência, qualidade, lifecycle, arquivo e deduplicação determinística, aplicando isolamento, autorização, auditoria, jobs, observabilidade e documentos através das fundações existentes.

## Problema e riscos

O produto aprovado exige catálogo central C4G e oportunidades privadas por organização, mas a implementação Legacy/UBI usa uma base única, conceitos e roles locais, proveniência incompleta e deduplicação implícita/manual. Promover esse modelo perpetuaria mistura de autoridade Central/tenant, IDOR, colisões entre organizações, merges destrutivos, perda de histórico e acoplamento a conectores, uploads ou jobs Legacy.

Este recorte cria apenas o núcleo manual e sintético. Não transforma o código Legacy em arquitetura aprovada, não integra fontes externas e não pressupõe tenants provisionados.

## Evidência e classificação

### Requisitos já aprovados

- Catálogo central C4G partilhado e oportunidades privadas pertencentes a uma organização.
- Base Central como fonte de verdade do catálogo e proveniência centrais; base tenant para relações e dados privados.
- Criação manual, proveniência, qualidade, histórico, arquivo lógico e deduplicação determinística e explicável.
- Duplicados incertos exigem revisão humana; alterações externas ou arquivo nunca eliminam histórico.
- Database-per-organization, membership/contexto F3 e resolução/leases F4.
- F5 deny-by-default, grants positivos e recurso carregado internamente; perfis não recebem grants implícitos.
- F7 append-only/tamper-evident dentro do trust boundary documentado.
- F9 entrega pelo menos uma vez, idempotência e reconciliação, sem promessa `exactly-once`.
- F10 é telemetria operacional não autoritativa e não substitui F7.
- F11 é a única abstração aprovada para documentos/anexos.
- Arquivo conservador, sem eliminação automática, e SQL parametrizado sem infraestrutura escolhida pelo caller.

### Conclusões confirmadas pelo planeamento

- O núcleo pode ser implementado e provado com Central/tenants sintéticos e PostgreSQL 17 descartável, sem F4.4.
- Os catálogos F5/F7/F9/F10 evoluem explicitamente com os códigos fechados aprovados na pesquisa F12, sem grants implícitos.
- A topologia source-local mantém o registo central autoritativo na Central e o privado exclusivamente no tenant; referências cruzadas são opacas e não duplicam autoridade.

### Gates e lacunas preservados

- O catálogo F12 ainda não está implementado; código, testes e migrations dependem de autorização posterior.
- A validação local futura exige PostgreSQL 17 descartável, corpus sintético, regressões das fundações e revisão formal.
- Continuam sem autorização conectores, imports produtivos, matching, candidaturas, reporting, UI final, dados reais, F4.4/F4.5 e rollout.

## Dependências satisfeitas

- F3: membership central e contexto organizacional obrigatório.
- F4.0–F4.3: contrato database-per-organization, diretório, resolução, leases/pools e compatibilidade de schema.
- F5: autorização comum deny-by-default e adapters de canal.
- F7: auditoria append-only e classes de falha.
- F9: worker, outbox/inbox, idempotência, retries e reconciliação.
- F10: logging, tracing, métricas, health e lifecycle locais.
- F11: abstração documental privada e fail-closed.
- Modelo lógico futuro, arquitetura e contrato funcional do catálogo.

## Âmbito

- Oportunidades centrais mantidas pela C4G e oportunidades privadas pertencentes a uma organização.
- Criação e atualização manual, exclusivamente com dados sintéticos.
- Identidade estável, proveniência explícita, qualidade, completude, estados, transições e histórico.
- Arquivo lógico e recuperação autorizada, sem eliminação física.
- Normalização determinística e versionada; geração de chaves e candidatos de duplicação.
- Decisão determinística de duplicado exato e sinalização explicável de possíveis duplicados para revisão futura.
- Idempotência, concorrência, optimistic locking e compatibilidade de versões.
- Isolamento A/B, prevenção de IDOR, contexto confiável e falha fechada.
- F5 com permissions/operações explícitas e zero grants implícitos.
- Eventos F7 e jobs exclusivamente sintéticos via F9.
- Logs, métricas, traces e health F10 sanitizados e sem IDs em labels.
- Anexos apenas através de F11.
- Consulta manual com paginação, ordenação, pesquisa e filtros mínimos allowlisted.
- Migrations Central e tenant e respetivos manifests/fingerprints, executáveis apenas em PostgreSQL 17 descartável durante futura implementação.

## Critérios de aceitação

1. **F12-AC-01 — identidade central:** oportunidade central tem UUID estável interno, residência exclusivamente Central e autoridade C4G comprovada; nenhuma organização a pode alterar diretamente.
2. **F12-AC-02 — identidade privada:** oportunidade privada tem UUID estável, reside exclusivamente no tenant da organização proprietária e não é inferida de IDs Legacy.
3. **F12-AC-03 — fronteira de autoridade:** schema, services e testes impedem tratar registo tenant como central ou gravar dados privados na Central fora do contrato explícito.
4. **F12-AC-04 — criação manual fechada:** criação/atualização aceita apenas schema versionado, tipos e campos allowlisted e contexto confiável.
5. **F12-AC-05 — propriedades desconhecidas:** campos adicionais, prototypes, objetos arbitrários, SQL, infraestrutura e metadata não aprovada são recusados antes da persistência.
6. **F12-AC-06 — proveniência:** proveniência mínima é obrigatória, versionada e preservada; identidade/origem histórica imutável não pode ser sobrescrita silenciosamente.
7. **F12-AC-07 — histórico:** alterações relevantes criam revisão ou evento rastreável com actor, correlation/causation, versão e diferenças allowlisted.
8. **F12-AC-08 — lifecycle:** apenas estados e transições aprovados são aceites; estado desconhecido, regressão indevida ou transição concorrente falha fechado.
9. **F12-AC-09 — arquivo/restauro:** arquivo é lógico, autorizado e auditado; recuperação só ocorre por transição explícita e nunca implica eliminação/recriação destrutiva.
10. **F12-AC-10 — qualidade:** completude, conflitos e qualidade são calculados deterministicamente por versão de regra, com fatores explicáveis e dados ausentes explícitos.
11. **F12-AC-11 — normalização:** a mesma entrada sob a mesma versão produz representação normalizada idêntica; mudança de versão nunca reescreve história silenciosamente.
12. **F12-AC-12 — deduplicação:** decisão de duplicado exato é determinística, versionada, reproduzível e explica os campos/regras usados.
13. **F12-AC-13 — categorias de duplicação:** duplicado exato, possível duplicado e distinto são estados separados; incerteza nunca é promovida automaticamente a igualdade.
14. **F12-AC-14 — ausência de merge destrutivo:** nenhum fluxo elimina origem, revisão, proveniência, relações privadas ou histórico ao consolidar/relacionar duplicados.
15. **F12-AC-15 — idempotência:** repetição, retry e redelivery da mesma operação/chave produzem um único efeito lógico; digest divergente falha fechado.
16. **F12-AC-16 — concorrência:** optimistic locking/CAS recusa versão obsoleta e testes concorrentes impedem lost update e decisão duplicada contraditória.
17. **F12-AC-17 — isolamento A/B:** actors, queries, jobs e IDs válidos da organização A não leem nem alteram oportunidade privada, relação ou candidato da B.
18. **F12-AC-18 — IDOR:** lookup carrega o recurso no repositório correto e verifica residência/organização antes de revelar existência ou executar efeito.
19. **F12-AC-19 — F5:** toda operação usa código allowlisted e policy engine sobre recurso carregado internamente; permission, scope ou ownership nunca vêm do caller.
20. **F12-AC-20 — SoD/MFA:** ações classificadas como sensíveis aplicam SoD/assurance aprovado; nenhum perfil recebe grant produtivo implícito.
21. **F12-AC-21 — F7:** eventos allowlisted respeitam critical-before-effect, deny preservado e observacional reconciliável; payload não contém texto integral ou PII proibida.
22. **F12-AC-22 — F9:** jobs sintéticos usam actor/contexto fixados, reautorização, idempotência e fencing; retry/replay não amplia autoridade nem duplica efeito.
23. **F12-AC-23 — F10:** logs/traces/métricas/health usam catálogos fechados, erros sanitizados e labels sem IDs de organização, oportunidade, actor ou job.
24. **F12-AC-24 — F11:** anexos passam exclusivamente por F11, com autorização, quarentena/scan e metadata tenant-local; não existe path, filesystem ou key do caller.
25. **F12-AC-25 — consulta:** paginação cursor-based, filtros/ordenação allowlisted, limites e resposta bounded são determinísticos e preservam autoridade e isolamento.
26. **F12-AC-26 — SQL seguro:** todas as queries parametrizam valores; caller não fornece identifiers, schema, tabela, coluna, order SQL, tenant ou ligação.
27. **F12-AC-27 — incompatibilidade:** tenant, contexto, residência, catálogo, manifest, schema ou versão incompatível recusa antes da query/efeito e sem fallback.
28. **F12-AC-28 — migrations:** migrations Central/tenant são ordenadas, schema-qualified, verificadas e reversíveis apenas quando seguro em bases descartáveis; runtime não executa DDL.
29. **F12-AC-29 — gate PostgreSQL:** forward, rollback permitido, re-forward, restart, constraints, concorrência e A/B passam em PostgreSQL 17 exclusivamente descartável.
30. **F12-AC-30 — sem Legacy:** scans/testes provam ausência de fallback, roles, schema, IDs, pools, filesystem, jobs ou conceitos UBI no núcleo F12.
31. **F12-AC-31 — ambiente sintético:** testes usam apenas oportunidades, organizações, actors e documentos sintéticos, sem bases persistentes, dados reais ou integrações externas.
32. **F12-AC-32 — startup:** catálogos, manifests, fingerprints, regras e compatibilidade são validados atomicamente; duplicado, drift ou versão desconhecida falha fechado.

## Decisões vinculativas

- `DATABASE_PER_ORGANIZATION`; Central contém catálogo/proveniência centrais e tenants contêm dados operacionais privados.
- Contexto F3 e membership ativa precedem acesso tenant; F4 resolve tenant, lease e compatibilidade sem input de infraestrutura do caller.
- F5 é deny-by-default, usa grants positivos, recurso carregado internamente e zero grants implícitos nos perfis.
- F7 é append-only/tamper-evident apenas dentro do trust boundary declarado e não é `tamper-proof`.
- F9 oferece entrega pelo menos uma vez, inbox/outbox, idempotência e reconciliação; não oferece `exactly-once`.
- F10 é operacional e não autoritativa; falha de telemetria não altera o efeito nem substitui F7.
- F11 é a única abstração documental; não existe fallback filesystem/Legacy nem equivalência local com R2.
- Oportunidades e proveniência são preservadas e arquivadas; não existe eliminação automática.
- SQL, schema, tenant, ligação, identifiers técnicos e infraestrutura nunca são escolhidos pelo caller.
- Esta ação documental não autoriza qualquer operação persistente nas bases dev/reais.

## Decisões aprovadas

F12-D1–F12-D32 foram aprovadas conjuntamente em 2026-10-08 conforme `context/research/f12-opportunity-catalog-decisions.md`. A tabela é um índice compacto; schema, catálogos, algoritmos, limites e redação normativa integral desse documento são vinculativos. Não resta decisão comportamental necessária para a implementação local sintética.

| ID | Pergunta e alternativas viáveis | Decisão aprovada | Impacto e evidência necessária |
| --- | --- | --- | --- |
| F12-D1 | Identificador/nome: reutilizar reserva histórica ou usar primeiro ID livre. | `F12 — Catálogo de Oportunidades — núcleo manual, proveniência e deduplicação determinística`. | Evita colisões; validar contra Git/roadmap e futura registry única. |
| F12-D2 | Topologia: tudo Central, tudo tenant ou source-of-truth dividido. | Central autoritativa para oportunidades comuns; tenant autoritativo para privadas e relações locais. | Define transações e isolamento; cruzar arquitetura/modelo lógico e testar ausência de escrita cruzada. |
| F12-D3 | Modelo: entidade única com discriminator ou contratos central/privado separados. | Contratos separados com identidade/projeção comum mínima. | Reduz mistura de autoridade; exige matriz campo×residência. |
| F12-D4 | Relação privada↔central: cópia, FK impossível entre bases, referência opaca ou snapshot. | Referência opaca + revision ID/snapshot mínimo versionado, sem FK cross-database. | Preserva explicabilidade; testar Central indisponível e revisão histórica. |
| F12-D5 | Campos obrigatórios/opcionais do núcleo manual. | Snapshot v1 fechado e limites exatos definidos na pesquisa aprovada. | Afeta API, migrations e dedupe; mudanças exigem nova versão. |
| F12-D6 | Taxonomias/vocabulários: strings livres, enums fixos ou catálogos versionados. | Catálogos versionados, com `UNKNOWN` explícito onde permitido. | Evita deriva e suporta evolução; inventariar taxonomias aprovadas. |
| F12-D7 | Identificadores externos: únicos globais, por fonte ou múltiplos. | Identidade composta por source + namespace + external ID normalizado. | Determina dedupe/proveniência; validar colisões e fontes sem ID. |
| F12-D8 | Proveniência: campos no registo, tabela de links ou evento livre. | Entidade/link versionado e fechado, múltiplas proveniências preservadas. | Afeta histórico e consolidação; definir origem manual C4G/organização. |
| F12-D9 | Qualidade/completude: score, flags ou ambos. | Oito fatores v1 e score derivado 0–100, nunca autoridade isolada. | Exige fórmula e testes tabelados aprovados. |
| F12-D10 | Lifecycle central e privado e respetivas transições. | Lifecycle `DRAFT/ACTIVE/STALE/ARCHIVED` e validation state `PENDING_REVIEW/VALIDATED_MANUAL/CONFLICT`, com transições fechadas. | Evita estados UBI universais. |
| F12-D11 | Arquivo e recuperação: quem pode, condições e MFA/SoD. | Arquivo/restauro explícitos, auditados e sujeitos a permission própria; sem delete. | Afeta F5/F7; exige classificação de sensibilidade. |
| F12-D12 | Ownership/visibilidade de registos e relações privadas. | Organização do contexto é owner; visibilidade por grants/scopes, não por creator implícito. | Define IDOR e colaboração; precisa matriz de actors/scopes. |
| F12-D13 | Permission codes F5 e operações correspondentes. | Sete permissions exatas da pesquisa, zero grants e `CATALOG_MAINTAINER` interno para gestão central. | Introduz autorização produtiva sem acesso implícito. |
| F12-D14 | Event codes F7, residência e classes. | Onze eventos exatos, source-local e com payload allowlisted. | Criticalidade fixa a atomicidade. |
| F12-D15 | Jobs F9 necessários neste recorte. | `opportunity.duplicate.scan` e `opportunity.catalog.reconcile`; escrita manual continua síncrona. | Define outbox/inbox e reautorização. |
| F12-D16 | Signals F10 e health. | Signals, operations e três métricas fechadas da pesquisa; sem IDs e sem thresholds produtivos. | Reutiliza budgets F10. |
| F12-D17 | Relação com F11: attachment do quê e em que residência. | Attachment apenas de oportunidade privada tenant-local; Central fica sem binário neste recorte salvo decisão posterior. | Evita metadata Central e R2 real; validar casos de uso. |
| F12-D18 | Algoritmo/versão de normalização. | `opportunity-normalization-v1`, NFC e regras conservadoras por campo, preservando originais. | Afeta digest e histórico; exige corpus adversarial multilingue. |
| F12-D19 | Campos e precedência usados na deduplicação. | Seguir ordem aprovada: ID oficial; programa+referência; URL; financiador; título; datas; restantes sinais. | Precisa regras exatas de igualdade/ausência/conflito. |
| F12-D20 | URLs, texto, datas, entidades e identificadores. | Normalizadores independentes e fail-closed; preservar valor original + normalizado. | Evita equivalências erradas; requer formatos/limites e corpus. |
| F12-D21 | Digest/chave determinística: material e algoritmo. | SHA-256 sobre JCS com domain separators aprovados para content, provenance e idempotency. | Digest não substitui identidade nem assinatura. |
| F12-D22 | Thresholds de similaridade: nenhum, fixos ou configuráveis. | Nenhum threshold silencioso; regras exatas para duplicado e sinais discretos/versionados para candidato. | Evita fuzzy merge opaco; benchmark/corpus necessário se houver score. |
| F12-D23 | Exato vs candidato e desempate. | Exato só por regras fortes aprovadas; conflito produz candidato, nunca merge. | Exige matriz de casos positivos/negativos. |
| F12-D24 | Revisão humana futura: estado, autoridade e efeitos. | Persistir candidato/decisão sem UI; decisão manual exige permission/audit e preserva ambas as origens. | Define fronteira deste recorte e futuro workflow. |
| F12-D25 | Concorrência e idempotency keys. | CAS por `rowVersion`, locks ordenados e digest interno por authority/operation/request/content. | Mismatch falha fechado; deadlocks têm retry limitado. |
| F12-D26 | Pesquisa, filtros, ordenação e paginação. | Query port fechado, filtros/sorts allowlisted e keyset opaco com desempate por UUID. | Preserva isolamento e bounds. |
| F12-D27 | Limites de payload, texto, lista e página. | 32 KiB por payload, 16 KiB de texto, 32 itens/lista, página 25/100, resposta 1 MiB e timeout 5 s. | Sizing produtivo permanece futuro. |
| F12-D28 | Estratégia de migrations Central/tenant. | Central `006_f12_opportunity_catalog` e tenant `004_f12_opportunity_catalog`, após reconfirmação do filesystem/manifests; expand-compatible e sem FK cross-DB. | Rollback apenas seguro/descartável; fingerprints obrigatórios. |
| F12-D29 | Matriz de tabelas/índices/roles Central×tenant. | Documento normativo antes do SQL, com runtime mínimo e queries schema-qualified. | Previne mistura de dados; validar privilégios e RLS quando aplicável. |
| F12-D30 | Compatibilidade N/N-1 de schema, rules e eventos. | Leitura N/N-1 apenas quando declarada; writes somente N, sem upcast implícito. | Matriz versionada e fail-closed. |
| F12-D31 | Fixtures, doubles e dados sintéticos. | Corpus fechado com duas organizações, fontes fictícias e casos de colisão; zero cópia UBI. | Necessário para provas A/B, dedupe e migrations. |
| F12-D32 | Limites/benchmark local. | Definir cenários e budgets de segurança, sem SLO produtivo; resultados são gates de implementação, não sizing. | Exige volume sintético, concorrência e métricas reproduzíveis. |

## Riscos Legacy/UBI a não promover

- UBI, faculdades, centros e investigadores tratados como universais.
- Roles globais `ADMIN`/`PROFESSOR` interpretadas como autorização funcional.
- Pool/base única e ausência de isolamento entre organizações.
- Catálogo central e dados privados sem fronteira autoritativa.
- Proveniência, qualidade e histórico de fontes incompletos.
- Deduplicação implícita/manual sem versão, explicação ou revisão segura.
- Deletes/cascades e retenção automática incompatíveis com arquivo conservador.
- Uploads em filesystem e ficheiros órfãos.
- Timers, cron, sincronização e handlers dentro da API.
- Dados pessoais/institucionais, nomes e estruturas locais incorporados em schema, seeds, UI e reporting.

## Componentes previstos

O plano fixa responsabilidades e namespaces esperados; nomes internos secundários podem ser ajustados durante a implementação sem alterar os contratos aprovados:

- migrations Central e tenant, manifests, checksums e fingerprints;
- evolução explícita dos catálogos F5, F7, F9 e F10;
- schemas/validators fechados, state machines e contratos de revisão;
- repositories/services Central e tenant-local com ports de consulta e escrita;
- normalização, canonicalização, digests e deduplicação determinística;
- adapters F11 para anexos privados;
- outbox/jobs/reconciliação sintéticos F9;
- métricas, traces, logs e health F10;
- testes unitários, de contrato, adversariais, integração e PostgreSQL 17 descartável.

## Numeração e fronteira das migrations

- **Central:** o filesystem termina em `005_f7_append_only_audit`; fica confirmado `006_f12_opportunity_catalog`, depois de `000`–`005` e do schema `pgboss` 45 gerido por F9.
- **Tenant:** o filesystem termina em `003_f11_private_document_storage`; fica confirmado `004_f12_opportunity_catalog`, depois de `000`–`003`.
- **Dependências:** F7 deve existir nas duas bases para eventos source-local; F9 deve existir para outbox/inbox; F11 é dependência tenant apenas para attachments.
- **Manifests:** atualizar a cadeia canónica Central/tenant, checksums SHA-256, ordinals, capabilities, compatibilidade N/N-1, fingerprints e preflight, integrando os manifests específicos F7/F9/F11 sem reescrever migrations publicadas.
- **Rollback:** os ficheiros `.down.sql` só podem remover objetos F12 numa base PostgreSQL 17 descartável, depois de provar ausência de dados não sintéticos e dependentes; não existe rollback operacional de revisões/proveniência. Em ambientes persistentes futuros a migration é forward-only por política operacional.
- **Irreversibilidades:** revisões, proveniência, decisões e outboxes são histórico preservado; rollback com dados é proibido. Não há FK, write atómico ou transação distribuída Central↔tenant.
- **Execução nesta ação:** nenhuma migration foi criada ou executada.

## Plano técnico — 32 etapas ordenadas

| # | Entrega e componentes | Interfaces/dependências | Critérios e testes | Riscos e invariantes |
| ---: | --- | --- | --- | --- |
| 1 | Evoluir `backend/src/authorization/catalogs.js`, `audit/eventCatalog.js`, `async/jobRegistry.js`/production registry e `observability/catalogs.js`/`metrics.js` para versões F12. | Sete permissions, onze eventos, dois jobs e signals/métricas exatos; startup validation. | AC-19–23,32; snapshots, duplicados, mutação e código desconhecido. | Zero grants; sem wildcard; compatibilidade F5/F7/F9/F10 anterior. |
| 2 | Criar contratos fechados de command/query/result em novo namespace `backend/src/opportunities/`. | Validators sem dependência de Express/PG; snapshot v1 aprovado. | AC-04,05,25,27; extras, prototypes, tamanhos e tipos adversariais. | Nenhum conceito UBI, JSON livre, SQL ou infraestrutura. |
| 3 | Modelar schema Central `opportunity_catalog`. | Migration 006; ownership Central e runtime mínimo. | AC-01,03,28,32; schema snapshot/fingerprint e authority forgery. | Central não guarda ownership privado nem attachments. |
| 4 | Modelar schema tenant `opportunity_catalog`. | Migration 004; RLS/contexto, private opportunities e `organization_opportunity`. | AC-02,03,17,28,32; RLS A/B e constraints XOR. | Nenhuma cópia autoritativa Central ou FK cross-DB. |
| 5 | Implementar UUIDv7 interno, `revisionId`, `revisionNumber` e `rowVersion`. | Reutilizar `audit/uuidV7.js` por port/util comum, sem expor biblioteca. | AC-01,02,07,16; monotonicidade, colisão, input forjado e CAS. | Caller nunca fornece autoridade/identidade técnica. |
| 6 | Implementar revisão imutável e proveniência append-only. | Repositories escrevem opportunity+revision+source link na mesma transação local. | AC-06,07,14; tentativa de overwrite/update/delete e multi-source. | Correção cria nova revisão; origem nunca desaparece. |
| 7 | Implementar quality evaluator v1 de oito fatores. | Função pura versionada, códigos fechados e score half-up. | AC-10; tabela 0–8 fatores, missing/conflict e determinismo. | Score é informativo, não autorização/publicação. |
| 8 | Implementar lifecycle/validation state machines e archive/restore. | F5/F7 antes do efeito; CAS transacional. | AC-08,09,20,21; todas as transições e concorrência. | Sem delete; restore/review sensíveis e auditados. |
| 9 | Implementar normalização `opportunity-normalization-v1`. | Funções por campo; originais preservados. | AC-11; Unicode, whitespace, casing, dates, decimals, IDs e URLs. | NFC, sem diacritic stripping/stemming/inferência. |
| 10 | Reutilizar/encapsular JCS-1 de `backend/src/audit/canonicalJson.js`. | Contrato de canonicalização independente do ledger. | AC-11,12,15; property order, números inválidos e Unicode. | JCS só após validação; nenhuma canonicalização de objeto arbitrário. |
| 11 | Implementar `contentDigest`, `provenanceDigest` e `idempotencyDigest`. | SHA-256 Node, domain separators aprovados, comparação timing-safe. | AC-12,15,32; forgery, reuse, equivalência e mudança funcional. | Digest não é ID, assinatura ou autoridade. |
| 12 | Implementar classificador `EXACT/POSSIBLE/DISTINCT`. | Regras fortes e sinais discretos v1. | AC-12,13; matriz positiva/negativa e conflitos entre evidências. | Sem fuzzy score/threshold oculto. |
| 13 | Persistir candidate pairs, reason codes e evidence fields. | Par ordenado, unique constraint e ruleVersion. | AC-13,16; par reverso, concorrência e explicabilidade. | Candidate não é merge nem autorização. |
| 14 | Implementar ligação canónica/decisão sem merge destrutivo. | Decision service cria relação e revisão/evento, não move/apaga dados. | AC-14,21; origens, proveniência e relações preservadas. | Nenhum overwrite, cascade ou delete automático. |
| 15 | Implementar idempotency boundary por autoridade/operação/request/content. | Repository recalcula digest e conserva resultado técnico. | AC-15; retry, redelivery, digest mismatch e requests concorrentes. | Caller digest nunca é autoridade. |
| 16 | Implementar optimistic locking e lock ordering. | `expectedRowVersion`, CAS e UUID order para pairs. | AC-16; stale writer, dois writers, deadlock e retry limitado. | Sem lost update; transações curtas, sem input humano aberto. |
| 17 | Criar Central repository e transaction port. | Queries schema-qualified/parametrizadas; reader/writer segregados. | AC-01,03,06,07,15,16,26; spies SQL e integração PG17. | Nada do caller escolhe schema/table/order. |
| 18 | Criar tenant repository sobre lease/executor F4. | Contexto F3/F4, RLS e organization fixada. | AC-02,03,17,18,26,27; A/B, IDOR, stale lease/schema. | Sem fallback Central/Legacy/outro tenant. |
| 19 | Criar services/ports de command, query, resource loading e transaction. | Adapters API/job chamam o mesmo domínio; dependências injetadas. | AC-04,18,19,27; zero-effect em falha de port/contexto. | Controllers não interpretam roles nem implementam policy. |
| 20 | Implementar query port, filtros/sorts e keyset cursor v1. | Default 25, max 100, 1 MiB, 5 s e filtros aprovados. | AC-25,26; cursor/filter forgery, stale cursor, bounds, N+1 probe. | Sem column/order SQL do caller; queries bounded. |
| 21 | Integrar F5 nos services e resource ports. | `opportunity.*`, scopes ORG/RESOURCE e `CATALOG_MAINTAINER` interno. | AC-17–20; grants sintéticos, deny, MFA/SoD, A/B e IDOR. | Perfis continuam vazios; caller não escolhe actor/permission/scope. |
| 22 | Integrar onze eventos F7 source-local. | Critical na transação/intenção durável; deny preservado; observational via F9. | AC-06–09,12–14,21; falha, duplicate e payload leak. | Não duplicar texto/URL/PII; falha nunca concede acesso. |
| 23 | Implementar dois jobs F9 e outbox/inbox local. | `duplicate.scan` e `catalog.reconcile`, actors fixos e envelopes v2. | AC-15,22; redelivery, replay, crash, revogação e fencing. | Job não decide merge humano nem amplia autoridade. |
| 24 | Integrar F10 nos caminhos reais. | Operations/signals/métricas aprovados via feature adapter. | AC-23; sanitização, cardinalidade, overflow e exporter failure. | Telemetria não altera efeito nem substitui F7. |
| 25 | Criar binding F11 apenas para oportunidade privada tenant-local. | Resource binding opaco após F5; composição Central não expõe adapter. | AC-17,18,24; attachment A/B, recurso errado e quarentena. | Sem attachment Central, filesystem, R2 real ou key do caller. |
| 26 | Consolidar manifests/fingerprints/preflight. | Atualizar manifests Central/tenant e integrar F7/F9/F11 publicados. | AC-27–29,32; gaps, ordem, checksum, fingerprint e drift. | Não reescrever checksums/migrations anteriores. |
| 27 | Criar SQL 006/004 e `.down.sql` guardados. | Schemas, tables, constraints, roles/RLS, índices e outboxes. | AC-01–03,06–09,14–17,25–29; forward/down/re-forward. | Down só descartável/vazio; runtime sem DDL/delete. |
| 28 | Adicionar testes unitários F12. | Node test, clocks/UUID/RNG controlados e corpus sintético. | AC-04–16,20,25,27,30–32. | Cobrir Unicode/URL/date/digest/payload; sem mocks que evitem contratos. |
| 29 | Adicionar testes de contrato/integração. | Services + repositories + F5/F7/F9/F10/F11, duas organizações. | AC-01–27; paths reais, A/B, IDOR, crash e failures. | Sem bases persistentes, rede, provider ou dados reais. |
| 30 | Criar gate PostgreSQL 17 descartável único. | Central+dois tenants sintéticos, porta segura e cleanup exato. | AC-01–03,15–18,26–29,32; restart, concorrência e drift. | Proibir 5432/5433; não reutilizar volumes/bases dev. |
| 31 | Criar benchmark local F12. | 10k normalize/digest/exact, query sobre 100k sintéticas e concorrência. | AC-10–16,25,32; throughput/latency/memory/query plan. | Baseline, não SLO/sizing; scans e N+1 limitados. |
| 32 | Executar gate, revisão formal e fecho condicionado. | Testes F12, suite backend, regressões F3–F11, node check, scans e diff. | AC-01–32; revisão adversarial linha a linha. | Só `Complete`/arquivo/Git com 32/32 e zero finding acionável. |

Ordem de dependência: 1–2 → 3–6 → 7–16 → 17–20 → 21–25 → 26–27 → 28–31 → 32. As migrations só são materializadas depois de contratos, catálogos e modelos estarem congelados, e só são executadas no gate descartável.

## Matriz de validação F12-AC-01–F12-AC-32

| Critério | Componente responsável | Evidência/teste ou probe | Gate | Limitação deliberada |
| --- | --- | --- | --- | --- |
| F12-AC-01 | Modelo/repository Central | Migration + create/get provam UUID interno, residência e recusa de actor tenant | PG17 + contrato | Sem catálogo real |
| F12-AC-02 | Modelo/repository tenant | RLS/contexto e create/get privado em dois tenants | PG17 A/B | Tenants sintéticos |
| F12-AC-03 | Ports e constraints Central/tenant | Probes de authority forgery, FK/write cross-DB e snapshot excessivo | Adversarial + PG17 | Sem transação distribuída |
| F12-AC-04 | Command schemas/services | Unitários de create/update válidos e inválidos | Focado | Apenas schema v1/manual |
| F12-AC-05 | Validators fechados | Extras, prototypes, SQL/infra, arrays/objetos arbitrários | Adversarial | Sem extensões livres |
| F12-AC-06 | Provenance service/repository | Obrigatoriedade, immutability e múltiplas origens | Unitário + PG17 | Só proveniência manual |
| F12-AC-07 | Revision repository/F7 | Cada mutação cria revisão e evento correlacionado | Integração | Sem histórico importado |
| F12-AC-08 | State machines | Tabela completa de transições, unknown/stale/concurrent | Unitário + PG17 | Sem estados de connectors |
| F12-AC-09 | Archive/restore service | Archive/restore com F5/MFA/F7 e tentativa de delete | Integração/adversarial | Sem eliminação física |
| F12-AC-10 | Quality evaluator | Oito fatores, score, missing/conflict e repetibilidade | Unitário | Score não decide publicação |
| F12-AC-11 | Normalizers | Corpus Unicode/URL/date/decimal/case/whitespace e version change | Unitário/fuzz | Sem fuzzy/linguística |
| F12-AC-12 | Dedup classifier | Matriz de regras fortes/sinais e explicação/digest | Unitário | Mesma autoridade apenas |
| F12-AC-13 | Candidate service | EXACT/POSSIBLE/DISTINCT, conflitos e pair uniqueness | Unitário + PG17 | Revisão UI fora |
| F12-AC-14 | Decision service | Decisão preserva origins/revisions/provenance/relations | Integração | Nenhum merge físico |
| F12-AC-15 | Idempotency repository/F9 | Retry/redelivery/replay, digest reuse/mismatch e efeito único | Concorrência + PG17 | Pelo menos uma vez |
| F12-AC-16 | CAS/locking | Dois writers, stale version, ordered pair e deadlock retry | Concorrência PG17 | Sem lock distribuído |
| F12-AC-17 | Tenant repository/F5 | Matriz A/B para read/write/query/job/attachment | Adversarial PG17 | Dados sintéticos |
| F12-AC-18 | Resource loader/services | IDs válidos cruzados/inexistentes e resposta uniforme | IDOR probe | Sem enumeração pública |
| F12-AC-19 | F5 adapter/catalog | Permission/scope/owner forjados e recurso carregado | Contrato F5 | Zero grants produtivos |
| F12-AC-20 | F5 assurance/SoD | Archive/restore/review/admin com/sem MFA e actor inválido | Contrato F5 | Keycloak real fora |
| F12-AC-21 | F7 adapter/catalog | Critical abort, deny preservado, observational redelivery e leak scan | Contrato F7 | Ledger real sem rollout |
| F12-AC-22 | F9 registry/handlers | Actor revogado, fencing, retry/replay/crash e efeito único | Contrato F9 + PG17 | Jobs apenas sintéticos |
| F12-AC-23 | F10 adapters/catalog | Logs/spans/métricas sem IDs/texto/URL, overflow e failure | Contrato F10 | Exporters in-memory |
| F12-AC-24 | F11 binding adapter | Apenas private resource, A/B, wrong binding e quarantine | Contrato F11 | Sem R2/scanner reais |
| F12-AC-25 | Query port/repositories | Cursor/filter/sort forgery, bounds, timeout, response e N+1 | Integração + benchmark | Pesquisa mínima |
| F12-AC-26 | Repositories | Spy/scan SQL prova parâmetros e allowlists de identifiers | Estrutural + PG17 | Sem query livre |
| F12-AC-27 | Composition/preflight | Context/tenant/catalog/schema/version mismatch antes de query | Startup/adversarial | Sem fallback |
| F12-AC-28 | Migration manifests/runners | Ordem, checksum, fingerprint, forward/down seguro/re-forward | Gate PG17 | Down apenas descartável/vazio |
| F12-AC-29 | Gate descartável | PostgreSQL 17, restart, constraints, roles, A/B e cleanup | Gate PG17 | Não prova produção |
| F12-AC-30 | Import/scan tests | Scan de UBI/Legacy/ADMIN/PROFESSOR/pool/filesystem/cron | Estrutural | Migração UBI fora |
| F12-AC-31 | Fixtures/composição | Network/DB target spies e corpus exclusivamente sintético | Offline gate | Sem dados/providers reais |
| F12-AC-32 | Startup validators | Duplicados, mutação, gaps, drift e N/N-1/unknown version | Startup + PG17 | Rollout futuro |

Cobertura planeada: **32/32**. Nenhum critério depende apenas de inspeção visual; todos têm teste automatizado, probe estrutural ou gate PostgreSQL previsto.

## Plano de testes proposto

- Unitários: schemas, states, qualidade, normalizadores, canonicalização, digest e regras de dedupe.
- Contratos: ports Central/tenant, catálogos F5/F7/F9/F10 e adapter F11.
- Adversariais: campos extra, prototypes, IDs/tenants/SQL forjados, IDOR, A/B, texto/Unicode/URL/data hostis e digest mismatch.
- Concorrência: idempotência, CAS, retries, redelivery e dois writers.
- PostgreSQL 17 descartável: forward/rollback seguro/re-forward, manifests/fingerprints, constraints, privilégios, restart e queries parametrizadas.
- Integração local: create/update/archive/restore, revisão, exact/candidate duplicate, jobs/reconciliação e falhas dos ports.
- Scans: Legacy/UBI, filesystem, secrets, dados reais, SQL/infra do caller, labels com IDs, grants implícitos e integrações externas.

## Progresso da implementação — etapas 1–2

- Estado mantido em `In Progress`; implementação iniciada em `feat/f12-opportunity-catalog`.
- Criado `backend/src/opportunities/` com contratos internos fechados v1, validação e limites, identidade UUIDv7 injetável, revisões imutáveis, proveniência append-only, lifecycle versionado, qualidade v1, normalização, JCS, digests SHA-256, deduplicação determinística e erros sanitizados.
- Catálogos F5/F7/F9/F10 evoluídos declarativamente: sete permissions sem grants, onze eventos F12, dois tipos de job sem handlers produtivos, dois signals, sete operations e três métricas.
- A publicação do conjunto F12 é atómica depois da validação integral; falha não substitui o conjunto anteriormente publicado.
- O catálogo persistível F7 continua deliberadamente na versão anterior: integrar os onze event codes F12 nas constraints/manifests depende das migrations da etapa 3 e não foi antecipado.
- A registry produtiva F9 permanece vazia; os jobs F12 ainda não possuem handlers executáveis.
- Validação executada: 18/18 testes unitários F12; 82/82 regressões diretamente afetadas F5/F7/F9/F10; `node --check` em 22 ficheiros JavaScript; scan estrutural revisto; `git diff --check` sem erros.
- Cobertura total nesta fase: contratos/limites puros, qualidade v1, normalização/JCS/digests, classificação `EXACT/POSSIBLE/DISTINCT` e catálogos declarativos. Cobertura parcial: identidade/residência, revisões, proveniência, lifecycle/CAS, idempotência, autorização/auditoria/jobs/telemetria, query e startup, porque a prova persistente e a composição funcional ainda não existem.
- Permanece pendente: repositories Central/tenant, isolamento A/B e IDOR persistentes, transactions/outbox/inbox, migrations/manifests/fingerprints, handlers F9, adapters F5/F7/F10/F11 nos caminhos funcionais, PostgreSQL 17 descartável e gates de integração.
- Desvio documental preservado: o cabeçalho da pesquisa continua a indicar “recomendadas, ainda não aprovadas”; a aprovação vinculativa consta deste contrato ativo e foi reiterada na autorização de `start`. A pesquisa não foi alterada.

## Progresso da implementação — etapa 3

- Confirmadas sem colisão as migrations Central `006_f12_opportunity_catalog` e tenant `004_f12_opportunity_catalog`.
- Checksums SHA-256 canónicos atuais: Central `78672a96e9638b3bcbadbe2cc647a56f7a070b488f962dfc7715cee0b9974898`; tenant `2131add5ba96156c6d4d3ff1802ad60355207f19dc6581d7ae4da44258c0df04`.
- Criados schemas `opportunity_catalog` source-local distintos para Central e tenant, com opportunity atual, revisão imutável, proveniência append-only, idempotência, candidatos de duplicação, índices keyset e, apenas no tenant, relação organizacional e RLS em todas as tabelas.
- Criados `CentralOpportunityRepository` e `TenantOpportunityRepository` como composições distintas e fixas; não existe seleção de base/schema/role pelo caller nem fallback entre autoridades.
- Implementados create idempotente, get, update por nova revisão/CAS, archive/restore lógicos, proveniência por revisão, candidatos com par canónico e listagem bounded com cursor vinculado a scope/filtros/sort.
- O suporte físico F7 foi evoluído para os onze eventos F12, preservando códigos anteriores; startup/preflight recusa drift de schema, roles, RLS, versão PostgreSQL ou catálogo físico.
- Gate executado em PostgreSQL `17-alpine`, digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`, loopback `5547`, com Central e tenants A/B sintéticos. Passaram forward, preflight, repositories, isolamento/IDOR, idempotência, digest divergente, CAS, archive/restore, restart, rollback vazio, remoção integral do schema, re-forward e reexecução idempotente.
- Finding corrigido no gate: roles tenant são globais ao cluster e partilhadas pelas duas bases; rollback de uma migration não pode eliminar roles ainda usadas por outra base. Os `.down.sql` removem exclusivamente objetos F12 da base e preservam roles provisionadas.
- Validação desta etapa: 24/24 testes F12 de domínio/persistência, 20/20 regressões F11 diretamente afetadas e 272/272 regressões F3/F4.1–F4.3/F5/F7/F9. O gate descartável passou integralmente.
- Critérios com prova persistente nesta etapa: AC-01–03, AC-06–09, AC-12–18, AC-21 (catálogo físico), AC-25–29 e AC-32. AC-19–24 permanecem parciais até composição funcional F5/F7/F9/F10/F11; AC-30/31 mantêm scans e ambiente exclusivamente sintético.
- Permanecem fora desta etapa: adapters funcionais F5/F7/F10/F11, handlers F9, outbox funcional F12, grants produtivos, serviços externos, dados reais, benchmark final, revisão e fecho.

## Progresso da implementação — composição e revisão formal

- Adicionados application services distintos por repository Central/tenant, adapter F7 allowlisted, telemetria F10 nos caminhos funcionais, registry fechada para os dois jobs F9 e binding F11 exclusivamente tenant-local através de `ObjectStoragePort`.
- Testes novos de composição: 8/8; conjunto F12 total: 32/32; regressões F3–F11 afetadas: 351/351; suite backend completa: 483/483, sem skips ou TODOs.
- Gate PostgreSQL 17 repetido em `127.0.0.1:5547`: forward, preflight, isolamento, idempotência, CAS, restart, rollback vazio, re-forward e reexecução passaram; imagem `postgres:17-alpine`, digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.
- Benchmark local, não SLO: 10 000 normalizações+digests em 83.063 ms; 10 000 classificações em 90.244 ms; doubles de create/update e handlers concluídos apenas como custo de composição, não como medição PostgreSQL produtiva.
- Veredicto formal: `needs changes`. A camada criada prova autorização antes de efeito, auditoria crítica antes de efeito e falha de telemetria não autoritativa, mas não prova atomicidade PostgreSQL entre revisão/proveniência e intenção F7.
- F5 permanece parcial: os testes de composição usam um authorization double e não exercitam `createAuthorizationService` com membership F3, policy engine, revogação imediata, MFA/SoD e resource port Central/tenant reais.
- F9 permanece parcial: os dois handlers são fechados e exigem envelope v2, mas ainda não atravessam worker, inbox/outbox, claim/fencing, replay, cancelamento, deadline, suspensão/offboarding e reautorização reais.
- F10 permanece parcial: métricas atravessam os application services, mas os exporters OpenTelemetry in-memory e continuidade parent/link F9 não são exercitados pelo caminho F12.
- F11 permanece parcial: o binding tenant-only usa apenas doubles e valida disponibilidade, mas ainda não existe prova end-to-end com metadata F11 persistente, quarentena/rejeição/arquivo e auditoria documental própria.
- O repository ainda recusa o filtro contratual `duplicateClass`; archive/restore não criam revisão imutável nem registo idempotente; os testes PostgreSQL finais não cobrem a composição funcional, concorrência dos jobs ou atomicidade F7.
- Em consequência, F12 fica em `Review`, sem arquivo, stage, commit, push ou PR. Integração Git condicionada não foi ativada.

## Correção consolidada dos findings — progresso

- Finding 1 avançado: create, update, archive, restore e decisões de candidatos usam o `PostgresAppendRepository`/append service F7 real no mesmo client e transação source-local; probes PostgreSQL provam evento+efeito atómicos, retry sem duplicação, digest divergente fail-closed e rollback integral por falha do ledger.
- Finding 3 avançado: a composição produtiva F5 passou a publicar o catálogo F12 com 18 permissions/operations totais e zero grants nos quatro perfis; as regressões reais de policy engine, membership, revogação, MFA, SoD e IDOR passam. Falta ainda atravessar esses ports reais dentro do gate funcional F12 PostgreSQL.
- Finding 4 resolvido no repository: archive/restore criam revisão imutável, proveniência, CAS, idempotency digest/record e usam timestamps autoritativos da base; retry não cria revisão adicional. O gate comprova revision numbers 2/3 e rollback F7.
- Finding 5 resolvido: `duplicateClass` usa enum contratual, `EXISTS` estático parametrizado sobre candidate pairs, isolamento tenant e cursor vinculado aos filtros. O benchmark PostgreSQL exercita `POSSIBLE`; cobertura persistente explícita de `EXACT`, `DISTINCT`, cursor divergente e A/B continua por acrescentar.
- Finding 8 avançado: benchmark PostgreSQL 17 loopback real com warmup 5, dataset 12 e mediana/p95/máximo, sem SLO. Todas as operações medidas terminaram sem falhas: create 7,683/13,446 ms, get 2,929/3,760 ms, update 8,479/9,681 ms, archive+restore 17,778/20,942 ms, list 2,545/3,343 ms, retry 2,427/2,699 ms, candidate write 3,768/4,820 ms e filtro 2,648/2,880 ms (mediana/p95 da última execução representativa).
- Finding adicional corrigido: a constraint de proveniência source-local impedia revisões sucessivas com a mesma identidade externa; foi substituída por índice não único, preservando cada link append-only.
- Gate atual: PostgreSQL 17 descartável passou forward, restart, rollback, re-forward, ledger F7 real, mutations e candidate decisions atómicos, benchmark e fundação F9 PostgreSQL/pg-boss (2/2). Suite backend: 488/488.
- Findings 2, 6 e 7 continuam abertos: os dois jobs F12 ainda não atravessam o pipeline F9 completo até ao handler funcional; o fluxo F12 não é inspecionado pelos exporters SDK reais; e o upload/scan/metadata F11 persistente não chega à associação F12 num único teste end-to-end.
- Por existirem findings abertos, F12 permanece `In Progress`; não foi criado arquivo, stage, commit, push ou PR.

## Matriz F4/F12 aprovada e implementação retomada

- Aprovado `f12-tenant-operations-v1` com exatamente dez operações tenant: `OPPORTUNITY_PRIVATE_CREATE`, `OPPORTUNITY_PRIVATE_GET`, `OPPORTUNITY_PRIVATE_LIST`, `OPPORTUNITY_PRIVATE_UPDATE`, `OPPORTUNITY_PRIVATE_ARCHIVE`, `OPPORTUNITY_PRIVATE_RESTORE`, `OPPORTUNITY_DUPLICATE_REVIEW`, `OPPORTUNITY_DUPLICATE_SCAN_JOB`, `OPPORTUNITY_CATALOG_RECONCILE_JOB` e `OPPORTUNITY_DOCUMENT_BIND`.
- Aprovadas as capabilities cumulativas `F9_ASYNC_EXECUTION`, `F7_AUDIT_LEDGER`, `F11_PRIVATE_DOCUMENT_STORAGE`, `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE` e `F12_DEDUPLICATION`, preservando `TENANT_CONTROL_BASELINE`.
- Compatibilidade F12 exclusivamente com `004_f12_opportunity_catalog` em `COMPATIBLE`; nenhuma entrada F12 é compatível com `003`, N-1 ou `READ_ONLY`.
- A implementação integra o manifest F4 tenant `000`–`004`, fingerprints físicos e publicação cumulativa de capabilities; o preflight passa a observar os schemas funcionais correspondentes e falha fechado perante capability/objeto/grant/RLS/fingerprint divergente.
- O executor F4 passa a abrir transação explícita `READ ONLY` ou `READ WRITE` em `COMPATIBLE`, fixa `statement_timeout`, impede controlo transacional pelo query module, valida inputs/resultados/limites e revalida membership, snapshot, deadline e fence antes do commit.
- `requiredPermission` mantém o nome existente, mas é validado atomicamente como operation code F5 e com efeito coerente. Os adapters internos autorizam em F5 antes de resolver F4; jobs e binding têm caminhos próprios e o caller não escolhe operation/module.
- A pesquisa aprovada permanece em `context/research/f12-f4-tenant-operation-matrix.md`; F12-D1–F12-D32 não foram alteradas.
- Validação executada: 46/46 testes focados da matriz/executor/catalog/manifest; suite F12 37/37; suite backend 488/488; `node --check` dos módulos alterados; gate F4.3 baseline e gate PostgreSQL 17 F12 descartável passaram. O gate cumulativo provou fisicamente `000–004`, fingerprints e progressão de 1/2/3/4/7 capabilities; o gate F12 repetiu forward, restart, rollback/re-forward, atomicidade F7, isolamento, F9 foundation e benchmark sem falhas.
- Candidate decisions passaram a usar lock de par canónico, idempotency digest/record e, quando existe writer F7 real, evento crítico na mesma transação; retry devolve a projeção anterior e digest divergente falha fechado.
- Permanecem findings verticais: os dois jobs F12 ainda não atravessam o pipeline F9 completo até aos handlers F12; F10 ainda não observa esse pipeline F12 por exporters SDK reais; e o binding F11/F12 continua provado por double, sem fluxo persistente completo de upload/scan/metadata/associação no mesmo gate. Consequentemente F12 permanece `In Progress`, sem snapshot de Review, arquivo ou integração Git.

## Fronteiras locais F12 aprovadas

- Aprovada a pesquisa `context/research/f12-local-integration-boundaries.md`: o fecho local usa uma composition factory F12 fechada e injetável, sem antecipar F4.4/F4.5 ou composition root produtivo.
- F5 usa service, policy engine e catálogos reais com `AuthorizationDataPort` in-memory fechado, imutável e versionado; persistence produtiva F5 permanece gate futuro.
- PostgreSQL/F3/F4/F7/F9, `pg-boss`, SDK/exporters in-memory F10, metadata/services F11 e repositories F12 permanecem reais no gate. Credential provider F4, storage/scanner F11, clocks/RNG e exporters in-memory são as únicas fronteiras sintéticas aprovadas.
- Os handlers F12 pertencem a uma factory local de registry/worker; registry e entrypoints produtivos permanecem vazios/fail-closed.
- Confirmada como lacuna F12 a associação física F11↔F12. A migration tenant ainda não integrada `004_f12_opportunity_catalog` passa a materializar `opportunity_catalog.opportunity_document_binding`; não será criada migration `005`.
- Esta aprovação permite satisfação local dos critérios mediante gate descartável, sem alegar prontidão produtiva, rollout, deploy, providers reais ou dados reais.
- Implementada a tabela tenant-local append-only `opportunity_catalog.opportunity_document_binding` em `004`, com RLS organizacional, FKs F11/F12, CAS, idempotência, digest interno, grants mínimos e evento F7 no mesmo client/transação. O gate PostgreSQL 17 comprovou binding e retry idempotente, rollback/re-forward e preflight cumulativo `000–004`.
- Criada a factory local fechada `createF12LocalComposition`, com dez módulos F4 por identidade e registry local dos dois jobs, preservando a registry produtiva vazia. A composição estrutural passa; a execução vertical outbox→relay→pg-boss→worker→F5→F4→F12/F7 e a inspeção F10 continuam pendentes e não são alegadas como concluídas.
- Validação desta ação: gate PostgreSQL 17 descartável passou; 117/117 testes F12/F4/F5/F7/F11 diretamente afetados passaram. O gate mediu oito operações tenant PostgreSQL reais com warmup 5/dataset 12 e zero falhas, sem inferência de SLO.
- Aprovada integralmente a pesquisa `context/research/f12-job-orchestration-decisions.md`: scanner tenant com oito blocking keys exatas, ordem por prioridade+UUID, `LIMIT 33`/32 resultados, cursor interno na idempotency key, persistência condicional `EXACT|POSSIBLE|DISTINCT`; reconciler limitado a `QUALITY_PROJECTION_DRIFT` e `DUPLICATE_CANDIDATE_RESCAN_REQUIRED`. A aprovação autoriza os índices funcionais em tenant `004`, orchestration e gate vertical local, sem ampliar migrations, permissions, capabilities ou eventos.
- Implementada a semântica fechada dos orchestration services F12: cursor `f12ds1` ligado a scope/source/revision/rule, seleção bounded `LIMIT 33`, classificação posterior à seleção, continuação interna, persistência condicional de candidatos, reparação CAS exclusiva da projeção de qualidade e enqueue idempotente do rescan. A migration tenant `004` inclui índices funcionais dos oito blocks; checksum `50ed1b6a6b3cd1377f06694c92690952bdeba642e68034dcf0674bdc6c40b7cd` e fingerprint físico `b5a3cc76a732394326d9464a7c52ef6eddaa523882ea96f2aed05dcffb4482d4`.
- Gate PostgreSQL 17 descartável repetido com forward, preflight cumulativo, restart, rollback/re-forward, F7 atómico, scanner query, quality reconcile, document binding, benchmark e fundação F9/pg-boss: passou. O gate ainda não atravessa um processador worker F12 real desde a row outbox/queue/inbox até à factory local F5/F4/F12/F7; portanto AC-22/AC-23 e o fecho formal permanecem bloqueados, sem promoção a `Review`.
- Implementado `async/workerProcessor`: normaliza deliveries pg-boss, valida envelope/registry, usa inbox persistente como barreira, executa exclusivamente via `WorkerLifecycle`, exige owner/fence nas transições, confirma a queue apenas depois de inbox `COMPLETED` e converge redelivery após perda do ack. O probe PostgreSQL 17 atravessou pg-boss real, inbox real, registry e span consumer F10; 3/3 testes PostgreSQL F9 passaram. A composition local F12 está ligada ao mesmo processor/registry e emite span de orchestration, mas ainda falta um único probe persistente que atravesse conjuntamente os componentes reais F5 e F4 antes de AC-22/AC-23 poderem ser fechados.
- Bloqueio confirmado para o último gate vertical: o scanner usa F5 `OPPORTUNITY_DUPLICATE_REVIEW`, cuja permission `opportunity.duplicate.review` é `sensitive` e exige SoD/RECENT_MFA, enquanto `createF12LocalComposition` fixa o service actor com `membershipId: null` e `assuranceEvidence: null`. O authorization service/policy engine real devolve `AUTH_EVIDENCE_MISSING` mesmo com grant sintético e SoD válidos. A própria pesquisa da matriz (linha 252) deixou pendente uma política F5 explícita e restrita para esse service actor. Sem decisão aprovada sobre assurance/membership de service actors, o pipeline real não pode atingir F4/F12/F7; F12 permanece `In Progress` e AC-22/AC-23 continuam abertos.
- Decisão humana posterior resolve o bloqueio por least privilege, documentada em `context/research/f12-f5-service-actor-addendum.md`: `opportunity.duplicate.review` continua humana/sensível; scanner e reconciler recebem respetivamente `opportunity.duplicate.scan`/`OPPORTUNITY_DUPLICATE_SCAN_JOB` e `opportunity.catalog.reconcile`/`OPPORTUNITY_CATALOG_RECONCILE_JOB`, com bindings service-only fechados, grant técnico explícito/versionado, `membershipId` e assurance nulos, zero grants de perfil e reautorização por attempt.

## Gate vertical F5/F9/F10/F12 após addendum service-only

- O catálogo F5 passou a conter 20 operações/permissions totais. As duas novas permissions técnicas, `opportunity.duplicate.scan` e `opportunity.catalog.reconcile`, estão ligadas de forma fechada aos respetivos service actors, job types e operation codes F4; os quatro perfis produtivos continuam com zero grants F12 implícitos.
- Os testes reais do authorization service/policy engine provam allow com concessão técnica explícita, deny sem grant ou com binding divergente, deny para HUMAN/SUPPORT, suspensão e revogação no attempt seguinte, e preservação de `RECENT_MFA` para `opportunity.duplicate.review` humana.
- O gate PostgreSQL 17 descartável atravessou, para scanner e quality reconciler, `outbox -> OutboxRelay -> pg-boss -> workerProcessor -> inbox -> composition.jobs -> F5 -> F4 -> F12/F7 -> inbox complete -> queue complete`. Resultado observado: 2 jobs, 2 inboxes `COMPLETED`, 5 eventos F7 relevantes e spans `send async_job`, `process async_job` e `execute opportunity job` para ambos.
- O gate repetiu manifest cumulativo `000-004`, forward, preflight, restart, rollback/re-forward, atomicidade F7 e benchmark PostgreSQL. A imagem observada foi `postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`; o container e volume descartáveis foram removidos.
- Findings corrigidos durante o gate: resolução portável do pacote `pg-boss` no probe; projeção fechada do contexto F3 para o resolver F4; UUIDv7 para correlation/causation F7; e cast explícito do estado enum na transição parametrizada do inbox.
- Validação após o gate: suite F12 47/47; regressão F5/paridade 29/29; testes focados worker+service authorization 12/12; `node --check` de todos os JS alterados/novos e `git diff --check` passaram. Index continua vazio.
- A revisão formal ainda não foi iniciada: o probe conjunto atual comprova os caminhos felizes do scanner e de `QUALITY_PROJECTION_DRIFT`, mas ainda não incorpora no mesmo caminho persistente as provas obrigatórias de `DUPLICATE_CANDIDATE_RESCAN_REQUIRED`, retry/redelivery/replay, isolamento A/B e todos os fail-closed negativos. F12 permanece `In Progress`.

## Bloqueio do gate adversarial final

- A tentativa de ampliar exclusivamente o probe confirmou que o caminho feliz vertical é real, mas três interfaces necessárias às provas adversariais não têm implementação persistente utilizável pela composition F12.
- `createWorkerProcessor` recebe `retryPort`, porém a composition/gate não fornece um port aprovado; com `pg-boss` em `retryLimit: 0`, um `RETRYABLE` sem esse port termina em `PERMANENT` (`backend/src/async/workerProcessor.js:38-42`).
- `replayEnvelope` cria corretamente novo `executionId`, mas não existe replay service/port que persista e publique a nova execução. O adapter pg-boss normaliza todas as deliveries com `replay:false`, pelo que não é possível provar link de replay real sem inventar metadata/protocolo (`backend/src/async/deadLetter.js:5`; `backend/src/async/adapters/pgBossQueueAdapter.js:5-10`).
- O reconciler recebe apenas um `scanIntentPort.enqueue` abstrato. No gate atual esse port é um no-op sintético; não recebe o client F4 e não consegue provar outbox + `OPPORTUNITY_RECONCILIATION_REQUIRED` na mesma transação (`backend/src/opportunities/jobOrchestration.js:86-90`; `test/integration/f12/vertical-jobs.js:23`).
- O histórico F9 aprovou `deadLetterService`, `replayService`, `ReplayAuthorizationPort` e retry/reconciliação persistentes, mas esses componentes não existem no código atual. Criar adapters ad hoc dentro do teste violaria a proibição de pipeline paralela e produziria evidência falsa.
- Consequentemente as provas de rescan transacional, retry real e replay autorizado não foram executadas; os gates finais e a revisão formal não foram iniciados. F12 permanece `In Progress`, sem stage ou publicação.

## Decisão física F9 ainda necessária

- A releitura integral de F9 confirmou a semântica funcional de retry/replay, mas o schema integrado não consegue representar a metadata confiável agora exigida. `async_exec.execution` guarda `execution_id`, `outbox_id` e `attempt`, mas não guarda `content_digest`, `envelope_digest`, tipo de delivery, execução anterior/root ou pedido de replay. `async_exec.dead_letter` guarda apenas a execução original e `replayed_at`; não identifica a nova execução. A outbox tenant guarda envelope e digest funcional, mas não lineage/attempt.
- A unique key da outbox é `(organization_id, logical_id)`. Reutilizar a mesma logical id com novo `executionId` devolve a linha antiga, pois o digest funcional é igual e o `ON CONFLICT` não substitui o envelope; usar logical ids técnicas distintas resolve a multiplicidade, mas não prova por si só retry versus replay nem a ligação à execução anterior.
- O contrato F9 determina fila/execução global na Central e outbox/inbox source-local. Persistir lineage Central na mesma transação do retry tenant exigiria transação distribuída, explicitamente proibida. Portanto é necessário escolher a autoridade física do lineage e o momento em que a projeção Central é criada/reconciliada.
- Sem essa decisão, alterar o adapter pg-boss para consultar metadata, criar uma migration ou codificar lineage num campo existente seria inferência normativa. A implementação e o gate adversarial ficam suspensos antes de qualquer migration; F12 permanece `In Progress`.

## Compatibilidade F4/F12 pendente após aprovação do lineage F9

- A autoridade source-local, os sete campos, constraints e migrations F9 `007`/`005` foram aprovados. Antes de editar SQL surgiu uma incompatibilidade normativa com a matriz F4/F12 existente: todas as dez operações F12 aceitam exclusivamente `004_f12_opportunity_catalog` em `COMPATIBLE` e recusam N-1.
- Depois de aplicar `005_f9_execution_lineage`, a versão física tenant corrente passa a `005`. Sem alterar a matriz, todas as operações F12 falham antes de F4 adquirir credencial/pool/SQL; portanto o gate pedido não pode executar.
- Falta decidir se: (a) as dez operações F12 passam a aceitar exclusivamente `005`; (b) apenas `OPPORTUNITY_DUPLICATE_SCAN_JOB` e `OPPORTUNITY_CATALOG_RECONCILE_JOB` exigem `005`, mantendo as restantes em `004|005`; ou (c) outra matriz explícita. A opção também determina se `F9_ASYNC_EXECUTION` continua suficiente ou se o preflight precisa de capability nova para lineage.
- Esta escolha altera compatibilidade/autorização de execução e não pode ser inferida da aprovação física. Nenhuma migration `007`/`005` foi criada ou alterada; F12 permanece `In Progress`.

## Estratégia de upgrade F9 lineage ainda pendente

- A matriz F4/F12 v2 e `F9_EXECUTION_LINEAGE` foram aprovadas, mas a criação de `007/005` encontrou uma decisão normativa de upgrade não coberta: as tabelas F9 integradas podem conter outbox/execution/dead-letter anteriores ao lineage, enquanto os novos `content_digest` e `envelope_digest` são obrigatórios e semanticamente verificáveis.
- PostgreSQL core não fornece SHA-256/JCS compatível sem extensão; instalar `pgcrypto` é proibido pelo baseline. A outbox conserva o envelope e permitiria backfill por código controlado, mas `async_exec.execution` Central não conserva o envelope e não permite reconstruir os dois digests de execuções antigas.
- São necessárias uma de três políticas explícitas: (a) migration exige drenagem/ausência de linhas F9 não terminais e remove ou arquiva a evidência histórica segundo regra aprovada; (b) expand/migrate/contract com colunas inicialmente nullable, backfill por application runner e migration posterior de constraints; ou (c) preservar linhas legacy com discriminator/constraints parciais e proibir retry/replay nelas. Preencher digest com outro valor ou copiar `digest_sha256` para `envelope_digest` violaria o contrato aprovado.
- Nenhuma migration, catálogo v2 ou runtime foi alterado nesta tentativa; F12 permanece `In Progress`.

## Restrições

- Usar apenas dados, actors, organizações, oportunidades, documentos e fontes sintéticos.
- Não consultar ou alterar PostgreSQL em 5432/5433 nem qualquer base persistente.
- Não contactar serviços externos; containers são permitidos apenas como PostgreSQL 17 descartável do gate, em porta distinta de 5432/5433 e com cleanup validado.
- Implementação local autorizada pelas fronteiras aprovadas; F4.4/F4.5, composition produtiva, persistence produtiva F5, providers reais, rollout e deploy continuam proibidos.
- Preservar `.vscode/settings.json` local, inalterado e fora do index.

## Fora do âmbito

- conectores externos, scraping, APIs de terceiros e sincronização real;
- imports Excel/CSV produtivos;
- matching, recomendações, qualificação, candidaturas e pipeline;
- reporting, dashboards finais, exports produtivos e notificações;
- UI final;
- R2, S3, presigned URLs e scanner reais;
- F4.4, F4.5, migração UBI e tenants provisionados;
- dados reais, staging, produção, rollout e deploy;
- eliminação física, retenção jurídica final e legal hold operacional.

## Referências

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/features/opportunity-catalog.md`
- `context/features/matching-and-qualification.md`
- `context/features/application-pipeline.md`
- `context/features/reporting.md`
- `context/features/security-privacy-and-audit-foundation.md`
- `context/decisions/future-data-model.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/references/current-implementation.md`
- históricos F3, F4.0–F4.3, F5, F7, F9, F10 e F11 em `context/history/`
- catálogos e manifests existentes em `backend/src/authorization/`, `backend/src/audit/`, `backend/src/async/`, `backend/src/observability/` e `backend/src/documents/`

## Estado de readiness

F12 está em `In Progress` e não está pronta para fecho. As decisões e migrations permanecem determinadas, mas a revisão formal exige completar a composição real F5/F7/F9/F10/F11 e os respetivos testes end-to-end antes de reavaliar os 32 critérios. O racional de readiness original abaixo é preservado como histórico do arranque:

- F12-D1–F12-D32 foram aprovadas sem incompatibilidade com a arquitetura ou decisões versionadas;
- residência, schema, lifecycle, catálogos, normalização, dedupe, queries, limites e migrations estão definidos sem decisão comportamental local pendente;
- F12-AC-01–F12-AC-32 estão mapeados para evidência automatizada, probes e gates concretos;
- a implementação local não depende de F4.4/F4.5, Legacy/UBI, providers externos ou dados reais;
- as migrations propostas foram reconfirmadas como Central `006_f12_opportunity_catalog` e tenant `004_f12_opportunity_catalog`, com execução futura exclusivamente em PostgreSQL 17 descartável;
- permanecem preservados os gates jurídicos, operacionais, de integração e de produção externos.
## F12 — replay repository Central (2026-10-10)

- Implementados `ReplayRequestRepository` e writer F7 Central transacional para request/approval/reservation/consume e leitura de reconciliação.
- Estados fechados: `REQUESTED → APPROVED → RESERVED → CONSUMED`; trigger PostgreSQL impede regressão, salto ou mutação de identidade, approval e reserva.
- Probe PostgreSQL 17 descartável: request/approval/eventos F7 atómicos, idempotência, conflito de digest, SoD, reserva one-shot, consumo idempotente e rollback integral em falha F7 passaram.
- Checksum Central `007_f9_execution_lineage`: `f4d4712428c42e4625ba9cdcc202d6a7561b8c2576f0d7e41f097a18fe6d4bf6` após fechar enum e trigger de replay request. RetryPort, replay service/saga, claim metadata, scan intent e gate vertical permanecem pendentes; F12 continua `In Progress`.

## F12 — RetryPort persistente F9 (2026-10-10)

- Implementado `createPersistentRetryPort` sobre a outbox source-local lineage v1 e ligado ao `workerProcessor` na mesma transação da transição `UNCERTAIN` do inbox.
- Retry cria `delivery_kind=RETRY`, incrementa attempt até 5, preserva root/content/idempotency/correlation/causation, recalcula envelope digest e usa full jitter/deadline já fechados pelo F9.
- Repetição consulta primeiro a transição durável e devolve o execution ID existente sem consumir nova identidade. Probe PostgreSQL 17 provou rollback atómico, uma única row retry e pg-boss `retryLimit: 0`; regressões focadas: 56/56.

## F12 — replay service e reconciliação F9 (2026-10-10)

- Implementado `createReplayService` para request e approval humanos autorizados, reserva Central one-shot, criação source-local da outbox `REPLAY` e evento F7 crítico, consumo Central e reconciliação `RESERVED → CONSUMED`.
- Implementados o port tenant fechado e o writer F7 tenant-local. O client PostgreSQL permanece interno; a outbox e `ASYNC_REPLAY_EXECUTION_CREATED` participam na mesma transação tenant e a reconciliação reutiliza o execution ID reservado.
- Probe PostgreSQL 17 descartável na porta 5551 comprovou request/approval Central, reserva, uma outbox replay, um evento tenant, falha simulada depois do efeito source-local, convergência para `CONSUMED` e reexecução idempotente sem segunda outbox/evento. Imagem: `postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`; container e volume removidos.
- Testes focados e regressões F5/F7/F9/F12 afetadas: 59/59, zero skipped/TODO. `node --check` dos ficheiros tocados passou. O replay service ainda deve ser ligado à composition local e ao gate vertical adversarial; F12 continua `In Progress`.

<!-- F12 promovida a Review em 2026-10-10; não arquivar sem aprovação explícita. -->

## F12 — gate adversarial e revisão formal concluída (2026-10-10)

- Corrigido o fingerprint físico tenant `005_f9_execution_lineage`, a ordem do gate cumulativo e a compatibilidade dos probes após lineage v1.
- `DUPLICATE_CANDIDATE_RESCAN_REQUIRED` cria agora outbox lineage v1 e `OPPORTUNITY_RECONCILIATION_REQUIRED` na mesma transação F4/F12/F7; o scan gerado atravessa relay, pg-boss, worker, inbox, F5, F4 e F12.
- A migration tenant `005` concede ao runtime F12 apenas `USAGE` no schema F9 e `SELECT,INSERT` na outbox; preflight prova a concessão e recusa privilégios destrutivos.
- Retry persistente provado com rollback, lineage, attempt 2 e idempotência. Perda de confirmação foi provada com pg-boss e inbox persistentes: a entrega repetida converge para `DUPLICATE` sem segundo efeito.
- Replay autorizado, recusa sem grant, linkage F10, A/B, IDOR, digest, schema, capability e drift permanecem cobertos pelos gates focados e cumulativos.
- Corrigida a migration Central `007` para deixar o controlo transacional ao runner e atualizados os checksums. A paridade produtiva reconhece as 22 operações/permissions após o addendum de replay.
- Validação final: suite backend `514/514`; gate PostgreSQL 17 completo; benchmark com zero falhas; `node --check` em todos os 94 ficheiros JavaScript alterados/não rastreados; `git diff --check` sem erro.
- O probe persistente F11→F12 atravessa agora `createUploadService`, capability one-shot, storage de quarentena aprovado, metadata PostgreSQL tenant-local, enqueue de scan, `createScanService` e binding F12. Prova recusa do binding antes de `AVAILABLE/CLEAN`, falha de scanner mantendo `SCANNING`, isolamento A/B, rejeição de redelivery da capability consumida e binding idempotente.
- Findings corrigidos no adapter F11 durante o probe: as funções `SECURITY DEFINER` recebem contexto tenant em transação própria e `expected_size` é projetado como inteiro seguro para o storage port. Não permanecem findings locais F12 abertos; estado promovido a `Review`, sem arquivo, stage, commit ou publicação.

### Matriz formal F12-AC

| Critério | Resultado | Evidência | Observação |
|---|---|---|---|
| F12-AC-01 | PASS | `gate.js`, migrations Central 006 | Identidade/residência Central. |
| F12-AC-02 | PASS | `gate.js`, tenant 004 | UUID e residência tenant. |
| F12-AC-03 | PASS | repositories separados e gate | Autoridade source-local. |
| F12-AC-04 | PASS | `f12OpportunityDomain.test.js` | Contratos fechados. |
| F12-AC-05 | PASS | testes de input adversarial | Unknown/prototype recusados. |
| F12-AC-06 | PASS | gate e revisões/proveniência | Proveniência imutável. |
| F12-AC-07 | PASS | `legacy-lineage-upgrade.js`, gate PostgreSQL 17 | Upgrade preserva `attempt`, retry, dead letter e outbox publicada em lineage v0. |
| F12-AC-08 | PASS | lifecycle unitário e PG17 | Transições fechadas/CAS. |
| F12-AC-09 | PASS | `atomic-mutations.js` | Arquivo/restauro sem delete. |
| F12-AC-10 | PASS | qualidade unitária e reconcile PG | Determinística/versionada. |
| F12-AC-11 | PASS | corpus de normalização | NFC e versões preservadas. |
| F12-AC-12 | PASS | dedupe unitário e scanner PG | Reproduzível/explicável. |
| F12-AC-13 | PASS | matriz `EXACT/POSSIBLE/DISTINCT` | Incerteza não promove merge. |
| F12-AC-14 | PASS | constraints e scans estruturais | Sem merge/delete destrutivo. |
| F12-AC-15 | PASS | retry/redelivery/replay PG17 | Um efeito lógico e digest fechado. |
| F12-AC-16 | PASS | CAS e concorrência no gate | Lost update recusado. |
| F12-AC-17 | FAIL | segunda revisão humana 2026-10-10 | A identidade LOGIN produtiva do pool tenant não está definida por F4/F4.4; o probe anterior usou superuser. |
| F12-AC-18 | PASS | resource loading e IDOR | Existência não revelada. |
| F12-AC-19 | PASS | F5 real nos jobs verticais | Deny-by-default e códigos fixos. |
| F12-AC-20 | PASS | testes F5 service/human | MFA/SoD e zero grants de perfil. |
| F12-AC-21 | FAIL | segunda revisão humana 2026-10-10 | Reavaliação pendente: repository F11 não participa ainda no client/transação externa F4. |
| F12-AC-22 | PASS | `legacy-lineage-upgrade.js`, `vertical-jobs.js`, `retry-port.js` | Lineage v0 conserva evidência histórica; novas execuções, retry e replay mantêm lineage v1 verificável. |
| F12-AC-23 | PASS | spans SDK in-memory no vertical | Parent/link e labels fechados. |
| F12-AC-24 | FAIL | segunda revisão humana 2026-10-10 | Role/RLS produtivos e atomicidade externa F11/F12 ainda não provados. |
| F12-AC-25 | PASS | query/cursor/filter/benchmark | Bounds e cursor fechado. |
| F12-AC-26 | PASS | scans SQL e gate | SQL parametrizado/identifiers fixos. |
| F12-AC-27 | PASS | `tenant-manifest-gate.js`, gate PostgreSQL 17 | Runner recusa drift, gap e estado incompatível; upgrades por prefixo 003/004 convergem para 005. |
| F12-AC-28 | FAIL | segunda revisão humana 2026-10-10 | Validator estrutural incompleto e rollback de dados legacy 004→005 ainda não provado. |
| F12-AC-29 | FAIL | segunda revisão humana 2026-10-10 | Gate F11 anterior privilegiado e suite canónica dependente de ambiente. |
| F12-AC-30 | PASS | scans estruturais | Núcleo sem UBI/Legacy. |
| F12-AC-31 | PASS | fixtures e targets guardados | Apenas ambiente sintético. |
| F12-AC-32 | FAIL | segunda revisão humana 2026-10-10 | Proteção contra comandos transacionais top-level e checksum histórico 001 sem cobertura completa. |

## F12 — remediação da revisão humana (2026-10-10)

- Estado preservado em `Review`; a aprovação humana foi retirada até nova revisão.
- Findings confirmados: transação interna em tenant `005`; ausência de upgrade incremental no runner; probe F11 executado como administrador em vez do role RLS; e perda de `attempt` nas execuções F9 legacy.
- Sequência aprovada: restaurar ownership transacional do runner e provar rollback/retry; implementar upgrades por prefixo íntegro; executar F11 sob `c4g_document_runtime`; preservar histórico lineage v0; repetir gates e rever AC-07/17/22/24/27/28/29/32.
- Regra aplicada nesta iteração: os oito critérios permaneceram `FAIL` até à conclusão dos probes persistentes; nenhum resultado foi restaurado apenas por leitura estática.

### Resultado da remediação

- Atomicidade: removido o controlo transacional interno de todas as migrations tenant; o runner mantém o advisory transaction lock durante SQL, fingerprint, ledger e commit. O probe de falha entre SQL e ledger confirmou rollback integral, ledger no ordinal anterior, ausência do DDL novo e retry posterior bem-sucedido.
- Upgrade incremental: o runner valida o ledger como prefixo canónico e aplica apenas migrations pendentes. Passaram instalação vazia→005, 003→004→005, 004→005, commit incerto reconciliado, gap, drift, concorrência e segunda execução idempotente. O gate deixou de aplicar SQL diretamente como administrador.
- F11/RLS: todas as operações tenant do repository abrem transação própria, definem `SET LOCAL ROLE c4g_document_runtime` e `app.organization_id` na mesma ligação, e usam somente esse client. O probe A/B cobre acesso próprio, IDOR, capability one-shot, enqueue/scan, falha do scanner, CLEAN, binding e redelivery.
- F9 legacy: adotada a política conservadora lineage v0. `attempt`, retries, dead letters e outbox `PUBLISHED` são preservados; constraints parciais mantêm invariantes estritos para lineage v1, sem inventar digests históricos. A down migration recusa lineage moderno e preserva fixtures legacy quando suportada.
- Evidência: regressões F7/F9/F11/F12 `119/119`; suite backend com configuração sintética `515/515`; gate PostgreSQL 17 completo; benchmark local com zero falhas (baseline local, não SLO); `node --check` em 95 ficheiros; `git diff --check` sem erros.
- Os AC-07/17/22/24/27/28/29/32 regressam a `PASS` apenas com base nos probes persistentes acima. F12 permanece em `Review` e requer nova revisão humana; não foi arquivada nem publicada.

## F12 — replay ligado à composition e gate vertical (2026-10-10)

- `createF12LocalComposition` passou a construir opcionalmente o replay service autorizado contra a própria registry `composition.jobs`; a composition produtiva continua sem o ligar e permanece fail-closed.
- O relay projeta lineage v1 idempotentemente na Central antes de publicar, e o adapter pg-boss deriva `INITIAL`/`RETRY`/`REPLAY` e redelivery da projeção Central validada, recusando divergências de identidade ou digest.
- Gate PostgreSQL 17 descartável na porta 5552 atravessou `outbox tenant → projeção Central → OutboxRelay → pg-boss → workerProcessor → inbox → composition.jobs → F5 → F4 → F12/F7 → complete`. Foram observados três jobs completos, incluindo replay autorizado; um pedido sem grant foi recusado, a repetição do replay não criou segunda execução, houve um único `ASYNC_REPLAY_EXECUTION_CREATED` e o consumer span do replay usou `LINK`.
- O primeiro probe revelou uma outbox original sintética incorretamente ainda `PENDING`; o fixture foi corrigido para representar uma execução terminal antes do replay. O segundo probe passou e removeu o container/volume. F12 permanece `In Progress`; retry, redelivery e a matriz adversarial integral continuam para o gate final.
## F12 — remediação da segunda revisão humana (2026-10-10)

- O contrato F4 foi revisto até ao provisioning: `credential_ref` é deliberadamente opaca e os roles funcionais `c4g_tenant_runtime`, `c4g_document_runtime` e `c4g_opportunity_tenant_runtime` são `NOLOGIN`. Não existe decisão canónica que identifique o principal `LOGIN` do pool nem os memberships que lhe permitem `SET ROLE`; F4.4/provisioning produtivo permanece fora do âmbito implementado. Não foi criado um utilizador produtivo arbitrário nem concedido owner, migrator, superuser ou `BYPASSRLS`.
- Alternativas que exigem decisão explícita: (A) conceder diretamente ao principal referido por cada `credential_ref` apenas os roles funcionais necessários, com `SET OPTION`; (B) conceder-lhe apenas `c4g_tenant_runtime` e fazer desse role o agregador explícito dos roles funcionais. Ligar diretamente como `c4g_document_runtime` contradiz o contrato atual `NOLOGIN` e não resolve a composição com F12.
- O repository F11 passou a separar primitivas sobre client preparado (`withClient`) de wrappers autónomos. A rota preparada não adquire ligação nem executa `BEGIN`, `COMMIT`, `ROLLBACK` ou `release`; valida `organizationId` e prepara role/contexto na mesma ligação. A rota autónoma é a única proprietária da ligação e boundary. O teste unitário `F11 repository external client owns transaction while standalone wrapper owns its boundary` passou, mas falta o probe PostgreSQL F4/F11/F12 com rollback externo e, por isso, AC-21/AC-24 não regressam a PASS.
- A proteção estrutural de migrations foi centralizada em `sqlTransactionControl.js` e reutilizada pelo manifest e pelo tenant lease executor. A tokenização ignora comentários, strings, identificadores e corpos dollar-quoted, rejeitando todos os comandos transacionais top-level previstos no contrato em `up` e `down`. O checksum histórico exato de `001` é aceite; qualquer outro é recusado.
- O probe canónico `tenant-manifest-gate.js` para 004→005 passou a semear inbox COMPLETED e outbox PUBLISHED legacy, comparar as linhas exatamente após falha entre SQL e ledger, provar ausência de tipos/colunas/índices/constraints 005, manter ledger em 004 e depois provar retry para 005 sem perda dos mesmos registos.
- O pool global passou a inicialização lazy. `npm test` foi executado diretamente depois de remover `DATABASE_URL` e todas as variáveis `DB_*`, sem `backend/.env`: 518/518 PASS. Os testes PostgreSQL continuam separados e exigem alvo descartável explícito.
- Gate PostgreSQL 17 descartável: manifest/runner, forward/restart, F9, legacy lineage, jobs, retry, integração, atomic mutations e benchmark local passaram. A imagem observada foi `postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`; contentor e volume foram removidos. O gate F11 existente usa o administrador descartável e `SET LOCAL ROLE`; não constitui prova do principal LOGIN produtivo.

| Critério reaberto | Estado | Evidência desta iteração | Razão/risco residual |
|---|---|---|---|
| F12-AC-03 | PASS | gate PostgreSQL 17 completo; repositories source-local separados | Sem alteração do contrato de autoridade; risco de composição externa coberto em AC-21/24. |
| F12-AC-17 | FAIL | role/contexto exercitados, mas sessão do gate é administrativa | Principal LOGIN e membership produtivos não estão definidos. |
| F12-AC-21 | FAIL | teste unitário prova contrato do client externo | Falta probe persistente de duas mutações e rollback/commit sob a lease F4. |
| F12-AC-24 | FAIL | gate F11→F12 funcional passou sob `SET LOCAL ROLE` | Não prova LOGIN não privilegiado nem atomicidade externa F4/F11/F12. |
| F12-AC-28 | PASS | scanner estrutural completo e probe 004→005 com dados legacy | Checksum histórico é allowlist estreita, sem normalização arbitrária. |
| F12-AC-29 | FAIL | PostgreSQL 17 descartável passou; `npm test` limpo 518/518 | Gate RLS ainda usa sessão administrativa. |
| F12-AC-32 | PASS | testes top-level `up/down`, PL/pgSQL válido e checksum histórico 001 | O runner permanece único proprietário das transactions das migrations. |

F12 permanece `Review / Needs changes`. Para concluir os findings dependentes, é necessária uma decisão canónica sobre o principal LOGIN/membership F4; depois devem ser implementados o provisioning/upgrade e os probes persistentes não privilegiados e de rollback externo.

## F4.4 local — identidade PostgreSQL por workload (2026-10-10)

- A decisão aprovada foi implementada apenas no âmbito local/descartável. A representação aditiva usa `(tenant_id, workload, connection_version)`, com workload fechado `API|WORKER`, estado, `credential_ref`, fence e `binding_digest` independentes. A migration `008_f44_tenant_workload_identity` não faz backfill: registos tenant-level existentes são ambíguos e exigem reconciliação explícita.
- Resolver, catálogo de operações, provider, pool manager, leases, circuit breakers, fencing e drain transportam o workload. Aquisição sem workload ou com credential lease incompatível falha fechada. As operações HTTP/catalog usam `API`; jobs de scan/reconcile usam `WORKER`.
- O harness local cria LOGINs sintéticos distintos e os agregadores canónicos `c4g_tenant_api_capabilities` e `c4g_tenant_worker_capabilities`. Todos os elos observados têm `SET TRUE`, `INHERIT FALSE`, `ADMIN FALSE`; LOGINs têm `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE` e `NOREPLICATION`. Owner, migrator e `c4g_tenant_runtime` não são associados. O harness deteta atributos, memberships adicionais e ownership divergentes e elimina roles/credenciais sintéticos no cleanup.
- O probe PostgreSQL liga funcionalmente com os LOGINs, confirma `session_user`, `current_user`, `pg_has_role(...,'SET'|'USAGE')`, `pg_auth_members`, tentativas cruzadas recusadas e limpeza de role/contexto após rollback. O LOGIN API recebeu apenas as allowlists locais comprovadas (`c4g_document_runtime` e `c4g_opportunity_tenant_runtime`); o LOGIN WORKER recebeu `c4g_opportunity_tenant_runtime`. Isto não constitui provisioning produtivo.
- O probe externo usa uma ligação/transação do LOGIN API, regista o mesmo backend PID e transaction ID, executa mutações F12 e F11 por `withTransactionClient`/`withClient`, prova rollback integral e depois commit integral. `row_security_active(...)` é verdadeiro; uma query sem `WHERE organization_id` só vê A apesar de existir uma linha B, e escrita cruzada é recusada pela policy.
- Evidência final: testes focados pool/F4.4 `41/41`; suite backend sem `DATABASE_URL` nem `DB_*` `523/523`; gate PostgreSQL 17 completo; benchmark local sem falhas (baseline, não SLO); `node --check` em 110 ficheiros JavaScript; `git diff --check` sem erros. Imagem observada: `postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`; nenhum container ou volume do gate permaneceu.
- Permanecem fora do âmbito/autorização: provisioner produtivo F4.4, rollout, reconciliação de registos legacy ambíguos, secret manager real, nomes físicos e connection limits produtivos. F12 permanece em `Review` e requer nova revisão humana.

| Critério reaberto | Estado | Evidência verificável | Risco residual |
|---|---|---|---|
| F12-AC-17 | PASS | `workload-identity.js`: LOGINs não privilegiados, memberships exatas, RLS ativo, query A/B sem filtro e escrita cruzada recusada | Prova exclusivamente descartável; rollout real não autorizado. |
| F12-AC-21 | PASS | probe externo: F11+F12 no mesmo PID/XID, rollback sem efeitos e commit integral; gates F7 reais anteriores permanecem verdes | Provisioning produtivo continua pendente. |
| F12-AC-24 | PASS | `withClient` F11 sob LOGIN API, contexto tenant na mesma transação; gate funcional mantém capability, quarentena, scan, CLEAN, binding, retry e idempotência | Scanner/object storage continuam doubles locais autorizados. |
| F12-AC-29 | PASS | gate PostgreSQL 17 descartável completo sob LOGINs funcionais, RLS A/B, restart e cleanup; suite limpa `523/523` | Não é evidência de produção ou staging. |

Estado mantido: `Review`. A evidência permite reabrir os quatro critérios para revisão, mas a iteração permanece `Needs changes`: o diretório F4.4 ainda não possui o writer canónico de publicação/rotação por workload, e faltam probes persistentes de candidate incompatível, fence/drain de pools antigos, `SET FALSE` em cada elo e contexto após commit. Não houve aprovação ou arquivo automático.

## F4.4 local — writer, rotação e probes finais (2026-10-10)

- Estado F12 preservado em `Review / Needs changes` durante toda a implementação. O âmbito continua exclusivamente local e descartável; não existe provisioner produtivo, rollout ou secret manager real.
- `tenantWorkloadDirectoryRepository` é o writer/reader canónico. `createCandidate` grava uma intenção digestada; retries iguais convergem e payload divergente conflita. `validateCandidate` só permite `CANDIDATE → VALIDATED` com `COMPATIBLE/READY` ou `CANDIDATE → FAILED`. `publishCandidate` bloqueia binding e versões, aplica CAS sobre fence/versão corrente, muda a anterior para `DRAINING`, publica uma única `AVAILABLE` e incrementa o fence atomicamente. `markDrained` aceita apenas `DRAINING → REVOKED` e é idempotente.
- A migration Central `008_f44_tenant_workload_identity` permanece aditiva e sem backfill. Acrescenta digest da intenção, revision, timestamps de validação/publicação/drain/revogação e failure code sanitizado; não guarda connection strings, passwords ou nomes físicos de LOGIN.
- O lifecycle local resolve e valida a credential candidata antes do cutover. Publicação ocorre antes do drain apenas depois de identidade, workload e binding serem compatíveis. Depois do cutover, novas leases antigas são recusadas, o pool anterior drena, a credencial anterior é revogada e só então a versão passa a `REVOKED`. Falha de revogação mantém a versão anterior em `DRAINING`; retry da mesma intenção reconcilia sem reduzir fence ou reabrir a versão.
- O pool manager conserva fence e versão publicada por `(tenant_id, workload)`. Reconstrução sincroniza ambos a partir do diretório persistente; uma versão anterior não pode readquirir pool depois de restart. API e WORKER mantêm pools, fences e circuit breakers separados.
- Probes de writer/lifecycle em PostgreSQL 17: candidata, retry idempotente, conflito de conteúdo, rollback injetado entre insert/commit, publicação, CAS concorrente (uma publicação e um conflito), rotação API preservando WORKER, rotação WORKER preservando API, lease antiga antes do cutover, recusa posterior, drain com lease ativa, fecho físico, nova lease, restart e reconciliação de falha pós-cutover passaram.
- Candidatas incompatíveis exercitadas pelo validator e writer canónicos: `SUPERUSER`, `BYPASSRLS`, ownership de objeto, membership owner, agregador errado/path cruzado, `SET FALSE` em ambos os elos, `INHERIT TRUE`, `ADMIN TRUE`, role funcional ausente, digest divergente, workload divergente e identidade partilhada. Todas ficaram `FAILED/INCOMPATIBLE`; versão/fence/pool/credential correntes permaneceram inalterados e o erro funcional foi sanitizado.
- Para API e WORKER, os probes alteraram separadamente LOGIN→agregador e agregador→role funcional para `SET FALSE`, confirmaram `pg_auth_members`, `pg_has_role(...,'SET')=false`, recusa de `SET LOCAL ROLE` e ausência de `USAGE`; depois restauraram exatamente `SET TRUE, INHERIT FALSE, ADMIN FALSE` e repetiram o fluxo com sucesso. Paths cruzados, owner e migrator foram recusados sob LOGIN não privilegiado.
- Um pool real `max=1` provou reutilização do mesmo backend PID depois de `COMMIT` e `ROLLBACK`: `current_user=session_user`, `app.organization_id` vazio e query funcional sem nova preparação recusada. Foram ainda exercitados erro de preparação, erro de operação, release após exceção, nova preparação tenant e pools físicos distintos para API/WORKER.
- Segurança/transação revalidadas: LOGINs não privilegiados, agregadores sem grants/ownership, RLS A/B numa query sem filtro, PID/XID único nas mutações compostas F11/F12, rollback externo integral e commit integral. O scan do diff não encontrou as credenciais/segredos conhecidos nem connection strings com password.

### Evidência final desta iteração

- Testes focados F4.4/pools/resolver: `57/57 PASS`.
- Suite backend canónica em ambiente sem `DATABASE_URL` e sem `DB_*`: `523/523 PASS`.
- Gate PostgreSQL 17 descartável: PASS para manifest/upgrade, writer/lifecycle, identity, membership/context, restart, F9, legacy lineage, jobs, retry, F11/F12, RLS e benchmark.
- Benchmark local: zero falhas; baseline loopback, não SLO nem sizing produtivo.
- `node --check`: 114 ficheiros JavaScript alterados/não rastreados.
- `git diff --check`: sem erros; apenas avisos locais de conversão LF/CRLF.
- Cleanup confirmado: zero containers e volumes `c4g-f12-gate-*`; LOGINs e memberships sintéticos existiram apenas dentro do container removido.

| Critério | Estado reavaliado | Evidência | Limitação residual |
|---|---|---|---|
| F12-AC-17 | PASS | LOGINs API/WORKER não privilegiados, RLS A/B sem filtro, paths cruzados/owner/migrator recusados, candidatas incompatíveis fail-closed | Prova local descartável; não autoriza rollout. |
| F12-AC-21 | PASS | fluxo composto F11/F12 no mesmo PID/XID, rollback e commit integrais; lifecycle/fence persistentes | Provisioning produtivo continua inexistente e fora do âmbito. |
| F12-AC-24 | PASS | F11 `withClient`, LOGIN API, contexto tenant renovado, limpeza commit/rollback e gate capability/quarentena/scan/CLEAN/binding | Storage e scanner permanecem doubles locais autorizados. |
| F12-AC-29 | PASS | gate PostgreSQL 17 completo, restart a partir de fence/versão persistidos, suite limpa e cleanup | Não constitui evidência de staging/produção. |

Limitações produtivas restantes: nomes físicos, connection limits, secret provider, operação/alertas F4.4 e rollout continuam por decidir/implementar fora desta autorização. Não são defeitos da fundação local validada. Recomendação: `F12 pronta para nova revisão humana`, mantendo o estado formal em `Review` e sem arquivo.

## Iteração corretiva após terceira revisão humana — 2026-10-10

- Estado preservado em `Review / Needs changes`; AC-17, AC-21, AC-24, AC-27, AC-28, AC-29 e AC-32 permanecem `FAIL` até todos os gates voltarem a passar.
- Corrigidos localmente: propagação estrita de workload no resolver; circuit breaker por `(tenant, workload, connection_version)`; idempotência do writer após publicação; migration Central 008 integrada no manifest/runner cumulativo 000–008; rollback SQL→ledger e retry; constraints de estado, unicidade `AVAILABLE`, intenção imutável e revision/fence monotónicos; down conservador; validator executado na base tenant pelo lifecycle canónico; cleanup COMMIT/ROLLBACK/erros e A→B→A; composição não privilegiada F11/F12 com binding e F7 no mesmo PID/XID.
- O gate Central canónico e os probes F4.4 passaram nas repetições efetuadas. A execução integral mais recente avançou por runner Central, tenant runner, forward/restart, invariantes, writer/lifecycle, candidatas incompatíveis, cleanup, identidade/RLS, F9 PostgreSQL e legacy lineage.
- Finding ainda aberto: `vertical-jobs.js` falhou em `ASYNC_REPLAY_PERSISTENCE_FAILED` depois da integração cumulativa Central; causa raiz e correção ainda não concluídas. Por isso não foram executados com sucesso nesta iteração a cauda do gate, a suite backend completa, benchmark final e matriz PASS.
- A compatibilidade de catálogo F12/F7 foi alinhada com o runtime `f12-events-v2`; checksums e fingerprints Central/tenant foram atualizados com evidência PostgreSQL 17 descartável.

## F12 — correção do replay após Central 000–008 (2026-10-10)

- Reprodução sanitizada no gate vertical: `ASYNC_REPLAY_PERSISTENCE_FAILED`, causa PostgreSQL `SQLSTATE 23514`, constraint `audit.event_identity_event_code_check`, tabela `audit.event_identity`. A replay request era revertida juntamente com o evento F7; não ficou estado parcial.
- Causa raiz: o cenário de restart em `test/integration/f12/gate.js` executava o down/up isolado da migration Central 006 depois de o runner já ter instalado 007 e 008. Esse downgrade fora de ordem recompunha o catálogo F12 anterior e retirava os três eventos de replay instalados por 007.
- Correção: o restart deixou de alterar uma migration intermédia fora do runner. Reabre as bases, executa o runner cumulativo de forma idempotente, confirma preflight e verifica `ASYNC_REPLAY_REQUESTED`, `ASYNC_REPLAY_APPROVED` e `ASYNC_REPLAY_EXECUTION_CREATED`. O erro público continua sanitizado; a causa PostgreSQL fica apenas na cadeia interna do erro.
- Regressão: o probe de restart falha contra o comportamento anterior ao verificar o catálogo depois da reabertura. Os testes históricos F3/F4 validam agora o prefixo canónico 000–003 sem exigir que o manifest termine em 003.
- Gate PostgreSQL 17 integral: PASS. Central 000–008, tenant vazio/003/004→005, rollback SQL→ledger, retry, commit incerto, drift/gap/concorrência, F4.4, restart, LOGIN/RLS, F9, legacy lineage, vertical jobs, retry persistente, integração, atomic mutations e benchmark passaram. O vertical registou `jobs=5`, replay autorizado/idempotente, recusa sem grant, rescan, `inboxCompleted=5`, um evento replay e spans com link.
- Suite focada F4/F7/F9/F11/F12: `341/341 PASS`; suite backend limpa: `527/527 PASS`, zero fail, skipped e TODO. A primeira execução revelou apenas dois testes históricos de manifest desatualizados (`525/527`); depois da correção passaram `8/8` focados e `527/527` no total.
- `node --check` em 123 ficheiros JavaScript e `git diff --check`: PASS. Benchmark é apenas baseline PostgreSQL 17 loopback. Cleanup: zero containers/volumes `c4g-f12-gate-*`; nenhuma infraestrutura externa contactada.

| Critério reaberto | Estado | Evidência atual | Risco residual |
|---|---|---|---|
| F12-AC-17 | PASS | gate LOGIN/RLS não privilegiado e vertical integral | Evidência local descartável; sem rollout. |
| F12-AC-21 | PASS | composição F4/F11/F12, PID/XID único, rollback/commit | Provisioning produtivo fora do âmbito. |
| F12-AC-24 | PASS | atomic mutations, F11→F12, RLS A/B e replay persistente | Scanner/storage são doubles locais autorizados. |
| F12-AC-27 | PASS | runners Central e tenant, prefixos, drift/gap/retry/idempotência | Sem finding local aberto. |
| F12-AC-28 | PASS | invariantes SQL, legacy lineage e rollback SQL/ledger | Rollout real não autorizado. |
| F12-AC-29 | PASS | PostgreSQL 17 integral e `npm test` limpo `527/527` | Não prova staging/produção. |
| F12-AC-32 | PASS | manifests, fingerprints, ledgers e checks estruturais verdes | Nova revisão humana obrigatória. |

Estado formal mantido em `Review`. Recomendação técnica: `F12 pronta para nova revisão humana`; sem arquivo, commit ou publicação.

## F12 — isolamento CONNECT e preparação vertical canónica (2026-10-10)

- Causa raiz do isolamento físico: o harness revogava privilégios de objetos e exercitava RLS, mas as bases tenant ainda dependiam do `CONNECT` implícito de `PUBLIC`. Como os roles PostgreSQL são cluster-wide, um LOGIN sintético de A podia autenticar-se na base física de B antes de qualquer `SET ROLE` ou contexto tenant.
- Correção local: cada base tenant revoga `CONNECT` e `TEMP` de `PUBLIC`; o harness concede `CONNECT` apenas aos LOGINs API/WORKER do próprio tenant e aos roles administrativos estritamente necessários ao runner. Os agregadores de capabilities permanecem `NOLOGIN`, sem `CONNECT`, ownership ou grants de objetos.
- Binding físico: o validator canónico observa `current_database()`, identidade, workload, digest e ACLs sobre um inventário fechado de bases sintéticas. Rejeita base divergente, `PUBLIC CONNECT`, ownership inesperado, grant cruzado e identidade partilhada. A candidata incompatível percorreu writer → credential provider → validator → lifecycle e terminou `FAILED/INCOMPATIBLE`, sem cutover, incremento de fence, drain ou revogação da versão corrente.
- Probe A/B real: A/API e A/WORKER ligaram apenas a A; B/API e B/WORKER ligaram apenas a B; as quatro tentativas cruzadas foram recusadas pelo PostgreSQL na autorização `CONNECT`, antes da preparação de role/contexto. As mutações adversariais de `PUBLIC CONNECT`, grant cruzado e troca da base do destino foram detetadas; após restauro, o fluxo feliz voltou a passar.
- Preparação vertical: `gate.js` cria as bases vazias e chama `tenant-runner-harness.js`, que instancia `createTenantMigrationRunner`; o runner instala cumulativamente `000–005`, grava ledger/fingerprints e executa postflight antes das fixtures. `vertical-jobs.js` não lê nem aplica SQL de migration e falha fechado se ledger, fingerprint ou capability não coincidirem.
- Legacy lineage: continua isolado numa base exclusiva. O prefixo é produzido pelo runner Central canónico e o upgrade cumulativo é executado pelo mesmo runner; não existe down/up intermédio sobre a base vertical.
- Guarda estrutural: `f44TenantWorkloadIdentity.test.js` falha se `gate.js`/`vertical-jobs.js` voltarem a importar loaders de migrations, ler SQL diretamente ou se o fluxo vertical introduzir DDL. Também exige uso do harness/runner e prova explícita do ledger `005` e fingerprint.

### Evidência desta iteração

- Gate PostgreSQL 17 descartável: PASS integral. Incluiu Central 000–008; tenant vazio→005, 003→005 e 004→005; rollback SQL→ledger e retry; identidade/memberships; CONNECT A↔B; restart; F9; legacy lineage; vertical jobs; replay, retry, redelivery e rescan; F11/F12; benchmark local.
- Evidência CONNECT: `publicConnect=false`, `crossTenantDenied=4`, `currentDatabaseBound=true`, `bindingDigestBound=true`, `invalidCandidateNoCutover=true`.
- Fluxo vertical: `jobs=5`, replay autorizado, recusa sem grant, rescan, cinco inbox concluídos e evento de replay único.
- Suite backend em ambiente sem `DATABASE_URL`, `DB_*` ou `PG*`: `528/528 PASS`, zero fail, skipped e TODO.
- Regressão estrutural focada: `4/4 PASS`.
- `node --check`: 127 ficheiros JavaScript alterados/não rastreados, zero falhas.
- `git diff --check`: PASS; apenas avisos locais LF/CRLF, sem erro de whitespace.
- Benchmark: baseline PostgreSQL 17 loopback, zero falhas; não é SLO nem evidência de capacidade produtiva.
- Cleanup: zero containers e volumes `c4g-f12-gate-*`; LOGINs, memberships e credenciais sintéticas existiram apenas no container descartável removido. Nenhuma infraestrutura externa foi contactada.

| Critério reaberto | Estado | Evidência atual | Risco residual |
|---|---|---|---|
| F12-AC-17 | PASS | quatro recusas CONNECT cruzadas A↔B, `PUBLIC CONNECT=false`, RLS A/B e identidades por workload | Evidência exclusivamente local/descartável; rollout não autorizado. |
| F12-AC-27 | PASS | binding físico/current database, ACL drift fail-closed, ledger/fingerprint/capabilities verificados na mesma base vertical | Inventário produtivo e operação F4.4 continuam fora do âmbito. |
| F12-AC-28 | PASS | bases verticais preparadas apenas pelo runner tenant 000–005; legacy isolado e upgrade pelo runner | Não constitui plano de downgrade produtivo. |
| F12-AC-29 | PASS | gate PostgreSQL 17 integral, probes A/B e suite limpa `528/528` | Não prova staging ou produção. |
| F12-AC-22 | PASS (sem regressão) | replay/retry/redelivery/rescan e lineage mantiveram comportamento persistente | Serviços externos reais permanecem fora do âmbito. |
| F12-AC-32 | PASS (sem regressão) | manifests, ledgers, fingerprints, postflight e guarda estrutural passaram | Nova revisão humana read-only continua obrigatória. |

Estado formal preservado em `Review`. Recomendação técnica: `F12 pronta para revisão humana final`; sem arquivo, commit ou publicação.

## F12 — binding da sessão candidata e fecho dos bypasses locais (2026-10-10)

- Estado formal preservado em `Review`. Os cinco critérios reabertos permaneceram `FAIL` durante a implementação e só foram reavaliados depois da repetição integral dos gates.
- O validator F4.4 recebe agora duas dependências distintas: `candidateConnection`, aberta pelo material sintético resolvido da `credential_ref`, e `administrativeInspector`, limitado à inspeção de ACLs, ownerships, memberships e catálogo do cluster. A mesma ligação não pode representar ambas as capacidades.
- A sessão candidata observa diretamente, antes de qualquer `SET ROLE`, `session_user`, `current_user`, `current_database()` e os atributos de `session_user`. Exige identidade autenticada igual ao binding, `current_user=session_user`, `LOGIN`, `NOSUPERUSER` e `NOBYPASSRLS`, e recusa owner, migrator, administrador, agregador ou role funcional como principal autenticado.
- O probe físico abriu ligações reais distintas para A/API, A/WORKER, B/API e B/WORKER com secrets sintéticos apenas em memória. Reproduziu e fechou o falso PASS anterior: um LOGIN esperado seguro acompanhado de uma candidate connection administrativa foi recusado. Também recusou workload/tenant/base divergentes e `current_user` previamente alterado; nenhuma candidata inválida causou cutover, fence, drain ou revogação.
- `tenantPoolManager` deixou de converter workload ausente em `API`. Aquisição, drain e revoke validam obrigatoriamente `API|WORKER`; ausência, vazio, valor inválido e binding divergente falham antes de alterar pool, circuito ou fence. Os call sites legítimos declaram workload explicitamente, e API/WORKER continuam independentes.
- `gate.js` deixou de fabricar um resultado `applied`: consome a evidência devolvida pelo tenant runner e valida ledger persistido, fingerprint, postflight, capabilities e versão `005`. `replay-service.js` deixou de carregar/aplicar lineage SQL e exige bases previamente preparadas pelos runners Central e tenant.
- A guarda estrutural percorre todos os módulos JavaScript de `test/integration/f12`, com allowlist explícita apenas para harnesses de runners/setup autorizados. Rejeita leitura/load de migrations, DDL de schema funcional, helpers `apply*Migration`, estado `applied` fabricado e manipulação manual de ledger. Fixtures negativas cobrem loader num helper, DDL oculto, helper renomeado, `loadLineage(...).sql` e ledger manual.
- O probe de replay passou a contar o evento pela própria chave idempotente persistida, evitando depender de contagens globais deixadas pelo vertical sem limpar ou fabricar estado.

### Evidência final desta iteração

- Testes focados de pool/workload e guarda estrutural: `44/44 PASS`.
- Suite backend canónica em ambiente sem `DATABASE_URL` e sem `DB_*`: `529/529 PASS`, zero fail, skipped e TODO.
- Gate PostgreSQL 17 descartável: PASS integral. Incluiu runners Central `000–008` e tenant vazio/003/004→`005`, rollback SQL→ledger, retry, commit incerto, identidade/memberships, candidate sessions reais, CONNECT A↔B, restart, F9, legacy lineage, vertical jobs, replay, retry, redelivery, rescan, composição F11/F12 e benchmark.
- Evidência de identidade: `authenticatedIdentityBound=true`, `administrativeCandidateDenied=true`, `alteredCurrentUserDenied=true`, `currentDatabaseBound=true`, `bindingDigestBound=true`, `invalidCandidateNoCutover=true`.
- Fluxo vertical: cinco jobs e inboxes concluídos, replay autorizado e idempotente, recusa sem grant, rescan e evento replay único. O probe isolado de replay confirmou request, approval, reserva, reconciliação, outbox/auditoria únicas e idempotência.
- `node --check`: 128 ficheiros JavaScript alterados/não rastreados, zero falhas. `git diff --check`: PASS, apenas avisos locais LF/CRLF.
- Benchmark: baseline PostgreSQL 17 loopback com zero falhas; não é SLO nem evidência de capacidade produtiva.
- Cleanup: zero containers e volumes `c4g-f12-gate-*`; os LOGINs, memberships e credenciais sintéticas existiram apenas dentro do container removido. Nenhuma infraestrutura externa foi contactada.

| Critério reaberto | Estado | Evidência atual | Risco residual |
|---|---|---|---|
| F12-AC-17 | PASS | candidate sessions autenticadas como LOGINs não privilegiados, admin/current_user divergentes recusados, CONNECT e RLS A/B | Evidência exclusivamente local e descartável; rollout não autorizado. |
| F12-AC-27 | PASS | runners canónicos, ledger/fingerprint/postflight reais; replay sem loader direto; guarda estrutural ampliada | Operação produtiva F4.4 permanece fora do âmbito. |
| F12-AC-28 | PASS | bases e upgrades preparados pelos runners, sem reparação direta; lineage legacy isolado | Não constitui estratégia de downgrade produtivo. |
| F12-AC-29 | PASS | gate PostgreSQL 17 integral, lifecycle com credenciais candidatas reais e suite limpa `529/529` | Não prova staging ou produção. |
| F12-AC-32 | PASS | manifests, ledgers, fingerprints, capabilities, assinatura estrita de workload e guarda estrutural verdes | Exige nova revisão humana read-only antes do fecho. |

Limitações produtivas inalteradas: provisioner e secret manager produtivos, rollout, staging/produção, connection limits e serviços externos reais continuam não implementados e não autorizados. Recomendação técnica: `F12 pronta para revisão humana final`, mantendo `Review` e sem arquivo.

## F12 — tuple de credencial, bloqueio por workload e guarda alcançável (2026-10-10)

- Estado mantido em `Review / Needs changes` durante toda a implementação. AC-17, AC-27, AC-28, AC-29 e AC-32 só foram reavaliados depois do gate PostgreSQL e da suite completa passarem novamente.
- O adapter local `localTenantCredentialAdapter` mantém um registo fechado pela chave exata `(credential_ref, tenant_id, workload, connection_version)`. Referência desconhecida ou divergência de tenant, workload ou versão falha antes de abrir uma ligação. A mesma referência não pode ser registada para tenants ou workloads diferentes.
- Cada entrada liga a tuple a uma base e LOGIN sintéticos e abre uma nova `candidateConnection` autenticada. O inspector administrativo continua uma dependência separada. Passwords e connection strings não entram no diretório, digest, output ou logs funcionais.
- O binding observado deixou de aceitar `observedBindingDigest`. O validator deriva SHA-256 sobre JSON canónico contendo `credentialRef`, `tenantId`, `workload`, `connectionVersion`, `database` e `login`; `database` e `login` são substituídos pelos valores observados em `current_database()` e `session_user`. `current_user` tem de continuar igual a `session_user`. Nenhum segredo participa no digest.
- O probe persistente executou quatro lifecycles positivos completos: A/API, A/WORKER, B/API e B/WORKER. Cada `credential_ref` selecionou LOGIN/base próprios, passou validator real, chegou a `AVAILABLE` e abriu uma lease funcional que executou `SET LOCAL ROLE`, preservando `session_user`.
- Divergências isoladas da tuple são cobertas unitariamente; referências incompatíveis atravessam o writer/lifecycle e ficam `FAILED`, sem alterar a versão publicada. A regressão de candidate admin, base/identidade divergente, binding adulterado e atributos/memberships incompatíveis continua no gate físico e de membership.
- O pool manager substituiu o marcador global ambíguo por bloqueios `(tenant_id, workload)`. `blockWorkload`/`allowWorkload` são explícitos; `blockTenant` compõe API+WORKER e retorna ambos os estados; `allowTenant` valida os dois fences/versions antes de remover qualquer bloqueio. `synchronizeBlocked` reconstrói um bloqueio persistido sem reduzir ou incrementar silenciosamente o fence.
- Removido o default `workload='API'` dos helpers de credencial. Testes provam workload ausente/inválido, WORKER sem pool no momento do bloqueio, recusa de allow parcial, validação atómica de ambos os fences, bloqueio antes da criação do pool e reconstrução de WORKER após restart sem afetar API.
- A guarda estrutural parte dos entrypoints F12, segue `require`, `import`, `export ... from` e `import()` literais relativos dentro do workspace, protege contra ciclos e não atravessa built-ins, dependências externas ou `node_modules`. Import dinâmico não literal falha fechado, salvo operação externa exata e documentada.
- A análise remove comentários, distingue SQL executado por `query(...)` de strings inertes e deteta reads não autorizados, módulos/loaders de migration, helpers de instalação independentemente do nome específico, acesso `.sql`, DDL funcional, mutação de ledger, evidência `applied`/fingerprint fabricada e fallback de reparação de schema. A allowlist identifica módulo e operação, não isenta o ficheiro inteiro.
- Limite declarado da guarda: é uma tokenização conservadora de imports estáticos locais e chamadas reconhecíveis, não uma prova semântica de JavaScript arbitrário. A proteção é complementada por boundaries dos runners, manifests fechados e probes PostgreSQL persistentes.
- Fixtures estruturais cobrem helper importado em subdiretório, ciclos, `fs.promises.readFile`, import dinâmico literal/não literal, loader/installer renomeado, `.sql`, DDL em helper, ledger, fingerprint/applied fabricados e fallback. Casos positivos cobrem query parametrizada, JSON, comentários/strings inertes e runners allowlisted.

### Evidência final

- Testes focados de provider, binding, pool lifecycle e source graph: `48/48 PASS`.
- Gate PostgreSQL 17 descartável: PASS integral, incluindo Central `000–008`, tenant `000–005`, upgrades 003/004→005, rollback SQL→ledger, retry, commit incerto, quatro lifecycles de credential tuple, CONNECT/RLS A↔B, restart, legacy lineage, replay, retry, redelivery, rescan, composição F11/F12 e benchmark.
- Evidência nova: `closedTupleProvider=true`, `positiveLifecycles=4`, `unknownRefDenied=true`, `tenantMismatchDenied=true`, `workloadMismatchDenied=true`, `versionMismatchDenied=true`, `bindingDerived=true`.
- Suite backend canónica em ambiente sem `DATABASE_URL` e sem `DB_*`: `533/533 PASS`, zero failures, skipped e TODO.
- `node --check`: 131 ficheiros JavaScript alterados/não rastreados, zero falhas. `git diff --check`: PASS, apenas avisos locais LF/CRLF.
- Benchmark: baseline PostgreSQL 17 loopback, zero falhas; não é SLO nem evidência de capacidade produtiva.
- Cleanup: zero containers e volumes `c4g-f12-gate-*`; LOGINs, memberships e credenciais sintéticas existiram apenas no container removido. Nenhuma infraestrutura externa foi contactada.

| Critério reaberto | Estado | Evidência atual | Risco residual |
|---|---|---|---|
| F12-AC-17 | PASS | quatro lifecycles por LOGIN/base/workload, CONNECT e RLS A/B, binding derivado e paths cruzados recusados | Evidência local descartável; rollout não autorizado. |
| F12-AC-27 | PASS | tuple fechada, binding observado, incompatibilidades fail-closed, bloqueio/reconciliação por workload e preflight canónico | Operação produtiva F4.4 permanece fora do âmbito. |
| F12-AC-28 | PASS | schema preparado apenas pelos runners; grafo alcançável sem loader/DDL funcional fora das operações allowlisted | Guarda limitada a imports locais analisáveis e complementada pelos runners. |
| F12-AC-29 | PASS | PostgreSQL 17 integral com quatro credential lifecycles reais e suite limpa `533/533` | Não prova staging ou produção. |
| F12-AC-32 | PASS | manifests, ledgers, fingerprints, tuple/binding, fences por workload e source graph verdes | Exige nova revisão humana read-only antes do fecho. |

Limitações produtivas inalteradas: provisioning/secret manager produtivos, rollout, staging/produção, connection limits e serviços externos reais permanecem fora do âmbito. Recomendação técnica: `F12 pronta para revisão humana final`, mantendo `Review` e sem arquivo.

## F12 — manifest canónico e cobertura integral da source guard (2026-10-10)

- Estado mantido em `Review`. Esta iteração reabriu apenas F12-AC-28 e F12-AC-32 e não alterou os restantes critérios.
- `test/integration/f12/gate-programs.json` é a fonte única de verdade para programas Node do gate: 23 execuções ordenadas, 21 programas/raízes únicas e sete fases (`foundation`, `restart`, `identity`, `f9-foundation`, `legacy`, `vertical-setup`, `functional`). Cada entrada declara caminho relativo, ordem, fase, categoria, argumentos fechados, erro público e operações exatas autorizadas para a guarda.
- Inventário integral: `central-manifest-gate.js`, `tenant-manifest-gate.js`, `gate.js` (`setup` e `restart`), `workload-schema-invariants.js`, `workload-lifecycle.js`, `worker-rotation-reconcile.js`, `membership-context.js`, `workload-identity.js`, `physical-connect.js`, `credential-lifecycle.js`, `prepare-f9-foundation.js`, `prepare-pgboss.js` (duas fases), `backend/test/f9PostgresIntegration.test.js`, `prepare-legacy-foundation.js`, `legacy-lineage-upgrade.js`, `vertical-jobs.js`, `replay-service.js`, `retry-port.js`, `integrated.js`, `atomic-mutations.js` e `benchmark.js`.
- `migration-gate.ps1` valida schema, IDs/ordens, categorias, argumentos Node, extensão, existência e contenção no workspace; todas as execuções passam por uma única rotina `Invoke-GatePhase` e uma única chamada `& node @command`. Não permanecem caminhos `.js` paralelos no PowerShell. Docker, criação de bases e variáveis de processo continuam nas fases PowerShell apropriadas, com cleanup em `finally`.
- `source-guard.js` carrega o mesmo manifest, usa todos os programas únicos como raízes e segue imports/requires locais. O resultado prova igualdade exata entre programas declarados, raízes analisadas e fases chamadas pelo PowerShell; reporta missing/outside-workspace, IDs/ordens duplicados e mismatch de fases.
- A exceção textual por nome `tenant-runner-harness` foi removida. Autorizações são agora `(módulo exato, operação exata, razão)`. As autorizações dos entrypoints limitam-se a runners canónicos, criação de bases/markers descartáveis, drift/ledger de probes de contrato, fixture sintética F9 e import externo fechado do pg-boss. O benchmark não recebe qualquer autorização de migration ou DDL.
- Fixtures negativas constroem grafo real `entrypoint -> helper -> loader renomeado -> .sql -> query`, além de ledger, fingerprint e fallback em módulos intermédios. A regressão de PowerShell recusa `& node`, `node.exe`, `Start-Process node` e caminho dinâmico paralelos. Um programa temporário acrescentado ao manifest torna-se automaticamente raiz; DDL é detetado, a versão segura passa e ficheiro inexistente falha fechado. Uma fixture parcialmente allowlisted prova que autorizar DDL não autoriza ledger.
- Limite preservado: a guarda é uma tokenização conservadora de imports estáticos locais e padrões executáveis reconhecidos, não uma prova semântica geral de JavaScript ou PowerShell. O contrato PowerShell restringe deliberadamente a forma canónica de execução Node.

### Evidência final do delta

- Testes focados F4.4/F12 e source guard: `120/120 PASS`, zero failures/skips/TODO.
- Gate PostgreSQL 17 orientado pelo manifest: PASS integral na segunda execução, incluindo Central `000–008`, tenant `000–005`, upgrades, restart, quatro lifecycles, CONNECT/RLS A↔B, replay, retry, redelivery, rescan, composição F11/F12 e benchmark baseline. A primeira tentativa terminou numa ligação transitória durante readiness, antes do primeiro probe; o `finally` deixou zero recursos e a repetição limpa passou integralmente.
- Suite backend sem `.env`, `DATABASE_URL` ou `DB_*`: `538/538 PASS`, zero failures/skips/TODO.
- A verificação final de sintaxe, whitespace, secrets e cleanup consta do relatório desta iteração.

| Critério reaberto | Estado | Evidência atual | Risco residual |
|---|---|---|---|
| F12-AC-28 | PASS | Todos os programas Node do gate derivam do manifest; runners continuam exclusivos; 21 raízes analisadas; loaders, DDL, ledger e schema repair fora das operações exatas são recusados | Análise estática conservadora, complementada pelos runners e gate PostgreSQL persistente. |
| F12-AC-32 | PASS | Igualdade manifest/PowerShell/source guard, paths e fases fechados, missing/duplicates recusados, credential lifecycle incluído automaticamente e gate cumulativo verde | Exige aprovação humana final antes do fecho. |

Os 32 critérios F12-AC voltam a estar sustentados por evidência local. A F12 permanece em `Review`; recomendação técnica: `F12 pronta para aprovação humana final`.

## Fecho metodológico — 2026-10-10

- Veredicto humano final: `Approved — F12 aprovada para fecho metodológico`.
- Os 32 critérios F12-AC estão PASS com evidência local auditável; o último finding relativo à cobertura dos programas executados pelo gate foi corrigido pelo manifest canónico partilhado entre PowerShell, source guard e testes.
- A política de compatibilidade histórica F9 foi formalizada em `context/decisions/f9-legacy-lineage-compatibility.md`: lineage v0 preserva `attempt` e evidência legacy sem inventar digests; novas execuções exigem lineage v1; downgrade com dados modernos falha fechado.
- Validação final registada: testes focados `120/120`, suite backend limpa `538/538`, gate PostgreSQL 17 cumulativo, runners Central `000–008` e tenant `000–005`, replay/retry/redelivery/rescan, composição F11/F12, `node --check`, `git diff --check` e cleanup integral.
- A primeira tentativa do gate final terminou apenas numa falha transitória de readiness antes do primeiro probe; o `finally` removeu os recursos e uma execução integral limpa posterior passou.
- O benchmark é somente baseline local, não SLO, sizing ou garantia operacional.
- Limitações preservadas: não existem nem foram autorizados provisioning produtivo, secret manager real, rollout, staging/produção, connection limits operacionais ou serviços externos reais.
- `.vscode/settings.json` é alteração local alheia e permanece fora da integração F12.
- Não foram criados commit, push, merge, PR ou deploy.

## Aditamento — fecho restrito da importação XLSX (2026-10-14)

- Veredicto humano final: `GO restrito`; estado da importação XLSX Portugal 2030: `Complete` no âmbito local autorizado.
- A revisão final read-only não encontrou blockers materiais. `F12-IMPORT-R2-003` permanece resolvido: todo o header desconhecido exige decisão explícita `IGNORE` ou `REJECT`. `F12-IMPORT-R2-004` permanece resolvido: recusas funcionais F5 são `403` e falhas técnicas reais continuam `503`.
- A role `c4g_import_worker_runtime` conserva apenas os privilégios exercidos pelo fluxo; a cadeia transitiva de memberships falha fechada perante autoridade adicional; RLS e isolamento Central/A/B, identidade separada do worker, redelivery idempotente e limpeza do hook de commit incerto por `ROLLBACK` foram cobertos.
- Evidência reconciliada da preparação isolada do commit 2: testes focados F12 `27/27 PASS`, backend `713/713 PASS`, frontend `27/27 PASS` e build frontend `PASS`. Gates migration XLSX 015, funcional `F12_IMPORT_ENTRYPOINT_CENTRAL_AB`, cumulativo F12 e UBI/browser `PASS` no primeiro clone. O segundo clone repetiu focados, backend, build e gates funcional, cumulativo e UBI/browser sobre o patch idêntico. `node --check`, pins/fingerprints e whitespace do patch `PASS`. São provas locais com fixtures sintéticas, não validação produtiva.
- Pins finais da migration tenant `015`: up `58ecebd8c4dd726bd7f65d4ec16adebab44bc3a838ca8177ef486e983c7ba509`; down `a9ea1f4389eccbe76ed94a8fdd98e8bedd92596d78ff18b93dc86dedef008f6b`; fingerprint cumulativo `8c96af15c713ba36658d462e348ff3b69324042cd163bf426bb9b55353bec5ac`.
- Limitações explícitas: este fecho não constitui validação de Layer C/provider F11 externo, IdP externo, staging, produção, rollout, fornecedores externos ou dados UBI reais. CSV, conectores, matching, candidaturas, reporting e F13 permanecem fora deste fecho.
- Commits locais existentes: baseline `e5a22590a008d5e93a17b8a4c07eb1e7d887ddfb` e importação XLSX `6c0be3af7001f4f8b46aede5320d5daf8b8e4e8c`. Este aditamento regista o fecho restrito da importação XLSX F12. Nenhum push, PR ou deploy foi executado. As afirmações anteriores de ausência de commits descrevem apenas as execuções históricas respetivas.
- A fixture UBI cria idempotentemente a role técnica canónica antes da migration 015, verifica os atributos fail-closed e não acrescenta memberships. O gate UBI/browser passou nos dois clones. CSV permanece apenas relatório F11, não fonte de importação; migração de dados reais está fora do âmbito. F13 integral permanece `In Progress`.
