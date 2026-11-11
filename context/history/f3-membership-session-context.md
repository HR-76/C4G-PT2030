# Trabalho Atual

## Feature e estado

- Feature-mãe: Fundação de Segurança, Privacidade e Auditoria.
- Fase ativa: F3 — Membership e contexto organizacional.
- Tipo: implementação funcional e validação.
- Estado: Complete — implementação funcional e correção HTTP integradas em `main` pelo PR #8, no merge commit `0153bf1a368f07ea0282ff09b29384b39112d30b`. `SEC-AC-05` e `SEC-AC-06` permanecem `partial`: a cobertura automatizada e os gates PostgreSQL descartáveis passaram, mas não existe ainda evidência de rollout em staging ou produção.
- Especificação: `context/features/security-privacy-and-audit-foundation.md`.

## Objetivo

Introduzir a organização ativa e a membership central como fonte de verdade de cada pedido autenticado, permitindo selecionar e trocar de organização sem conservar contexto da anterior e fazendo com que suspensão, remoção ou revogação crítica bloqueiem imediatamente novos pedidos e invalidem as sessões afetadas.

F3 estabelece contexto central validado. Não resolve ainda a ligação à base física do tenant (F4), permissões funcionais (F5), projeções assíncronas completas (F9) nem auditoria transversal definitiva (F6).

## Critérios de aceitação

### SEC-AC-05 — revogação de membership

- Uma membership `SUSPENDED` ou `REMOVED`, uma organização não `ACTIVE` ou um utilizador não `ACTIVE` bloqueia o pedido antes de qualquer operação de negócio.
- Suspender/remover uma membership incrementa `membership_version` na mesma transação central; qualquer contexto anterior deixa imediatamente de satisfazer a validação tenant.
- Ao observar contexto obsoleto, o lifecycle roda para uma nova sessão global sem organização; falha parcial destrói a nova sessão e nunca mantém acesso tenant.
- Contextos/cache de membership não sobrevivem à versão ou estado revogados.
- Os testes provam efeito imediato no pedido posterior à revogação, preservação da autenticação global e não afetação de outra membership.

### SEC-AC-06 — seleção e troca de organização

- A lista de organizações elegíveis contém apenas organizações `ACTIVE` com membership `ACTIVE` e dentro da validade temporal.
- Selecionar uma organização sem membership ativa é recusado e não altera a sessão.
- Uma troca válida roda o SID, invalida o SID anterior, emite nova prova CSRF e substitui atomicamente o contexto organizacional.
- Depois da troca, nenhum dado, cache, membership ou contexto de autorização da organização anterior permanece utilizável.
- `organization_id` e `membership_id` usados pelo servidor vêm exclusivamente da sessão/contexto validado, nunca de headers, query, body ou outro input livre.
- Testes com duas organizações demonstram troca válida e recusas para organização inexistente, suspensa, removida, expirada ou pertencente a outro utilizador.

## Contrato funcional aprovado

- `GET /api/auth/organizations`: devolve as organizações que o utilizador autenticado pode selecionar, com identificadores e apresentação mínimos; nunca devolve ligações de base ou configuração interna.
- `POST /api/auth/organization`: recebe o identificador pretendido, exige Origin e CSRF, revalida utilizador, organização e membership na base central e roda a sessão quando a seleção é válida.
- `GET /api/auth/session`: passa a devolver utilizador e, quando existente, o contexto organizacional validado.
- Quando existir exatamente uma membership elegível, a organização é selecionada automaticamente; com várias, o utilizador escolhe explicitamente; com zero, mantém apenas autenticação global sem acesso tenant.
- Rotas que exigem tenant usam middleware posterior à autenticação que exige contexto organizacional válido; rotas estritamente globais continuam sem organização selecionada.
- Login não concede acesso a qualquer tenant por si só. A seleção apenas cria contexto; permissões funcionais permanecem para F5.
- `POST /api/auth/organization` aceita exclusivamente `{ "organizationId": "<uuid>" }`; input inválido devolve `ORGANIZATION_SELECTION_INVALID` e inelegibilidade devolve uniformemente `ORGANIZATION_NOT_SELECTABLE`.
- A representação pública de organização limita-se a `id`, `displayName` e `slug`; membership, versão e `baseRoleCode` permanecem internos.
- Contexto ausente ou obsoleto mantém autenticação global, roda para uma sessão sem organização e consumidores tenant recebem uniformemente `ORGANIZATION_SELECTION_REQUIRED` (`409`).
- O store Express e a Central não formam uma transação distribuída: a sessão server-side é persistida primeiro, a rotação Central revalida e grava atomicamente os três campos organizacionais, e uma falha destrói a nova sessão como compensação fail-closed.
- Falhas de transação preservam o erro principal; falha adicional de rollback descarta o client PostgreSQL e agrega rollback/release sem uma segunda libertação saudável.
- Falhas operacionais de listagem, seleção, resolução ou compensação organizacional usam `503 ORGANIZATION_CONTEXT_UNAVAILABLE`; causas e erros agregados permanecem internos e o fallback de produção para erros desconhecidos é um `500` genérico.
- No modo `transition`, Bearer legado pode consultar o estado global sem organização, mas listagem e seleção F3 exigem sessão server-side; nenhum SID é rodado a partir de credenciais Bearer.
- Suspensão/remoção neste bloco é uma operação interna transacional que incrementa `membership_version`; não existe endpoint administrativo e `baseRoleCode` não é interpretado como permissão.

## Estado atual relevante

- F2 mantém sessão server-side, SID e revogação global por utilizador em `application_session`.
- `authenticateSession` continua a validar apenas a identidade global; o resolver F3 separado valida organização e membership antes de expor `req.organizationContext`.
- A baseline central contém `global_user`, `auth_identity_ref` e `platform_admin_assignment`; ainda não contém `organization` nem `organization_membership`.
- A sessão lógica aprovada prevê `selected_organization_id`, mas a migration F2 não o materializou.
- `/api/auth/session` devolve utilizador, organização pública validada ou `null`, e `organizationSelectionRequired`; a interface visual de seleção permanece fora deste bloco backend.
- O piloto UBI não tem abstração multi-instituição; os seus perfis `ADMIN`/`PROFESSOR` não definem memberships futuras.

## Plano de implementação

### 1. Contratos centrais e migration F3

- Criar migration central `002` separada e ordenada, protegida pelo marker, ledger, checksums, lock e transação já usados pelo runner.
- Materializar `organization` e `organization_membership` com UUIDs, estados e validade definidos no dicionário lógico; preservar histórico e impedir eliminação física automática.
- Garantir unicidade de `(global_user_id, organization_id)` e constraints explícitas para estados e intervalos.
- Acrescentar à sessão central `selected_organization_id`, `selected_membership_id` e uma versão/revisão de membership suficiente para validação e invalidação; índices devem suportar validação por pedido e revogação das sessões afetadas.
- Manter o rollback de F3 limitado aos objetos F3 e incapaz de eliminar identidade, sessões F2 ou privilégios existentes.

### 2. Repositório de memberships e resolução de contexto

- Criar um repositório central injetável para listar memberships elegíveis e resolver uma membership por utilizador/organização.
- Fazer a resolução numa operação SQL condicionada por utilizador, organização, membership, estados e validade temporal.
- Produzir um contexto imutável mínimo: `organizationId`, `membershipId`, `baseRoleCode`, versão e estado validados; não incluir ligações de base nem permissões F5.
- Falhar fechado quando a base central estiver indisponível, os dados forem ambíguos ou a membership estiver em estado intermédio.

### 3. Sessão e revogação imediata

- Estender o registry F2 para validar atomicamente sessão, utilizador, organização selecionada e membership em cada pedido tenant-scoped.
- Implementar revogação por membership numa transação central: alterar estado/versão, revogar as sessões vinculadas e devolver os SIDs para limpeza do store.
- Tratar falha parcial de registry/store com resposta `503`, acesso recusado e registo de reconciliação, seguindo o padrão de logout degradado sem o transformar em sucesso.
- Conservar revogação global por utilizador e distinguir motivos estáveis: membership suspensa/removida, organização suspensa/arquivada e revogação crítica.

### 4. Seleção e troca de organização

- Criar controller e rotas injetáveis para listar e selecionar organizações.
- Exigir autenticação, Origin e CSRF na seleção; ignorar qualquer tentativa de fornecer membership, base ou contexto derivado pelo cliente.
- Revalidar centralmente a organização pretendida e rodar o SID na troca; gravar o novo contexto e revogar o SID anterior na mesma fronteira de consistência já usada por F2.
- Não reproduzir automaticamente operações anteriores à troca e exigir novo token CSRF.

### 5. Middleware e contratos HTTP

- Separar `authenticate` de `requireOrganizationContext`: autenticação prova identidade; o segundo middleware prova organização/membership ativa.
- Anexar `req.organizationContext` apenas a partir da validação central e torná-lo a única entrada futura para o tenant resolver F4.
- Classificar as rotas existentes entre globais, legadas e tenant-scoped antes de aplicar o novo middleware; durante a transição, não converter silenciosamente IDs UBI em organizações futuras.
- Atualizar o catálogo de endpoints efetivamente montados por modo de autenticação.

### 6. Frontend

- Ampliar o bootstrap de sessão para suportar `organization` e a lista mínima de organizações elegíveis sem persistir contexto em `localStorage` ou `sessionStorage`.
- Introduzir estado explícito para “organização por selecionar” e uma interface de seleção/troca.
- Depois de uma troca válida, substituir integralmente o estado dependente da organização e obter nova prova CSRF antes de permitir mutações.
- Tratar membership revogada/organização suspensa limpando contexto tenant e apresentando uma recuperação segura, sem fallback para contexto anterior.

### 7. Testes e validação

- Adicionar testes unitários e HTTP com pelo menos duas organizações, utilizadores com memberships distintas e relógio controlado.
- Cobrir estados `PENDING_PROJECTION`, `ACTIVE`, `SUSPENDED`, `REMOVED`, validade temporal, organização não ativa, input adulterado e indisponibilidade central.
- Provar rotação de SID/CSRF na troca, invalidação do SID anterior e ausência de contexto da organização anterior.
- Provar revogação transacional das sessões afetadas, não afetação de outras memberships válidas e falha fechada em limpeza parcial.
- Executar `npm test`, `node --check` nos JavaScript alterados, migration forward/rollback/re-forward e drift, `npm run build` no frontend e `git diff --check`.
- Atualizar a matriz: `SEC-AC-05/06` só passam de `pending` para `covered` após testes automatizados e gate descartável com PostgreSQL central real; integrações de F4/F5 permanecem fora da declaração.

## Componentes previstos

| Área | Alteração prevista |
| --- | --- |
| `backend/database/central/migrations/` | migration F3 de organizações, memberships e vínculo da sessão |
| `backend/src/security/sessionRegistry.js` | validação e revogação por membership; rotação com contexto |
| novo repositório/serviço central | listagem e resolução de memberships elegíveis |
| `backend/src/security/sessionAuth.js` | construção do contexto organizacional validado |
| auth controllers/routes | endpoints de listagem e seleção/troca |
| `backend/src/app.js` e composição | injeção e montagem explícita dos novos contratos |
| `frontend/src/contexts/AuthContext.jsx` | estado da organização ativa e troca segura |
| nova UI de seleção | escolha de organização sem persistência insegura |
| `backend/test/security/` e gate descartável | cobertura de `SEC-AC-05/06` |

## Dependências e limites

- F2 é pré-requisito e permanece fechada com `SEC-AC-01`–`04` parciais.
- F3 usa apenas a base central para provar membership e contexto. A resolução da ligação e da base física do tenant pertence a F4.
- `base_role_code` é transportado como atributo da membership, mas não interpretado por controllers; catálogo de permissões e autorização funcional pertencem a F5.
- A projeção local obrigatória será representada pelo estado `PENDING_PROJECTION`; criação/sincronização completa da projeção depende das fases de tenant/worker.
- Convites, gestão administrativa completa de memberships e suporte temporário não são necessários para provar `SEC-AC-05/06`, salvo decisão explícita de ampliar F3.
- Nenhuma migration será executada contra ambiente real durante implementação sem plano operacional próprio.

## Ambiente PostgreSQL local da aplicação

- Central e Legacy executam em clusters Docker persistentes e separados, publicados apenas em `127.0.0.1:5541` e `127.0.0.1:5542`.
- A Central contém exclusivamente as migrations versionadas `000`, `001` e `002`; a Legacy recebe o schema canónico do piloto e apenas dados sintéticos locais.
- A API local usa `CENTRAL_DATABASE_URL` e `DATABASE_URL` distintas, geradas em `backend/.env.local`, que permanece ignorado pelo Git.
- O perfil local exige `NODE_ENV=development`, recusa portas ou hosts diferentes dos endpoints loopback aprovados e desativa schedulers, integrações externas e seeds históricos.
- Validação da fundação concluída: `node --check`, parsing PowerShell, `db:local:up`, `db:local:status`, fingerprint integral do schema Legacy, seed sintético exato, readiness da API com ambas as bases healthy, build frontend, `git diff --check` e scan de segredos.

## Migration central 002 implementada

- `organization` materializa identidade, slug, tipo, estado contratual, moeda de reporting, política MFA e residência, sem incluir qualquer ligação F4.
- `organization_membership` liga utilizador e organização com unicidade, papel base opaco, estado, validade temporal e `membership_version`; não existe eliminação em cascata.
- `application_session` guarda organização, membership e versão selecionadas como conjunto all-or-none; a FK composta impede associação a membership de outro utilizador ou organização.
- O estabelecimento e a leitura de contexto usam SQL condicionado por utilizador, organização, membership, validade e versão ativos; inexistência, suspensão, expiração ou versão obsoleta produzem zero resultados.
- O runner permite rollback apenas da migration reversível mais recente, valida checksums e recusa a Legacy ou um ledger desconhecido/divergente.
- Os checks locais validam um fingerprint versionado do esquema físico Central, incluindo tabelas, colunas, constraints e índices; drift físico falha mesmo quando ledger e checksums permanecem intactos.
- Gate PostgreSQL descartável cobre reconstrução completa, upgrade de `000/001`, forward/rollback/re-forward, drift de checksum e esquema físico, constraints, referências inválidas, duplicados, expiração e isolamento entre duas organizações sintéticas.
- A limpeza do gate é fail-closed: falhas ao remover bases descartáveis são agregadas ao erro principal e impedem um resultado de sucesso.

## Preparação de staging integrada

- O preflight Central somente leitura valida marker, ledger completo, sequência, checksums, atributos de reversibilidade e fingerprint físico versionado para os estados `000`, `001` e `002`.
- Os fingerprints têm como fonte única o manifest de migrations e suportam atualmente PostgreSQL major 17; outras versões falham fechado antes da comparação física.
- O comando `db:central:preflight` não executa migrations ou DDL e recusa explicitamente a Legacy, versões desconhecidas, lacunas e drift físico.
- O gate descartável de preflight cobre estados válidos, falhas de marker/ledger e drift de tabelas, colunas, constraints, índices e objetos adicionais, com cleanup fail-closed.
- O runbook de staging documenta backup/restore, preflight, aplicação one-shot, readiness, smoke tests, monitorização e recuperação sem assumir infraestrutura ainda inexistente.
- Permanecem pendentes fornecedor/infraestrutura de staging, identidades, gestor de segredos, tecnologia de backup, RPO/RTO, responsáveis, observabilidade e mecanismo CI/CD.

## Canonicalização de checksums centrais

- Estado da correção: integrada em `main` pelo PR #7 antes do bloco funcional F3.
- O SQL central é lido como UTF-8, converte exclusivamente `CRLF` para `LF` e é executado e registado nessa forma canónica.
- As migrations publicadas `000`, `001` e `002` aceitam os checksums LF canónico e CRLF historicamente equivalente, ambos derivados do mesmo conteúdo; qualquer alteração material continua a falhar fechado.
- Validação, `up`, `status`, rollback e preflight partilham a mesma política e não reescrevem metadados existentes do ledger.
- `.gitattributes` fixa os SQL versionados em LF como defesa adicional, sem ser a fonte exclusiva da compatibilidade histórica.

## Fora do âmbito

- tenant resolver, diretório de ligações e acesso à base de cada organização (F4);
- perfis versionados, grants, unidades, equipas e policy engine (F5);
- suporte C4G temporário e separação de funções (F5);
- projeções locais, outbox/inbox, worker, retries e reconciliação completa (F9);
- configuração de Keycloak, infraestrutura, deploy, rollout ou cutover definitivo;
- migração dos utilizadores e estruturas UBI para memberships futuras.
- aplicação de `requireOrganizationContext` às rotas existentes do piloto UBI.

## Decisões aprovadas

### F3-D1 — Seleção quando existe uma única membership

- Selecionar automaticamente quando existir exatamente uma membership elegível.
- Exigir escolha explícita quando existirem várias.
- Com zero memberships elegíveis, conservar apenas autenticação global, sem contexto ou acesso tenant.

Estado: **aprovada em 2026-10-05**.

### F3-D2 — Âmbito administrativo

- F3 limita-se a enforcement, seleção/troca e revogação.
- CRUD administrativo de organizações, memberships e convites fica fora desta fase e exige contrato próprio posterior.

Estado: **aprovada em 2026-10-05**.

### F3-D3 — Perda da membership selecionada

- A sessão pode continuar autenticada globalmente, mas perde imediatamente o contexto organizacional afetado.
- Todas as operações tenant ficam bloqueadas até existir e ser selecionada outra membership elegível.
- A transição é fail-closed, invalida a sessão/SID vinculada à membership perdida e cria contexto novo apenas após nova validação e rotação segura.

Estado: **aprovada em 2026-10-05**.

## Referências

- `context/features/security-privacy-and-audit-foundation.md`
- `context/architecture.md`
- `context/project-overview.md`
- `context/coding-standards.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/application-session-lifecycle.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `context/history/f2-identidade-e-sessao-segura.md`
- `backend/test/security/secCoverageMatrix.js`

## Fecho confirmado da F3

- O PR #8 foi integrado em `main` pelo merge commit `0153bf1a368f07ea0282ff09b29384b39112d30b` em 2026-10-05.
- A implementação funcional ficou registada em `00f7fba474b2505d53b69b00e6daa579e691ef2e` e a correção de sanitização HTTP em `8cd1780353e849d9dd5872d570387ea318be61fe`.
- A revisão final da branch não encontrou findings acionáveis; o PR foi considerado mergeable e sem conflitos ou pedidos de alteração.
- A suite completa do backend passou `135/135`; os 11 testes HTTP corretivos estão incluídos nesse total.
- O gate descartável da migration `002`, o gate descartável do preflight Central, `db:local:status`, `node --check`, o build frontend, `git diff --check` e os scans de segredos e artefactos passaram.
- O cleanup confirmou zero bases temporárias restantes e não foram executadas migrations em staging, produção ou bases externas.
- A matriz versionada mantém `SEC-AC-05` e `SEC-AC-06` como `partial`, porque a evidência cobre repository, lifecycle de sessão, contratos HTTP e PostgreSQL Central descartável, mas não rollout no ambiente alvo.

## Limitações após o fecho

- não existe ainda resolução física do tenant nem diretório organização → tenant; pertence a F4;
- `base_role_code` permanece opaco e não existe autorização funcional F5;
- a experiência frontend de seleção e troca de organização não está completa;
- não houve deploy ou validação de rollout em staging ou produção.

Next step: definir e aprovar o contrato de tenant e onboarding antes de iniciar F4.
