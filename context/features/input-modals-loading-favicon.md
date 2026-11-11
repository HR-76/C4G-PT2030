# Inputs, carregamento e favicon

Pedido de 28/10/2026. Estado: Review — implementado e validado localmente.

## Âmbito

Melhorias de apresentação sobre o runtime C4G atual, sem alterar contratos HTTP, memberships, perfis ou ativação. Implementar modal em Adicionar utilizador, indicador partilhado de carregamento e favicon C4G legível. O pedido autoriza este trabalho visual; os processos anteriores permanecem intactos.

## Análise de inputs

| Fluxo atual | Avaliação |
| --- | --- |
| EntityUsers: adicionar utilizador | Modal prioritário: três campos e revisão, mantendo a listagem no contexto. Implementar neste incremento. |
| OrganizationProfile: criar/renomear/mover unidade | Bom candidato seguinte: ação curta sobre uma linha da estrutura. |
| EntityInvitation: novo convite | Candidato: dois campos e revisão; a consulta e entrega de ligações devem continuar na página. |
| OrganizationProfile: registar/editar pessoa | Avaliar separadamente: afetação a muitas unidades pode tornar o formulário extenso. |
| Perfis, candidaturas, oportunidades e ciclos financeiros | Manter espaço de página para edição extensa e consulta contextual. |
| Filtros e pesquisa nas listagens | Manter visíveis junto dos resultados. |

## Critérios de aceitação

- Adicionar utilizador abre diálogo acessível com nome, email e perfis fornecidos pelo servidor, conservando revisão e pedido idempotente.
- Foco contido, Escape/Cancelar/Fechar e retorno ao botão de abertura; fundo sem interação e conteúdo adaptado a ecrãs pequenos.
- Durante envio ou resultado incerto, impedir fecho e correções; erro e repetição do mesmo pedido acessíveis dentro do modal.
- Loader com ícone e texto anunciado nos carregamentos de sessão, módulos de página e estados de carregamento de dados substituídos; respeitar movimento reduzido.
- Favicon vetorial próprio C4G, sem reutilizar os antigos ícones UBI nem o logótipo horizontal como favicon.
- Regressões de modal e loader, suite frontend e build; suite backend como verificação global pedida pelas regras locais. Sem gates externos.

## Plano

1. Fixar regressões de modal e ícone nos testes existentes.
2. Criar componentes partilhados e integrar o fluxo de utilizador e carregamentos.
3. Adicionar favicon SVG e atualizar referência HTML/manifest.
4. Executar validações e registar limites da revisão.

## Resultado e validação

- Modal partilhado com portal, fundo inert, bloqueio de scroll, foco contido, Escape e retorno ao botão; integração em EntityUsers, incluindo erros e repetição de pedidos incertos dentro do diálogo.
- LoadingIndicator com ícone Lucide, texto de estado e prefers-reduced-motion; aplicado a sessão, módulos de rotas e mensagens de carregamento em 12 ficheiros de páginas (13 estados).
- Favicon SVG compacto C4G ligado no HTML e manifest. Recursos antigos preservados; ícone Apple continua a usar o logótipo C4G existente.
- Regressão inicial: 3 falhas esperadas (modal ausente, repetição fora do modal e ausência de ícone), 6 testes existentes passaram. Duas provas adicionais verificam contenção do foco, scroll, mudança de etapa e bloqueio de fecho.
- Suite frontend: 56 ficheiros, 350 testes PASS. Backend: 1585 PASS, 0 FAIL, 7 SKIP preexistentes. Build Vite PASS. Logs em `output/ui-inputs-frontend-tests.log` e `output/ui-inputs-backend-tests.log`.
- Verificação Chrome com API sintética: desktop 1366×900 e mobile 390×844, formulário e revisão, foco inicial, Escape e retorno ao botão, ausência de overflow horizontal e erros de página. Capturas revistas em `output/playwright/input-modal-*.png`; favicon em `output/playwright/favicon-preview.png`. Script: `output/playwright/input-modal-check.cjs`.
- Limites: sem teste com dados reais, sem gate PostgreSQL, sem deploy. As recomendações de restantes modais são análise, não implementação deste incremento. Contratos HTTP e backend intactos.

## Incremento 2 — autorizado por «Avança» — Review

Aplicar FormModal a criar/renomear/mover unidade e Novo convite. Critérios: preservar campos, permissões, revisão de convite e comandos HTTP; abrir com foco no primeiro campo, conter foco e restaurá-lo ao cancelar; bloquear fecho durante envio/resultado incerto; apresentar erro e repetição dentro do modal. Manter recuperação persistida das unidades e o tratamento de recusas definitivas existente. Pessoas e descrição continuam na página. Consulta, preparação e emissão de ligações dos convites continuam fora do modal.

Plano: regressões antes da alteração, integração dos dois ecrãs, testes focados/completos e build, verificação Chrome com respostas sintéticas em desktop/mobile.

Resultado: os três formulários de unidade e Novo convite usam FormModal. Feedback e repetição ficam dentro do modal durante resultados incertos; fecho/correções bloqueados até resultado conhecido. Recusas definitivas de unidades mantêm o comportamento anterior, com fecho do editor e feedback na página. Formulários de pessoas/descrição e fluxo de emissão de ligações preservados.

Validação: regressão inicial 6 FAIL/13 PASS; suite final frontend 357 PASS em 56 ficheiros (7 testes novos, uma regressão existente reforçada); backend 1585 PASS/0 FAIL/7 SKIP preexistentes; build PASS. Logs `output/ui-modals-2-{red,focused,frontend,backend,build}.log` preservados, incluindo a tentativa focada intermédia (expectativa corrigida para verificar `:disabled` herdado de fieldset).

Chrome isolado com API sintética: três ações de unidades, convite e revisão em 1366×900 e 390×844; foco inicial/contido, Escape, retorno ao botão, ausência de overflow horizontal e erros de página. Capturas em `output/playwright/unit-*.png` e `output/playwright/invitation-*.png`; script `output/playwright/unit-invitation-modals-check.cjs`. Inspeção visual concluída. Sem backend/contratos HTTP alterados, dados reais, gate externo ou deploy.

Próximo passo: revisão visual pelo utilizador na aplicação.
