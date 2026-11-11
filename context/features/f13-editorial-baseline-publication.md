# F13 — Publicação editorial da baseline organizacional

Estado do incremento: **Complete — fecho humano restrito aprovado em 2026-10-15**.
Decisão de âmbito registada em 2026-10-14. F13 integral permanece **In Progress**; nenhum AC integral é promovido. F12 permanece fechada no âmbito restrito do commit `0cf519ea22de929d2e52d0b3edb4d72364aa6220`.

## Fecho humano restrito — 2026-10-15

O GO restrito foi explicitamente aprovado. Fecha-se o incremento editorial F13/016: submissão e completude persistidas do recorte temático de drafts mistos, aprovação autorizada, versão imutável, publicação **inativa** e leitura autorizada. O finding temporal do guard está **resolvido**: a expiração da membership do aprovador limita o deadline existente; a prova PostgreSQL confirmou rollback no instante exato e após expiração, sem publicação, idempotência ou evento funcional persistidos e sem mudança de epochs.

A evidência de referência é `context/reviews/f13-016-temporal-guard/README.md`, preservada sem alterações. Antes do fecho documental, os **671 ficheiros** de `tested-snapshot.json` corresponderam aos hashes atuais, sem ficheiros adicionais no recorte; os **18 artefactos** de `artifact-hashes.json` também corresponderam integralmente. HEAD da prova e da conferência: `0cf519ea22de929d2e52d0b3edb4d72364aa6220`. Identidade dos manifestos conferidos:

- `tested-snapshot.json`, SHA-256: `d621e920181e72eba2de8ad041e35651a745d179eef838c79d57b1e512ee5d12`.
- `artifact-hashes.json`, SHA-256: `e14943e6935169ce80c2d86b2110a52011d2179bde0cb6a201ee262fd1aa6af2`.

Resultados aceites: **19** testes temporais novos; **110/110** focados, **761/761** backend, sintaxe **7/7** e whitespace do recorte PASS. Gates editorial PostgreSQL/HTTP A/B, F13/Central, F13-P1, F12 cumulativo/F9, importação F12 migration/funcional e UBI/Chrome PASS. Fingerprints 016 A/B, retorno 015 e autoridade Central constam da evidência. Esta ação apenas confere os hashes e regista a decisão; não repete testes nem altera os resultados históricos.

O fecho **não inclui ativação, snapshot READY ou consumo F14**. F13 integral permanece **In Progress**. A UI editorial ainda não está implementada; a sua especificação mínima será a próxima entrega, não iniciada nesta ação. Staging, produção, IdP externo e dados institucionais reais permanecem não validados; as provas locais e sintéticas não validam SLO ou fornecedores externos.

Os estados de revisão e menções a ausência de fecho nos registos abaixo e nos artefactos de evidência descrevem o momento anterior à decisão humana e são preservados como histórico. O estado vigente deste incremento é o fecho restrito registado acima.

## Histórico — correção temporal do guard (2026-10-15)

**Review — READY_FOR_HUMAN_REVIEW**, após correção e validação do finding temporal; sem fecho humano. Este registo prevalece sobre a lacuna identificada na revisão anterior. F13 integral permanece **In Progress**.

- Causa: `approvalEvidence.validUntil` era validado à entrada, mas não limitava o deadline protegido até ao commit. Um publisher distinto podia concluir depois da expiração natural da membership do aprovador, sem mudança de epochs.
- Resolução mínima: o deadline existente passa a incluir esse limite. Preservadas a validação inicial/interna e a validação final do executor; apenas `null` explícito significa ausência de prazo adicional. Campo omitido, valor inválido e prazo já atingido são recusados. O instante exato é expirado (`now >= deadline`). Sem approvalEvidence, os limites de sessão, MFA, lease e transação mantêm o comportamento anterior. Nenhuma migration, pin ou protocolo novo.
- Testes determinísticos novos: **19/19 PASS**, coordenador e executor reais com doubles declarados. Incluem expiração no limite e depois, recusa à entrada, sucesso 1 ms antes, cada limite anterior mais restritivo, consumidores sem approvalEvidence e valores inválidos. Mutação exclusivamente em memória que remove o novo limite provoca exatamente duas falhas de regressão (17 PASS/2 FAIL esperados).
- PostgreSQL 17 descartável: gate editorial **PASS**, com quatro probes temporais reais, A aprovador/B publisher, relógio aplicacional controlado e epochs inalterados. Nos casos exact/after, o hook ocorre depois dos INSERTs/seals e antes do assert final: guard **ABORTED**, zero publicação da versão e contagens de publicação/idempotência/evento funcional inalteradas. Evidência expirada à entrada não cria guard; caso válido termina **TENANT_COMMITTED**, com um efeito de cada tipo. HTTP limitado A/B e restantes provas editoriais também PASS.
- Validação final: focados **110/110**, backend **761/761**, sintaxe **7/7 JS** e whitespace do recorte **PASS**. Gates F13/Central (47 drifts ACL, duas warm e seis corridas nas duas ordens), F13-P1, F12 cumulativo/F9 (3/3), F12 import migration/funcional e UBI/Chrome **PASS**. UBI reconfirma `012→014→015→016→012→014→015→016`, sem materializar 013.
- Fingerprint 016 observado independentemente em A/B: `bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a`; down vazio confere exatamente o pin 015 `8c96af15c713ba36658d462e348ff3b69324042cd163bf426bb9b55353bec5ac`. Fingerprint de autoridade Central observado: `9e975a00c3f11a6a4b7995c954d3cb437407751b10d35789a597acd69b0e6581`.
- Evidência reproduzível em `context/reviews/f13-016-temporal-guard/README.md`: HEAD, manifesto SHA-256 de 671 ficheiros, comandos/resultados e logs sem credenciais. Docker inicialmente indisponível recuperou; todas as provas PostgreSQL acima foram efetivamente executadas. Revisão final read-only sem findings materiais remanescentes no delta.
- Limites: clock aplicacional controlado nos probes temporais, PostgreSQL real para persistência/rollback; fixtures sintéticas, sem IdP externo, staging, produção, dados UBI reais ou SLO. Sem UI nova, stage, commit, push ou deploy. Resíduos preexistentes preservados.

## Implementação e evidência local — 2026-10-15

Concluídas as etapas transacionais sobre os helpers da etapa 1, preservados: submissão com completion persistida, aprovação da candidatura exata, versão imutável, publicação inativa e leitura autorizada. `editorialSource`, `editorialRelease`, `editorialRepository`, `editorialService`, `editorialComposition`, adapters HTTP, auditoria e telemetria reutilizam F3/F4/F5/F7 e o guard Central. Não há ativação, snapshot READY, consumidor F14 ou nova UI.

### Persistência e operação

- Migration aditiva `016_f13_editorial_baseline_publication`: cinco tabelas editoriais append-only, FKs compostas, FORCE RLS, SELECT/INSERT apenas nas novas tabelas e SELECT nos dez catálogos técnicos necessários. Instalação owner-only de policy/projection/reason/purpose/manifest/bundle publicados; nenhuma taxonomia institucional fictícia. Runtime não administra policies. 013 continua RESERVED sem SQL/ledger; Central mantém 009, sem alteração às migrations fechadas.
- Up canónico: `18365bce636ff77a257b55724545711db33b12520d6b34e0f613c1a256b6331d`.
- Down canónico: `b3ed12fac21708f16bdb8d66a23f9d08d2f301dd3b313125f46bb1b785e5b87c`.
- Fingerprint tenant 016: `bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a`, calculado independentemente em A/B; downgrade vazio restaura exatamente o fingerprint 015 `8c96af15c713ba36658d462e348ff3b69324042cd163bf426bb9b55353bec5ac`. Down com dados editoriais é recusado atomicamente.
- Composição opt-in `PROFILE_EDITORIAL_RUNTIME=f13-editorial`, apenas com OIDC configurado; default `disabled`. Reutiliza o diretório, credenciais e pools API F4 existentes. Provisionamento explícito do agregado API com `c4g_opportunity_tenant_runtime`, `c4g_f4_metadata_executor` e `c4g_organization_profile_runtime`; sem identidade worker nova nem memberships implícitas. Binding valida a cadeia transitiva e ausência de privilégios adicionais. O resolver valida a tuple técnica publicada e suportada em cada operação preparada; não existe seleção por request/cache partilhada entre tenants.
- Rotas sob `/api/organization-profile/editorial`: POST `drafts/:id/submit` (201), POST `candidates/:id/approve` (201), POST `versions/:id/publish` (200), GET `candidates/:id` e `versions/:id` (200). F5 precede lookup: sem grant dá 403 para UUID existente/estrangeiro/ausente; leitor autorizado recebe 404 uniforme para estrangeiro/ausente. Requests fechados, erros allowlisted e nenhuma evidência de origem/autores exposta na projeção comum.
- Aprovação fixa subject/membership, versões e epochs de autoridade sem depender da sobrevivência da sessão antiga; publicação protege também os scopes do aprovador e revalida a aprovação. Todos os autores materiais/de seleção e o submissor permanecem impedidos. Replay e reconciliação voltam a autorizar e usam o resultado idempotente source-local.

### Verificações efetivamente executadas

| Verificação | Resultado e âmbito |
|---|---|
| `node --test test/f13EditorialMaterial.test.js test/f13EditorialRelease.test.js` | 27 testes incluídos nos focados PASS: extração/digests/autoria/completion e tuple ausente, ambígua, alterada ou incompatível |
| Focados com `productionCompositionParity.test.js` | 35/35 PASS; seleção root explícita, sem ligação na construção, apenas cinco rotas editoriais |
| `node --test test/f42TenantLeaseExecutor.test.js` | 33/33 PASS, incluindo avaliação de constraints pelo owner transacional e rollback da falha |
| `npm test` em backend, execução final | 742/742 PASS; zero failures/skips |
| `test/integration/f13/editorial-gate.ps1` | PASS: PostgreSQL 17 Central/A/B, 015→016 e down vazio, fluxo completo e HTTP sob login API NOINHERIT limitado |
| Negativos do gate editorial | PASS: INCOMPLETE persistido/não aprovável, CAS/replay concorrente, keys divergentes, autores múltiplos/remoção/reutilização/no-op, sessão rodada do mesmo humano, MFA stale, grants/membership revogados, aprovação stale, corridas de revogação nas duas ordens, referência cruzada, policy ausente em B sem fallback para A, ACL/RLS e down protegido |
| Integridade de drafts mistos | PASS: competências, experiência, ligação e verificação VERIFIED preservadas; edição exclusivamente excluída altera source digest, não editorialDigest; só autores do material/seleção temática e submissor fixados |
| Falhas e recovery editorial | PASS: falha F7 em submit/approve/publish sem efeitos parciais; uma confirmação de COMMIT perdida em cada operação; duas perdas sucessivas devolvem indisponibilidade e retry converge sem duplicar candidatura/evento |
| `test/integration/f13/migration-gate.ps1` | PASS: taxonomias e guard Central; 47 drifts ACL, duas drifts warm, seis corridas nas duas ordens, crash/recovery e Central 009 down/up |
| `test/integration/f13p1/migration-gate.ps1` | PASS com manifesto cumulativo 016, RLS, hierarquia, F5/F7 e idempotência |
| `test/integration/f12-import/migration-gate.ps1` | PASS: regressão histórica explícita 014→015→014, sem alterar SQL fechado |
| `test/integration/f12-import/functional-gate.ps1` | `F12_IMPORT_ENTRYPOINT_CENTRAL_AB` PASS: API/worker, redelivery e recusas preservados |
| `test/integration/f12/migration-gate.ps1` | PASS: manifesto atual de 16 entradas até 016, regressões F4/F7/F9/F11/F12; F9 PostgreSQL 3/3 PASS |
| `test/integration/ubi/private-opportunity-gate.ps1` | PASS com browser: Central/A/B sintéticos, cadeia 012→014→015→016→012→014→015→016, rollback SQL/ledger, seleção de organização e criar/editar/arquivar privados |
| Sintaxe/whitespace | `node --check`: 52 JS do recorte PASS. Whitespace do recorte PASS; diff global mantém apenas os três blank lines F13 preexistentes, não corrigidos por esta tarefa |

### Revisão, correções e limites

Revisão read-only final do recorte sem blockers materiais remanescentes. Findings corrigidos durante a implementação: CHECKs JSON que admitiam NULL passaram a exigir `IS TRUE`; ACL técnica explicitamente verificada no preflight; prova de autoria ignora intenções de leitura de evidência; escrita HTTP limitada avalia os seals diferidos do authoring antes de RESET ROLE, exclusivamente no executor F4 (o módulo continua proibido de controlar constraints/transações). Regressões unitária e PostgreSQL/HTTP repetidas após esta última correção passaram.

As falhas intermediárias de fixtures foram corrigidas sem enfraquecer segurança: binding de sessão/coordinator da fase HTTP; sessão original invalidada por rotação; checker independente para verificação de competências, que mantém a SoD da fatia 4; F13-P1 cumulativo passou a criar a role grantless requerida por 015. UBI foi adaptado à transição adicional 016, mantendo o browser flow integral. Não são novos requisitos institucionais.

Sem validação de staging, produção, rollout, IdP/fornecedores externos ou dados UBI reais; sem ensaio de carga/SLO deste incremento. O gate UBI utiliza frontend residual já existente, preservado, e sessões sintéticas Central, não identidade externa. Não se repetiram suite/build frontend: não há mudança frontend nesta entrega. Limites estruturais e timeouts existentes permanecem fail-closed; não se afirma cobertura de históricos ilimitados. A instalação/configuração/grants reais continuam operações de deployment não executadas.

Índice vazio, HEAD/branch preservados, sem stage/commit/push/deploy. Os helpers da etapa 1, frontend legacy, configuração local, whitespace F13 e reversão documental F12 foram preservados. Os recursos descartáveis próprios dos gates foram removidos; recursos preexistentes não foram tocados. F13 integral permanece **In Progress**; este incremento aguarda apenas revisão/fecho humano, não está formalmente fechado.

## Aprovação e precedência

Foram aprovadas explicitamente três escolhas:

1. Extração editorial fixa de temas/prioridades de drafts mistos, preservando separadamente identidade integral da origem e conteúdo publicado.
2. Uma policy produtiva `F13_EDITORIAL_THEME_REQUIRED_V1`: temas KNOWN obrigatórios; prioridades KNOWN ou UNKNOWN explícito; máximo conjunto de 100 itens; ausência/vazio INCOMPLETE.
3. Autoria limitada ao material incluído, acrescida do submissor no conjunto impedido de aprovar/publicar. O mesmo checker pode aprovar e publicar com grants e requisitos próprios.

Este contrato aplica as decisões committed de lifecycle, completion, conhecimento, autorização, confidencialidade e compatibilidade. As propostas C1–C9 da fatia 9 no worktree não são incorporadas. A migração UBI não condiciona este incremento. Os detalhes abaixo concretizam as escolhas aprovadas, sem criar variantes por cliente.

## Evidência de partida e fronteiras (anterior à implementação)

- `authoringContracts.js` admite THEMATIC_AREA/STRATEGIC_PRIORITY, KNOWN/UNKNOWN e 100 itens. Migration 008 persiste item versions, conjuntos por revisão, ator, membership, lifecycle e semantic_digest; os itens são UNVERIFIED/CLEAR/INTERNAL por CHECK.
- `authoringRepository.js` calcula digest de scope/items e, quando composto, competencyMaterial. `competencyRepository.js` também cria revisões do mesmo draft; `competency_revision_member` fixa ASSERTION/EXPERIENCE/LINK/VERIFICATION. Não recusar drafts por estes membros existirem.
- Financeiro, operacional e populações possuem heads/revisões próprios; não são campos do draft temático nem impedem uma publicação temática por existirem.
- `007_f13_profile_catalogs_and_policies` já contém completion_policy/slot/rule, compatibility_manifest e release_bundle imutáveis após publicação. Não existe ainda resolver de publicação editorial, associação operacional tenant→policy ou evaluator de completion deste fluxo.
- `resourceAuthorization.js` aplica SoD por distinctFromActorIds/actor.id e membership.globalUserId; a composição usa autoridade autenticada e o coordinator Central existente. O catálogo possui APPROVE/PUBLISH/READ; presence no catálogo não significa que o fluxo esteja implementado.

## Schema e cobertura

Schema `F13_ORG_EDITORIAL_BASELINE`, versão `1.0.0`; extractor `F13_THEMATIC_CUT_V1`; scope ORGANIZATION exclusivamente. Uma versão editorial não é snapshot efetivo.

| Slot | Conteúdo | Completion |
|---|---|---|
| thematicAreas | 1–100 itens KNOWN, conceito/scheme/release exatos | obrigatório; UNKNOWN não satisfaz |
| strategicPriorities | 1–100 KNOWN ou exatamente um UNKNOWN sem conceito | obrigatório; não misturar marcador UNKNOWN com KNOWN |
| conjunto | até 100 itens; item/version únicos; conceito/release não duplicado no domínio | ausência/lista vazia INCOMPLETE |
| origem | draft/revisão/digest integrais e scope da organização | obrigatório; integridade verificada |

NONE/NOT_APPLICABLE não são admitidos por esta policy e não são convertidos. UNKNOWN deve existir explicitamente na origem. Ausência não gera item nem estado. Falhas de cardinalidade/conteúdo são findings; estrutura inválida é recusada antes da submissão.

Coverage é constante do schema: includedDomains=[STRATEGIC_PRIORITY,THEMATIC_AREA]; excludedDomains=[COMPETENCY,CONSTRAINT,EXPERIENCE,FINANCIAL,OPERATIONAL,SERVED_POPULATION,TARGET_GROUP,TERRITORY]; scopeType=ORGANIZATION; constraintsAssessed=false; effectiveSnapshot=false; f14Consumable=false. Arrays lexicograficamente ordenados. A exclusão identifica domínio não avaliado, não ausência de factos/restrições. Não devolver constraints=[] como declaração institucional.

A extração inclui TODOS os itens dos dois domínios da revisão, sem seleção pelo request. Material de outros domínios permanece na origem; não copiar, apagar, verificar ou publicar esse material. Coverage deve aparecer na leitura e no material autorizado apresentado ao checker, sem divulgar se existem factos excluídos. Não há motor genérico de projeções.

Preservar knowledge/verification/conflict/classification persistidos dos itens incluídos. Nesta origem são UNVERIFIED/CLEAR/INTERNAL; approval não verifica factos. Não usar defaults para substituir metadata ausente. Material VERIFIED ou restrito noutros agregados mantém estado/evidência intactos. Uma futura tuple que admita esses estados em itens temáticos terá de preservar evidência/classificação; esta entrega não os rebaixa nem reescreve CHECKs anteriores. INTERNAL é tenant-local autorizado, nunca PUBLIC.

## Entidades e estados

Reutilizar profile_scope, profile_draft, profile_draft_revision, profile_revision_item/profile_item_version, competency_revision_member e catálogos existentes. Acrescentar no schema organization_profile, com organization_id, FKs compostas, FORCE RLS e leitura tenant-scoped:

- `editorial_candidate`: UUID, source draft/revision/digest, extractor/schema refs, bundle/manifest/policy refs e digests, canonical editorial content, editorial_digest, candidate_digest, submitter_subject_id e completion record. Insert-only. Unique organização+source revision+extractor (uma submissão fixa a policy, não oferece escolha posterior).
- `editorial_candidate_author`: conjunto append-only de subjects impedidos, com reason MATERIAL/SELECTION/SUBMITTER e evidência exata de item versions/revisões/transições. Parte da identidade da candidatura.
- `editorial_version`: UUID, candidate_id/digest, approval record e evidence, approved_at, conteúdo por referência imutável à candidatura. Unique candidate_id; insert-only.
- `editorial_publication`: UUID, version_id, publication evidence e timestamp; unique version_id; insert-only. Ausência/presença deste registo deriva APPROVED/PUBLISHED. Não atualizar o conteúdo da versão para publicar.
- `editorial_idempotency_record`: organization/operation/key unique; intention_digest, resultado mínimo e referência de authority/recovery. Insert-only, protocolo existente.

Candidate é SUBMITTED com completion COMPLETE ou INCOMPLETE. Uma versão existe apenas após approval. Versão PUBLISHED continua inativa; não há ponteiro ativo, activation record, snapshot READY, scheduler ou F9 novo. Não introduzir reject/reopen/archive/restore nesta entrega. Corrigir exige novo draft e submissão; drafts submetidos já não são editáveis. Não há delete funcional.

## Canonicalização e digests

Usar SHA-256 sobre UTF-8 do canonicalizador F13 existente: keys ordenadas, strings NFC válidas, números inteiros seguros, limites existentes de 256 KiB/profundidade 12; arrays com ordem explicitada abaixo. Sem localeCompare para ordenação nova, timestamps variáveis ou labels no conteúdo semântico. Tags de domínio evitam colisão entre tipos de digest.

### Origem integral

`sourceRevisionDigest` é o semantic_digest já persistido. Reconstituir e verificar com o algoritmo ORIGINAL dessa revisão: scopeType, scopeId, items ordenados e competencyMaterial quando integrado pelo produtor. Não modificar o hash existente, introduzir nova ordenação retroativa ou acrescentar campos. Fixar o produtor/versão de contrato que permite reproduzi-lo; se a evidência não permite identificar/reproduzir o contrato, falhar SOURCE_INTEGRITY_UNAVAILABLE. IDs/membros excluídos são lidos apenas no caminho interno autorizado e não expostos ao leitor temático.

### Conteúdo editorial

`editorialDigest = SHA256(canonical({kind:'F13_EDITORIAL_CONTENT_V1', schema:{id,version}, extractorVersion, scopeType:'ORGANIZATION', coverage, items}))`.

Cada item contém exatamente: itemId, itemVersionId, domain, knowledgeStatus, verificationStatus, conflictStatus, confidentialityClass, conceptRef. conceptRef é null em UNKNOWN; em KNOWN contém conceptId, schemeId, releaseId, releaseVersion, releaseDigest e ownerOrganizationId (null para global). Items ordenados por domain/itemId/itemVersionId, usando comparação ordinal. Preservar referências resolvidas, não labels mutáveis. Como a origem temática não tem evidência factual própria, não fabricar verification/evidence refs.

Excluídos do digest editorial: draft/revision/source digest, submitter/autores, eventos/timestamps, organização de execução, policy/bundle, resultado de completion e todo competencyMaterial. A organização proprietária de conceitos locais continua em conceptRef. Assim, mudanças só em domínios excluídos não alteram este digest; alterações de item version ou release incluída alteram-no. Não é um hash público nem mecanismo de comparação entre tenants.

### Candidatura e completion

`candidateDigest = SHA256(canonical({kind:'F13_EDITORIAL_CANDIDATE_V1', organizationId, profileScopeId, source:{draftId,revision,digest,producerContract}, editorialDigest, schemaRef, extractorVersion, policyRef, bundleRef, manifestRef, submitterSubjectId, authors, completionDigest}))`.

Refs de policy/bundle/manifest incluem ID/versão/digest. authors são subjects ordenados ordinalmente, cada um com reasons e evidenceRefs ordenados; nada vem do caller. candidateId é identificador opaco, não entrada no hash. Mudança apenas em material excluído pode conservar editorialDigest, mas muda origem/candidateDigest.

Completion record fixa schema/policy, editorialDigest, referências verificadas, COMPLETE|INCOMPLETE e findings ordenados por slot/item/code. completionDigest cobre exatamente esses campos, não timestamp/actor/candidateDigest (sem ciclo). Codes fechados: REQUIRED_SLOT_MISSING, KNOWN_REQUIRED, INVALID_CARDINALITY, STATE_NOT_ALLOWED, DUPLICATE_CONCEPT, REFERENCE_INCOMPATIBLE, NON_CURRENT_MATERIAL; UNKNOWN_EXPLICIT é informativo. Não inserir reason institucional fictício para UNKNOWN. Findings não contêm labels/valores protegidos.

## Reconstrução e fixação de autoria

Não usar apenas actor da revisão final. Carregar a cadeia append-only até à revisão submetida, conjuntos de item versions e registos de intenção que distinguem create/edit/submit das operações de competência. Validar sequência e digest antes de derivar autoria.

1. Para cada item incluído, fixar o actor_subject_id da versão persistida; não confiar no actor de uma tentativa que apenas reutilizou essa versão.
2. Comparar o conjunto temático entre revisões adjacentes: inclusões, remoções ou substituições são decisões de seleção material. Incluir atores das transições temáticas efetivas da linhagem do draft; inclusive remoção, pois altera o conjunto publicado. Não incluir no-op, simples submit nem transição que altere somente competencyMaterial. Este conjunto conserva a autoria da seleção, não afirma autoria factual sobre todos os conceitos.
3. Atores que criaram exclusivamente conteúdo excluído não entram por essa razão. Autores de catálogo/documento não entram por mera referenciação.
4. Acrescentar o submissor confiável, mesmo sem edição, como SUBMITTER. O checker de aprovação não passa a autor por aprovar.
5. Persistir candidate_author com actor subject, revision antes/depois, IDs das item versions afetadas e tipo da contribuição. Checker recebe só metadata autorizada necessária à decisão; autoria completa permanece protegida.

A persistência atual permite reconstruir conjuntos/atores e identificar operações por idempotency records, mas NÃO fixa hoje a autoria de um recorte editorial. A extensão mínima é candidate_author com evidência derivada na mesma transação; não é necessário reescrever revisions nem atribuir autoria ao último editor. Se faltarem revisões, operation evidence ou binding de identidade, recusar AUTHORSHIP_EVIDENCE_UNAVAILABLE; não preencher por inferência. Não inventar backfill de autores.

`actor.id` é o globalUserId resolvido pela autoridade F3/Central, confirmado contra membership.globalUserId pelo adapter F5. Persistir esse identificador estável, não membership/session/email/sub externo cru. Várias sessões da mesma identidade global comparam iguais; a identidade pode conservar memberships removidas como histórico, mas só uma membership não removida. Mapeamento de identidades externas continua a responsabilidade F2/F3; identidade não reconciliada não ganha equivalência por email. Se não houver binding humano confiável, recusar antes do efeito. Resource loader fornece distinctFromActorIds a F5; reutilizar o modelo existing, acrescentando as regras lifecycle ao catálogo de autoridade quando necessário, nunca bypassando SoD. Service actors não aprovam/publicam.

## Policy, schema e bundle iniciais

Uma única policy produtiva: F13_EDITORIAL_THEME_REQUIRED_V1, immutable PUBLISHED, profile schema 1.0.0, scope ORGANIZATION, domain EDITORIAL_BASELINE. Slots/rules usam completion_policy/slot/rule existentes. A verificação permite UNVERIFIED sem promover estado; completeness é do recorte, não de F13 integral.

Schema/extractor são contratos fechados da release em código. Provisionar a policy técnica, slots/rules, reason/projection refs e compatibility manifest/release bundle através de instalação versionada owner-only da release, na migration aditiva, usando tabelas/guards existentes: inserir membros enquanto DRAFT, validar digests/tuple, publicar por último, tudo atomicamente. São dados técnicos aprovados, NÃO conceitos/taxonomias institucionais fictícios. Não existe hoje endpoint de publicação de completion policies a reutilizar; não criar administrador genérico nem grants de runtime para editar esses objetos.

Resolver por tenant lease preparada + schema/scope/domínio + tuple explicitamente suportada pelo writer. Exigir exatamente uma policy PUBLISHED da release corrente com digest correto. Zero ou mais de uma: POLICY_UNAVAILABLE, sem fallback/latest/seleção pelo request. Uma segunda policy só existe em bundle de testes, excluída da allowlist de produção. Reutilizar release_bundle: snapshot_schema_version identifica o contrato de wire de versão editorial nesta tuple, sem produzir um effective snapshot; consumer contract declara editorial-only e f14Consumable=false. Consumidores F14 não podem aceitar esta tuple. Não presumir produto cartesiano de versões.

## Operações, dados fixados e transações

Submissão editorial é adapter dedicado da operação F13_PROFILE_SUBMIT, sem alterar a semântica das chamadas de authoring anteriores nem criar um segundo subsistema de autorização. Inicialmente admite apenas DRAFT ORG; não importar automaticamente submissões históricas. Captura source revision criada pela submissão na MESMA transação que candidate/completion/authors/F7/idempotência. Não chamar uma composição que faça commit intermédio.

| Operação | Pré-condições atuais | Efeito atómico |
|---|---|---|
| SUBMIT | F3/F4/F5; expectedRevision=head DRAFT; scope ORG; source íntegra; resolver único | revisão SUBMITTED + candidatura/evidência imutável; INCOMPLETE pode ser submetido, não aprovado |
| APPROVE | candidate digest esperado; source imutável íntegra; COMPLETE; tuple/references admissíveis; não autor/submissor; RECENT_MFA | versão APPROVED e approval evidence vinculada ao subject/membership/authorization/assurance atuais |
| PUBLISH | versão APPROVED; digest esperado; approval ainda válido; grant próprio, SoD e MFA atuais | publication record unique; nenhum efeito de ativação |
| READ | F13_PROFILE_READ sobre projeção da candidatura/versão tenant-local | versão/coverage/completion autorizados; acesso não concede leitura da origem integral |

Na aprovação/publicação repetir F3, tenant binding/capability, F5, SoD, MFA, compatibilidade da tuple exata, integridade dos digests e admissibilidade atual das referências. Na publicação validar também a evidência de aprovação: membership/authorization versions e guard de aprovação não revogados/incompatíveis, sem exigir que a sessão antiga permaneça aberta nem renovar retroativamente o MFA do approval. Publisher apresenta MFA atual. Aprovação invalidada exige nova candidatura/aprovação neste recorte; sem reapprove in-place.

Reavaliar completion com a MESMA policy e conteúdo fixados, comparando resultado/digest; não trocar pela policy mais recente nem relabelar conceitos. Se referência/tuple perdeu admissibilidade, recusar publicação e preservar aprovação/histórico. Revalidar acesso é distinto de reinterpretar conteúdo.

Draft submetido não pode ser editado. Correção exige novo draft; origem/candidatura/versão anteriores permanecem. Outro draft não invalida por si só a candidatura aprovada. Publicação não é pública: leitura autorizada usa projeção INTERNAL exata deste recorte; não expõe source digest, authors nem evidência F5 integral ao leitor comum. Checker pode consultar evidência necessária sob a sua operação de aprovação, sem novo grant genérico para material excluído.

Locks seguem a ordem existente: scope F13-P1, intenção, draft/candidate/version; CAS no head da submissão, digest esperado nas operações imutáveis e unique constraints nos efeitos. Duas aprovações/publicações concorrentes convergem para um efeito: mesma key/intenção faz replay; key diferente após efeito devolve STATE_CONFLICT. Intention digest inclui organização/operação/recurso/expected revision ou digest, sem timestamps/session; actor é autorizado novamente antes de replay. Key com intenção divergente: IDEMPOTENCY_CONFLICT.

Reutilizar coordinator/authority guard Central e idempotência tenant. Guard deve cobrir também evidência de approval no publish, evitando revogação entre check e commit. F7 crítico e efeito usam o mesmo client preparado. Falha de auditoria reverte versões, publication, candidate e resultado idempotente dessa operação. COMMIT incerto não significa sucesso nem rollback: reconciliar pelo registo source-local e guard; retry mantém key, reautoriza e não duplica efeito/F7. Não criar fila ou recovery paralelo.

## HTTP e erros sanitizados

Adapter autenticado sob `/api/organization-profile/editorial`; contexto organizacional vem da seleção F3 existente, nunca de body/tenant/role. Reject unknown input fields. UUIDs opacos; sem campos livres de selection, policy, authors ou schema.

| Método/rota | Body fechado | Resposta |
|---|---|---|
| POST /drafts/:draftId/submit | expectedRevision, idempotencyKey | 201 candidateId, sourceRevision, candidateDigest, coverage, completion autorizado |
| POST /candidates/:candidateId/approve | expectedCandidateDigest, idempotencyKey | 201 versionId, versionDigest, state APPROVED |
| POST /versions/:versionId/publish | expectedVersionDigest, idempotencyKey | 200 versionId, state PUBLISHED, active=false |
| GET /candidates/:candidateId | nenhuma seleção | 200 projeção autorizada + completion |
| GET /versions/:versionId | nenhuma seleção | 200 conteúdo editorial/coverage/estado + completion |

versionDigest é candidateDigest fixado na aprovação (sem confundir com editorialDigest). Digests de candidatura/versão apresentados apenas a callers autorizados para a respetiva decisão; GET comum não devolve hashes de origem/autoria. Replay autorizado mantém IDs e status de sucesso originais. Sem endpoints de ativação/archive/exports.

401 sessão inválida; 403 grant/MFA/SoD negados sem depender da existência de recurso; 404 RESOURCE_NOT_AVAILABLE uniforme para recurso inexistente/foreign/inacessível; 400 input estrutural inválido; 409 STALE_REVISION, STATE_CONFLICT, IDEMPOTENCY_CONFLICT, COMPLETION_INCOMPLETE, APPROVAL_STALE ou REFERENCE_INCOMPATIBLE apenas após autorização; 503 POLICY_UNAVAILABLE, AUTHORSHIP_EVIDENCE_UNAVAILABLE, SOURCE_INTEGRITY_UNAVAILABLE, AUTHORITY_UNAVAILABLE, AUDIT_UNAVAILABLE ou RECONCILIATION_REQUIRED. Backend não expõe SQL, hosts, actors, catálogo interno, origem ou stack. Findings completos só na projeção autorizada; respostas negativas não permitem distinguir UUID foreign de inexistente. Mapeamento por allowlist, não regex que transforme recusa F5 em 503.

## Auditoria mínima

Reutilizar PROFILE_DRAFT_SUBMITTED, PROFILE_VERSION_APPROVED, PROFILE_VERSION_PUBLISHED e PROFILE_ACCESSED. Um evento funcional por efeito, não por item/finding; F5 mantém eventos de decisão próprios. Reutilizar a política de access audit para READ, sem adicionar uma mutação editorial por leitura. Acrescentar payload schemas e allowlists à release, sem modificar significado histórico dos eventos anteriores.

Payload fechado: event/schema version, operation/resource, actor e membership confiáveis, correlation/idempotency, previous/new revision/version, candidate/version opaque refs, schema/policy/bundle refs, completion result e detail/reason codes seguros. Autoridade/assurance seguem envelope F7 existente. Não transportar temas, labels, listas de autores, documentos, source/editorial/candidate digests confidenciais ou conteúdo integral; digest do evento cobre metadata técnica sanitizada. Completion digest/relatório e evidência SoD permanecem tenant-local protegidos. F10 só operation/resultClass, sem IDs ou cardinalidades sensíveis.

## Sequência aprovada de implementação (executada acima)

1. Contratos fechados de extração/digests/completion/autoria + fixtures unitárias; conservar os contratos antigos.
2. Migration tenant aditiva posterior a 015 (candidata 016, confirmar número livre na execução): entidades/constraints/RLS/ACL mínimas, schemas/eventos e instalação técnica governada. Não reutilizar 013 RESERVED, não reescrever 007–015 nem Central 009. Down recusa dados protegidos; só remove objetos/instalação técnica próprios quando seguro.
3. Repository/loaders/services sob mesma transação, resolver de bundle/policy, integração F5/guard/idempotência existentes; reforçar binding de approval evidence sem nova arquitetura Central.
4. Adapter HTTP e leitura autorizada, startup/capabilities/manifest/preflight/fingerprint/ledger; sem UI ou mudanças frontend nesta entrega.
5. Unitários/HTTP/gates PostgreSQL A/B, testes de regressão das fatias anteriores e revisão read-only antes de fecho humano. Pins só se calculam após SQL final e provas, nunca nesta especificação.

## Aceitação obrigatória

- Draft misto com temas/competências/experiência/verificações: só temas/prioridades entram no conteúdo; origem e todos os agregados excluídos permanecem intactos. Mudança excluída mantém editorialDigest e altera source/candidate identity; reordenação semântica canónica não altera editorialDigest.
- Autoria multi-editor, item version reutilizada, remoção/seleção, no-op e edição exclusivamente de competência: conjunto SoD deriva da evidência, não do último editor. Fonte inconsistente é recusada. Submissor não editor é impedido; checker pode aprovar e publicar, com dois grants/MFA próprios, sem terceira pessoa.
- Organizações sintéticas A/B com conceitos locais e perfis distintos: nenhuma referência, membership/grant, decisão, candidate/version ou completion result cruza tenants. Mesmo humano com memberships A/B mantém SoD; sessões distintas não contornam regra.
- Bundle alternativo exclusivamente de teste comprova resolução por base tenant e nenhuma cache/fallback cruzada; policy alternativa nunca entra na allowlist produtiva. Zero/duas policies compatíveis falham fechado.
- Themes KNOWN + priorities UNKNOWN passa; ambos conhecidos passam; temas UNKNOWN, ausência/vazio, mistura UNKNOWN/KNOWN, duplicados e >100 itens não aprovam. NONE/NOT_APPLICABLE não são convertidos. F13 integral não é declarada completa.
- Preservar UNVERIFIED/INTERNAL explícitos; approval não verifica; material VERIFIED/restrito excluído não muda. Metadata de cobertura não revela existência de factos excluídos.
- Revogação de sessão/membership/grant, assurance stale, SoD, source digest inconsistente, tuple/release inválida e aprovação stale recusam sem efeitos parciais. Corridas de revogação/commit nas duas ordens sob guard real.
- CAS concorrente; replay concorrente; keys divergentes; COMMIT confirmado/perdido/duas perdas; falha F7 e crash/recovery: um efeito e um evento, sem falso sucesso ou duplicação.
- HTTP IDOR uniforme, nenhuma seleção caller de tenant/policy/autores; sem logs/payloads sensíveis. Published pode ser lido com grant e permanece inativo; nenhuma referência consumível F14 ou snapshot READY criado.
- Runner canónico upgrade/downgrade seguro, checksums/manifests/fingerprint coerentes, RLS/ACL negativos e rollback integral. Fixtures não validam IdP externo, staging, produção ou dados institucionais reais.

## Bloqueios e exclusões

Não resta escolha de produto aberta nem bloqueio concreto de implementação para este recorte. Implementação integrada validada localmente e pronta para revisão humana; não equivale a fecho formal nem a validação produtiva. Ausência de catálogo institucional publicado limita dados produtivos, não o desenvolvimento com fixtures sintéticas. Binding humano, bundle/policy ou evidência de autoria ausentes são recusas runtime, não autorização para defaults.

Fora: C1–C9, constraints PROHIBITED/UNAVAILABLE (continuam âmbito futuro), activation/coortes/READY, overlays, archive/restore, matching, UI nova, migration UBI, seed institucional fictício, forks por cliente, alteração de arquitetura de tenancy e reabertura F12.
