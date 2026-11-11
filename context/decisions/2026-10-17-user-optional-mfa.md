# MFA por escolha individual

Decisão confirmada pelo utilizador em 2026-10-17: «Opcional em toda a aplicação», incluindo ações administrativas e sensíveis.

O login inicial usa utilizador/password. MFA fica desativado por defeito e é ativado/desativado pelo titular nas definições autenticadas da própria conta. A ativação exige confirmar o autenticador e os logins novos passam a exigir o código. Não provisionar segredos TOTP automaticamente para contas de utilizadores.

Esta decisão substitui a obrigatoriedade geral de MFA dos contratos anteriores. Mantém autenticação recente nas operações sensíveis, memberships centrais, permissões explícitas, scopes, separação de funções, revogação e auditoria. Uma autenticação com password não pode ser registada como MFA.

A política reconhecida `c4g-user-mfa-v1` concretiza a decisão. A política antiga permanece imutável para compatibilidade com demonstrações/ambientes anteriores; não é o comportamento pretendido para novos acessos do produto. A alteração foi aplicada à instalação nativa local, sem configurar produção nem alterar os acessos da demonstração. [Contrato](../features/optional-user-mfa.md), [evidência](../reviews/optional-user-mfa.md).
