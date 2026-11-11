# MFA opcional por utilizador

Estado: Review. Pedido e âmbito integral confirmados pelo utilizador em 2026-10-17. Implementado e aplicado à instalação nativa; [evidência e limites](../reviews/optional-user-mfa.md).

## Comportamento confirmado

- MFA desativado por defeito; autenticação inicial com utilizador e password, incluindo o administrador da plataforma.
- Cada utilizador pode ativar ou desativar MFA nas definições de segurança da própria conta.
- Ativar MFA exige configurar e confirmar um autenticador; depois de ativado, os logins seguintes exigem o respetivo código temporário.
- Não usar o segredo TOTP como código de login nem pré-configurar autenticadores desconhecidos pelo utilizador.
- Preservar identidades globais, memberships, permissões, dados e distinção entre administração C4G e administração da entidade.

## Decisão confirmada

A escolha individual aplica-se a toda a aplicação, incluindo operações administrativas e sensíveis, conforme resposta explícita «Opcional em toda a aplicação». A nova política substitui a obrigatoriedade de MFA no perfil local anterior, conservando a autenticação recente para operações sensíveis e todas as restantes verificações de autoridade. Políticas históricas e ambientes anteriores permanecem disponíveis.

## Plano de implementação

1. Versionar a nova política de autenticação; conservar a política anterior para os ambientes que a utilizam e invalidar evidência de sessões incompatíveis.
2. Isolar a identidade do ambiente nativo: o administrador atual partilha a conta do realm da demonstração. Configurar identidades locais próprias, associadas aos mesmos utilizadores globais, sem eliminar as anteriores nem alterar as credenciais da demonstração. Conservar as passwords locais existentes.
3. Configurar autenticação com password e OTP condicional à ativação pelo titular. Não provisionar OTP automaticamente. Repetir a instalação não deve remover MFA escolhido pelo utilizador nem repor passwords.
4. Disponibilizar acesso autenticado às definições de segurança da conta através do fornecedor OIDC, sem expor credenciais administrativas ou segredos à aplicação.
5. Aplicar a decisão sobre operações sensíveis através de uma política explícita, mantendo todas as verificações de membership, permissões, scopes, revogação e separação de funções. Não registar password simples como evidência de MFA.
6. Atualizar as instruções locais e validar o percurso completo em ambiente isolado antes de atualizar a instalação nativa.

## Critérios de aceitação

- `admin` e `hugo` entram por defeito com utilizador/password, sem pedido de OTP e com as permissões atuais.
- Um utilizador ativa MFA por configuração e confirmação do autenticador; um login novo exige OTP e rejeita código errado. A ativação de uma conta não afeta a outra.
- O titular pode desativar MFA nas definições autenticadas; o login seguinte volta a exigir apenas password. Não existe endpoint anónimo para desativar MFA.
- Nova instalação, repetição do instalador e reinício conservam a escolha individual, as passwords e os vínculos centrais.
- Sessões com política incompatível não conservam autoridade através da mudança. A auditoria não declara MFA quando não foi comprovado.
- Política de operações sensíveis corresponde à resposta explícita do utilizador, com testes positivos e negativos.
- Demonstração e identidades anteriores preservadas; nenhuma password, segredo TOTP, token ou ligação de base aparece em logs/documentação.
- Testes automatizados focados de autenticação/autorização, sintaxe dos ficheiros backend alterados, build frontend e prova de browser real passam. Nenhuma declaração de prontidão de produção nesta alteração local.

## Resultado

Login sem OTP validado para os dois acessos nativos. Ativação/desativação e código errado comprovados no browser em conta isolada; escolha preservada após reinstalação. Passwords, identidades globais, memberships, grants e demonstração conservados. Política versionada aplicada ao login e às operações sensíveis; auditoria sem falsa evidência MFA. Página Segurança da conta e instruções locais disponíveis. Build e testes focados passaram; uma asserção global de storage do trabalho paralelo permanece identificada na evidência, sem declaração de suite geral verde.
