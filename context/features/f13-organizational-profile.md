# F13 — Perfil organizacional para matching

## Incremento em revisão — publicação editorial da baseline (2026-10-15)

As três escolhas de recorte, completion policy única e autoria/segregação foram aprovadas humanamente. O incremento está **Review — READY_FOR_HUMAN_REVIEW**, sem fecho formal, com contrato/evidência em `context/features/f13-editorial-baseline-publication.md`: fluxo transacional e HTTP integrado entregues, migration aditiva 016 e instalação técnica governada, source/editorial/candidate digests separados, autoria persistida, SoD/MFA/guard Central e recovery source-local. Abrange extração fixa de temas/prioridades de drafts mistos, submissão/completion, aprovação e publicação imutável/inativa, leitura autorizada e cobertura limitada explícita; sem constraints ou consumo F14. Não depende da migração UBI. F13 integral permanece **In Progress**; fechos restritos anteriores e estados dos AC são preservados. Não autoriza activation/READY, overlays, archive/restore, UI ou C1–C9.

Validação local desta entrega: focados F13/root 35/35, executor 33/33 e backend 742/742 PASS; gates editorial Central/A/B/HTTP, F13/Central, F13-P1, F12 migration/funcional/cumulativo e UBI/browser PASS. Sintaxe 52 JS e whitespace do recorte PASS; três blank lines residuais preservados. Fingerprint 016 `bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a`; up/down e limites constam no contrato. Revisão read-only sem blockers materiais após correções e regressões. Não valida staging, produção, rollout, fornecedores/IdP externos, dados UBI reais ou SLO. Não houve stage, commit, push ou deploy; aprovação do fecho continua humana.

### Fatia 8 — fecho formal restrito (2026-10-11)

**Fecho humano explícito: fatia 8 formalmente fechada no âmbito restrito aprovado.** Esta decisão sucede à correção de F13-S8-R1-001 e à revisão formal read-only repetida, com **sem findings bloqueadores** e sem novos problemas materiais. Fecha apenas territórios, beneficiários-alvo e populações servidas ORG-only; não fecha a feature F13, não aprova rollout nem inicia outra fatia. As secções Review abaixo passam a evidência histórica pré-fecho.

- **F13-S8-R1-001: corrigido, revalidado e encerrado.** Replay VERIFY mantém maker-checker sobre material anterior à operação originalmente auditada, nova autorização F3/F5/F11 e assurance atuais. Reprodução independente em PostgreSQL real confirmou fluxo normal e COMMIT incerto sem erro no replay, com três revisões totais (CREATE/SUBMIT/VERIFY), um F7 VERIFY e um registo idempotente por operação. Revogação de sessão, membership e grants/versões continua a impedir replay sem nova mutação/F7/idempotência; MFA e DOCUMENT_READ ausentes/stale/revogados permanecem recusados nas provas do gate.
- Evidência final já executada: testes da fatia **15/15**, focados **409/409**, backend **673/673**; gate de populações repetido **PASS**, gates F13/Central, F13-P1 e F12 **PASS**, F9 PostgreSQL **3/3**. Runner canónico **011→012→011→012 PASS**, down com dados protegidos recusado. Revisão read-only e prova independente não alteraram nenhum dos 147 ficheiros do snapshot. `node --check` nos 123 JS, `git diff --check` e scans passaram nos limites documentados; recursos descartáveis próprios removidos, recursos preexistentes preservados. Estes testes não são reexecutados nesta ação exclusivamente documental.
- Tenant `012_f13_territories_and_populations` mantém os pins canónicos: Up `4f3972e42a292678b45e86d690aca7410155f17dee7fedfc275a88837c984cd8`; Down `1ff268c9a0b0502c93858ff14e5314fc8075f25e670b909d3732e610ab5b0396`; Fingerprint `0558700553db2170ee60565b92339f5556f603d4108c9273d476b960cb1460c3`. Nenhuma alteração a migrations, manifests ou pins.
- **Estados preservados:** F13 **In Progress**; AC-13 e AC-15 **PARTIAL**; AC-14, AC-16 e AC-17 **PENDING**; restantes critérios inalterados, nenhum promovido. Catálogos editoriais/geográficos/taxonomias/fontes e governação produtiva, IdP externo/provider/diretório, rollout e SLO permanecem pendentes. Fixtures sintéticas não aprovam conteúdo editorial nem integração externa.
- **Limites preservados:** sem mapas/geocoding/inferência territorial, estimativas, pessoas/identificadores individuais, thresholds/supressão inventados, agregações/rollups, eligibility/matching, lifecycle/aprovação/publicação do perfil, snapshots/activation ou frontend. Não autoriza uma nova migration ou fatia. Esta ação altera exclusivamente os dois documentos de contexto; sem alterações funcionais, commit ou stage.

### Fatia 8 — correção F13-S8-R1-001 (2026-10-11)

**Estado histórico pré-fecho: Review, F13-S8-R1-001 corrigido e revalidado nas provas abaixo.** A revisão anterior identificou falha HIGH no replay VERIFY e na recuperação de COMMIT incerto: o checker era incluído no histórico material da sua própria operação. A prova específica desta correção substitui a ausência desse caso na evidência histórica abaixo, sem autorizar fecho automático. Correção restrita ao loader/service de populações e testes; nenhuma migration/pin alterada.

- Sob o lock do head e da intenção, o loader resolve organization/POPULATION_VERIFY/key no registo idempotente append-only, confirma assertion/revisão/operation VERIFY/state VERIFIED, carrega a revisão SUBMITTED anterior e limita a autoria material/documental a esse histórico. A fronteira não vem de expectedRevision do caller. O digest calculado pelo repository é confrontado com o registo; divergência falha após F5, sem devolver o resultado. F3/F5/F11, membership/policy/assurance atuais e guard Central continuam obrigatórios antes de qualquer replay/reconciliação. Não há exceção maker-checker: maker permanece recusado e documents originais mantêm DOCUMENT_READ cumulativo/exato mesmo após avanço do head.
- `node --test test/f13TerritoriesAndPopulations.test.js`: **15/15 PASS**. Focados `^f(3|4|5|7|13).*test.js`: **409/409 PASS**. Suite backend `npm test`: **673/673 PASS**, zero failures/skips.
- `test/integration/f13/population-gate.ps1`: **PASS**, PostgreSQL 17, Central e dois tenants reais, composição/engine F5 produtivos. VERIFY normal e concorrente com mesma key, COMMIT real seguido de confirmação perdida e duas confirmações perdidas: uma revisão VERIFY, um evento F7 e um resultado idempotente por operação; a segunda perda não retorna falso sucesso. Maker, digest/CAS divergente, grant revogado, handle stale após avanço F5, MFA ausente/stale e DOCUMENT_READ revogado continuam recusados sem nova escrita/F7/result. Retry histórico mantém referências F11 originais inclusive após REVOKE. Protocolo Central recupera o resultado COMMITTED; não foi criado mecanismo paralelo.
- Gates `test/integration/f13/migration-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS**. F13/Central: 47 drift cases, duas drifts warm, seis corridas nas duas ordens, crashes/recovery e downgrade 007. F12: vazio e upgrades 003/004/005/006→012; F9 PostgreSQL **3/3 PASS**. Runner de populações mantém **011→012→011→012**, protected down recusado e mesmos pins canónicos abaixo.
- `node --check`: **123 JS PASS**; `git diff --check`: **PASS**. Scan de private/provider keys, URLs PostgreSQL e emails: zero novos candidatos; 19 referências URL preexistentes são fixtures sintéticas/templates loopback com segredo aleatório runtime; zero candidatos de email. Não é garantia universal de ausência de PII. Snapshot de 147 ficheiros confirma apenas seis alterações desta correção (loader/service, dois testes/gate e estes dois documentos); migrations, manifests/pins e trabalho não relacionado preservados. Sem commit/stage; cleanup somente dos recursos próprios dos gates.

**Estados e limites inalterados:** F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING; nenhum AC promovido. Catálogos editoriais e integração IdP externa/rollout continuam pendentes; sem lifecycle/publicação, activation, frontend ou matching. A revisão formal read-only foi repetida e o fecho humano restrito está registado acima.

### Implementação e evidência restrita — fatia 8 (2026-10-11)

**Estado histórico pré-fecho: Review, pronta para revisão formal read-only. F13 permanece In Progress.** A aprovação dos contratos não representa aprovação de rollout ou de conteúdo editorial; prevalece agora o fecho restrito registado acima.

- Tenant 012 acrescenta oito tabelas: catálogo de releases/entries; referências geográficas com nível catalogado e conceito/scheme/release exatos; heads/revisões; associações territoriais/grupos por revisão; registo idempotente source-local. FORCE RLS em todas, catálogos globais SELECT-only, INSERT funcional e UPDATE apenas do head, histórico e associações append-only. Não há seeds produtivos.
- `TERRITORY`, `TARGET_GROUP` e `SERVED_POPULATION` são declarações independentes. Territórios aceitam FULL/PARTIAL/UNSPECIFIED sem dados espaciais ou percentagens. Populações requerem contagem textual canónica inteira >=0, NUMERIC gerado para validação SQL, métrica COUNT/unidade/counting basis publicados compatíveis e associações explícitas. Zero e valores acima da precisão inteira JavaScript são preservados. DATE é texto civil no acesso; EXPIRED é derivado, nunca persistido.
- Oito operações próprias `F13_POPULATION_CREATE|EDIT|READ|SUBMIT|VERIFY|REJECT|DISPUTE|REVOKE`, permissions `profile_population.<operation>`, resources POPULATION_SCOPE na criação e POPULATION_ASSERTION exato nas restantes. Esta matriz funcional comum às três categorias substitui a matriz candidata por domínio da proposta histórica; grants de outras features não concedem estes acessos e bundles continuam vazios. Read confidencial exige grant/MFA/reason/purpose; verify/reject/revoke exigem MFA recente e maker-checker material/documental, incluindo verifier na revogação. Dispute tem grant/reason próprios.
- Root produtivo expõe `profilePopulations` através da composição autenticada existente, não o transaction service. F3, capability/client físico F4, loaders, decisão F5 normalizada, F7, links e idempotência partilham a conexão preparada; authority coordinator/recovery Central existentes são consumidos sem alteração da Central 009. Replay recarrega a revisão originalmente auditada e reautoriza F3/F5/F11; COMMIT incerto usa a evidência idempotente tenant e reconciliação durável.
- F11 exige DOCUMENT_READ cumulativo/exato, tenant/binding AVAILABLE/CLEAN e authors estáveis; associação não autoriza nem copia documentos. F7 tem oito códigos críticos, incluindo leitura restrita, revisions e reason/purpose versionados server-side; digest de evento cobre apenas metadata técnica, não conteúdo. F10 limita labels a operation/resultClass. Sem contagens, geografias, grupos ou documentos no payload F7/F10.

**Pins canónicos tenant 012:**

- Up: `4f3972e42a292678b45e86d690aca7410155f17dee7fedfc275a88837c984cd8`
- Down: `1ff268c9a0b0502c93858ff14e5314fc8075f25e670b909d3732e610ab5b0396`
- Fingerprint: `0558700553db2170ee60565b92339f5556f603d4108c9273d476b960cb1460c3`

**Provas executadas nesta implementação:**

- `node --test test/f13TerritoriesAndPopulations.test.js`: **14/14**. Foco F3/F4/F5/F7/F13 através dos ficheiros `^f(3|4|5|7|13).*test.js`: **408/408**. `npm test` backend: **672/672**, zero failures/skips.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/population-gate.ps1`: **PASS**, PostgreSQL 17 real, Central persistido + dois tenants, policy engine F5 real. Referências globais/tenant locais, foreign organization/release e tipo incompatíveis recusados, dois territórios/dois grupos materializados many-to-many e links SQL não declarados recusados. Três categorias distintas; coverage inválido/percentagem, contagem negativa/não inteira, períodos/scopes inválidos e catálogos incompatíveis recusados.
- Mesmo gate: precisão inteira/zero, datas UTC/Lisboa, CAS concorrente com um vencedor, replay concorrente sem duplicação, conflito de intenção, isolamento A/B, oito grants assimétricos e resource exato, erros uniformes sem grant, maker-checker/MFA ausente/stale, matriz de transições e expiração derivada. F11 indisponível/foreign/sem grant e replay após revogação documental falham; F7 falhado em todas as oito operações faz rollback de heads/revisions/links/idempotência/eventos. Eventos persistidos correspondem à decisão F5 e reason/purpose catalogados; F7/F10 não contêm o conteúdo sensível testado.
- Runner canónico **011→012→011→012**, ledger e fingerprints em ambos os estados, reaplicação idempotente, falha entre SQL/ledger com rollback e recusa de salto de downgrade. Down com dados protegidos recusado integralmente. Não descrever o capture SQL usado para calcular o pin como runner: a prova canónica é a execução posterior pelo runner.
- Gates `test/integration/f13/migration-gate.ps1`, `test/integration/f13/operational-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS**. F13/Central cobre 47 drift cases, corridas/recovery/commit incerto e downgrade 007; regressão 011 mantém os seus pins. F12 cobre instalação vazia e upgrades 003/004/005/006→012, fencing/isolamento/CAS/replay e executa **3/3 testes F9 PostgreSQL reais**.
- `node --check` nos **123 ficheiros JS** dirty/untracked: PASS; `git diff --check`: PASS. Scan regex de credenciais/PII: zero novos candidatos; três URLs sintéticos de testes preexistentes, ficheiros inalterados, e zero candidatos de email. Isto não constitui auditoria de produção ou garantia universal de ausência de PII.
- Hashes confirmam migrations anteriores, incluindo Central 009, intactas. Sem commit/stage. Cleanup limitado aos containers/volumes criados pelos próprios gates; recursos preexistentes preservados.

**Critérios e limites:** evidência restrita para AC-15 e transversais AC-01/02/04/05/09/11/12/18/20/21/22/24/25/26/27/28/29/30/31, somente nas partes descritas. **Nenhum AC promovido:** AC-13/15 PARTIAL; AC-14/16/17 PENDING; restantes estados inalterados. Catálogos editoriais/geográficos/taxonomias/fontes efetivamente aprovadas e sua governação produtiva continuam pendentes; fixtures sintéticas não são conteúdo aprovado. Sessão OIDC/provider/diretório são fixtures com persistência Central e residência PostgreSQL reais, não integração IdP externo/rollout/SLO. Sem geocoding/mapas, dados individuais, supressão inventada, agregações/rollups, eligibility/matching, publicação, snapshots/activation ou frontend. Fecho exige revisão independente e decisão humana.

## Fatia 8 — contratos aprovados antes do código (2026-10-11)

Aprovação humana explícita para tenant `012_f13_territories_and_populations`; fatia 8 em Review, não fechada; F13 In Progress. Assertions ORG-only distintas TERRITORY/TARGET_GROUP/SERVED_POPULATION, versionadas, sem inferência entre atuação, targeting e serviço efetivo. Catálogos publicados fechados/versionados para geografias/níveis, grupos aprovados, métricas/unidades/counting basis/métodos/reasons/purposes, sem seeds produtivos. Coverage FULL/PARTIAL/UNSPECIFIED, sem percentagem/geometria/estimativa. Contagem declarada inteira >=0, textual para precisão, sem rácios/denominadores, período civil inclusivo ordenado e associações many-to-many explícitas sobre conceitos/releases exatos, sem contagem derivada. KNOWN server-side somente para conteúdo declarado, zero não é ausência.

Scope F13-P1 opcional server-side da mesma organização, metadata apenas; client físico F4, F3/F5 e guard/recovery Central existentes, CAS/key/digest/histórico append-only. Create/edit/read/submit/verify/reject/dispute/revoke têm grants próprios, sem capacidades implícitas; verify/reject/revoke exigem maker-checker/MFA recente, incluindo autores documentais e verifier na revogação. Read confidencial exige autorização explícita/MFA/reason/purpose; dispute exige grant próprio/reason/F7. F11 cumulativo DOCUMENT_READ exato, inclusive replay histórico. valid_from obrigatório na verificação, valid_until opcional posterior e EXPIRED derivado no acesso. F7 atómico sanitizado e F10 de baixa cardinalidade, sem contagens, geografia/grupos, documentos ou conteúdo/digests sensíveis.

Migrations anteriores e Central 009 intactas, sem stage/commit. Sem geocoding/mapas/inferências, dados individuais, estimativas/deduplicação, thresholds/supressão inventados, agregações/rollups, eligibility/matching, publicação do perfil, snapshots/activation ou frontend. F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING, restantes estados inalterados. Catálogos editoriais, IdP externo/rollout/SLO pendentes; não antecipar testes/pins/AC PASS.

## Fatia 7 — fecho formal restrito operacional ORG-only (2026-10-11)

Fatia **formalmente fechada no âmbito restrito operacional ORG-only**, por decisão humana explícita após revisão formal read-only sem findings materiais e com parecer «sem findings bloqueadores». Tenant `011_f13_operational_capacity` aditiva; migrations tenant anteriores e Central 009 não são reescritas. Roadmap reserva lifecycle/activation para migration posterior. Não há seeds produtivos, FX/scoring/rollups, partitions/coverage, inventário/RH, frontend ou matching.

### Decisão de fecho e evidência da revisão

O fecho abrange assertions operacionais ORG-only versionadas, quantidade exata, TOTAL/AVAILABLE independentes, localização canónica server-side, authoring/transições explícitas, CAS/idempotência/histórico append-only, runtime tenant confiável, F3/F4/F5/F7/F10, maker-checker/MFA, referências F11 reautorizadas e recovery de COMMIT incerto. EXPIRED permanece derivado no acesso, sem persistência ou scheduler. Não equivale ao cumprimento integral de AC-17 ORG|UNIT/rollups.

A revisão independente anterior repetiu com sucesso: testes operacionais **14/14**, focados F13/F3/F4/F5/F7 **418/418**, backend **658/658**, zero skips; gates PostgreSQL 17 operacional, F13/Central, F13-P1 e F12 **PASS**, F9 PostgreSQL **3/3 PASS**; runner **010→011→010→011 PASS**; `node --check` **112 JS PASS** e `git diff --check` **PASS**. F13/Central confirmou 47 drifts ACL, concorrência e recovery. Checksum/fingerprint 011 correspondem aos pins abaixo. Scans não identificaram credenciais/PII reais nos padrões examinados; não são garantia universal. Os 133 ficheiros dirty/untracked ficaram inalterados durante a revisão, o index vazio e os recursos descartáveis próprios foram removidos, preservando recursos preexistentes. Gates authoring/competency/financial na secção de entrega abaixo são evidência da implementação anterior, não novas execuções desta revisão.

Mantêm-se **F13 In Progress; AC-13/AC-15 PARTIAL; AC-14/AC-16/AC-17 PENDING; restantes estados inalterados**, sem promoção de qualquer AC integral a PASS. Catálogos editoriais produtivos, IdP externo, provider/diretório externos, rollout e SLO continuam pendentes. Scoring/agregações, tempo real, reservas/planeamento, colaboradores, territórios/beneficiários, lifecycle/aprovação/publicação do perfil, snapshots/activation, frontend e matching permanecem fora do âmbito fechado. Esta decisão não autoriza nem inicia outra fatia. Esta ação altera somente os dois documentos F13; não repete testes funcionais, modifica pins/código/migrations, arquiva a feature integral ou cria stage/commit.

### Contratos implementados

- Cinco tabelas próprias: operational_catalog_release/entry, operational_assertion/revision e operational_idempotency_record. Revisões/resultados/catálogos append-only, head CAS, FK head diferida e correspondência com max(revision); RLS/FORCE RLS e grants mínimos. Quantidade textual canónica gera NUMERIC(24,6), sem arredondamento; zero é KNOWN, não ausência. TOTAL/AVAILABLE independentes, sem par/unicidade/AVAILABLE<=TOTAL inferidos.
- Métricas reutilizam metric_definition publicada, versionada, com value_kind DECIMAL/INTEGER/COUNT e unit_code igual à unidade fechada publicada; métricas INTEGER/COUNT recusam fração. São tipos técnicos existentes, não indicadores/unidades editoriais novos. Catálogos próprios UNIT/METHOD/REASON/PURPOSE vazios fail-closed; fixtures explicitamente sintéticas.
- DATE civil textual em create/edit/read/replay, período inclusivo ordenado. Verify exige método e valid_from, valid_until opcional posterior; EXPIRED derivado em acesso/replay somente VERIFIED/DISPUTED após valid_until, sem scheduler/persistência.
- Localização opcional é scope F13-P1 ACTIVE da organização autenticada, nunca autoridade UNIT/TEAM/territorial. Função fechada `organizational_scope.load_operational_location`, owner NOLOGIN existente, SECURITY DEFINER/search_path fixo, valida app.organization_id, mutex F13-P1 e SHARE lock, devolve apenas scope_id. Nenhum UPDATE adicional em scope concedido ao runtime de perfil. SQL trigger e loader usam o mesmo contrato.
- Create→DRAFT, edit DRAFT→nova DRAFT, submit→SUBMITTED, verify SUBMITTED→VERIFIED, reject SUBMITTED→REJECTED, dispute VERIFIED→DISPUTED, revoke VERIFIED/DISPUTED→REVOKED. Verify/reject/revoke exigem MFA recente e subjects independentes dos autores/submissores/autores documentais; revoke também do verificador. Read/dispute sensíveis mantêm MFA normativo F5; reasons obrigatórios em reject/dispute/revoke, reason/purpose em read.
- F11: função fechada `load_operational_reference` confirma organization + OPERATIONAL_ASSERTION/assertion exata + AVAILABLE/CLEAN sob SHARE; engine real exige simultaneamente permission operacional e DOCUMENT_READ exato, incluindo replay histórico. Não há acesso à storage locator/conteúdo, classificação/cópia ou grant documental implícito.
- Root `profileOperational` consome handles OIDC opacos/F3 e authorityCoordinator Central existente, com F5/resources server-side e client F4 preparado. Inputs não recebem autoridade, correlation ou assurance; transaction service interno requer capability privada física e guard. Recovery durável aponta apenas para idempotência operacional na conexão tenant admitida.
- Locks: preparação F4 → advisory F13-P1 organization (também BEFORE STATEMENT em SQL runtime de heads/revisões) → intention org/op/key → assertion head → localização SHARE → documentos SHARE → guard Central → CAS/revision/F7/idempotência → fencing/permit/commit. Sem retry cego.
- Replay reautoriza F3/F5/F11 e devolve a revisão originalmente auditada, rederivando EXPIRED. Intenção vincula org/op/key/digest, inclusive role/location; resultado source-local só assertionId/revision/state. COMMIT incerto reconcilia evidência tenant pelo protocolo Central, sem duplicar F7/revisão; duas confirmações perdidas recusam sucesso público/handles.
- F7 oito eventos críticos source-local (sete mutações e leitura restrita), mesmos actor/membership/versões/policy/assurance da decisão efetiva e reason/purpose versionados server-side. Semantic digest só metadata de operação/revisão; sem digest de quantidade, unidades, documentos, localização ou conteúdo. F10 apenas operation/resultClass fechadas, sem IDs/valores.

### Operações/resources F5

| Operação | Permission | Resource server-side |
|---|---|---|
| F13_OPERATIONAL_CREATE | profile_operational.create | OPERATIONAL_SCOPE, organização autenticada |
| F13_OPERATIONAL_EDIT | profile_operational.edit | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_READ | profile_operational.read | OPERATIONAL_ASSERTION, revisão original no replay |
| F13_OPERATIONAL_SUBMIT | profile_operational.submit | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_VERIFY | profile_operational.verify | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_REJECT | profile_operational.reject | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_DISPUTE | profile_operational.dispute | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_REVOKE | profile_operational.revoke | OPERATIONAL_ASSERTION, assertion exata |

Scopes exclusivamente ORGANIZATION, profile bundles vazios e nenhuma permission implícita. F11 acrescenta DOCUMENT_READ sobre documento exato; não troca o recurso operacional pelo scope de localização.

### Evidência executada da fatia 7 (2026-10-11)

- `node --test backend/test/f13OperationalCapacity.test.js`: **14/14 PASS**. Focados F13/F3/F4/F5/F7: **418/418 PASS** (seleção dos ficheiros f13*, f4*, f5*, f7AppendOnlyAudit e security/f3*). `npm test` em backend: **658/658 PASS**, zero skipped.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/operational-gate.ps1`: **PASS**, PostgreSQL 17, Central e duas bases tenant reais. Precisão 0/micro/máximo, períodos UTC/Lisbon/inverno/verão, métrica/unidade incompatível inclusive por SQL runtime, fração em COUNT recusada, contagem 1 explícita autorizada sem threshold; localização própria/arquivada/estrangeira/inexistente, TOTAL 0 e AVAILABLE 99 independentes; CAS e key concorrentes, conflito de intenção, isolamento A/B, todas as transições e oito grants assimétricos; maker/checker/revoker distintos, MFA ausente/stale, EXPIRED derivado inclusive no replay.
- F11 real: grant operacional sem DOCUMENT_READ, grant de outro documento/tenant, documento quarantined e revogação de DOCUMENT_READ recusam acesso/replay histórico, mesmo após remoção do documento do head corrente. Revisões/results append-only, órfão inválido no COMMIT, ausência de SELECT em locator F11/UPDATE em scope F13-P1. Falhas nas oito chamadas F7 revertem heads/revisões/resultados/eventos; F5/F11 recusados não deixam escrita funcional.
- F7 realmente persistido corresponde às decisões F5/assurance/policy e às versões/reason/purpose; eventos/results têm correspondência uma-para-uma, sem quantidade, unidade, documentId/versionId/localização/conteúdo sensível. F10 só operation/resultClass. Sem grant, existência, CAS/lifecycle e documento/localização indisponível devolvem a mesma recusa pública; CAS detalhado só é validado após F5, sob os locks existentes. Esta prova não é garantia universal de timing side channels.
- COMMIT perdido depois de COMMIT PostgreSQL real é reconciliado pela evidência operacional source-local; leitura/replay mantêm a revisão auditada, sem duplicar F7. Duas confirmações perdidas recusam falso sucesso/handles e recuperam uma única revisão/result. Interrupções reais de processo e corridas de autoridade são provas do protocolo comum no gate F13/Central, não crashes independentes específicos do authoring operacional.
- Runner canónico **010→011→010→011 PASS**, em ambos os tenants, com ledger/preflight/fingerprints. Falha SQL→ledger reverte o schema; segunda aplicação idempotente; down para versão arbitrária e down com dados protegidos recusados. Depois do down: 11 entradas efetivas no ledger e fingerprint 010 `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`. Captura SQL preliminar foi apenas cálculo do pin, nunca declarada como runner.
- Repetição final do gate operacional com todos os ficheiros finais: **PASS**, incluindo CREATE e READ com a mesma key, duas entradas source-local por operação e resultados distintos, sem bypass de F5/F11. Validações de lifecycle/CAS/replay são posteriores à autorização, sem libertar os locks.
- Gates `test/integration/f13/migration-gate.ps1`, `authoring-gate.ps1`, `competency-gate.ps1`, `financial-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS** nesta execução. F13/Central inclui 47 drifts ACL/login dedicado limitado, seis corridas nas duas ordens, recovery/crashes, commit incerto e rollback tenant 007. F12 prova vazio e upgrades 003/004/005/006→011, 12 versões, rollback/drift/concorrência, identidade runtime/fencing e F9 PostgreSQL **3/3 PASS**. Gates de slices fechadas conservam os seus prefixes/pins; não são apresentados como testes completos desses domínios em 011.
- `node --check`: **112 JS PASS**; `git diff --check` e scan de whitespace de todos os 133 ficheiros dirty/untracked PASS. Scans de private/provider keys, atribuições de segredo, URLs PostgreSQL e emails: 22 ocorrências revistas são canários/valores de teste ou URLs loopback com passwords aleatórias calculadas em runtime; nenhuma credencial/PII real identificada nos padrões usados. Não constituem garantia universal.
- Snapshot prévio de 119 ficheiros preservado fora dos 29 ficheiros existentes integrados nesta fatia; 14 novos ficheiros. Dez ficheiros SQL anteriores dirty/untracked, incluindo Central 009 e tenant 007–010, têm SHA256 intacto; migrations anteriores tracked sem alteração e .vscode preservado. Sem stage/commit. Cleanup somente dos recursos Docker descartáveis próprios; nenhum recurso pré-existente é removido.

Execuções preliminares falharam: down clonado com policy inexistente, fixture com unidade incoerente, SQL do teste órfão incompleto e SHARE de localização sem UPDATE. Foram corrigidos no âmbito da 011/testes, sem conceder UPDATE de scopes. Também ocorreram recusas genéricas durante execuções operacionais/F13 preliminares concorrentes; não se atribui uma causa não comprovada. Gate F13 passou na repetição isolada e operacional nas repetições finais; nenhuma migration fechada foi modificada. Fixture MFA simula nova autenticação OIDC sintética entre grupos quando o gate extenso se aproxima da janela real de 300s; não refresca durante testes stale/ausente/corridas e não aumenta a policy produtiva.

### Pins finais da tenant 011

- Up: `1f07a21b145d23500cd7928272ee0be816f90688e41a5ba5024566732d6cfdbd`.
- Down: `26e6cf72c5f166eaa496dc8dff9221f1fb859bb5a180e74d97a76b89f39b871b`.
- Fingerprint: `884396f0858205d0c3098dc5b44fcc366664ef0af4238e69628c2e57cdb453ff`.

**Fatia 7 formalmente fechada no âmbito restrito aprovado, após revisão read-only e decisão humana.** F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING e restantes estados inalterados. Contratos estruturais implementados, catálogos editoriais produtivos/IdP externo/rollout/SLO ainda pendentes. Não se autoriza qualquer próxima fatia.

### Critérios e limites

Evidência restrita para AC-17 e transversais AC-01/02/04/05/09/11/12/20/21/22/24/25/30/31; AC-18 apenas referências canónicas. **F13 In Progress, AC-13/15 PARTIAL, AC-14/16/17 PENDING; restantes estados inalterados.** ORG|UNIT/rollups do AC-17 integral não estão implementados. Catálogos editoriais produtivos, IdP externo, provider/diretório externos, rollout e SLO permanecem pendentes; fixtures não os comprovam.

## Identidade

- **ID/estado:** F13 / `In Progress` — fatias 2/3/4/5/6/7 formalmente fechadas nos respetivos âmbitos restritos; fatia 7 operacional ORG-only fechada após revisão read-only sem findings materiais e decisão humana explícita. AC-13/AC-15 PARTIAL, AC-14/AC-16/AC-17 PENDING; restantes estados inalterados e feature integral incompleta. Os findings encerrados das fatias anteriores não são reabertos.
- **Objetivo:** perfil institucional tenant-local, versionado, autorizado, auditável e reproduzível para consumo determinístico futuro.
- **Valor:** substituir dados UBI/ad hoc por contratos universais para interesses, competências, experiência e capacidades.
- **Dependências:** F3, F4/F4.3/F4.4, F5, F7, F10, F11, F12 e `F13-P1 — Fundação de Âmbitos Organizacionais`, concluída e arquivada em `context/history/f13-p1-organizational-scope-foundation.md`; F9 apenas se um efeito assíncrono for futuramente aprovado. O plano foi reconciliado com a implementação real da F13-P1 em 2026-10-10; F13 iniciou exclusivamente a fatia vertical 1, sem migrations.
- **Consumidores futuros:** F14 matching e F15 qualificação; nenhum é implementado aqui.

## Fatia 7 — aprovação formal e contratos antes do código (2026-10-11)

A aprovação humana autoriza implementar somente capacidade operacional ORG-only com tenant `011_f13_operational_capacity`. Substitui o Draft da proposta, sem fechar esta fatia ou a F13 integral. Migrations anteriores permanecem intactas e numerações Central/tenant independentes.

Contratos: quantidade decimal exata NUMERIC(24,6) >= 0; métricas/unidades por catálogos publicados fechados, compatibilidade SQL, sem seeds produtivos; período civil inclusivo ordenado e DATE textual; TOTAL/AVAILABLE independentes, sem agregação ou AVAILABLE<=TOTAL implícito. Quantidade explicitamente fornecida produz knowledge KNOWN server-side, inclusive zero, nunca NONE inferido. Localização opcional usa apenas referência F13-P1 canónica ativa da mesma organização, resolvida server-side; não altera o scope Organization nem cria overlay/coverage territorial.

Workflow do recorte: create DRAFT, edit apenas DRAFT com nova revisão, submit SUBMITTED, verify SUBMITTED→VERIFIED, reject SUBMITTED→REJECTED, dispute VERIFIED→DISPUTED, revoke VERIFIED/DISPUTED→REVOKED. Verify/reject/revoke exigem MFA recente e maker-checker sobre stable subject dos autores materiais/evidência (na revogação também o verificador); dispute/reject/revoke exigem reason próprio. Read restrito exige grant operacional, MFA recente e reason/purpose catalogados. valid_from obrigatório em verify, valid_until opcional posterior; EXPIRED derivado no acesso, sem scheduler/escrita.

Oito operações/resources F5 próprios, sem permissões implícitas; F11 exige cumulativamente DOCUMENT_READ exato em todas as referências devolvidas/verification/replay. CAS e histórico append-only, intenção organization/operation/key/digest, replay da revisão originalmente auditada com nova F3/F5/F11, mesma conexão tenant preparada e guard/recovery Central durável. F7 crítico atómico, versões/assurance efetivas e reason/purpose versionados server-side; F7/F10 sem quantidades, documentos/localização sensível ou conteúdo. Catálogos vazios falham fechado; fixtures sintéticas não são seeds.

F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING; restantes critérios inalterados. Sem scoring, rollups/agregações, tempo real/reservas/RH, territórios/beneficiários, lifecycle/publicação do perfil, snapshots/activation, frontend ou matching. Esta secção documenta aprovação/contratos, não antecipa pins ou resultados de testes.

## Âmbito e fora do âmbito

Inclui baseline `ORGANIZATION`, overlays `UNIT|TEAM` onde admitidos, snapshots, taxonomias temáticas/estratégicas, competências/experiência, territórios/beneficiários, capacidade financeira/operacional, exclusões, knowledge states, lifecycle, F5/F7/F10.

Exclui matching/scoring/elegibilidade (F14), qualificação (F15), candidaturas, UI final, imports/conectores, IA/semântica, RH/inventário/contabilidade/planeamento, provisioning, rollout e operação produtiva.

## Glossário

- **Draft revision:** edição imutável com revision CAS.
- **ProfileVersion:** conteúdo imutável criado ao aprovar uma revision/digest.
- **Baseline/overlay:** versão ORG obrigatória / versão UNIT|TEAM opcional ligada a baseline exata.
- **Effective snapshot:** composição materializada, imutável e `READY`.
- **Taxonomy release:** release publicada e imutável de conceitos/relations.
- **Assertion/evidence:** alegação institucional / experiência ou fonte governada que não verifica automaticamente.
- **Knowledge/verification/conflict/lifecycle/projection:** dimensões independentes de facto, confiança, conflito, estado editorial e divulgação.
- **Activation cohort:** baseline nova e overlays revistos cortados atomicamente.
- **Semantic/projection digest:** digest interno canónico / digest da projeção autorizada e policy.

## Contratos consolidados

### Residence, scope e composição

- Conteúdo, versions, pointers, activations e snapshots são tenant-local; Central não é source of truth.
- Organization vem do contexto Central/F3. Unit/team são `organizational_scope.scope.scope_id`, tenant-local, com `scope_type=UNIT|TEAM`, `lifecycle=ACTIVE|ARCHIVED`, RLS/FORCE RLS e FK composta disponível por `(organization_id, scope_id)`. F13 apenas referencia estes UUIDs, carrega-os server-side e exige `ACTIVE` para uso corrente; referências históricas podem resolver `ARCHIVED`.
- Baseline ORG obrigatória; overlays opcionais sem herança unit→team. Composição é baseline + no máximo um overlay explícito.
- Exclusões da baseline não podem ser relaxadas. Financeiro é ORG-only; operacional ORG|UNIT; TEAM só em domínios aprovados. `UNIT_SUBTREE` fora.

### Taxonomia, competências e experiência

- Schemes distintos `THEMATIC_AREA|STRATEGIC_PRIORITY`, IDs estáveis, releases imutáveis, labels traduzíveis, DAG acíclico multi-parent sem pesos.
- Global e tenant-local têm namespaces separados; conceitos locais usam maker-checker. Deprecation/replacement preserva história.
- Mappings `EXACT|CLOSE|BROADER|NARROWER` são metadata versionada, sem equivalência/scoring implícito.
- CompetencyConcept, CompetencyAssertion e ExperienceEvidence são distintos; níveis são framework-specific.
- Assertion/evidence many-to-many explícita. F11/projetos/fontes não criam `VERIFIED`; verificação exige método, F5, maker-checker, provenance e validade.

### Fatia 5 — contrato mínimo aprovado (2026-10-11)

A aprovação humana autoriza tenant `009_f13_competencies_and_experience`, sem reescrever tenant 008 ou Central 009. Lifecycle/activation passa a migration tenant posterior. Este contrato é restrito, não substitui o âmbito futuro completo da decisão de competências.

- Factos estruturais distintos: CompetencyAssertion versionada (`KNOWN` com conceito ou `UNKNOWN` explícito, nível opcional do mesmo framework/version/release) e ExperienceEvidence versionada (tipo por entry UUID publicado, período observado e provenance UUID). Não há texto livre, escala universal ou tipos/métodos editoriais inline.
- Catálogos fechados por IDs de release/entry, globais read-only ou tenant-local: `COMPETENCY_CONCEPT`, `FRAMEWORK_LEVEL`, `EXPERIENCE_TYPE`, `VERIFICATION_METHOD`. Estes códigos são classes estruturais, não conteúdo editorial. Nenhum seed produtivo aprovado é inventado; catálogo vazio recusa KNOWN/experiência/verificação. Gestão/publicação editorial destes catálogos fica pendente; fixtures sintéticas só nas bases descartáveis.
- Estado de cada facto permanece `UNVERIFIED`. `verifyCompetency` cria resultado append-only `VERIFIED`, com método aprovado, digest material e validade explícita compatível com o método. Não altera o facto histórico. Expiração temporal não transforma automaticamente um facto; DISPUTED/REVOKED/EXPIRED e outras transições completas não são entregues nesta fatia. Novo material invalida os resultados correntes de verificação conservadoramente, sem apagar história. Draft DRAFT aceita CAS; SUBMITTED recusa nova edição, mantendo replay reautorizado e leitura de links.
- Many-to-many por links versionados sobre versões exatas de assertion/experience. Revision members append-only preservam o conjunto material de cada revision; edit temático/submit preservam os novos domínios. Assertion/experience sets substituem explicitamente apenas o seu domínio, removendo do conjunto corrente links incompatíveis, não factos históricos.
- F11: referência opcional a document version exata, mesma organização e resource `EXPERIENCE_EVIDENCE` ligado à experiência, AVAILABLE/CLEAN. Função fechada owner NOLOGIN carrega/bloqueia metadata na mesma conexão; não devolve object IDs, URLs ou conteúdo. Anexar/ler/verificar referência documental exige adicionalmente `DOCUMENT_READ` sobre DOCUMENT exato, avaliado no mesmo guard Central; nenhum grant de evidência concede acesso documental implícito. Replay volta a confirmar binding/estado/acesso F11.

| Operação produtiva | Permission F5 | Resource server-side | Assurance/SoD | F7 crítico |
|---|---|---|---|---|
| F13_COMPETENCY_DRAFT_EDIT | organization_profile.draft.edit | PROFILE_DRAFT | NORMAL | PROFILE_DRAFT_REVISION_CREATED |
| F13_EXPERIENCE_DRAFT_EDIT | organization_profile.draft.edit | PROFILE_DRAFT | NORMAL | PROFILE_DRAFT_REVISION_CREATED |
| F13_EVIDENCE_ATTACH | profile_evidence.attach | ASSERTION (version) | NORMAL | EVIDENCE_ATTACHED |
| F13_COMPETENCY_VERIFY | profile_competency.verify | COMPETENCY_ASSERTION (version) | RECENT_MFA, stable maker-checker | COMPETENCY_ASSERTION_VERIFIED |
| F13_EVIDENCE_LINK_READ | profile_evidence.link.read | EVIDENCE_LINK | NORMAL, metadata apenas | EVIDENCE_LINK_ACCESSED |

Os dois edits são aliases explícitos da permission editorial existente, não capacidades inferidas. Bundles de perfis continuam vazios. Maker-checker exclui autores estáveis de assertion, experiências, links e história material editorial; uma sessão/membership diferente do mesmo sujeito não o contorna. MFA usa decisão F5 normalizada, policy e versões efetivamente avaliadas.

Runtime root expõe `profileCompetencies.bindTenant`, não transaction service. Mesma conexão F4 preparada: mutex F13-P1 por organização → intenção org/op/key → lock draft/scope → F3/F5 e guard durável Central (incluindo DOCUMENT_READ quando aplicável) → facts/revision/CAS → F7 → resultado source-local → fencing/commit protegido. Auditada leitura de link continua operação F5 READ; só esse módulo fechado pode escrever audit/idempotência, sem ampliar a superfície funcional READ genérica. COMMIT incerto usa o mapa fechado source-local da tenant 009, reconcilia o guard e volta a revalidar F3/F5 antes do retorno. F10 contém somente operation/resultClass.

Pendentes: conteúdo editorial/frameworks/níveis/tipos/métodos produtivos, governação/import destes catálogos, lifecycle completo da verificação, approval/publication do perfil, snapshots/activation, outros domínios, frontend, matching, IdP externo/rollout/SLO e limites operacionais anteriores. AC-13/AC-15 PARTIAL; nenhum AC é promovido por este contrato.

### Territórios

- Vocabulário interno com IDs estáveis e releases imutáveis; schemes v1 `COUNTRY_TERRITORY|ADMINISTRATIVE_AREA|STATISTICAL_REGION|TRANSNATIONAL_AREA` e sem `CUSTOM_AREA`.
- Containment é intra-scheme/release; ISO 3166, NUTS, LAU e CAOP permanecem authorities distintas ligadas por mappings `EXACT|CLOSE|BROADER|NARROWER|OVERLAPS`.
- Assertions ORG|UNIT distinguem `OPERATIONAL_PRESENCE|DELIVERY_CAPABILITY|DEMONSTRATED_EXPERIENCE|STRATEGIC_PRIORITY`; TEAM e inferências a partir de endereço ficam fora da v1.
- F13 não expande ancestors/descendants nem produz elegibilidade. F12/UBI permanecem preserved/unmapped sem mapping explícito.

### Classificações institucionais e populações servidas

- Classificações institucionais são ORG-only e usam schemes separados `LEGAL_NATURE|INSTITUTION_TYPE|CONTROL_STATUS|NON_PROFIT_STATUS|ECONOMIC_SIZE_CLASS`; nenhuma dimensão substitui ou preenche outra.
- Assertions preservam concept/scheme/release, authority/policy/jurisdição, período, provenance e verification. PME não é tag permanente nem inferida apenas de métricas financeiras.
- F13 não calcula grupos empresariais, autonomia, consolidação ou ownership indireto. Thresholds externos só têm significado através da policy version referenciada.
- Populações servidas usam `SERVED_POPULATION_GROUP`, separado da classificação institucional, com relações `SERVES|STRATEGIC_PRIORITY`, scopes ORG|UNIT e sem pessoas/listas/dados individuais.
- `organization.type_code`, `beneficiaryTypeCodes` F12 e dados UBI permanecem preserved/unmapped sem mapping explícito. F13 não decide elegibilidade do aviso.

### Constraints e fronteira F14

- F13 publica apenas constraints declarativas `PROHIBITED|UNAVAILABLE`, fechadas, versionadas e ligadas a concepts/releases governados. `NOT_PREFERRED`, pesos e penalizações ficam fora da F13.
- Não são aceites expressões, operadores livres, código, DSL, texto executável ou referências específicas a oportunidades/candidaturas.
- Baseline e overlays apenas acumulam constraints nos scopes permitidos; overlays nunca removem ou relaxam constraints herdadas e não existe `TEAM→UNIT` nem `UNIT_SUBTREE`.
- `UNKNOWN`, `WITHHELD`, ausência e incompletude não são constraints. Dispute/conflict/revoke/expire preservam histórico e falham fechado conforme policy.
- F14 é o único componente que compara opportunity revision com snapshot/assertion F13 através de regra própria versionada e preserva todas as versões no resultado.

### Capacidade financeira e operacional

- Financeiro usa catálogo fechado, decimal exato, período/moeda original, exact xor interval e estados explícitos; sem FX, contabilidade ou scoring. Bandas/derivações usam policy versionada.
- Operacional usa assertions agregadas/temporais ORG|UNIT; papéis `TOTAL|COMMITTED|RESERVED|AVAILABLE` não se derivam sem policy.
- Rollup exige partitions disjuntas, mesma métrica/release/período/unidade e ausência provada de overlap. FTE é contextual/agregado; access modes `OWNED|LEASED|PARTNER_ACCESS|CONTRACTED`.

### Knowledge, completude e projections

- Ausência é não materializado, nunca unknown/none/N/A/zero/false/vazio.
- Knowledge `KNOWN|UNKNOWN|NONE|NOT_APPLICABLE`; verification `NOT_REQUIRED|UNVERIFIED|VERIFIED|DISPUTED|REVOKED|EXPIRED`; conflict `CLEAR|CONFLICTED`; projection `DISCLOSED|WITHHELD`.
- `WITHHELD` não altera knowledge. Completude usa policy publicada por schema/scope/domain, nunca truthiness, percentagem ou score; resultado é `COMPLETE|INCOMPLETE` com findings canónicos.
- Draft pode estar incompleto. Approval referencia evaluation/policy; snapshot só fica `READY` quando todas as policies aplicáveis passam. `READY` não promete verdade, verificação universal, elegibilidade ou utilidade para toda regra F14.
- Slots podem admitir explicitamente `UNKNOWN|NONE|NOT_APPLICABLE|UNVERIFIED`; ausência não materializada e estados obrigatórios `DISPUTED|CONFLICTED|EXPIRED|REVOKED` não satisfazem completion.
- Overlay incluído incompleto bloqueia toda a coorte; overlay explicitamente omitido é desativado e não permanece ligado à nova baseline.
- Snapshot interno/projeção têm digests distintos; redaction não altera história. Defaults implícitos proibidos; legacy ambíguo vira UNKNOWN com provenance/reason/source.

### Confidencialidade, projection, purpose e reason

- Classes v1 `INTERNAL|RESTRICTED|HIGHLY_RESTRICTED` são independentes de F5; não existe `PUBLIC`. Slot/domain policy fixa o mínimo e composição nunca reduz classificação.
- Projection modes `EXACT|DERIVED|REDACTED|OMITTED` são selecionados server-side por operation, permission, scope, purpose, classification e policy version. Caller não escolhe modo mais permissivo.
- `WITHHELD` é significado apresentado apenas quando confirmar existência é autorizado; caso contrário usa-se `OMITTED`. Completion continua sobre o valor interno.
- Exact/redacted/evidence/full-export são permissions distintas. Restricted/highly-restricted reads e exports exigem `RECENT_MFA`, purpose/reason fechados e F7 sanitizado; evidence content continua sob F11.
- Classification publicada é imutável. Reclassification cria versão; downgrade exige operação própria, maker-checker, MFA, reason e F7. O código final dessa operação é detalhe do catálogo antes da implementação.
- API/ecrã/export partilham a mesma projection policy; counts, pagination, ordering, metadata, errors, existence e timing não podem criar side channels.

### Lifecycle, concorrência e archive

- Draft lógico tem revisions imutáveis, expected revision/CAS e key+intent digest.
- Approval cria version imutável; `APPROVED` difere de `PUBLISHED`; publish não ativa.
- Activation v1 é manual, síncrona e reautorizada. Coorte materializa todos os snapshots `READY`, depois troca baseline/overlays e desativa overlays omitidos numa transação.
- Uma baseline ativa por tenant, um overlay por scope. Falha preserva pointers; concorrência usa locks/CAS.
- Activation records `ACTIVATED|REPLACED|ROLLED_BACK|DEACTIVATED` são append-only. Rollback é nova activation; archive é lógico; sem delete físico.

### Autorização, F7/F9/F10

- As 29 operations-base estão em `context/decisions/f13-authorization-and-segregation.md`; a decisão posterior de confidencialidade exige ainda operação própria de reclassificação, sem alterar os restantes grants.
- Grants positivos por operation/resource/scope, deny-by-default, resource loading server-side e IDOR uniforme.
- Maker-checker usa stable human subject; autor não aprova/ativa, verifier não verifica o que criou, service actors não executam ações humanas sensíveis; sem break-glass.
- `RECENT_MFA` nas ações sensíveis/restricted/export. Reason/purpose fechados. F7 crítico e efeito source-local são atómicos e sanitizados.
- F9 não entra no lifecycle síncrono. F10 usa labels fechadas sem IDs/valores/digests sensíveis.

### Compatibility e upgrade

- Tenant runner/manifest/checksum/fingerprint/capabilities/postflight são o único caminho de migration; sem transaction control interno ou SQL direto.
- Sem backfill ambíguo: UBI e F12 thematicCodes ficam preservados/unmapped com provenance até mapping explícito.
- `CompatibilityManifest` publicado e digestado enumera tuples exatas em release bundles; não existem produtos cartesianos implícitos.
- Writers emitem apenas N. Readers aceitam N e N-1 apenas por tuple declarada; N-1 usa adapter puro, conservador e apenas em memória. N-2, versões futuras, ausentes ou combinações cruzadas falham fechado.
- Nova version/materialização/activation usa exclusivamente o bundle corrente N. Snapshot N-1 pode permanecer apenas na janela transitória declarada e para leitura histórica autorizada.
- API e worker validam o mesmo manifest, anunciam capabilities por workload e recusam jobs/leases/handlers incompatíveis sem efeito parcial ou acknowledgement indevido.
- Startup valida bundle, manifest, ledger, fingerprint, capabilities, policies, catálogos, handlers e adapters. Upgrade segue `expand → migrate → contract`; não há repair, downgrade destrutivo ou backfill epistemológico inferido.
- Versions/releases/snapshots históricos não são reescritos nem reinterpretados.

## State machines

```text
Draft/version: DRAFT(rev n) -> DRAFT(rev n+1) -> APPROVED -> PUBLISHED -> SUPERSEDED -> ARCHIVED
Activation: ACTIVATED -> REPLACED | ROLLED_BACK | DEACTIVATED (records append-only)
Taxonomy: DRAFT -> APPROVED -> PUBLISHED -> DEPRECATED
Assertion: DRAFT -> APPROVED/PUBLISHED -> SUPERSEDED | ARCHIVED
Evidence: DRAFT -> LINKED -> SUPERSEDED | REVOKED
Verification: NOT_REQUIRED | UNVERIFIED -> VERIFIED -> DISPUTED | REVOKED | EXPIRED
Archive: elegível -> ARCHIVED; restore cria versão/activation, não reescreve história
```

## Invariantes

1. Tenant/scope/resource pertencem à mesma residência; RLS funciona sem WHERE explícito.
2. Published versions/releases/snapshots são imutáveis; correções criam version.
3. Unique active baseline e unique active overlay por scope.
4. Snapshot `READY` precede pointer swap; coorte é tudo-ou-nada.
5. Revision/fence/pointer monotónicos; key+digest converge e mismatch conflita.
6. DAG sem self/cycles; catálogos e states fechados/versionados.
7. Combinações knowledge/value/verification/conflict/projection obedecem ao slot.
8. Rollup sem disjunção provada é recusado.
9. SoD avalia stable human subject em toda a coorte.
10. Critical audit e efeito source-local são atómicos; archive/revoke/expire não eliminam história.
11. F14 recebe apenas snapshot `READY` e projection autorizada.

## Erros públicos

Categorias sanitizadas: `INVALID_INPUT`, `RESOURCE_NOT_AVAILABLE`, `AUTHORIZATION_REQUIRED`, `STATE_CONFLICT`, `STALE_REVISION`, `IDEMPOTENCY_CONFLICT`, `INCOMPATIBLE_VERSION`, `COMPLETENESS_REQUIRED`, `PERSISTENCE_UNAVAILABLE`. Não expõem SQL, existência oculta, IDs, valores, policies ou stack.

## Critérios e rastreabilidade

Nenhum critério está PASS.

| ID | Requisito verificável | Decisão | Evidência esperada | Risco |
|---|---|---|---|---|
| F13-AC-01 | Conteúdo/effects F13 apenas no tenant. | Scope | PG schema/integration | residência dupla |
| F13-AC-02 | A/B não leem/escrevem/ativam/exportam/inferem cruzado. | Auth | PG RLS/IDOR | fuga tenant |
| F13-AC-03 | Sem professor/faculdade/centro UBI no núcleo. | Scope | structural guard | acoplamento piloto |
| F13-AC-04 | Draft edit cria revision sem alterar active/history. | Versioning | unit+PG | história mutável |
| F13-AC-05 | Unknown fields/states/scopes/codes/prototypes recusados. | Todas | adversarial unit | caller-driven |
| F13-AC-06 | Approval cria version/digest imutáveis. | Versioning | PG constraints | retroatividade |
| F13-AC-07 | Publish não ativa; coorte só troca após READY/revalidation. | Lifecycle | PG vertical | cutover parcial |
| F13-AC-08 | Unique baseline/overlay e overlays antigos desativados. | Lifecycle | PG concurrency | múltiplos ativos |
| F13-AC-09 | Supersede/archive/rollback preservam toda história. | Lifecycle | PG history | perda |
| F13-AC-10 | CAS/locks impedem lost update/dupla activation. | Lifecycle | PG sessions | race |
| F13-AC-11 | Retry/commit incerto converge; digest mismatch falha. | Lifecycle | PG fault injection | duplicação |
| F13-AC-12 | Actor/subject/membership/policy/provenance/correlation preservados. | Auth | PG+F7 | autoria forjada |
| F13-AC-13 | Areas/priorities usam schemes/releases/DAG/mappings aprovados. | Taxonomy | graph+PG | deriva |
| F13-AC-14 | Competency/evidence distintos, many-to-many, sem auto-verify. | Competency | unit+PG+F11 negative | prova fictícia |
| F13-AC-15 | Territórios/beneficiários usam schemes fechados/versionados, mappings explícitos e nenhuma equivalência por label. | Territory + beneficiary | contract+PG | seeds/mappings incorretos |
| F13-AC-16 | Financeiro ORG-only, decimal/temporal, sem FX/scoring. | Financial | unit+PG security | exposição |
| F13-AC-17 | Operacional ORG|UNIT, agregado, rollup só disjunto. | Operational | unit+PG | dupla contagem |
| F13-AC-18 | Unit/team refs canónicas/ativas; F13 não governa. | Scope | loaders+FK/RLS | entidade ausente |
| F13-AC-19 | Constraints `PROHIBITED|UNAVAILABLE` são fechadas, monotónicas e sem evaluator/scoring F14. | Exclusions boundary | contract+PG+structural | relaxamento/DSL |
| F13-AC-20 | Ausência/null/zero/false/states nunca colapsados; completion binária aplica policy/slots explícitos. | Knowledge + completion | state matrix+PG+property | falso negativo |
| F13-AC-21 | Operations F13, incluindo reclassificação própria, usam permission/resource/scope/SoD/MFA fechados. | Auth + confidentiality | catalog/startup | privilege creep |
| F13-AC-22 | F7 crítico+efeito atómicos; payload sanitizado. | Auth | PG rollback+scan | efeito sem audit |
| F13-AC-23 | Lifecycle não força F9; job futuro mantém contratos F9. | Lifecycle | structural/contract | async indevida |
| F13-AC-24 | F10 labels/codes fechados, sem IDs/valores. | Auth | telemetry tests | side channel |
| F13-AC-25 | Not-found/forbidden uniformes e RLS sem filtro. | Auth | PG A/B+spies | enumeração |
| F13-AC-26 | Migration no runner/manifest/checksum/fingerprint/capability. | Compat | structural+PG | drift |
| F13-AC-27 | Upgrades sem backfill ambíguo ou SQL direto. | Compat | PG prefixes | legacy corrupto |
| F13-AC-28 | Forward/rollback/retry/RLS/concurrency em PG17 descartável. | Todas | canonical gate | doubles |
| F13-AC-29 | SQL→ledger e materialização→cutover revertem integralmente. | Lifecycle | PG fault injection | parcial |
| F13-AC-30 | F13 não calcula match/score/eligibility/inferência lexical. | Boundary | source guard | invasão F14 |
| F13-AC-31 | Regressões F4–F12, npm test, node/diff/guards passam limpos. | Delivery | canonical commands | regressão |
| F13-AC-32 | F14 recebe apenas READY após completion integral, com versions/digests/policies exatos. | Todas + completion | PG vertical/replay | irreprodutível |

Total final: **32**, preservando `F13-AC-01`–`F13-AC-32`; coortes, SoD e knowledge states reforçam critérios existentes sem exigir IDs novos.

## Readiness audit

| Item | Classificação | Razão |
|---|---|---|
| Modelo canónico unit/team | **DEPENDENCY SATISFIED** | F13-P1 está `Complete`: schema `organizational_scope`, migration tenant 006, F5/F7/RLS, resource loader e participant registry foram entregues e arquivados. |
| Territórios | **DECISION RESOLVED** | Decisão `f13-territory-vocabulary`; schemes, mappings, assertions e compatibilidade estão aprovados. |
| Tipos de beneficiário | **DECISION RESOLVED** | Decisão `f13-beneficiary-vocabulary`; schemes institucionais, classificação económica, populações servidas e compatibilidade estão aprovados. |
| Exclusões F13/F14 | **DECISION RESOLVED** | Decisão `f13-exclusions-vs-f14-rules`; constraints declarativas, operands, composição monotónica e fronteira executável estão aprovados. |
| Completion policy concreta | **DECISION RESOLVED** | Decisão `f13-completion-policy`; separação conceptual, policies/slots, gates, coortes, digests e testabilidade estão aprovados. |
| Confidentiality + projection/reason/purpose catalogs | **DECISION RESOLVED** | Decisão `f13-confidentiality-projection-purpose`; classes, modes, acesso, side channels, digests e governance estão aprovados. |
| Compatibility schema/policy N/N-1 | **DECISION RESOLVED** | `f13-schema-policy-compatibility` fecha tuples, bundles, readers/writers, jobs, startup, upgrade e rollback. |
| Seeds taxonomy/competency/metrics | **IMPLEMENTATION DETAIL** | Conteúdo editorial em releases; gate de entrega, não arquitetura. |
| Verification methods/horizons/FTE/coverage | **IMPLEMENTATION DETAIL** | Conteúdo fechado de catalog/policy. |
| F7 schemas detalhados | **IMPLEMENTATION DETAIL** | Codes/atomicidade já fechados. |
| Limites materialização síncrona | **IMPLEMENTATION DETAIL** | Benchmark; exceder exige decisão async futura. |
| Retention/legal hold produtivos | **DEFERRED OUT OF SCOPE** | Sem delete físico F13. |
| Mapping automático F12/UBI | **DEFERRED OUT OF SCOPE** | Proibido; preservar unmapped/provenance. |
| Scheduling/rollout/provisioning | **DEFERRED OUT OF SCOPE** | Fora da v1. |

**Resultado atual (2026-10-11):** `In Progress`; fatias 2, 3 e 4 formalmente fechadas por decisão humana. R1–R6 encerrados no âmbito revisto, sem reabertura por esta implementação/revisão. F13-P1 continua `Complete`. Fecho da fatia 4 limitado a tenant 008 e create/edit/submit; aprovação/publicação de perfis, snapshots/activation e matching permanecem fora. `F13-AC-13`/`F13-AC-15` continuam `PARTIAL`; nenhum estado de AC é alterado nem AC integral promovido a `PASS`. As secções R1–R6 abaixo preservam evidência histórica, não substituem este estado atual. Este fecho não autoriza o desenvolvimento da fatia seguinte.

### Evidência das correções F13-S3-R2 (2026-10-11)

- Root OIDC compõe o adapter runtime de taxonomia com session store/registry F3 reais; legacy não emite autoridade. A binding exige pool e capability evidence exatas, ports centrais F5 e versão compatível. Handles opacos e contextos internos instance-local; nenhum transaction service funcional exposto. Request capture é adapter exclusivo do root após middleware F3, não comando/rota pública.
- Session store/registry e membership/snapshot são revalidados antes do SQL e após locks. Actor, membership, organização e assurance vêm exclusivamente dessa camada; correlation UUIDv7 interna. Inputs funcionais de autoridade, divergência/revogação/versões stale falham antes de ALLOW F5, SQL funcional e F7.
- Bootstrap F5 produtivo contém **34 permissions/operations**, sete da taxonomia, sem grants implícitos e com bundles de perfis vazios. Loaders específicos resolvem release/concept/relation/mapping exatos, tenant/pais/ownership/lifecycle; grants são avaliados para esse alvo. Replay e commit incerto reexecutam loader e autorização antes de devolver resultado.
- Publicação usa stable subject IDs de creator da release, autores de concepts/relations/mappings **e aprovadores**, sob locks ordenados; nenhum desses atores publica ou obtém bypass por replay. Publisher independente autorizado publica.
- Assurance é normalizada após ALLOW do F5 real, nunca por truthiness. F7 persiste policy, membership/authorization/catalog versions avaliadas, identidade/resource/digest/correlation/key sem conteúdo funcional. O gate compara os nove eventos persistidos das seis mutações às decisões F5 e testa rollback das seis mutações quando append falha.
- Testes focados F13/F3/F5/F7 + composição produtiva: **142/142 PASS**; suite backend **602/602 PASS**. Gates PostgreSQL 17 F13/F13-P1/F12 **PASS**, F9 PostgreSQL integrado **3/3 PASS**. Composição runtime + engine F5 + SQL/F7 reais; autoridade central usa fixtures F3 canónicos in-memory/session store/F5 ports sintéticos, sem alegação de IdP/rollout produtivo. Comandos, loaders/resources e matriz dos findings constam de `context/current-work.md`.
- Gate R2 manteve provas de isolamento A/B, global read-only, RLS/FORCE RLS/grants, DAG futuro/concorrência/imutabilidade, idempotência e commit incerto. O percurso 006→007→006 usava SQL direto, não downgrade canónico: essa sobredeclaração é retirada e substituída pela prova R3 abaixo. Migration 007 não foi alterada em R2: checksum histórico `eed5f7ac3a8170650ed07f620bdc7e5cc572db8204f01756581d516683acee0b`; fingerprint histórico `2b3e1fde15803415547a84e7c8cba60d7f1310a5a97a24344da96a9dab44445d`.
- F10 ligado ao registry produtivo allowlisted; labels exclusivamente operation/resultClass. `node --check` em 37 JavaScript e `git diff --check`: **PASS**. Scan de 43 ficheiros sem credenciais/PII reais após revisão dos candidatos sintéticos; cleanup sem containers/volumes dos gates F13/F13-P1/F12. Detalhes constam de current-work. AC-12/21/22/24/25/28/31 recebem evidência parcial adicional, não aprovação integral. Conteúdo editorial global/seeds e assertions de territórios/beneficiários permanecem pendentes de fatias posteriores.

### Evidência das correções F13-S3-R3 (2026-10-11)

- R3-001: as sete operações internas de taxonomia passam pelo runtime F4 (resolver/credential provider/pool manager/binding verifier/lease executor). A pool não é autoridade física. O client adquirido é observado antes da operação, após BEGIN e antes do commit; capability privada liga wrapper, transação, allocation físico, tenant/organização/workload/schema, fence e deadline. Autoridade F3/versões F5 e diretório F4 são revalidados antes do commit; clones/reutilização e drift falham fechado. Mesma conexão em loaders/F5/alteração/F7/idempotência/commit. Replay/commit incerto exigem nova F3/F4/F5.
- PostgreSQL 17 com duas bases migradas pelo runner comprova destino trocado com o mesmo objeto pool, evidence A/adapter B, binding/geração stale e revogação/destino/fence/capability alterados durante a operação: zero efeitos funcionais, eventos F7 e resultados idempotentes **persistidos** em ambas. Recusas iniciais também têm zero ALLOW/SQL de mutação/F7. Sessão/diretório/membership usam fixtures sintéticos; SQL/observação física/engine F5/F7 são reais, sem alegação de IdP/rollout produtivo. Harness administrativo descartável observa/preflight; efeitos usam role runtime. F12 conserva provas de LOGIN físico não privilegiado F4.
- R3-002: advisory lock database-local `F13-TAXONOMY-DAG/43001304` é a primeira entrada de toda mutação funcional e dos triggers BEFORE STATEMENT das seis tabelas, antes dos tuple locks PostgreSQL. Permanecem guards de grafo futuro e locks específicos. Quatro interleavings determinísticos (funcional/SQL primeiro × INSERT/UPDATE), observando `pg_blocking_pids`, terminam sem 40P01, DAG válido, um F7 e um resultado idempotente por comando funcional/replay. Não há retry cego. Writes são serializados na base tenant; sem promessa de paralelismo entre schemes ou de segurança para SQL que tome locks manuais fora do protocolo.
- R3-003: `createTenantMigrationRunner.downgrade` limita o downgrade a 007→006 com checksum down pinned, preflight/ledger/migration lock/fingerprints/postflight e publicação de schema observation. Exceção owner-only ao append-only do ledger remove exclusivamente 007, reativando o trigger na mesma transação; falhas revertem tudo. Prova real **006→007→006→007** pelo runner: ledger 7→8→7→8, roles/ACLs audit e constraints F7 removidos/recriados, fingerprint 006 recuperado. Falha de DELETE do ledger após down restaura 007; down com dados é recusado. Requests de revisions 1/2/3/4 são observados pelo publisher sintético do gate, não apresentados como CAS Central externa.
- Validação final: focados F13/F3/F4/F4.3/F4.4/F5/F7/composição **276/276 PASS**; backend **607/607 PASS**, sem skips/TODOs. Gates PostgreSQL F13/F13-P1/F12 **PASS**; F9 PostgreSQL integrado **3/3 PASS**. `node --check` em **45 JavaScript**, `git diff --check`, scans heurísticos de **52 ficheiros** e cleanup **PASS**: zero PII/candidatos reais de credenciais; onze candidatos eram sentinelas/URLs loopback geradas. Teardown F13/F13-P1 remove também volumes anónimos; 29 volumes recentes identificados como gates sintéticos e unattached foram removidos (dados de teste não recuperáveis), sem prune/remoção de recursos alheios. Comandos, detalhes e limitações no current-work.
- Migration 007 up alterada apenas para fencing dos locks: checksum final `8483731bd1acd2d14001445e92964566322cc16df32d2c5c70f49246237f81da`; fingerprint PG17 final `3fcd5e77abd9fefd1187b65db1a3b419bad5eebfa1a67d06b14eca5d0a090a22`. Down intacto, checksum `958ae2d8ef4153fe3387b82706d66edff55ddf76199f853f67397f6da1a33eca`; prefix 006 fingerprint `29a98501da147ab979043e156e290c7f625dcc442b6da593c1c6ff135bbea70f`.
- R1-001–007 e R2-001–004 têm correções preservadas/revalidadas com as novas provas R3; R3-001–003 implementados/validados, todos pendentes de aceitação pela nova revisão independente. AC-13/AC-15 **PARTIAL**, nenhum AC PASS. Migration 008 não criada nem autorizada; sem stage/commit/matching, alterações anteriores preservadas.

## Plano reconciliado com F13-P1

### Evidência histórica da primeira tentativa R4 (2026-10-11)

A evidência R3 acima é histórica: a revisão read-only reproduziu revogação de sessão/avanço de versões F5 entre a última validação F3 e COMMIT, com efeitos/F7/idempotência persistidos (**R4-001 HIGH**). Não se declarou uma leitura adicional como correção. O runtime F4 não oferece guard que coordene a autoridade F3/F5 com revogações até ao commit; o contrato dessa coordenação permanece por definir antes de alterar as fundações.

**R4-002 MEDIUM corrigido/validado:** o guard down 007 inclui a raiz independente `taxonomy_idempotency_record` nos locks e verificações. O gate PostgreSQL canónico testa recusa do downgrade com apenas dados de idempotência, preservando registo/schema/ledger/fingerprint e nenhuma publication, antes do roundtrip vazio existente. Focados 276/276, backend 607/607 e gates F13/F13-P1 PASS; sem promoção de AC.

Checksum up 007 corrente: `c327d759936b69df5f495e2454f209a6ddd34c94dc512933f700363a8cd5a900`; fingerprint 007 corrente: `17df0837daf146752e94fc7c870e58b653e23dd1051ea31b697e37d1c477b909`. Down checksum e fingerprint 006 intactos, conforme current-work. Nenhum stage/commit, migration 008 ou matching. AC-13/AC-15 continuam **PARTIAL**.

### Estado corrente — protocolo Central autorizado

O contrato aprovado criou **Central 009**, sem criar/alterar tenant 008 ou alterar tenant 007. Ownership do coordinator em security/authorization; OrganizationalProfile apenas consome. Fonte produtiva F5 agora é versionada Central, ligada à membership real; session registry/store e membership usam o mesmo coordenador. O transaction service recusa execução sem capability física e guard privado da composição F4.

PREPARED durável lineariza contra requests de autoridade. Request WAITING avança epoch e recusa novos guards; guards anteriores terminam/reconciliam primeiro. Escritas efetivas F3/F5 + APPLIED são uma única transação Central, protegidas por permits/ACLs/triggers e constraint deferred. O mutex Central é curto e antecede row locks; espera de guards/recovery ocorre fora dele. Recovery source-local prende o nonce da transação física original antes de consultar o resultado idempotente, nunca decide rollback por morte do processo/deadline. Estado terminal confirmado ou RECOVERED só então permite aplicar as revogações em espera. Detalhes dos estados, locks, recovery e limitações em `context/current-work.md`, secção “Authority commit guard durável”.

Provas PostgreSQL 17 Central + dois tenants PASS: seis mudanças de autoridade × ambas as ordens de linearização, revogações na janela final, bloqueio de novos guards por pending writer, crashes reais antes/depois do commit tenant e numa escrita Central, COMMIT incerto, deadlines, stale/reuse, recovery repetido, isolamento e igualdade do F7 persistido/decisão F5. Gate F13 preserva os testes de sete operações/grants assimétricos, seis rollbacks F7, maker-checker, DAG concorrente, imutabilidade e idempotência. R4-002 novamente PASS: idempotência isolada impede down; percurso canónico vazio 006→007→006→007 confirmado. Central 008→009→008→009 e rollback de falha de ledger confirmados; F12/Central e F13-P1 PASS; F9 PostgreSQL 3/3 PASS.

Central 009 checksum up `c3bd5290766fcb6fe61c43f8e747fae6b233f1e72d82abc1e0b1301889faad87`, down `35a8fe74ac51b82d8fc730456dc5fdad2771456a85a624339a59f088b493126e`, fingerprint `d351e0142f4c73fa749e161bbfa8c007ff1d73d0d31993aa6418ef4e7e07e9f7`. As numerações Central/tenant são independentes; qualquer declaração histórica de migrations 008–009 suspensas refere-se às fatias tenant, não à Central 009 agora autorizada.

R4-001/R4-002 prontos para nova revisão read-only, não fecho automático. AC-13/AC-15 **PARTIAL**, F13 **In Progress**. Sem evidência de IdP externo/rollout/SLO, worker recovery externo, retenção automatizada ou authoring/matching. Binding indisponível/drift mantém guards pendentes fail-closed; pedidos de autoridade cancelados exigem retry. Tenant 008 continua suspensa.

Validação final desta implementação: focados **305/305**, backend **613/613**, `node --check` **62 JS**, `git diff --check` PASS. Scan **70 ficheiros**: apenas três URLs-canário dos testes de sanitização, sem credenciais reais/PII encontradas nos padrões usados. Repetição F13 sem bypass também comprovou grants unitários/asimétricos na fonte Central real. Comandos, pins, evidências e limites completos em current-work. Nenhum AC promovido a PASS; alterações preexistentes preservadas.

- O próximo ordinal tenant disponível é `007`, depois de `006_f13_p1_organizational_scope`.
- FKs de scopes usam `(organization_id, scope_id)` contra `organizational_scope.scope`; `scope_type` e `lifecycle` são revalidados pelo resource loader server-side e sob a mesma transação das mutações F13.
- A organização raiz continua a vir do contexto F3 e não ganha row duplicada em `organizational_scope.scope`.
- A capability final F13 é `F13_ORGANIZATIONAL_PROFILE`. Só será declarada quando schema, catálogos, preflight e participant de archive estiverem íntegros.
- O participant F13 será criado pela composição F13 e injetado internamente na composição F13-P1; usará o mesmo client preparado para desativar o pointer do overlay e persistir activation/F7 antes do archive fazer commit.
- Tenants em 006 continuam plenamente válidos para F13-P1 e sem F13; ausência da capability F13 significa ausência legítima do participant. Capability presente sem participant compatível falha fechado.
- O plano detalhado, as fatias verticais e a matriz dos 32 AC estão em `context/current-work.md`.

### Correção corrente R5 — autoridade dedicada e preflight de ACL (2026-10-11)

Esta secção substitui os pins/readiness históricos R4 acima. **F13 In Progress; AC-13/AC-15 PARTIAL; fatia 3 não fechada; tenant 008 suspensa/ausente.** Não foram criados matching, APIs administrativas, stage ou commit.

- **R5-001:** Central 009 separa owner NOLOGIN, executor/coordinator NOLOGIN e `c4g_authority_runtime` LOGIN limitado. Geral `c4g_central_runtime` não recebe memberships/grants do protocolo. Pool exclusiva em `config/authorityDb.js` (`AUTHORITY_DATABASE_URL`/`AUTHORITY_DB_*`), wiring root explícito e diferente da pool geral; admissão confirma session_user/current_user real limitado, sem SET ROLE. Identity/jobs continuam na pool geral; OrganizationalProfile não gere autoridade.
- Zero DML direto de guards/requests/permits/epochs/F5, zero sequence USAGE e zero DDL/admin para login/executor. Só USAGE privado + EXECUTE em `authority_api.execute(text,text[],text)`, SECURITY DEFINER owner NOLOGIN, path fixo, SQL fully-qualified, catálogo de **52 queries estáticas**/códigos, parâmetros validados e quotados em passagem única. SELECT dos markers/ledger suporta admissão; os triggers não são invocáveis pelo runtime. Matrizes exatas de ownership/F3/table/column/schema/sequence/function/membership em current-work.
- Transições mantêm requests WAITING→APPLIED/CANCELLED, epoch monotónico, permits REGISTER/APPLY transaction-local e estados PREPARED/TENANT_COMMIT_UNKNOWN/TENANT_COMMITTED/ABORTED/RECOVERED. UPDATE/finalização exige permit HMAC privado ligado a guard/nonce/tenant, gerado apenas após acknowledgement/recovery tenant; Central guarda digest, não a chave/permit. Trigger impede finalização forjada e DELETE de guard, inclusive sob grant acidental SELECT/UPDATE/DELETE ao runtime geral. `AUTHORITY_COMMIT_PERMIT_SECRET` estável fora do Central é obrigatório; recuperação após restart usa a mesma chave. Não rodar/perder a chave com guards pendentes; rotação/escrow e provisioning externo não foram implementados.
- **R5-002:** manifest/fingerprint incluem snapshot exato de roles, LOGIN/NOLOGIN, atributos administrativos/config/expiry, todas as memberships críticas e ADMIN/INHERIT/SET, owners, schemas public/privado, ACLs/grant options de tabelas/colunas/sequência/funções e respetivas definições. Grants PUBLIC/geral ou privilégios adicionais recusam o preflight. Segurança revalidada por client em cada admissão e sob mutex; preflight canónico completo no primeiro uso do client.
- Provas reais PASS: session_user limitado no fluxo completo; pools com identidade geral/owner recusadas; DML/DDL/admin/SET ROLE diretos recusados; **25 drifts ACL** com recusa do preflight/admissão e recuperação após reparação autorizada. Guard tenant ativo + drift + tentativa geral/permit forjado + reparação + COMMIT incerto reconciliado, sem perda da exclusão e com uma mutação/F7/idempotência. Nenhum mock é a única evidência do protocolo.
- R4-001 revalidado em Central + dois tenants: revogações/grants/versões/policy/assurance nas duas ordens de linearização, crashes reais antes/depois do commit, writer abandonado, commit incerto, recovery repetido, deadline/fencing e F7 persistido. Mantém mutex Central antes de row locks, sem lock Central mantido enquanto espera tenant; PREPARED anterior ordena a revogação depois, epoch/request anterior recusa o guard. R4-002 continua revalidado: idempotência isolada impede down; 006→007→006→007 pelo runner. Central 008→009→008→009 remove/recria roles/ACLs/schema; falha tardia de ledger faz rollback; dados protegidos impedem down.
- Gates F13/F13-P1/F12/Central PASS; F9 PostgreSQL 3/3 PASS; focados **308/308**, backend **616/616**. Repetição F13 final PASS com assertions adicionais de UPDATE nas cinco tabelas, dados adversariais e membership indevida. `node --check` **67 JS**, tracked/untracked whitespace checks PASS; scans **75 ficheiros**, nove candidatos URL benignos revistos, sem credenciais reais/PII encontradas nos padrões usados. Cleanup apenas dos recursos desta execução, sem resíduos dos gates; preexistentes preservados. Comandos/resultados/ensaios falhados (não contados como prova) em current-work.

Pins Central 009: up `ac647889866689c44887df39db2b63393a1fcf600031a184729cf53ef46376ce`; down `5b0621f15506bfb301f9e76ef3f7f08c05925c4255ce0c849bfc3ff8f14b6e4f`; schema `25f2be4aff92171756eef86d474882eb7208bfe829ff3f8f7cac269202029e26`; ACL/security `43e9053ba4b6ae5f2c2163d4cc94946dc706f687971867c82040536b8bd75e6f`. Tenant 007/checksums/fingerprints permanecem intactos conforme current-work.

R5-001/R5-002 implementados/comprovados e R4 preservados/revalidados, **aguardando revisão independente**, sem fecho automático. Sem evidência de IdP externo/rollout/SLO/worker recovery externo; autoridade administrativa de emergência não é fronteira protegida contra DDL privilegiado. Drift/binding indisponível/chave perdida mantém guards fail-closed, sem rollback inferido por morte/deadline e sem limpeza automática de evidência.

### Correção corrente R6 — fontes F3 e admissão sem cache (2026-10-11)

Substitui as declarações históricas de cobertura/readiness R5-002 e os pins anteriores. **F13 In Progress, fatia 3 não fechada, AC-13/AC-15 PARTIAL, tenant 008 suspensa/ausente.**

- R6-001: snapshot seleciona objetos críticos F3/protocolo e expande **todas** as ACLs, não apenas destinatários authority. Inclui PUBLIC/roles externas, colunas/grant options, marker/ledger/session store/sess/global_user/primary_email e restantes fontes de autoridade. Objetos adicionais owned/granted às authority roles são tratados da mesma forma, incluindo schemas/funções. Grants F3 legítimos preservados.
- R6-002: removida a evidência permanente por WeakSet; **cada** admissão no client físico limitado executa o preflight canónico completo antes da transação de metadata, além do fingerprint de segurança e do check ACL sob mutex. Schema/constraints e ledger/checksums não são ignorados após aquecimento da conexão.
- Provas PostgreSQL reais PASS: **47 drifts ACL**, incluindo 22 casos F3/PUBLIC/role externa/colunas/grant option; **dois drifts no mesmo client já usado**, constraint deadline e checksum do ledger; recusa antes do callback funcional e retorno à admissão válida só após reparação. Guard ativo com drift F3+protocolo mantém exclusão, runtime geral/permit forjado recusados, zero efeitos visíveis, reparação e COMMIT incerto reconciliado com uma mutação/F7/idempotência. Um grant administrativo continua efetivo enquanto não for removido: o preflight deteta/falha fechado, não é prevenção retroativa de exposição por administrador.
- R4/R5 preservados/revalidados: seis corridas nas duas ordens, crashes/recovery/commit incerto e F7 persistido; tenant **006→007→006→007** e recusa down com só idempotência; Central **008→009→008→009**, rollback schema+ledger e recusa down com dados. Focados **308/308**, backend **616/616**, gates F13/F13-P1/F12/Central PASS, F9 PostgreSQL **3/3**. Syntax **67 JS**, whitespace tracked/35 untracked, scans **75 ficheiros** PASS nos padrões usados. Evidência/comandos e duas falhas iniciais de assertions de teste em current-work.
- SQL migrations Central 009 e tenant 007 intactas. Só manifest/fingerprints de observação Central atualizados: schema `9e975a00c3f11a6a4b7995c954d3cb437407751b10d35789a597acd69b0e6581`; ACL/security `4da6e49668d6c8620951291c9a6fad558731cd2f5d10c2b2770086e6914f2fe0`. Checksums up/down 009 continuam `ac647889866689c44887df39db2b63393a1fcf600031a184729cf53ef46376ce` / `5b0621f15506bfb301f9e76ef3f7f08c05925c4255ce0c849bfc3ff8f14b6e4f`.

Correções prontas para revisão read-only, sem fecho/autorizações implícitas e sem stage/commit. Limites operacionais/IdP/chave/recovery/retention anteriores mantidos; não houve matching, authoring ou tenant 008. A revisão subsequente reporta o veredicto sem editar estes documentos durante a fase read-only.

### Fecho formal da fatia 3 e início da fatia 4 (2026-10-11)

Decisão humana explícita regista o fecho da fatia 3 após correções e revisão read-only R6 sem findings bloqueadores. R1–R6 encerrados no âmbito revisto; não são reabertos sem evidência concreta nova. F13 continua In Progress e AC-13/AC-15 PARTIAL. São autorizados tenant 008 e create/edit/submit de drafts, revisions/items append-only, CAS/idempotência e composição F3/F4/F5/F7/F10. Aprovação/publicação, snapshots/activation, F14, frontend e assertions territoriais/beneficiários completas ficam fora. Sem stage/commit.

### Fatia 4 — núcleo editorial implementado e evidência (2026-10-11)

- Contratos funcionais fechados: create `{draftId,scopeId,items,idempotencyKey}`; edit `{draftId,expectedRevision,items,idempotencyKey}`; submit `{draftId,expectedRevision,idempotencyKey}`. `scopeId:null` seleciona ORGANIZATION; UUID seleciona scope canónico ativo cujo tipo UNIT/TEAM é carregado no servidor. Não recebe identidade, organização, correlation, assurance, resource ou tipo de scope como autoridade. O adaptador OIDC/F3 cria os handles; o service transacional não é API funcional.
- Primeiro núcleo materializa apenas referências tipadas `THEMATIC_AREA`/`STRATEGIC_PRIORITY`, até 100 items por revision, `KNOWN` com concept válido do scheme/release publicado ou `UNKNOWN` sem valor. Cada item identifica `itemId` e `itemVersionId`; versões idênticas podem ser reutilizadas, conteúdo divergente exige UUID novo. Edit é substituição integral explícita da lista, preservando as versões e ligações históricas. Estados editoriais do draft são DRAFT/SUBMITTED; submit cria revision e bloqueia edição, sem aprovar, publicar ou ativar. Este contrato restrito não implementa os demais domínios/assertions completos.
- Estados dos items são fixos e explícitos neste núcleo: UNVERIFIED, CLEAR, DRAFT, INTERNAL; não há auto-verificação, reclassificação, redaction ou completeness. Ausência de item continua não materialização, não UNKNOWN. Nenhuma regra F14/scoring ou equivalência por label foi adicionada.
- Tenant 008 acrescenta cinco tabelas com RLS/FORCE RLS: draft, draft revision, item version, revision item e resultado idempotente. Revisions/items/links/resultados são append-only; head/lifecycle são as únicas colunas UPDATE concedidas. Deferred FK e guards exigem head/history contíguos; resultado source-local sela o conjunto de items da revision. Down recusa qualquer conteúdo protegido e não interpreta uma vista RLS vazia como ausência de dados.
- F5 produtivo: três operações explícitas create/edit/submit, resources PROFILE_SCOPE/PROFILE_DRAFT exatos, grants positivos ORG/UNIT/TEAM e bundles vazios. Scope do grant é resolvido separadamente do ID do draft. Replay resolve novamente scope/recurso e F3/F5 antes do resultado. F7 crítico nas três mutações usa a mesma conexão/transação e guarda identidade/versões/policy/assurance realmente avaliadas, versões anterior/nova e digest, sem items/labels/PII.
- Mesma composição de confiança F3/F4/F5 da taxonomia, pool preparada e fencing físico; coordinator Central continua owner da autoridade. Ordem: preparação F4, mutex organizacional F13-P1, lock de intenção, draft/resource loader, autoridade F3/F5/guard durável, append material/head, F7, resultado, fencing físico e COMMIT protegido. Replay não duplica evento. COMMIT incerto reconcilia por nonce/terminação e resultado tenant da operação, depois reautoriza antes de devolver a projeção. Recovery aceita apenas o mapa fechado de operações e capability AUTHORING para fontes PROFILE_*.
- PASS em `test/integration/f13/authoring-gate.ps1`: Central real e duas bases tenant, upgrade 007→008 pelo runner, rollback SQL+ledger, repetição idempotente, CAS e duas sessões com mesma key, conflito de intenção, isolamento por tenant/operação, scopes UNIT/TEAM server-side, grants assimétricos/recurso diferente, replay revogado/stale, F7 persistido igual à F5, rollback das três mutações por falha de append, COMMIT incerto RECOVERED/COMMITTED, drift físico antes do commit, SQL append-only, recusa de material adicional em revision selada, revision órfã e três drifts ACL (UPDATE items, CREATE no schema de scopes e EXECUTE de trigger para PUBLIC). Taxonomia produtiva funciona sobre 008; KNOWN recusa release draft e scheme diferente, aceita release governada publicada.
- Gates F13 (007/R1–R6), F13-P1 e F12/Central PASS. F12 prova instalações vazias e upgrades 003/004/005/006→008; authoring prova 007→008. F9 PostgreSQL 3/3 PASS. Focados recursivos 315/315 e backend 623/623 PASS, sem skips/TODO. Syntax 78 JS e whitespace tracked/48 untracked PASS. Scans em 90 ficheiros: nenhum segredo conhecido/PII real nos padrões usados; nove URLs sintéticas/dinâmicas e um falso positivo numérico de bucket de métricas revistos. Não é garantia universal de deteção. Cleanup dos recursos próprios; recursos preexistentes preservados.
- Pins 008: up `7a6921546c6902bb59f6b3f34adbde4266e7eb947370cf0e7390b67b07edb30c`; down `47a908e9f1b30ffb4337f68af34c81cfed0aabd72aff9d2f4a74aee702a4995d`; fingerprint `7ee1e9277e39c0016985061fe0ddcd03980474680f9855ee50fc2aebe59f4b8f`. SQL 007/Central 009 e os seus pins não mudaram. Captura SQL transacional confirmou down vazio→fingerprint 007; não é downgrade canónico 008→007. O runner continua a autorizar apenas o downgrade conservador 007→006.
- Evidência parcial reforçada para AC-01/02/04/05/09/10/11/12/13/18/20/21/22/25/29/31/32, limitada a authoring e referências implementadas. Não prova activation, snapshots, approval/publication de perfis, projeções, domains restantes, rollout/IdP externo ou SLO. Todos os AC mantêm os estados prévios; AC-13/AC-15 PARTIAL.

### Fecho formal da fatia 4 (2026-10-11)

Após revisão formal read-only **sem findings bloqueadores**, o utilizador aprovou explicitamente o registo do fecho da fatia 4, mantendo os limites e os estados dos critérios. Não foram identificados findings concretos BLOCKER/HIGH/MEDIUM/LOW no âmbito entregue. O fecho cobre exclusivamente tenant 008 e núcleo create/edit/submit com revisions/items append-only, CAS/idempotência, âmbito server-side, composição F3/F4/F5/F7/F10, isolamento e reconciliação de COMMIT incerto.

Na revisão foram repetidos focados **315/315**, backend **623/623**, gates PostgreSQL authoring 008/F13/F13-P1/F12/Central **PASS** e F9 PostgreSQL **3/3**; syntax **78 JS**, whitespace tracked/**48 untracked** e scans de **90 ficheiros** verificados. Uma prova concorrente independente com role runtime recusou material sobre revision ainda não confirmada por FK (`23503`), preservando zero items conforme o comando. Down vazio 008 recuperou fingerprint 007 por captura transacional; down com dados recusou e preservou o estado. Não existe downgrade canónico 008→007; somente 007→006 permanece autorizado pelo runner. Ensaios exploratórios inconclusivos não contam como PASS; detalhes da revisão/fecho constam de `context/current-work.md`. Pins 008 mantidos, SQL 007/Central 009 intactos.

Mantêm-se o núcleo restrito THEMATIC_AREA/STRATEGIC_PRIORITY e os estados já documentados; aprovação/publicação, snapshots/activation, restantes domínios/assertions, completude/projeções completas, matching e frontend ficam fora. Sem alegação de IdP externo, rollout produtivo, SLO ou resolução dos limites operacionais de recovery/chaves/retention. R1–R6 da fatia 3 não reabertos. **F13 In Progress; AC-13/AC-15 PARTIAL; todos os restantes estados dos critérios inalterados; nenhum AC integral PASS.** Feature não arquivada nem marcada Complete. Próxima fatia aguarda plano/âmbito e autorização explícita. Este registo apenas altera documentação; não repete testes nem inicia funcionalidades, commit ou stage.

### Fatia 5 — evidência corrente e prontidão (2026-10-11)

Implementação conforme contrato mínimo acima, pronta para **Review read-only**, não fechada. O root compõe os nove módulos competency; tenant 009 acrescenta oito tabelas append-only/RLS/FORCE RLS, catálogos globais read-only sem seeds e suporte estrutural fail-closed. Authoring antigo preserva os novos membros. F5 produtivo tem 40 permissions/42 operations; bundles vazios. F7 crítico para as cinco operações no mesmo client/transaction, assurance/policy efetivamente avaliadas; F10 fechado. DOCUMENT_READ adicional fica protegido pelo mesmo guard Central, sem alterar SQL Central 009. Runtime não recebe conteúdo, URLs ou object IDs F11. Recovery source-local fechado e replay reautorizado.

Provas executadas: focados F3/F4/F5/F7/F11/F13/composição/Central **345/345**, backend **631/631**; gate competency 009 **PASS** (Central real + dois tenants, CAS/concorrência/idempotência/conflito, many-to-many 2×2, isolamento, maker-checker/MFA, verificação explícita, F11 separado/binding/estado, cinco rollbacks F7, F5 negativo, eventos realmente persistidos e COMMIT incerto RECOVERED/COMMITTED). Runner **008→009→008→009**, ledger/fingerprints e recusa down com dados comprovados. Authoring 008 prefix preservado, F13 (007/R1–R6), F13-P1 e F12/Central **PASS**; F12 demonstra instalações vazias e upgrades 003/004/005/006→009. F9 PostgreSQL **3/3 PASS**. Syntax **90 JS**, whitespace tracked/**63 untracked** e scans **105 ficheiros** PASS nos padrões usados, com dois falsos positivos numéricos e onze URLs canary/dinâmicas revistos. Recursos próprios removidos, preexistentes preservados. Comandos, falhas preliminares corrigidas sem relaxar guards e limitações constam do current-work; não são omitidos nem contabilizados como PASS.

Pins tenant 009: up `67b77c264e4d73b5c1eaf81e6b9fe697c6274fd0fc1dfeff5d4a4dd420adbb68`; down `f99fd63315880e38529e751c989b68828c0f71e2334fc632416b05869f0d90d7`; fingerprint `8303439f92fede45fc692c96ece5792e419b554e51ac92d3e2b49df1a14bbf7b`. Down canónico recupera fingerprint 008 `7ee1e9277e39c0016985061fe0ddcd03980474680f9855ee50fc2aebe59f4b8f`. Tenant 008/Central 009 SQL intactas. A nova autorização conservadora 009→008 não autoriza 008→007; downgrade histórico 007→006 permanece no prefix apropriado.

Contratos ainda pendentes: conteúdo produtivo dos catálogos, frameworks/níveis/tipos/métodos/validade editoriais e sua gestão, lifecycle completo de verificação. Nenhum seed fictício, defaults permissivos, escala universal ou método implícito foi criado. Approval/publication, snapshots/activation (migration tenant posterior), outros domínios, frontend e matching continuam fora. AC-14 recebe esta evidência, mas o estado anterior da matriz não é promovido antes de revisão integral. **F13 In Progress; AC-13/AC-15 PARTIAL; todos os estados de AC inalterados.** Sem stage/commit nem fecho automático da fatia 5.

### Fatia 5 — correções após revisão R1 (2026-10-11)

A revisão formal anterior identificou **F13-S5-R1-001 HIGH**, **R1-002 MEDIUM** e **R1-003 MEDIUM** por provas PostgreSQL independentes. A prontidão e os pins anteriores não constituem prova destes casos; os pins vigentes são os seguintes. Não houve fecho automático nem promoção de critérios: **F13 In Progress, AC-13/AC-15 PARTIAL, AC-14 PENDING**, restantes estados mantidos.

- R1-001: tenant 009 valida referências em triggers invoker BEFORE INSERT, além das FKs: organização/global, kind, release publicada e ownership, e compatibilidade framework/version/release de nível. Runtime não recebe novos privilégios; tenant 008/Central 009 inalteradas. SQL runtime real confirmou negativos e positivos global/own sem depender dos filtros JavaScript.
- R1-002: verificação substitui somente o resultado corrente da assertion alvo. Duas verificações correntes, reverificação seletiva e submissão foram comprovadas na composição real; os três resultados históricos permanecem append-only. Alterações materiais continuam a invalidar conservadoramente resultados correntes segundo o contrato existente.
- R1-003: uma segunda incerteza de COMMIT reconcilia o guard durável e termina com erro F13_PERSISTENCE_UNAVAILABLE, sem exportar handles internos nem afirmar rollback. Retry da mesma key/intenção resolve novamente F3/F5 e devolve o resultado persistido. Mutação/read com duas confirmações perdidas preservam um F7 e um resultado source-local.

Validação de implementação: backend **631/631**, focados **345/345**, gates 009/authoring008/F13/F13-P1/F12/Central **PASS**, F9 PostgreSQL **3/3**. Runner real **008→009→008→009**, down conservador e recuperação do fingerprint 008 provados. Syntax **90 JS**, whitespace e scans por padrões sem ocorrência real de credenciais/PII identificada; limitações dos scans mantidas. Detalhes e comandos em current-work. Snapshot segue para nova revisão formal read-only; não se regista aqui antecipadamente o seu veredicto.

Pins vigentes: 009 up `244282e6b87034d15600ab61df04a0fe77347c307132232509a300dbb184708e`; down `f99fd63315880e38529e751c989b68828c0f71e2334fc632416b05869f0d90d7`; schema/ACL fingerprint `5a23e5b95300e9af471d90ac4e1212c5e88c11b3735fa88445e7b6aae010f1f1`. Nenhuma migration posterior, matching, API administrativa ou conteúdo editorial produtivo inventado foi acrescentado. Não houve stage/commit.

### Fecho formal restrito da fatia 5 (2026-10-11)

Aprovação humana explícita regista a fatia 5 — competências, experiência e evidências — como **formalmente fechada no âmbito restrito entregue**, após nova revisão formal read-only **sem findings bloqueadores**. Este fecho substitui as declarações históricas de revisão pendente, não fecha a F13 integral nem autoriza outra fatia.

**F13-S5-R1-001, R1-002 e R1-003 corrigidos e revalidados:** SQL runtime recusa referências entre organizações/tipos incompatíveis; verificações de várias assertions coexistem e são substituídas seletivamente, com histórico preservado; duas perdas de confirmação de COMMIT não expõem guards e permitem retry reautorizado sem duplicar F7/idempotência. Reproduções independentes sobre Central e dois tenants PostgreSQL reais confirmaram as correções.

Tenant `009_f13_competencies_and_experience` validada:

- **Up:** `244282e6b87034d15600ab61df04a0fe77347c307132232509a300dbb184708e`.
- **Down:** `f99fd63315880e38529e751c989b68828c0f71e2334fc632416b05869f0d90d7`.
- **Fingerprint:** `5a23e5b95300e9af471d90ac4e1212c5e88c11b3735fa88445e7b6aae010f1f1`.

Evidência da ação anterior: backend **631/631**, focados **345/345**, gates competências/authoring/F13/Central/F13-P1/F12 **PASS**, F9 PostgreSQL **3/3**, runner **008→009→008→009**, syntax/whitespace/scans e snapshot preservado durante a revisão. Este registo apenas atualiza documentação; não constitui nova execução destes testes nem rollout produtivo.

**F13 In Progress; AC-13/AC-15 PARTIAL; AC-14 PENDING; demais critérios e estados inalterados.** Catálogos editoriais produtivos e lifecycle permanecem pendentes. Aprovação/publicação de perfis, snapshots/activation, frontend, matching e demais domínios continuam fora do âmbito fechado. Sem alterações de código/migrations, stage/commit ou início de outra fatia. Feature integral não arquivada nem marcada Complete; limites operacionais anteriores mantidos.

### Fatia 6 — âmbito e contratos formalmente aprovados (2026-10-11)

Aprovação humana autoriza capacidade financeira **ORG-only**, tenant proposta `010_f13_financial_capacity`, sem alterar migrations anteriores. Contratos aprovados: montante exato **NUMERIC(24,6) >= 0**; moeda/indicador monetário por catálogos fechados; período inclusivo start_date/end_date ordenado; estados **DRAFT/SUBMITTED/VERIFIED/REJECTED/DISPUTED/REVOKED/EXPIRED**; métodos/reasons catalogados; sem seeds produtivos; valid_from obrigatório e valid_until opcional na verificação; F11 separado sem redução de confidencialidade; create/edit/read/submit/verify com permissions distintas; verificação maker-checker/MFA; CAS/idempotência/history, F3/F4/F5/F7/F10 e recovery durável. F7 não contém montantes/documentos/dados financeiros sensíveis.

A inspeção anterior ao código identificou **matriz de transições/autoridade** e **fonte/semântica de confidencialidade F11** por confirmar: os estados aprovados não concedem implicitamente dispute/revoke/reject a edit/verify, e o schema F11 não contém classe de confidencialidade; DOCUMENTS/QUARANTINE são storage classes. Alternativas e perguntas concretas constam de current-work. Sem resolver estes contratos, não se declara o núcleo implementado nem se inventam políticas/classificações.

Tenant 010 ainda não criada; nenhum pin ou prova de teste novo declarado. Requisitos de prova: PostgreSQL real para numeric/period/catalog, A/B, CAS/replay, SoD/MFA/F11/confidencialidade, F7/F10 sem fuga, rollbacks/commit incerto e runner 009→010/down seguro. FX/scoring/bandas/derivação/publicação/snapshots/activation/frontend/matching ficam fora. **F13 In Progress; AC-13/AC-15 PARTIAL; AC-14/AC-16 PENDING; restantes estados inalterados.** Fecho da fatia 5 preservado. Sem código/migrations, stage/commit ou início de outra fatia nesta ação documental.

## Decisões aplicáveis

- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/organizational-scope-foundation.md`
- `context/decisions/f13-territory-vocabulary.md`
- `context/decisions/f13-beneficiary-vocabulary.md`
- `context/decisions/f13-exclusions-vs-f14-rules.md`
- `context/decisions/f13-completion-policy.md`
- `context/decisions/f13-confidentiality-projection-purpose.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/decisions/f13-competencies-and-experience.md`
- `context/decisions/f13-financial-capacity.md`
- `context/decisions/f13-operational-capacity.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/decisions/f13-schema-policy-compatibility.md`

## Fatia 6 — implementação e evidências (2026-10-11)

As duas pendências históricas acima foram resolvidas por aprovação humana. O registo anterior de “010 ainda não criada” descreve apenas aquela ação documental, não o estado atual. Entrega atual: tenant `010_f13_financial_capacity`, oito operações produtivas e gate PostgreSQL real; **sem fecho automático, sem stage/commit**.

### Contratos e implementação

- Assertions financeiras com identidade/head próprios, sempre no baseline Organization resolvido server-side; não alteram o head dos drafts das fatias 4/5. Revisões append-only e CAS; montante conhecido como string decimal canónica convertida exatamente em NUMERIC(24,6), sem rounding silencioso, FX, bands, scoring ou valores derivados. Zero é um valor explícito, não uma inferência de ausência.
- Catálogos versionados fechados de moedas/métodos/reasons/purposes, sem seeds produtivos. Indicadores usam metric_definition MONEY publicada, com unidade monetária igual à unidade da moeda catalogada. A 010 acrescenta exclusivamente SELECT/RLS para esses indicadores; nenhuma migration anterior é reescrita.
- CREATE→DRAFT; EDIT DRAFT→DRAFT; SUBMIT DRAFT→SUBMITTED; VERIFY SUBMITTED→VERIFIED; REJECT SUBMITTED→REJECTED; DISPUTE VERIFIED→DISPUTED; REVOKE VERIFIED/DISPUTED→REVOKED. VERIFY e REJECT exigem checker distinto dos autores materiais/submissor e autores documentais; VERIFY/REJECT/REVOKE exigem MFA recente, tal como READ/DISPUTE pelo contrato normativo de acesso sensível F5. Reason obrigatório em reject/dispute/revoke; read exige reason/purpose catalogados. Cada operação usa exclusivamente a sua própria permission, bundles de perfis vazios.
- EXPIRED é derivado em leitura/replay quando valid_until < clock_timestamp(), exclusivamente sobre VERIFIED/DISPUTED, sem alteração histórica/scheduler. O instante valid_until ainda é inclusivo. valid_from é registado explicitamente e não cria activation nem outro estado editorial.
- F11 usa função metadata fechada com tenant, AVAILABLE/CLEAN e vínculo FINANCIAL_FACT exato sob SHARE lock. Toda referência exige simultaneamente a permission financeira e DOCUMENT_READ do documento exato na autorização real. Não se concede SELECT às tabelas F11, nem conteúdo/storage locator/classificação; sem cópia ou reclassificação. Replay read recarrega a revisão originalmente auditada e reautoriza as suas referências; revogação documental impede devolvê-las, mesmo que o head corrente já não tenha documentos.
- Composição `profileFinancial` no root produtivo: sessão OIDC/handles F3, membership e F5 atuais, capabilities/preparação/fencing F4; mesma conexão em loader, autorização, CAS, F7, idempotência e commit. Coordinator Central existente protege também DOCUMENT_READ, conserva exclusão durável e reconcilia pela tabela financeira tenant. Nenhuma alteração à Central 009.
- Ordem de locks: preparação/nonce F4 → mutex organizacional F13-P1 → intenção financeira organization/operation/key → assertion head → documentos SHARE → guard Central → mutação/F7/resultado → fencing/permit/commit. Sem retry cego.
- Idempotência source-local por organization, FINANCIAL_operation, key e digest da intenção normalizada. Replay reautoriza F3/F5/F11, sem guardar valores/documentos na tabela idempotente. O resultado guardado contém apenas assertionId/revision/state; read devolve a revisão originalmente auditada, com EXPIRED derivado no instante de acesso. Uma revisão posterior requer nova key e novo F7. COMMIT incerto usa o recovery durável; duas confirmações perdidas falham publicamente sem expor guard e conservam uma única versão.
- F7 crítico nas sete mutações e na leitura restrita, na mesma transação. Digest auditável inclui apenas metadata de operação/versionamento, não montante/digest de baixa entropia financeira/documentId/conteúdo. F10 tem somente oito operation labels e resultClass fechada.

### Operações/resources F5

| Operação | Permission | Resource server-side |
|---|---|---|
| F13_FINANCIAL_CREATE | profile_financial.create | FINANCIAL_SCOPE, Organization atual |
| F13_FINANCIAL_EDIT | profile_financial.edit | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_READ | profile_financial.read | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_SUBMIT | profile_financial.submit | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_VERIFY | profile_financial.verify | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_REJECT | profile_financial.reject | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_DISPUTE | profile_financial.dispute | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_REVOKE | profile_financial.revoke | FINANCIAL_FACT, assertion exata |

### Pins e provas executadas

- Up: `ab3b92b001e90dbae4d38d42e1f61ed00ce2b94fb28797195e1324ac90ad1b93`.
- Down: `d97346b19c319c220459a62f01084dee7da78f48ed1a5d4da1b68355dcba093a`.
- Fingerprint: `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`.
- `cd backend; npm test`: **642/642 PASS**, zero skipped. Focados `node --test test/f13*.test.js test/f3*.test.js test/f4*.test.js test/f5*.test.js test/f7*.test.js test/productionCompositionParity.test.js`: **385/385 PASS**.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/financial-gate.ps1`: **PASS**, Central real + dois tenants PG17, catálogos inicialmente vazios/fixtures sintéticas explícitas, precisão/limites, períodos/indicadores incompatíveis, matriz de todas as transições válidas/inválidas, EXPIRED antes/depois e replay, CAS concorrente, replay simultâneo/conflito, A/B, oito grants assimétricos/resource errado, maker-checker/MFA ausente/stale, F11 ausente/revogado/outro tenant/quarentena, ausência de acesso documental implícito, oito falhas F7 com rollback integral, append-only/orphan head, COMMIT incerto e duas confirmações perdidas. Eventos realmente persistidos correspondem à assurance/policy F5 e à cardinalidade idempotente, sem valores/referências sensíveis.
- Runner canónico **009→010→009→010** com ledger/preflight/fingerprint; falha entre SQL e ledger reverte schema, reaplicação é idempotente; down recusa dados protegidos. Fingerprint 009 recuperado: `5a23e5b95300e9af471d90ac4e1212c5e88c11b3735fa88445e7b6aae010f1f1`. Captura SQL preliminar foi apenas cálculo de pin, não prova de runner.
- Gates `test/integration/f13/migration-gate.ps1`, `authoring-gate.ps1`, `competency-gate.ps1`, `test/integration/f13p1/migration-gate.ps1`, `test/integration/f12/migration-gate.ps1`: **PASS**. O gate F13 inclui Central/coordinator, 47 ACL drift cases, revogações/recovery/commit incerto e down tenant 007; F12 prova instalação vazia e upgrades 003/004/005/006→010, 11 versões, e F9 PostgreSQL **3/3 PASS**.
- `node --check`: **101 ficheiros JS dirty/untracked PASS**; `git diff --check` PASS. Scans de credenciais/tokens/connection strings, emails, IBAN e NIF/telefone explicitamente atribuídos no conjunto dirty/untracked: sem findings reais (fixtures example.invalid/com/test excluídas explicitamente). Migrations anteriores e .vscode preservadas por SHA256; índice vazio. Recursos Docker de execução eliminados exclusivamente pelos finally dos respetivos gates, sem limpar recursos preexistentes.

### Critérios e limitações

Evidência restrita para **AC-16** e contratos transversais AC-01/02/04/05/11/12/21/22/26/27/28/29/30/31/32. **Nenhum AC promovido:** AC-13/15 PARTIAL, AC-14/16 PENDING e restantes estados inalterados. Os testes usam diretório/provider físicos sintéticos, fixtures de sessão e grants explícitos com persistência Central real; não provam integração IdP externo, rollout/SLO produtivo ou conteúdo editorial aprovado.

Catálogos produtivos de moedas, indicadores monetários, métodos/reasons/purposes e respetivas políticas continuam pendentes de aprovação editorial; runtime vazio falha fechado. Sem APIs administrativas/catalog authoring, intervalos/bandas/derivações, outros domínios, aprovação/publicação do perfil, snapshots/activation, frontend ou matching. Fatia 6 pronta para **nova revisão formal read-only**, não declarada fechada.

## Fatia 6 — correções F13-S6-R1 e evidência de implementação (2026-10-11)

A revisão formal anterior encontrou três findings MEDIUM de correção/auditoria; o fecho não foi autorizado. As correções abaixo foram implementadas e verificadas. Segue-se revisão read-only sobre snapshot congelado; esta secção não antecipa o seu veredicto nem regista fecho automático.

- **F13-S6-R1-001:** DATE é carregado/devolvido como texto civil na query de revisão e no RETURNING, sem conversão local→UTC. Prova PostgreSQL pela composição real em UTC e Europe/Lisbon, inverno/verão, create/edit/read/replay: datas exatas preservadas.
- **F13-S6-R1-002:** F7 financeiro regista reasonRef/reasonReleaseRef/reasonCatalogVersion e, em leitura, purposeRef/purposeReleaseRef/purposeCatalogVersion, obtidos server-side dos catálogos publicados. Allowlist exclusiva dos eventos financeiros; UUIDs e versões validados, sem textos editoriais, montantes, documentId, metadados F11 ou valores financeiros. Prova sobre eventos efetivamente persistidos de read/reject/dispute/revoke; catálogos de kind errado e intenção divergente recusados. Nenhum evento histórico foi reescrito.
- **F13-S6-R1-003:** loader de replay READ resolve a revisão do registo idempotente organization/operation/key, confirma a assertion e carrega os documentos dessa revisão antes do guard/F5. Digest da intenção continua validado; replay devolve conteúdo originalmente auditado, não o head corrente. F3/F5/F11 atuais continuam obrigatórios; revogação DOCUMENT_READ impede replay histórico mesmo quando o head já não tem documentos. EXPIRED permanece derivado à hora do acesso. Nova key lê o head com novo evento. Uma e duas confirmações de COMMIT perdidas, reconciliação e retry preservam um único F7/resultado.

### Validação desta correção

- `cd backend; npm test`: **644/644 PASS**, zero skipped.
- `node --test test/f13*.test.js test/f3*.test.js test/f4*.test.js test/f5*.test.js test/f7*.test.js test/productionCompositionParity.test.js` em backend: **387/387 PASS**.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/financial-gate.ps1`: **PASS**, Central + dois tenants PG17, novas regressões descritas acima e matriz financeira completa, F11/F7 fail-closed, CAS/concorrência/append-only, sem dados financeiros no F7/F10, down protegido e runner **009→010→009→010**.
- Gates `test/integration/f13/migration-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS** nesta execução. F13/Central prova 47 drifts ACL, revogações/recovery/COMMIT incerto e taxonomia; F12 prova instalação vazia e prefixes suportados→010. F9 PostgreSQL **3/3 PASS**.
- `node --check`: **101 JS PASS**; `git diff --check` e whitespace dos ficheiros de código/teste desta correção PASS. Scans de 119 ficheiros dirty/untracked: 13 ocorrências revistas são URLs dinâmicos descartáveis ou canários sintéticos já existentes; nenhuma credencial/PII real identificada nos padrões usados. Scans não constituem garantia universal.
- Apenas nove ficheiros de código/teste/documentação alterados nesta correção; SHA256 preserva os restantes ficheiros do snapshot inicial, incluindo todas as migrations e .vscode. Nenhuma migration, conteúdo editorial produtivo, funcionalidade fora da fatia, stage ou commit acrescentado.

Pins tenant 010 **inalterados**: up `ab3b92b001e90dbae4d38d42e1f61ed00ce2b94fb28797195e1324ac90ad1b93`; down `d97346b19c319c220459a62f01084dee7da78f48ed1a5d4da1b68355dcba093a`; fingerprint `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`. Nenhum AC promovido: **F13 In Progress; AC-13/AC-15 PARTIAL; AC-14/AC-16 PENDING**. Mantêm-se catálogos editoriais pendentes, fixtures sintéticas de IdP/diretório/provider e ausência de rollout/SLO produtivo; lifecycle/activation/frontend/matching fora. Fecho restrito exige decisão humana após revisão sem findings materiais.

## Fecho formal restrito da fatia 6 — capacidade financeira (2026-10-11)

Por aprovação humana explícita, a **fatia 6 da F13 — capacidade financeira ORG-only está formalmente fechada no âmbito restrito entregue**, após correções e repetição da revisão formal read-only **sem findings bloqueadores**. Este registo substitui as declarações históricas de revisão/fecho pendentes acima; não fecha a F13 integral, não promove critérios nem autoriza outra fatia.

**F13-S6-R1-001, R1-002 e R1-003 corrigidos e revalidados:**

- **R1-001:** datas PostgreSQL DATE preservadas como texto civil, sem conversão local→UTC. Create/edit/read/replay comprovados em UTC e Europe/Lisbon, inverno/verão.
- **R1-002:** F7 financeiro com referências e versionamento de reason/purpose obtidos server-side dos catálogos publicados: reasonRef/reasonReleaseRef/reasonCatalogVersion e, em leitura, purposeRef/purposeReleaseRef/purposeCatalogVersion. Eventos reais persistidos confirmados, sem valores financeiros, conteúdo ou identificadores/metadados documentais; nenhuma reescrita do histórico.
- **R1-003:** replay ligado à revisão originalmente auditada, com nova autorização F3/F5/F11 e DOCUMENT_READ exato sobre as referências dessa revisão. Revogação documental impede replay mesmo quando o head corrente já não tem documentos. Nova revisão exige nova key/leitura auditada. **EXPIRED é derivado no acesso**, sem persistência/scheduler; replay mantém o conteúdo original e reavalia a validade.

### Evidência final já executada

- Backend **644/644 PASS**; focados F13/F3/F4/F5/F7/composição **387/387 PASS**; financeiro/F7 durante a revisão read-only **28/28 PASS**.
- Gates financeiro, F13/Central, F13-P1 e F12 **PASS**; F9 PostgreSQL **3/3 PASS**. Runner canónico **009→010→009→010 PASS**, com ledger/preflight/fingerprint, rollback SQL→ledger e down conservador.
- Reprodução independente pela composição real, Central + dois tenants PostgreSQL 17, Europe/Lisbon: período **2025-07-01–2025-07-31** preservado; leitura e replay da revisão **1**, apesar de avanço do head; **um único F7** referente à revisão 1, com reason/purpose versionados persistidos.
- `node --check` **101 ficheiros PASS**; `git diff --check`/whitespace PASS; scans sem credenciais/PII reais identificadas nos padrões usados, com ocorrências dinâmicas/sintéticas revistas. Snapshot de **119 ficheiros inalterado durante a revisão read-only**; apenas recursos Docker próprios removidos.

Estes resultados pertencem à implementação/revisão anterior; esta ação documental não constitui nova execução desses testes ou gates. Apenas `git diff --check` é executado para validar este registo.

### Pins atuais da tenant 010 — inalterados

- Migration: `010_f13_financial_capacity`.
- Up: `ab3b92b001e90dbae4d38d42e1f61ed00ce2b94fb28797195e1324ac90ad1b93`.
- Down: `d97346b19c319c220459a62f01084dee7da78f48ed1a5d4da1b68355dcba093a`.
- Fingerprint: `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`.

**F13 In Progress; AC-13/AC-15 PARTIAL; AC-14/AC-16 PENDING; restantes critérios e estados inalterados.** Catálogos editoriais produtivos, integração com IdP externo e rollout produtivo permanecem pendentes. Lifecycle do perfil, aprovação/publicação, snapshots/activation, frontend e matching continuam fora do âmbito fechado. Não se inicia outra fatia, não se altera código/migrations/manifests/pins/critérios e não se cria commit/stage. Feature integral não arquivada nem marcada Complete.
