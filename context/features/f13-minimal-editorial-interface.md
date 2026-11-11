# F13 — Interface editorial mínima

Estado: **Complete — fecho humano restrito aprovado em 2026-10-15**, abrangendo a interface editorial mínima e a extensão **Central 010**. D1–D3 aprovadas; **B1 resolvido**. F13 integral permanece **In Progress**. Central 009 e F13/016 mantêm os respetivos fechos. Contrato base: [publicação editorial](f13-editorial-baseline-publication.md).

## Fecho humano restrito — 2026-10-15

Decisão humana explícita de GO restrito, após revisão final read-only **PASS**, sem findings materiais. O âmbito fechado entrega authoring temático, submissão da revisão, completude do recorte editorial, MFA com nova confirmação, aprovação, publicação imutável e inativa, leitura autorizada e recuperação de intenções. Inclui o lookup limitado da Central 010, com bindings de autoridade, privilégios mínimos, admissão e up/down verificados. Ausência de receipt permanece UNKNOWN; confirmação exige prova correlacionada. A composição disponibiliza o percurso com configuração válida e falha fechada quando incompleta.

A conferência anterior ao fecho documental confirmou **722 hashes de código e 21 artefactos**, sem divergência nem código adicional no recorte. Evidência preservada: [README dos testes, gates e browser](../reviews/f13-editorial-b1/README.md). HEAD da evidência: `0cf519ea22de929d2e52d0b3edb4d72364aa6220`. Manifestos SHA-256:

- `tested-snapshot.json`: `97ddee42e409070c27b57cd5254754dae1a8e6bfa09a4e39e02d3c432b5009d2`.
- `artifact-hashes.json`: `27303d1bb2473414f7c3ccb96ed4b57623d7763a4757681348ff201a92de8e87`.

Resultados aceites: **775/775 backend**, **37/37 frontend**, build, instalação/upgrade/downgrade e consumidores Central, HTTP editorial A/B com quatro outcomes, regressão editorial e gates cumulativos F12/UBI PASS. Browser Chrome comprovou authoring, submissão, checker, MFA com nova confirmação, aprovação, publicação inativa/leitura, perda de resposta, reload/recuperação, troca A/B e logout. A revisão confrontou contrato, diff, código, hashes, fingerprints e prova visual; não repetiu suites sem lacuna concreta.

Limitações mantidas: validação local com PostgreSQL descartável e IdP simulado com tokens assinados; staging, produção, IdP externo, dados institucionais reais e SLO não validados. Sem auditoria WCAG integral nem ensaio separado de zoom 200%. O fecho não inclui snapshot READY, ativação ou consumo F14; a baseline temática não é suficiente para matching.

**Próxima etapa proposta:** especificar a ativação e o contrato de consumo do perfil, com requisitos próprios de elegibilidade, completude e autorização. Esta etapa não está iniciada nem aprovada para implementação por este fecho.

Os registos de implementação, bloqueio e revisão abaixo, assim como a evidência histórica, descrevem os respetivos momentos anteriores e são preservados. O estado vigente deste incremento é Complete no âmbito restrito acima.

## Decisões aprovadas e âmbito

- **D1:** entrada “Perfil da organização”, imediatamente após Oportunidades no menu operacional; três modelos de ecrã: índice, rascunho/pré-visualização e detalhe candidatura/versão. Perfil pessoal permanece separado.
- **D2:** adapters HTTP seguros, consultas autorizadas e digests mantidos no servidor. Authoring exclusivamente temático ORG, descoberta, labels de releases exatas e contexto de decisão.
- **D3:** recuperação pela idempotência existente; envelope mínimo em sessionStorage. Sem conteúdo, digests ou tokens de autenticação/MFA/decisão persistidos no browser.

Estas decisões substituem a proposta inicial de transmitir digests ao checker e guardar expectedDigest. Prefixo HTTP, campos, paginação, token e limites de reconsulta seguintes são detalhes técnicos desta concretização, não novas decisões de produto.

Fora do âmbito: ativação, snapshot READY, consumo F14/matching, overlays, administração de policies/catálogos, migração UBI, redesenho geral e domínios não temáticos. Não alterar migrations fechadas, histórico ou residual legacy. Publicação permanece imutável e inativa; aprovação editorial não é verificação factual.

## Evidência e mecanismos reutilizados

| Código inspecionado | Reutilização / limite real |
|---|---|
| authoringContracts.js, authoringRepository.js, authoringComposition.js | createDraft aceita draftId UUID fornecido pelo caller; editDraft exige expectedRevision; itens têm itemId/itemVersionId/domain/knowledgeStatus/conceptId. Operações já existem, falta HTTP. Composição com competencyMaterial preserva membros excluídos ao criar nova revisão. |
| editorialContracts.js, editorialRepository.js, editorialComposition.js | submit/approve/publish/readCandidate/readVersion já existem; submit exige revisão, approve/publish digests esperados. GET candidate permanece SUBMITTED; não fornece ligação à versão. Receipts e completion atuais contêm digests: não podem passar diretamente para a UI. |
| editorialSource.js, taxonomyRepository.js | Conceitos têm release/scheme e concept_label; resolver editorial exige release publicada e referência admissível. Não existe a consulta UI paginada aqui contratada. |
| authorityCoordinator.js | Guard durável contém subject_id, organization_id, protected_operations com resourceId, key, intention_digest e source binding. recover/recoverExpired são ports operacionais root-only; tokens de guard são objetos em WeakMap, não tokens HTTP. |
| tenantAuthorityRecovery.js | Valida binding físico, obtém nonce lock da transação original, observa idempotência source-local e prova COMMITTED/ROLLED_BACK. Ausência de receipt só é prova depois de demonstrar terminação dessa transação. |
| editorialComposition.js / authoringComposition.js | COMMIT_UNCERTAIN já chama reconcile, reautoriza e procura o resultado. Não criar fila, novo protocolo ou ledger de recuperação. |
| sessionSecurity.js, organizationalProfile/canonicalization.js, digests.js | Padrões de HMAC separado por finalidade, canonicalização e comparação constante reutilizáveis. Não reutilizar segredos/tokens de CSRF ou permissões finais do guard. Upload capability é persistida e não serve este caso. |
| oidcAuthRoutes.js / oidcAuthController.js | GET /api/auth/step-up existe. Categoria configurável, returnTo local seguro, callback revalida identidade/assurance. Falta ligação frontend. |
| AuthContext, api.js, Layout, Header, Sidebar, OrganizationSelector, PrivateOpportunities | Cookies/CSRF, troca server-side de organização, remount e descarte de respostas tardias reutilizáveis. Seletor atual depende de F12 e redireciona para /oportunidades; precisa adaptação delimitada. |

Paths backend são relativos a backend/src/organizationalProfile ou backend/src/security, exceto controllers/routes explicitados. Leituras, descoberta, consulta de intenção e projeção de elegibilidade são capacidades novas; não simples montagem dos cinco endpoints existentes.

## Navegação e percurso

Rotas frontend: /perfil-organizacao (índice com Rascunhos/Candidaturas editoriais/Versões), /perfil-organizacao/rascunhos/:id (formulário e pré-visualização), /perfil-organizacao/candidaturas/:id e /perfil-organizacao/versoes/:id (mesmo modelo de detalhe). “Candidatura editorial” distingue-se de candidatura a financiamento.

Percurso utilizável: criar draft ORG → selecionar conceitos/UNKNOWN explícito → guardar → reler revisão → submeter essa revisão → mostrar completion/motivos → checker distinto abre candidatura exata → MFA quando necessário → nova consulta e confirmação → aprovar → publicar com grant próprio → ler “Publicada — inativa. Não disponível para matching”.

Submissão INCOMPLETE é permitida; aprovação não. Draft submetido não é editável: correção exige novo draft. Sem clone automático. Nome da organização sempre visível, inclusive mobile/confirmação. Sem organização confirmada, nenhuma consulta de recursos.

## Contrato HTTP adicional V1

**Todas as rotas U abaixo são novas, para implementar**, U = /api/organization-profile/editorial-ui. As cinco rotas /api/organization-profile/editorial permanecem compatíveis; a UI usa U e não consome os seus payloads brutos. Nenhuma rota decision-context separada: contexto acompanha o GET de detalhe.

Regras comuns: sessão server-side OIDC, organização resolvida pelo servidor, READ = organization_profile.read; grants nunca inferidos de ADMIN. Todas as rotas U exigem READ (incluindo authoring nesta UI) e membership atual. POST/PUT exigem CSRF; GET sem body. JSON fechado, campos desconhecidos recusados; UUIDs e revisão conforme validadores existentes; limite 256 KiB. Nunca aceitar tenant, actor, policy, scope, autoria ou digests do caller. Cache-Control: no-store; não registar payloads, tokens, conteúdo ou chaves em URLs/logs. Contexto não substitui autorização na escrita.

Tipos de resposta fechados:

- **Ref:** {conceptId,schemeId,releaseId,releaseVersion}; sem digest, proprietário interno ou provenance.
- **Item:** {itemId,itemVersionId,domain,knowledgeStatus,conceptRef,label,labelLocale,factualStatus}. domain THEMATIC_AREA|STRATEGIC_PRIORITY; UNKNOWN implica conceptRef/label/labelLocale=null, não vazio inferido. factualStatus=UNVERIFIED. Ref/labels de KNOWN vêm da referência exata.
- **Coverage:** {includedDomains:[THEMATIC_AREA,STRATEGIC_PRIORITY],scopeType:ORGANIZATION,constraintsAssessed:false,effectiveSnapshot:false,f14Consumable:false}. Aviso textual de exclusões é fixo, sem contagens de material excluído.
- **Completion:** {result:COMPLETE|INCOMPLETE,findings:[{code,domain,itemId,severity}]}; domain/itemId nullable quando não aplicável; severity ERROR|INFO. Allowlist de codes: REQUIRED_SLOT_MISSING, KNOWN_REQUIRED, INVALID_CARDINALITY, DUPLICATE_CONCEPT, UNKNOWN_EXPLICIT, STATE_NOT_ALLOWED, REFERENCE_INCOMPATIBLE, NON_CURRENT_MATERIAL. Não devolver policy/refs internas/completionDigest; código interno desconhecido falha projeção com 503, não gera COMPLETE.
- **Action:** {operation,status,reason,concurrencyToken,expiresAt}. operation CREATE|EDIT|SUBMIT|APPROVE|PUBLISH; status AVAILABLE|MFA_REQUIRED|BLOCKED; reason null ou NOT_AUTHORIZED|AUTHOR_OR_SUBMITTER|INCOMPLETE|STATE_CONFLICT|APPROVAL_STALE|REFERENCE_UNAVAILABLE. Token/expiresAt null exceto APPROVE/PUBLISH AVAILABLE. Motivo específico só após READ e avaliação segura; caso contrário NOT_AUTHORIZED. Nunca nomes/IDs de autores. Se apenas MFA impedir uma operação de outro modo elegível: MFA_REQUIRED.
- **Receipt:** união das respostas de mutação abaixo; sem context/actions nem digests. GET posterior atualiza contexto. Receipt confirmado não se torna falha da mutação se a releitura falhar.

| Rota | Request exato (campos ? opcionais) | Resposta de sucesso | Autorização adicional / erros específicos |
|---|---|---|---|
| GET U/context | Sem query | 200 {enabled:true,organization:{id,name},canCreateDraft:boolean,mfa:{category,stepUpPath:"/api/auth/step-up"}} | READ; canCreateDraft avaliado com draft.create; runtime ausente 503 |
| POST U/drafts | {draftId,items,idempotencyKey} | 201 {draftId,revision,lifecycle:DRAFT} | draft.create; conflito ID/key 409 |
| PUT U/drafts/:id | {expectedRevision,items,idempotencyKey} | 200 {draftId,revision,lifecycle:DRAFT} | draft.edit; CAS/lifecycle/key 409 |
| GET U/drafts/:id | Sem query | 200 {draftId,revision,lifecycle,items:Item[],coverage:Coverage,actions:Action[]} | READ; ações EDIT/SUBMIT; conteúdo exclusivamente temático |
| GET U/drafts | {limit?,cursor?} | 200 Page de {draftId,revision,lifecycle} | READ por recurso; apenas scope ORG |
| GET U/candidates | {limit?,cursor?} | 200 Page de {candidateId,state:SUBMITTED,completionResult,versionId} | READ; versionId null se não existir ou não for legível |
| GET U/versions | {limit?,cursor?} | 200 Page de {versionId,state:APPROVED|PUBLISHED,active:false} | READ |
| GET U/catalog | {domain,releaseId?,locale?,limit?,cursor?} | 200 Page de {conceptRef:Ref,label,labelLocale} | READ; domínio temático; conceitos globais ou da organização, publicados e admissíveis |
| GET U/candidates/:id | Sem query | 200 {candidateId,state:SUBMITTED,sourceRevision,versionId,items:Item[],coverage:Coverage,completion:Completion,actions:Action[]} | READ; ação APPROVE avaliada com approve, SoD, MFA e integridade |
| GET U/versions/:id | Sem query | 200 {versionId,candidateId,state:APPROVED|PUBLISHED,active:false,items:Item[],coverage:Coverage,completion:Completion,actions:Action[]} | READ; ação PUBLISH avaliada com publish, SoD, MFA e aprovação válida |
| POST U/drafts/:id/submit | {expectedRevision,idempotencyKey} | 201 {candidateId,sourceRevision,coverage:Coverage,completion:Completion} | submit; revisão/lifecycle/key 409 |
| POST U/candidates/:id/approve | {concurrencyToken,idempotencyKey} | 201 {versionId,state:APPROVED} | approve, SoD, MFA, COMPLETE; token/estado/key 409 |
| POST U/versions/:id/publish | {concurrencyToken,idempotencyKey} | 200 {versionId,state:PUBLISHED,active:false} | publish, SoD, MFA, aprovação válida até commit; token/estado/key 409 |
| POST U/intentions/lookup | {operation,resourceId,idempotencyKey,expectedRevision?} | 200 Outcome definido abaixo | READ + binding ao sujeito original; não permite executar/repetir mutações |

Items de escrita mantêm exatamente o contrato interno: {itemId,itemVersionId,domain,knowledgeStatus,conceptId}; máximo 100, UUIDs únicos. KNOWN exige conceptId; UNKNOWN exige null. Frontend fixa draftId e IDs novos uma vez por intenção; alteração de item cria itemVersionId novo, preservando itemId. Item inalterado conserva ambos. Adapter passa scopeId=null na criação; revisão e materialExtension vêm do servidor. Não aceitar listas de membros excluídos nem substituir essas listas por vazio. Guardar formulário envia conjunto temático completo; não patch arbitrário do draft integral.

Catálogo: locale default pt-PT; label PREFERRED desse locale ou do defaultLocale da MESMA release, devolvendo labelLocale real; sem tradução inferida. Sem releaseId, listar explicitamente referências elegíveis de todas as releases autorizadas, nunca escolher "latest" em nome do utilizador. ConceptId já fixa a release; seleção não muda a policy. GETs de detalhe resolvem labels na referência persistida; label ausente/ambígua ou referência incompatível produz 503 REFERENCE_UNAVAILABLE, sem confirmação baseada em UUIDs.

Paginação comum: Page={items,nextCursor}; limit default 20, intervalo 1..100. Sem totals, facetas ou contagens globais. Ordem crescente por UUID do recurso (catálogo por releaseId,conceptId), keyset; não prometer ordenação cronológica. Cursor autenticado, opaco para o cliente, vinculado ao subject/organização/rota/filtros/locale, expira em 10 minutos e não inclui digests restritos. Filtrar/autorização ANTES de aplicar limite e calcular nextCursor, reavaliando em cada página. Inserções/alterações entre páginas não constituem snapshot; refresh reinicia. Cursor inválido ou expirado: 400 INVALID_CURSOR. Sem permissão READ: 403, não lista vazia.

Erros comuns, envelope exato {error:{code},correlationId}; sem stack, SQL, JSON interno ou valores recebidos. Todos os endpoints podem devolver 400 INVALID_INPUT, 401 SESSION_REQUIRED, 403 NOT_AUTHORIZED, 404 RESOURCE_NOT_AVAILABLE, 503 SERVICE_UNAVAILABLE. IDs inexistentes/foreign têm 404 uniforme após admissão; falta de permissão não revela existência. Catálogo não autorizado usa a mesma regra. Erros específicos: 409 STALE_REVISION, STATE_CONFLICT, IDEMPOTENCY_CONFLICT, COMPLETION_INCOMPLETE, APPROVAL_STALE, REFERENCE_INCOMPATIBLE, CONCURRENCY_TOKEN_INVALID, CONCURRENCY_TOKEN_EXPIRED; mapeamento sanitizado dos F13_* existentes. Apenas validação temporal autenticada permite EXPIRED; adulteração e binding inválido usam INVALID. 503 em escrita é conservadoramente resultado incerto. Um 4xx de retry não prova rollback de tentativa anterior. Limites operacionais podem devolver 429 com Retry-After; nunca retry automático de mutação.

Step-up **existente**: GET /api/auth/step-up?category=<category de context>&returnTo=<rota local segura>, navegação de topo OIDC. Não criar endpoint de MFA nem formulário OTP. Retorno: reler sessão, organização e detalhe, renovar CSRF, obter token novo e exigir confirmação explícita. Falha/cancelamento/identidade diferente nunca executam ação.

## Token opaco de concorrência

Novo helper stateless no processo API, não serviço nem tabela. Reutiliza node:crypto (HMAC-SHA-256/timingSafeEqual), canonicalize e relógio injetável; não reutiliza tokens WeakMap do guard nem capability persistida de upload. Chave privada dedicada à finalidade UI, provisionada por configuração de segredo; nunca em documento/cliente. Réplicas partilham key ring com kid; manter chave anterior pelo máximo TTL, ou invalidar tokens e exigir nova leitura. Não usar session secret, CSRF secret ou permitSecret diretamente.

Wire: v1.kid.iat.exp.nonce.mac, base64url canónico e comprimentos limitados; nonce aleatório de 128 bits. MAC cobre canonical({purpose:"F13_EDITORIAL_UI_CONCURRENCY_V1",kid,iat,exp,nonce,subjectId,organizationId,operation,resourceId,expectedDigest}). Apenas tempos/nonce/kid/MAC saem do servidor; o payload com digest NÃO é serializado no token, nem em JWT legível. expectedDigest é candidateDigest ou versionDigest carregado/verificado internamente. Nenhum dado restrito recuperável do token.

Emissão integrada no GET autorizado do recurso imutável, após conferir integridade, READ e elegibilidade da ação. TTL 5 minutos, iat/exp em segundos UTC inteiros, exp=iat+300. Validação exige formato fechado, chave conhecida, MAC constante correto com sujeito/org atuais, operação e ID do path, tempo válido (iat<=now<exp). No instante exato exp, recusar. Valor ausente, data inválida ou clock incoerente nunca prolonga validade. TTL é limite de confirmação, não lease de autorização: não altera o deadline do guard nem renova MFA/aprovação.

Na ação, resolver autoridade e recurso novamente, validar token, traduzir para o expectedDigest interno e chamar a composição existente. Sem "latest", substituição do ID ou recomputação de intenção para outro recurso. Corrupção/incompatibilidade recusa. Token não concede acesso, não dispensa MFA/SoD e não impede reavaliação final do guard.

Renovar: novo GET do MESMO recurso; novo token, mesma key e mesmo comando interno. Remover token/iat/nonce da canonicalização da intenção antes de chamar o domínio, preservando o protocolo existente. Recursos imutáveis permitem a renovação sem mudar expectedDigest. Se o efeito já ocorreu, usar lookup/receipt e não exigir que GET apresente uma ação novamente disponível. Token apenas em memória; não em URL, sessionStorage, analytics ou logs.

## Recuperação de intenções

Operações suportadas: CREATE_DRAFT, EDIT_DRAFT, SUBMIT, APPROVE, PUBLISH. Mapeamento interno: PROFILE_DRAFT_CREATE/PROFILE_DRAFT_EDIT e EDITORIAL_SUBMIT/EDITORIAL_APPROVE/EDITORIAL_PUBLISH. resourceId é draftId nas três primeiras, candidateId em APPROVE, versionId em PUBLISH. expectedRevision obrigatório em EDIT_DRAFT/SUBMIT, proibido nas restantes. Criação fixa draftId no cliente: confirmado em validateCreate, sem alterar domínio.

Envelope sessionStorage por aba: {userId,organizationId,operation,resourceId,idempotencyKey,expectedRevision?}. Só IDs e revisão, nunca formulário, conceitos, digests ou tokens. Associação pública userId é validada contra a sessão; sujeito humano real é resolvido no servidor. Escrever envelope ANTES de enviar. Remover quando resultado terminal foi apresentado, logout ou sessão expirada detetada. Fechar aba pode perder envelope; nenhuma promessa de recuperação de formulário não guardado. Sem persistência além da sessão no browser.

Lookup é nova projeção root-composta, não acesso funcional ao coordenador. Reautorizar READ, validar sujeito original em authority_commit_guard, organização, sourceOperation, key e protected_operations.resourceId. Não basta conhecer key ou encontrar uma linha de idempotência. Associar receipt source-local ao intention_digest desse guard e ao recurso; em EDIT/SUBMIT confirmar também revisão (reconstrução interna/histórico), sem devolver digest. Verificar todas as tentativas conhecidas da mesma intenção; conflitos de bindings/receipts recusam conclusão. Não alargar grants de runtime para acesso livre à Central ou recovery operacional.

Outcome fechado: {status,receipt,reason,retryAfterSeconds,correlationId}. receipt só não-null em CONFIRMED; retryAfterSeconds=null exceto RESOLVING; reason conforme tabela. Esta leitura de receipt exige READ e autoria da intenção, não MFA atual ou grant de escrita; **reexecutar** continua a exigir autorização completa. Um utilizador revogado não recebe resultado; suporte operacional resolve internamente sem expor dados ao utilizador. Key sem binding ao sujeito/recurso pedido não revela existência: UNKNOWN, nunca receipt de outra pessoa.

| status | Evidência necessária | reason / efeito UI |
|---|---|---|
| CONFIRMED | Receipt transacional source-local com intenção/binding verificados; guard terminal COMMITTED (reconciliar se necessário) e referência ao efeito | reason=null; receipt sanitizado; desbloquear após apresentar confirmação |
| FAILED_FINAL | Prova terminal de rollback/ABORTED ou RECOVERED/ROLLED_BACK da tentativa vinculada, sem receipt/efeito e sem tentativa conhecida ainda ativa; não inferir pelo timeout | reason=ROLLED_BACK; reler recurso antes de nova confirmação |
| RESOLVING | Guard vinculado PREPARED/TENANT_COMMIT_UNKNOWN ou recuperação identificada ainda não terminal | reason=TRANSACTION_PENDING; retryAfterSeconds=5 |
| UNKNOWN | Não há guard/receipt vinculável, não é possível provar terminação, binding mudou ou fonte está indisponível | reason=NO_CONCLUSIVE_EVIDENCE; retryAfterSeconds=null; sem sucesso nem rollback presumidos |

FAILED_FINAL refere-se às tentativas comprovadamente terminadas, não autoriza esquecer requests ainda em voo. Antes de nova gravação, cessar retries, resolver requests pendentes, reler recurso e verificar ausência de guards conflitantes. Persistência ausente não prova que um request atrasado nunca chegará. Repetição conserva key/payload; CAS e IDs fixos continuam obrigatórios. Resposta original de validação recusada antes de execução pode encerrar aquela tentativa local, mas lookup sem evidência durável mantém UNKNOWN; não fabricar um registo de falha.

Lookup não cria guard nem evento funcional de negócio. Usa locks/ordem existentes e observação coordenada; não chama recover enquanto segura locks tenant que a recuperação necessita. Quando apropriado, solicita ao port root existente recover do guard identificado, em orçamento limitado, e relê. Nunca aceita guardId, PID, nonce, source binding ou comando operacional fornecido pelo browser.

Reconsulta automática: no máximo 3 leituras após 2, 5 e 10 segundos, respeitando Retry-After e orçamento total de 30 segundos; relógio/timers injetáveis. Não fazer polling em background ou aba oculta. Depois: mostrar estado incerto, referência de suporte correlationId, “Voltar a consultar” (uma consulta limitada) e orientação para suporte técnico. Não iniciar MFA durante mutação incerta.

Saída operacional: suporte autorizado usa a correlação para localizar guards/binding nos registos existentes; executar recover/recoverExpired root-only com createTenantAuthorityRecovery, que valida a origem e prova terminação pelo nonce lock antes de observar receipt. A terminação de transação expirada, quando necessária, continua limitada ao mecanismo existente PID+backend_start+nonce; nunca comando vindo da UI. Se não houver prova, investigar disponibilidade/binding e tráfego pendente; não marcar FAILED_FINAL manualmente. O utilizador pode continuar leituras e trabalhar noutros recursos independentes, mas não nova gravação potencialmente conflitante no recurso/linhagem pendente. Não existe “forçar sucesso”, “esquecer e repetir” ou nova key para ultrapassar incerteza.

Após reload de CREATE/EDIT, não há payload original para replay: lookup e releitura apenas. Payload ainda em memória pode repetir com mesma key/IDs. SUBMIT recupera revisão; APPROVE/PUBLISH renovam token para mesmo recurso quando continuam elegíveis. Sem efeito confirmado e sem prova de rollback, nenhuma nova intenção. Após logout/perda da aba, redescoberta e verificação server-side de guards pendentes do recurso/linhagem precedem novas gravações; projeção de ações bloqueia conflito conhecido. Nova composição deve impedir escrita conflitante com guard pendente, reutilizando coordenação existente, e nunca tratar ausência de envelope como prova de conclusão.

## Integração frontend e apresentação

- Cliente Axios existente, cookies e CSRF. Capturar recibo antes da releitura; “Ação confirmada; consulta indisponível” se GET falhar. Nunca sucesso otimista.
- Troca de organização: bloquear botões imediatamente, desmontar conteúdo/formulários/receipts/tokens/actions e invalidar cache por utilizador+organização; cancelar/ignorar respostas antigas com generation key. Só carregar B após POST organization e GET session confirmados. Se seleção falhar, não restaurar dados de A automaticamente.
- Envelope de A fica isolado/inativo durante B; regressar a A exige sessão confirmada e lookup. Não reenviar em B. Revalidar sessão ao recuperar foco e antes da confirmação; rotação noutra aba invalida contexto. Guard/tenant binding continuam proteção final.
- Reload: mostrar loading sem dados anteriores, confirmar identidade/org, recuperar apenas envelopes correspondentes e consultar resultado. Logout/401 limpa envelope e memória; login posterior não autoexecuta pedidos.
- MFA: categoria vem de U/context, returnTo seguro sem token/key; depois callback nova consulta e confirmação, sem POST automático. Rotação de sessão não equivale a nova intenção.
- Duplo clique: mutex síncrono além de disabled; key por intenção. 409 exige releitura e nova confirmação, não alteração automática de expectedRevision/token com reenvio.
- Loading com aria-busy; vazio só após resposta autorizada vazia; 403/404 uniformes, 401 sessão expirada, erro com ação de reconsulta. UNKNOWN é “Desconhecimento declarado”, distinto de não preenchido, zero, negação ou ausência de constraints.
- Completion apenas “Recorte editorial completo/incompleto”, findings traduzidos; não “Perfil completo”. Mostrar “Não verificado factualmente” e “Publicada — inativa”. Ações omitidas/bloqueadas não concedem autoridade.
- Autor/submissor: “Não pode aprovar/publicar porque participou no conteúdo ou na submissão. É necessária outra pessoa autorizada.” Só com motivo seguro confirmado; recusa genérica não é diagnosticada como MFA.
- Checker pode aprovar e publicar com grants distintos e MFA; READ é independente. Authoring usa draft.create/edit; submissão submit; aprovação approve; publicação publish, todos organization_profile.*.
- Reutilizar EmptyStatePanel, ToastProvider e padrões PrivateOpportunities; confirmação inline preferida. Se modal, corrigir role/dialog, aria-modal, trap/Escape e reposição de foco. Labels associados, teclado completo, foco visível/erros/título, role=alert/status; informação permanente não depende de toast/cor. 320 px e zoom 200%, sem overflow de ações.

## Critérios de aceitação verificáveis

| ID | Prova necessária |
|---|---|
| UI-01 | Navegação D1 e seletor sem dependência F12; organização visível; zero consultas de dados antes de contexto confirmado; regressão das páginas existentes. |
| UI-02 | Allowlist de respostas/erros/receipts/lookup/catalog/cursors: nenhum source/editorial/candidate/version/completion/release digest, autoria, policy, evidência F5, stack ou material excluído. Testar payload bruto de rede, não só DOM; token não contém payload legível restrito. |
| UI-03 | Listas/nextCursor só recursos READ autorizados, sem totais; filtros antes do limite; cursor A→B/outro sujeito adulterado/expirado recusado. IDOR uniforme. |
| UI-04 | KNOWN aponta para release exata e label persistida, fallback só defaultLocale dessa release; ausência/ambiguidade bloqueia; UNKNOWN explícito distinto de ausência; sem taxonomia UBI inferida. |
| UI-05 | Criar com draftId fixado, guardar/editar via UI real, reler revisão e submeter; UUIDs repetidos/payload divergente recusados. Draft misto: comparar membros não temáticos antes/depois, sem alteração/exposição. |
| UI-06 | Tokens adulterados, outro subject/org/operação/recurso, kid desconhecido, datas inválidas, exp exato/antes/depois; relógio controlado. Renovação gera mesmo comando/intention_digest interno e um só efeito, sem persistir token no browser. |
| UI-07 | Maker multi-editor/submissor impedidos mesmo noutra sessão do mesmo humano; checker autorizado aprova e publica apenas com ambos grants; READ distinto. MFA ausente/expirado, cancelamento/identidade diferente e retorno sem execução automática. |
| UI-08 | Revogação de sessão/membership/grant e expiração de approval entre autorização/commit recusam; incluir memberships relevantes e prova temporal F13/016, sem mudar fecho. |
| UI-09 | Rede perdida antes/depois do commit, COMMIT incerto, rollback F7, guard ativo, receipt ausente e restart: quatro Outcomes sustentados pela evidência correta. Nenhuma ausência isolada produz FAILED_FINAL. Lookup foreign key/sujeito não revela dados. |
| UI-10 | Duplo clique/CAS/concorrência/retry mesma key e token renovado: um efeito/F7; perda de payload de CREATE/EDIT não recria gravação. Polling termina e suporte usa recovery existente; não há nova escrita conflitante enquanto incerto. |
| UI-11 | A→B durante requests/reload/retorno MFA/outra aba; resposta tardia descartada; logout limpa armazenamento; nenhum envelope de A executado em B. |
| UI-12 | COMPLETE/INCOMPLETE e motivos, UNVERIFIED, PUBLISHED active=false; sem READY/ativação/F14; sucesso do receipt separado de erro de releitura. |
| UI-13 | Teclado, labels, foco, alert/status, estados loading/vazio/erro/negado/expirado, confirmação acessível, mobile 320 px e zoom 200%. |

Testes de componente: Vitest/Testing Library existentes; promises e timers controlados. Integração: PostgreSQL Central/A/B descartável, authoring real e maker/submissor/checker distintos; usar harness browser existente sem pressupostos UBI. Percurso final deve criar, editar, submeter incompleto/completo, rever com outra pessoa, fazer step-up, aprovar, publicar e ler inativo, incluindo recuperação e troca A/B. Fixtures não substituem authoring utilizável. Executar build frontend, testes direcionados backend e gates afetados na implementação; evidência local não valida staging/produção/IdP externo/dados institucionais reais.

## Entregas e dependências

1. Projeções seguras, authoring HTTP, catálogo/listagens e GETs com actions; testes de isolamento/labels/preservação e chave dedicada de concorrência.
2. Adapters de ações/token e lookup/recovery root-composto com quatro outcomes; testar PostgreSQL, guard, F7, idempotência e saída operacional antes de UI de escrita.
3. Navegação/seletor, índice e draft/submissão; depois detalhe checker, step-up, aprovação/publicação/leitura, recuperação e acessibilidade. Terminar num percurso completo entre utilizadores, não em ecrãs com IDs ou fixtures manuais.
4. Testes integrados A/B, regressões afetadas e revisão read-only; só então propor fecho desta entrega UI.

Dependências reais: runtime OIDC/editorial configurado; conceitos/labels publicados autorizados (catálogo vazio não é preenchido automaticamente); chave dedicada partilhada entre réplicas; implementação de novas consultas/projeções e port root de lookup ligado ao coordenador. Grants mínimos de leitura de labels/consultas devem ser verificados contra ACL/RLS reais; nenhuma permissão ampla ou alteração retroativa de migration 016. Qualquer necessidade comprovada de migration adicional requer desenho próprio, não está presumida aqui.

Na aprovação dos contratos não havia decisão de produto pendente. A afirmação inicial de ausência de bloqueio técnico foi superada pela execução abaixo. Ausência de catálogo/configuração impede o percurso nesse ambiente e deve ser reportada como dependência, não simulada.

## Registo de implementação e bloqueio — 2026-10-15

Código parcial: adapters/projeções, helper stateless de tokens/cursor, composição preparada sobre authoring/editorial existentes, lookup conservador, frontend dos três ecrãs e envelope de recuperação. O frontend compila; isso não comprova o percurso completo. A aplicação mantém U em 503 SERVICE_UNAVAILABLE sem a composição admitida; não há fallback para queries diretas ou APIs legacy. Nenhuma migration ou contrato F13/016 foi alterado.

**B1 — extensão de protocolo Central não prevista na especificação inicial.** authorityProtocolQueries.js admite SQL por allowlist; authority_api.execute na migration Central 009 contém as queries e o fingerprint de segurança fecha a função/ACLs. A consulta por organization_id + subject_id + idempotency_key + sourceOperation necessária ao lookup não existe nesse protocolo. É recusada com AUTHORITY_QUERY_DENIED / SQLSTATE 42501 antes de SQL arbitrário chegar à Central. O gate UI real chega a POST intentions/lookup e recebe 503. As consultas de guards pendentes foram adaptadas às queries existentes; não resolvem descoberta de guards já terminados depois de reload.

Não é falta de Docker, de segredo ou de catálogos de teste. Docker 29.7.2 e PostgreSQL 17 descartável disponíveis; fixtures têm referências e labels publicadas e chave efémera em memória. O código não admite uma consulta livre à Central nem alarga grants para contornar a recusa. Esta fronteira exige contrato técnico aditivo próprio, como previsto na cláusula de migrations adicionais acima; não é uma nova decisão D1–D3.

Desenho mínimo para desbloquear (ainda não implementado): port root-only de observação de intenções, com binding obrigatório org/sujeito/operação/key e limite 100 (+ sentinela); parâmetros exclusivamente da sessão/contrato validado; sem query arbitrária, DML ou novos privilégios de tabela para runtime. Migration Central posterior a 009 deve estender de forma aditiva a função de protocolo, preservar todas as queries anteriores, ter down que restaure a função anterior, atualizar manifestos/checksums e fingerprints calculados em PostgreSQL descartável, testar ACL/transitividade e admissão fail-closed em instalações antigas. Não reescrever 009 ou tenant 016. A ligação da composição UI ao bootstrap fica dependente dessa capability/admissão. Autorizar uma consulta no JavaScript sem a migration correspondente não resolve o bloqueio.

Particularidade adicional comprovada: createDraft protege PROFILE_SCOPE com resourceId=organizationId no guard, não draftId. Receipt vinculado permite confirmar a criação; sem payload/receipt não é possível provar a identidade do draft/revisão só a partir do hash da intenção. Nesses casos o lookup mantém UNKNOWN, nunca FAILED_FINAL por inferência. Não foi alterado o domínio para fabricar essa prova.

Resultados efetivos, comandos e hashes: [evidência desta execução](../reviews/f13-minimal-editorial-ui/README.md). A prova HTTP local cobre criar/editar/submeter/aprovar/publicar inativo em A/B, recusa IDOR e replay com token renovado; o gate integral falha no lookup. O browser editorial maker/checker, step-up real, matriz completa de revogação/recuperação, acessibilidade e restantes negativos novos continuam pendentes. Provas do domínio fechado e regressões UBI não substituem essas provas. Veredicto da entrega UI: **BLOCKED**, sem fecho humano.

## Extensão técnica B1 autorizada — Central 010

A autorização humana desta entrega permite a extensão aditiva `010_editorial_intention_lookup`. Preserva 009 e tenant 016. Operação interna: `intentionLookupQuery`, exclusivamente através de `authority_api.execute`, código SHA-256 do SQL exato; nenhuma entrada SQL livre, tabela nova ou grant direto adicional. O login dedicado e a admissão por manifest/fingerprint permanecem obrigatórios.

Parâmetros ordenados: organização e stable human subject da autoridade autenticada, chave idempotente validada, sourceOperation numa lista fechada de cinco operações, resourceId protegido. Na criação este último é organizationId (PROFILE_SCOPE); nas outras operações é o recurso solicitado. A composição exige READ atual antes da consulta e valida novamente autoridade antes de devolver um receipt. Browser não escolhe sujeito, organização ou guardId.

Resultado interno limitado a 100 tentativas + sentinela: guard_id, protected_operations, intention_digest, deadline, source_binding, state e reconciliation_result. O digest/binding permanece no servidor, apenas para correlacionar prova transacional. A consulta filtra os cinco bindings antes de devolver linhas. Zero linhas, overflow ou provas incompatíveis produzem UNKNOWN, sem indicar existência alheia. CREATE/EDIT/SUBMIT sem receipt correlacionável não permitem inferir recurso/revisão a partir do hash e permanecem UNKNOWN. Não há equivalência entre ausência de informação e rollback.

Up substitui exclusivamente a função fechada preservando todas as operações anteriores; down restaura exatamente o corpo e ACLs de 009. A aplicação atual exige o fingerprint de 010 na admissão de autoridade; a inspeção de downgrade verifica o fingerprint próprio de 009. Instalação antiga falha fechada até migração compatível.

Composição: `PROFILE_EDITORIAL_RUNTIME=f13-editorial`, OIDC e configuração F4 existente, com `PROFILE_EDITORIAL_UI_KEY_ID` e `PROFILE_EDITORIAL_UI_KEYS_JSON` dedicados. O JSON é um mapa kid→segredo com mínimo 32 bytes por chave; fornecer por configuração secreta, partilhada entre réplicas. Configuração ausente/inválida recusa o arranque com `EDITORIAL_UI_KEY_NOT_CONFIGURED`, sem ecoar valores. Nenhum segredo de exemplo é fornecido. Esta validação não dispensa admissão Central/tenant, memberships, catálogos publicados ou MFA.

Esta secção concretiza a extensão técnica autorizada; não reabre D1–D3 nem o fecho F13/016. Evidência desta continuação: `context/reviews/f13-editorial-b1/`.

## Resultado da continuação B1 — 2026-10-15

**READY_FOR_HUMAN_REVIEW**. Central 010 resolve o lookup fechado e a composição ativa disponibiliza os três ecrãs com configuração válida. Backend 775/775, frontend 37/37, build, migração/admissão/consumidores Central, HTTP A/B com quatro outcomes, regressão editorial e gate cumulativo F12/UBI passaram. Chrome comprovou authoring, submissão, checker, step-up assinado com nova confirmação, aprovação, publicação inativa/leitura, perda de resposta, reload/recovery, troca A/B e logout. Resultados, hashes, comandos, reprodução e limites na [evidência final](../reviews/f13-editorial-b1/README.md). Registos de bloqueio anteriores são históricos. F13/016 permanece fechado; F13 integral In Progress; sem fecho humano da interface.
