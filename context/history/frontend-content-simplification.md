# Simplificação do conteúdo do frontend

Fecho formal: 26/10/2026.

Foram concluídas três passagens editoriais nas rotas ativas, removendo texto redundante e preservando ações, erros, consequências, requisitos e estados necessários. O `InfoTooltip` reutilizável mantém o contexto secundário acessível por rato, teclado e tecnologia assistiva, com comportamento responsivo.

As validações registadas incluem testes direcionados, suites frontend, builds e provas Playwright desktop/mobile sem overflow. Na reconferência, nove ficheiros relacionados executaram 39 testes com sucesso; a suite global executou 52 ficheiros/314 testes com sucesso antes de parar no parse de `EntityAdmission.jsx`, alheio a este recorte.

[Contrato e evidência completos](../features/frontend-content-simplification.md).
