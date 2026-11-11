# Protocolo de medição — escritor EU v2

31/10/2026. Protocolo ligado ao manifesto `context/references/performance/eu-writer-v2-baseline.json` e ao descritor de parâmetros `eu-writer-v2-protocol.json` nesta pasta. Não foi executada carga, criado PostgreSQL/Keycloak nem alterado o ambiente habitual por esta preparação. A passagem da suite local não é uma medição de latência.

## Perguntas e unidades de comparação

1. Quanto custa recolher e validar metadados nas revisões042 e043, preservando a equivalência e a frescura?
2. Como se distribuem latência, trabalho SQL e espera de admissão do report/dashboard com o código consolidado?
3. Opcionalmente, quanto acrescenta uma carga determinística do writer v2 à contenção do mesmo ambiente?

Três comparações distintas: **M7/M1** são coletores de teste com sete/uma consultas base no mesmo esquema; **H** é a baseline HTTP atual sem candidato de otimização; **W0/W1** são worker inativo/ativo no mesmo esquema043. Nenhuma destas designações representa automaticamente as variantes A/B do gate C6 aprovado. Não existe ainda um candidato B de código para a futura regressão de otimização.

## Elegibilidade e identidade da execução

Antes de começar qualquer ensaio, fixar num `protocol.json` final:

- Identificador único e destino inexistente `context/reviews/eu-writer-performance-<run-id>/`, com subpastas `eligibility`, `metadata`, `http`, `writer` e `cleanup`. O runner recusa destinos existentes. `output/` pode conter logs volumosos, identificados por hash no relatório.
- Caminho e SHA256 do manifesto da baseline consolidada, `packageDigest` EU v2, checksum canónico de043, fingerprints de esquema/autoridade/catálogo/helpers e digest preservado do pacote11145. O manifesto tem de incluir as dependências efetivamente carregadas, testes, fixtures, protocolos e instrumentação; conferir antes/depois.
- Revisões alvo:042 para compatibilidade e043 apenas no ambiente descartável explicitamente autorizado; tenant034. A baseline habitual042/034 e a fonte EU quiescente ficam fora da execução.
- Imagem PostgreSQL18 por digest, imagem Keycloak e versões Node/driver/pg-boss por lockfiles; não usar tags móveis como identidade de prova. PG17 é uma execução de compatibilidade separada, se necessária para fechar cobertura, sem misturar os seus tempos com PG18.
- Sistema operativo, CPU/memória disponíveis, limites de contentor, plano de energia, processos/instrumentação observados, timezoneUTC e política de ligação/leases/timeouts do runtime. Manter os limites correntes e registar os seus valores; qualquer mudança invalida uma comparação causal com a baseline.
- Hash dos dados sintéticos de entrada e do plano de seed; contagem inicial por tabela relevante; cenário, ordem, aquecimento, número de tentativas e regras de exclusão. Não guardar credenciais, URLs de ligação, tokens, SQL parametrizado ou dados pessoais nos resultados.
- Cópia verificada das fontes necessárias para reproduzir a versão. Registar mudanças de fonte como execução inválida, conservar o relatório e criar um novo run-id numa repetição.

Pré-condições: foco/suite local PASS; checksum e fingerprints do pacote consistentes; evidência funcional do writer com os mesmos hashes e cleanup PASS, ou lacunas enumeradas; prontidão da composição real e provas de isolamento/RLS/autoridade válidas. Os sete testes ignorados não contam como prova física. Se uma prova anterior usa outros hashes, identificar precisamente o que pode ser reutilizado.

## M — equivalência e custo dos metadados

Preparar um adaptador de ensaio a partir de `test/integration/authority-metadata/proof.js`. O script histórico usa029–032, fontes anteriores à deduplicação e PostgreSQL17; não serve como comando pronto para042/043.

| Parâmetro | Valor deste protocolo |
| --- | --- |
| Fixtures | Instalação descartável042 e instalação descartável043 independentes; mesmos dados de seed nos objetos comuns |
| M7 | Sete SELECTs base de `backend/test/support/centralSchemaLegacyQueries.json`, mantendo projeções/ordenação/tipos e a normalização/validações atuais |
| M1 | Coletor agregado da baseline consolidada |
| Segurança | Recolhas de autoridade, catalog reader e helpers043 iguais nas duas variantes; registar contagens separadas das consultas base |
| Ordem por revisão | Seis pares: M7/M1, M1/M7, M7/M1, M1/M7, M7/M1, M1/M7 |
| Amostras | Dez aquecimentos excluídos e100 chamadas sequenciais medidas por bloco;600 amostras por variante e revisão |
| Conexão | Mesmo papel de leitura autorizado; uma ligação por bloco, sem abrir ligação por amostra; medir aquisição separadamente |
| Temporização | Relógio monotónico, início/fim de cada chamada e de cada consulta; preservar precisão original, arredondar só na apresentação |

Antes de medir: exigir igualdade byte a byte de JSON e fingerprint para M7/M1 no mesmo esquema, incluindo coleções vazias, tipos de sequência, campos opcionais e canonicalização NOT NULL. Confirmar uma consulta base M1 e sete M7, duas chamadas sucessivas com recolhas novas, erro propagado, uma linha/sete arrays obrigatórios e inexistência de cache entre checkpoints.

Depois da medição: executar casos controlados de alteração de esquema e de permissões exclusivamente na fixture, incluindo alteração após preflight e antes da aquisição do lock. Exigir recusa antes de trabalho protegido, rollback/restauro e nova validação. Estes casos funcionais não entram nos quantis de latência.

Resultados: p50/p95/máximo por variante/revisão/bloco, diferenças emparelhadas, número de comandos base e de segurança, tempo acumulado observado pelo driver e tempo total.042 e043 têm estruturas distintas: reportar ambas separadamente; não atribuir uma diferença entre revisões apenas à agregação. Não há SLA absoluto aprovado para esta micro medição.

## H — baseline HTTP da versão consolidada

Adaptar `test/integration/http-contention/profile.js` e o observador `test/integration/dashboard-c1/stageObserver.js` em novos ficheiros. Uma composição real, OIDC/PKCE e papéis/RLS atuais; duas organizações isoladas,1000 candidaturas e250 pessoas sintéticas por tenant. Usar043 com writer instalado e inativo; validar042 separadamente na fase funcional. Um cenário sem instalação043 só pode ser comparado se for declarado explicitamente como comparação de versões, mantendo seed comum e resultados equivalentes.

Executar três réplicas independentes da matriz abaixo, cada uma com fixture nova e a mesma ordem. Aquecer tenantA antes de cada cenário; no cenário misto aquecer também tenantB e registar isso como diferença explícita face ao harness histórico, que deixaB frio. Fazer uma chamada de aquecimento por tenant envolvido, excluída das amostras. Drenar atividade entre cenários e registar o tempo de drenagem.

| Cenário | Concorrência | Tenants | Tentativas por réplica |
| --- | ---: | ---: | ---: |
| Report | 1 | 1 | 4 |
| Report | 2 | 1 | 4 |
| Report | 4 | 1 | 8 |
| Dashboard | 1 | 1 | 4 |
| Dashboard | 4 | 1 | 8 |
| Dashboard alternado entreA/B | 4 | 2 | 8 |

São36 tentativas por réplica e108 no total. Esta amostragem caracteriza a baseline; o p95 de cenários com poucas observações deve mostrar sempre o tamanho da amostra e não sustenta sozinho uma conclusão de capacidade produtiva. Uma futura comparação de otimização exige protocolo A/B adicional com ordem equilibrada e condições iguais.

Métricas obrigatórias: latência HTTP por tentativa; sucesso, erro,503 e timeout; p50/p95/máximo das respostas200 com denominador explícito e distribuição de duração de todas as tentativas separada; total funcional esperado e hash de resposta normalizada; queries/transações por pedido; tempo de metadados Central/tenant; admissões concedidas/expiradas e sua espera; fila/leases ativas; checkout/hold físico; locks; CPU/RSS/heap dos processos; métricas observadas do PostgreSQL; queries concluídas depois da resposta e tempo de drenagem.

Os intervalos do driver incluem espera/rede e podem sobrepor-se. Usar a união de intervalos para cobertura temporal, mantendo somas por categoria apenas como trabalho observado; não apresentar essas somas como CPU SQL ou latência HTTP exclusiva. Instrumentação igual em todas as réplicas; não subtrair o seu overhead por estimativa. O sampler PostgreSQL histórico é de100ms e deve constar do protocolo final.

Critérios de completude: todas as108 tentativas presentes, aquecimentos identificados, nenhum campo obrigatório omitido, hashes de fonte/seed estáveis e cleanup comprovado. Erros HTTP, perda de isolamento, mudança de resposta funcional ou trabalho sem drenagem impedem aprovação funcional; conservar todos os dados para diagnóstico. Não há SLO HTTP global aprovado a aplicar a estes tempos.

## W — diagnóstico opcional de interferência do writer

Executar apenas depois deM/H funcionais. Este módulo precisa de fixture e instrumentação adicionais; não é uma opção executável do harness histórico. Usar exclusivamente esquema043, o mesmo código nas duas variantes, o transporte determinístico arquivado e100 oportunidades sintéticas já v2 cujo conteúdo devolva `UNCHANGED`. O seed e a geração de identidades/evidência passam pelos contratos atuais e são fixados por hash antes da carga; não simular autorização ou sucesso no núcleo do writer.

W0: worker inativo e nenhuma execução pendente. W1: worker real/queue/archive/permits/auditoria ativos, processando um ciclo finito das100 oportunidades, sem acesso à Internet. Manter concorrência e tamanho de lote normais do runtime; registar os valores observados. Usar fila vazia no início e exigir drenagem no fim. Nenhum ciclo adicional é criado automaticamente para prolongar o ensaio.

Comparar seis pares alternados W0/W1, W1/W0, W0/W1, W1/W0, W0/W1, W1/W0. Cada bloco recebe uma fixture nova com o mesmo seed, quatro pedidos dashboardC1 seguidos de oito dashboardC4: 144 tentativas HTTP no total. No bloco W1, iniciar a carga HTTP após confirmar o primeiro trabalho do worker; medir o intervalo real de sobreposição. Se o ciclo acabar antes de todas as amostras previstas, marcar `INSUFFICIENT_WRITER_OVERLAP`, conservar os resultados e preparar uma nova versão do protocolo com um volume explícito maior — sem aumentar silenciosamente o volume durante a execução.

Medir as métricasH e duração/throughput do ciclo, itens concluídos, duração por item, idade da fila, execução/lease/fences, tentativas/retries, transações/locks, tamanho do arquivo e contadores finais. Exigir que revisões/rowVersion dos100 heads e os dados tenant permaneçam iguais; alterações esperadas de observação, recibos, histórico e auditoria são contabilizadas. Nenhum novo ID, atualização factual ou revisão é esperado nesta carga. Testar esses percursos funcionalmente em prova separada para não misturar respostas mutáveis com a comparação de latência.

W mede interferência de um workload declarado e não substitui a política de aceitação C6. Não há SLO de throughput do writer aprovado; apresentar resultados e limites sem inventar um.

## C6 — apenas para uma futura regressão de admissão

Preparar separadamente quando houver uma alteração concreta do percurso concorrente. Manter a política `c6-admission-v1`: p95 de admissão≤3000ms, máximo≤4000ms, margem≥1000ms para timeout5000ms, zero erros HTTP/admissão. Seis pares AB/BA alternados, doze bursts de seis pedidos,72 pedidos/216 admissões,108 admissões por variante e gate final exit0. Uma baseline só, uma comparação worker inativo/ativo ou um burst isolado não constitui essa série.

O runner atual fixa três módulos históricos, nomes de relatório e serviços a pausar. Antes de reutilizá-lo, definir os dois conjuntos de fontes atuais, ajustar explicitamente as allowlists e usar relatórios novos. A política aprovada não é alterada. Aplicar os controlos de host aprovados, incluindo memória livre≥4GiB, observador completo, CPU externa média≤5%, amostra≤10% e lacuna≤5s; ambiente inválido não produz PASS. C6 exige reserva concreta do host e autorização própria para qualquer suspensão de serviços.

## Adaptações obrigatórias antes de declarar o runner pronto

| Base existente | Adaptação exigida |
| --- | --- |
| `authority-metadata/proof.js` e `.ps1` | Novos destinos, schema042/043, PG18 por digest; coletores M7/M1 definidos neste protocolo em vez de importar cegamente fontes029–032 |
| `http-oidc/fixture.js`, `sqlProof.js` e `http-contention/profile.js` | Conferir migrations/tenant034, fixtures de autorização/membership e endpoints atuais; completar roles mínimas em vez do leitor histórico `pg_read_all_data`; criar uma cópia de harness com métricas completas e recusa de pasta existente |
| `dashboard-c1/stageObserver.js` e `analyze.js` | Confirmar facades atuais, tags e correspondência entre contagens/intervalos; conservar wrappers observacionais e calcular união temporal |
| `opportunity-v2/eu-writer-*.cjs` | Reutilizar queue/transport/autoridade verificados, criar seed determinístico W e medir sobreposição/queue/worker; o gate funcional atual não é um benchmark |
| `c6-dedicated/run.ps1`, `preload.js`, `analyze.js`, `gate.js` | Novas variantes/fontes/nomes/destinos e plano de host; preservar política e integridade do gate; não executar a allowlist histórica sem adaptação |

O estado do protocolo é **PREPARED**, não `EXECUTION_READY`. Para mudar de estado, os adaptadores têm de existir, passar testes locais de integridade/recusa/drain/contagem, ter sintaxe validada e revisão independente. O `protocol.json` final liga explicitamente todos os ficheiros/hashes, recursos e autorização. Nenhum comando Docker/SQL de carga é apresentado como pronto nesta versão.

## Âmbito concreto da autorização futura

AutorizarM/H significa permitir apenas novos contentores próprios de PostgreSQL18/Keycloak, portas loopback efémeras, bases/roles/grants/seed sintéticos, migrations042/043 e tenant034 na fixture, armazenamento temporário local para arquivo, requisições HTTP ao servidor local, recolha de métricas sem segredos e cleanup comprovado por UUID/label. W acrescenta queue/worker locais e o único ciclo finito especificado. Acesso à Internet, ativação habitual043, retoma EU habitual, bases Dev/produção, publicação Git e deploy ficam fora deste protocolo. A suspensão de serviços e reserva do host deC6 requerem âmbito adicional explícito.

Falha de ownership, fonte alterada, drift não previsto, quebra de isolamento, coleta incompleta, ausência de drenagem ou cleanup incompleto interrompe o ensaio e recusa aprovação; o relatório é preservado. Orçamentos de controlo do laboratório: preparação de cada fixture até 300s, bloco M até 300s, cenário H até 180s, bloco W até 600s, drenagem até 30s e cleanup até 120s. São limites de duração do ensaio, não SLO nem alterações dos timeouts do produto. Ao atingir um limite, registar `CONTROL_DEADLINE_EXCEEDED`, tentar cleanup e manter o resultado incompleto/recusado; uma extensão exige nova versão do protocolo. O cleanup limita-se aos recursos criados e identificados por este run-id.

Verificação disponível agora, sem carga: `node scripts/verify-eu-writer-baseline.cjs`. O manifesto inclui este protocolo como fonte fixada; o descritor de uma execução futura referencia o hash do manifesto já concluído, sem reescrever os artefactos desta baseline.

Fontes: plano de recuperação em `context/research/backend-test-recovery-performance-plan.md`; contratos e código de `central-schema-catalog-batch`, `authority-metadata`, `http-contention`, `dashboard-c1`, `opportunity-v2/eu-writer-*`; decisão `context/decisions/2026-10-27-c6-admission-slo.md` e `test/integration/c6-dedicated/policy.json`.
