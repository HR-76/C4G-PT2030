# F13→F14 — Contrato mínimo de qualificação explicável

## Critérios evidenciados — Complete: fecho humano restrito (2026-10-16)

Decisão humana explícita: **GO restrito aprovado**, incluindo a correção de freshness e as limitações da revisão final. O incremento de critérios evidenciados fica **Complete**, limitado ao percurso **criar → rever → confirmar → consultar** interpretações privadas tenant-local. Confirmação significa exclusivamente interpretação editorial confirmada; não avalia elegibilidade nem declara requisito satisfeito.

Finding de freshness **resolvido**: head, histórico e detalhe aplicam a precedência **UNAVAILABLE → REVIEW_REQUIRED → CURRENT**, sem alterar revisões históricas persistidas. Permanecem a identidade/revisão exatas da oportunidade, permissões explícitas e possibilidade de a mesma pessoa editar e confirmar com os grants necessários.

Antes deste fecho documental foram conferidos **704 hashes de ficheiros**, o hash do contrato e o HEAD do snapshot testado, mais **11 artefactos incrementais e 17 artefactos da implementação original**, sem divergências. As alterações documentais deste fecho são posteriores ao snapshot; este continua a identificar a versão testada anterior ao fecho. Os artefactos históricos não foram alterados nem os testes repetidos.

Evidência: [implementação original](../reviews/opportunity-evidenced-criteria/README.md) e [correção de freshness, matriz de aceitação e diagnóstico preservado](../reviews/opportunity-criteria-freshness/README.md). Resultados executados na correção: focados **15/15**, backend **790/790**, PostgreSQL descartável/HTTP/browser A/B e suplemento de aceitação PASS; sintaxe/whitespace PASS. Frontend **41/41**, build e gates dedicados de migrations/F12/UBI/editorial foram reutilizados, não reexecutados separadamente. A revisão final das ressalvas confirmou a ligação real aos mecanismos partilhados por inspeção; não criou novas provas de execução.

Limitações expressamente aceites no fecho:

- **503 não demonstra falha definitiva.** A UI conserva o envelope mínimo da intenção e trata o resultado como incerto; não guarda o conteúdo do pedido nesse envelope.
- Uma intenção pode permanecer **UNKNOWN**, com novas gravações conflitantes bloqueadas e encaminhamento para suporte. **Não existe garantia de resolução automática desse caso.**
- Não foram executadas especificamente as combinações de revogação durante CRITERIA_SAVE/CRITERIA_CONFIRM, nas duas ordenações e individualmente para sessão, membership e grants. A ordenação de autoridade é sustentada pelas provas executadas do guard partilhado no consumidor editorial e pela inspeção do binding real desta feature.
- Não foi injetada especificamente falha F7 na gravação de critérios, quer na criação inicial quer na atualização do head, com verificação de revisão/receipt. A sustentação combina rollback F7 executado na confirmação com inspeção do mesmo cliente, transação e caminho comum de auditoria/receipt. Não equivale a execução específica dessas combinações.
- O percurso **browser → 503 concorrente na mesma sessão → lookup da intenção específica** não foi executado integralmente. O diagnóstico 200/503 foi preservado; a corrida final com dois sujeitos/sessões independentes passou com 200/409. As provas de recuperação após perda de resposta e reload são distintas.
- As provas são locais, com PostgreSQL descartável e IdP sintético; não validam staging, produção, IdP externo ou dados reais. Mantêm-se os restantes limites de SLO e acessibilidade documentados nas evidências.

**F13 integral permanece In Progress.** Avaliação F14, snapshot READY, ativação, scoring e decisões humanas sobre avaliações continuam fora deste incremento, assim como candidatura e oportunidades Central operacionais. Os fechos anteriores F13/016 e interface/Central 010 são preservados.

**Próxima etapa proposta, não iniciada:** concretização do contrato de pré-qualificação F13→F14, com decisões e critérios próprios antes de qualquer implementação. Este fecho não autoriza essa etapa.

### Registos anteriores preservados — anteriores ao fecho humano

As menções seguintes a Review, READY_FOR_HUMAN_REVIEW e decisão pendente são históricas; prevalece o fecho restrito acima.

Atualização 2026-10-16: finding de freshness corrigido e validado; nova decisão de fecho restrito pendente. [Evidência incremental e matriz de aceitação](../reviews/opportunity-criteria-freshness/README.md): focados 15/15, backend 790/790 e gate PostgreSQL/HTTP/browser PASS. O registo e os artefactos da implementação original abaixo mantém valor histórico.

**Review — incremento de critérios evidenciados implementado e validado localmente**, 2026-10-16. Delimitação aprovada por decisão humana: criar → rever → confirmar → consultar interpretações privadas tenant-local, com permissões explícitas, mesma pessoa autorizada a editar/confirmar, referência exata e histórico imutável. Percurso criar → rever → confirmar → consultar validado; READY_FOR_HUMAN_REVIEW, sem fecho humano. Resultados, hashes e limites em [evidência da implementação](../reviews/opportunity-evidenced-criteria/README.md). Avaliação F14 e restantes etapas futuras abaixo continuam propostas, não aprovadas. F13 integral In Progress; fechos F13/016 e interface/Central 010 preservados. Ativação temática limitada adiada; D1–D2 dessa [proposta](f13-profile-activation-and-consumption.md) não estão aprovadas. A futura ativação aqui necessária tem finalidade consumidora diferente e exige aprovação própria.

## Contrato técnico aprovado em âmbito e concretizado para implementação

Esta secção prevalece sobre as menções anteriores a decisões pendentes do **incremento de critérios**. A aprovação não abrange avaliação F14, score, decisões sobre avaliações, ativação ou candidatura. “Confirmado” significa apenas **interpretação editorial confirmada**.

### Suporte real e limites de integração

opportunities/contracts.js e repositorySupport.js já mantêm opportunityId, revisionId, revisionNumber, snapshot/contentDigest e provenance por revisão; rowVersion protege o head. Atualização cria revisão histórica; não é necessário inventar revisão estável. O HTTP F12 usa TenantOpportunityRepository e privateOpportunityRoutes, com F4/guard/F7; PrivateOpportunityDetail é o ecrã reutilizável. Legacy/UBI não é fallback.

CentralOpportunityRepository existe, mas productionComposition.js monta apenas o percurso HTTP privado F12. Logo, a entrega utilizável deste incremento é sobre **oportunidades privadas do tenant**. Associação futura a Central deve usar autoridade CENTRAL + ID/revisão opacos, carregados por port autorizado, e interpretação guardada no tenant; sem FK entre bases nem alteração da oportunidade comum. Enquanto esse port não estiver operacional, referência Central é recusada como capacidade indisponível, sem aceitar conteúdo ou prova de acesso do caller. Não implementar catálogo Central nesta entrega nem anunciar esse percurso como disponível. A distinção de autoridade fica explícita no modelo, sem habilitar um caminho inseguro.

### Persistência, estados e transições

Entidades novas tenant-local, com RLS e chaves compostas por organization_id:

- **CriteriaSet:** setId estável, authority/origin da oportunidade resolvidos no servidor, opportunityId, headRevisionNumber, headRevisionId; um conjunto por tenant/oportunidade/autoridade. Sem campos de resultado organizacional.
- **CriteriaRevision:** revisionId UUID, número monotónico, parentRevisionId, referência exata opportunityRevisionId e digest interno, conteúdo/critério/evidências canónicos, authorSubjectId, createdAt e digest da revisão. Cada gravação cria revisão imutável; não há UPDATE do conteúdo.
- **CriteriaConfirmation:** revisionId único, confirmedBySubjectId, confirmedAt, versão de contrato/catálogos e evidência de autorização interna. Append-only. Confirmação não modifica conteúdo; duas confirmações da mesma revisão não criam dois efeitos.
- **Idempotency/receipt:** intenção, sujeito, operação, recurso, requestId e resultado sanitizado, persistidos na mesma transação. Fonte tenant-local registada no recovery existente; nenhuma nova fila ou protocolo.

Lifecycle derivado por revisão: **DRAFT** sem confirmação; **CONFIRMED** com confirmação. “Pendente de revisão/desatualizada” é indicador derivado da diferença entre referência fixada e revisão corrente da oportunidade ou indisponibilidade/incompatibilidade da evidência; não altera confirmação histórica nem cria novo estado editorial F13. head pode ser novo DRAFT enquanto a confirmação anterior permanece histórica. Não selecionar automaticamente uma confirmação antiga como corrente.

Correção de coerência de freshness autorizada em 2026-10-16: head, histórico e detalhe usam a mesma validação atual de referências. A precedência preservada do detalhe é `UNAVAILABLE` quando existe referência incompatível; na sua ausência, `REVIEW_REQUIRED` quando a revisão da oportunidade difere; caso contrário `CURRENT`. Referência omitida num draft continua a produzir findings de incompletude, sem inventar incompatibilidade; confirmação continua bloqueada. A classificação é derivada, sem mutação histórica. O histórico agrupa e deduplica as referências da página numa única leitura de catálogo. Evidência incremental: [correção de freshness](../reviews/opportunity-criteria-freshness/README.md).

Criar primeiro DRAFT: expectedHeadRevision=0. Editar qualquer head, confirmado ou não: acrescentar nova revisão com parent=head e CAS; a confirmação não é copiada. Rever é leitura sem mutação. Confirmar só o head DRAFT exato, com oportunidade ainda na revisão fixada. Edição para adotar nova revisão da oportunidade exige envio explícito da nova referência e nova confirmação. Mudança de fonte/conceito é nova revisão, nunca alteração dos bytes históricos. Arquivo da oportunidade impede escrever/confirmar; leitura histórica depende sempre de READ atual.

### Campos fechados do critério e da evidência

Payload V1: criteria[], entre 1 e 3 entradas, sem duplicação de kind. kind pertence a COMPETENCY_REQUIREMENT, THEMATIC_AFFINITY, STRATEGIC_PRIORITY_AFFINITY. required é derivado pelo servidor: true apenas no primeiro. criterionId UUID estável dentro do conjunto; criação ou alteração não muda silenciosamente a sua natureza. Confirmar um conjunto não declara que esgota os requisitos de um aviso.

Cada entrada: {criterionId,kind,conceptRef:{conceptId,schemeId,releaseId},interpretationText,evidence:{sourceId,locator,excerpt,justification},temporalBasis}. Textos plain text, sem HTML/DSL: interpretação e justificação até 2000 caracteres; locator até 256; excerpt até 4000. Máximo JSON 64 KiB. Sem operadores arbitrários, expressões ou campos adicionais. Conceitos/release carregados e validados no servidor; sem equivalências por label. Para competência, temporalBasis=EVALUATION_INSTANT e verificationRequired=true derivados do template; afinidades usam temporalBasis=null. Outros períodos/prazos não são representáveis nesta V1 e não podem ser confirmados por texto livre que contradiga o template. Critério ambíguo permanece rascunho.

Sources[] no mesmo comando, até 3: {sourceId UUID,label,sourceKind,reference,versionLabel,capturedText}. sourceKind=SYNTHETIC ou EDITORIAL_TRANSCRIPTION; label até 200, reference até 2048, versionLabel até 128, capturedText até 12000 caracteres. Texto capturado e digest interno imutáveis; locator/excerpt têm de identificar trecho desse texto. SYNTHETIC nunca se apresenta como fonte oficial. EDITORIAL_TRANSCRIPTION é transcrição humana atribuída à fonte/referência indicada, não captura autenticada automática. URI não é descarregada no servidor nem prova a autenticidade; não aceitar secrets na referência. Fonte sem identidade/versionamento e suporte suficiente não é confirmável. A confirmação assume responsabilidade editorial pela transcrição e pela ligação à revisão da oportunidade.

Estes sources são evidência **da interpretação**, não evidência de competência/capacidade da organização. Não há upload, binário Central, crawler, OCR ou novo bypass F11. Uma futura integração documental deve usar versão F11 autorizada e respetiva prova; fica excluída desta V1. Guardar excerpt não concede acesso a documentos originais. Draft pode omitir conceptRef/evidence/temporalBasis; GET devolve findings fechados de incompletude e confirmação recusa. kind, IDs e limites estruturais são sempre obrigatórios.

### HTTP do incremento — implementado, em validação

Prefixo P=/api/opportunities/:opportunityId/criteria no runtime F12 privado. Sessão OIDC, organização server-side, CSRF nas escritas, Cache-Control:no-store, JSON fechado e erros sanitizados. UUIDs e revisões inteiras seguros. Autoridade não é parâmetro de cliente.

| Rota | Pedido | Resposta |
|---|---|---|
| GET P | sem query | 200 {setId:null ou UUID,head:summary ou null,opportunityRevisionId,actions}; ausência de conjunto autorizada não é erro |
| GET P/catalog | kind fechado, limit 1..50, cursor autenticado | conceitos publicados e labels da release exata, sem totals; exige leitura da oportunidade e dos critérios |
| GET P/revisions | limit 1..50 (default 20), cursor opcional | 200 {items:summary[],nextCursor}; keyset por revisionNumber, cursor autenticado ligado a sujeito/tenant/oportunidade, TTL 10 min; sem totals |
| GET P/revisions/:revisionId | sem query | 200 Detail da revisão exata; não redirecionar para head |
| POST P/revisions | {requestId UUID,expectedHeadRevision,opportunityRevisionId,criteria,sources} | 201 Receipt {setId,revisionId,revisionNumber,state:DRAFT} |
| POST P/revisions/:revisionId/confirm | {requestId UUID,expectedHeadRevision,opportunityRevisionId} | 200 Receipt {setId,revisionId,revisionNumber,state:CONFIRMED,confirmedAt} |
| POST P/intentions/lookup | {requestId,operation:SAVE_REVISION ou CONFIRM,resourceId} | 200 {status,receipt,reason,retryAfterSeconds,correlationId}; quatro outcomes do recovery existente |

summary={revisionId,revisionNumber,opportunityRevisionId,state,author:{subjectId,displayLabel},createdAt,confirmation:null ou {subjectId,displayLabel,confirmedAt},freshness:CURRENT/REVIEW_REQUIRED/UNAVAILABLE}. displayLabel vem de projeção autorizada, sem email/membership/claims; não confiar no label para identidade. Detail acrescenta criteria/sources sanitizados, findings e actions {canEdit,canConfirm,reason}. Digests, atributos de autorização e evidence interna do guard não saem para o browser. Head/versão exibidos não substituem reautorização na escrita. Campos de frescura são contexto de leitura, não conteúdo mutável da revisão.

Confirmação usa IDs imutáveis e expectedHeadRevision; não precisa de digest nem token opaco adicional. A UI relê o detalhe e pede confirmação da revisão exibida. Fonte, critérios e revisão da oportunidade ficam integralmente vinculados ao revisionId; não existe recurso “latest” na confirmação.

Erros: 400 INVALID_INPUT; 401 SESSION_REQUIRED; 403 NOT_AUTHORIZED quando não revela existência; 404 RESOURCE_NOT_AVAILABLE uniforme para IDs ausentes/alheios; 409 STALE_REVISION, OPPORTUNITY_CHANGED, EVIDENCE_INCOMPLETE, REFERENCE_INCOMPATIBLE, STATE_CONFLICT ou IDEMPOTENCY_CONFLICT; 503 SERVICE_UNAVAILABLE. Envelope {error:{code},correlationId}; sem payload recebido/SQL/stack. Erro técnico não é conclusão sobre critério.

### F5/F7 indispensáveis e atomicidade

Novos códigos técnicos propostos (catálogos fechados, zero grants implícitos):

| Operação F5 | Permission | Resource | F7 |
|---|---|---|---|
| OPPORTUNITY_CRITERIA_READ | opportunity.criteria.read | OPPORTUNITY_CRITERIA_SET | OPPORTUNITY_CRITERIA_ACCESSED |
| OPPORTUNITY_CRITERIA_EDIT | opportunity.criteria.edit | OPPORTUNITY_CRITERIA_SET | OPPORTUNITY_CRITERIA_REVISION_CREATED |
| OPPORTUNITY_CRITERIA_CONFIRM | opportunity.criteria.confirm | OPPORTUNITY_CRITERIA_REVISION | OPPORTUNITY_CRITERIA_REVISION_CONFIRMED |

Scopes ORGANIZATION ou RESOURCE exatos, com ancestry server-loaded da revisão/conjunto para a oportunidade. Todas exigem também opportunity.read atual sobre a oportunidade; escrita exige criteria.read mais edit/confirm respetivo. Novo conjunto usa a oportunidade como referência de autorização até ter setId. Sem ADMIN implícito, sem concessão por opportunity.private.update, sem MFA/SoD adicionais: sessão normal e autoridade corrente; mesma pessoa pode criar/rever/confirmar. Reutilizar eventos F5 de decisão e assurance existentes.

Payload F7 V1 fechado: opportunityId, opportunityRevisionId, setId, criteriaRevisionId, previousRevisionNumber, newRevisionNumber, contractVersion, detailCode e criteriaDigest interno quando aplicável. Actor, tenant, correlationId, requestId e decisão ficam no envelope F7 existente. Nulos explícitos para campos não aplicáveis; detailCode enum READ/SAVED/CONFIRMED. Recusas usam razões fechadas F5/domínio; não copiar texto, source URI, excerpt ou ficheiros para logs/auditoria. Eventos funcionais e receipt pertencem à mesma transação source-local.

Na gravação/confirmar: locks na oportunidade e set em ordem fixa, carregar head, reautorizar, verificar CAS e revisão exata da oportunidade, referências/evidência, persistir revisão ou confirmação, F7 e receipt; assert final do guard antes do commit. Oportunidade alterada entre revisão e confirmação produz 409 OPPORTUNITY_CHANGED. Escrita F12 concorrente no mesmo head fica serializada pelo lock; após commit posterior a frescura passa a REVIEW_REQUIRED sem apagar confirmação.

Intenção canónica inclui operação, sujeito/tenant confiáveis, recurso, referências, expectedHeadRevision e conteúdo; requestId reutilizado com intenção divergente recusa. Replay confirmado reautoriza e devolve receipt original antes de testar CAS corrente, nunca cria outra revisão. CONFIRM com outra key para revisão já confirmada recusa STATE_CONFLICT; mesma key repete receipt. 503/rede não prova falha: UI conserva envelope mínimo por sessão e bloqueia novas escritas conflitantes até recovery; não guarda conteúdo em sessionStorage.

Lookup vincula sujeito, tenant, operação, requestId e recurso (oportunidade para SAVE_REVISION; revisionId para CONFIRM). CONFIRMED só com receipt e prova correlacionados; FAILED_FINAL só com rollback terminal e binding comprovados; RESOLVING enquanto transação identificada pendente; UNKNOWN para ausência/inconclusão. Não interpretar ausência de receipt como rollback. Reutilizar reconcile/recover, timeout/polling limitado e orientação de suporte; não construir ledger Central paralelo.

**Extensões técnicas necessárias:** migração tenant aditiva para estas entidades, ACL/RLS, receipt e capability; registro dos novos source operations/bindings no recovery; se necessário novo lookup fechado no protocolo Central. Central 010 só admite cinco operações editoriais F13: não alterar 009/010, não reutilizar códigos F13 indevidamente nem abrir SQL genérico. Nova migration Central apenas para a consulta parametrizada mínima, com up/down, manifests/checksums/fingerprints. Números verificados na implementação. Sem alterar migrations F12/016 fechadas.

### Concretização técnica da implementação (2026-10-16)

- Central **011** acrescenta somente o lookup parametrizado de CRITERIA_SAVE/CRITERIA_CONFIRM; tenant **017** acrescenta tabelas, RLS/ACL, eventos e capability OPPORTUNITY_EVIDENCED_CRITERIA. Migrations fechadas anteriores preservadas; 013 mantém a reserva. Downgrade 017 recusa dados existentes.
- setId usa o UUID da oportunidade no namespace OPPORTUNITY_CRITERIA_SET; a identidade tipada distingue os recursos e permite grants RESOURCE exatos desde a primeira revisão. Confirmação usa o UUID próprio da revisão. O servidor carrega a relação oportunidade/conjunto/revisão; não recebe ancestry do browser.
- Confirmação e evidência de autorização correlacionadas por operação/revisão/ator/requestId no F7 e guard existentes. Nenhum grant implícito, MFA adicional ou segregação de funções.
- Lookup é observação operacional read-only, como a recuperação editorial existente: binding físico verificado, leitura e reautorização atual, sem preparar outra gravação nem bloquear na auditoria da transação observada. FAILED_FINAL exige guards da intenção única com rollback terminal comprovado e ausência de receipt; ausência de informação continua UNKNOWN. Novas escritas ficam bloqueadas na UI enquanto a intenção não estiver resolvida; consulta manual e referência de suporte após três tentativas em até 30 segundos.
- Cursor reutiliza HMAC stateless com chave editorial configurada; contexto inclui utilizador, tenant, oportunidade e, para catálogo, kind. Não transporta digests restritos. Revisões/CAS usam IDs e número esperado, sem novo token de autorização.
- UI relê head e detalhe antes da confirmação. Uma oportunidade alterada exige recarregar o detalhe e reconhecer explicitamente a nova revisão antes de a adotar numa gravação. A confirmação anterior permanece histórica.
- Composição requer OIDC, OPPORTUNITIES_RUNTIME=f12, PROFILE_EDITORIAL_RUNTIME=f13-editorial, chave editorial existente e admissão 017. Catálogos publicados fornecem conceitos; configuração incompleta falha fechada. A rota Central permanece indisponível.
- Provas e limitações: [revisão do incremento](../reviews/opportunity-evidenced-criteria/README.md). F13 integral In Progress; F13/016 e interface/Central 010 mantêm Complete. Sem avaliação F14, score, ativação, READY ou candidatura.

O GET F12 do detalhe acrescenta `capabilities.evidencedCriteria`, derivado exclusivamente da composição ativa no servidor. É disponibilidade técnica, não autorização. A UI só monta o painel quando true; os GETs e ações dos critérios continuam a reautorizar cada operação. Sem runtime editorial, o percurso F12/UBI não inicia consultas ou refresh de sessão do painel.

### Interface, validação e sequência

Em PrivateOpportunityDetail: secção “Interpretação privada dos critérios”, três formulários fixos, lista/head/histórico, fonte e interpretação/evidência no mesmo painel de revisão; na implementação mínima, secções em coluna responsiva para manter o percurso legível em mobile; ações Guardar nova revisão, Rever e Confirmar revisão N. Mostrar organização, autor/confirmador/data, oportunidade/revisão e aviso de desatualização; nunca “satisfeito” ou “elegível”. Confirmação com texto explícito “Confirmo a interpretação editorial desta revisão”. Sem botão Avaliar. Reutilizar API/CSRF, componentes de formulário/confirmador, estados de sessão, descarte de respostas tardias A/B e recuperação; teclado/foco/labels/mobile.

Testes de aceitação: percurso completo privado A e B; mesma pessoa edita/confirma com ambos os grants; ausência de cada grant e revogação antes/durante operação; UUIDs cross-tenant, fonte/revisão de outra oportunidade, acesso revogado impede também histórico/lookup; Central não operacional recusada sem consulta livre; mudança da oportunidade entre GET e CONFIRM; duas gravações/confirmadores com mesmo CAS; edição após confirmação preserva bytes; alteração de evidence cria revisão; replay mesmo requestId e divergente; F7 indisponível reverte revisão/confirmation/receipt; COMMIT perdido reconcilia sem duplicação; UNKNOWN não desbloqueia nova intenção conflitante; UI distingue confirmado histórico de atual. Testar schema up/down/admissão e regressões F12/F13 afetadas em PostgreSQL descartável.

Sequência Ready: (1) entidades/migration/ACL e catálogos F5/F7, recovery e testes; (2) adapters HTTP seguros com bindings privados reais e gates A/B; (3) secção integrada no detalhe até guardar/rever/confirmar/consultar/histórico; (4) browser, suites/build/gates afetados e revisão final. Configuração/capability incompletas falham fechadas. Sem decisões de produto adicionais identificadas: a indisponibilidade Central é limite comprovado e não autoriza construir esse catálogo. Avaliação/ativação seguem fora deste incremento.

## Enquadramento e propostas futuras (não autorizam implementação adicional)

As observações de lacunas abaixo registam a análise anterior a este incremento. A interpretação privada de critérios está agora implementada conforme a secção técnica acima; as lacunas de avaliação F14, perfil multidomínio, READY e ativação continuam atuais.

## Caso demonstrável e finalidade

Propor uma pré-qualificação assistida, sem score/ranking, para o gestor de financiamento decidir **solicitar informação, manter em análise ou descartar da análise com motivo**. Não equivale à qualificação integral do MVP nem à decisão de apresentar candidatura.

Exemplo exclusivamente sintético **SYN-QUAL-001**, revisão 1, “Demonstração de investigação ambiental”, entidade financiadora fictícia. Fonte sintética versionada, três cláusulas explícitas, conservadas com digest e localização da evidência:

- §1: “A entidade candidata deve demonstrar competência institucional C, verificada e válida na data da avaliação.” Requisito obrigatório.
- §2: “O tema T constitui área de interesse do apoio.” Afinidade temática, não condição eliminatória.
- §3: “A prioridade estratégica P é valorizada, sem excluir entidades que não a declarem.” Afinidade estratégica complementar.

C, T e P são aliases documentais para três conceitos sintéticos de releases governadas distintas, não códigos produtivos nem equivalências por label. Não existe oportunidade real com estas condições atribuídas pela proposta. Instante de avaliação fixado no corpus; nenhum prazo, limiar financeiro ou peso produtivo inventado.

Fixture organizacional A proposta: C KNOWN/VERIFIED vigente com provenance; tema T KNOWN/UNVERIFIED admissível como declaração editorial; prioridade UNKNOWN explícito. Resultado demonstrativo: requisito de competência satisfeito, afinidade temática observada, afinidade estratégica indeterminada. Constraints institucionais não cobertas impedem uma conclusão global positiva. Variantes B: dados diferentes e recursos inacessíveis a A; não assumir um tipo institucional UBI.

## Critérios, evidência e lacunas

| Condição/evidência sintética | Dado F13 necessário / contrato | Disponibilidade atual | Conhecido / incompatível / desconhecido | Lacuna mínima |
|---|---|---|---|---|
| §1: competência C verificada vigente; obrigatório | CompetencyAssertion e verificação/provenance exatas; decisão competências/experiência | competencyContracts.js tem setCompetencies, attachEvidence e verifyCompetency; não há publicação/snapshot multidomínio consumível no incremento 016 | C com prova admitida satisfaz este requisito; afirmação negativa explícita admissível pode refutá-lo. Outra competência ou lista vazia não prova ausência de C. UNKNOWN/ausência/prova insuficiente → indeterminado; tuple incompatível → recusa técnica, não inelegibilidade | Critério estruturado F14 ligado à revisão F12; publicação/materialização da competência e evidência; método de verificação aceite pela regra, sem inferência por documento existente |
| §2: tema T; afinidade | THEMATIC_AREA, conceito/release e declaração editorial | UI/serviços 016 publicam e leem recorte temático, mas f14Consumable=false | Identidade exata T → afinidade observada; sem correspondência numa cobertura declarada → afinidade não observada, nunca exclusão; ausência/UNKNOWN → indeterminado; mapping inexistente → não comparável | Ligação governada da cláusula ao conceito, regra de comparação exata e snapshot READY; não usar thematicCodes como IDs F13 |
| §3: prioridade P; afinidade complementar | STRATEGIC_PRIORITY, KNOWN ou UNKNOWN explícito; conhecimento/completion aprovados | Já representável na UI/editorial; fixture A declara UNKNOWN | P conhecido → afinidade observada; outro conjunto declarado → não observada; UNKNOWN → indeterminado, sem zero/penalização | Critério não eliminatório tipado e motivo explicado; não exigir prioridades conhecidas só para fabricar resultado positivo |

Correção terminológica: o único código de domínio temático usado pelo contrato é THEMATIC_AREA; labels nunca são identidade. A tabela descreve regras propostas para o corpus, não regras F14 produtivas já aprovadas.

Evidência de implementação: backend/src/opportunities/contracts.js preserva opportunityId, revisionId, revisionNumber, rowVersion, contentDigest e provenanceId; admite eligibilitySummary e arrays thematicCodes/territoryCodes/beneficiaryTypeCodes, sem semântica executável, obrigatoriedade ou evidência por critério. httpContracts.js limita o authoring aos campos editoriais básicos; não oferece editor de critérios. editorialRelease.js declara F13_EDITORIAL_READ_V1/f14Consumable=false. Contratos de competência existem, mas a publicação 016 exclui esse material; preservá-lo não o torna publicado para consumo.

## Constraints e conclusão com cobertura parcial

F13 fornece assertions, estados, validade, provenance, cobertura e versões; F14 interpreta §1–§3 com regras fechadas/versionadas. Não colocar IDs de oportunidades, scripts ou condições de avisos em assertions F13.

Para afirmar ausência de impedimento neste caso seriam indispensáveis, no mínimo: indisponibilidade UNAVAILABLE da competência C no período e proibição PROHIBITED aplicável à atividade temática T, ambas com scope, authority, reason, período, provenance e verificação. Os targets devem ser conceitos governados e independentes do aviso. A aplicabilidade e os targets exatos ainda exigem contrato: não antecipar catálogo completo, outros domínios ou toda a fatia 9.

**Menor entrega recomendada:** permitir análise parcial com constraints explicitamente não cobertas, exibindo “impedimentos institucionais não avaliados”. Não implementar constraints apenas para conseguir um booleano “elegível”. Quando forem necessárias conclusões positivas, introduzir primeiro esse recorte de assertions e uma declaração de cobertura válida; zero linhas não prova ausência de constraints. PROHIBITED/UNAVAILABLE só geram impedimento mediante regra F14 aplicável; UNKNOWN, WITHHELD, conflito ou ausência nunca são proibição.

Com cobertura parcial podem ser emitidos resultados dos critérios efetivamente avaliados e “qualificação global indeterminada”. Recusar afirmações de elegibilidade integral, ausência de impedimentos, recomendação de candidatura ou ranking. Um requisito obrigatório comprovadamente refutado pode produzir “impedimento identificado neste requisito”, com referência à regra, sem inventar avaliação dos restantes. Afinidade negativa ou desconhecida não elimina.

## Contrato proposto de consumo e resultado

1. **Entrada fixada:** organização da sessão/autoridade, oportunidade autorizada e origem Central ou privada tenant, opportunityId + revisionId + contentDigest; criteriaSetId/version/digest ligado a essa revisão, com criterionId, natureza obrigatória/afinidade, conceito/release, cláusula e referência da evidência. rowVersion serve CAS, não substitui revisão histórica. Mudança da oportunidade exige novo criteria set validado; não reaproveitar critérios silenciosamente.
2. **Perfil operacional:** effective_profile_version_id READY resolvido da baseline ORGANIZATION ativa e depois fixado; activation record, versões componentes exatas, semantic digest interno, snapshot schema, completion/projection policies, catálogos/releases, bundle e manifest. Não consumir draft/head nem recompor uma versão corrente durante avaliação. Origem 016 é referência preservada, não snapshot READY disfarçado.
3. **Tuple:** combina contrato F12/criteria set, snapshot/schema F13, policies/catálogos, consumer contract F14 e rule bundle exatos; aprovação/publicação governada, sem produto cartesiano de versões. N/N-1 apenas se manifest declarar tuple e adapter. Ausência, ambiguidade, digest divergente ou tuple incompatível recusam a operação antes de calcular um resultado de negócio.
4. **Cobertura mínima operacional proposta:** temas, prioridades e competências com respetiva verificação/provenance; constraints não cobertas explicitamente admitidas apenas para a finalidade “pré-qualificação parcial”. Completion F13 pode admitir UNKNOWN no slot de competências para este contrato, produzindo indeterminado em §1; exigir KNOWN numa regra de oportunidade não transforma a policy F13 em regra de elegibilidade. Não admitir REVOKED/EXPIRED/DISPUTED/CONFLICTED como corrente nem degradá-los para UNKNOWN. UNVERIFIED não satisfaz §1, mas é admissível para declarações de afinidade; WITHHELD mantém a semântica interna e limita o que o leitor pode receber.
5. **Avaliação determinística:** instante e período relevantes fixados, ruleId/version/digest por critério, versão do avaliador, referências das assertions e evidências realmente utilizadas. Comparação por identidade exata e verificação vigente; sem expansão ontológica, equivalência por label ou pesos. Não consultar novas versões durante replay. Revalidação de acesso/validade corrente pode recusar novo uso, sem reescrever resultado histórico.
6. **Resultado imutável proposto:** evaluationId, referências de entrada, finalidade/cobertura e instante; por critério: requisito satisfeito/não satisfeito/indeterminado ou afinidade observada/não observada/indeterminada, reason fechado e explicação com evidência. Vocabulário técnico final ainda por fechar; são resultados da avaliação, não novos estados de perfil. Separar desconhecimento factual, prova insuficiente e referência não comparável; erros técnicos não viram resultado negativo. Global limitado a “impedimento identificado” quando comprovado ou “indeterminado”; não produzir score, classificação global positiva ou “apto para matching”.
7. **Decisão humana separada:** registo append-only ligado ao evaluationId, ator, organização, data e motivo; proposta mínima “solicitar informação”, “manter em análise” ou “descartar da análise com motivo”. Não alterar o resultado automático, completar dados por decisão nem converter automaticamente em candidatura. Novos factos exigem novas versões/avaliação. Grants F14 de avaliar/ler/decidir e catálogo de motivos precisam de contrato próprio; não inferir autoridade de ADMIN ou de READ F13.
8. **Tenancy e confidencialidade:** autorização para oportunidade, perfil, avaliação e decisão, mesmo que a oportunidade seja Central partilhada. Resultado/decisão tenant-local; referências de A não podem ser usadas em B. Autoridade final server-side, F7, CAS/idempotência e reconciliação existentes; avaliação repetida com mesma intenção não duplica resultados. Projeções autorizadas e digests de projeção, sem digests internos, documentos ou valores restritos no browser. Acesso F13 não concede F11. Nenhum fallback de organização, snapshot, policy ou rule bundle.

**Experiência local:** corpus em memória com fixtures pode provar as três regras e explicações sem ativação, desde que rotulado “simulação sintética — não operacional”, sem guardar resultados produtivos nem declarar READY. Consumo operacional só após snapshot READY e ativação segundo os contratos aprovados; esta proposta não cria exceção.

## Sequência mínima e aceitação

1. **Próximo incremento concreto proposto:** critérios estruturados, versionados e evidenciados da oportunidade, ligados a revisão F12 exata, com os três tipos deste corpus e revisão humana da interpretação. Editor mínimo autorizado; sem DSL/motor genérico. Não alterar migrations/contratos fechados in-place. É a primeira lacuna: os campos atuais não distinguem requisito obrigatório de afinidade nem fixam evidência por condição.
2. Fechar policy/consumer tuple de pré-qualificação parcial e publicar baseline F13 temática + competências/provas. Ligar authoring/verificação de competências à UI apenas no necessário; preservar material excluído e separação das aprovações. Governar conceitos e método de verificação. Não promover campos UBI ou códigos F12 a factos institucionais.
3. Materialização síncrona READY, primeira ativação e substituição do perfil deste consumidor; grants/MFA/SoD, CAS de ponteiro, não redução de cobertura governada, F7/recovery. Novos schemas/admissão/migrations aditivos a especificar, sem reabrir 016/010. Snapshot parcial pode ser READY apenas pela policy explicitamente aprovada para esta finalidade, mantendo constraints não avaliadas.
4. Primeira operação F14: avaliar a oportunidade/revisão com o snapshot fixado, persistir resultado explicável e consultar por ID. Três regras fechadas; sem score, pesos, IA, embeddings, conectores ou motor genérico.
5. No detalhe de oportunidade existente: “Avaliar critérios”, painel com requisito obrigatório, afinidades, dados desconhecidos e limitações; links autorizados para versões/evidências; ações humanas propostas e histórico. Distinguir resultado antigo de nova revisão. Se faltarem perfil READY/ativo, criteria set ou tuple, explicar a dependência e não executar.

Testes exigidos após aprovação: A/B e IDOR em oportunidade privada/Central, snapshot e decisão; identidade partilhada com memberships distintas; C verificado, não verificado, expirado, ausente e UNKNOWN; T igual/diferente, P UNKNOWN; critérios sem evidence/mapping; constraints ausentes não produzem “sem impedimentos”; prioridade não elimina; tuple incompatível recusa; determinismo com inputs fixos; alteração de oportunidade/perfil não muda resultado histórico; revogação, projeções/F11, CAS/duplo clique, F7 e commit incerto; browser com explicação e decisão separada. Nenhum teste ou cálculo executado nesta especificação.

## Aprovações e decisões pendentes

Fontes aprovadas: [matching/qualificação](matching-and-qualification.md); decisões F13 [competências](../decisions/f13-competencies-and-experience.md), [conhecimento](../decisions/f13-knowledge-state-policy.md), [completion](../decisions/f13-completion-policy.md), [ativação](../decisions/f13-versioning-and-activation.md), [compatibilidade](../decisions/f13-schema-policy-compatibility.md), [constraints/F14](../decisions/f13-exclusions-vs-f14-rules.md) e [confidencialidade](../decisions/f13-confidentiality-projection-purpose.md). Preservam-se determinismo, READY operacional, imutabilidade, F5/F7 e decisão humana; esta fatia não cumpre o scoring ponderado previsto para a F14 integral.

## Decisões concretizadas para aprovação — primeiro incremento

**Delimitação de authoring aprovada; detalhes técnicos vigentes na secção inicial.** O âmbito cobre somente o authoring e a confirmação de **interpretações privadas tenant-local de critérios**, ligadas a oportunidade privada ou a revisão autorizada de oportunidade Central. A futura avaliação, ativação e decisão sobre resultados continuam entregas posteriores. O corpus e a semântica seguintes fixam o que os critérios têm de conseguir representar, sem implementar um avaliador.

### D1 — Corpus inicial e significado dos resultados

Fonte proposta: documento textual sintético SYN-QUAL-001/SRC-1, versão 1, título e financiador fictícios indicados acima. Conservar texto original das três cláusulas, localização §1/§2/§3, identidade/digest da fonte e proveniência sintética. Na fixture, usar instante explícito **2026-10-15T12:00:00Z**. §1 avalia validade nesse instante; não contém prazo de entrega documental e não autoriza inventar um.

| Critério | Interpretação e evidência editorial | Satisfeito com evidência | Não satisfeito com evidência | Desconhecido/evidência insuficiente |
|---|---|---|---|---|
| C1 — §1, obrigatório | Competência institucional C e verificação válida no instante fixado; evidência da interpretação: cláusula integral, conceito/release C e referência à definição do método admitido | Assertion C e verificação admitida, vigentes, com provenance e referências exatas | Apenas evidência admissível que refute explicitamente a condição no período, segundo regra fechada; não deduzir da lista de competências | Sem C registado, UNKNOWN, documento ausente, verificação inexistente/expirada ou método não comparável: não demonstrado; não prova inexistência da competência |
| C2 — §2, afinidade temática | Correspondência exata com tema T, sem expansão ou peso; cláusula + conceito/release T fundamentam a interpretação | T no conjunto declarado e publicado | Conjunto temático explicitamente coberto para a comparação, sem T: afinidade não observada nesse conjunto; não afirma incapacidade nem elimina | Cobertura ausente/parcial ou referência não comparável: indeterminado |
| C3 — §3, afinidade de prioridade | Prioridade estratégica P valorizada mas não obrigatória; cláusula + conceito/release P | P no conjunto declarado e publicado | Conjunto de prioridades explicitamente coberto sem P: afinidade não observada, sem penalização automática | UNKNOWN explícito, ausência ou cobertura insuficiente: indeterminado |

Fixture A: C verificada válida entre 2026-10-01 e 2026-11-01, T declarado e prioridade UNKNOWN; expected results C1 satisfeito/C2 observado/C3 indeterminado. Fonte, verificação e conceitos são sintéticos. Variante sem verificação de C permanece indeterminada. O contrato atual de competência só admite KNOWN/UNKNOWN: **não suporta inventar NONE nem uma declaração negativa universal para fabricar um teste de incumprimento**. Um futuro caso negativo de C1 precisa de evidência negativa admissível e contrato próprio; até lá, não existe caminho demonstrado para concluir esse incumprimento com os dados atuais.

Prazo vencido só pode justificar incumprimento de uma obrigação documental se a cláusula fixar essa obrigação/prazo e existir prova autorizada de incumprimento, incluindo a completude do registo de entregas. A falta de documento na F13 não é essa prova. Essa variante fica fora do primeiro corpus.

A avaliação futura distinguirá três outcomes por critério, preservando os motivos; para afinidade, os rótulos são observado/não observado/indeterminado. Se existir incumprimento obrigatório comprovado, concluir apenas “requisito C1 não satisfeito na revisão R, no instante/período E”; não declarar inelegibilidade universal. Sem tal prova e com cobertura incompleta, global indeterminado. Constraints ausentes nunca significam “sem impedimentos”. Erro de tuple ou autorização é recusa técnica, não outcome negativo.

### D2 — Responsabilidade editorial e fronteira Central/tenant

Recomendação: gestor/editor de oportunidades designado pela organização pode criar, corrigir e rever interpretações; quem tenha concessão explícita de confirmação pode confirmar a revisão exata, podendo ser a mesma pessoa. Uma confirmação humana consciente basta; **não se exige segunda pessoa, dupla aprovação ou ADMIN implícito**. Rever significa confrontar fonte e interpretação, não verificar factos organizacionais nem aprovar candidatura.

Reutilizar membership, resource loading, policy engine F5, CAS/idempotência, guard e F7 source-local. READ da oportunidade é pré-condição; grants existentes de editar oportunidade não passam automaticamente a permitir confirmar critérios. Propor capabilities finas de ler/editar/confirmar interpretações, tenant-local, a acrescentar de forma explícita aos catálogos F5 antes de implementar. Sessão válida e reautorização; assurance segue classificação explícita da operação, sem herdar MFA/SoD da aprovação de perfil F13 por analogia. Auditoria identifica autor, confirmador, tenant, revisão da oportunidade, revisão do conjunto e digests internos, sem copiar conteúdo confidencial.

Separar no modelo e no ecrã:

- **Fonte:** referência e trecho exato, versão/digest, proveniência e localização; não editável para simular alteração da fonte.
- **Interpretação:** tipo fechado C1/C2/C3, obrigatoriedade, conceito/release, condição temporal quando expressa e requisito de prova. Não há operadores livres.
- **Evidência da interpretação:** vínculo à cláusula e à referência governada que justifica cada escolha, com nota editorial sanitizada. Não confundir com futura evidência F13 de satisfação pela organização. Texto ambíguo pode ser guardado para revisão, mas não confirmado como critério determinístico.

Critérios **comuns** de uma oportunidade Central só podem ser mantidos pela autoridade editorial C4G; tenant não os altera. F12 possui boundary interno CATALOG_MAINTAINER/opportunity.central.manage, não uma UI humana de publicação comum de critérios. Esta proposta não amplia esse boundary nem usa o service actor como identidade do revisor humano. Authoring/publicação comum fica excluído do primeiro incremento.

Uma organização pode guardar a sua **interpretação privada** de uma revisão Central acessível, identificada como tal, sem a apresentar como condição oficial comum. Fonte Central e revisão permanecem exatas; armazenamento e auditoria da interpretação pertencem ao tenant. Interpretação de oportunidade privada pertence igualmente ao tenant. Não misturar silenciosamente conjuntos comuns e privados: futura avaliação fixa um conjunto e a sua autoridade; divergência exige revisão explícita, nunca sobrescrita do contrato comum. Esta opção permite uma entrega pequena e utilizável sem inventar governance Central nova.

### D3 — Ações humanas mínimas futuras

| Ação proposta | Significado e motivo |
|---|---|
| Solicitar informação | Registar quais os dados por esclarecer; não envia email nem inicia integração automaticamente |
| Manter em análise | Registar que a análise continua, sem aceitar elegibilidade |
| Descartar da análise | Decisão local com motivo obrigatório; não arquiva a oportunidade Central/privada nem declara inelegibilidade automática |

Compatíveis com a intervenção humana, rejeição e motivos de não relevância previstos em matching-and-qualification.md; os três rótulos e a sua operacionalização são escolhas novas para aprovação. Todas registam autoria, data, organização, motivo e evaluationId exato, separadamente e append-only. Uma nova decisão sucede à anterior sem a apagar. Não alteram resultado, critérios, evidência ou perfil; não criam candidatura. Implementação destas ações pertence à entrega da avaliação F14, não ao incremento de critérios.

### Revisões e rastreabilidade

Edição cria revisão de interpretação; confirmação fixa revisão da oportunidade, conjunto e evidência. Confirmar exige CAS sobre a revisão esperada e que a oportunidade ainda corresponda à revisão revista. Alteração de oportunidade, critério, conceito referenciado ou evidência exige nova revisão e confirmação; copiar conteúdo anterior não transporta confirmação. Não seguir URLs mutáveis como prova histórica: conservar trecho e identidade/digest da versão, respeitando F11 e autorização quando houver documento; não acrescentar binários à Central.

A interface mostra sempre “interpretação privada”, organização, oportunidade/revisão, versão do conjunto, estado de confirmação e fonte. Se a oportunidade mudar, mostrar “refere-se à revisão anterior — necessita revisão”; preservar leitura histórica, bloquear uso como conjunto atual. Uma avaliação posterior fixa todos esses IDs e snapshot/rule versions; resultados anteriores permanecem imutáveis e identificados como históricos, sem ser apresentados como atuais após mudança de inputs. Reavaliar gera novo resultado, nunca recalcula por trás do mesmo ID.

### Critérios de aceitação do primeiro incremento

1. No detalhe de oportunidade autorizado, editor cria os três critérios sintéticos, revê fonte/interpretação/evidência e confirma uma revisão exata; conjunto sem evidência, release válida ou semântica inequívoca não é confirmável. Sem necessidade de snapshot F13 para **editar critérios**.
2. Campos/tipos fechados; prioridade/afinidade não podem tornar-se obrigatórias por default. Nada executa SQL, scripts ou regra livre; autoria/tenant/policy resolvidos no servidor.
3. Separação de grants ler/editar/confirmar; mesma pessoa com grants adequados pode editar e confirmar. Sem concessão, sessão revogada ou contexto alterado: recusa sem efeito. A/B, IDOR e leitura de fonte F11 são testados com identidades distintas; uma segunda membership não removida para a mesma identidade é recusada pela Central.
4. Oportunidade Central não recebe mutações de tenant; interpretações privadas de A não aparecem em B nem mudam o contrato comum. UI identifica autoridade e não apresenta interpretação privada como fonte oficial.
5. CAS, idempotência, auditoria F7 e commit incerto: confirmação única; conflito exige releitura; ausência de receipt não prova rollback. Mudança da oportunidade ou evidência invalida utilização corrente da confirmação anterior, preservando história.
6. Fonte e interpretação mantidas separadas, com referências/digests internos reproduzíveis; erros e respostas não expõem material de outra organização, segredos ou digests restritos. UI cobre vazio, edição, revisão/confirmar, erro, conflito, troca A/B e teclado/foco.
7. Corpus documental fixa resultados futuros esperados e prova que ausência de verificação não é incumprimento. Nenhuma avaliação operacional, score ou promessa de elegibilidade aparece no primeiro incremento.

**Excluído:** engine F14, cálculo/persistência de avaliações, decisão humana sobre avaliações, score/ranking/pesos, candidaturas, fontes reais/conectores, authoring comum Central, DSL genérica, novas constraints/declarações negativas, baseline multidomínio, materialização e ativação. O consumo operacional futuro continua dependente de snapshot READY e tuple aprovados; D1–D2 da ativação temática não são aprovadas por esta proposta.

**Plano inicial, entretanto concretizado no contrato técnico acima:** implementar o percurso criar→rever→confirmar→consultar critérios no detalhe da oportunidade, com testes A/B/CAS/revisões e revisão humana. A proposta não autoriza implementação nesta tarefa. Não há pesos necessários nem valores produtivos inventados.
