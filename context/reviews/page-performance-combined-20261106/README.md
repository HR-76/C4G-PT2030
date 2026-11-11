# Abertura de páginas — correções e comparação de 06/11/2026

Dashboard e perfil institucional melhoraram de forma repetida no browser real. A lentidão transversal da aplicação **não está resolvida**: Candidaturas continua perto de 4,5–4,8 segundos neste ensaio. As alterações estão no código; não houve deploy, reinício do ambiente habitual ou intervenção nas suas bases.

## Alterações aceites

- Dashboard: catálogo central seguido de relatório e resumo privado numa única operação tenant protegida. Elimina duas aquisições completas redundantes do contexto de execução. Exige conjuntamente APPLICATION_READ e OPPORTUNITY_READ; dados de unidades exigem também as duas permissões de diretório/estrutura. Mantém validações de autoridade, RLS, auditoria síncrona, checkpoints e guarda antes do commit. Não introduz cache de autorização nem altera o protocolo global, schema, grants ou limites dos pools. Contrato HTTP e projeção mantidos.
- Perfil institucional: a abertura carrega apenas o contexto apresentado. Unidades são consultadas ao entrar em Unidades/Pessoas, com contexto fresco e invalidação das respostas anteriores. Não usa dados antigos de outra organização.

Ficheiros runtime: `backend/src/applications/composition.js`, `backend/src/applications/contracts.js`, `backend/src/routes/organizationDashboardRoutes.js` e `frontend/src/pages/Organization/OrganizationProfile.jsx`. O shell, API global e Candidaturas são byte a byte iguais às fontes congeladas antes deste incremento.

## Tempos completos até apresentação dos dados

Medianas, em segundos; A anterior, B corrigida. Abertura numa página nova do browser já autenticado; navegação através dos links reais da aplicação. Não são tempos de login nem LCP. A condição de pronto exige resposta principal concluída, ausência do indicador de carregamento e duas frames de renderização; Candidaturas exige também uma linha visível da tabela.

| Página | Abertura A | Abertura B | Variação | Navegação A | Navegação B | Variação |
|---|---:|---:|---:|---:|---:|---:|
| Dashboard | 7,96 | 4,12 | −48,2% | 6,74 | 3,14 | −53,4% |
| Perfil institucional | 7,36 | 4,78 | −35,0% | 6,28 | 3,89 | −38,1% |
| Candidaturas, controlo sem alteração | 4,50 | 4,75 | +5,4% | 3,37 | 3,37 | +0,03% |

Intervalos de abertura: dashboard A 7,47–8,20 / B 3,93–4,45; perfil A 7,10–7,61 / B 4,69–4,93; candidaturas A 4,34–4,54 / B 4,42–4,86. A pequena amostra não permite atribuir causalidade à variação de Candidaturas nem estimar p95 de produção. Nenhuma medição foi excluída.

Os pedidos auxiliares continuam depois de a página apresentar dados. Mediana até `networkidle` (inclui a espera do browser): dashboard 8,41 → 6,56 s; perfil 8,28 → 8,12 s; candidaturas 6,96 → 7,22 s. Logo, o ganho de apresentação no perfil não representa redução equivalente de todo o trabalho de rede.

## Método e evidência

Quatro execuções sequenciais **A/B/B/A**, sem suites/build concorrentes, cada uma com 6 aberturas e 3 navegações: **36/36 medições concluídas**, sem respostas API falhadas nas aberturas e com respostas principais 200 nas navegações. Por variante/página: 4 aberturas e 2 navegações. Duas organizações sintéticas, cada uma com 1000 candidaturas e 250 pessoas; PostgreSQL 18.6, central 050, Keycloak e login OIDC/PKCE reais. Infraestrutura Docker descartável, portas loopback, sem bases habituais.

Fontes anteriores congeladas com SHA-256 e carregadas por adaptador apenas na variante A; builds Vite separados. Todas as execuções terminaram COMPLETE e com integridade de fontes inalterada. Imagens Docker iguais; fontes/harness iguais entre execuções, builds iguais dentro de cada variante. Limites: máquina local, dados sintéticos, amostra pequena, instrumentação com amostragem PostgreSQL de 100 ms; role do leitor central da fixture tem `pg_read_all_data`. Não é prova de capacidade/SLO de produção.

- [Comparação reproduzível e valores individuais](comparison.json), gerada por `node context/reviews/page-performance-combined-20261106/compare.cjs`.
- Resultados e manifestos: [A1](../page-performance-combined-a1-20261106/results.json), [B1](../page-performance-combined-b1-20261106/results.json), [B2](../page-performance-combined-b2-20261106/results.json), [A2](../page-performance-combined-a2-20261106/results.json). Cada pasta contém `sources.json` e `run-config.json`.
- Harness: `test/integration/page-performance/`; builds em `.tmp/page-performance/combined-build-A` e `combined-build-B`.

## Segurança e regressões

[Gate real de segurança e concorrência](../page-performance-combined-security-load-20261106/results.json): COMPLETE, integridade preservada. Identidade/organização cruzada recusada; falta de APPLICATION_READ ou OPPORTUNITY_READ recusa a resposta; sem diretório omite unidades; falha de auditoria impede publicação (503). Verificações RLS, roles e acesso cruzado também aprovadas. Quatro dashboards simultâneos devolveram 200 e total 1000.

Na revogação concorrente, a leitura já protegida terminou o commit antes do commit da revogação; os pedidos posteriores foram recusados (403). Esta é a ordem garantida pelo protocolo existente, não cancelamento retroativo de uma leitura protegida. A prova regista a ordem dos commits, além da resposta posterior.

Regressões locais cobrem permissões, falha privada depois do relatório, membership, política, commit, prazo, auditoria, desconexão, ordenação e contexto cruzado. Perfil tem regressão para não consultar unidades na abertura e consultá-las ao entrar na respetiva página. RED/GREEN realizado antes/depois das correções.

- Backend completo final: **2709 PASS, 7 SKIP, 0 FAIL**.
- Frontend completo: **812 PASS, 0 FAIL**; build Vite e sintaxe backend PASS.
- Três testes de observadores históricos usam explicitamente a rota A congelada e verificada por hash, porque medem o antigo protocolo de quatro etapas. Não são prova da rota atual; esta é coberta pelos testes `httpDashboard*`, composição e gates reais acima. Foram removidos três casos redundantes de etapas que deixaram de existir, mantendo cobertura das duas etapas atuais.
- Logs locais `pages-combined-backend-final.log`, `pages-combined-frontend.log` e `pages-combined-build-final.log` na pasta de artefactos Codex desta sessão.
- Contentores próprios removidos pelo wrapper; consulta final por labels não encontrou recursos remanescentes.

## Experiências rejeitadas e falhas preservadas

Leitura nativa/compacta de constraints centrais teve apenas cerca de 5–8% no microbenchmark e não foi aplicada. Protótipo de prioridade dos pedidos auxiliares teve ganho pequeno na apresentação e quase duplicou o tempo até concluir auxiliares: retirado integralmente do runtime, fontes/testes arquivados em `rejected-priority`, resultados v2 A1/B1 preservados.

Tentativas preliminares do harness falharam por condição de prontidão e bloqueio de ficheiros estáticos em `.tmp`; não entram na comparação. A primeira versão combinada usou uma intenção não aceite pelo protocolo fechado (503); foi corrigida para a intenção existente antes das medições finais. Uma expectativa inicial de revogação assumia cancelamento da leitura em curso; foi substituída pela prova explícita da ordem dos commits, sem alterar o protocolo. Uma execução local de testes encontrou EACCES de loopback no sandbox; repetição autorizada passou. Relatórios/logs anteriores foram preservados, sem os misturar com esta comparação.

## Prioridades ainda abertas

1. Reduzir o custo comum de execução/autorização e metadados por pedido, mantendo checkpoints e frescura. Não voltar a aceitar microbenchmarks como prova suficiente de abertura das páginas.
2. Medir e otimizar a geração/leitura de notificações: na B1, geração demorou cerca de 2,7–4,0 s e leitura 2,2–2,3 s, sobrepostas com a página. O simples adiamento já foi testado e rejeitado.
3. Candidaturas: pedidos de unidades e browse demoraram cerca de 2,7 e 3,4 s na primeira abertura B1. Investigar composição/consultas com planos reais, preservando paginação e filtros; a página não ficou mais rápida neste incremento.
4. Expandir medição para oportunidades, matching, pessoas, unidades e restantes páginas, com dados representativos e metas de latência acordadas. Não extrapolar o ganho das duas páginas corrigidas para todas as outras.

PERF-01/02/03 permanecem em curso. Este incremento demonstra ganhos concretos em duas páginas e identifica a lentidão que continua visível.
