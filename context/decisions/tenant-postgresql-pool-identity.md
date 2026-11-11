# Decisão: identidade PostgreSQL dos pools tenant F4

## Estado

**Aprovada.** A arquitetura, cardinalidade e responsabilidade F4.4 estão aprovadas. Provisioning local e probes PostgreSQL exclusivamente descartáveis estão autorizados. Rollout, tenants reais, secret manager real, infraestrutura externa e produção continuam não autorizados.

## Contexto e problema

F4 resolve uma `credential_ref` opaca para material de ligação. Esta decisão passa a definir resolução, lifecycle e pools pela chave `(tenant_id, workload, connection_version)`. O modo aprovado é `DATABASE_PER_ORGANIZATION`; `tenant_id` permanece estável durante rotação de credenciais e mudança de versão. Os roles funcionais tenant são `NOLOGIN`.

Sem esse contrato, um teste iniciado por administrador consegue demonstrar `SET LOCAL ROLE`, mas não demonstra que a aplicação produtiva o consegue fazer sem `SUPERUSER`, `BYPASSRLS` ou ownership. Isso bloqueia F12-AC-17, AC-21, AC-24 e AC-29.

## Decisão

1. Cada tenant possui identidades lógicas PostgreSQL separadas por workload. A cardinalidade mínima é **um principal LOGIN por (`tenant_id`, `workload`)**, inicialmente `api` e `worker`. Nenhuma identidade ou credencial é partilhada entre workloads ou tenants, incluindo instalações dedicadas.
2. **Identidade lógica** é o principal estável associado a um `tenant_id` e workload. **Credencial** é o segredo resolvido pela `credential_ref`. **`connection_version`** é a versão publicada que fixa credencial/binding para pools e fencing. **Geração física da identidade** é uma nova instanciação do principal, criada apenas quando a anterior não deve ser reutilizada, como comprometimento ou reprovisionamento incompatível; não é sinónimo de rotação normal do segredo nem da geração física da base.
3. Na rotação normal, preserva-se a identidade lógica e os memberships, roda-se a credencial, publica-se nova `connection_version`, drenam-se os pools anteriores e revoga-se o segredo anterior. Em comprometimento, cria-se nova geração física da identidade, aplicam-se memberships equivalentes, valida-se, publica-se nova `connection_version` com novo fence, drenam-se pools e só depois se revoga e remove a geração comprometida.
4. Cada LOGIN possui exatamente: `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`. O limite de ligações e validade da credencial são política operacional versionada, não grants funcionais.
5. Cada LOGIN recebe membership apenas no agregador do seu workload, com `SET TRUE, INHERIT FALSE, ADMIN FALSE`.
6. Os agregadores canónicos são `c4g_tenant_api_capabilities` e `c4g_tenant_worker_capabilities`. Ambos são `NOLOGIN NOINHERIT`, não possuem objetos nem privilégios diretos e só têm caminhos `SET TRUE` para a allowlist funcional do respetivo workload.
7. `c4g_tenant_runtime` é um role funcional existente, não um agregador nem baseline comum. Só pode integrar a allowlist do workload cuja necessidade seja comprovada por call sites e probes. Enquanto essa prova não existir, não pertence a nenhum agregador e qualquer tentativa de o assumir falha fechado.
8. Cada role funcional permanece `NOLOGIN`, sem ownership, e possui apenas os privilégios da operação. Roles exclusivos do worker nunca pertencem ao agregador API e roles exclusivos da API nunca pertencem ao agregador worker.
9. Owner e migrator nunca são membros dos LOGINs ou agregadores. Não existe membership inversa que permita regressar a um LOGIN/agregador ou escalar para owner/migrator.
10. A composição F4 abre a transação e, na mesma ligação, executa `SET LOCAL ROLE <role_funcional>` e define `app.organization_id` por parâmetro. Todas as queries usam esse client. O role final deriva do workload e de código interno registado, nunca de input HTTP ou payload de job.
11. Uma resolução incompatível — role ausente, atributos divergentes, membership incompleta ou cruzada, grant adicional, ownership, `SET ROLE` recusado ou identidade observada diferente — falha antes de publicar a versão como `VALIDATED/AVAILABLE`.
12. A representação F4 é `(tenant_id, workload, connection_version)`, com `workload` interno e fechado em `API | WORKER`. Cada workload possui separadamente `credential_ref`, lifecycle, compatibility, provisioning, fence e `binding_digest`. Estado ou evidência de um workload não autoriza nem torna compatível o outro.
13. A pool key canónica é `(tenant_id, workload, connection_version)`. Resolver, cache, single-flight, circuit breaker, drain, revogação e reconciliação não podem colapsar a dimensão `workload`.

## Grafo de roles

```text
<tenant-api-login>                    <tenant-worker-login>
  LOGIN, NOINHERIT                      LOGIN, NOINHERIT
          |                                     |
          | SET T / INHERIT F / ADMIN F         | SET T / INHERIT F / ADMIN F
          v                                     v
c4g_tenant_api_capabilities          c4g_tenant_worker_capabilities
  NOLOGIN, sem object grants            NOLOGIN, sem object grants
          |                                     |
          +--> roles API permitidos             +--> roles worker permitidos

Não existe caminho API → role worker-only nem worker → role API-only.

Sem qualquer caminho para roles owner ou migrator.
```

No PostgreSQL 17, o `session_user` pode executar diretamente `SET LOCAL ROLE` para um role funcional indireto sem primeiro assumir o agregador, mas apenas quando todos os elos têm `SET TRUE`. `INHERIT FALSE` em todos os elos impede privilégios implícitos; `ADMIN FALSE` impede redistribuição. As duas cadeias são disjuntas.

## SQL ilustrativo

Os placeholders representam nomes internos gerados pelo provisioner; não são nomes produtivos nem credenciais.

```sql
CREATE ROLE <tenant_api_login>
  LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE ROLE <tenant_worker_login>
  LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE ROLE c4g_tenant_api_capabilities
  NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE ROLE c4g_tenant_worker_capabilities
  NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT c4g_tenant_api_capabilities TO <tenant_api_login>
  WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;
GRANT c4g_tenant_worker_capabilities TO <tenant_worker_login>
  WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;

GRANT <api_functional_role> TO c4g_tenant_api_capabilities
  WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;
GRANT <worker_functional_role> TO c4g_tenant_worker_capabilities
  WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;

BEGIN;
SET LOCAL ROLE <api_functional_role>;
SELECT pg_catalog.set_config('app.organization_id', $1, true);
-- queries parametrizadas da unidade de trabalho
COMMIT;
```

O provisioner deve revogar grants inesperados e validar o estado final; o SQL acima não representa a ordem completa, tratamento de segredo ou reconciliação.

`c4g_tenant_runtime` não aparece no exemplo porque a sua associação a API ou worker permanece pendente de prova por call sites. Até essa prova, não recebe membership a partir de nenhum agregador.

## Alternativas avaliadas

| Opção | Least privilege e blast radius | Rotação/revogação/auditoria | Pooling e operação | Decisão |
|---|---|---|---|---|
| A. LOGIN membro direto de cada role funcional | Boa separação no uso, mas cada nova feature altera todos os LOGINs e favorece privilege creep disperso. | Grants reais ficam repetidos por principal; revogação e inventário são mais difíceis. | `SET LOCAL ROLE` direto e simples. | Rejeitada: gestão descentralizada e maior risco de drift. |
| B. LOGIN apenas membro do agregador do workload | Privilégios indisponíveis até `SET ROLE`; cadeias API/worker disjuntas reduzem blast radius e privilege creep. | Rotação independente por workload preserva grants; cada grafo é auditável e revogável isoladamente. | Compatível com pools separados por workload e seleção funcional por transação. | **Recomendada.** |
| C. Role runtime com LOGIN | Elimina a separação entre autenticação e autorização e tende a deixar privilégios sempre ativos. Um pool por role ou role excessivamente amplo. | Rotação fica acoplada ao role funcional; difícil distinguir identidade lógica de capacidade. | Simples por domínio isolado, inadequado ao pool F4 partilhado. | Rejeitada. |
| D. Pools separados por domínio funcional | Menor blast radius por domínio, além da separação API/worker. | Multiplica credenciais, pools, rotações, circuit breakers e cutovers. | Prejudica composição transacional F11/F12 dentro do mesmo workload e o orçamento de ligações. | Rejeitada para o MVP; a separação obrigatória é por workload. |

## Ownership e responsabilidades

- **Provisioner F4.4 autorizado:** cria e reconcilia os LOGINs por workload, os agregadores canónicos e memberships; gere credenciais, `connection_version`, lifecycle, compatibility, provisioning, `binding_digest`, rotação, fence, drain, revogação e remoção separadamente por workload; deteta drift e recusa identidades administrativas, partilhadas ou incompatíveis. Nunca recebe credenciais através do domínio funcional e regista apenas códigos/evidência sanitizada.
- **Owner/migrator tenant:** cria roles funcionais, objetos, policies e grants durante migrations autorizadas. Não é usado por API/worker.
- **Secret adapter:** cria/roda material de autenticação separado por workload, publica referências opacas distintas e devolve leases efémeras. Não altera grants por efeito colateral.
- **Diretório Central:** conserva a `credential_ref`, versão, binding e lifecycle; não conserva nome do role, password ou connection string em respostas/eventos funcionais. A identidade lógica esperada integra a evidência de provisioning/binding por digest, sem expor o nome.
- **API e worker F4:** cada workload resolve apenas a sua `credential_ref`, obtém o seu pool e prepara role/contexto por transação; nenhum cria ou altera roles.
- **Offboarding/revogação:** por workload ou tenant, bloqueia novas leases, incrementa fence, drena pools, revoga a credencial e apenas depois remove a geração da identidade/memberships quando retenção e rollback autorizarem. A remoção física não apaga evidência Central.

## Provisioning e upgrade

### Novas instalações

1. Criar/reconciliar roles funcionais pelas migrations autorizadas.
2. Criar LOGIN e credencial distintos para API e worker, ambos com atributos fechados e sem grants de objetos.
3. Criar/reconciliar os agregadores por workload e os dois níveis de membership, removendo caminhos cruzados ou inesperados.
4. Validar separadamente identidade, atributos, ownership, memberships e capacidade de `SET LOCAL ROLE` de cada workload.
5. Executar probes RLS A/B, separação de workloads e transacionais com cada credencial candidata.
6. Só então marcar a versão `VALIDATED`, schema `COMPATIBLE`, provisioning `READY` e publicar o cutover.

### Instalações existentes

1. Inventariar separadamente pools/credenciais API e worker: `session_user`, atributos, ownerships, memberships e grants de cada principal atual.
2. Uma identidade administrativa, incompatível ou partilhada entre workloads não é normalizada silenciosamente: criam-se versões candidatas com identidades e credenciais separadas.
3. Aplicar roles/memberships por migration/provisioning idempotente fora das migrations tenant controladas pelo runtime.
4. Executar todos os probes na versão candidata; falha mantém a versão corrente e marca a candidata `FAILED`.
5. Publicar o novo `connection_version` atomicamente, incrementar fence, drenar pools antigos e revogar a credencial anterior depois da drenagem.

Não se promove uma identidade administrativa existente a runtime, não se conserva uma identidade partilhada e não se removem grants desconhecidos numa versão ativa sem inventário, compensação e cutover por workload.

## Rotação, revogação e rollback

- Rotação normal de um workload preserva a sua identidade lógica e memberships, roda apenas a credencial, publica nova `connection_version`, incrementa o fence aplicável, drena pools anteriores e revoga o segredo antigo; o outro workload não é interrompido nem recebe capacidades adicionais.
- Compromisso cria nova geração física da identidade afetada, aplica memberships equivalentes, valida, publica nova `connection_version`/fence, drena e revoga a geração comprometida, removendo-a apenas quando seguro. O outro workload permanece isolado.
- Revogar o agregador do LOGIN é o kill switch PostgreSQL desse workload; revogar um role funcional do agregador remove apenas esse domínio após drenagem das transações em curso.
- Rollback antes do cutover elimina/revoga somente a identidade candidata, preservando a corrente. Depois do cutover, rollback é novo cutover para uma versão ainda válida; nunca se reabre uma credencial revogada nem se reduz o fence.
- `DROP ROLE` ocorre apenas quando não existem pools, ownerships, grants dependentes ou requisitos de recuperação; `REASSIGN OWNED` para runtime é proibido porque runtime não pode possuir objetos.

## Invariantes de segurança

- LOGINs, agregadores e roles funcionais: `rolsuper=false`, `rolbypassrls=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolreplication=false`.
- Apenas os principais autenticados têm `rolcanlogin=true`; agregadores, roles funcionais, owner e migrator são `NOLOGIN`.
- LOGINs e agregadores não possuem objetos nem privilégios diretos sobre objetos e não recebem owner/migrator.
- Todos os elos LOGIN→agregador→role funcional possuem `SET TRUE`, `INHERIT FALSE` e `ADMIN FALSE`; `SET FALSE` em qualquer elo torna o role final inalcançável.
- Apenas o role funcional selecionado possui os privilégios da operação.
- O LOGIN API não consegue assumir capacidades worker-only; o LOGIN worker não consegue assumir capacidades API-only.
- Nenhuma identidade runtime consegue assumir owner ou migrator.
- Durante `SET LOCAL ROLE`, `session_user` permanece o LOGIN autenticado e `current_user` torna-se exatamente o role funcional.
- `PUBLIC` não recebe memberships nem acesso aos schemas/objetos funcionais.
- RLS é testada com role não-owner e sem `BYPASSRLS`; queries sem `WHERE organization_id` continuam isoladas.
- `SET LOCAL ROLE` e `app.organization_id` pertencem à mesma transação, ligação e lease; erro de preparação impede qualquer query funcional. Commit, rollback, descarte ou reutilização da ligação não preservam role nem `app.organization_id` residuais.
- O nome do role, SQL de provisioning e segredo não entram em input HTTP, payload de job, logs funcionais ou respostas.

## Probes obrigatórios

1. Confirmar separadamente para API e worker `session_user`, `current_user`, atributos `pg_roles` e ausência de ownership/grants diretos.
2. Confirmar acessibilidade com `has_role(session_user, role, 'SET')` e `has_role(session_user, role, 'USAGE')`: `SET=true` apenas para roles permitidos ao workload e `USAGE=false` antes de `SET ROLE`. Não usar `has_role(..., 'ADMIN')`.
3. Consultar `pg_auth_members` em cada elo LOGIN→agregador e agregador→role funcional e exigir exatamente `set_option=true`, `inherit_option=false` e `admin_option=false`.
4. Provar que o LOGIN API assume somente roles API e o LOGIN worker somente roles worker; tentativas cruzadas, owner, migrator e roles não concedidos são recusados.
5. Provar que nenhum LOGIN possui privilégios funcionais antes de `SET ROLE` e que uma cadeia indireta funciona somente quando todos os elos têm `SET TRUE`; `SET FALSE` em qualquer elo bloqueia o role final.
6. Confirmar que, durante `SET LOCAL ROLE`, `current_user` é o role funcional e `session_user` permanece o LOGIN autenticado.
7. Provar RLS A/B com query deliberadamente sem predicado organizacional, escrita cruzada recusada e `row_security_active(...) = true`.
8. Provar que LOGIN/agregador não criam schema/tabela, não alteram roles, não concedem memberships e não executam funções não autorizadas.
9. Provar composição F4/F11/F12 numa lease/client/transaction, PID e transaction ID únicos, rollback integral após falha e commit integral no fluxo feliz.
10. Provar pooling: após commit/rollback e antes da reutilização, role, `current_user`, `app.organization_id` e contexto não vazam entre tenants, workloads ou operações.
11. Provar que rotação API não interrompe nem amplia worker e rotação worker não interrompe nem amplia API; em ambos os casos a identidade lógica/grants são preservados, a `credential_ref` muda e pools antigos são recusados depois do fence.
12. Provar que pool, fence, lifecycle, compatibility, provisioning e `binding_digest` são independentes por `(tenant_id, workload, connection_version)`.
13. Provar upgrade de identidade incompatível: versão candidata falha fechada sem afetar a corrente; nenhuma ligação administrativa é aceite.
14. Provar revogação e cleanup sem deixar pools, memberships, ownership ou secrets ativos.

## Consequências e riscos residuais

- Agregadores por workload reduzem drift e blast radius, mas cada catálogo de memberships é uma fronteira crítica: adicionar um role funcional amplia todos os LOGINs desse workload nessa base. A reconciliação usa allowlists versionadas e evidência por tenant e workload.
- Roles são identidades ao nível do cluster PostgreSQL. O provisioner deve garantir que o destino físico e o scope do role não criam acesso a outra base/tenant, incluindo `CONNECT`, `search_path`, grants e ownerships fora da base esperada.
- API e worker possuem identidades e credenciais distintas; a auditoria do utilizador final continua a depender do contexto de aplicação/F7, não de um LOGIN PostgreSQL por utilizador.
- A separação exige evolução compatível do diretório e lifecycle F4 para a chave `(tenant_id, workload, connection_version)`, preservando histórico e recusando workloads fora de `API | WORKER`.
- Connection limits, fornecedor de secrets e nomes físicos dos LOGINs são política operacional posterior. Os nomes dos agregadores e os restantes invariantes desta decisão são canónicos.

## Fontes

- Contratos internos: `context/architecture.md`, `context/decisions/tenant-directory-and-lifecycle.md`, `context/history/f4-tenant-runtime-access.md`, `context/history/f43-tenant-schema-compatibility.md`, `backend/src/security/tenantCredentialProvider.js`, `tenantPoolManager.js` e migrations tenant.
- PostgreSQL 17: [Role Membership](https://www.postgresql.org/docs/17/role-membership.html), [GRANT](https://www.postgresql.org/docs/17/sql-grant.html), [SET ROLE](https://www.postgresql.org/docs/17/sql-set-role.html), [ALTER ROLE](https://www.postgresql.org/docs/17/sql-alterrole.html), [Row Security Policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) e [System Information Functions](https://www.postgresql.org/docs/17/functions-info.html).

## Registo da aprovação humana

- Opção B mantida como base.
- Partilha de identidade ou credencial entre API e worker rejeitada.
- Cardinalidade revista para `tenant_id × workload`, no mínimo API e worker.
- Agregadores canónicos aprovados: `c4g_tenant_api_capabilities` e `c4g_tenant_worker_capabilities`.
- Arquitetura, cardinalidade e responsabilidade F4.4 aprovadas.
- Provisioning local e probes PostgreSQL descartáveis autorizados.
- Rollout, tenants reais, secret manager real e produção não autorizados.
- Allowlists funcionais permanecem fail-closed e exigem prova por call sites; a associação de `c4g_tenant_runtime` permanece pendente dessa prova.
- Connection limits, fornecedor de secrets e nomes físicos dos LOGINs permanecem política operacional posterior.
