# Convites e ativação de utilizadores no staging

Estado: In Progress (14/11/2026). Pedido do utilizador em 14/11/2026, depois de a página Acessos responder 503 em `app-teste.c4g.ai` (`GET /api/organization-directory/access/users`). Fecha o ponto P2.1 de [staging-completion-plan.md](staging-completion-plan.md). Contratos funcionais que não mudam: [platform-entities-users-and-access.md](platform-entities-users-and-access.md), [member-activation-email.md](member-activation-email.md).

## Causa

O serviço de convites só era composto pelo instalador local (`backend/scripts/localPlatform/runtime.js`, com `memberAccess`). A API de staging arranca por `src/server.js`, que não o fornecia: as rotas `/access/users` e `/entities/:id/users` respondiam 503 e `/api/activation` não existia.

## Critérios de aceitação

- Com `MEMBER_ONBOARDING_RUNTIME=central`, a API arrancada por `src/server.js` lista e cria ativações, serve as páginas `/api/activation` e escuta a ponte que o Keycloak consulta. Sem a variável (ou com `disabled`) nada muda; qualquer outro valor impede o arranque.
- A configuração vem de uma pasta só de leitura (`MEMBER_ONBOARDING_DIRECTORY`) com `http.json` (emissor, origem pública, clientes de ativação, segredo da ponte) e `worker.json` (conta técnica do Keycloak, chave de ownership, ligação ao tenant). O arranque recusa um emissor diferente de `OIDC_ISSUER`, uma origem diferente de `PUBLIC_APP_URL` ou um segredo fora do formato.
- As credenciais do Keycloak e do email continuam fora do processo HTTP, no worker IPC. Fora do ambiente local, o worker só aceita o emissor com que a própria API autentica (`OIDC_ISSUER`), sempre em HTTPS.
- O email de ativação é obrigatório para o percurso ser utilizável: a interface nunca mostra a ligação. Sem `RESEND_API_KEY`, `ACTIVATION_EMAIL_FROM` e `ACTIVATION_PUBLIC_URL`, a ativação fica criada e a interface mostra «envio de email ainda não está configurado».
- O ambiente local não muda de comportamento.
- Nenhum segredo entra no Git, em logs ou na saída de comandos.

## Levantamento da VPS (14/11/2026)

Keycloak 26.8.0 de imagem oficial, contentor `c4g-staging-keycloak-keycloak-1` (projeto compose `c4g-staging-keycloak` em `/srv/c4g-staging`, rede `c4g-staging-keycloak_default`, comando `start`), sem providers instalados. O Caddy só expõe `/realms/c4g-staging` e `/resources`: a API de administração não é pública.

## Implementação

- `src/platformOnboarding/memberRuntime.js` (composição fora do instalador local) e ligação em `src/server.js`.
- Worker de identidade: admite o emissor da API e, fora do ambiente local, um `adminOrigin` privado para a API de administração do Keycloak (`keycloakAdapter.js`). O token continua a ser pedido ao emissor público; isto exige o `hostname` do Keycloak fixo, que o instalador verifica.
- Comando `members` do instalador de staging (`scripts/staging/install.js`): `--prepare` escreve `http.json` e as propriedades do módulo; sem a opção, corre na rede do contentor do Keycloak, cria clientes, fluxo e conta técnica e escreve `worker.json`. Segredos gerados uma vez e mantidos ao repetir.
- `compose.yaml`: o `pod` junta-se à rede do Keycloak com o alias `c4g-activation-bridge`; a API monta `/srv/c4g-staging/members` e lê, se existir, `activation-email.env`.
- Módulo Keycloak (`dev/keycloak/manual-activation`): `Bridge.java` admite também `http://c4g-activation-bridge:5285/bridge/check`. O JAR é montado na imagem oficial; a imagem não muda.
- Runbook: [deploy/staging/README.md](../../deploy/staging/README.md), secção «Convites e ativação de utilizadores».

## Verificação (14/11/2026)

- `backend/test/memberRuntime.test.js`: seleção e recusas de configuração, portas do worker, páginas de ativação, ponte com e sem segredo, encaminhamento em `server.js`, fecho, e o worker a recusar um emissor que não seja o da API.
- `backend/test/stagingMembers.test.js`: ficheiros gerados, segredos mantidos ao repetir, recusas do comando `members` (emissor não fixo, administração recusada, alvo inválido) e a API de administração chamada na origem privada.
- Backend: 3290 testes, 3281 aprovados, 9 ignorados, 0 falhas; lint limpo.
- Não verificado: nada correu contra um Keycloak real nem na VPS. O módulo Java não foi compilado nesta máquina (sem Maven nem Docker); a criação dos clientes e do fluxo pelo comando `members` só foi exercitada no ambiente local, pelo instalador local. O nome do serviço e a porta interna do Keycloak (`http://keycloak:8080`) são presumidos.

## Limites conhecidos

- `worker.json` guarda o snapshot do tenant; depois de um `upgrade` do tenant é preciso regenerá-lo.
- A ponte e a API de administração usam HTTP dentro da rede Docker privada do Keycloak, na mesma máquina.
- As páginas de ativação limitam contextos por endereço; atrás do Caddy e da Cloudflare o endereço visto é o do último proxy de confiança.

## Por decidir

- Remetente e domínio verificado no Resend para o staging; enviar só para endereços de teste.
