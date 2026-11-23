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
- **Upgrade do esquema.** O comando `upgrade` só migra a base da entidade instalada. Passa a listar as bases criadas pela adesão (`onboardedTenants`) e recusa aplicar passos tenant quando existem (`STAGING_UPGRADE_ONBOARDED_TENANTS_UNSUPPORTED`), para não as deixar num esquema antigo sem aviso. `--skip-onboarded` prossegue de forma explícita; os passos só da Central não são afetados.
- **Cópias de segurança.** Já descobrem todas as bases `c4g_*` ([staging-backups.md](staging-backups.md)).

**Por fazer (cada um exige contrato e prova própria)**

- **Migrar as bases das entidades novas.** O `upgrade` teria de aplicar os passos tenant a cada base `c4g_onb_*` e sincronizar a observação na Central. O caminho existente só foi exercitado com a entidade instalada e não tem testes com base de dados; estendê-lo sem um gate em PostgreSQL descartável seria alterar migrações às cegas. Até lá, um upgrade tenant com entidades novas exige `--skip-onboarded`, e essas entidades podem ficar indisponíveis até serem migradas.
- **Retenção do chat.** `CHAT_RETENTION_CREDENTIALS_JSON` é uma lista explícita por organização com o login WORKER. As entidades novas não entram: as suas conversas não são eliminadas aos 90 dias. O login WORKER delas existe no registo cifrado, mas a fronteira do worker só expõe o login API.
- **Eliminação de utilizadores** (`USER_DELETION_RUNTIME=central`): a anonimização da pessoa no tenant só conhece as organizações do ficheiro dos convites.
- **Rotação mensal das partições de auditoria** nas bases novas: o provisionamento cria as partições iniciais; a rotação por base não foi verificada.
- **Documentos das candidaturas** continuam adiados no staging, para todas as entidades.

## Limites e decisões

- A listagem de convites lê a Central pelo pool da API. No staging a API liga à Central como administrador (decisão de 14/11/2026); numa Central com logins limitados esta leitura precisa do seu próprio perfil.
- O worker precisa de criar bases e logins: guarda credenciais de administrador do PostgreSQL na VPS. No staging o risco não aumenta pela mesma decisão; na produção terá de ser um processo separado com o seu próprio segredo.
- A produção depende de como o PostgreSQL de produção cria bases por entidade; por decidir.
- As fases 1 e 2 leem código de `backend/src/security` (coordenador de autoridade, diretório de tenants); a fase 1 não altera nenhum ficheiro dessa pasta.
