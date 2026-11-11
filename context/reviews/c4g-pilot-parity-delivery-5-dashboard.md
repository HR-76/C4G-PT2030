# Entrega 5 — Dashboard, indicadores e relatório

18/10/2026 — **Review**. Incremento implementado, ativo e verificado no ambiente habitual. A entrega 5 integral continua em curso; aguarda comparação com o utilizador e os restantes percursos de demonstração.

## Resultado

- Dashboard original ligado aos estados e dois orçamentos recuperados. Somatórios decimais exatos; zero, ausência e soma parcial distinguíveis. Taxa de sucesso só sobre aprovadas/rejeitadas no estado atual, sem transformar candidaturas sem decisão em rejeições.
- Fontes reais do catálogo, prazos internos vencidos/próximos e data de consulta em Lisboa. Orçamento da organização em candidaturas aprovadas não é apresentado como financiamento concedido.
- Histogramas originais e tabelas por unidade, estado e candidatura. Regra humana confirmada: unidade principal atual do responsável, ou «Sem unidade atribuída». Cada candidatura conta uma vez, sem rollup de descendentes. Pessoas: fichas ativas pela unidade principal.
- `GET /api/applications/report` e `GET /api/applications/report.csv?digest=…`: mesma coleção autorizada da listagem, incluindo acesso à oportunidade e avaliação associada. Sem novas permissões, grants, migrations ou catálogos. Leitura de diretório exige as duas permissões existentes dentro da mesma guarda de autoridade, com intenção interna fechada `APPLICATION_REPORT`.
- Exportação CSV detalhada contém identificação da organização, âmbito, definição/data, candidatura, oportunidade, estado, responsável, unidade, prazos, dois orçamentos e revisão. Digest vinculado ao sujeito/organização/dados/diretório; alteração ou revogação não permite exportar a versão desatualizada. `EXPORT_ALLOWED` crítico antes de disponibilizar o conteúdo. Células protegidas contra fórmulas. Exportação usa a fila de pedidos da aplicação e descarta resultados após mudança de contexto.

## Provas

- **50 testes backend PASS**: report/browse/authority, primeira fatia de candidaturas, resumos, composição, guarda Central e auditoria F7.
- **12 testes frontend PASS**: Dashboard, fórmulas/ausentes/precisão/Lisboa/fontes/unidades, exportação desatualizada, fila autenticada e regressão da lista.
- Build frontend, `node --check` dos JavaScript alterados e `git diff --check` PASS.
- PostgreSQL 17 descartável, composição HTTP real, duas organizações e 32 candidaturas sintéticas: todos os estados; valores grandes/zero/ausentes; unidade principal e mudança de unidade; sem diretório; acesso negado; revogação; organização forjada; exportação auditada; falha de auditoria sem conteúdo. [Prova HTTP](../../output/playwright/c4g-dashboard/http-verification.json).
- Chrome 1440/390: indicadores, três vistas de relatório, 32 linhas, CSV descarregado e outra organização vazia; sem erros de página ou overflow da página. Candidaturas e diretório usam PostgreSQL/HTTP real. Apenas o endpoint de catálogo público é simulado neste ensaio e está identificado. [Prova visual](../../output/playwright/c4g-dashboard/browser-verification.json).
- Login OIDC habitual, leituras reais, CSV e recarregamento PASS. Zero candidaturas, quatro linhas de unidade incluindo o grupo sem associação; 119 registos consultados no catálogo. Fingerprints dos dados de negócio Central/tenant mantidos antes/depois; apenas auditoria e efeitos normais da sessão/verificação de prazos. [Prova habitual](../../output/playwright/c4g-dashboard/native-verification.json).
- API local reiniciada com `scripts/startDev.js`, sem migrações, seeds ou alterações ao worker. Armazenamento, antivírus e email não foram configurados. Nenhuma operação Git mutável/publicação.

## Comparação e limites

[Comparação lado a lado](../../output/playwright/c4g-dashboard/comparison.html): captura anterior do piloto, ambiente real C4G e ensaio preenchido. Imagens desktop/móvel inspecionadas; tabelas corrigidas para cabeçalhos legíveis e deslocação horizontal, zeros sem barras residuais. As capturas usam dados diferentes, não são uma comparação de totais entre bases.

O relatório é da situação atual, sem série temporal ou novo construtor de filtros. A atribuição por unidade usa a associação atual, não uma fotografia histórica. CSV é detalhado por candidatura, com unidade para conciliação; não acrescenta PDF/Excel nem uma exportação agregada separada. Financiamento efetivamente concedido não é inferido. Fonte significa proveniência persistida, não reclassificação por programa. Catálogo recolhido não implica cobertura completa das APIs.

Limites de leitura: até 10 000 linhas examinadas, 1 000 unidades, 10 000 pessoas e 900 KB de relatório/CSV; exceder recusa o resultado sem totais parciais. Teste operacional com 32 candidaturas não constitui prova de capacidade de produção nesse limite máximo. Sem diretório autorizado, tabelas por estado/detalhe mantêm o acesso existente e unidades ficam explicitamente indisponíveis.

Pendentes globais: rever com o utilizador, demonstrar os restantes percursos/papéis e isolamento integral; anexos reais, importação real Portugal 2030 e email mantêm as pendências já acordadas.

**Próximo passo:** rever a comparação e o separador «Relatório da organização» no Dashboard habitual com o utilizador.
