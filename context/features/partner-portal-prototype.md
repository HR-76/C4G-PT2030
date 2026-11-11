# Parceiros — protótipo isolado do portal SQL

Estado: **Review — 27/10/2026**. Autorização explícita: implementar o protótipo separado do runtime ativo, começando pelos testes de regressão. Base: [contrato C1–C6](partner-sql-pagination.md) e [desenho candidato](../research/partner-sql-adapter-design.md). [Resultado e evidência](../reviews/partner-portal-prototype/README.md).

## Âmbito

Criar `backend/prototypes/partnerSqlPortal.js`, importado apenas pelos testes; sem composição, rotas, arranque, feature flag ou dependência nova. Recebe os mesmos ports server-side de organização, actor, protect, authorize e cursor e expõe apenas `partnersBrowse(client,id,input)`. O input já passou pelo parser atual; o client pertence à transação/lease exterior. Reutilizar canonicalização e tokens atuais. A projeção/filtros/comparadores privados são reproduzidos no protótipo para não extrair/refatorar o runtime ativo neste incremento; a equivalência automatizada controla essa duplicação provisória.

Testes primeiro, usando dados sintéticos e doubles estritos do protocolo DECLARE/FETCH/CLOSE. Não executar SQL contra bases, criar infraestrutura, alterar migrations/grants/permissões/dados Dev/configuração, publicar Git ou fazer deploy. A prova PostgreSQL isolada permanece um passo distinto.

## Critérios de aceitação

1. Registar RED antes de criar o protótipo. Mesmos 16 cenários reutilizáveis C2–C6, sem mudar o oracle, e compatibilidade bidirecional dos cursores legados.
2. Regressões para os três pares NFC com comparação portuguesa zero e IDs inversos, países empatados distintos, canonicalização vs autoridade posterior e projeção estruturalmente inválida.
3. Guard/schema antes de DECLARE, nome interno único seguro, organização parametrizada, joins organizacionais, `NO SCROLL WITHOUT HOLD`, FETCH sequenciais de 100 e sentinela de um após 10000; nenhuma autorização do excedente.
4. CLOSE antes do sucesso; erros de consulta/fecho falham fechados, sem retry/fallback. Preservar erro primário e usar apenas client preparado; rollback/commit/role/isolamento pertencem ao executor exterior. Não contornar a lease para cleanup.
5. Doubles verificam a ordem dos comandos, a captura simulada entre lotes, falhas em cada fase, expiração e falta de resposta parcial. Não apresentar doubles como prova de snapshot/RLS/cleanup PostgreSQL real.
6. Testes focados, suites completas backend/frontend, build frontend e `node --check` dos novos JavaScript. Registar falhas preexistentes/skips separadamente; preservar todo o trabalho anterior e provar ausência de import pelo runtime.
7. Registar contagens antes/depois sobre o mesmo dataset sintético e respostas iguais. Não apresentar tempos de doubles como desempenho PostgreSQL nem afirmar que foi eliminada a seleção em memória ou o scan global.

## Plano

Testes do protocolo e testes de equivalência em ficheiros separados → RED com candidato ausente → implementação mínima isolada → GREEN → revisão independente → suites/build e conferência do worktree. Não ativar o candidato neste incremento.

## Resultado

Protótipo implementado sem import pelo runtime ativo. RED registado com os dois ficheiros de teste a recusarem carregar por módulo ausente; depois 49 novos testes PASS (24 equivalência/contraexemplos e 25 protocolo). Foco conjunto 80/80; suite backend 1418 PASS/0 FAIL/7 SKIP; frontend 346 PASS/55 ficheiros e build PASS; sintaxe dos quatro JavaScript novos PASS.

Precisão de cleanup confirmada pelo executor real: o prepared client só expõe `query()`, sem estado transacional público. Após falha de query própria ou do port authorize, o protótipo não envia outro comando: deixa rollback/descarte ao owner exterior. Após erro local tenta CLOSE pelo mesmo prepared client, preservando o erro primário. Erros de runtime reconhecidos mantêm identidade; falhas SQL próprias são sanitizadas. Não foram alteradas interfaces de lease, transação ou autoridade.

Contagens com doubles sobre o mesmo dataset: schema/scan/portal 102→104 comandos para 10000 candidatos, mesmas 20000 chamadas de autorização e resposta byte a byte igual. Não há benchmark PostgreSQL nem prova de RLS/snapshot/cleanup físico; o custo global e a paginação em memória permanecem.

**Próximo passo:** preparar o gate PostgreSQL descartável para provar snapshot, RLS, revogação, cleanup e capacidade antes de integrar; a execução de infraestrutura exige âmbito isolado autorizado.
