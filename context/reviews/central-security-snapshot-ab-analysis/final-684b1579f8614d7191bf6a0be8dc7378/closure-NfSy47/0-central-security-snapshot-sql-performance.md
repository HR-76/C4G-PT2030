# Snapshots Central/segurança — SQL e comparação A/B

31/10/2026. **Otimização SQL comprovada; M PASS; H FAIL/incompleto.** B reduz o p50 dos snapshots em 15,8–17,0% e o p50 HTTP em 12,1–20,3% nos três pares sem interrupção operacional. Um aquecimento de A recebeu 503/LEASE_TIMEOUT; a falha e as amostras não executadas permanecem explícitas. [Contrato](../features/central-security-snapshot-sql-performance.md).

## Alteração e fronteiras

O candidato altera apenas `backend/src/security/centralSchemaManifest.js` e `backend/src/security/authoritySecurityManifest.js`. Na consulta Central, a definição de NOT NULL canónico usa o nome da coluna com quoting PostgreSQL; mantém o deparser para as restantes formas e as recusas das formas não suportadas. A consulta de segurança expande ACLs explícitas uma vez por statement, identifica os objetos protegidos por nome/owner/grantee e preserva todos os destinatários, incluindo PUBLIC e terceiros. Os ACLs predefinidos continuam a ser usados apenas quando o ACL é NULL, nunca quando é vazio.

Não há cache entre chamadas, ligações, pedidos ou transações. O coordenador, preflight, memberships, fingerprints esperados, permissões, migrations, pools e timeouts têm os mesmos bytes de A. A leitura independente após advisory lock permanece no mesmo ponto, antes do callback protegido. Objetos protegidos noutros schemas, grants por coluna e concessões duplicadas de grantors distintos mantêm cobertura.

A implementação atual e as medições são da versão de ensaio 043/tenant034. Não incluem os incrementos paralelos de leituras tenant/relatório ou a reconciliação EU044 do workspace; não representam uma medição do ambiente habitual nem da arquitetura futura multi-base.

## Versões e validação

- A: `eu-writer-trial-0ecb31dc7c705859`,1844 fontes; digest `0ecb31dc7c70585959a97b38046e79c5aa0dec06b87763a557720ad3e8ce1d6c`.
- B:1844 fontes, apenas os dois overlays runtime; digest `30005d5709224972d241530ff197282a75826ada308f7a3699e07b73002c952c`.
- Pacote final: `output/central-snapshot-ab-5b9e4e70caa94f49a881fc11b39a47bb`, id `central-snapshot-ab-58f2f8910abee80f`,18 fontes comuns; manifesto SHA256 `252c80d48081fe9768d02e9d393060b89d1e32864b62943903aae9bcb9691278`.
- Imagens PostgreSQL18/Keycloak, seed, SQL043/tenant034 e38 versões de dependências por braço iguais à baseline. Versões/lockfiles são verificados; os bytes dos módulos instalados não estão arquivados.
- Regressões SQL e executores RED→GREEN. Validação final comum:31 testes focados e17 verificações de sintaxe PASS. Cópia de validação B:2244 testes backend PASS/7 SKIP,494 frontend PASS e build PASS. Suites reutilizadas entre os dois pacotes após verificar igualdade de todos os bytes runtime e das três regressões backend; só mudou o adaptador funcional comum. As árvores de carga A/B não recebem overlays de testes nem builds.
- Prontidão final `evidence/6858547a52ed431d8718719bbd1ed9fe/report.json`: PASS.22 casos de deriva por revisão042/043, JSON byte a byte/fingerprints, login runtime limitado; oito provas reais após lock (duas por braço/revisão), sem callback protegido executado.34 pedidos HTTP/OIDC nos dois braços, com recusas esperadas e isolamento entre tenants. Cleanup dos quatro processos/oito contentores e integridade PASS.

Os casos de deriva transacionais são preparados pelo owner e observados com SET LOCAL ROLE runtime. Baselines e provas após lock usam login limitado real. Um objeto novo de outro schema, pertencente à autoridade mas com ACL explicitamente vazio, não produz linhas no contrato anterior; a prova preserva e identifica esse comportamento, sem o reinterpretar como deteção nova.

## Medição M

M compara o agregado original A com o agregado otimizado B; não é o antigo M7/M1. São seis pares alternados AB/BA por revisão,10 aquecimentos+100 medidas por braço/bloco:2400 medidas,240 aquecimentos e16 chamadas funcionais. Resultado bruto `evidence/62b84bafdcc249d8879692256bba757e/report.json`: PASS, cleanup/integridade PASS.

| Revisão | Braço | n | p50 ms | p95 ms | Máximo ms |
|---|---|---:|---:|---:|---:|
|043|A|600|82,5791|90,8886|129,1026|
|043|B|600|69,4913|79,4706|122,3205|
|042|A|600|75,2737|83,6687|109,7102|
|042|B|600|62,4625|69,2960|90,8863|

As reduções da mediana agregada são 15,8%/17,0% em 043/042. B tem p50 inferior em 6/6 pares de cada revisão. Em p95, melhora em 5/6 pares de 043 e 6/6 de 042: o par restante de 043 piora 5,82%, conservado nos resultados. Não se confunde a diferença dos quantis agrupados com a mediana das diferenças por par.

## Medição H e análise

Planeado: quatro pares AB/BA/AB/BA, fixture nova por braço,36 pedidos medidos+7 aquecimentos por braço, seis cenários originais (relatório C1/C2/C4; dashboard C1/C4/C4 com dois tenants). Cada braço passa17 controlos HTTP/OIDC antes da carga. Nenhum teste/build próprio corre durante as medições M/H.

A primeira execução H parou no índice4/A:172 pedidos medidos responderam200; o sexto aquecimento desse braço recebeu503/SERVICE_UNAVAILABLE com LEASE_TIMEOUT,20,479s. O cenário dashboard C4/dois tenants não iniciou as oito medições nem o aquecimento do tenant1. Resultado global FAIL, cleanup/integridade PASS; nenhum dado foi descartado. A [continuação registada](../references/performance/central-snapshot-ab-continuation.md) trata apenas os índices5–7 ainda não executados, sem repetir a falha ou alterar limites. A campanha continuará explicitamente FAIL/incompleta mesmo que esses braços passem.

O [diagnóstico do pedido](central-security-snapshot-ab-analysis/failure-analysis.json) identifica2005 comandos sem erro SQL,19,727s de união de intervalos SQL (96,32% dos20,479s HTTP),16,702s de metadados e nenhuma fila tenant observada. O maior snapshot Central demorou1,443s, contra59,804ms no aquecimento dashboard anterior. A própria consulta do sampler chegou a515ms. A maior lacuna sem SQL foi58ms; há inflação distribuída dos tempos, não evidência de uma única pausa sem progresso. CPU Node observada18,68% de um core. Os dados não identificam a causa em PostgreSQL/transporte/agendamento/host, nem distinguem qual timer produziu LEASE_TIMEOUT: limite operacional10s e limite de alocação15s são mecanismos distintos. Não se pode afirmar que B corrige esta causa por não a ter observado nos primeiros braços.

A continuação `evidence/fa25d4a600a34e56b6a6d49ec514e9e2/report.json` concluiu os índices 5B/6B/7A com PASS, preservando o estado global FAIL. Total: **280/280 pedidos medidos HTTP200**, 55 aquecimentos (54 HTTP200 e o 503), 136 controlos de prontidão. Faltam oito medidas e um aquecimento do índice4/A. O braço falhado não foi repetido. Há 272 medidas em pares completos e oito observações B sem par, conservadas separadamente.

A [análise final](central-security-snapshot-ab-analysis/final-684b1579f8614d7191bf6a0be8dc7378/summary.json) é `DATA_PASS_PROTOCOL_FAIL`: zero inconsistências de dados/validação inesperadas; sete consequências explícitas da falha do protocolo. Hashes dos relatórios filho, proveniência, contagens, fingerprints, respostas normalizadas, drenagem e contagens SQL/checkpoints conferem. Os 23 pares completos de cenário têm p50 e p95 inferiores em B. Os cinco primeiros cenários têm quatro pares; o cenário com dois tenants tem três.

Como o par2 foi interrompido antes de B, a tabela seguinte usa a análise de sensibilidade **pré-registada**, apenas pares0/1/3. São p50/p95 agrupados dos pedidos desses pares, em segundos, sem excluir outliers dentro de cada população:

| Cenário | n por braço | p50 A → B | Variação p50 | p95 A → B | Máximo A → B |
|---|---:|---:|---:|---:|---:|
| Relatório C1 | 12 | 3,897 → 3,425 | −12,10% | 3,961 → 3,527 | 3,961 → 3,527 |
| Relatório C2 | 12 | 4,233 → 3,664 | −13,45% | 4,848 → 4,217 | 4,848 → 4,217 |
| Relatório C4 | 24 | 5,036 → 4,014 | −20,30% | 6,905 → 5,730 | 6,972 → 5,805 |
| Dashboard C1 | 12 | 9,538 → 8,061 | −15,48% | 9,850 → 8,213 | 9,850 → 8,213 |
| Dashboard C4 | 24 | 11,213 → 9,655 | −13,89% | 12,802 → 11,304 | 13,444 → 11,406 |
| Dashboard C4, dois tenants | 24 | 11,566 → 9,709 | −16,06% | 12,675 → 10,603 | 12,709 → 10,694 |

Usando todos os pares completos, incluindo os cinco cenários observados do par2, os p50 são: relatório C1 3,918→3,401s; C2 4,248→3,647s; C4 4,966→3,961s; dashboard C1 9,600→7,908s; C4 11,146→9,624s. O cenário com dois tenants é igual à tabela. Todos os quantis, máximos, médias, efeitos por par, observações sem par e falhas estão nos [CSV da análise](central-security-snapshot-ab-analysis/final-684b1579f8614d7191bf6a0be8dc7378/http-populations.csv).

## Custos dominantes após a otimização

O [derivado com hashes e método](central-security-snapshot-ab-analysis/derived-costs.json) separa intervalos SQL, checkpoints e profiling. No C1 de B, pares0/1/3, os metadados continuam a dominar: mediana da fração por pedido de **76,23% no relatório e77,14% no dashboard**, com uniões medianas de 2,620s e6,194s. Central representa 55,39%/50,59%; tenant 21,05%/26,59%. São medianas de razões por pedido; não somar medianas de distribuições distintas.

Os dois SQL alterados representam em B uniões medianas de 1,565s no relatório e3,313s no dashboard (45,68%/41,62% por pedido). A consulta base Central continua mais cara: 0,955s/2,046s; segurança de autoridade 0,604s/1,282s. A mediana das diferenças por par é compatível com a melhoria concentrada nestas consultas: HTTP −0,444s versus SQL-alvo −0,481s no relatório; HTTP −1,473s versus SQL-alvo −1,470s no dashboard. Estes valores não constituem uma percentagem causal nem CPU SQL.

As contagens são exatamente iguais em A/B: relatório **1195 comandos,52 transações,25 checkpoints Central,50 execuções do SQL de autoridade e3 observações tenant**; dashboard **2841/113/53/106/9**. A melhoria vem de menos trabalho dentro dos SQL, sem suprimir verificações. As 12 combinações de cenário/braço passaram a invariância.

Em C4 persistem custos na cauda da auditoria: em B, p95 da união `audit-prepare` por pedido 1,510s no relatório e1,571s no dashboard de um tenant; medianas apenas38/41ms. No C4 dos pares0/1/3, aquisição observada do lock tem p50 B de144/272ms (relatório/dashboard), inferior a263/453ms em A. O tempo de lock mantido sobrepõe consultas SQL. Fila tenant observada zero; checkout wait p95 em B até53ms e aquisição do manager até14ms. Estes custos não justificam aumentar pools ou timeouts com a evidência disponível.

Os oito EXPLAIN finais foram executados fora da medição. Em043, execução Central 38,101→36,420ms e shared buffer hits13094→10632; segurança17,248→11,169ms, hits839→502 e invocações `aclexplode`29703→62. Em042: Central36,825→32,978ms; segurança17,572→9,019ms e `aclexplode`29232→58. São perfis únicos, não uma série estatística. Não houve shared reads ou I/O temporário nestes planos; JIT não estava presente no resultado, o que não é uma medição de duração zero.

## Tentativas e limites

A primeira tentativa de prontidão, pacote `central-snapshot-ab-b1e3e99cf9edd9c5` em `output/central-snapshot-ab-94af372890614fa799765cd7293dd290`, ficou FAIL em `evidence/d21f8c45c88c4a9b8dd5c71cebda51b6/report.json`: o adaptador histórico M7/M1 exigia a projeção SQL antiga e recusou a otimização antes da prova pós-lock de B. Os22 casos043 e pós-lock A já tinham passado. A tentativa, planos e cleanup PASS estão conservados. Corrigiu-se o adaptador comum para chamar o coletor real de cada braço; os dois SQL runtime permaneceram idênticos. A tentativa inicial de acesso Docker no sandbox também ficou registada; a execução autorizada fora desse limite foi necessária para os recursos locais.

A revisão independente corrigiu, com regressões, a atribuição de resultados filho ao braço/revisão e a interrupção antes de criar outra fixture quando cleanup falha. O continuador passou sete regressões e duas verificações de sintaxe. O analisador passou 11 testes: a primeira análise guardada em `final-88dc1be92d3b47a4832e5affa509fbba` esperava indevidamente o LEASE_TIMEOUT numa admissão; o registo real estava em `metrics.failures`, durante a operação. O leitor foi corrigido com RED→GREEN, sem alterar brutos nem cálculos numéricos; a análise final foi escrita noutro diretório. Revisão independente sem bloqueantes restantes.

Os orçamentos originais não foram prolongados. Um hardkill pode perder arrays de amostras ainda em memória, inclusive de blocos anteriores: os checkpoints persistem progresso; arrays completos são anexados no retorno ou erro tratado. Nesse caso o ensaio fica FAIL/incompleto, nunca PASS.

A [verificação final](../../output/central-snapshot-sql-development/final-verification.json) confirmou os dois SQL atuais iguais a B, ambos os pacotes/arquivos/dependências intactos, os 15 relatórios filho e as respetivas saídas verificadas, sem terminação forçada. Um inventário Docker local confirmou os **30 IDs próprios ausentes**. A execução habitual044, feita em paralelo, é outra versão e não foi usada nesta comparação.

Host Windows não reservado,24 processadores lógicos, plano de energia Equilibrado; carga externa não controlada. Quantis nearest-rank sem arredondamento antes das decisões. H é amostragem diagnóstica; p95 por par com4/8 pedidos coincide com o máximo. Tempos do driver incluem transporte/execução/esperas, não medem CPU PostgreSQL; spans e intervalos sobrepostos não são aditivos. Não há certificação de capacidade/C6, W, alteração habitual, commit ou deploy.

Referências para a revisão da semântica PostgreSQL: [constraints NOT NULL em ALTER TABLE18](https://www.postgresql.org/docs/18/sql-altertable.html), [grants por objeto/coluna e grantor](https://www.postgresql.org/docs/18/sql-grant.html), [implementação de pg_get_constraintdef](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/utils/adt/ruleutils.c).

Estado de aceitação: implementação SQL, paridade/autoridade, M, validade dos dados registados e cleanup satisfeitos. **A aceitação integral de H permanece por cumprir** por503 e amostras em falta. Não marcar a feature como Complete nem usar estes números como aprovação de produção. [Descritor de evidência](../references/performance/central-security-snapshot-ab.json).

Próximo passo: diagnosticar a degradação distribuída que originou o LEASE_TIMEOUT e repetir H completo, mantendo os limites e a autoridade.
