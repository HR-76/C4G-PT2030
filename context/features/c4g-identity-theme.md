# Identidade visual do login Keycloak

Pedido confirmado: aplicar também as cores C4G à página de login do fornecedor de identidade apresentada pelo utilizador.

Âmbito: tema herdado de `keycloak`, apenas CSS e logótipo existente. Paleta igual ao frontend: #075B59, #5FAD2F, #39751F e branco. Sem alterações a credenciais, sessões, permissões ou fluxos.

Aceitação: login local apresenta fundo verde-petróleo, cartão branco, logótipo C4G e botão verde com texto legível; formulário e botão de visibilidade da palavra-passe permanecem funcionais; layout sem overflow em móvel. Configuração persistida para futuras instalações do ambiente F2.

Validação 2026-10-17: tema aplicado no Keycloak local `c4g-f2-integration-keycloak-1`, realm `c4g-test`. Chrome headless com página OIDC real: cores computadas confirmadas, campos presentes, toggle da palavra-passe funcional e ausência de overflow a 390px. Capturas desktop/móvel em `.tmp/c4g-keycloak-desktop.png` e `.tmp/c4g-keycloak-mobile.png` inspecionadas. Sem submissão de credenciais. Tema montado no compose e selecionado no import do realm para persistência. Implementação por herança CSS conforme https://www.keycloak.org/ui-customization/themes.
