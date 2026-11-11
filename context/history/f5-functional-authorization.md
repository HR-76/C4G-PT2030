# Trabalho Atual

## Identificação

- Nome: F5 — Autorização Funcional
- Tipo: Feature
- Estado: Complete
- Feature-mãe: Fundação de Segurança, Privacidade e Auditoria

## Objetivo

Definir a autorização funcional determinística e `deny-by-default` do produto multi-instituição. Cada operação deve ser decidida no servidor a partir da sessão validada, contexto organizacional F3, membership central ativa, perfil base versionado, grants positivos e âmbitos locais, relação/estado do recurso, separação de funções e assurance exigida, sem depender de roles UBI/Legacy, visibilidade no frontend, roles PostgreSQL ou dados fornecidos pelo caller.

## Problema e ameaça

F2 autentica, F3 prova membership e organização selecionada e F4 resolve tenant e compatibilidade técnica; nenhuma destas camadas concede permissão funcional. O piloto ainda usa `authorizeRoles("ADMIN")`, `ADMIN`/`PROFESSOR`, verificações ad hoc em controllers e decisões de UI. Se forem generalizados, podem causar privilégio implícito, IDOR/enumeração, fuga entre organizações, regras diferentes em API/jobs/reporting/exports/documentos e bypass de MFA, aprovação, suporte ou auditoria.

## Base normativa

### Decisões vinculativas

- Membership central ativa e contexto F3 validado são obrigatórios; autenticação, seleção de organização, `baseRoleCode` ou schema compatível não concedem permissão.
- Enforcement ocorre no servidor. A UI pode ocultar ações, mas não autoriza.
- Perfis base fornecem permission codes estáveis e versionados; controllers não interpretam roles diretamente.
- Grants do MVP são apenas positivos; ausência de permissão significa recusa e não existe `DENY` funcional.
- Scopes podem abranger organização, unidade, equipa e recurso; herança só existe se a permission code a declarar.
- Estado/relação do recurso, propriedade, aprovação, separação de funções e MFA são requisitos de domínio.
- MFA é executado pelo Keycloak. A aplicação usa evidência F2 validada/versionada; `c4g-loa2` exige também `amr` com `otp`, `auth_time` recente e versão reconhecida.
- Administradores C4G, administradores de organização e suporte exigem MFA. Papel C4G global não concede leitura de dados do cliente.
- Suporte é recusado por omissão e exige grant temporário com organização, operador, âmbito, motivo, aprovador, início, expiração, MFA e auditoria por uso; não renova automaticamente.
- Suspensão, arquivo, mudança de hierarquia ou revogação invalidam decisões/caches afetados; a Central prevalece sobre projeções locais atrasadas.
- API e worker recebem organização, tenant e operação técnica apenas de contexto/adaptadores internos; não há fallback Central, Legacy/UBI ou cross-tenant.
- Reporting, exports e documentos reaplicam as permissões da operação de origem.
- Auditoria/logs usam allowlist e minimização, sem tokens, segredos, SQL, documentos, payload integral ou PII desnecessária.

### Implementação observada

- F2 implementa sessão/OIDC, assurance, step-up, rotação, revogação e fail-closed; rollout real fica fora de F5.
- F3 implementa contexto com `organizationId`, `membershipId`, `membershipVersion` e `baseRoleCode`, e revalida elegibilidade. `baseRoleCode` permanece opaco.
- F4.1–F4.3 implementam diretório, resolver/leases, catálogo técnico, baseline e compatibilidade. O catálogo funcional produtivo está vazio; compatibilidade não autoriza.
- O Legacy usa JWT, `authorizeRoles`, `ADMIN`/`PROFESSOR` e checks dispersos. É evidência de migração, não política F5.
- Não existe policy engine funcional transversal, catálogo aprovado de permissions, perfis/grants gerais, suporte F5 nem auditoria append-only transversal.

### Inconsistência documental

`context/features/security-privacy-and-audit-foundation.md` continua em `Draft`, apesar de F2, F3 e F4.0–F4.3 estarem encerradas nos históricos. Esta ação não altera esse documento nem promove requisitos pendentes a decisões aprovadas.

## Dependências satisfeitas

- F1 — fundação de testes.
- F2 — identidade, sessão e contrato de MFA/assurance.
- F3 — membership e contexto organizacional.
- F4.0 — contrato de tenant/lifecycle.
- F4.1 — diretório Central.
- F4.2 — resolver, leases e pools sintéticos.
- F4.3 — schema, migrations, compatibilidade e preflight descartável.
- Arquitetura, modelo lógico e dicionário de dados futuros.

## Dependências e gates preservados

- F5-D1–F5-D17 foram aprovadas conjuntamente em 2026-10-08 segundo `context/research/f5-authorization-policy-decisions.md`; não resta decisão comportamental necessária para iniciar a implementação local.
- O benchmark do motor sem cache, com `TTL=0`, é gate de implementação. Um resultado insuficiente exige análise e nova decisão explícita; não autoriza introduzir cache silenciosamente.
- A revisão formal de segurança, arquitetura, testes e rastreabilidade dos 20 critérios é gate anterior ao fecho da feature.
- Cobertura nos canais reais e armazenamento append-only são gates de integração futura. A F5 entrega ports, adapters comuns e doubles, sem alegar essas integrações como operacionais.
- Entradas funcionais produtivas futuras terão de ser aprovadas pelas respetivas features e ligar operação, permission, policy, schemas, limites e testes. O bootstrap F5 permanece vazio.
- F4.4/F4.5, worker/fila, R2, auditoria transversal e rollout não impedem a implementação sintética, mas impedem declarar operação produtiva ou integração real coberta.

## Âmbito

- Catálogo imutável, versionado e validado de permission codes e operações autorizáveis.
- Perfis base por membership e grants positivos a membro, perfil, unidade ou equipa com scope explícito.
- Policy engine determinístico, injetável e `deny-by-default`, com decisão estruturada e reason code.
- Revalidação F3 antes da policy local e antes do recurso.
- Resolução controlada de unidades, equipas, participação/propriedade, grants, estado e herança permitida.
- Separação de funções e requisitos de aprovação.
- Ações sensíveis ligadas a categorias versionadas de MFA/assurance recente.
- Suporte C4G temporário, aprovado e limitado, sem privilégio global implícito.
- Revogação e invalidação de decisões/caches.
- Contrato único para API, jobs, reporting, exports e documentos.
- Eventos de autorização allowlisted e sanitizados, sem implementar ainda o ledger append-only completo.
- Testes locais/descartáveis com pelo menos duas organizações e dados sintéticos.
- Inventário futuro das rotas Legacy a migrar, sem as adaptar nesta ação.

## Critérios de aceitação

1. **F5-AC-01 — catálogo:** testes de startup aceitam catálogo imutável/versionado e recusam duplicados, entradas incompletas, permissions desconhecidas, schemas inválidos, combinações incoerentes e mutação pós-publicação.
2. **F5-AC-02 — recusa antecipada:** operação desconhecida, permission ausente ou policy não registada falha sanitizada antes de repository funcional, lease ou query.
3. **F5-AC-03 — fronteira F3:** contexto ausente/adulterado/expirado ou utilizador, organização ou membership inativos são recusados; membership de outra organização não satisfaz a decisão.
4. **F5-AC-04 — isolamento:** matriz A/B prova recusa de leitura, lista, pesquisa, escrita, arquivo, download e export cross-tenant, mesmo com ID válido, sem query ao tenant B nem fallback.
5. **F5-AC-05 — perfis mínimos:** tabela de testes prova que cada perfil concede exatamente a versão aprovada, nunca por label/role, e sem grants implícitos fora do scope.
6. **F5-AC-06 — scopes:** fixtures cobrem organização, unidade, equipa e recurso, incluindo fora de scope, multi-unidade, equipa inativa e IDs coincidentes entre organizações.
7. **F5-AC-07 — precedência:** mesma entrada/versões produz a mesma decisão/reason code; testes cobrem todas as regras aprovadas e a ausência de `DENY`.
8. **F5-AC-08 — SoD:** todas as incompatibilidades aprovadas recusam autoaprovação e exigem intervenientes distintos, elegíveis e no scope correto.
9. **F5-AC-09 — MFA recente:** categoria sensível recusa evidência ausente, expirada, ambígua, de outra versão, ACR insuficiente ou AMR sem `otp`; usa apenas F2/Keycloak.
10. **F5-AC-10 — suporte:** recusa grant sem organização, scope, motivo, ticket, aprovação, MFA, vigência ou expiração, bem como futuro, expirado, revogado, autoaprovado ou fora do scope; uso permitido emite evento esperado.
11. **F5-AC-11 — revogação/cache:** relógio/cache controlados provam que suspensão/remoção, mudança de perfil/grant/hierarquia, revogação de suporte e troca de organização inutilizam decisão anterior segundo a semântica aprovada.
12. **F5-AC-12 — IDOR/enumeração:** IDs inexistentes ou de outra organização produzem resposta pública uniforme, não revelam existência/ownership e não acedem ao recurso.
13. **F5-AC-13 — canais:** a mesma matriz via API, job, reporting, export e documento produz decisão equivalente; retry/replay preserva organização, ator, permission e scope.
14. **F5-AC-14 — auditoria:** eventos administrativos, recusas relevantes e suporte contêm apenas ator, organização, ação, recurso/scope mínimos, resultado, reason, versões e correlação allowlisted; testes excluem dados proibidos.
15. **F5-AC-15 — matriz multi-tenant:** suite cobre positivos/negativos com duas organizações, múltiplas memberships/perfis, unidades, equipas, recursos, estados, troca de organização e concorrência.
16. **F5-AC-16 — input fechado:** campos extra são recusados e caller não escolhe SQL, tabela, query module, permission, policy, access mode, tenant, scope calculado ou resultado.
17. **F5-AC-17 — fail-closed:** sessão, membership, tenant, catálogo, policy, scope, assurance, cache ou auditoria crítica indisponíveis/inválidos causam recusa e nenhum efeito.
18. **F5-AC-18 — independência:** suite passa só com identidades, organizações, recursos, relógio, auditoria e dados sintéticos/descartáveis, sem F4.4, UBI, fornecedores ou bases persistentes.
19. **F5-AC-19 — sem fallback Legacy:** testes/inspeção provam que `ADMIN`, `PROFESSOR`, JWT Legacy, `platformRoles`, UI ou roles PostgreSQL não concedem autorização F5.
20. **F5-AC-20 — recurso:** adaptador resolve recurso e `organizationId` por repository interno; mismatch/ausência falha fechado sem confiar em ownership do caller e antes do efeito.

## Restrições

- Não confundir autenticação, membership, tenant/schema ou role PostgreSQL com autorização.
- Não aceitar do cliente/job livre permission, policy, scope, ownership, tenant, operação técnica ou SQL.
- Não introduzir `DENY`; restrições vêm de ausência de grant, estado, relação, SoD, MFA ou aprovação.
- Não interpretar `baseRoleCode` diretamente em controllers.
- F5 v1 não mantém cache de decisões, grants ou perfis (`TTL=0`); versões autoritativas são verificadas em cada pedido e qualquer estado desconhecido/obsoleto falha fechado.
- Administrador C4G não obtém acesso implícito a dados cliente.
- Não criar caminhos UBI nem universalizar `ADMIN`/`PROFESSOR`.
- Preservar versões, histórico e evidência, sem dados sensíveis em logs/eventos.
- O `load` não autoriza código, migration, branch, fornecedor ou ambiente persistente.

## Fora do âmbito

- F4.4 e provisioning/onboarding/offboarding reais; F4.5 e migração/adaptação UBI.
- Funcionalidades completas do MVP e UI final de administração.
- Rollout/configuração real de Keycloak/Central, produção ou secret manager.
- Retenção jurídica, legal hold e eliminação física, salvo enforcement futuro de decisão aprovada.
- Auditoria append-only, SIEM e alerting completos.
- Worker/fila/outbox/inbox, R2, uploads e reconciliação completos; apenas contratos/doubles F5.
- Migrations ou acesso a bases persistentes; dados reais.
- SSO/SCIM, novos deployments, quotas, licenciamento e billing. O único benchmark incluído é o gate local do motor com `TTL=0`.

## Plano de testes

- Unitários de catálogo, schemas, imutabilidade, policy, scopes, precedência, SoD, assurance, reason codes e sanitização.
- Matriz de perfis/grants/recursos/estados com fixtures de duas organizações e utilizador multi-membership.
- Doubles instrumentados de repositories, tenant runtime, relógio, versões autoritativas, auditoria, jobs, reporting, exports e documentos para provar ordem e ausência de acesso após recusa.
- Negativos de IDOR, enumeração, adulteração, concorrência, troca de organização, revogação e cache obsoleto.
- Contratos equivalentes HTTP/não HTTP; nenhum enforcement baseado em UI.
- Nenhuma base ou migration: todo estado F5 é fornecido por ports e doubles locais em memória.
- Validação futura: `node --check`, testes F5, regressões F2–F4.3, `npm test`, build frontend se afetado e `git diff --check`.

## Decisões aprovadas

F5-D1–F5-D17 foram aprovadas como contrato único. A fundamentação, alternativas e taxonomia completa permanecem em `context/research/f5-authorization-policy-decisions.md`.

1. **F5-D1 — permission codes:** o catálogo produtivo bootstrap é imutável/versionado e vazio, `permissions: []`. Não há operação funcional produtiva na F5 v1; `synthetic_resource.read` e `synthetic_resource.update` existem apenas em fixtures não produtivas. Wildcards e fallback Legacy/UBI são proibidos.
2. **F5-D2 — perfis base:** `ORG_ADMIN`, `FUNDING_MANAGER`, `CONTRIBUTOR` e `VIEWER` existem estruturalmente e com versão, todos com zero permissions produtivas. Perfil vazio é válido e concede zero acesso funcional.
3. **F5-D3 — scopes/herança:** os tipos futuros fechados são `ORGANIZATION`, `UNIT`, `UNIT_SUBTREE`, `TEAM` e `RESOURCE`. Não há herança implícita; cada permission futura declara scopes/herança admitidos e o recurso é sempre resolvido internamente.
4. **F5-D4 — composição/precedência:** só existem grants positivos. A união dos grants aplicáveis é subordinada, por ordem fail-closed, a membership/contexto, catálogo/operação, scope, recurso/estado/relação, SoD, aprovação e assurance; ausência, desconhecido ou conflito não resolvido recusa.
5. **F5-D5 — SoD:** uma matriz versionada proíbe autoaprovação e exige atores distintos e elegíveis para concessão/revogação privilegiada, alterações de perfil/SoD, suporte e ações sensíveis que requeiram aprovação.
6. **F5-D6 — ações sensíveis:** o catálogo versionado cobre alterações de grants/perfis/SoD, suporte, exports/documentos sensíveis e futuras ações que a feature de domínio classifique. O bootstrap não cria operações produtivas.
7. **F5-D7 — MFA:** `RECENT_MFA` usa exclusivamente evidência F2/Keycloak reconhecida, `c4g-loa2`, `amr=otp` e `auth_time` com freshness máxima de 300 segundos.
8. **F5-D8 — autoridades:** concessão e revogação obedecem a autoridade explícita por organização/scope e SoD; permissões privilegiadas exigem intervenientes distintos quando a matriz assim determinar. Nenhuma role global concede acesso a dados cliente.
9. **F5-D9 — suporte:** acesso C4G é nominativo, recusado por omissão e explicitamente concedido, com organização, operador, scope, ticket opaco, motivo, aprovações organizacional e C4G distintas, MFA e auditoria.
10. **F5-D10 — duração:** suporte começa até 24 horas após aprovação, dura no máximo quatro horas, não renova automaticamente e não admite break-glass no MVP; novo período exige nova concessão e aprovações.
11. **F5-D11 — revogação:** versões autoritativas de membership, perfil, grants, hierarquia, SoD e suporte são revalidadas e a revogação produz efeito no pedido seguinte; estado ausente ou obsoleto recusa.
12. **F5-D12 — cache:** F5 v1 não usa cache de decisões, grants ou perfis (`TTL=0`). O benchmark sem cache é gate de implementação, não decisão aberta.
13. **F5-D13 — auditoria:** a F5 usa `AuditPort` e doubles, sem alegar ledger append-only. As quatro classes fechadas são: eventos críticos aceites antes do efeito, sob pena de abortar; eventos posteriores a deny cuja falha nunca converte deny em allow; eventos observacionais reconciliáveis; e capacidades de ledger/retention/replay deliberadamente fora da F5.
14. **F5-D14 — múltiplas memberships:** apenas a membership selecionada e revalidada no contexto F3 participa; perfis/grants nunca são unidos entre organizações.
15. **F5-D15 — jobs/service actors:** jobs humanos revalidam membership; jobs sistémicos usam service actor interno allowlisted com organização e operação fixas. Retry/replay preserva ator originador, organização, operação e scope sem ampliação.
16. **F5-D16 — suspensão/offboarding:** bloqueiam autorização funcional e jobs associados; só um catálogo operacional futuro, separado e explicitamente allowlisted, poderá conter exceções.
17. **F5-D17 — entrega:** a F5 entrega engine, ports, adapters comuns e vertical slice sintética. Integração em canais reais e armazenamento append-only permanecem gates futuros.

Nenhuma destas decisões declara comportamento implementado. O contrato aprovado não autoriza permission codes ou grants produtivos, migrations, dados persistentes, adaptação UBI, rollout ou infraestrutura.

## Plano técnico

### 1. Contratos e catálogos imutáveis

- **Existente afetado:** usar como padrões `backend/src/security/tenantOperationCatalog.js`, `backend/src/security/authConfig.js` e a validação de manifests, sem alterar o catálogo técnico F4.3.
- **Novos módulos previstos:** `backend/src/authorization/permissionCatalog.js`, `baseProfileCatalog.js`, `scopeCatalog.js` e `authorizationErrors.js`.
- **Interfaces/ports:** construtores fechados que validam, congelam e expõem versões; catálogo produtivo exato `permissions: []`; catálogo sintético injetável apenas por testes.
- **Dependências e cobertura:** nenhuma infraestrutura externa; cobre F5-AC-01, 02, 05, 16, 17 e 19.
- **Testes focados:** startup válido/vazio, duplicados, wildcard, mutação, permission/operação desconhecida, perfis vazios e rejeição de códigos sintéticos em composição produtiva.
- **Riscos/invariantes:** não reutilizar roles/actions Legacy, não introduzir operação produtiva e nunca transformar perfil estrutural em grant implícito.

### 2. Subject, actor, scopes e snapshot autorizativo

- **Existente afetado:** integrar por interfaces com `backend/src/security/membershipRepository.js`, `organizationSession.js`, `sessionAuth.js` e `backend/src/middlewares/organizationContext.js`; não interpretar `baseRoleCode` nos consumidores.
- **Novos módulos previstos:** `authorizationSubject.js`, `authorizationActor.js`, `scopeModel.js`, `grantModel.js` e `authorizationSnapshot.js`.
- **Interfaces/ports:** `MembershipEligibilityPort` revalida F3; `AuthorizationDataPort` fornece perfis, grants positivos, hierarquia, SoD, suporte e versões autoritativas. A primeira implementação é um double em memória, sem schema ou migration.
- **Dependências e cobertura:** sessão F2 e contexto F3; cobre F5-AC-03, 05, 06, 11, 15, 16 e 18.
- **Testes focados:** membership inativa/cruzada, multi-membership, troca de organização, scopes fechados, IDs coincidentes A/B e versões obsoletas.
- **Riscos/invariantes:** organização e membership vêm do contexto validado; scope calculado, grants e versões nunca vêm do caller.

### 3. Policy engine e autorização sobre recurso carregado

- **Existente afetado:** aproveitar o padrão de orquestração fail-closed de `tenantResolver.js` e `tenantLeaseExecutor.js`, sem acoplar autorização funcional a lease/schema compatível.
- **Novos módulos previstos:** `authorizationPolicyEngine.js`, `authorizationService.js`, `authorizationDecision.js` e `resourceAuthorizationPort.js`.
- **Interfaces/ports:** o adapter escolhe uma operação registada; o resource port resolve internamente recurso, organização, estado e relações; só depois o engine avalia grants e gates e devolve decisão/reason code estruturados.
- **Dependências e cobertura:** etapas 1–2; cobre F5-AC-02, 04, 06, 07, 12, 16, 17 e 20.
- **Testes focados:** tabelas determinísticas, spy de zero acesso após recusa antecipada, IDOR/enumeração, mismatch A/B, recurso inexistente e mudança de versão antes do efeito.
- **Riscos/invariantes:** deny-by-default, resposta pública uniforme, nenhuma query ao tenant errado e nenhuma confiança em IDs/ownership fornecidos pelo caller.

### 4. SoD e assurance/MFA

- **Existente afetado:** adaptar apenas os contratos de `backend/src/security/assurance.js` e `authConfig.js`; não contactar Keycloak real.
- **Novos módulos previstos:** `sodPolicyCatalog.js`, `sodEvaluator.js`, `sensitiveActionCatalog.js` e `assuranceAuthorizationAdapter.js`.
- **Interfaces/ports:** catálogo SoD versionado e adapter que traduz evidência F2 validada para `RECENT_MFA`, com janela fixa de 300 segundos.
- **Dependências e cobertura:** decisão de policy e relógio injetável; cobre F5-AC-07, 08, 09 e 17.
- **Testes focados:** autoaprovação, atores inelegíveis, ACR/AMR/version/freshness inválidos, fronteiras 299/300/301 segundos e ação não sensível.
- **Riscos/invariantes:** autorização não valida tokens nem inventa MFA; evidência ambígua/ausente falha fechado.

### 5. Suporte temporário e administração privilegiada

- **Existente afetado:** reutilizar tipos de ator/contexto e relógios controláveis das fixtures F2/F3, sem UI ou persistence.
- **Novos módulos previstos:** `supportAccessPolicy.js`, `supportAccessGrant.js` e `supportAccessPort.js`.
- **Interfaces/ports:** port autoritativo para concessão, revogação e versão; double local modela ticket opaco, motivo, scope, duas aprovações, início, expiração e estado.
- **Dependências e cobertura:** SoD, `RECENT_MFA`, audit port crítico e versões; cobre F5-AC-08, 09, 10, 11, 14 e 17.
- **Testes focados:** início além de 24 horas, duração acima de quatro horas, falta/igualdade de aprovadores, uso antes/depois da janela, scope errado, revogação e tentativa de renovação/break-glass.
- **Riscos/invariantes:** suporte nunca deriva de papel C4G e nenhum uso ocorre antes da aceitação do evento crítico.

### 6. Port e taxonomia de auditoria

- **Existente afetado:** alinhar reason codes/correlação com os contratos de segurança existentes; não integrar armazenamento definitivo.
- **Novos módulos previstos:** `auditEventCatalog.js`, `auditEventSanitizer.js`, `auditPort.js` e `authorizationAudit.js`.
- **Interfaces/ports:** `AuditPort.accept(event)` devolve `ACCEPTED`, `REJECTED`, erro ou timeout; catálogo associa cada evento a uma das quatro classes aprovadas. Double controlável regista chamadas e simula todos os resultados.
- **Dependências e cobertura:** chamadas explícitas do policy engine, suporte, administração, jobs, exports e documentos; cobre F5-AC-10, 13, 14, 17 e 18.
- **Testes focados:** critical-before-effect, timeout/rejeição, deny que permanece deny, observacional reconciliável, allowlist/redação e ausência de tokens, SQL, payload, conteúdo, ticket ou PII desnecessária.
- **Riscos/invariantes:** falha de auditoria nunca concede acesso; eventos críticos abortam antes do efeito; ledger, retenção e replay persistente ficam fora.

### 7. Actors de serviço e adapters comuns de canal

- **Existente afetado:** identificar pontos futuros em `backend/src/routes/`, jobs, services e fluxos de documentos/reporting/export apenas para contratos; não adaptar rotas Legacy nesta feature.
- **Novos módulos previstos:** `serviceActorCatalog.js` e adapters `apiAuthorizationAdapter.js`, `jobAuthorizationAdapter.js`, `reportAuthorizationAdapter.js`, `exportAuthorizationAdapter.js` e `documentAuthorizationAdapter.js`.
- **Interfaces/ports:** envelope interno fechado contém organização/operação/actor/correlação; jobs humanos revalidam membership e service actors usam bindings fixos. Todos chamam a mesma `AuthorizationService`.
- **Dependências e cobertura:** etapas 1–6; cobre F5-AC-03, 04, 13, 15, 16, 17, 19 e 20.
- **Testes focados:** suite de contrato idêntica nos cinco adapters, replay sem ampliação, actor/operação adulterados, suspensão/offboarding e export/documento A/B.
- **Riscos/invariantes:** adapters não implementam policy própria; não existe bypass não HTTP nem integração real alegada.

### 8. Vertical slice e fixtures exclusivamente sintéticas

- **Existente afetado:** estender `backend/test/support/fixtures.js`, `doubles.js` e `tenantRuntimeDoubles.js`, preservando os testes F2–F4.3.
- **Novos módulos previstos:** fixtures F5 para duas organizações, memberships, unidades, equipas, recursos, grants e os códigos não produtivos `synthetic_resource.read`/`synthetic_resource.update`.
- **Interfaces/ports:** doubles em memória para authorization data, recursos, suporte, auditoria, jobs e canais; relógio manual e barreiras de concorrência.
- **Dependências e cobertura:** todas as etapas anteriores; cobre os 20 critérios, com ênfase em F5-AC-04, 12, 13, 15, 18 e 20.
- **Testes focados:** matriz positiva/negativa A/B, IDOR, concorrência, troca de contexto, revogação no pedido seguinte e falhas injetadas em cada port.
- **Riscos/invariantes:** dados e códigos sintéticos nunca entram na composição produtiva; nenhum PostgreSQL, Keycloak, R2 ou serviço autenticado.

### 9. Métricas sanitizadas e benchmark `TTL=0`

- **Existente afetado:** seguir os padrões de observabilidade sanitizada do backend, sem adicionar labels de alta cardinalidade.
- **Novos módulos previstos:** `authorizationMetricsPort.js`, double de métricas e `backend/scripts/benchmarkF5Authorization.js` ou teste de benchmark equivalente.
- **Interfaces/ports:** métricas allowlisted por resultado/reason/categoria, sem tenant, utilizador ou recurso; workload reproduzível mede latência/throughput do engine sem cache.
- **Dependências e cobertura:** engine completo e fixtures sintéticas; cobre F5-AC-11, 14, 15, 17 e 18.
- **Testes focados:** allowlist de labels, ausência de dados sensíveis, prova estrutural de `TTL=0`, baseline documentada e execução repetível.
- **Riscos/invariantes:** benchmark é gate, não licença para cache; resultado insuficiente volta a decisão arquitetural humana.

### 10. Composição, regressão e safety scans

- **Existente afetado:** `backend/src/productionComposition.js` apenas para validar/compor o bootstrap vazio e ports necessários, sem ligar F5 às rotas Legacy; `backend/package.json` apenas se for necessário expor comandos de teste/benchmark.
- **Novos módulos previstos:** testes de composição/import safety e scans dirigidos ao namespace F5.
- **Interfaces/ports:** composição produtiva injeta catálogos vazios e falha startup perante contrato inválido; integrações persistentes permanecem ports sem implementação produtiva.
- **Dependências e cobertura:** etapas 1–9; cobre F5-AC-01, 02, 17, 18 e 19 e fecha a rastreabilidade global.
- **Testes focados:** regressões F2–F4.3, `npm test`, `node --check` dos JavaScript alterados e scans por wildcard, fallback Legacy/UBI, role checks, bypasses, permission/scope vindos do caller e dados sensíveis.
- **Riscos/invariantes:** `Ready` não significa iniciado; não criar migrations, permission/grant produtivos, UI, rollout ou infraestrutura.

## Matriz de validação dos critérios

| Critério | Evidência planeada |
|---|---|
| F5-AC-01 | Unitários e teste de startup do catálogo vazio/versionado, imutabilidade, duplicados e schemas inválidos. |
| F5-AC-02 | Teste de contrato com spies prova recusa antes de resource port, repository, lease ou query. |
| F5-AC-03 | Testes adversariais de sessão/contexto/membership ausentes, inativos, expirados, adulterados e cross-org. |
| F5-AC-04 | Matriz A/B para read/list/search/write/archive/download/export e asserção de zero acesso ao tenant B. |
| F5-AC-05 | Snapshot exato dos quatro perfis produtivos vazios e matriz sintética sem grants implícitos. |
| F5-AC-06 | Tabela de scopes fechados com organização, unidade, subtree, equipa, recurso, inatividade e IDs coincidentes. |
| F5-AC-07 | Testes tabelados repetíveis da ordem de gates, união positiva, ausência de `DENY` e reason codes. |
| F5-AC-08 | Matriz SoD de autoaprovação, atores repetidos/inelegíveis e scopes divergentes. |
| F5-AC-09 | Testes de adapter F2 para ACR, AMR, versão e relógio nas fronteiras da janela de 300 segundos. |
| F5-AC-10 | Testes temporais e de campos/aprovações do suporte, incluindo uso auditado, expiração e revogação. |
| F5-AC-11 | Testes com versões/relógio provam efeito no pedido seguinte, `TTL=0` e ausência estrutural de cache; benchmark obrigatório. |
| F5-AC-12 | Casos IDOR de IDs externos/inexistentes com resposta uniforme e spies de nenhum acesso indevido. |
| F5-AC-13 | Suite de contrato comum executada nos adapters API, job, reporting, export e documento, incluindo replay. |
| F5-AC-14 | Testes das quatro classes de auditoria, allowlist/redação, timeout/rejeição e reconciliação observacional. |
| F5-AC-15 | Fixtures A/B multi-membership, perfis, scopes, recursos, estados, troca de organização e concorrência controlada. |
| F5-AC-16 | Fuzz/contract tests recusam campos extra e injeção de permission, policy, scope, tenant, SQL ou infraestrutura. |
| F5-AC-17 | Fault matrix de cada port prova fail-closed e ausência de efeito, incluindo auditoria crítica. |
| F5-AC-18 | Testes offline passam só com dados/doubles em memória e verificam ausência de bases, fornecedores e F4.4/F4.5. |
| F5-AC-19 | Scans/import tests no namespace F5 e composição provam ausência de wildcard, UBI/Legacy, UI e roles PostgreSQL. |
| F5-AC-20 | Testes do resource port provam carga interna, verificação de organização/versão e recusa antes do efeito. |

## Gates de execução e fecho

1. **Implementação local:** módulos e testes acima completos; 20 critérios rastreados; `node --check`, testes F5 e regressões F2–F4.3 verdes; scans limpos; benchmark `TTL=0` executado e revisto; zero migrations, bases, códigos/grants produtivos ou serviços reais.
2. **Revisão formal:** revisão conjunta de segurança, arquitetura, isolamento, IDOR/SoD/MFA, taxonomia de auditoria, métricas, resultados do benchmark e diff integral antes de mover para `Review`/`Done`.
3. **Integração futura:** cada feature/canal real prova uso do adapter comum; persistência autoritativa, worker/fila, auditoria append-only, Keycloak/Central e rollout recebem gates próprios. Estes pontos não bloqueiam iniciar a implementação local, mas bloqueiam alegar cobertura operacional.

## Estado de readiness

- Estado documental: `Ready`, não iniciado e sem implementação.
- Aprovação normativa: F5-D1–F5-D17 aprovadas conjuntamente em 2026-10-08, conforme `context/research/f5-authorization-policy-decisions.md`.
- Bloqueios resolvidos: catálogo/perfis/scopes, precedência, SoD, MFA, autoridades, suporte, revogação, cache, auditoria, memberships, jobs, suspensão e fronteira da entrega.
- Não resta decisão material necessária para iniciar a implementação local sintética. Os gates de implementação, revisão e integração futura acima permanecem obrigatórios.

## Implementação entregue

- Catálogos produtivos de permissions e operações permanecem exatamente vazios; os quatro perfis estruturais existem com zero permissions.
- Catálogos fechados, versionados e imutáveis validam permissions, perfis, scopes, operações e eventos no startup da composição produtiva.
- Policy engine único e `deny-by-default` avalia membership/contexto, versões autoritativas, grants positivos, scope, recurso carregado internamente, estado, SoD, MFA e suporte.
- Adapters comuns cobrem API, jobs, reporting, exports e documentos; service actors têm organização/operação fixas.
- Auditoria implementa port/double, allowlist sanitizada e quatro classes; eventos críticos abortam antes do efeito e falhas de deny nunca concedem acesso.
- Métricas aceitam apenas resultado, reason code e categoria, sem labels por tenant, utilizador ou recurso.
- Toda a prova funcional usa apenas `synthetic_resource.read` e `synthetic_resource.update`, dados e ports em memória.
- A composição produtiva valida o bootstrap vazio, sem ativar F5 nas rotas Legacy nem criar autorização funcional produtiva.

## Validação executada

- `npm run test:f5`: 23/23 testes aprovados, cobrindo F5-AC-01–F5-AC-20.
- `npm test`: 368/368 testes backend aprovados, incluindo regressões F2–F4.3.
- `npm run benchmark:f5`: 10 000 decisões, `TTL=0`, 50,015 ms, 199 939,22 operações/s no workload sintético local.
- `node --check`: todos os módulos, fixtures, testes, benchmark e composição JavaScript alterados aprovados.
- Scans dirigidos: nenhum fallback Legacy/UBI, wildcard, connection string, acesso a base, SQL, secret ou label sensível no namespace F5.
- `git diff --check`: aprovado.
- Frontend não foi alterado; build frontend não aplicável.
- Nenhuma migration ou base foi contactada pela implementação F5.

## Revisão formal

- Revisão inicial encontrou dois findings: MFA não obrigatório para suporte sobre permission não sensível e ausência de evento crítico específico para job/export/documento.
- Correção em lote aplicada: suporte exige sempre `RECENT_MFA`; grants de suporte são fechados; operações internas vinculam eventos por canal; falha crítica aborta antes do efeito.
- Revisão pós-correção: sem findings acionáveis de correção, segurança, arquitetura, performance, testes ou scope.
- Veredicto: `ready to close`.

## Limitações preservadas

- Não existem permission codes, grants, operações ou dados funcionais produtivos.
- Não existem persistence, migrations, UI administrativa, binding Central→tenant, integração Keycloak real ou adaptação UBI.
- Integração nos canais reais e armazenamento append-only permanecem gates das features/infraestruturas futuras.

## Referências

- `AGENTS.md`; `context/project-overview.md`; `context/architecture.md`; `context/coding-standards.md`.
- `context/features/` (todas as especificações existentes, em especial `security-privacy-and-audit-foundation.md`).
- `context/decisions/` (sessão, logout degradado, modelo futuro, hosting, MFA, identidade multi-tenant, cookie/CSRF e lifecycle tenant).
- `context/references/logical-data-dictionary.md`; `context/references/current-implementation.md`.
- Históricos F2, F3, F4.0, F4.1, F4.2 e F4.3 em `context/history/`.
- `backend/src/middlewares/authMiddleware.js`; `backend/src/middlewares/organizationContext.js`.
- `backend/src/security/assurance.js`; `authConfig.js`; `membershipRepository.js`; `sessionAuth.js`; `sessionRegistry.js`; `tenantOperationCatalog.js`; `tenantResolver.js`; `tenantLeaseExecutor.js`.
- `backend/src/productionComposition.js`; `backend/src/routes/`; `backend/src/controllers/`; `backend/src/services/`; `frontend/src/contexts/AuthContext.jsx`; `frontend/src/App.jsx`.
