# F13 — Versionamento, aprovação, publicação e ativação

**Estado:** Investigação; recomendação sujeita a aprovação humana
**Decisão:** Como criar, rever, aprovar, publicar, ativar, substituir e arquivar versões do perfil, overlays e snapshots efetivos com maker-checker, CAS, idempotência e reprodução histórica?

## Âmbito e limites

Inclui drafts/revisões, aprovação, publicação, ativação, perfil-base, overlays, snapshots efetivos, ponteiros ativos, concorrência, idempotência, supersession, rollback lógico, archive e os contratos F5/F7/F9/F10. Exclui conteúdo taxonómico, scoring, matching, F15, candidaturas, UI e rollout produtivo.

## Factos estabelecidos pelo repositório

### Padrões já aprovados e comprovados

- A decisão de âmbito F13 exige perfil-base organizacional versionado, overlays opcionais ligados a uma versão-base exata, ativação controlada e snapshot efetivo imutável. Alterar a baseline não rebasa nem reescreve overlays/snapshots.
- A política epistemológica aprovada separa lifecycle editorial `DRAFT → APPROVED → PUBLISHED → SUPERSEDED → ARCHIVED` de knowledge, verification e conflito; correções criam versões.
- F12 usa revisões de conteúdo imutáveis, `rowVersion`/CAS, idempotency digest interno e archive/restore lógico sem reescrever história.
- O writer F4.4 cria candidatas idempotentes, valida payload divergente, publica versão e fence por CAS e troca versão corrente atomicamente; versões anteriores drenam sem regressão de estado.
- F7 prova eventos críticos source-local na mesma transação e eventos append-only/tamper-evident. Falha crítica aborta o efeito.
- F9 fornece outbox/inbox, retry, redelivery, replay autorizado, fencing e reconciliação para efeitos realmente assíncronos; não obriga todos os lifecycles a usar jobs.
- F5 exige autorização server-side, SoD/maker-checker quando aplicável, recurso/estado recarregado e assurance/MFA para ações sensíveis catalogadas.
- F10 admite spans/logs/métricas sanitizados com labels fechadas e sem IDs de tenant, perfil, versão ou ator.

### Distinções necessárias

- **Revision:** contador de optimistic locking do agregado editável/ponteiro; muda em cada mutação aceite e não identifica conteúdo publicado.
- **Draft revision:** registo imutável de uma edição aceite dentro do draft lógico.
- **Profile version:** conteúdo imutável criado a partir de uma revisão de draft aprovada, com digest e versões de schema/policies.
- **Published release:** profile version disponível para ativação, mas não necessariamente ativa.
- **Active pointer:** referência corrente por scope, alterada apenas por comando de ativação com CAS.
- **Effective snapshot:** composição imutável e completa da baseline e overlay opcional, pronta ou não para consumo.
- **Schema/policy version:** versão dos contratos usados para validar/materializar; não é profile version nem revision.

## Opções viáveis

| Opção | Reprodução/auditoria | Concorrência e maker-checker | Overlays/rollback | Consumo F14 | Custo |
|---|---|---|---|---|---|
| A. Configuração mutável com uma versão ativa | Fraca; histórico depende de cópias laterais | CAS possível, aprovação vulnerável a TOCTOU | Reposição/recomposição ambígua | Pode ler estado mutável | Baixo inicialmente, alto em incidentes |
| B. Event sourcing integral | Excelente se todos os reducers/versionamentos forem preservados | Forte, mas amplia superfície de replay/evolução | Flexível, reconstrução complexa | Exige projeções e manutenção contínua | Alto e desproporcional à F13 |
| C. Versões imutáveis publicadas, ponteiros ativos e snapshots materializados | Forte e simples de verificar | CAS, idempotência e maker-checker explícitos | Troca de ponteiro e nova ativação auditada | Apenas snapshots `READY` | Moderado e alinhado com F4/F12 |

## Recomendação

Recomenda-se a **Opção C**. O conteúdo editável vive num draft lógico com revisões imutáveis; aprovação congela uma revisão e cria uma profile version imutável; publicação torna essa versão elegível; ativação materializa e valida o snapshot antes de trocar atomicamente o ponteiro corrente.

### 1. Drafts, revisions e versions

- Um `ProfileDraft` é logicamente editável, mas cada comando aceite grava uma `DraftRevision` imutável e incrementa `revision` por CAS.
- Edição exige `expected_revision`; concorrência stale falha sem merge silencioso.
- O mesmo idempotency key e intent digest devolvem a revisão já criada; reutilização com payload diferente conflita.
- Submeter/aprovar referencia uma revisão exata e o seu `content_digest`. Edições posteriores pertencem a novo draft/revisão e não alteram a aprovação.
- A transição para `APPROVED` cria a `ProfileVersion` imutável com conteúdo canónico, scope, baseline referenciada, schema/catalog/policy versions, provenance e digests.

### 2. Aprovação e publicação

- `APPROVED` e `PUBLISHED` são estados distintos. Aprovação atesta conteúdo e completude sob policies fixadas; publicação torna a versão elegível para ativação.
- Uma versão publicada pode permanecer inativa indefinidamente e pode existir mais de uma publicada por scope.
- Editor/autor não aprova a própria revisão. Aprovação conserva principal, membership/revocation version, policy version, assurance exigida, digest e timestamp.
- Publicação recarrega versão, aprovação, membership, scope, schema/capabilities e digest para impedir stale approval ou TOCTOU.
- Conteúdo, baseline, schema/policy references e digests não mudam depois de `APPROVED`; qualquer correção cria novo draft/version.

### 3. Ativação síncrona e atómica na v1

- Ativação v1 é imediata e síncrona numa transação tenant-local.
- A transação bloqueia/valida o ponteiro do scope, a profile version publicada e a baseline exata; reavalia autorização, approval, completeness, digests e compatibilidade.
- O snapshot efetivo é materializado como imutável e fica `READY` antes da troca do ponteiro dentro da mesma transação.
- A mesma transação cria um activation record append-only, termina logicamente o record anterior, troca o active pointer por CAS e aceita o evento crítico F7.
- Se qualquer passo falhar, nem snapshot, activation record, ponteiro nem evento parcial persistem.
- A F14 consome somente `effective_profile_snapshot_id`, digests e versões de snapshots `READY`; nunca lê ou recompõe ponteiros/drafts dinamicamente.

### 4. Cardinalidade e scopes

- Existe exatamente uma baseline organizacional ativa por tenant quando a organização está disponível à F14.
- Existe no máximo um active pointer por scope key aprovado. Uma unidade sem overlay ativo consome a baseline organizacional conforme a composição explícita do servidor.
- Perfil-base e overlay têm lifecycles/versionamento independentes, mas um snapshot de overlay referencia a baseline exata usada.
- Um overlay só pode ser ativado quando a baseline referenciada é a baseline organizacional ativa na transação de ativação.
- Ativar nova baseline não rebasa nem reescreve overlays/snapshots. Overlays ativos baseados na baseline anterior ficam marcados como necessitando revisão para nova composição; a política humana ainda deve decidir se o ponteiro antigo permanece temporariamente consumível ou é retirado atomicamente.
- Rebase é sempre explícito: novo draft/version do overlay referencia a nova baseline, passa novamente por approval/publication e cria novo snapshot.

### 5. State machine proposta

```text
Draft lógico
  DRAFT(revision n) --edit/CAS--> DRAFT(revision n+1)
  DRAFT(revision n) --approve exact digest + maker-checker--> APPROVED(version immutable)

ProfileVersion
  APPROVED --publish/revalidate--> PUBLISHED
  PUBLISHED --activate command--> [EffectiveSnapshot READY + ActivePointer swap]
  PUBLISHED --successor activated--> SUPERSEDED
  SUPERSEDED --archive when not active/referenced as current--> ARCHIVED
  APPROVED|PUBLISHED --archive if never active and policy permits--> ARCHIVED

Activation records (append-only)
  ACTIVATED -> REPLACED | ROLLED_BACK | DEACTIVATED(where allowed)
```

Estados terminais de uma versão são `ARCHIVED`; `SUPERSEDED` não regressa a `PUBLISHED`. Um rollback não reabre a versão nem apaga a ativação posterior: cria novo activation record.

### 6. Rollback lógico e archive

- Rollback é uma nova ativação autorizada e auditada para uma profile version/snapshot anterior ainda íntegra e compatível.
- Pode reutilizar um snapshot imutável anterior apenas se schema/policy/capabilities e projeção exigida continuarem aceites; caso contrário materializa novo snapshot a partir da versão histórica sem a alterar.
- O active pointer troca atomicamente; nunca é limpo antes de o alvo estar `READY`.
- Archive é lógico, proibido para versão ou snapshot atualmente apontado e nunca elimina activation records, approvals, snapshots, provenance ou F7.
- Restore de conteúdo arquivado não muta a versão: cria novo draft/version ou uma nova ativação apenas quando o contrato de compatibilidade a permitir.

### 7. Concorrência e idempotência

- CAS protege draft revision e active pointer revision; locks seguem ordem canónica tenant → baseline → scope → version → pointer.
- A intenção do comando inclui tenant, scope, operação, target version, baseline version, expected pointer revision, schema/policy versions e content digest.
- Idempotency key é scoped por autoridade/operação/recurso. Mesmo key + mesmo intent converge para o resultado persistido; digest divergente falha fechado.
- Duas ativações concorrentes não podem produzir dois ponteiros ativos: uma vence o CAS e a outra reconcilia como retry idempotente ou conflito.
- Commit incerto é reconciliado por activation record/idempotency digest e estado persistido, nunca repetindo cegamente o efeito.

### 8. Segurança, auditoria e observabilidade

- Aprovação exige maker-checker. Publicação, ativação, rollback e archive exigem grants F5 distintos; a matriz futura decide separações adicionais entre approver, publisher e activator.
- Ativação/rollback são ações sensíveis candidatas a assurance recente/MFA; a categoria exata pertence à investigação seguinte de papéis/grants.
- Reautorização ocorre imediatamente antes do efeito e rejeita membership/grant/assurance/approval revogados ou versões divergentes.
- F7 crítico-before-effect cobre approval, publication, activation, rollback e archive; draft edits preservam autoria/histórico e evento adequado sem conteúdo sensível.
- Outbox F9 só é necessário para consequências pós-commit ou trabalho futuro não atómico; não substitui a transação de ativação.
- F10 usa spans como `profile.validate`, `profile.publish`, `profile.activate` e `profile.snapshot.materialize`, com resultado/reason code fechado e sem tenant/scope/version/digest como labels.

## Invariantes propostos

1. Uma profile version publicada é imutável e vinculada ao seu content digest.
2. Existe no máximo um active pointer por tenant/scope key.
3. Existe uma baseline organizacional ativa antes de disponibilizar qualquer snapshot F13 à F14.
4. Overlay ativo referencia uma baseline exata; não há recomposição implícita.
5. Snapshot efetivo é imutável e só se torna alvo do ponteiro quando `READY`.
6. Activation record é append-only e liga ponteiro anterior, novo snapshot, comando, ator e digests.
7. CAS e idempotency digest são obrigatórios em edit/publish/activate/rollback/archive.
8. Autor não aprova a própria revisão; nenhuma aprovação sobrevive a mudança do conteúdo/digest.
9. F14 nunca consome draft, version isolada, ponteiro sem snapshot `READY` ou composição dinâmica.
10. Não existe delete físico; supersession, archive e rollback preservam história.
11. Rollback é nova ativação auditada, não reversão de rows/eventos.
12. Schema/policy upgrades não reescrevem versões/snapshots anteriores; compatibilidade de consumo é explícita.

## Scheduling

### Alternativas

- **Apenas ativação imediata:** menor estado intermediário, transação clara e nenhuma dependência de worker.
- **`effective_at` futuro com F9:** exige relógio autoritativo, job idempotente, reautorização, cancelamento, indisponibilidade do worker, conflito com novas versões e reconciliação.
- **Preparação antecipada + promoção manual:** permite aprovar/publicar antes, mantendo o momento do efeito explícito e humano.

### Recomendação v1

Não incluir scheduling automático na v1. Usar preparação antecipada (`APPROVED`/`PUBLISHED`) e ativação manual imediata. Não existe necessidade interna demonstrada que justifique o estado e os jobs adicionais.

Se scheduling for aprovado futuramente, o job F9 deve reautorizar e revalidar tudo no instante do efeito; o active pointer só muda depois de snapshot `READY`, e atraso do worker nunca antecipa nem simula ativação. Timezone de apresentação não substitui timestamps UTC autoritativos.

## Questões obrigatórias — respostas resumidas

- **Draft mutável?** Logicamente sim; cada edição aceite gera revisão imutável e CAS.
- **Revision versus version?** Revision controla concorrência editorial; version identifica conteúdo imutável aprovado.
- **Quando nasce a versão?** Na aprovação de revisão/digest exatos.
- **Approved versus Published?** Distintos; published significa elegível para ativação.
- **Publicar e ativar juntos?** Não na v1 recomendada; comandos e grants distintos. A ativação em si materializa snapshot e troca ponteiro atomicamente.
- **Publicada e inativa?** Sim.
- **Quantas ativas?** Uma baseline por tenant e no máximo um ponteiro por scope key.
- **Base/overlay separados?** Sim, mas snapshot do overlay fixa a baseline exata.
- **Overlay com baseline antiga?** Não pode ser novamente ativado; o tratamento do ponteiro já ativo requer decisão humana explícita.
- **Rebase?** Novo draft/version e nova aprovação/publicação/ativação.
- **Snapshot sync ou job?** Síncrono na v1; F9 apenas se custo futuro justificar desenho assíncrono explícito.
- **Gap?** Pointer antigo permanece até o novo snapshot `READY` e o swap atómico.
- **Scheduling?** Fora da v1; publicação antecipada e ativação manual.
- **Concorrência?** Locks ordenados + CAS + idempotency digest.
- **Rollback?** Nova ativação auditada; reutiliza snapshot apenas se ainda compatível.
- **Archive?** Lógico, sem apagar referências/história e nunca sobre o alvo ativo.
- **Terminais?** `ARCHIVED`; activation records são append-only.
- **Maker-checker/MFA?** Maker-checker na aprovação; ativação/rollback candidatas a MFA recente, com detalhe pendente F5.
- **Jobs F9?** Nenhum no caminho crítico síncrono v1; apenas consequências pós-commit/reconciliação permitidas.
- **Schema/policy upgrades?** Preservam snapshots; versões antigas continuam reproduzíveis e só são consumíveis conforme matriz explícita de compatibilidade.

## Riscos e decisões humanas restantes

1. Aprovar a Opção C e o momento exato em que nasce a profile version.
2. Decidir o tratamento de overlays ativos quando uma nova baseline é ativada: continuidade temporária explícita ou retirada/batch atómico.
3. Fechar state/reason codes, regras de archive e compatibilidade para reutilização de snapshots em rollback.
4. Aprovar se publisher e activator podem ser a mesma pessoa e quais ações exigem MFA recente.
5. Definir grants F5, SoD, approval freshness e revocation versions concretos.
6. Fechar os eventos F7, payloads, classes e transações por comando.
7. Definir schema/profile/completion compatibility N/N-1 e política para versões antigas.
8. Confirmar se o custo de materialização síncrona cabe nos limites locais antes da implementação; caso contrário investigar estado assíncrono separado.
9. Definir retenção/archive/legal hold e projeções de consulta histórica.
10. Manter scheduling fora da v1 ou aprovar futuramente um contrato F9 específico.

## Implicações para F13 e F14

- **F13-AC-04, AC-06 e AC-09:** drafts revisionados originam versões e snapshots imutáveis sem perder história.
- **F13-AC-07 e AC-08:** ativação controlada e ponteiros CAS garantem cardinalidade por scope.
- **F13-AC-10 e AC-11:** concorrência, idempotência e commit incerto dependem de revision, locks, intent digest e activation records.
- **F13-AC-12, AC-21 e AC-22:** aprovação/ativação preservam autoria, F5, maker-checker e F7 crítico.
- **F13-AC-23 e AC-24:** F9 fica fora do caminho crítico v1; F10 observa operações com códigos sanitizados.
- **F13-AC-29:** rollback transacional e retry convergem pelo estado persistido.
- **F13-AC-32:** F14 recebe apenas snapshot `READY`, versões e digests inequívocos, nunca estado recomposto.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f43-tenant-schema-compatibility.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f12-opportunity-catalog.md`
- `backend/src/opportunities/tenantRepository.js`
- `backend/src/opportunities/repositorySupport.js`
- `backend/src/security/tenantWorkloadDirectoryRepository.js`
- `backend/src/audit/postgresAppendRepository.js`

Não foram necessárias fontes externas: os padrões internos aprovados e comprovados resolvem a comparação arquitetural desta investigação.

Next step: aprovar ou corrigir a recomendação de versionamento e ativação antes de investigar papéis, grants e segregação de funções.
