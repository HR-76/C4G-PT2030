# F12 — Decisões consolidadas do Catálogo de Oportunidades

- Data da pesquisa: 2026-10-08
- Feature: **F12 — Catálogo de Oportunidades — núcleo manual, proveniência e deduplicação determinística**
- Estado destas decisões: **recomendadas, ainda não aprovadas**
- Contrato ativo: `context/current-work.md`

## 1. Decisão consolidada

Recomenda-se implementar um catálogo com duas autoridades separadas e um contrato de snapshot comum:

- a **Central** é autoritativa para oportunidades centrais, respetivas revisões, proveniência e candidatos/decisões de duplicação centrais;
- cada **tenant** é autoritativo para oportunidades privadas, revisões, proveniência, relações locais com oportunidades centrais e candidatos/decisões privados;
- não existem foreign keys nem writes cruzados entre bases; referências Central↔tenant usam UUID/revision ID opacos e snapshots mínimos versionados;
- criação e atualização manuais executam validação, normalização, qualidade, digest, revisão e exact-match na mesma transação da autoridade;
- possíveis duplicados e reconciliação podem ser recalculados por jobs F9 sintéticos, pelo menos uma vez e idempotentes;
- não existe merge destrutivo: uma decisão liga identidades/revisões e preserva todas as origens, relações e histórico;
- a consulta é fechada, paginada por keyset e autorizada pelo F5 sobre o recurso efetivamente carregado;
- F7 regista mutações e decisões; F10 observa apenas agregados sanitizados; F11 só anexa documentos a oportunidades privadas neste recorte.

F12 permanece independente de F4.4 porque toda a prova usa Central e tenants sintéticos em PostgreSQL 17 descartável. Nenhuma integração, fonte, tenant ou dado real é necessária.

## 2. Factos vinculativos do repositório

- A arquitetura aprovada divide catálogo/proveniência central e dados operacionais privados por base de organização.
- `organization_opportunities` referencia exatamente uma oportunidade central ou privada; não existe FK entre bases.
- O catálogo central é mantido pela C4G; uma organização não altera dados comuns para outras organizações.
- Oportunidades privadas pertencem à organização; promoção futura preserva a origem privada e partilha apenas snapshot aprovado.
- Deduplicação segue a ordem de confiança: identificador oficial; programa/referência; URL oficial; financiador; título; datas; outros sinais. Incerteza exige revisão humana.
- Oportunidades e proveniência são arquivadas e preservadas; não existe eliminação automática.
- F3–F11 já fixaram contexto, tenancy, autorização, auditoria, execução assíncrona, telemetria e documentos.
- O piloto UBI não separa autoridade Central/tenant, não tem deduplicação explicável nem proveniência/qualidade formal e não é contrato futuro.

## 3. Fontes normativas externas

- UUIDv7 é definido pelo [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html); a aplicação já adotou UUIDv7 para entidades partilhadas, auditadas ou expostas.
- A projeção de digest usa JSON compatível com I-JSON e canonicalização determinística segundo [RFC 8785 — JCS](https://www.rfc-editor.org/rfc/rfc8785.html).
- Texto é normalizado em NFC segundo [Unicode Standard Annex #15](https://www.unicode.org/reports/tr15/); NFC preserva equivalência canónica sem aplicar as perdas de compatibilidade de NFKC.
- URLs seguem parsing e normalizações seguras do [RFC 3986, secção 6](https://www.rfc-editor.org/rfc/rfc3986.html#section-6); componentes cujo significado possa mudar não são “limpos” por heurística.
- Concorrência usa CAS e row locks transacionais; PostgreSQL documenta que row locks bloqueiam writers concorrentes e são libertados no fim da transação em [PostgreSQL 17 — Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html).
- Tabelas tenant-local podem usar RLS como defesa em profundidade; quando ativada, o acesso normal deve ser permitido por policy, conforme [PostgreSQL 17 — Row Security Policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

## 4. Contrato de dados recomendado

### 4.1 Identidades e residência

- `opportunityId`: UUIDv7 interno, estável e gerado pela aplicação.
- `revisionId`: UUIDv7 interno; cada alteração funcional cria revisão imutável.
- `revisionNumber`: inteiro monotónico por oportunidade, iniciado em 1.
- `authority`: `CENTRAL` ou `ORGANIZATION`, derivada do service/port e nunca do caller.
- `organizationId`: ausente em entidades Central e obrigatório, derivado do contexto F3, em entidades tenant.
- `rowVersion`: inteiro CAS separado de `revisionNumber` para concorrência técnica.

### 4.2 Snapshot funcional v1

Campos obrigatórios:

- `schemaVersion = 1`;
- `title` (1–300 caracteres após NFC/trim);
- `funderName` (1–200);
- `provenanceId`;
- `lifecycleState`;
- `validationState`;
- `normalizationVersion`;
- `qualityRuleVersion`.

Campos opcionais fechados:

- `summary` (até 4 000 caracteres);
- `programmeName` (até 200);
- `callReference` (até 128);
- `officialUrl` (até 2 048);
- `openingDate` e `closingDate` como datas ISO `YYYY-MM-DD`, com `closingDate >= openingDate` quando ambas existem;
- `eligibilitySummary` (até 4 000);
- `thematicCodes` (máximo 32 códigos versionados);
- `territoryCodes` (máximo 32);
- `beneficiaryTypeCodes` (máximo 32);
- `fundingAmountMin`/`fundingAmountMax` como decimal canónico e `currencyCode` ISO 4217, todos presentes ou ausentes conforme constraints; `min <= max`.

Não são aceites JSON livre, HTML, documentos, contactos, dados pessoais, SQL, configuração, source payload ou campos adicionais.

### 4.3 Proveniência v1

Cada revisão liga pelo menos uma proveniência fechada:

- `sourceType`: `C4G_MANUAL` ou `ORGANIZATION_MANUAL` neste recorte;
- `sourceNamespace`: código interno versionado;
- `externalIdentifier`: opcional, 1–256, único apenas dentro de `(sourceNamespace, normalizedExternalIdentifier)`;
- `sourceUrl`: opcional e normalizado separadamente;
- `observedAt`: instante fornecido pelo serviço e validado;
- `recordedAt`: timestamp transacional;
- `recordedByActorType` e referência opaca do actor;
- `sourceDigest`: SHA-256 da projeção original allowlisted, sem payload bruto.

Uma proveniência não é reescrita. Correções criam nova revisão/link e preservam a anterior.

### 4.4 Estados

Lifecycle central e privado usam as mesmas categorias, mas transições independentes:

- `DRAFT → ACTIVE | ARCHIVED`
- `ACTIVE → STALE | ARCHIVED`
- `STALE → ACTIVE | ARCHIVED`
- `ARCHIVED → ACTIVE` apenas por `restore`, MFA recente e auditoria crítica.

Validation state é ortogonal:

- `PENDING_REVIEW → VALIDATED_MANUAL | CONFLICT`
- `CONFLICT → VALIDATED_MANUAL | CONFLICT`
- `VALIDATED_MANUAL → CONFLICT` quando uma nova revisão introduz divergência.

Não existe `VALIDATED_AUTOMATIC` porque conectores/imports estão fora deste recorte.

### 4.5 Qualidade v1

O resultado conserva fatores booleanos e score derivado inteiro 0–100:

1. título presente;
2. financiador presente;
3. programa ou referência presente;
4. URL oficial ou identificador externo presente;
5. pelo menos uma data presente;
6. elegibilidade presente;
7. pelo menos um código temático/territorial/beneficiário;
8. intervalo financeiro completo e válido, ou explicitamente não aplicável.

Cada fator vale 12,5 pontos; o score é o número de fatores satisfeitos multiplicado por 12,5, arredondado para inteiro pelo método half-up. O score é informativo, nunca autorização nem decisão de publicação. Dados ausentes e conflitos são listados por códigos fechados.

## 5. Normalização e deduplicação

### 5.1 Normalização v1

- Todos os textos: validar UTF-8/Unicode scalars, NFC, converter CRLF/CR para LF, trim e colapsar whitespace apenas em campos de comparação; o original validado permanece na revisão.
- Comparação de título/financiador/programa: lowercase locale-independent, whitespace simples e pontuação periférica removida; não remover diacríticos nem aplicar tradução/stemming.
- Identificadores: NFC, trim, uppercase ASCII quando o namespace declarar case-insensitive; fora disso preservar case.
- Datas: forma ISO validada, sem inferir timezone nem preencher datas ausentes.
- Valores monetários: decimal canónico string, nunca `Number`/float.
- URL: lowercase de scheme/host, remover default port, normalizar percent-encoding de unreserved characters, remover fragment; não ordenar/remover query parameters nem alterar path semantics sem regra específica de source.
- Entidades/nomes: não inferir igualdade por abreviatura; apenas representação normalizada para comparação exata.

Cada revisão guarda `normalizationVersion = opportunity-normalization-v1` e os valores normalizados necessários, sem substituir os originais.

### 5.2 Digests

- `contentDigest`: SHA-256 de `C4G:OPPORTUNITY:CONTENT:v1\0` + JCS da projeção funcional normalizada, excluindo IDs técnicos, actor, timestamps, qualidade derivada, lifecycle e observabilidade.
- `provenanceDigest`: SHA-256 de `C4G:OPPORTUNITY:PROVENANCE:v1\0` + JCS da proveniência normalizada.
- `idempotencyDigest`: SHA-256 de `authority + organization-or-central + operation + validatedRequestId + contentDigest`.

Digests são recalculados internamente. Valores externos, se presentes num contrato interno, são apenas comparados em tempo constante e divergência falha fechado.

### 5.3 Regras de deduplicação v1

Duplicado exato quando, dentro da mesma autoridade/residência, uma das regras fortes é satisfeita sem conflito:

1. mesmo `sourceNamespace + normalizedExternalIdentifier`;
2. mesmo `normalizedProgrammeName + normalizedCallReference` quando ambos existem;
3. mesmo URL oficial normalizado quando a URL é válida e não conflita com identificador/referência fortes.

Se uma regra forte coincide mas outra regra forte presente diverge, o resultado é `POSSIBLE`, não `EXACT`.

Candidato possível quando pelo menos dois destes sinais coincidem e nenhuma regra forte prova distinção:

- título normalizado;
- financiador normalizado;
- opening/closing dates;
- interseção de programa, território ou temática.

Não existe percentagem, fuzzy matching, IA ou threshold numérico em v1. O resultado fechado é `EXACT`, `POSSIBLE` ou `DISTINCT`, com `ruleVersion`, reason codes e evidence fields. `EXACT` cria ligação canónica idempotente, nunca apaga/mescla linhas; `POSSIBLE` cria candidato para decisão humana futura.

## 6. Autorização, auditoria, jobs e telemetria

### 6.1 Catálogo F5 proposto

Nova versão adiciona exatamente, sem grants implícitos:

- `opportunity.read`
- `opportunity.private.create`
- `opportunity.private.update`
- `opportunity.archive`
- `opportunity.restore`
- `opportunity.duplicate.review`
- `opportunity.central.manage`

Leitura e operações privadas usam scope `ORGANIZATION` ou `RESOURCE`. `opportunity.central.manage` só pode ser usado por service actor interno `CATALOG_MAINTAINER`, vinculado na composição a contexto C4G confiável; nenhum caller escolhe actor ou scope. Archive, restore, duplicate review e central manage são sensíveis; restore/review/central manage exigem `RECENT_MFA` para actor humano. Os quatro perfis existentes continuam com zero grants produtivos.

### 6.2 Catálogo F7 proposto

Nova versão adiciona exatamente:

| Evento | Classe | Residência |
| --- | --- | --- |
| `OPPORTUNITY_CREATED` | critical | autoridade da operação |
| `OPPORTUNITY_REVISION_CREATED` | critical | autoridade da operação |
| `OPPORTUNITY_ARCHIVED` | critical | autoridade da operação |
| `OPPORTUNITY_RESTORED` | critical | autoridade da operação |
| `OPPORTUNITY_PROVENANCE_LINKED` | critical | autoridade da operação |
| `OPPORTUNITY_QUALITY_EVALUATED` | observational | autoridade da operação |
| `OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED` | observational | autoridade da operação |
| `OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED` | observational | autoridade da operação |
| `OPPORTUNITY_DUPLICATE_DECISION_RECORDED` | critical | autoridade da decisão |
| `OPPORTUNITY_ACCESS_DENIED` | deny | autoridade tentada |
| `OPPORTUNITY_RECONCILIATION_REQUIRED` | observational | autoridade da operação |

Payload admite apenas version codes, state/result/reason codes, quality bucket, match class e digests; não inclui título, resumo, URL, identifier externo, organização/recurso/actor como labels, documento ou texto livre.

### 6.3 Jobs F9 propostos

- `opportunity.duplicate.scan` v1: recalcula candidatos a partir de revisão já persistida; idempotency key por authority/opportunity/revision/ruleVersion.
- `opportunity.catalog.reconcile` v1: deteta revisão sem normalização/qualidade, candidate inconsistente, referência central indisponível e outbox/inbox incertas; só repara casos determinísticos.

Criação manual, normalização, exact-match e commit da revisão não dependem do job. Jobs humanos revalidam membership; jobs sistémicos usam service actor interno fixo. Replay nunca cria merge ou decisão humana.

### 6.4 F10 proposto

- signal codes: `c4g.opportunity.operation.failed`, `c4g.opportunity.reconciliation.required`;
- operations: `opportunity.create`, `opportunity.update`, `opportunity.archive`, `opportunity.restore`, `opportunity.read`, `opportunity.duplicate.scan`, `opportunity.reconcile`;
- métricas: `c4g.opportunity.operation` counter `{operation,resultClass}`; `c4g.opportunity.deduplication` counter `{resultClass}`; `c4g.opportunity.query.duration` histogram em segundos com buckets locais `[.005,.01,.025,.05,.1,.25,.5,1,2]`.

Aplicam-se budgets F10 existentes. Nenhum ID, título, source, URL, organização ou actor é label/atributo automático. Não se criam thresholds/alertas produtivos nesta fase; health apenas reporta validade de catálogo/regras/manifests e atraso de reconciliação por bucket fechado.

### 6.5 F11

Anexos são permitidos apenas para oportunidades privadas tenant-local, depois de existir o recurso e grant F5. O binding usa resource type/id opaco no metadata F11. Oportunidades centrais não recebem attachment neste recorte; referências oficiais permanecem URL/proveniência, não ficheiros copiados.

## 7. Consulta, limites e concorrência

- Query port fechado para `get`, `list` e `search`.
- Filtros: `authority`, `lifecycleState`, `validationState`, `programmeName`, `funderName`, `closingFrom`, `closingTo`, `qualityBucket` e `duplicateClass`; `authority` é restringida pelo port/contexto, nunca expande acesso.
- Ordenações: `updatedAt DESC, opportunityId DESC` (default), `closingDate ASC/DESC`, `title ASC`; sempre com `opportunityId` como desempate.
- Keyset cursor opaco v1 inclui filtros digest, sort e último valor; é autenticado apenas por digest interno do contrato local, não por segredo nesta fase, e qualquer alteração falha fechado.
- Página default 25, máximo 100; resposta máxima 1 MiB; janela temporal máxima de 366 dias quando filtro de datas é usado; query timeout 5 s.
- Payload de create/update máximo 32 KiB; máximo 32 valores por lista; texto total máximo 16 KiB.
- CAS exige `expectedRowVersion`; `UPDATE ... WHERE id = $1 AND row_version = $2` incrementa versão e cria revisão na mesma transação.
- Candidate pairs usam identidade ordenada `(least(id), greatest(id), ruleVersion)` e unique constraint. Locks são adquiridos em ordem UUID crescente para evitar deadlocks; conflitos/deadlocks são classificados internamente e retry limitado pelo F9 quando assíncrono.

## 8. Migrations e compatibilidade

Identificadores exatos devem ser derivados novamente dos manifests no início do plano/start; com o estado atual, os próximos são:

- Central: `006_f12_opportunity_catalog` após F7 `005`;
- tenant: `004_f12_opportunity_catalog` após F11 `003`.

### Central

Schema `opportunity_catalog` com tabelas para opportunity, immutable revision, provenance/source link, normalized projection, duplicate candidate/decision e outbox. Runtime separado em reader/writer; sem DELETE/TRUNCATE; archive por estado. Catálogo central não contém `organization_id` como ownership.

### Tenant

Mesmo schema lógico para private opportunity/revision/provenance/normalization/candidates, mais `organization_opportunity` para referência central ou privada exclusiva. RLS por `organization_id`, constraints XOR para referência central/private e outbox local. Nenhum conteúdo Central integral é copiado; apenas snapshot mínimo aprovado com `centralOpportunityId`, `centralRevisionId`, display fields necessários e digest.

Migrations são schema-qualified, versionadas, checksum/fingerprint e expand-compatible. Rollback só em PostgreSQL descartável e apenas se não apagar dados não sintéticos; runtime não tem DDL. Reads podem suportar schema/rules N/N-1 explicitamente; writes exigem versão corrente e nunca fazem upcast implícito.

## 9. Matriz F12-D1–F12-D32

| ID | Recomendação normativa | Impacto/risco residual |
| --- | --- | --- |
| F12-D1 | Confirmar F12 e o nome canónico atual. | Primeiro ID livre; criar registry futura evita colisões. |
| F12-D2 | Source-of-truth dividido Central/tenant. | Sem transação distribuída; reconciliação obrigatória. |
| F12-D3 | Contratos separados com snapshot comum v1. | Alguma duplicação controlada evita autoridade ambígua. |
| F12-D4 | Referência opaca + revision ID + snapshot mínimo. | Snapshot pode ficar antigo, mas é explícito/versionado. |
| F12-D5 | Adotar o schema fechado da secção 4.2. | Novos campos exigem versão, não JSON livre. |
| F12-D6 | Vocabulários versionados; códigos desconhecidos recusados. | Catálogos iniciais precisam de aprovação de produto. |
| F12-D7 | IDs externos únicos por namespace/source. | Fontes sem ID dependem de outras regras. |
| F12-D8 | Proveniência como entidade/link imutável. | Mais storage, melhor explicabilidade. |
| F12-D9 | Oito fatores + score derivado v1. | Score não determina autorização/publicação. |
| F12-D10 | Lifecycle e validation state ortogonais da secção 4.4. | Conectores futuros exigirão nova evolução. |
| F12-D11 | Archive/restore explícitos; restore sensível/MFA. | Sem delete; recuperação sempre auditada. |
| F12-D12 | Ownership pelo contexto; visibilidade por F5. | Creator não ganha acesso implícito. |
| F12-D13 | Sete permissions F5 exatas, zero grants. | Administração real continua indisponível sem grants. |
| F12-D14 | Onze event codes F7 exatos. | Payload mínimo pode exigir futuras versões. |
| F12-D15 | Dois jobs F9 infraestruturais; escrita manual síncrona. | Jobs não decidem merge humano. |
| F12-D16 | Signals/operations/métricas fechados da secção 6.4. | Sem alerta/SLO produtivo. |
| F12-D17 | F11 apenas em oportunidade privada. | Anexo Central fica adiado conscientemente. |
| F12-D18 | Normalização NFC/versionada v1. | Não faz equivalência linguística/fuzzy. |
| F12-D19 | Precedência aprovada concretizada nas regras fortes/sinais. | Corpus deve provar falsos positivos/negativos. |
| F12-D20 | Normalizadores específicos e preservação de original. | URL query/path permanecem conservadores. |
| F12-D21 | SHA-256 + JCS com domain separators. | Digest não é identidade nem assinatura. |
| F12-D22 | Sem threshold numérico/fuzzy em v1. | Menor recall, maior explicabilidade. |
| F12-D23 | `EXACT/POSSIBLE/DISTINCT`, conflito rebaixa para possible. | Não há merge automático destrutivo. |
| F12-D24 | Persistir candidatos/decisões; UI fora. | Revisão real depende de grants/UI futuros. |
| F12-D25 | CAS + idempotency digest interno. | Deadlocks/retries continuam possíveis e testados. |
| F12-D26 | Query port/keyset/filtros fechados da secção 7. | Pesquisa full-text avançada fica fora. |
| F12-D27 | Caps 32 KiB/16 KiB/32 itens/25–100/1 MiB/5 s. | Sizing produtivo continua gate futuro. |
| F12-D28 | Migrations Central 006 e tenant 004, revalidadas no start. | IDs mudam se outra migration entrar antes. |
| F12-D29 | Schemas/roles separados, RLS tenant e sem delete runtime. | Owner/superuser fora da garantia forte. |
| F12-D30 | Read N/N-1 explícito; write N apenas. | Deploy real continua fora. |
| F12-D31 | Corpus sintético fechado A/B, sem UBI. | Cobertura real de dados requer feature futura. |
| F12-D32 | Benchmark local reproduzível, sem SLO. | Sizing operacional não é inferido. |

## 10. Impacto nos 32 critérios

| Critérios | Estado após aprovação | Decisões principais |
| --- | --- | --- |
| F12-AC-01–03 | Completamente determinados | D2–D4, D28–D30 |
| F12-AC-04–07 | Completamente determinados | D5–D9, D18–D21 |
| F12-AC-08–10 | Completamente determinados | D9–D11 |
| F12-AC-11–14 | Completamente determinados | D18–D24 |
| F12-AC-15–16 | Completamente determinados | D21, D25 |
| F12-AC-17–20 | Completamente determinados | D2, D12–D13, D29 |
| F12-AC-21–24 | Completamente determinados | D14–D17 |
| F12-AC-25–27 | Completamente determinados | D26–D27, D30 |
| F12-AC-28–32 | Completamente determinados para implementação local | D28–D32 |

Nenhum critério fica comportamentalmente bloqueado para implementação local. Grants/administração reais, providers, tenants, sizing e rollout continuam gates externos e não impedem a vertical slice sintética.

## 11. Plano de testes recomendado

- Unitários: schema fechado, Unicode/NFC, URL, datas, decimal, JCS/digests, quality factors, lifecycle e dedupe table-driven.
- Contratos: F5/F7/F9/F10/F11, ports Central/tenant e matriz N/N-1.
- PostgreSQL 17 descartável: migrations Central/tenant, checksums/fingerprints, roles/RLS, constraints XOR, revision immutability, CAS, locks, deadlock/retry, outbox e restart.
- Adversariais: unknown fields, prototypes, SQL/identifier injection, URL Unicode/percent encoding, digest forgery, IDOR, organization A/B, central/private authority forgery e stale cursor.
- Concorrência: dois creates idempotentes, update stale, exact-match simultâneo e candidate pair reverso.
- F9: redelivery/replay/crash dos dois jobs, actor revogado e reconciliação incerta.
- F7: critical failure aborta mutação; deny permanece deny; observational reconciliável.
- F10: nenhum ID/texto/URL em labels/logs/spans; cardinalidade/overflow e health fail-closed.
- F11: attachment apenas privado, quarantined/unavailable recusado e ausência estrutural de filesystem.
- Benchmark: 10 000 normalizações/digests, 10 000 exact checks, paginação sobre 100 000 linhas sintéticas e concorrência controlada; resultados são baseline local.

## 12. Gates preservados

- Não há conectores, scraping, APIs, imports Excel/CSV, matching, qualificação, candidaturas, reporting, exports ou UI final.
- Não há R2/scanner reais, tenants provisionados, F4.4/F4.5, UBI, dados reais, staging, produção, rollout ou deploy.
- Não há eliminação física, retenção jurídica final, legal hold operacional, SLO ou sizing produtivo.
- Migrations futuras só podem executar em PostgreSQL 17 descartável até autorização separada.

## 13. Texto único para aprovação humana

> Aprovo conjuntamente F12-D1–F12-D32 conforme `context/research/f12-opportunity-catalog-decisions.md`: confirmo o identificador e nome **F12 — Catálogo de Oportunidades — núcleo manual, proveniência e deduplicação determinística**; adoto autoridade dividida, com catálogo/revisões/proveniência/deduplicação centrais na Central e oportunidades/revisões/proveniência/relações/deduplicação privadas no tenant, sem FK ou transação distribuída e com referências opacas, revision ID e snapshot mínimo versionado; aprovo contratos separados com snapshot v1 fechado, UUIDv7, revisões imutáveis, proveniência manual imutável, lifecycle `DRAFT/ACTIVE/STALE/ARCHIVED`, validation state `PENDING_REVIEW/VALIDATED_MANUAL/CONFLICT`, arquivo/restauro explícitos e qualidade v1 de oito fatores; aprovo normalização `opportunity-normalization-v1` com Unicode NFC, regras conservadoras por campo, originais preservados, URL segundo RFC 3986, decimal canónico, JCS/RFC 8785 e SHA-256 com domain separators para content/provenance/idempotency digests; aprovo deduplicação v1 sem fuzzy threshold, com regras fortes por external ID, programa+referência ou URL, conflitos rebaixados para `POSSIBLE`, sinais discretos para candidatos e classes `EXACT/POSSIBLE/DISTINCT`, sem merge destrutivo; aprovo sete permission codes F5 sem grants, onze event codes F7, dois jobs F9, signals/métricas F10 fechados e anexos F11 apenas em oportunidades privadas; aprovo CAS/rowVersion, idempotência, query port com keyset, filtros/ordenações allowlisted e caps de 32 KiB por payload, 16 KiB de texto, 32 itens por lista, página 25/100, resposta 1 MiB e timeout 5 s; aprovo migrations propostas Central `006_f12_opportunity_catalog` e tenant `004_f12_opportunity_catalog`, sujeitas a nova confirmação dos manifests no início da implementação, schemas/roles separados, RLS tenant, runtime sem delete/DDL, leitura N/N-1 explícita e writes apenas N; aprovo corpus e benchmark exclusivamente sintéticos e PostgreSQL 17 descartável, sem inferir SLO ou sizing produtivo. Esta aprovação permite promover F12 para `Ready` e elaborar o plano técnico, mas não autoriza implementação, migrations em bases persistentes, grants reais, conectores/imports, R2/scanner reais, F4.4/F4.5, dados reais, rollout ou deploy.

## 14. Texto sugerido para promoção posterior

Substituir a secção de decisões pendentes por:

> F12-D1–F12-D32 foram aprovadas conjuntamente em 2026-10-08 conforme `context/research/f12-opportunity-catalog-decisions.md`. A arquitetura usa autoridade source-local Central/tenant, snapshots/revisões/proveniência imutáveis, lifecycle e qualidade fechados, normalização NFC/JCS/SHA-256 versionada, deduplicação determinística `EXACT/POSSIBLE/DISTINCT` sem merge destrutivo, catálogos F5/F7/F9/F10 explícitos, F11 apenas para anexos privados, CAS/idempotência, query keyset limitada e migrations Central/tenant apenas para PostgreSQL 17 descartável. Não resta decisão comportamental para implementação local. Grants reais, providers, tenants, conectores/imports, sizing, F4.4/F4.5 e rollout permanecem gates futuros.

Promover o estado para `Ready` apenas após verificar novamente o contrato aprovado e elaborar o plano técnico componente a componente.
