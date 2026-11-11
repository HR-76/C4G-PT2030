# MFA resistente a phishing para acesso privilegiado

## Objetivo e estado

Exigir autenticação multifator resistente a phishing para utilizadores privilegiados e operações de alto risco. Estado: especificação de trabalho; não implementada nem ativada. TOTP e autenticação recente por palavra-passe não satisfazem este requisito.

## Âmbito

- Abranger administradores C4G, suporte, administradores de organizações e operações classificadas como sensíveis. Validar o inventário dos perfis, operações e percursos de administração fora do catálogo funcional antes da ativação.
- Usar WebAuthn/FIDO2 com verificação do utilizador obrigatória num fluxo do fornecedor de identidade que não permita regressão para um fator menos forte quando a garantia é pedida.
- Versionar uma categoria distinta de assurance e associá-la a uma prova de autenticação verificada no servidor. O ACR e os valores AMR só podem ser definidos após comprovação do fluxo e dos claims assinados emitidos pelo fornecedor em ambiente de ensaio; um nome de claim, por si só, não comprova que o fluxo é resistente a phishing.
- Exigir recência, identidade correspondente e versão reconhecida da política. Revalidar a garantia na autorização e no ponto de commit das operações sensíveis, incluindo step-up e rotação de sessão.
- Definir inscrição, substituição e revogação dos autenticadores, recuperação e acesso de emergência com controlos proporcionais; esses percursos não podem permitir contornar silenciosamente o requisito.
- Preparar a migração coordenada das políticas de autorização e das evidências persistidas. Sessões e políticas antigas não são prova da nova categoria; falhar fechado em caso de ambiguidade ou divergência.

## Critérios de aceitação

1. Um utilizador abrangido só inicia sessão ou conclui uma operação abrangida após prova válida, recente e específica do fluxo resistente a phishing.
2. Palavra-passe, TOTP, ACR/AMR ausentes ou desconhecidos, prova expirada, identidade divergente e versão antiga são recusados. A recusa é auditada sem guardar credenciais nem tokens.
3. Os percursos de inscrição, perda, revogação, recuperação e emergência são exercitados sem reduzir a garantia exigida para operações sensíveis.
4. O teste de integração usa o fornecedor real em ambiente isolado, autenticador WebAuthn e claims assinados reais; comprova o fluxo, a ausência de fallback e o comportamento de step-up e rotação de sessão.
5. A ativação só ocorre depois de confirmar configuração do fornecedor, cobertura das operações, prontidão dos utilizadores, recuperação e rollback controlado. Testes sintéticos e alterações de código isoladas não demonstram que o requisito está ativo em produção.

## Dependências por confirmar

Versão e configuração efetivas do Keycloak, domínio RP/origens, semântica dos claims emitidos, métodos de inscrição e recuperação, perfis abrangidos e implantação efetiva. A configuração real e a migração de dados de autorização exigem planeamento e validação em ambiente isolado.
