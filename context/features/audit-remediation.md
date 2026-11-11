# Correções da auditoria de 06/11/2026

Estado: In Progress

Pedido: corrigir os problemas identificados na auditoria estática, preservando o trabalho existente.

## Incremento 6 — auditoria estática de 09/11/2026

### Resultado da consulta completa — Review

Confirmado em PostgreSQL 18.6 descartável: 144 medições alternadas com equivalência de resultados/digests, RLS, 28 casos temporais e cursores assinados aprovados. A listagem usa só a projeção de prazo factual final; a auditoria paralela introduziu `SET LOCAL jit = off`, incluído explicitamente na confirmação final. Nenhuma alteração ao fingerprint completo, permissões, limites, schema ou protocolo de autoridade. A hipótese de otimizar comparações de intervalos por máximo não foi implementada: a mitigação JIT demonstrou ganho sem essa mudança adicional.

Com 10 mil candidaturas sintéticas mistas, medianas primeira página 1339 → 573 ms, profunda 1293 → 536 ms, pesquisa 957 → 192 ms. Com mil registos, diferenças pequenas e algumas regressões ligeiras. Não extrapolar para HTTP/navegador ou produção. A primeira comparação falhou a integridade por alteração concorrente; evidência preservada, seguida de confirmação com fontes estáveis e cleanup aprovado. Backend 2733 PASS/7 SKIP/0 FAIL, frontend 814 PASS e build PASS; primeira execução backend teve bloqueios sandbox EACCES, resolvidos pela repetição com loopback permitido, sem alterar testes. [Relatório](../reviews/browse-confirm-20261109/README.md) e [validação](../reviews/browse-confirm-20261109/validation.md). Sem bases habituais, deploy ou commit. O incremento está em Review; a investigação transversal anterior permanece aberta.

### Plano e diagnóstico anteriores

Continuação autorizada: medir consulta completa em ambiente isolado e corrigir o que os resultados justificarem. Usar PostgreSQL descartável, instalador/migrações reais, duas organizações sintéticas, role funcional com RLS, parâmetros extraídos de `createSqlBrowse`, primeira página/página profunda, pesquisa e equipa. Guardar planos e tempos, preservar baseline antes de qualquer alteração. Identidade/autorização de entrada sintetizada: este gate SQL não substitui OIDC/HTTP. Qualquer candidato deve manter resultados/digests byte a byte, recusa cruzada e invalidação após alterações fora da página; nenhuma alteração de schema, grants, limites ou protocolo de autoridade sem evidência e validação próprias. Suites completas/build se houver alteração produtiva. Autorização inclui criação e remoção apenas dos recursos descartáveis deste ensaio; não aceder às bases habituais.

Pedido: corrigir DOC-001 e investigar PERF-001 da auditoria por amostragem desta data. Os IDs PERF-01/02/03 anteriores permanecem distintos; PERF-001 é uma hipótese sobre o custo do fingerprint de `applications/browseSql.js`, não uma regressão medida.

Plano e aceitação antes de implementação:
- DOC-001: alinhar AGENTS e standards com as entradas independentes API/worker e migrações Central/tenant; distinguir implantação local documentada de produção não verificada. Verificação por confronto com código e LOCAL.md.
- PERF-001: preservar integralmente visibilidade, digest, contagens, ordenação e invalidação dos cursores. Preparar medição isolada do fingerprint com dados sintéticos e planos SQL; não alterar runtime sem medições de consultas representativas. O microbenchmark do fingerprint apenas isola um custo, não substitui o percurso HTTP nem demonstra uma correção.
- Qualquer otimização posterior exige regressão antes da alteração, equivalência de respostas e cursores, isolamento/revogação, suites locais e comparação controlada antes/depois. Não usar bases habituais ou fornecedores externos.
- Proxy, implantação, recuperação e controlos assinalados como não verificados continuam a ser verificações pendentes, não defeitos confirmados a corrigir por inferência.

Estado: documentação corrigida; diagnóstico isolado em `test/integration/application-browse-fingerprint/` autorizado pelo utilizador e executado em 09/11. Nenhuma alteração ao SQL produtivo. Medianas e planos confirmam custo incremental crescente (~2,7/32/153 ms para 1 mil/10 mil/50 mil registos sintéticos), sem prova de gargalo HTTP. Cleanup corrigido e validado na repetição; zero contentores remanescentes. [Resultados, incidente e limites](../reviews/browse-fingerprint-20261109-r2/README.md). Próxima etapa: planos da consulta real representativa antes de selecionar uma otimização.

Validação em 09/11: parser PowerShell PASS; `node --test backend/test/applicationBrowse.test.js backend/test/applicationInterestLink.test.js` 13 PASS/0 FAIL. Estes testes usam doubles e não validam custo/plano PostgreSQL. O SQL sintético foi depois executado duas vezes; a segunda execução terminou com código 0 e cleanup automático. Não foram repetidos suites completas/build, pois não houve alteração de código produtivo; serão necessários para a futura otimização.

## Incremento 1 — autenticação e cache

- AUTH-01: recuperar de falha de descoberta OIDC sem reiniciar a API; partilhar tentativas concorrentes e limitar repetições com espera progressiva, sem repetir trocas de códigos.
- SEC-01: respostas em `/api/auth`, incluindo recusas anteriores ao router e erros de parsing, recebem `Cache-Control: no-store`.
- UX-01: uma falha de rede/503 na validação inicial da sessão apresenta recuperação explícita; apenas 401 significa sessão ausente. Nunca apresentar conteúdo protegido antes da validação. Cancelar pedidos abandonados.
- Regressões primeiro; testes focados, suites locais completas e build. Não usar bases habituais. Gates externos apenas com autorização específica.

## Incrementos de desempenho

### Recolha externa — cancelamento durante retry

O utilizador autorizou corrigir os riscos identificados, mantendo o ensaio no R2 real adiado. No conector Funding & Tenders, o sinal de cancelamento deve interromper também a espera de retry após 429/5xx, devolver `SOURCE_TIMEOUT`, não iniciar outra tentativa e libertar o temporizador padrão e listeners. Manter `Retry-After`, orçamentos, número de tentativas e contrato de erros. Regressão antes da correção; testes focados, suites e build. Apenas transportes sintéticos, sem acesso a fornecedores ou bases habituais.

Resultado: regressão RED/GREEN confirmou cancelamento durante espera de 429 sem novo pedido. Espera padrão usa timer cancelável; listener externo é removido ao terminar. Testes focados 49 PASS; backend 2740 PASS/7 SKIP, frontend 815 PASS e build PASS. Este incremento corrige o cancelamento, não elimina a dependência da fonte externa nem encerra os riscos de matching, recuperação e implantação.

### PERF-03 — indicação do limite enquanto a paginação está pendente

### Paginação do matching — contrato de aceitação em preparação

Auditoria estática de escritores e ordem de autoridade, com plano de implementação e prova: [matching-perf03-writers-authority-plan.md](../research/matching-perf03-writers-authority-plan.md). Identificados escritores de onboarding e de estado de fonte além dos percursos principais; a proposta de ordem de locks ainda exige prova em duas bases e compatibilidade com o guard. O plano não autoriza ativação nem declara PERF-03 resolvido.

10/11: [prova sintética de ordem](../reviews/matching-lock-order-20261110-r3/results.json) PASS observou espera no lock tenant, timeout no lock Central em ordem oposta e libertação após rollback; terceiro tenant sintético sem alteração. A mesma execução validou [revogação Central focada](../reviews/matching-lock-order-20261110-r3/authority.json): sessão e membership revogadas recusam novo prepare sem guard. São provas separadas: não integram locks propostos com guard/commit tenant nem demonstram deadlock no runtime. Gate anterior de autoridade [FAIL](../reviews/matching-authority-baseline-20261110/postgres-short-groups.json) antes da revogação, por contagem de instrumentação 0 vs 4; preservado. Contentores de ensaio removidos; sem bases habituais. Ordem conjunta, cobertura de escritores e gate integrado continuam pendentes.

10/11: candidato sem espera em [gate integrado](../reviews/matching-integrated-20261110-b/integrated.json) PASS com executor F4/guard Central reais, escrita tenant de pessoa, sessão revogada e segunda entidade. Marcadores e autorização são sintéticos; não usa matching/F5. Central é libertada antes do commit tenant, pelo que não prova consistência ou ponto de publicação. [Desenho e pendências](../research/matching-perf03-writers-authority-plan.md). Contentor próprio removido; PERF-03 permanece aberto.

10/11: [gate de janela e perda Central](../reviews/matching-publication-20261110-c/integrated.json) reproduziu publicação obsoleta quando a ligação Central se perde, mesmo retendo o lock até ao commit. Lock com ligação intacta e rollback passaram. Um guard durável de consistência é candidato documentado, ainda não implementado nem demonstrado. Uma tentativa anterior foi interrompida por bloqueio no harness; o contentor próprio identificado foi removido. Sem bases habituais.

10/11: [guard durável sintético](../reviews/matching-durable-20261110-b/durable.json) PASS para perda da ligação após prepare, dois escritores e segunda captura recusados, commit incerto simulado e reconciliação de commit/rollback com nonce. Sem F4/F5, guard produtivo, enforcement de escritores ou matching; não substitui gate integrado. Contentores próprios removidos; PERF-03 aberto.

10/11: [gate com escritor real](../reviews/matching-real-writers-20261110-d/real-writers.json) PASS exercitou personEdit/F4/F5 e guard externo experimental; dois escritores cooperativos recusados após perda da ligação, mas chamada direta contornou o guard e confirmou que o candidato não é seguro. Recovery/nonce são sintéticos, sem commit incerto real. Tentativas [a](../reviews/matching-real-writers-20261110-a/real-writers.json) e [b](../reviews/matching-real-writers-20261110-b/real-writers.json) falharam por consulta de sessão não admitida; corrigida no harness. Contentores próprios removidos; sem bases habituais.

10/11: [ensaio de trigger local](../reviews/matching-mandatory-20261110-d/real-writers.json) PASS recusou UPDATE direto sob guard ativo ou ausente; fingerprint mudou e runtime inalterado recusou o tenant. `tenantAuthorityRecovery` real confirmou nonce e receipt de commit conhecido, recusando digest diferente. [Tentativa de ACK perdido](../reviews/matching-mandatory-20261110-a/real-writers.json) FAIL `TENANT_UNREACHABLE`; commit incerto não comprovado. Trigger cobre uma tabela, sem ligação atómica ao guard Central; sem integração produtiva.

10/11: [gate de coordenação](../reviews/matching-coordination-20261110-a/real-writers.json) PASS reconciliou commit incerto real do diretório com ACK perdido injetado após escrita funcional, nonce e receipt reais; a falha anterior é compatível com injeção durante preflight, sem diagnóstico definitivo. Em trigger experimental, ativação tenant esperou pelo escritor em curso e recusou novas escritas antes e após guard Central experimental. Uma tabela, SQL direto e guard sintético; runtime rejeita schema alterado, não prova protocolo completo nem habilita integração. Sem bases habituais; contentor próprio removido.

Incremento de fronteira autorizado: separar a projeção e seleção temporal de oportunidades da orquestração do matching, mantendo exports compatíveis, SQL, ordenação, limite, autorizações e resposta sem mudança. Primeiro fixar a equivalência da fronteira com teste; depois executar testes focados, suites completas, build e gate isolado aplicável. Esta separação não implementa paginação nem resolve consistência entre bases.

Resultado: `matchingProjection.js` contém a projeção e a seleção temporal previamente em `matching.js`; exports antigos permanecem. A regressão de fronteira falhou antes da extração e passou depois; 34 testes focados PASS, backend 2743 PASS/7 SKIP, frontend 815 PASS e build PASS. [Gate HTTP/OIDC](../reviews/matching-boundary-http-20261109/results.json) PASS com duas organizações e matching por oportunidade com 25 pessoas, além de isolamento e revogação; contentores próprios removidos. Outros percursos do gate usam até 10000 candidaturas, não são matching com mais de 1000 resultados. Não houve alteração de grants ou bases habituais. As portas centrais gerais e a paginação consistente permanecem abertas.

Pedido explícito: suportar mais de 1000 registos em fixture isolada, preservando dados e bases habituais. Regressão atual reproduzida sem base: uma fonte sintética de 1025 itens em 41 páginas termina em `LIMIT_EXCEEDED`.

- A ordem deve ser global e determinística: no matching por pessoa, número de áreas descendente, prazo e identificador; por oportunidade, número de áreas descendente, nome e identificador. Empates entre origens e alterações dos dados exigem regra de desempate e invalidação explícitas.
- Nenhuma página pode apresentar o conjunto como completo antes de todas as fontes autorizadas terem sido percorridas. A solução não pode simplesmente aumentar 1000, carregar conjuntos ilimitados em memória nem ordenar cada página isoladamente.
- Continuidades devem ficar vinculadas a organização, ator, operação, filtros, versão do algoritmo, resultado e prazo de validade; alterações de dados, perfil ou autorização devem invalidar ou recusar a continuação. Não publicar se alguma fonte falhar ou se a autoridade for revogada.
- O processamento deve ter limites explícitos de memória, tempo e concorrência, limpeza e falhas fechadas. A persistência e retenção de snapshots necessitam de uma escolha de arquitetura coerente com o projeto; não assumir que uma cache local a um processo é durável ou partilhada.
- Testar mais de 1000 pessoas e oportunidades, múltiplas fontes, empates, páginas vazias, expiração, adulteração, mudanças fora da página, revogação e isolamento entre entidades, com PostgreSQL descartável e sem bases habituais. Comparar a concatenação das páginas com o resultado global de referência e validar as suites completas.

Estado: contrato e reprodução preparados; implementação e prova integrada ainda pendentes. PERF-03 mantém-se aberto.

Prova de algoritmo isolada em `test/integration/matching-pagination/rank-proof.cjs`: seleção limitada de páginas com novo varrimento e fingerprint, comparada com ordenação global de 1501 registos sintéticos; teste de mutação fora da página, organização diferente e adulteração do cursor PASS. Não é runtime: usa dados e score sintéticos, sem PostgreSQL, autorizações reais ou deadline HTTP; não prova snapshot consistente durante um varrimento e exige nova leitura integral por página. Não instalar esse protótipo em produção nem considerar PERF-03 corrigido com esta prova.

Complemento: quatro testes da prova algorítmica PASS, incluindo uma comparação que mostra que cópia sintética imutável mantém a ordenação quando a fonte muda. É um teste em memória, não demonstra captura atómica entre bases nem implementação utilizável; paginação consistente continua aberta.

Ensaio adicional em PostgreSQL descartável: [snapshot sintético](../reviews/matching-snapshot-pg-20261109-a/results.json) PASS, 1501 linhas em 16 páginas iguais à ordenação global; REPEATABLE READ preservou a leitura durante mutação concorrente e o varrimento posterior recusou cursor obsoleto. Uma base, dados e score sintéticos; não usa runtime, permissões, RLS nem fontes Central e tenant separadas. Não prova snapshot entre bases nem implementa a paginação do produto. Container próprio removido; PERF-03 continua aberto.

Complemento com duas bases sintéticas independentes no mesmo cluster descartável: [prova](../reviews/matching-snapshot-pg-20261109-c/results.json) PASS demonstrando combinação de valores que nunca coexistiram quando se abre um snapshot antes das duas escritas e outro depois. Isso reproduz uma limitação de snapshots independentes, não um defeito demonstrado da versão atual, que ainda não implementa paginação. A solução precisa de um protocolo de consistência entre fontes e revalidação de autorização, não apenas de REPEATABLE READ separado. Container próprio removido.

Experiência adicional [matching-snapshot-fence](../reviews/matching-snapshot-fence-20261109-b/results.json): PASS em duas bases sintéticas; enquanto leitores detêm bloqueios partilhados em marcadores, uma escrita que participa no protocolo fica bloqueada e incrementa a versão depois da libertação. Inclui 1501 linhas sintéticas da prova anterior. Isto depende de todas as escritas relevantes participarem, não garante consistência de fontes reais, não implementa snapshots persistidos, paginação produtiva, autorização, limites ou gestão de falhas. A primeira execução foi interrompida após o próprio teste esgotar o pool; o contentor identificado por rótulo, hora e bases sintéticas foi removido e a prova corrigida repetida. PERF-03 continua aberto.

Progresso: empate entre oportunidades de origens distintas com o mesmo identificador agora desempata por origem independentemente da ordem de chegada; regressão reproduzida antes e aprovada após alteração. Backend 2738 PASS/7 SKIP, frontend 815 PASS, build PASS. Este desempate é apenas um pré-requisito: não há ainda paginação nem prova com mais de 1000 itens. Sem acesso às bases habituais.

Continuação: matching por pessoa recusa publicação com `CONTEXT_CHANGED` se o estado ativo ou as áreas mudarem entre a leitura inicial e a revalidação. A comparação usa uma cópia das áreas e não depende da ordem; regressão RED/GREEN. Backend 2739 PASS/7 SKIP, frontend 815 PASS e build PASS. Isto protege apenas as propriedades comparadas no pedido atual; não é uma implementação de paginação nem prova de invalidação entre páginas. Continua pendente a solução global e o teste isolado com mais de 1000 itens.

O matching recusa o cálculo completo se alguma fonte exceder 1000 itens. A UI não deve apresentar essa recusa como falha transitória resolúvel por repetição. Mostrar uma mensagem específica que indica que o cálculo completo excedeu a capacidade atual e que não foram apresentados resultados; não oferecer repetição neste caso. Outras falhas conservam recuperação. A mudança não resolve a paginação nem altera o limite ou o contrato de ordenação; PERF-03 permanece aberto.

Resultado 09/11: regressão reproduzida antes da correção e aprovada depois; frontend 815 PASS, backend 2733 PASS/7 SKIP, build PASS. Testes de backend com loopback autorizado; sem bases habituais ou deploy. A paginação completa e os riscos PERF-01/02 permanecem por resolver.

Continuação: foram acrescentados testes que fixam o comportamento atual em 1000/1001 itens e recusa de cursores repetidos. A ordenação depende de classificar o conjunto completo antes de ordenar por número de áreas, prazo e identidade (ou por número de áreas, nome e identidade para pessoas). Portanto, paginar diretamente cada fonte e ordenar cada página não preserva a ordem global nem prova completude. A solução precisa de um contrato de snapshot, limites de trabalho e revalidação da autoridade antes de publicar cada página; não foi implementada nem escolhida uma estratégia de armazenamento nesta continuação. Teste focado `node --test test/organizationMatching.test.js`: 13 PASS. Sem ligação a bases.

Melhoria de robustez: limitar a 1001 chamadas por fonte, além do limite existente de 1000 itens. Fontes com cursores distintos que continuem indefinidamente sem itens são recusadas com LIMIT_EXCEEDED, sem publicar resultados parciais. Preservar a aceitação de 1000 páginas de um item, cursores repetidos e revalidação de autoridade. Esta medida não resolve PERF-03 nem aumenta a capacidade.

Resultado: regressão reproduzida antes da correção, 15 testes focados PASS após correção. Backend 2737 PASS/7 SKIP; frontend 815 PASS; build PASS. Sem dados ou bases habituais. PERF-03 continua aberto.

PERF-01 exige prova de concorrência e revogação antes de alterar o protocolo global de autoridade. PERF-02 exige planos e medições de consultas representativas antes de escolher projeções/índices. PERF-03 exige paginação determinística e preservação da completude das correspondências; aumentar o limite não resolve o problema.

Não remover verificações de autorização, não alterar migrações já aplicadas e não declarar ganhos de latência sem medição comparável.

## Validação do incremento 1

- Regressões AUTH-01, SEC-01 e UX-01 reproduzidas antes da correção.
- Backend completo: 2702 PASS, 7 SKIP, 0 FAIL. Teste adicional do teto de espera OIDC (30 s) aprovado separadamente após essa execução.
- Frontend completo: 811 PASS, 0 FAIL; build Vite PASS.
- Verificação sintática dos ficheiros backend alterados PASS.
- Testes focados de assinatura, issuer, audience, nonce, state e recuperação de transações OIDC PASS.
- Não houve commit, deploy ou alteração de bases habituais por este incremento.

## Diagnóstico de desempenho autorizado

O utilizador autorizou explicitamente `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-contention/profile.ps1 -Report audit-remediation-contention-20261106`.
Usa PostgreSQL/Keycloak descartáveis e dados sintéticos; não autoriza alterações à infraestrutura habitual.

Diagnóstico concluído: 36/36 pedidos medidos com sucesso, recursos próprios removidos. Dashboard C4 p95 7458,74 ms. Custo dominante observado em consultas metadata; sem fila de admissão neste ensaio. [Relatório e próximos incrementos](../reviews/audit-remediation-contention-20261106/README.md). PERF-01/02/03 continuam abertos; autenticação/cache validados.

## Incremento 2 — definição de funções no snapshot de autoridade

Pedido de 06/11: corrigir metadados preservando segurança, validar isoladamente e comparar antes/depois. O diagnóstico contabilizou 1976 execuções do snapshot de autoridade, cerca de 26,8 s acumulados nos 36 pedidos. A mesma definição SQL é descompilada por destinatário de ACL.

Plano: materializar definição e assinatura uma vez por função selecionada e por statement; continuar a devolver todas as linhas de permissões. Não guardar metadados entre statements, não alterar checkpoints, locks, fingerprints esperados, grants, timeouts ou pools. Preservar compatibilidade do transporte compacto existente.

Aceitação: regressão estrutural RED antes da alteração; equivalência JSON byte a byte e fingerprint com a fonte A congelada; deriva de ACL PUBLIC/terceiros/coluna, roles, funções e schema continua detetada sob role runtime; verificação fresca após lock. Prova isolada e microbenchmark alternado; quatro execuções HTTP sequenciais A/B/B/A com a mesma fixture e harness (36 medidas por execução), fontes A congeladas sem checkout do workspace. Suites completas e build antes da carga, sem testes concorrentes. Erros e quantis completos, sem excluir falhas; se o ganho não for consistente, não aceitar a alteração como melhoria.

Recursos de prova: PostgreSQL/Keycloak descartáveis, portas loopback, dados sintéticos e cleanup por nome/UUID/label; nenhum acesso às bases habituais. A autorização deste incremento inclui esses ensaios isolados.

Refinamento após medição: CTE de definições sem ganho consistente (A mediana 11,125 ms, B 11,235 ms); descartada. Selecionado o transporte compacto já existente (10,145 ms na mesma série), apenas para a parte authoritySecurity dos snapshots e validações normais. O SQL original e o helper compacto são preservados; a recolha reconstrói todos os bytes antes do fingerprint. O coletor raw continua disponível como referência explícita. Comparação HTTP A/B/B/A ainda obrigatória.

## Resultado do incremento 2

Implementação e validação local concluídas em 06/11/2026. Regressões RED contra A, GREEN contra B; backend 2705 PASS/7 SKIP/0 FAIL, frontend 811 PASS e build/sintaxe PASS. Nove verificações de equivalência e deriva aprovadas em PostgreSQL 17/esquema 035 e PostgreSQL 18/esquema 050; revogação concorrente HTTP/OIDC aprovada. Recursos descartáveis removidos.

Comparação sequencial A/B/B/A concluída: 144/144 pedidos medidos com sucesso, imagens e fontes iguais, sem deriva durante execuções. Microbenchmark alternado mostra melhoria consistente de cerca de 9–10% na mediana da consulta. HTTP tem ganhos e regressões pequenos consoante o cenário, sem aceleração generalizada demonstrada; não considerar PERF-01 encerrado nem afirmar melhoria de abertura das páginas. Incremento compacto conservado pelo ganho repetido na consulta, preservando todos os controlos. PERF-02/03 pendentes. Sem deploy ou alteração de bases habituais.

[Relatório, tempos antes/depois, limites e evidência](../reviews/metadata-remediation-comparison-20261106/README.md).

## Incremento 3 — latência transversal das páginas

Pedido: quase todas as páginas continuam lentas; otimizar tempos completos, preservando segurança. Investigar primeiro os custos comuns e verificar o esquema atual PostgreSQL 18/050. Hipótese inicial: conversão integral de pg_constraint para JSON apenas para obter conenforced consome a maior parte da consulta central. Medir leitura nativa antes de alterar runtime; preservar PostgreSQL 17, todas as constraints, fingerprints, checkpoints, locks e revogação. Não usar caches de autorização. Regressão RED/GREEN, equivalência com A congelada e deriva em bases descartáveis, suites completas/build, comparação HTTP controlada antes/depois. Não declarar resolvido por ganho apenas no microbenchmark. Autorização isolada do incremento anterior mantém-se; sem bases habituais/deploy.

Refinamento: leitura nativa/compacta central só melhora cerca de 5–8% isoladamente; não aplicada neste incremento. Browser real revelou geração de alertas, leitura da contagem e acesso à faturação concorrentes com a abertura. Correção proposta: prioridade a pedidos da página; os pedidos auxiliares do shell aguardam uma pausa curta, são cancelados se a sessão mudar antes de começar e continuam a passar pelos mesmos endpoints/CSRF/autorização. Não cancelar nem repetir escrita já iniciada, não usar contagens antigas como zero, não adiar ações explícitas do utilizador. Leituras principais não aguardam auxiliares pendentes. Testar ordem, cancelamento, rotação e efeitos visíveis; medir browser completo com fontes/builds congelados.

Resultado do protótipo de prioridade: rejeitado e retirado do runtime. O ganho no conteúdo principal foi pequeno e o tempo até terminar os auxiliares quase duplicou; fontes/testes preservados em `test/integration/page-performance/rejected-priority` e medições v2 A1/B1.

Plano revisto antes da implementação: (1) perfil institucional carrega apenas o contexto que apresenta; unidades são consultadas quando se entra em Unidades/Pessoas, com contexto fresco e cancelamento lógico de respostas antigas; (2) dashboard recolhe catálogo central primeiro e relatório + resumo privado numa única operação tenant protegida. Essa operação exige APPLICATION_READ e OPPORTUNITY_READ e, quando inclui unidades, ambas as permissões de diretório/estrutura; mantém auditoria síncrona, guardas de autoridade, RLS, checkpoints internos de admissão/lock/commit e recusa integral em qualquer falha. São eliminadas duas leases de composição redundantes, não verificações dentro de uma lease. A resposta HTTP pública e os totais mantêm-se. Regressões para permissões, ordenação, falhas, contexto cruzado e carga tardia; validação real de revogação/isolamento e comparação A/B dos tempos completos. Sem alterações de schema ou permissões.

## Resultado do incremento 3

Correções combinadas implementadas e validadas. Browser real A/B/B/A, PostgreSQL 18/central 050, 36/36 medições concluídas; fontes e imagens verificadas. Mediana de abertura: dashboard 7,96 → 4,12 s (−48,2%), perfil 7,36 → 4,78 s (−35,0%). Navegação interna: 6,74 → 3,14 s e 6,28 → 3,89 s, respetivamente. Candidaturas sem alteração: 4,50 → 4,75 s na abertura (+5,4%), navegação praticamente igual. Não há melhoria transversal demonstrada.

Gate real de isolamento, permissões, auditoria e revogação PASS; a leitura protegida precede o commit da revogação e pedidos posteriores são recusados. Quatro dashboards simultâneos 200/total 1000. Backend final 2709 PASS/7 SKIP/0 FAIL, frontend 812 PASS e build/sintaxe PASS. Contentores próprios removidos; sem deploy, reinício habitual ou alteração de bases habituais. PERF-01/02/03 continuam abertos para custos comuns, notificações e restantes páginas.

[Relatório completo, comparação e prioridades](../reviews/page-performance-combined-20261106/README.md).

## Incremento 4 — notificações e Candidaturas

Pedido explícito: corrigir lentidão transversal começando por notificações e Candidaturas, sem comprometer segurança, com comparação isolada antes/depois.

Plano: novo POST de sincronização/leitura de alertas numa única operação tenant WRITE, exigindo NOTIFICATION_SYNC e NOTIFICATION_READ antes de gerar ou ler; manter endpoints separados e fallback de leitura após falha transitória, sem repetir a escrita. Autorizações por candidatura/oportunidade/avaliação, auditoria e guarda de commit continuam obrigatórias. Dependência de autoridade permitida apenas para este par, intenção e inbox organizacional. Agrupar apenas as leituras adjacentes membership/política da mesma decisão, sem cache entre decisões ou pedidos.

Candidaturas: nova leitura combinada da lista e opções de unidades sob a mesma guarda APPLICATION_READ e a mesma autoridade fresca de leitura. Preservar SQL de visibilidade, filtros, contagens, ordenação, cursores assinados, transições e limites; os endpoints anteriores permanecem disponíveis. A página publica lista e opções só quando a operação completa termina; em falha integral mostra erro e permite repetir, sem contagens falsas. Evitar o atraso de pesquisa na abertura inicial e nas ações explícitas; manter debounce para texto digitado.

Aceitação: regressões RED/GREEN, suites completas/build, prova real de isolamento, negação, auditoria, revogação e concorrência para as novas operações; comparação browser A/B/B/A com baseline deste incremento congelada, dados sintéticos PostgreSQL 18/central 050 e OIDC, sem carga de testes concorrente. Medir também notificações e fim dos pedidos auxiliares. Autorização isolada renovada pelo pedido; sem bases habituais, deploy ou reinício habitual. Não declarar melhoria transversal se os resultados não a demonstrarem.

Refinamento após gate real: quatro sincronizações combinadas concorrentes produziram dois LEASE_TIMEOUT, devido à serialização no advisory lock global APPLICATION. NOTIFICATION_SYNC apenas insere alertas de prazo idempotentes, não altera candidaturas: retirar esse lock exclusivamente desta operação, mantendo classificação WRITE, transação, guardas e auditoria. O índice único (organização, destinatário, event_key) e ON CONFLICT já fornecem exclusão por evento. Provar geração concorrente desde zero sem duplicados, auditoria de criação única, rollback em falha de auditoria e filtragem de prazos/estados obsoletos. Todos os outros writes mantêm o bloqueio global. Não alterar timeouts, índices ou schema.

Resultado desse protótipo: retirar o lock não eliminou os dois timeouts; também existe serialização na auditoria síncrona. Rejeitado e lock reposto. Plano revisto: reduzir leituras centrais por alerta, sem omitir nenhuma avaliação/auditoria. Para as leituras de visibilidade de alertsList/alertsRefresh/alertsRefreshList, carregar membership e snapshot uma vez **após** a guarda protegida estar ativa e apenas durante essa operação. Verificar token, cliente, transação, ator/versões e validade temporal a cada acesso; nova operação exige novo snapshot. A preparação da guarda continua a usar as portas originais frescas; política por recurso, equipa e auditoria continuam executadas individualmente. Falhas permanecem recusas. Este snapshot limitado à transação substitui a hipótese inicial de não partilhar dados entre decisões, seguindo a fronteira já usada por readAuthority em Candidaturas. Provar revogação concorrente e ausência de reutilização entre operações; não relaxar nem adiar auditoria.

## Resultado do incremento 4

Implementação e validação concluídas em 06/11. Backend 2723 PASS/7 SKIP/0 FAIL; frontend 814 PASS; builds PASS. Gate PostgreSQL 18/central 050 e OIDC real PASS: isolamento, CSRF, permissões por recurso, cursores, auditoria/rollback, geração concorrente idempotente e revogação nas duas operações. Quatro pedidos simultâneos por operação sem falhas na versão final; locks, timeouts e auditoria síncrona preservados.

Browser A/B/B/A, 48/48 medições, mesmas imagens/fontes e integridade PASS. Com caixa de alertas não vazia: Alertas 16,04 → 5,46 s (−66%); Candidaturas 5,54 → 4,13 s (−25%); dashboard 5,08 → 4,31 s (−15%); perfil 4,70 → 4,83 s (+2,9%). Navegação interna Alertas 10,42 → 3,20 s e Candidaturas 3,25 → 2,88 s. Fim dos pedidos auxiliares melhora cerca de 53–64% nas quatro páginas. Não há melhoria de apresentação em todas as páginas nem prova de capacidade de produção.

Sem deploy/reinício habitual ou alterações nas bases habituais; contentores próprios removidos. [Relatório completo, tentativas rejeitadas, limites e próximos custos](../reviews/transversal-performance-20261106/README.md). PERF-01/02/03 continuam em curso.

## Incremento 5 — perfil institucional e preparação comum de leituras

Pedido: otimizar perfil e custos comuns, preservando segurança, com comparação isolada. Plano antes de implementação: agrupar captura/resolução de sessão adjacentes no diretório; nas cinco avaliações de permissões do contexto, usar o snapshot limitado à operação protegida já validado no incremento 4, mantendo cada avaliação e auditoria. Preparação da guarda e escritas usam as portas frescas originais. Partilhar o mesmo snapshot protegido entre a visibilidade de candidaturas e a apresentação de capacidades de transição, com nova avaliação por recurso e comando sempre autorizado de novo.

Adicionar política fechada de auditoria preparada apenas para DIRECTORY_CONTEXT/ORGANIZATION_DIRECTORY_READ: eventos observacionais permitidos aguardam o flush síncrono na mesma transação antes dos controlos finais e commit. Eventos críticos/recusas continuam imediatos, com flush prévio para manter ordem. Máximo de seis decisões no contexto, sem alterar os limites do buffer. Nenhuma resposta antes da auditoria/commit; falha impede publicação. Não alterar schema, SQL de dados, migrações, grants, timeouts, pools ou locks de escrita. Nenhuma partilha entre pedidos.

Aceitação: regressões RED/GREEN e suites completas/build; equivalência do perfil, permissões, isolamento, falhas de auditoria e revogação real; concorrência em perfil e percursos comuns; browser A/B/B/A com fontes congeladas e fixture PostgreSQL 18/central 050, OIDC e caixa de alertas não vazia. Autorização para o ambiente descartável renovada pelo pedido. Sem bases habituais, deploy ou reinício habitual. Ganhos e regressões devem ser apresentados integralmente.

### Resultado do incremento 5

Concluído e validado em 06/11/2026: backend 2730 PASS/7 SKIP/0 FAIL, frontend 814 PASS e builds PASS. Gate isolado final confirma equivalência do perfil e seis eventos de auditoria, capacidades restritas/completas, isolamento, paginação, recusa em falha de auditoria, quatro pedidos concorrentes por operação e revogação real de perfil/candidaturas. Primeiro gate corrigido por expectativa errada de permissões da fixture, com evidência preservada.

Browser A/B/B/A, 48 medições, integridade e frontend byte a byte idêntico: perfil 4,79 → 3,68 s (−23,2%), navegação 3,86 → 2,73 s (−29,3%). Abertura dashboard 4,17 → 4,31 s (+3,2%); candidaturas 4,09 → 4,15 s (+1,6%); alertas 5,46 → 5,52 s (+1,2%). Não há melhoria transversal demonstrada. Custos comuns residuais e PERF-01/02/03 permanecem abertos. Sem deploy/reinício ou bases habituais; contentores próprios removidos. [Relatório e evidência](../reviews/profile-performance-20261106/README.md).
