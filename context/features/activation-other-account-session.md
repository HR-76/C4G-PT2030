# Ativação com outra conta já em sessão no navegador

Estado **Retirado** — 24/11/2026, por decisão do utilizador no mesmo dia. Fica o registo e uma correção que se mantém («Conta existente sem palavra-passe»).

## O que aconteceu

- O utilizador abriu a ligação de um convite num navegador onde tinha sessão como Admin C4G. O Keycloak mostrou «Já está autenticado como outro utilizador … Por favor, finalize a sessão primeiro.» e o percurso acabou ali.
- Foi implementada uma deteção prévia (pedido silencioso `prompt=none`) com uma página «Outra conta com sessão iniciada» e um botão «Terminar sessão e continuar». No staging funcionou como desenhado: a sessão foi detetada, terminou com o clique e o Keycloak regressou à aplicação.
- Na prática baralhou o ensaio: terminar a sessão do Admin C4G para aceitar o convite deixou o navegador com a conta convidada, e o utilizador deixou de conseguir trabalhar como Admin C4G.

## Decisão do utilizador (24/11/2026)

«Quero apenas enviar o convite, e mantém como estava antes de não permitir no mesmo Browser, ou seja no mesmo computador.» A deteção, a página e o botão foram retirados. O comportamento volta a ser o do Keycloak: no mesmo navegador com outra conta em sessão, o convite não avança e é preciso outro navegador, uma janela privada ou terminar a sessão.

Retirado: o pedido silencioso e o fim de sessão em `oidcActivationAdapter.js`, a rota `/switch` e a página em `activationHttp.js`, e a definição `post.logout.redirect.uris` no comando `admission` (a que já foi aplicada aos dois clientes do Keycloak do staging fica lá; não tem efeito sem o resto).

**Não voltar a propor** terminar sessões de outras contas a partir das páginas de ativação sem pedido expresso.

## Conta existente sem palavra-passe (mantém-se)

- **Causa.** Um convite cancelado deixa a conta criada no Keycloak, sem palavra-passe. Um convite seguinte para o mesmo endereço encontra-a como «conta existente», que entra com a palavra-passe que não tem: beco sem saída.
- **Regra.** Uma conta existente que foi criada por um convite (marca `c4g_onboarding_owner`), está ativa e não tem nenhuma credencial de palavra-passe define-a pelo percurso ligado ao convite, como uma conta nova. Uma conta com palavra-passe continua a entrar com ela: um convite nunca a substitui. Uma conta criada por outra via nunca recebe palavra-passe por aqui.
- **Onde.** `keycloakAdapter.passwordSetupPending`, exposto pelos dois workers e consultado pelo adaptador de ativação. Vale para o convite de utilizador e para o de entidade.
- **Verificado no staging:** as contas criadas por convites têm a marca. **Não provado:** o percurso completo com uma conta nestas condições (a conta do ensaio já tinha palavra-passe).
