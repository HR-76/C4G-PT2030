# Entrega 1 — acesso e visibilidade C4G

Data: 2026-10-17. Âmbito: incremento 1 do [plano de fecho](../../features/c4g-app-closure-plan.md), explicitamente autorizado. Ambiente habitual: **http://localhost:3000**, API 5000, PostgreSQL nativo 5432. Implementação e revisão técnica local; a apreciação visual pelo utilizador continua pendente.

## Resultado

- `admin` entra em Fontes de oportunidades e consulta lista/detalhe do catálogo comum sem precisar de membership numa entidade. O cabeçalho identifica a administração da plataforma, sem seletor vazio. Não são apresentadas ações, contagens ou consultas de candidaturas privadas nesse contexto.
- `hugo` entra no catálogo com C4G ativa; conserva o seletor, candidaturas autorizadas, perfil, unidades e pessoas. Um administrador que também tenha memberships continua a poder escolher uma organização; não se infere ausência de memberships apenas do papel de plataforma.
- O menu dá prioridade ao trabalho diário/organização ou às fontes/catálogo, conforme o contexto. Recolhe por defeito até 1100 px, pode ser ocultado também em desktop e mantém abertura, Escape, contenção e devolução do foco por teclado.
- Na janela de 1008×620, o conteúdo usa toda a largura e a primeira linha da tabela fica integralmente visível. Tabela sem deslocamento horizontal nas larguras verificadas; datas sem quebra a meio em desktop/intermédio. Informação de cobertura/prazos conservada numa secção expansível, com ambiente e indicação de catálogo parcial sempre visíveis.
- Entrar diretamente numa área organizacional sem organização apresenta a razão e ligações de saída; não monta o componente que consultaria dados privados.

## Fronteira técnica

Novo endpoint de leitura: `GET /api/admin/central-opportunities` e `GET /api/admin/central-opportunities/:id`. Exige autenticação OIDC, sessão de servidor e identidade/atribuição `C4G_ADMIN` ativas na Central. A autoridade é consultada dentro da transação somente de leitura que obtém o catálogo. Não aceita uma organização como filtro nem permite escrita.

O endpoint de cliente `/api/central-opportunities` conserva a resolução/validação organizacional. Nenhuma alteração a memberships, grants, MFA, bases, migrations ou credenciais. O ADMIN de plataforma não passa a equivaler a administrador de todas as organizações.

| Código | Alteração |
|---|---|
| `backend/src/fundingTenders/http.js:30`; `repository.js:128` | Router de plataforma e leitura com autoridade explícita; reutilização das consultas/filtros existentes |
| `backend/src/app.js:111`; `backend/src/productionComposition.js:199` | Composição do endpoint, indisponível por defeito se a integração central não estiver composta |
| `frontend/src/api/api.js`; `pages/Opportunities/CentralOpportunities.jsx:15` | Cliente próprio de plataforma, catálogo comum reutilizado e ações privadas condicionadas ao contexto organizacional |
| `frontend/src/pages/Opportunities/OpportunityListTable.jsx:6`; `OpportunityPresentation.jsx:38` | Tabela pública sem chamar o serviço privado nem mostrar coluna de candidaturas |
| `frontend/src/utils/navigation.js:1`; `App.jsx:38` | Entrada útil por runtime/papel; guardas existentes preservadas |
| `frontend/src/components/Layout/Sidebar.jsx:30`; `Layout.jsx:28`; `Header.jsx`; `OrganizationSelector.jsx:28` | Navegação por contexto, seleção sem becos sem saída e adaptação de largura/teclado |
| `frontend/src/c4g-shell.css:2` e `:113` | Menu compacto/recolhível e legibilidade da tabela, limitados ao shell C4G |

## Provas

**46 testes frontend, 18 testes backend, build Vite e verificações de sintaxe: PASS.** Backend cobre leitura sem tenant, recusa a membro comum, atribuição revogada/identidade inativa, sessão/autenticação, escrita recusada e manutenção da fronteira de cliente. As simulações de revogação pertencem aos testes automatizados; não foram revogados acessos reais na instalação habitual.

Chrome real, OIDC local e contas existentes, através de `node test/integration/local-platform/accessNavigation.js`. O script bloqueia pedidos de escrita de negócio, não clica em atualização de fonte e compara hashes/contagens de tabelas de negócio antes/depois, em transações PostgreSQL somente de leitura. Login e consultas podem gerar os eventos normais de sessão/auditoria.

| Verificação integrada | Resultado |
|---|---|
| ADMIN: catálogo comum, filtros, histórico, recarregamento e quatro detalhes | 200; nove registos totais/quatro com prazo atual nesta data; fonte oficial acessível por ligação |
| ADMIN: endpoint de catálogo de cliente sem organização | 404, conforme contrato existente |
| ADMIN: candidaturas/diretório privados sem contexto autorizado | 409 |
| Gestor: catálogo de plataforma/fontes administrativas | 403 |
| Gestor: header de organização alheia | 409; não é uma repetição de toda a prova A/B histórica |
| Gestor: catálogo, perfil, pessoas, unidades e candidaturas autorizadas | Disponíveis; candidaturas 200; ação de candidatura manual preservada |
| Larguras e teclado | 1008×620, 1280, 1440 e 390; menu, Escape, Tab/Shift+Tab e restauro do foco |
| Preservação | Nove oportunidades, 17 revisões, quatro recolhas e dados do diretório conservados; zero recolhas/escritas de negócio; sem erros JavaScript de página |

Evidência automática: [verificação e medidas](../../../output/playwright/c4g-access-navigation/verification.json). Capturas inspecionadas: [ADMIN na janela de referência](../../../output/playwright/c4g-access-navigation/admin-catalog-viewport-1008.png), [gestor na mesma janela](../../../output/playwright/c4g-access-navigation/manager-catalog-viewport-1008.png), [menu](../../../output/playwright/c4g-access-navigation/manager-menu-1008.png), [pessoas](../../../output/playwright/c4g-access-navigation/manager-people-1008.png), [perfil](../../../output/playwright/c4g-access-navigation/manager-profile-1008.png). Outras larguras e detalhes estão no mesmo diretório.

O primeiro arranque do Vitest foi impedido por `spawn EPERM` da sandbox; a execução autorizada fora dela passou. A CLI Playwright não estava em cache; foi usado o Playwright/Chrome já disponível no projeto, sem instalação. A primeira passagem integrada detetou uma expectativa errada do ensaio: catálogo de cliente recusa com 404, não 409. Corrigida apenas essa expectativa depois de confirmar o contrato; nenhuma recusa foi relaxada. Captura de diagnóstico `failure.png` preservada como evidência dessa passagem, não como estado final da aplicação.

## Limites e revisão com o utilizador

Esta entrega não recupera Dashboard, Matching ou Alertas, não completa a equipa e não aumenta a cobertura da fonte. Mantêm-se três unidades e uma pessoa, conforme a consolidação anterior. Não foi feita recolha externa, criação de candidatura/documento, validação de produção ou reativação da demonstração arquivada. Residual e histórico preservados; sem Git mutável.

Para rever: atualizar `http://localhost:3000/catalogo` na janela habitual; com `admin`, confirmar catálogo sem seletor vazio; com `hugo`, confirmar C4G ativa e acesso ao perfil. Usar o botão do menu no canto superior esquerdo e comparar a leitura das tabelas. A próxima ação é esta revisão visual, antes de iniciar a entrega 2.
