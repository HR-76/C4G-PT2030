# Adesão de novas entidades no staging

Estado: **In Progress** — fases 1 a 3 em Review e fase 4 parcial (23/11/2026); ver «Fase 4» para o que ficou por fazer. Pedido do utilizador em 23/11/2026: a plataforma tem de admitir mais do que uma entidade fora do ambiente local. Âmbito decidido pelo utilizador: **só staging**; a produção fica para depois. Contratos funcionais que não mudam: [adesão restrita](platform-entity-invited-registration.md), [conclusão da ficha](platform-entity-registration-completion.md), [adaptadores reais](platform-onboarding-real-adapters.md).

## Causa

O serviço de adesão («Convidar uma entidade», ficha, criação da base própria) só é composto pelo instalador local (`backend/scripts/localPlatform/runtime.js`, com `admissionAccess`). A API do staging arranca por `src/server.js`, que não o fornece: as rotas `/api/admissions`, `/api/admin/directory/admissions` e `/api/admission-activation` não existem. É o mesmo problema que os convites de utilizadores tinham até 14/11/2026 ([staging-member-invitations.md](staging-member-invitations.md)).

## O que a adesão faz (já implementado e provado em composição isolada)

1. O Admin C4G cria o convite do primeiro administrador; a ligação de ativação aparece ao Admin C4G (não há email de adesão).
2. A pessoa ativa a conta no Keycloak (`/api/admission-activation`) e preenche a ficha da entidade.
3. Um worker privilegiado, separado do processo HTTP, cria a base `c4g_onb_<id>`, o dono e os logins API e WORKER, aplica o esquema tenant, regista a ligação na Central e projeta a pessoa no tenant.
4. A API resolve as credenciais dessa base pelo worker, não por configuração fixa.

## Fases

1. **Composição (esta fase).** Módulo de adesão para a API arrancada por `src/server.js`, ligado por `ENTITY_ADMISSION_RUNTIME=central`, desligado por omissão.
2. **Worker de provisionamento do staging** (o atual, `scripts/localPlatform/admissionWorker.js`, está preso à configuração local) e resolvedor dinâmico de credenciais na composição (`OPPORTUNITY_API_CREDENTIALS_JSON` é hoje uma lista fixa).
3. **Instalador, compose e runbook:** comando do instalador de staging para os ficheiros do worker e as chaves do registo cifrado; volumes; passos na VPS.
4. **Várias entidades na operação:** migrações tenant, retenção do chat, projeção de membros de outras entidades e restantes tarefas que hoje recebem as credenciais de uma só base.
5. **Ensaio na VPS** com uma segunda entidade fictícia, incluindo cópia e restauro da base nova.

Nada fica ligado no staging antes da fase 5.

## Fase 1 — critérios de aceitação

- Sem a variável (ou com `disabled`) nada muda; outro valor impede o arranque (`ENTITY_ADMISSION_RUNTIME_INVALID`).
- A adesão exige os convites de utilizadores ligados (`MEMBER_ONBOARDING_RUNTIME=central`): partilha o emissor, a origem pública, os clientes de ativação, o segredo e a escuta da ponte do Keycloak. Sem eles o arranque é recusado (`ENTITY_ADMISSION_REQUIRES_MEMBER_RUNTIME`).
- A pasta do worker vem de `ENTITY_ADMISSION_DIRECTORY` (caminho absoluto, `worker.json`). As credenciais de administração do PostgreSQL e do Keycloak ficam no worker IPC; o processo HTTP só lhe chama `identity`, `passwordReady`, `resolve` e `health`.
- O arranque só prossegue se o worker responder; depois é consultado de 5 em 5 s, o que o volta a arrancar se terminar. Sem um `worker.json` válido (fase 3), ligar a variável impede o arranque: falha fechada.
- As páginas `/api/admission-activation` são servidas pela aplicação de ativação, fora da aplicação principal. A ponte do Keycloak continua única: valida primeiro o convite de utilizador e, se não for, o convite de adesão.
- No fecho, o worker e o temporizador terminam.
- O ambiente local não muda de comportamento.

## Fase 2 — worker de provisionamento e credenciais dinâmicas

Implementado em `backend/src/entityAdmission/provisioningWorker.js`; o worker do instalador local não muda.

- **Ficheiro fechado.** `worker.json` só admite: `issuer`, `clientId`, `clientSecret`, `adminOrigin` (opcional, origem privada da administração do Keycloak), `certificate` (opcional), `ownershipKey`, `journalKey`, `postgres` (`host`, `port`, `user`, `password`, `ssl`), `centralDatabase`, `authority` (`user`, `password`), `permitSecret`, `policyVersion`, `dataResidencyCode`, `regionCode` e `residencyPolicyVersion`. Chaves desconhecidas, em falta ou mal formadas impedem o arranque do worker.
- **Identidade.** Só serve o emissor com que a API autentica (`OIDC_ISSUER` herdado), sempre em HTTPS. O token técnico é pedido ao emissor, reutilizado até perto de expirar e nunca seguido por redirecionamento.
- **Fronteira IPC.** Só cinco métodos: `identity`, `passwordReady`, `resolve`, `health` e `memberProjection`. `resolve` devolve o login API de uma entidade depois de o conferir com a Central; nada devolve o login de administração, a chave do registo ou o segredo do Keycloak. Qualquer outro nome responde `WORKER_METHOD_DENIED`.
- **Provisionamento.** A cada 3 s o worker conclui as adesões pendentes: cria a base `c4g_onb_<id>`, o dono e os logins, aplica o esquema e publica a ligação com a região e a política de residência do ficheiro, que têm de coincidir com `OPPORTUNITY_ALLOWED_RESIDENCY_JSON`. Antes de publicar, cada login é provado: só chega à sua base, sem atributos elevados, e corresponde ao registo da Central.
- **Estado.** `health` responde pronto só se uma passagem terminou sem erro nos últimos 15 s.
- **Registos cifrados.** Ficam em `provisioning/` e `credentials/` ao lado de `worker.json`: a pasta tem de ser gravável e persistente. Perdê-la ou perder `journalKey` torna as bases já criadas inacessíveis à API.
- **Credenciais dinâmicas.** A composição passa a aceitar `tenantCredentialResolver`; `src/server.js` liga-o ao método `resolve`. As entidades da lista fixa (`OPPORTUNITY_API_CREDENTIALS_JSON`) continuam a ser resolvidas primeiro e sem passar pelo worker.

Critérios de aceitação: os itens acima, verificados com substitutos e, como processo, com um ficheiro inválido (não arranca) e com um válido sem base de dados (responde, declara-se não pronto e não revela a falha).

**Não provado:** a criação real de uma base e dos logins, a ligação TLS ao PostgreSQL do staging e a administração do Keycloak. O provisionador e o registo são os mesmos do ambiente local, provados no gate isolado de 18/10/2026; a sua execução com esta configuração é a fase 5.

## Fase 3 — instalador, compose e runbook

- **Comando `admission`** do instalador de staging (`scripts/staging/install.js`), a correr na rede do contentor do Keycloak depois de `members`. Exige a instalação pronta, o `worker.json` dos convites e as credenciais de administração do PostgreSQL e do Keycloak; recusa antes de tocar no Keycloak se algo faltar.
- **Keycloak.** Os clientes de ativação só admitiam o retorno `/api/activation/callback`; o comando acrescenta `/api/admission-activation/callback` aos dois, só se tiverem a marca desta instalação, preserva o resto do cliente e confirma que a alteração ficou. Não cria clientes nem fluxos.
- **`worker.json`.** Reutiliza a conta técnica e a origem privada do worker dos convites; gera uma vez as suas próprias `ownershipKey` e `journalKey` e mantém-nas ao repetir. O ficheiro é escrito com modo 600 para o utilizador da API e só depois de o Keycloak ter aceitado a alteração. A saída do comando só tem nomes e booleanos.
- **Repetir `members`** depois de `admission` continua a funcionar: a verificação de deriva dos clientes aceita exatamente os dois retornos e recusa qualquer outro.
- **Compose.** A API monta `/srv/c4g-staging/admissions` gravável (registos cifrados).
- **Runbook.** [deploy/staging/README.md](../../deploy/staging/README.md), secção «Adesão de novas entidades»: pasta, comando, verificação das tabelas na Central, ativação, ensaio, o que guardar fora da VPS e como voltar atrás.

Critérios de aceitação: os itens acima, verificados com um Keycloak simulado. **Não provado:** nada correu contra o Keycloak nem o PostgreSQL do staging; o comando não verifica as tabelas da Central (corre na rede do Keycloak), por isso o runbook tem um passo próprio.

## Fase 4 — operação com várias entidades (parcial)

Levantamento do que assumia uma só entidade e o que foi feito a cada ponto.

**Feito**

- **Convites de utilizadores numa entidade nova.** O worker dos convites só conhece as organizações do seu ficheiro. Quando recusa uma pessoa por não conhecer a organização (`ONBOARDING_NOT_READY`), a projeção passa ao worker de adesão, que entra na base própria dessa entidade com o login API dela. Qualquer outra falha fica como estava e nunca chega ao worker de adesão.
- **Região da projeção.** O worker de adesão projetava pessoas com a região por omissão do ambiente local; passa a usar a região e a política de residência do seu ficheiro. Sem isto, os convites numa entidade nova falhariam no staging.
- **Upgrade do esquema.** Primeiro só uma guarda (recusa `STAGING_UPGRADE_ONBOARDED_TENANTS_UNSUPPORTED`); substituída no mesmo dia pela migração das bases da adesão, descrita em «Migração do esquema das bases da adesão».
- **Cópias de segurança.** Já descobrem todas as bases `c4g_*` ([staging-backups.md](staging-backups.md)).

**Por fazer (cada um exige contrato e prova própria)**

- **Retenção do chat.** `CHAT_RETENTION_CREDENTIALS_JSON` é uma lista explícita por organização com o login WORKER. As entidades novas não entram: as suas conversas não são eliminadas aos 90 dias. O login WORKER delas existe no registo cifrado, mas a fronteira do worker só expõe o login API.
- **Rotação mensal das partições de auditoria** nas bases novas: resolvido por leitura do código a 25/11/2026. O provisionador da adesão cria 60 meses de partições ao criar a base (`postgresProvisioner.js`, `ensureAuditPartitionsWithPool`), como na entidade instalada; não há rotação mensal a fazer até 2031. Por confirmar na VPS com uma consulta só de leitura.
- **Documentos das candidaturas** continuam adiados no staging, para todas as entidades.

## Fase 5 — ensaio na VPS (23/11/2026): segunda entidade criada, com limites

**Passou:** o comando `admission` contra o Keycloak e o PostgreSQL reais; a API a arrancar com a adesão ligada; o convite, a ativação e a ficha no browser; a criação da base `c4g_onb_e168701f6e1f493893fda1ff934a91c3` com o esquema base (033).

**Falhou:** o provisionamento parou no passo da base com `LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP`, repetido 547 vezes em cerca de meia hora até a adesão ser desligada. A entidade «Teste» ficou em `PROVISIONING`, sem ligação publicada.

- **Causa.** O provisionador tinha fixos os papéis funcionais do perfil isolado (`c4g_opportunity_tenant_runtime` para API e WORKER). No staging o agregador partilhado dos workers tem `c4g_import_worker_runtime`, concedido pela instalação; a verificação final recusa qualquer concessão que não espere.
- **Efeito lateral.** Antes de verificar, cada tentativa concedeu `c4g_opportunity_tenant_runtime` ao agregador partilhado `c4g_tenant_worker_capabilities`, que a instalação do staging não tinha. Tem de ser retirado à mão (`REVOKE`); enquanto lá estiver, as verificações que exigem o conjunto exato de papéis dos workers falham.
- **Correção.** `worker.json` passa a nomear os papéis dos dois agregadores (`tenantRoles`, obrigatório, sem valor por omissão) e o provisionador usa-os. O instalador escreve os mesmos que a instalação do staging concede. O worker guarda o passo e o código da última falha (nunca a mensagem), devolve-os em `health`, e a API escreve uma linha `C4G_ADMISSION_STEP_FAILED <passo>:<código>` por cada mudança. Depois de uma falha, a mesma adesão só é tentada de novo ao fim de 60 s.
- **Por resolver.** A base nova fica no esquema 033 e o staging está no 041: os passos 034 a 041 só são aplicados pelo `upgrade`, que não migra bases criadas pela adesão (ver «Fase 4»). Uma entidade nova fica, por isso, sem as páginas que dependem desses passos.

**Resultado depois da correção (commit `787a115`, mesmo dia).** O `REVOKE` repôs os papéis do agregador dos workers; o comando `admission` acrescentou `tenantRoles` ao `worker.json` mantendo as chaves; a adesão retomou do ponto onde tinha parado e chegou a `COMPLETE` em três tentativas (base, pessoa, credenciais), com a entidade «Teste» `ACTIVE` e o provisionamento `READY`, sem concessões a mais nos agregadores e sem linhas `C4G_ADMISSION_STEP_FAILED`. O administrador da entidade entrou e viu o Dashboard da entidade «Teste» (prova do resolvedor dinâmico de credenciais). A cópia de segurança descobriu a base nova e o teste de restauro repô-la com as 202 tabelas do manifesto.

**Não verificado no ensaio:** criar uma candidatura na entidade nova e confirmar no browser que não aparece na entidade instalada; convidar um segundo utilizador para a entidade nova (o caminho da fase 4); as páginas que dependem dos passos 034 a 041.

Lição: o provisionador só tinha sido provado em ambientes isolados, onde os papéis partilhados coincidem com os que ele assume. Qualquer passo que altere papéis ou concessões partilhadas pelo cluster tem de ser comparado com o ambiente de destino antes de correr.

## Migração do esquema das bases da adesão (23/11/2026, em Review, ensaiada no staging)

Pedido do utilizador depois do ensaio: a entidade «Teste» ficou no esquema 033 e o staging está no 041.

- **O que muda.** O comando `upgrade` passa a tratar cada base `c4g_onb_*` registada e não retirada na Central como um tenant próprio, com a identidade que a Central guardou (`tenant_id`, `database_generation_id`). Aplica-lhe os mesmos passos registados (034 a 041) e pelo mesmo caminho da entidade instalada: janela de autoridade do instalador, verificação de que a base ficou exatamente na versão do passo e publicação da observação na Central antes do passo seguinte.
- **Ordem.** Primeiro a Central, depois a entidade instalada, só depois as bases da adesão, uma a uma por ordem de nome. Os passos em falta são calculados por base.
- **Falha.** A primeira recusa pára o comando. As bases anteriores ficam migradas e as seguintes intactas; a linha `STAGING_UPGRADE_ONBOARDED_TENANT_FAILED <base> from=<versão> <código>` diz onde parou. Uma base cuja versão não coincide com a do passo nunca é registada na Central.
- **Sem `--apply`** o relatório lista cada base com a versão atual e os passos em falta e não altera nada. `--skip-onboarded` deixa as bases da adesão como estão. A recusa `STAGING_UPGRADE_ONBOARDED_TENANTS_UNSUPPORTED` deixou de existir.
- **O que não muda.** Os passos, os seus pacotes e as verificações de `backend/src/security` são os mesmos; nenhum ficheiro dessa pasta foi alterado.

Critérios de aceitação: os itens acima. Verificado com substitutos: ordem migrar → verificar → publicar, janela de autoridade fechada em caso de recusa, paragem na primeira falha, chave de idempotência por tenant.

**Não provado:** nenhum passo correu numa base criada pela adesão. A base da entidade instalada foi criada por uma sessão com a autoridade do instalador e as da adesão pelo administrador do PostgreSQL; se os pacotes exigirem o primeiro caso, recusam (`TENANT_MIGRATION_OWNER_MISMATCH` ou equivalente) sem alterar a base. O ensaio é: `upgrade` sem `--apply`, cópia de segurança, `upgrade --apply`.

### Ensaio da migração na entidade «Teste» (23/11/2026)

- **Sem `--apply`:** relatório correto à primeira (Central e entidade instalada sem passos em falta; a base da adesão em 033 com os oito passos).
- **Com `--apply`:** o passo 034 foi aplicado à base e verificado, mas o registo na Central foi recusado e o comando parou. A base ficou em 034 e a Central em 033 para essa entidade, que fica indisponível enquanto as duas não coincidirem. O papel do instalador ficou sem privilégios; a entidade instalada não foi tocada.
- **Causa.** A Central admite um só evento por chave de idempotência (`UNIQUE (idempotency_key, action_code)`), para todos os tenants. A chave do registo da observação era `<instalação>-central-observation-<versão>`, sem o tenant, e já tinha sido usada quando a entidade instalada passou pelo mesmo passo.
- **Correção.** `syncCentralObservation` aceita um âmbito para a chave; a entidade instalada mantém o da instalação e cada base da adesão usa `<instalação>-<tenant>`. Os testes com substitutos não podiam apanhar isto: a restrição só existe na base de dados.
- **Retoma.** Repetir `upgrade --apply`: os passos em falta são calculados a partir da versão real da base (034), e o primeiro registo aceite leva a Central diretamente para a versão desse passo.
- **Resultado (commit `2a2a6ad`).** Relatório com os sete passos em falta (035 a 041) só na base da adesão; `upgrade --apply` aplicou os sete, cada um registado na Central (`PUBLISHED`); base e Central em `041_account_identity_erasure`, estado `COMPATIBLE`; papel do instalador sem privilégios; entidade instalada inalterada; API pronta depois de recriada. **Por verificar no browser:** chat, estratégia e detalhe das tarefas na entidade «Teste».

## Migração automática ao criar uma entidade (24/11/2026, em Review, por ensaiar)

Pedido do utilizador: deixar de ser preciso correr `upgrade --apply` à mão depois de cada entidade criada.

- **O que muda.** Com `tenantUpgrade` no `worker.json`, o worker de adesão, logo depois de criar e publicar a base no esquema base, aplica-lhe os passos registados que faltam (034 a 041) e só então a adesão avança. Usa o mesmo módulo que o `upgrade` do instalador (`scripts/staging/tenantSteps.js`): mesma lista de passos, mesma janela de autoridade, mesma verificação e mesmo registo na Central, com a mesma chave por entidade. O comando `upgrade` continua a existir e a servir para passos futuros.
- **Opcional e nomeado.** `tenantUpgrade` tem `profile` (`staging-registered-v1`) e `installationId`. Sem a chave, o comportamento é o anterior. Um perfil desconhecido impede o arranque do worker. O instalador passa a escrevê-la; um `worker.json` antigo continua válido.
- **Só bases da adesão.** O alvo é a base que a Central regista para essa entidade, e só se for exatamente uma e tiver o nome `c4g_onb_<id>`.
- **Retoma.** Se a migração for interrompida depois de aplicar um passo e antes de o registar na Central (o caso do ensaio de 23/11), a tentativa seguinte começa por pôr a Central de acordo com a base e depois continua. Uma falha fica visível como `C4G_ADMISSION_STEP_FAILED TENANT:<código>` e é repetida ao fim de 60 s.
- **Privilégios.** O worker abre a janela de autoridade do instalador (`c4g_f12_admin` com privilégios de superutilizador) durante cada passo, como o `upgrade`. Não é um privilégio novo para o worker, que já usa o administrador do PostgreSQL, mas passa a acontecer sem um operador presente. Se o `upgrade` estiver a correr ao mesmo tempo, o worker falha esse passo e repete.
- **Duração.** Os oito passos podem demorar mais do que os 60 s de reserva de uma tentativa; nesse caso a tentativa não é confirmada e a seguinte, que já encontra tudo feito, confirma.

Critérios de aceitação: os itens acima, verificados com substitutos (ordem reconciliar → criar → migrar, alvo recusado se não for uma base da adesão, ligações fechadas, falha visível).

### Ensaio no staging (24/11/2026)

- **Passou:** a primeira entidade criada com a migração automática (`c4g_onb_27796885…`) ficou no esquema 041, com a Central em dia e o papel do instalador sem privilégios, sem intervenção.
- **Falhou a seguir:** o passo que cria a pessoa na base nova (`PROJECTION`) foi recusado 27 vezes com `UNEXPECTED_SCHEMA`. As três bases têm exatamente os mesmos esquemas e os mesmos 41 passos, por isso a base não era o problema.
- **Causa.** O provisionador verificava a base contra a lista de passos do esquema **base** (`manifest`, que acaba no 033). O verificador só alarga a escolha à lista da versão que encontra quando recebe a sua própria lista por omissão, que é a registada sob outro nome (`registeredManifest: manifest`). Com a lista base, uma base no 041 não tem entrada, nenhum esquema é permitido e todos parecem inesperados. Ontem não se viu porque a pessoa foi criada antes de a base ser migrada.
- **Correção.** As duas verificações de uma base existente no provisionador (ao criar e ao projetar a pessoa) deixam de fixar a lista base e passam a deixar o verificador escolher. A base nova continua a ser criada sobre a lista base. Nenhum ficheiro de `backend/src/security` foi alterado.
- **Resultado (commit `8cb4eff`).** O worker retomou a mesma adesão sem intervenção: a pessoa foi criada na base já no 041, as credenciais foram publicadas e a adesão chegou a `COMPLETE`. A entidade «PROJETOS» ficou `ACTIVE` com provisionamento `READY`, os agregadores partilhados ficaram como a instalação os tem e o papel do instalador sem privilégios. É a primeira entidade criada de ponta a ponta com a migração automática.
- **Por corrigir:** enquanto a entidade está em preparação, a página do cliente mostrou «Esta adesão já não está disponível» em vez de «Em preparação».

## Eliminação de utilizadores nas entidades novas (25/11/2026, em Review, por ensaiar)

Fecha o ponto «Eliminação de utilizadores» da fase 4. Antes, eliminar uma conta com adesão a uma entidade criada pela adesão parava em `PROJECTION_DELETION_UNCONFIRMED` depois de a identidade já ter sido removida, porque o worker dos convites só conhece as organizações do seu ficheiro.

- **O que muda.** O worker dos convites responde `PROJECTION_DELETION_TENANT_UNKNOWN` quando a organização não está no seu ficheiro, antes de abrir qualquer ligação. Só nesse caso a API entrega o pedido ao worker de adesão (método novo `memberErasure`), que anonimiza a pessoa na base dessa entidade com o login API dela, pela mesma função (`erase_account_identity`) e com as mesmas verificações da entidade instalada. É o mesmo desenho do convite de pessoas (`memberProjection`).
- **O que não muda.** Qualquer outra falha do worker dos convites nunca chega ao worker de adesão. Sem adesão ligada, a resposta continua a ser `PROJECTION_DELETION_UNCONFIRMED`. Nenhum login, papel ou privilégio novo; o login WORKER continua a não sair do worker de adesão. Nenhum ficheiro de `backend/src/security` alterado; sem migração.
- **Requisito.** A base da entidade tem de estar no esquema 041 (capacidade `ACCOUNT_IDENTITY_ERASURE`), o que a migração automática já garante.

Critérios de aceitação: os itens acima, verificados com substitutos. Backend 3628 aprovados, 9 ignorados, 2 falhas anteriores e alheias (SEC-AC-01) e 1 intermitente noutro ficheiro, que passa isolado; 2 testes novos e 3 alargados; lint aprovado.

**Não provado:** nenhuma eliminação real numa entidade criada pela adesão. O ensaio é eliminar no staging um utilizador de teste convidado para a entidade «Teste» e confirmar que a operação chega a `COMPLETE` e que a pessoa fica anonimizada só nessa base.

## Retenção do chat nas entidades novas (25/11/2026, por decidir)

O executor da retenção (`backend/src/chatRetention.js`) é um comando diário lançado pelo agendador do sistema, com uma lista explícita de logins WORKER. O compose do staging não o inclui e o repositório não regista que tenha sido instalado na VPS. Se não estiver a correr no staging, o ponto não é específico das entidades novas. Estendê-lo a essas entidades exige que o login WORKER delas saia do worker de adesão, o que hoje é recusado de propósito (`credentialRegistry.resolve` só entrega o login API); é uma decisão do utilizador, não um ajuste.

## Limites e decisões

- A listagem de convites lê a Central pelo pool da API. No staging a API liga à Central como administrador (decisão de 14/11/2026); numa Central com logins limitados esta leitura precisa do seu próprio perfil.
- O worker precisa de criar bases e logins: guarda credenciais de administrador do PostgreSQL na VPS. No staging o risco não aumenta pela mesma decisão; na produção terá de ser um processo separado com o seu próprio segredo.
- A produção depende de como o PostgreSQL de produção cria bases por entidade; por decidir.
- As fases 1 e 2 leem código de `backend/src/security` (coordenador de autoridade, diretório de tenants); a fase 1 não altera nenhum ficheiro dessa pasta.
