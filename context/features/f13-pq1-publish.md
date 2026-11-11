# F13-PQ1-PUBLISH — publicação multidomínio inativa

Estado: **Complete — fecho humano restrito**. Decisão humana explícita, condicionada à conferência da evidência acumulada; condição verificada antes desta atualização documental. F13 integral permanece **In Progress**.

## Fecho humano restrito e cobertura acumulada

Fechado apenas F13-PQ1-PUBLISH: criar/editar competências → associar experiências/evidências → verificar quando aplicável → submeter → aprovar → publicar multidomínio → consultar. Publicação **imutável e inativa**. Conhecimento declarado, verificação factual e completude mantêm-se distintos; publicação não exige verificação universal e não determina elegibilidade. Snapshot READY, materialização, ponteiro ativo, ativação e avaliação F14 não foram entregues nem iniciados por este fecho.

Finding médio de confirmação desfasada: **resolvido**. Qualquer alteração relevante dos campos/coleções do painel invalida a confirmação pendente e exige nova confirmação explícita. A revisão read-only posterior emitiu PASS/GO para decisão humana; esta decisão humana aprova agora o fecho condicionado à cobertura do contrato, conferida abaixo.

Evidência acumulada: [implementação, provas integradas e limitações](../reviews/f13-pq1-publish/README.md), [matriz PUB-01–15](../reviews/f13-pq1-publish/acceptance-matrix.md), [correção e revisão do finding](../reviews/f13-pq1-confirmation/README.md), [validação da correção](../reviews/f13-pq1-confirmation/validation.json). Estes artefactos são históricos e não foram alterados; as suas menções a Review/ausência de fecho descrevem o momento em que foram produzidos. O parecer final PASS/GO e a aprovação humana encontram-se na conversa desta tarefa; este parágrafo regista-os sem inventar um relatório histórico adicional.

Conferência anterior ao fecho:

- Snapshot original de 652 ficheiros reconciliado com o delta documentado: 648 inalterados, dois componentes UI corrigidos e dois documentos ativos atualizados. Hashes atuais da correção e dos artefactos complementares coincidentes; os 22 artefactos originais, HEAD e índice também coincidentes. Os documentos deste fecho são posteriores aos snapshots testados.
- Provas integradas anteriores: browser completo maker/checker com MFA, competências/experiências/evidências, submissão/aprovação/publicação inativa/leitura, troca A/B e recuperação; HTTP/PostgreSQL descartável com autorização, F11, segregação, imutabilidade histórica, CAS, concorrência, F7 e commit incerto; migrations/admissão e gate cumulativo F12/F9. Backend 799/799 e frontend inicial 48/48 são resultados anteriores, não reexecuções neste fecho.
- Correção: **14 regressões novas incluídas nos 62 testes frontend PASS**, e build PASS. Componentes React reais com API simulada: ausência de envio depois da alteração e payload atualizado apenas após nova confirmação. Não constituem prova PostgreSQL nem browser integral da correção; esses gates não foram reexecutados.
- PUB-01–15 têm suporte na matriz e no suplemento da correção. Cobertura composta não significa todas as variantes executadas ponta a ponta: KNOWN não verificado é comprovado no extrator/completion real e ligado por inspeção ao mesmo repository/lifecycle exercitado; MFA/segregação e certas revogações reutilizam mecanismos reais partilhados. Não se detetou um critério obrigatório sem suporte que impedisse este fecho restrito.

Limitações mantidas: **503 não prova falha definitiva**; intenções podem permanecer **UNKNOWN**, com bloqueio por recurso/dependência, encaminhamento para suporte e **sem garantia de resolução automática**. Certas combinações de revogação de sessão/membership, expiração MFA e falha F7 assentam em mecanismos partilhados efetivamente exercitados e inspeção, sem execução PQ1 específica de todas as combinações. O browser integral anterior não foi repetido após os deltas delimitados e testados em componentes/HTTP/admissão. Sem validação de staging, produção, IdP externo, dados/conteúdo institucionais reais, SLO ou acessibilidade integral. Catálogos e métodos produtivos continuam a exigir conteúdo governado. O fecho não é autorização de rollout.

**Próxima etapa proposta, não iniciada:** concretizar a materialização e ativação estritamente necessárias ao consumidor F14-PQ1, com tuple, cobertura, admissibilidade e consumo integrados. Nenhuma implementação dessa etapa é autorizada por este registo.

### Histórico preservado — estado anterior ao fecho

Estado: **Review — READY_FOR_HUMAN_REVIEW**. Contrato técnico fechado em 2026-10-16 por instrução humana, após aprovação das escolhas novas D1–D7 de [F14-PQ1](f14-first-partial-prequalification.md). Ready não significa implementado, validado ou Complete. Implementação efetuada em tarefa própria por instrução humana; evidência e limites na [revisão local](../reviews/f13-pq1-publish/README.md) e [matriz PUB-01–15](../reviews/f13-pq1-publish/acceptance-matrix.md). Finding posterior de confirmação desfasada corrigido; [regressão e evidência complementar](../reviews/f13-pq1-confirmation/README.md). Sem fecho humano; F13 integral permanece In Progress.

## 1. Âmbito e invariantes

Percurso entregue: criar/editar competência → associar experiência/evidência → verificar quando aplicável → submeter → aprovar → publicar → consultar. Organização, baseline sem overlays; publicação imutável **inativa**. Reutilizar o authoring misto e os mecanismos editoriais existentes, sem alterar a semântica do [recorte temático fechado](f13-editorial-baseline-publication.md) ou da [interface editorial fechada](f13-minimal-editorial-interface.md).

Não inclui materialização efetiva, READY, ponteiro ativo, ativação, avaliadores F14, decisões humanas sobre avaliações, score, candidaturas, comunicação externa, gestão documental nova, editor de catálogos genérico, declarações negativas ou migração automática de dados históricos. Competências não precisam de estar todas verificadas para publicar. Documento F11 só é exigido pelo método admitido; experiência ligada continua necessária para verificar, como no serviço atual.

Aplicam-se, sem nova aprovação, as decisões de [competências](../decisions/f13-competencies-and-experience.md), [completude](../decisions/f13-completion-policy.md), [compatibilidade](../decisions/f13-schema-policy-compatibility.md), [lifecycle](../decisions/f13-versioning-and-activation.md) e [autorização/segregação](../decisions/f13-authorization-and-segregation.md). Confirmação dos critérios da oportunidade continua editorial e fora deste incremento.

## 2. Catálogos, métodos e referências autorizadas

| Dado | Mecanismo existente inspecionado | Contrato de integração mínimo |
| --- | --- | --- |
| Temas/prioridades | `concept`, `scheme`, `catalog_release`, labels e serviço taxonómico; UI editorial já lê os dois domínios | Reutilizar leitura PUBLISHED, release exata, sem conceito deprecated, global ou tenant atual; seleção por ID, não por texto. |
| Competências/níveis | `competency_catalog_release/entry`; kinds COMPETENCY_CONCEPT e FRAMEWORK_LEVEL | Leitura fechada por kind/release e ownership. Nível é opcional, do mesmo framework/versão/release, sem comparação nem threshold novo. |
| Tipos de experiência | Mesmo catálogo, EXPERIENCE_TYPE | Seleção autorizada; nenhum tipo criado inline. Período observado é declarado e preservado, não se torna requisito temporal da oportunidade. |
| Métodos | Mesmo catálogo, VERIFICATION_METHOD, `max_validity_seconds` | Preservar verificação e limites existentes. Acrescentar descriptor imutável de método no bundle, ligado a methodId/release exatos, com `documentRequired` explícito. Ausência do descriptor impede verificar pelo novo percurso, sem default. |
| Proveniência | `experience_evidence_version.provenance_ref` é UUID obrigatório, sem entidade resolvida/FK própria no recorte 009 | Criar registo mínimo append-only de proveniência da declaração manual, na transação da experiência: tenant, scope, experienceVersionId, sujeito/membership, recordedAt servidor, sourceType ORGANIZATION_MANUAL. Não é evidência de veracidade nem fonte institucional certificada. |
| Documento | F11 e `load_competency_reference`; estado AVAILABLE/CLEAN, binding EXPERIENCE_EVIDENCE e DOCUMENT_READ | Selecionar apenas referências F11 autorizadas já vinculadas à experiência exata; revalidar ao ligar/verificar e consumir. Não implementar upload, binding ou pesquisa documental genérica neste incremento. |

O caller não fornece tenant, actor, digests, proveniência arbitrária ou policies. Ao criar/alterar uma experiência pela UI, o servidor gera o provenanceRef e registo correspondente; a projeção mostra «declaração manual», instante e autoria autorizada. Material antigo com UUID não resolvido permanece preservado e consultável segundo o contrato antigo, mas não é promovido automaticamente ao novo bundle: exige nova versão com proveniência explícita. Sem backfill inventado.

**Identidade com os critérios F14:** estes usam `concept/scheme/catalog_release`, enquanto assertions usam `competency_catalog_entry`. Não existe equivalência automática entre os catálogos. O novo release admite competências apenas quando a configuração governada regista a mesma identidade: `entry_id = concept_id` e `competency release_id = catalog release_id`, com schemeId UUID explicitamente fixado e schemeCode COMPETENCY e ambos os registos publicados/pertencentes ao mesmo owner. O manifesto de admissão verifica a correspondência e os digests internos das duas representações; não cria um mapping entre conceitos distintos. Catálogos existentes sem esta identidade não são reescritos: ficam fora do novo bundle até publicação governada de referências compatíveis. Labels/stable_code não provam equivalência.

Leituras de seleção passam pelo servidor com membership, PROFILE_READ, autorização taxonómica quando aplicável e filtros de organização; documentos exigem adicionalmente DOCUMENT_READ. Retornar IDs, releaseVersion, labels autorizadas e requisitos do método, sem digests nem dados de outro tenant. Labels de métodos/tipos podem usar stable_code quando não existir label governada; não fabricar significado. Paginação limitada a 100, default 20, cursor opaco vinculado ao sujeito, tenant, filtro e release. Escritas revalidam as referências; listar não concede autorização futura.

**Fixtures versus utilização real:** reutilizar as fixtures sintéticas do gate de competências, incluindo o limite de validade já definido nelas, sem o promover a política institucional. Acrescentar fixtures versionadas/admitidas para identidade exata, método com/sem documento e método que permite ausência de expiração; os valores temporais servem exclusivamente ao corpus de teste. Não criar durações produtivas por inferência. Desenvolvimento exige bundle técnico, IDs estáveis de fixture, políticas, grants, descriptor e assinaturas/configuração de tokens. Utilização real exige releases, conceitos, tipos, métodos, regras documentais e limites de validade aprovados pela autoridade de conteúdo, além de evidências reais autorizadas. Sem configuração admitida, falhar fechado; nenhum seed institucional automático.

## 3. Schema, extrator e publication policy

Identidades técnicas deste incremento, a instalar aditivamente:

| Elemento | Identificador / versão |
| --- | --- |
| Profile publication schema | F13_ORG_PQ1_PUBLICATION / 1.0.0 |
| Wire schema | F13_PQ1_PUBLICATION_V1 |
| Extrator | F13_PQ1_MULTIDOMAIN_V1 |
| Completion policy | F13_PQ1_PUBLICATION_COMPLETION_V1 |
| Verification descriptor policy | F13_PQ1_VERIFICATION_DESCRIPTOR_V1 |
| Projection policy / consumidor | F13_PQ1_PUBLICATION_READ_V1 |
| Release bundle | F13_PQ1_PUBLISH_BUNDLE_V1 |

O tuple inclui schemas, extrator, completion/verification/projection policies, reasons/purposes e releases admitidos. Validação exata; sem aceitar produto cartesiano de versões, fallback temático ou promoção para F14. `coverage={scopeType:ORGANIZATION, includedDomains:[THEMATIC_AREA,STRATEGIC_PRIORITY,COMPETENCY,EXPERIENCE], constraintsAssessed:false, effectiveSnapshot:false, f14Consumable:false}`; ligações e verificações são suporte explícito, não domínios implícitos de elegibilidade.

Conteúdo canónico publicado:

- Origem: draftId, revisão submetida exata, profileScopeId, producerContract, schema/bundle/policies/releases; digest original reproduzível apenas no servidor.
- Temas e prioridades: versões dos itens, knowledgeStatus, conceptRef completo e proveniência editorial, preservando estados/classificação/conflicto existentes.
- Competências: assertionId/versionId, knowledgeStatus, conceptRef exato ou null em UNKNOWN, nível opcional e autoria/proveniência. KNOWN não significa VERIFIED.
- Experiências: experienceId/versionId, typeId/release, observedFrom/observedUntil, provenanceRef resolvido e estado declarado. Sem conversão de duração em score.
- Ligações: link/version ID, assertionVersionId, experienceVersionId e documentVersionId opcional, todos tenant/scope-local e coerentes com os membros da revisão.
- Verificações: verificationId, assertionVersionId, método/release/descriptor, verifiedAt, validUntil, autoria/autoridade e suporte exato usado. Guardar resultado original e estado observado no instante de submissão, incluindo estado de revogação quando exista; materialDigest e authorizationEvidence restritos ao servidor.
- Completion report congelado, com findings determinísticos, códigos/slots e instante de observação; candidate/version/publication IDs e aprovação/publicação append-only.

Carregar os membros de **uma revisão** e as versões a que se referem, numa transação; nunca juntar os últimos heads dos domínios. Reutilizar `competencyMaterial`, verificação do digest original e histórico de autoria. Ordenação canónica por kind/ID, sem dependência da ordem de SQL. A submissão reutiliza a criação da revisão SUBMITTED e aponta para essa revisão, não para o número anterior enviado no CAS.

| Dimensão | Regra fechada |
| --- | --- |
| Conhecimento | Temas KNOWN obrigatórios; prioridades KNOWN ou UNKNOWN explícito; competências: uma ou mais assertions KNOWN ou um marcador UNKNOWN do domínio, sem misturar ambos para contornar cobertura. Coleção vazia é slot em falta, não NONE/UNKNOWN. |
| Verificação factual | Separada do knowledgeStatus. Assertion sem verificação é UNVERIFIED. Apenas resultado governado e suporte/tempo admissíveis sustentam verificação corrente. Não exigir verificação para completar o slot de competências. |
| Completude para publicação | Estrutura, slots, identidade/referências, proveniência, autoria e fecho referencial completos. Experiências/links são opcionais para declaração não verificada; uma verificação incluída exige o seu suporte integral. Publicar pode incluir KNOWN não verificado e UNKNOWN explícito. |
| Admissibilidade futura F14 | Não calculada nesta entrega. Publicado não é READY nem ativo. Consumidor futuro revalidará tuple, referências, suporte e validade no instante da avaliação. |

**Verificações expiradas/revogadas:** preservar o registo original e a identidade da assertion KNOWN; não apagar, renovar prazo, reverificar ou converter em UNKNOWN. A policy de publicação não exige uma verificação corrente por competência: admite o registo histórico com `effectiveStatusAtSubmission=EXPIRED/REVOKED`, sem o contar como prova corrente. Isto não permite EXPIRED/REVOKED num slot obrigatório de verificação corrente: tal slot não existe nesta policy. Assertion corrente ela própria revogada/disputada/conflituante continua inadmissível nos termos da completion policy aprovada.

Para tornar a revogação verificável, 009 só guarda status VERIFIED: é necessária extensão mínima append-only `verification_status_event`, ligada a verificationId/tenant/scope, com sequência, estado REVOKED, reason, sujeito, instante e F7. Usar a operação/grant/assurance já aprovados F13_ASSERTION_REVOKE, resolvendo a assertion exata do registo; não UPDATE do resultado original nem restauro implícito. Expor apenas esta revogação de verificação, sem editor genérico de lifecycle. Nova verificação exige ação explícita autorizada. Reutilizar protocolo de exclusão/CAS no stream; expiração é derivada do relógio, não evento que altera dados.

Durante submissão fixar estados observados e deadline das verificações então correntes; uma verificação já histórica/expirada não cria um deadline impossível nem passa a corrente. Se validade expirar ou revogação ocorrer antes de aprovação/publicação, recusar `APPROVAL_STALE`: nova candidatura editorial/revisão explícita deve mostrar o estado alterado antes de nova aprovação. Não reescrever o candidato congelado. Depois de publicar, leitura mantém factos/estados capturados e apresenta separadamente `observedAt` e estado de validade atual autorizado. Mudança posterior não altera bytes/digest da versão. Histórico que perdeu suporte pode ser indicado indisponível, sem revelar documento revogado. A interface nunca apresenta o estado histórico VERIFIED como garantia de validade atual.

## 4. Percurso e contratos HTTP

Namespace novo `/api/organizational-profile/pq1-publication` (P). Não modificar respostas, cobertura ou consumidores do namespace temático. UI pode reutilizar componentes, nunca selecionar bundle/schema silenciosamente pelo conteúdo do draft.

Comum: sessão server-side, tenant resolvido, READ cumulativo, CSRF em mutações, no-store, JSON fechado, 256 KiB máximo, UUIDs, limites existentes do domínio. Sem payloads/digests/tokens nos logs. IDs de recurso no path devem coincidir com o recurso carregado. Erros 400 inválido, 401 sessão, 403 autorização, 404 indisponível uniforme, 409 CAS/completion/reference/approval/idempotência, 503 serviço/resultado incerto; não inferir rollback do status HTTP.

| Endpoint relativo a P | Entrada essencial | Projeção / serviço |
| --- | --- | --- |
| GET /context | Nenhuma | Configuração admitida, cobertura, actions e requisitos de assurance. Não concede grants. |
| GET /catalog | kind, releaseId opcional, cursor/limit | Temas/prioridades/competências/níveis/tipos/métodos autorizados; métodos incluem documentRequired e limites governados. |
| POST /drafts | draftId, items temáticos/prioridades, idempotencyKey | createDraft existente; draftId/revision/lifecycle. Draft pode estar incompleto. |
| PUT /drafts/:id/items | expectedRevision, items, idempotencyKey | editDraft existente, preservando competencyMaterial e demais domínios. |
| PUT /drafts/:id/competencies | expectedRevision, assertions, idempotencyKey | setCompetencies; assertionId/versionId/knowledgeStatus/conceptId/levelId. Substituição explícita da coleção, não perda silenciosa de itens. |
| PUT /drafts/:id/experiences | expectedRevision, experiences, idempotencyKey | setExperiences; campos existentes exceto provenanceRef, gerado pelo adapter servidor. Versões não alteradas preservam a proveniência existente; nova versão recebe nova proveniência. |
| POST /drafts/:id/evidence-links | expectedRevision, linkId, assertionVersionId, experienceVersionId, documentVersionId nullable, idempotencyKey | attachEvidence existente e F11 adicional. |
| GET /drafts/:id/experiences/:experienceId/documents | cursor/limit | Seletor estreito de referências F11 já vinculadas, com autorização antes de projetar; sem conteúdo/download implícito. |
| POST /drafts/:id/verifications | expectedRevision, verificationId, assertionVersionId, methodId, validUntil, idempotencyKey | verifyCompetency existente + descriptor/documentRequired. verifiedAt servidor; valida [verifiedAt,validUntil). |
| POST /verifications/:id/revoke | concurrencyToken, reasonCode, idempotencyKey | Evento de revogação append-only e recibo; F13_ASSERTION_REVOKE. Sem apagar histórico. |
| POST /drafts/:id/submit | expectedRevision, idempotencyKey | Submeter revisão coerente; candidateId/sourceRevision/coverage/completion. |
| POST /candidates/:id/approve | concurrencyToken, idempotencyKey | APPROVED, versionId; aprovação com segregação/MFA. |
| POST /versions/:id/publish | concurrencyToken, idempotencyKey | PUBLISHED, versionId, active:false, effectiveSnapshot:false, f14Consumable:false. |
| GET /drafts, /candidates, /versions e /:id | cursor/limit nas listas | Cabeçalho, projeção de conteúdo autorizada, findings, actions, histórico de revisões; nenhum digest. |
| GET /drafts/:id/revisions/:revision | Revisão exata | Leitura histórica do draft, sem edição retroativa. |
| POST /intentions/lookup | operation, resourceId, idempotencyKey; expectedRevision quando aplicável | CONFIRMED/FAILED_FINAL/RESOLVING/UNKNOWN, receipt seguro, correlationId. Lookup read-only com allowlist fechada. |

Recibos de edição não devolvem semanticDigest dos serviços internos. Tokens de concorrência são opacos e autenticados, vinculados a sujeito/tenant/operação/recurso, revisão/estado e bundle; hashes/digests ficam no servidor (não codificados legivelmente em token). Cursor segue a mesma proteção. Context/actions são indicativos; escrita reautoriza.

UI: editor único de draft misto com abas existentes/competências/evidências; mostrar perda de verificação corrente por mudança material antes de gravar, preservando histórico. Não substituir o comportamento conservador existente que invalida membros de verificação após alterações por reaproveitamento silencioso. Submeter apresenta faltas; checker revê conteúdo e estado de verificação; step-up exige nova confirmação; publicação termina em «Publicado — inativo; não disponível para avaliação». Leitura e navegação A/B limpam projeções/contexto sem apagar a intenção pendente da identidade original.

## 5. Autorização, consistência e F7

Reutilizar operações/grants existentes de create/edit/submit/approve/publish/read, F13_COMPETENCY_DRAFT_EDIT, F13_EXPERIENCE_DRAFT_EDIT, F13_EVIDENCE_ATTACH, F13_COMPETENCY_VERIFY, F13_EVIDENCE_LINK_READ e F13_ASSERTION_REVOKE. Recursos carregados no servidor, scopes ORGANIZATION neste percurso. Catálogos usam autorização taxonómica existente; selector F11 usa autorização documental adicional, sem acesso implícito. Não adicionar grants F14 neste incremento.

MFA recente em verificar/revogar/aprovar/publicar e leituras restritas conforme F5; autor/submissor não aprova a própria revisão, verificador não verifica material que criou/alterou. Reutilizar derivação de autoria integral do draft misto, não apenas itens temáticos nem apenas autor do último head. Sem terceira pessoa obrigatória. Reautorização também em replay, lookup e consulta; não promover um papel ADMIN a grant.

Transação preparada tenant-local com F5/guardas de commit e F7; reutilizar locks existentes e ordem comum dos produtores. O gate F13-P1 hoje serializa transações breves da organização: isso é um lock transacional já existente, não bloqueio persistente de pendências. Não o transformar numa fila organizacional de UNKNOWN nem abrir refactor geral de locking.

CAS: expectedRevision em cada mutação do draft e submissão; token exato em aprovação/publicação e revogação. Acrescentar leituras protegidas do status stream de verificação e referências ao mesmo protocolo usado pelos escritores, com ordem determinística. Revogação/expiração entre leitura e commit deve causar recusa ou resultado que corresponda ao ponto de linearização, nunca gravação parcial. Se revogação linearizar depois, a versão histórica fica preservada e a consulta atual mostra suporte revogado. Não prometer retroatividade.

Idempotência liga tenant, sujeito, operação, recurso e conteúdo/CAS canónicos. Os registos internos existentes de competência têm chave tenant/operação/idempotencyKey: o adapter deve adicionar binding autenticado ao sujeito/recurso e recusar colisão/replay por outro sujeito, sem divulgar o recibo. Não enfraquecer os digests de domínio. IDs gerados pelo servidor (proveniência/candidato) são fixados pelo primeiro recibo; antes de os regenerar, verificar replay. Payload igual repete o mesmo resultado; chave com conteúdo diferente devolve 409. Nova versão não substitui recibo anterior.

F7 source-local obrigatório e atómico com a mutação e recibo:

| Ação | Eventos existentes reutilizados |
| --- | --- |
| Criar/editar declaração/experiência | PROFILE_DRAFT_CREATED / PROFILE_DRAFT_REVISION_CREATED; provenanceRef ligado ao evento da experiência, sem segundo commit |
| Ligar/consultar evidência | EVIDENCE_ATTACHED / EVIDENCE_LINK_ACCESSED; F11 aplica os seus eventos |
| Verificar / revogar verificação | COMPETENCY_ASSERTION_VERIFIED / ASSERTION_REVOKED, operação/recurso/assertion/verification IDs explícitos |
| Submeter/aprovar/publicar/consultar | PROFILE_DRAFT_SUBMITTED / PROFILE_VERSION_APPROVED / PROFILE_VERSION_PUBLISHED / PROFILE_ACCESSED |

Preservar eventos técnicos adicionais já exigidos pelos serviços, sem duplicar eventos de sucesso no replay. Admitir novos detail/reason codes fechados do recorte (por exemplo DOCUMENT_REQUIRED, PROVENANCE_UNRESOLVED, VERIFICATION_EXPIRED, VERIFICATION_REVOKED, IDENTITY_NOT_ADMITTED), nunca mensagens livres no ledger. Reason da revogação usa catálogo fechado do release. Não inventar motivo do utilizador. Digests só em armazenamento/auditoria restrita; não em HTTP, frontend, métricas ou logs públicos.

Persistência nova é aditiva e identificada por schema/bundle: proveniência mínima, descriptor de método, status stream, candidatos/versões/publicações multidomínio e bindings/recibos do adapter. Pode reutilizar primitives editoriais, mas não usar tabelas/constraints com semântica temática fechada como se já aceitassem o novo conteúdo. Preservar 009/016 e releases publicados; novas migrations deverão ter up/down, privilégios mínimos, admissão, manifestos e fingerprints. Down não apaga publicações/dados: se existirem artefactos novos, recusa segura e procedimento de preservação, nunca downgrade destrutivo automático.

## 6. Intenções pendentes e recuperação

Envelope mínimo no browser: userId, organizationId, operation, resourceId, draftId quando resolvido, expectedRevision quando aplicável e idempotencyKey; sem conteúdo, digests ou credenciais. `sessionStorage` protege a UX dessa sessão; não é exclusão entre sessões/dispositivos/sujeitos. Não prometer persistência que ele não oferece. Servidor garante CAS, unicidade, idempotência, reautorização e atomicidade mesmo sem envelope.

| Intenção UNKNOWN | Gravações que a UI bloqueia para esse sujeito | Fora do bloqueio |
| --- | --- | --- |
| CREATE_DRAFT | Recriação/substituição da mesma intenção/draftId gerado antes do envio | Outros drafts e leitura |
| EDIT_ITEMS, SET_COMPETENCIES, SET_EXPERIENCES, ATTACH_EVIDENCE, VERIFY, SUBMIT | Novas mutações/submissão no mesmo draft; é um único head partilhado | Outros drafts, consulta e lookup |
| APPROVE | Nova aprovação do mesmo candidateId e publicação dependente de resultado ainda desconhecido | Candidatos independentes |
| PUBLISH | Nova publicação da mesma versionId | Outras versões e leitura |
| REVOKE_VERIFICATION | Nova revogação desse verificationId; ações dependentes desse suporte no painel até reconsulta | Verificações/drafts independentes sem esse suporte |

Bloqueios são por operação/recurso e dependência real, não por toda a organização. Servidor não mantém mutex organizacional indefinido: outra sessão continua sujeita a CAS/estado e recibos. A ausência de envelope noutra sessão não autoriza reapresentar a mesma intenção com outra chave como estratégia de recuperação. Testar explicitamente colisões e efeitos possíveis entre sessões.

Lookup fechado deve admitir estas operações e recursos no protocolo Central/tenant, sem ampliar lookup genérico. Central 010/011 não admitem automaticamente o novo namespace. Reutilizar coordenador/reconciliação e estender apenas allowlist/bindings necessários; recusar referências cruzadas A/B e revalidar sessão/membership/grants. Resultado CONFIRMED exige recibo e prova correlacionada de commit. FAILED_FINAL exige prova terminal de rollback ligada à intenção exata; ausência de linha não basta. Para authoring sem prova suficiente, manter UNKNOWN como no protocolo atual. RESOLVING tem limite de polling; UNKNOWN pode permanecer indefinidamente.

UI oferece «Consultar resultado» e, se persistir, «Contacte o suporte» com correlationId e intention/idempotencyKey. Suporte autorizado pode correlacionar guardas, recibos e F7, recuperar commit comprovado ou confirmar rollback comprovado; sem prova conclusiva mantém UNKNOWN. Não disponibilizar botão de apagar pendência/forçar sucesso nem prometer ferramenta universal, resolução automática ou SLA não aprovado. 503 sozinho nunca demonstra falha definitiva.

## 7. Critérios de aceitação e evidência

Registo da especificação Ready: todos os critérios estavam **por executar**; a especificação não constitui evidência de comportamento. Atualização de implementação: consultar a [matriz de aceitação](../reviews/f13-pq1-publish/acceptance-matrix.md), que distingue execução nova, mecanismos partilhados e inspeção. Essa ressalva descreve o estado anterior ao fecho; a decisão humana e os limites atuais estão registados na secção de fecho acima.

| ID | Prova essencial |
| --- | --- |
| PUB-01 percurso | Browser completo com maker e checker: criar draft, editar competência, experiência/proveniência, ligar evidência, verificar, submeter, aprovar com MFA, publicar e consultar inativo. Sem scripts como interface do utilizador. |
| PUB-02 conhecimento | Publicar KNOWN não verificado e UNKNOWN explícito; coleção ausente/inválida não completa; temas KNOWN/prioridades UNKNOWN preservados; nenhum NONE ou incumprimento fabricado. |
| PUB-03 referências | Catálogos PUBLISHED admitidos, ownership, IDs/releases exatos e descriptor; rejeitar mesmo label com identidade diferente, referência estrangeira e UUID de proveniência não resolvido. Fixtures nunca passam por conteúdo produtivo. |
| PUB-04 F11 | Método sem documento verifica com experiência suficiente; método que exige documento recusa ausência; CLEAN/AVAILABLE/binding/grant reais, revogação e IDOR A/B; seletor não divulga documentos não autorizados. |
| PUB-05 segregação | Maker/verificador/checker, mesma pessoa em sessões diferentes, MFA ausente/expirado/renovado e nova confirmação; grants separados, sem privilégio implícito de ADMIN. |
| PUB-06 tempo/status | Antes/no limite/depois de validUntil; null só quando permitido; verificação EXPIRED/REVOKED preservada como histórica, sem mudar knowledgeStatus; publicação não exige verificação universal; mudança entre submissão/aprovação/publicação causa APPROVAL_STALE. |
| PUB-07 drafts mistos | Alternar edição temática e competências/experiências; preservar membros e digests do produtor, autoria completa e invalidação explícita de verificação por mudança material. Não perder domínios fora do recorte. |
| PUB-08 imutabilidade | Alterar fonte/revogar suporte após publicação; conteúdo publicado/digests permanecem, observação atual separada e sem falsa validade; candidato não se recompõe de latest heads. |
| PUB-09 concorrência | PostgreSQL real: CAS duas sessões, submit versus edit, verify versus attach, approve/publish versus revogação/status e grants; duas ordens de linearização, nenhum efeito parcial. |
| PUB-10 idempotência/F7 | Replay igual, chave divergente e colisão entre sujeitos; injetar falha F7 após escrita e antes do commit em cada família nova (proveniência/edição, status, publicação); linhas/recibos atómicos. |
| PUB-11 recuperação | Perda de resposta após commit, falha antes do commit, UNKNOWN sem guard conclusivo, reload/lookup e browser→503 concorrente na mesma sessão→lookup; nenhum replay cego ou duplicação. Bloqueios restritos da secção 6 e outras sessões testados. |
| PUB-12 isolamento | Listas/detalhe/histórico/catálogos/proveniência/status/lookup A/B; sessão, membership, grants e F11 revogados durante operações; nenhum leak de existência ou digest em erros/HTTP/browser. |
| PUB-13 regressão temática | Mesmo corpus e fixtures do extrator/publicação/UI temáticos: schema/tuple/cobertura/HTTP/idempotência inalterados; draft misto continua a produzir o recorte temático anterior, sem competências introduzidas nele. |
| PUB-14 exclusões | Inspecionar efeitos em DB e rotas: nenhuma criação READY, effective snapshot, ponteiro/ativação ou avaliação F14; novas publicações sempre active:false/f14Consumable:false. |
| PUB-15 admissão | Up/down seguro em descartável, upgrade com residual/dados históricos, roles/RLS/privilégios, manifestos/fingerprints e lookup fechado. Backend/sintaxe, testes focados, suite afetada, frontend/build e gates transversais atingidos. |

Fixtures Central + tenants A/B em PostgreSQL descartável, relógio controlado para fronteiras temporais e browser real no percurso final. Evidência deve guardar hashes do snapshot, comandos/resultados, artefactos e limitações. Provas locais não validam staging/produção, IdP externo ou dados reais. Não transferir automaticamente a aceitação das limitações dos critérios fechados para este incremento.

## 8. Reutilização, extensões e sequência executável

| Reutilização | Extensão mínima necessária |
| --- | --- |
| competencyContracts/Service/Repository/Resources e competencyMaterial | Adapter HTTP/projeções, leitura de seleção, descriptor documental, proveniência resolvida e status stream; manter lógica de verificação, CAS e relações existentes. |
| authoring e editorialSource/histórico/derivação de autores | Extrator multidomínio, completion/tuple próprios e armazenamento separado semanticamente; não passar conteúdo novo ao extrator temático. |
| editorial lifecycle/UI/token/recovery patterns | Novos endpoints/painéis e namespace, tokens opacos, bindings de sujeito/recurso, lookup fechado e estados de pendência. |
| F5/F7/F11, transações preparadas e guardas | Admissão explícita das novas persistências/leituras/proteções, sem novos grants F14 ou plataforma documental. |

Implementar na ordem:

1. Release técnico/fixtures, schema/descriptor/proveniência/status e persistência aditiva, manifestos/admissão; testes de schema, ownership e identidade exata. Conteúdo produtivo permanece separado.
2. Adapter do authoring e catálogos/F11; projeções sem digests; HTTP e UI de competências/experiências/evidência/verificação e revogação mínima, com CAS/MFA e lookup.
3. Extrair revisão mista coerente, aplicar completion e congelar candidato; aprovar/publicar com autoria integral, tokens, deadline/status e F7 atómicos. Reutilizar lifecycle sem ampliar schema temático.
4. Integrar consulta e percurso browser completo, recuperação/reload e estados históricos; executar PUB-01–15 e regressões afetadas.
5. Revisão read-only da implementação/evidência e decisão humana de fecho restrito. Nenhum início de materialização/ativação/F14 por consequência automática.

**Registo histórico das lacunas técnicas contratadas como trabalho:** ausência de resolução de provenanceRef; ausência de descriptor documentRequired; dois catálogos sem identidade comum garantida; ausência de status stream de revogação de competência; publicação atual só temática; ausência de HTTP/UI e lookup deste recorte; recibos internos de competência ainda não vinculados ao sujeito como exige o adapter. À data da especificação, as extensões acima fechavam o desenho e não eram capacidades implementadas. A implementação e a prova local atuais estão referenciadas na matriz. Não há decisão de produto adicional pendente. Configuração produtiva de conteúdo é pré-requisito de utilização real, não motivo para inventar conteúdo ou impedir implementação com fixtures governadas.

Registo histórico da tarefa de especificação: o estado Ready autorizava preparar a implementação numa tarefa própria; nessa tarefa não foram alterados código/migrations nem executados testes funcionais. A instrução humana posterior autorizou a implementação, que passou por Review e pelo fecho restrito acima. Não foram iniciados READY, materialização, ativação ou F14.
