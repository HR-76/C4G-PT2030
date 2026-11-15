# Gestão de acessos da Central com MFA opcional

Estado: Review (15/11/2026). Implementação e testes locais concluídos. Pedido aprovado: corrigir a gestão de acessos, manter MFA opcional e incluir testes, sem alterar staging nem fazer deploy.

## Contrato

A Administração C4G deve poder alterar o perfil e o estado de uma membership com a política de autenticação privilegiada configurada e validada no arranque. Em `c4g-user-mfa-v1`, exige autenticação recente (`recent-auth`, até 300 segundos); MFA continua a ser uma opção individual. Uma autenticação por password não é apresentada nem registada como prova de MFA. A política histórica `c4g-assurance-v1` mantém a sua exigência de MFA quando explicitamente selecionada.

A consulta continua disponível com sessão válida depois de expirar a autenticação recente. Uma alteração com evidência ausente, expirada, futura ou de outra versão é recusada antes de qualquer escrita ou auditoria de sucesso. A interface permite confirmar a sessão segundo a política devolvida pelo servidor e regressar ao mesmo ecrã; não reenvia automaticamente a alteração.

Mantêm-se a verificação de administrador ativo e sessão, organização ativa, membership da organização alvo, proteção do próprio acesso, revisão, idempotência, grants por organização e auditoria na transação. Não há mudança de SQL, migração057, perfis PostgreSQL, política de autenticação global ou configuração de staging.

## Critérios de aceitação

- Perfil e estado aceitam autenticação recente sem MFA na política opcional; a composição usa a categoria privilegiada configurada.
- A política estrita continua a recusar password sem MFA; configuração ausente não permite alterações.
- Recusas de autenticação opcional devolvem `REAUTH_REQUIRED`/403; a política estrita preserva `MFA_REQUIRED`/403.
- As verificações de autorização, organização, revisão e auditoria continuam aplicadas; uma repetição idempotente também revalida autorização e autenticação.
- O frontend oferece «Confirmar sessão» nos dois casos, usa apenas uma política válida, conserva o destino local e ignora respostas tardias de outra entidade.
- Testes de regressão falham antes da correção e passam depois; suites completas de backend/frontend, lint, sintaxe e build aprovados. Registar separadamente quaisquer limitações.

## Validação

Regressões executadas antes da correção: a política opcional recusava as alterações válidas, a composição entregava um requisito indefinido e as rotas convertiam `REAUTH_REQUIRED` em 503. No frontend, os nove novos casos falhavam pela ausência da ação de confirmação. Após a correção:

- Backend focado: 35 testes aprovados (serviço, composição, rotas e consulta/autorização de acessos).
- Frontend focado: 36 testes aprovados em três ficheiros (acessos, utilizadores da entidade e confirmação de sessão).
- Backend completo: 3436 testes, 3427 aprovados, 9 ignorados existentes, zero falhas.
- Frontend completo: 1150 testes aprovados em 128 ficheiros, zero falhas.
- Preparação de produção: 7 testes aprovados; lint, sintaxe dos cinco ficheiros backend alterados, build frontend e `git diff --check` aprovados.
- Revisão independente de segurança/regressões sem falhas acionáveis.

[Recibo desta validação](../reviews/central-production-permissions-20261115/access-optional-mfa.json), sobre o commit base `b32d334d94e9b40cb0741d6984067d99bebd34ee`. Logs locais em `.tmp/access-optional-mfa-*.log`.

A falha de auditoria é testada com um coordenador simulado: prova propagação e ausência de confirmação, não rollback real de PostgreSQL. Não se repetiu o gate PostgreSQL nesta correção, que não altera SQL, migrações nem permissões físicas. OIDC real/browser e a release integrada continuam a exigir o ensaio isolado previsto no runbook. Apenas alterações locais; sem staging, commit, push ou deploy.
