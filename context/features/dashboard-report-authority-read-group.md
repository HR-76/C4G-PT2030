# Dashboard — leituras de autoridade do relatório

Estado: Review — 31/10/2026. Implementação e medição antes/depois concluídas. [Resultado e limites](../reviews/dashboard-report-authority-read-group.md).

## Problema e âmbito

O dashboard invoca o relatório de candidaturas. As duas pré-autorizações opcionais de diretório/unidades executam, por decisão, uma leitura de membership e outra de política F5 em transações centrais separadas. O agrupamento fresco `withAuthorityReads` já existe, mas a composição só o ativa em `partnersBrowse`.

Aplicar esse mesmo agrupamento apenas ao método `report`, incluindo o relatório invocado pelo dashboard. Preservar `partnersBrowse`; `reportExport` e restantes métodos mantêm o comportamento anterior. Não alterar métricas, CSV, contratos HTTP, SQL, autorizações opcionais ou arquitetura multi-instituição.

## Implementação e critérios de aceitação

1. Criar e executar regressões antes da alteração de produção, usando a composição real para provar a ativação exclusiva em `report` e a preservação dos restantes métodos.
2. Agrupar apenas membership e política de cada decisão fresca. No caminho com as duas pré-autorizações permitidas, quatro transações passam a duas. Manter ordem, consultas, argumentos, curta-circuitação, recusas, prazo partilhado e verificações frescas.
3. Terminar cada grupo antes da política tenant e da auditoria. Não envolver a autorização inteira, o relatório, `prepare`, a lease ou a finalização num novo callback. Não reutilizar resultados entre decisões, pedidos ou organizações.
4. Preservar recusa de membership/revogação, falhas de leitura/commit/deadline, isolamento concorrente e reentrância no `prepare`. Não aumentar pools, limites ou timeouts.
5. Executar testes focados, suites completas backend/frontend, build, sintaxe e revisão independente. Registar falhas preexistentes separadamente.

## Medição autorizada

Preparar observação exclusiva no processo de ensaio, sem flags/endpoints de benchmark em produção. Comparar baseline sem o novo agrupamento e candidato no mesmo processo, configuração, sessão e dados; um aquecimento por variante e dez pares alternados AB/BA sequenciais. Medir HTTP e etapas do dashboard, contagem de transações centrais e equivalência dos resultados, excluindo apenas campos voláteis explicitamente identificados. Não apresentar contagens ou doubles como latência PostgreSQL.

Reutilizar a composição local e identidade existentes apenas se estiverem disponíveis e sem interferir com a aplicação ou trabalhos paralelos. Leituras funcionais autenticadas e auditoria/login normais pertencem ao ensaio pedido. Não executar migrations, grants, seeds, importações, retoma de escritores, reinícios de serviços alheios ou gates de preparação contra Dev. Qualquer infraestrutura adicional fica fora deste incremento. Interromper em falha de autoridade, HTTP ou divergência; publicar resultados negativos e limites. Registar apenas tempos, contagens e hashes, nunca credenciais, cookies, SQL parametrizado ou dados privados.

### Método concretizado e trabalho paralelo

As portas habituais 3000/5000/5285 estão ocupadas pela aplicação. O ensaio usa exclusivamente um listener próprio em `localhost` e porta efémera, com a composição de produção, configuração local, roles e pools originais. Só expõe GET do resumo da organização configurada. O login OIDC ocorre na aplicação existente; o contexto do browser gere o cookie normalmente, sem exportação. Não inicia nem reinicia a aplicação habitual, identidade, bridge ou workers. O host verifica readiness, recusa HTTP sem sessão (smoke 401) e fecha apenas os recursos próprios.

O observador regista transações a partir do router do dashboard; o middleware global de sessão anterior fica fora desses contadores. O tempo HTTP do cliente cobre o pedido completo. Configuração (runtime, `.env` e leitor central), ledger central e fontes relevantes são comparados por hash, e as respostas/fingerprints têm de permanecer equivalentes em todos os pares.

Durante a preparação, um trabalho paralelo acrescentou `readResponsibleDirectory` à composição. O guard recusou corretamente a baseline original. Preservar essa baseline e derivar outra com a alteração paralela presente nos dois braços, retirando apenas a condição `report` no braço anterior. Exigir que candidato e baseline derivada difiram byte a byte apenas nessa condição, com hashes e proveniência fixados. Não atribuir ao agrupamento qualquer efeito da alteração paralela.

## Preservação e fecho

Preservar a árvore de trabalho existente e os ensaios anteriores. Alteração mínima na composição, regressões e harness próprio. Guardar evidência em `output/dashboard-report-authority/` e um relatório em `context/reviews/`. Sem commit, merge, push ou deploy. Só concluir melhoria de latência se a comparação real a demonstrar.

## Resultado

Alteração mínima entregue com 12 regressões da composição e nove do observador. Comparação final: 22/22 HTTP 200, respostas/fingerprints equivalentes, 18 snapshots frescos por pedido e 553 fontes estáveis. Transações de autoridade 35→33 e físicas 70→66. Mediana HTTP 5105,49→4886,73 ms (−4,28%); mediana do relatório 1890,59→1700,12 ms (−10,07%). A média HTTP aumentou 1,21% devido a uma amostra candidata de 7867,05 ms, conservada integralmente. Nove dos dez pares foram mais rápidos, mas não há melhoria da média nem resolução da demora global demonstradas. Revisão independente confirmou a aritmética e as fronteiras.
