# Auditoria CSS, movimento e expressão visual C4G

29/10/2026 — melhorias implementadas localmente. [Contrato e critérios](../features/css-motion-quality.md).

## Conclusão

A base visual é coerente com uma aplicação profissional C4G: petróleo na navegação e nos quadros de dados, fundos claros, ação verde, tipografia de sistema e iconografia linear. O caráter tecnológico já está presente no contraste, na apresentação dos dados e no loader orbital. O problema principal era a consistência das primitivas partilhadas e o crescimento da cascata, não a ausência de decoração ou animações.

A passagem preserva os layouts e a paleta. Melhora foco, controlos, legibilidade da navegação, movimento funcional e comportamento das ajudas.

## Evidência e correções

| Achado | Correção aplicada |
| --- | --- |
| `btn-secondary` só definida dentro de cartões de organização | Variante global branca, borda e hover petróleo; retirada a definição local redundante. |
| Botões desativados continuavam a mudar com hover | Cinco variantes existentes passaram a exigir `:not(:disabled)`; mesma regra na nova variante secundária. |
| `.status-select` anulava o outline com `!important` | Removida supressão; foco petróleo visível. Campos partilhados receberam contornos mais definidos e halo coerente. |
| Sete `transition: all` nos estilos base | Propriedades explícitas e tokens de 120/180 ms; dimensões não são animadas por estes controlos. |
| Confirmação e algumas transições ignoravam movimento reduzido | Política global cobre CSS carregado por rotas, loaders, diálogos e controlos; preserva transforms necessários ao estado do menu. |
| Sidebar e shell disputavam transforms por `!important` | Regras responsivas centralizadas no CSS base; shell conserva só o estado de recolha desktop. |
| Sidebar usava apenas `100vh`; confirmação podia exceder janelas baixas | Sidebar com `100dvh` e fallback; confirmações com limite dinâmico de altura e scroll em todas as larguras. |
| Rótulos pequenos em maiúsculas e alvos reduzidos no cabeçalho | Rótulos de navegação em caixa normal; controlos de menu/alertas 40px, 44px em móvel. |
| Perfil da organização e subseção ativos simultaneamente | Correspondência exata no item de perfil; unidades/pessoas ficam com um único destaque atual. |
| Tooltip não fechava com Escape nem permitia acompanhar o texto com o ponteiro | Estado explícito, Escape sem perder foco, ponte de 8px acima/abaixo e painel fechado sem interceptar eventos. |
| `.btn-sm` repetida; cursor de ação em todas as linhas de tabela | Uma definição com os valores efetivos anteriores; cursor reservado às linhas explicitamente interativas. |

Os tokens novos centralizam foco, halo, contorno de controlos, superfície de hover, duração e easing. FormModal e InfoTooltip consomem os tokens partilhados. O modal recebe apenas uma entrada breve em resposta à abertura, sem animações de páginas/cartões.

## Qualidade remanescente

- Inventário inicial: 26 folhas CSS, cerca de 3065 linhas, 60 `!important`, sete `transition: all` e 173 valores hex distintos. Inventário final: 27 folhas, 3101 linhas, 51 `!important`, zero `transition: all` e 172 valores hex. Um ficheiro de enriquecimento de oportunidades surgiu durante trabalho paralelo, fora desta auditoria; as contagens finais não representam exclusivamente este delta.
- Persistem valores cromáticos locais e CSS histórico em `index.css`; uma futura consolidação por componentes deverá ser incremental e acompanhada de provas visuais. Não foi feita uma remoção automática de seletores supostamente sem uso.
- Branco sobre ação `#39751F`: contraste calculado de 5,62:1; branco sobre petróleo `#075B59`: 7,93:1; texto secundário `#4B5560` sobre branco: 7,59:1. Verde vivo `#5FAD2F` sobre branco fica em 2,80:1 e continua reservado a acentos, sem substituir a ação escura.
- `framer-motion` permanece instalado mas sem imports no frontend auditado. Não foi necessária outra biblioteca de movimento nem alteração ao lockfile.
- ConfirmDialog/BillingDialog ainda diferem de FormModal no isolamento do fundo e gestão de scroll/foco. Isso constitui trabalho funcional separado; esta passagem corrigiu os limites visuais de confirmação, sem declarar resolvida toda a acessibilidade dos modais.
- Não equivale a uma certificação WCAG nem a cobertura de todas as combinações de estado/página. A inspeção visual desta passagem incidiu nos componentes partilhados, dashboard, diretório, menu e modal.

## Validação executada

| Prova | Resultado |
| --- | --- |
| CSS em Chrome isolado, antes → depois | 6/16 → 16/16; falhas reproduzidas antes das correções. |
| Navegação, regressão antes → depois | Duas falhas de dupla seleção → 14/14 testes do shell. |
| Tooltip, regressão antes → depois | Três falhas → 5/5 testes do componente. |
| Foco conjunto dos quatro componentes | 26 PASS. |
| APP em Chrome com API sintética | 16/16 PASS em 1440/768/390, sem overflow, erros JavaScript ou pedidos de escrita. |
| Tooltip em browser | Escape/foco, painel fechado sem interceptação e travessia lenta de rato em ambas as orientações PASS. |
| Frontend completo | 400 PASS / 1 FAIL; mesma falha em DirectLogin já observada antes: 394 PASS / 1 FAIL. |
| Backend completo | 1653 PASS / 6 FAIL / 7 SKIP; seis falhas em `fundingEnrichmentPersistence.test.js`, fora dos ficheiros alterados. Nenhum backend modificado. |
| Build Vite e verificação de whitespace | PASS. |

Falha frontend: `offers an explicit retry for an expired authentication without restarting under StrictMode`. Falhas backend: descoberta de enrichment, persistência idempotente e quatro fixtures de evidência. Preservadas e registadas, sem enfraquecer expectativas ou alterar funcionalidades alheias ao pedido. As execuções iniciais de testes/build foram bloqueadas por `spawn EPERM`; as repetições locais autorizadas fora da sandbox permitiram concluir a validação.

Capturas finais inspecionadas com as transições concluídas: dashboard desktop, diretório desktop, menu móvel e modal móvel. O primeiro conjunto capturou frames iniciais de animação no menu/modal; a ferramenta de captura foi ajustada para finalizar animações finitas antes das imagens finais. Os testes de movimento permanecem separados.

Evidência: `output/css-motion-audit/`, `output/playwright/css-motion-{before,after}/` e `output/playwright/css-motion-app-{before,after}/`. Scripts reexecutáveis: `css-motion-check.cjs --after` e `css-motion-app-check.cjs --after` em `output/playwright/`. Os testes usam CSS real ou build real com respostas sintéticas; não provam integração real OIDC/API/PostgreSQL.

Sem commit, deploy, migrações, pedidos de escrita de negócio ou alterações de dados. Trabalho anterior e paralelo preservado.
