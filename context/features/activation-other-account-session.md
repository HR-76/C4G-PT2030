# Ativação com outra conta já em sessão no navegador

Estado **Review** — 24/11/2026, por ensaiar contra o Keycloak. Pedido do utilizador: ao abrir a ligação de um convite num navegador onde já havia sessão do Admin C4G, o Keycloak mostrou «Já está autenticado como outro utilizador 'admin-staging' nesta sessão. Por favor, finalize a sessão primeiro.» e o percurso acabou ali. «Isso não pode acontecer.»

## Causa

O Keycloak mantém uma sessão por navegador e recusa autenticar outra conta por cima dela. A recusa é uma página do próprio Keycloak, sem regresso à aplicação. Acontece em qualquer ativação (convite de utilizador ou de entidade) quando o navegador tem sessão de outra conta: o Admin C4G a testar o seu próprio convite, ou um computador partilhado.

## Decisões

- **Detetar antes.** Antes de pedir a autenticação da ativação, as páginas de ativação fazem um pedido silencioso normalizado (`prompt=none`) ao Keycloak. Sem sessão, o Keycloak responde `login_required` e a ativação segue como sempre. Com sessão, devolve a identidade de quem está em sessão.
- **Nunca terminar a sessão de outra conta em silêncio.** Se a sessão for de outra conta, a página diz-o e oferece um botão «Terminar sessão e continuar». Só com esse clique a sessão do Keycloak é terminada (pedido de fim de sessão com a identidade obtida no passo anterior, que o Keycloak aceita sem página de confirmação) e a ativação continua, sem ser preciso voltar a abrir a ligação do convite.
- **Mesma conta.** Se a sessão já for da conta convidada, a ativação segue diretamente.
- **Falha fechada para o caminho antigo.** Qualquer resposta inesperada do pedido silencioso leva ao pedido de autenticação normal, como antes desta alteração. O pior caso volta a ser a página do Keycloak, nunca um novo erro.
- **Duas sessões em simultâneo no mesmo navegador não são possíveis**: é uma regra do Keycloak. Quem termina a sessão tem de voltar a entrar com a outra conta depois.

## Critérios de aceitação

- Sem sessão no navegador: o percurso é o de antes, com mais um redirecionamento invisível.
- Com sessão de outra conta: aparece a página «Outra conta com sessão iniciada» com o botão; depois do clique a ativação continua até ao fim.
- Com sessão da própria conta convidada: não aparece essa página.
- O botão só funciona com o cookie e o token anti-falsificação da página; um pedido de outra origem é recusado.
- Um regresso de fim de sessão que a página não pediu é recusado.
- A identidade obtida no pedido silencioso só é usada para terminar a sessão; não ativa nada nem é guardada além da transação (10 minutos).

## Configuração

O Keycloak só regressa à aplicação depois de terminar a sessão se o cliente o permitir. O comando `admission` do instalador passa a definir `post.logout.redirect.uris = +` (os mesmos endereços de retorno) nos dois clientes de ativação. Sem isso, o clique termina a sessão mas o Keycloak mostra a sua página final em vez de regressar; reabrir a ligação do convite conclui a ativação.

## Ensaio no staging (24/11/2026)

- **Passou:** com sessão do Admin C4G no navegador, a página «Outra conta com sessão iniciada» apareceu, o botão terminou a sessão e o Keycloak regressou à aplicação sem página intermédia. Os três comportamentos do Keycloak de que isto dependia confirmaram-se.
- **Encontrado a seguir:** o convite levou à página de entrada, e não à de definir a palavra-passe. O endereço (`projetos@c4g.pt`) tinha recebido antes um convite que foi cancelado: esse convite criou a conta no Keycloak, sem palavra-passe, e o convite seguinte encontrou-a como «conta existente», que entra com a palavra-passe que não tem. Beco sem saída, anterior a esta alteração.

## Conta existente sem palavra-passe

- **Regra.** Uma conta existente que foi criada por um convite (tem a marca `c4g_onboarding_owner`), está ativa e não tem nenhuma credencial de palavra-passe define-a pelo percurso ligado ao convite, como uma conta nova. Qualquer outra conta existente continua a entrar com a sua palavra-passe: uma palavra-passe já definida nunca é substituída por um convite, e uma conta criada por outra via nunca recebe palavra-passe por aqui.
- **Onde.** `keycloakAdapter.passwordSetupPending`, exposto pelos dois workers (convites e adesão) e consultado pelo adaptador de ativação só quando a conta é «existente» e não tem palavra-passe pronta. Vale para o convite de utilizador e para o convite de entidade.
- **Não provado:** o percurso completo no Keycloak com uma conta nestas condições. O módulo de ativação do Keycloak já recusa contas com palavra-passe, e aceita as que não têm, independentemente de serem novas.

## Não provado

Nada disto correu contra um Keycloak real. Dependem do comportamento do Keycloak 26.8: a resposta ao pedido silencioso com o cliente de contas existentes, o fim de sessão sem página de confirmação quando leva `id_token_hint`, e o regresso com `state` a um endereço de retorno registado.
