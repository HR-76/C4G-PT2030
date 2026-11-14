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

## Implementação

- Feito: `src/platformOnboarding/memberRuntime.js` (composição fora do instalador local), ligação em `src/server.js`, worker a admitir o emissor da API.
- Por fazer, dependente do levantamento do Keycloak na VPS: comando `members` do instalador de staging (clientes, fluxo e conta técnica no realm; escrita de `http.json` e `worker.json`), montagem da pasta e da ponte no `compose.yaml`, e o módulo Keycloak `dev/keycloak/manual-activation`, cujo `Bridge.java` só admite hoje `http://host.docker.internal:5285/bridge/check`.

## Verificação (14/11/2026)

- `backend/test/memberRuntime.test.js`: seleção e recusas de configuração, portas do worker, páginas de ativação, ponte com e sem segredo, encaminhamento em `server.js`, fecho, e o worker a recusar um emissor que não seja o da API.
- Backend: 3283 testes, 3274 aprovados, 9 ignorados, 0 falhas; lint limpo.
- Não verificado: nada correu contra um Keycloak real nem na VPS; sem a variável, o staging continua a responder 503 nestas rotas.

## Limites conhecidos

- `worker.json` guarda o snapshot do tenant; depois de um `upgrade` do tenant é preciso regenerá-lo.
- As páginas de ativação limitam contextos por endereço; atrás do Caddy e da Cloudflare o endereço visto é o do último proxy de confiança.

## Por decidir

- Remetente e domínio verificado no Resend para o staging; enviar só para endereços de teste.
- Como o Keycloak da VPS recebe o módulo (imagem reconstruída ou JAR montado) e por que rede chega à ponte.
