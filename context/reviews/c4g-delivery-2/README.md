# Catálogo C4G — continuação da entrega 2

2026-10-17. Incremento de consulta implementado; entrega operacional integral ainda em curso. [Contrato curto](../../features/c4g-catalog-usability.md). Reutiliza a fatia Funding & Tenders e o isolamento já implementados, sem reescrita de recolha, worker, candidaturas ou migrations.

## Resultado

- Pesquisa literal por título/identificador e programa; datas de fecho inclusivas. O servidor filtra antes do limite de 25 registos. Sem filtros de datas, registos sem prazo não são excluídos. Não há filtro implícito por perfil ou matching.
- Paginação anterior/seguinte; filtros reiniciam a paginação. Mudança de utilizador/organização desmonta o estado anterior e ignora respostas tardias. O seletor de organização mantém a navegação no catálogo.
- Listagem e detalhe mostram o modo da fonte comunicado pelo servidor. Fixture diz explicitamente que não são oportunidades reais. A listagem não promete cobertura completa.
- Estados vazio/sem resultados/erro distintos e nova tentativa. Detalhe mantém fonte oficial e criação de candidatura com revisão central exata.
- Visual C4G aplicado à listagem, filtros, detalhe e controlos ADMIN. O menu/login/identidade da entrega 1 e restante residual são preservados.

Referências principais: `frontend/src/pages/Opportunities/CentralOpportunities.jsx`, `frontend/src/c4g-shell.css`, `frontend/src/pages/FundingTenders.jsx`, `frontend/src/components/Layout/Header.jsx`, `frontend/src/api/api.js`; backend `fundingTenders/catalogQuery.js`, `http.js`, `repository.js`.

## Revisão visual

Comparação com `context/references/ui-foundations.md`, Chrome a 1440×1000 e 390×844. Identificado e corrigido: `.data-table` herdava `min-width:720px` do CSS legado, cortando programa e fecho no catálogo móvel. A asserção anterior sobre largura do documento não apanhava o corte porque o body ocultava overflow. A prova agora mede também o limite direito da tabela. Redução de movimento abrange o próprio painel da navegação; a captura aguarda o menu efetivamente oculto após resize.

Capturas deste incremento usam **apenas dados sintéticos** e autenticação de teste:

- [Catálogo desktop](catalog-desktop.png)
- [Catálogo móvel](catalog-mobile.png)
- [Detalhe móvel](detail-mobile.png)

## Verificações

| Prova | Resultado e alcance |
| --- | --- |
| Frontend `npm test -- --reporter=dot` | 100/100, 19 ficheiros. Inclui pesquisa, paginação, resposta antiga após troca de organização, erro/nova tentativa e intervalo inválido. Avisos já existentes de Router/jsdom não são falhas. |
| Backend `node --test backend/test/fundingCatalogQuery.test.js backend/test/fundingTendersSource.test.js backend/test/fundingTendersAuthority.test.js` | 16/16; limites de query/datas, fonte, precedência e guardas centrais. |
| `npm run build` | PASS, incluindo ajustes visuais finais. |
| `node --check` | PASS nos três módulos backend e dois scripts JS de integração alterados. |
| `test/integration/funding-tenders/flow.ps1` | PASS em duas execuções, a segunda após a correção visual: HTTP/PostgreSQL central+A/B, filtros positivos/negativos, datas inválidas, caracteres literais, ADMIN, worker, consulta partilhada, criação privada e recusa cruzada. Capturas finais inspecionadas: tabela móvel sem colunas cortadas, detalhe legível e menu oculto sem sobreposição. |
| `node test/integration/mobile-navigation.cjs` | PASS: teclado, contenção de foco, Escape, fecho, navegação e resize. Sessão sintética. |

O harness cria um contentor exclusivo em `127.0.0.1:5559`, serve Vite temporariamente em `http://localhost:5188` e remove apenas as suas bases descartáveis no fim. Nenhuma fonte externa é chamada. API, worker, PostgreSQL e candidatura são reais **dentro desse teste**, enquanto identidade e conteúdo da fonte são sintéticos. Não equivale a produção ou IdP externo validado. As provas históricas de crash/retoma e correções manuais continuam na evidência Funding; não foram repetidas sem necessidade.

## O que ainda falta à entrega operacional

1. Apresentar no browser oportunidades reais após a recolha autorizada. O ensaio anterior provou cinco registos no repositório, mas eliminou a base; não existem esses registos disponíveis para abrir na app. Não foi feita uma nova recolha nesta tarefa.
2. Disponibilizar composição durável identificada, com API/worker, Central+tenants compatíveis, login e atribuições reais de demonstração. A app habitual não foi reconfigurada nem reiniciada. O modo `flow.ps1 -Demo` existente é descartável e usa fixtures; não é o ambiente comercial.
3. A consulta entregue abrange a fonte Funding & Tenders ligada pela fatia atual. Não declara migrados os conectores legados nem todo o catálogo de fontes. A configuração de transporte permanece restrita a fixture/ensaio local; não foi inventado um modo produtivo sem resolver a operação.

Nenhum commit, stage, push, deploy, seed ou migration nas bases habituais. Apenas o harness explicitamente descartável prepara os seus dados. Não foram expostos segredos.

Próximo passo: preparar a demonstração persistente da fatia central com registos reais, reutilizando API, worker e percurso A/B já comprovados, sem avançar para novas funcionalidades.
