# Hierarquia e cores dos botões — verificação

Data: 30/10/2026. [Contrato](../features/button-color-hierarchy.md).

## Resultado

Implementação e revisão concluídas, sem bloqueadores. Ações principais conservam o verde escuro; ações de apoio usam contornos neutros; ações destrutivas distinguem o início discreto da confirmação preenchida. Saída tem rótulo visível e vermelho claro sobre o fundo de navegação. Interesse ativo usa selo verde com visto, arquivado usa selo neutro e estados desconhecidos não indicam sucesso.

## Alterações

- `frontend/src/index.css`: tokens semânticos de ação/perigo/estado, variantes coerentes, contraste de hover e saída; removidas definições antigas duplicadas do logout.
- `frontend/src/c4g-shell.css`: retirado o override vermelho indiscriminado do texto do interesse.
- `Sidebar.jsx` e `EntityAdmission.jsx`: ícone decorativo, rótulo de saída e variante adequada ao fundo escuro. Os handlers permanecem os mesmos.
- `CatalogInterestButton.jsx`, `CatalogInterests.jsx` e `interests.css`: selo depende explicitamente de `ACTIVE`/`ARCHIVED`; «Ver interesse» conserva destino e retorno; submissão apresenta «A guardar…» e `aria-busy` enquanto aguarda.
- Remoções de participantes, parceiros e itens de formulários, cancelamento de tarefa/importação, revogações, suspensão de acesso e operações destrutivas de faturação recebem a variante vermelha adequada. Confirmação de revogação PQ1 e cancelamento de documento fiscal deixam de parecer ações neutras/positivas. «Rever» mantém menos destaque que confirmar.
- Cancelar edição/diálogo, voltar, reativar acesso e arquivar conservam a sua semântica. Confirmações nativas, como cancelar convite, continuam a usar a apresentação do browser.

Alterações limitadas à apresentação; handlers, comandos, payloads, autorização, persistência e contratos HTTP preservados. O worktree já continha a implementação de interesses e outros trabalhos não relacionados; esses trabalhos foram preservados.

## Regressões e suites

Regressões acrescentadas antes da implementação e reproduzidas em RED: rótulo visível/saída única; saída da adesão apenas após resposta de gravação; distinção dos estados de interesse e ausência de sucesso prematuro; confirmação de suspensão, revogação e cancelamento de documento/ciclo. Os testes focados passaram depois das correções.

| Verificação | Resultado |
| --- | --- |
| Frontend `npm test` | 60 ficheiros; **473 PASS**, zero falhas |
| Backend `npm test` | **1953 PASS**, zero falhas, **7 SKIP** |
| Frontend `npm run build` | **PASS** |
| `git diff --check` nos ficheiros alterados | **PASS**; apenas avisos de normalização LF/CRLF |
| Revisão do código | Sem bloqueadores pendentes |
| Browser Chromium, 1440 e 390 px | **PASS**: contraste, hover, foco, estados, links e ausência de overflow |

Não foram observadas falhas preexistentes nas suites desta execução. Os logs incluem os avisos/erros simulados esperados de alguns testes; o resultado final das suites é zero falhas. A sandbox bloqueou inicialmente subprocessos com `spawn EPERM`; as repetições locais autorizadas fora da sandbox passaram. Esse bloqueio não foi classificado como falha do produto.

Logs: `output/button-color-hierarchy-validation/frontend-tests.log`, `backend-tests.log` e `frontend-build.log`.

## Revisão visual e acessibilidade

Fixture isolada em memória com `Sidebar`, `CatalogInterestButton` e `ConfirmDialog` reais, mais os estilos reais de `index.css`, `c4g-shell.css`, `interests.css` e `registration.css`. Servidor temporário exclusivamente localhost e mocks locais; não foram usados dados reais nem chamadas à API habitual.

Capturas desktop/mobile inspecionadas; botões, selos e confirmação legíveis, sem sobreposição. Navegação de retorno, abertura do interesse e handlers de confirmação/saída verificados na fixture. A fixture não substitui um ensaio HTTP/OIDC completo; este incremento não altera esses contratos.

| Par medido no browser | Contraste normal | Hover |
| --- | --- | --- |
| Branco / verde principal | 5,618:1 | 7,805:1 |
| Vermelho / superfície branca | 4,829:1 | 5,915:1 |
| Branco / confirmação vermelha | 4,829:1 | 6,470:1 |
| Saída em vermelho claro / teal | 5,478:1 | 4,608:1 |
| Interesse ativo / verde suave | 5,036:1 | — |
| Interesse arquivado / neutro | 7,119:1 | — |

Todos os pares ativos medidos cumprem 4,5:1. Corrigidos durante a revisão: hover vermelho sobre rosa claro (escurecido para `#B91C1C`) e foco na saída da adesão (especificidade suficiente para prevalecer sobre o CSS da rota). Foco de teclado visível em ambas as superfícies de saída.

Artefactos reproduzíveis e medições: `output/playwright/button-color-hierarchy/verify.cjs`, `fixture.jsx` e `verification.json`. Capturas: `buttons-1440.png`, `buttons-390.png`, `confirm-1440.png`, `confirm-390.png`, `logout-1440.png` e `logout-390.png`. `sandbox-attempt-error.json` conserva a tentativa inicial bloqueada pela sandbox; o resultado final autoritativo é `verification.json` com `PASS` e zero erros do browser. Browser e servidor próprios encerrados.

## Seguimento

Pronto para revisão funcional do aspeto na aplicação pelo utilizador. Nenhuma operação de publicação faz parte deste incremento.
