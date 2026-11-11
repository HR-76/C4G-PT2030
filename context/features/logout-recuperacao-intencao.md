# Recuperação de envio pendente após falha de logout

Estado: Em implementação, 10/11/2026. O utilizador autorizou reproduzir a falha em testes isolados e corrigi-la caso confirmada.

## Contrato e aceitação
- Uma candidatura com resultado incerto mantém a intenção e chave de idempotência se o logout falhar sem confirmação; a mesma sessão deve poder repetir o envio com a chave original.
- Logout confirmado e resposta LOGOUT_INCOMPLETE que termina a sessão limpam as intenções antes da navegação. Invalidação de pedidos de sessão antigos e isolamento por utilizador/entidade mantêm-se.
- Não restaurar intenções após terminar a sessão nem permitir que outro utilizador as repita. Verificar falha, repetição, sucesso e logout incompleto; suites frontend e build.

## Resultado e validação
- Regressão RED reproduziu perda da intenção e da chave após erro de rede no logout. A correção conserva intenções de candidatura nas falhas sem confirmação e limpa-as após logout confirmado ou LOGOUT_INCOMPLETE; outras limpezas de sessão permanecem como antes.
- Teste de envio incerto, logout falhado e repetição confirmou a mesma chave; testes verificam limpeza na saída confirmada/incompleta e isolamento de outro utilizador. 17 testes focados PASS; frontend completo 92 ficheiros/826 testes PASS; build PASS.
- Os testes de navegação imprimem avisos do jsdom (navegação não implementada), mas as asserções e o processo passaram. Não foi exercitado OIDC real nem feito teste com bases ou serviços externos.

## Prova OIDC isolada — 10/11/2026

[Execução r6](../reviews/oidc-logout-recovery-20261110-r6/results.json): Keycloak OIDC, PostgreSQL e contas sintéticas na mesma entidade. Os quatro cenários registaram PASS: candidatura confirmada no servidor com resposta simulada como 503; falha simulada de logout conservou sessão e intenção; repetição com a chave original devolveu o mesmo applicationId e limpou a intenção; segunda identidade OIDC na mesma aba não recuperou a intenção da primeira. A troca de identidade foi simulada através da remoção dos cookies e novo login, preservando sessionStorage; não é prova de logout real entre utilizadores.

O relatório global é FAIL porque o fingerprint das fontes mudou durante a execução. Ficheiros observados como alterados na comparação final: `backend/src/config/documentWorkerInfrastructure.js`, `frontend/src/pages/Interests/InterestFlow.test.jsx`, `frontend/src/pages/Interests/intentions.js`, `frontend/src/pages/Interests/useInterestCommand.js`, `frontend/src/pages/Opportunities/CatalogExposureGate.jsx`, `frontend/src/pages/Opportunities/CatalogReadWorkspace.test.jsx` e `frontend/src/pages/Opportunities/catalogReadSession.js`. As alterações não foram revertidas. Também ocorreram erros de pedidos em curso durante o encerramento dos pools. Logo os cenários são evidência parcial, não validação integral com fontes estáveis. A execução r5 teve os mesmos quatro PASS, mas também falhou a verificação de integridade; tentativas anteriores falharam por problemas de teste/fixture. Não se usaram contas ou bases habituais.
