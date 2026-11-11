# SQL dos snapshots Central e segurança — otimização e A/B

31/10/2026 — pedido explícito: otimizar os SQL dos snapshots Central/segurança e medir em A/B, preservando as verificações de autoridade e após lock.

## Âmbito

Otimizar apenas a consulta base de `centralSchemaSnapshot` e a consulta de `authoritySecuritySnapshot`. A referência A é a versão medida `eu-writer-trial-0ecb31dc7c705859`; B deriva dessa referência com as duas alterações SQL e testes identificados. Preservar as fontes/artefactos imutáveis anteriores e as alterações paralelas do workspace. Não incorporar silenciosamente agrupamentos do relatório, alterações tenant, janela043 ou outros incrementos.

Não alterar dados, migrations, fingerprints esperados, composição das memberships, checkpoints, limites/timeouts, permissões SQL ou a sequência do coordenador. Manter a recolha fresca antes de BEGIN e a recolha independente depois do advisory lock, sem cache entre chamadas, transações, pedidos ou ligações. A otimização deve produzir o mesmo JSON serializado e os mesmos fingerprints, incluindo ACLs PUBLIC/terceiros, colunas, owners, role membership e atributos, objetos de outros schemas protegidos por ownership/grants e casos NOT NULL PostgreSQL.

O pedido autoriza os ensaios e planos SQL em novos recursos próprios PostgreSQL18/Keycloak, imagens locais fixadas, portas loopback, bases/roles/seed sintéticos, migrations042/043/tenant034 apenas nessas bases, HTTP/OIDC e cleanup por ID/nome/label. Nenhuma operação usa ou gere bases/serviços habituais. Não fazer commit/deploy. W e certificação C6 ficam fora deste incremento.

## Critérios de aceitação

1. Registar o contrato antes da implementação e adicionar regressões RED antes de alterar SQL. Testes devem exigir preservação de segurança/frescura/erros e a mudança estrutural que elimina o trabalho desnecessário, sem enfraquecer os critérios existentes.
2. Demonstrar em PostgreSQL18 isolado paridade A/B de JSON byte a byte e fingerprints em042/043, com ligações runtime limitadas. Conferir planos de execução das consultas candidatas quando necessário e separar profiling de medição.
3. Exercitar deriva de schema, ACLs de terceiros/PUBLIC/coluna, ownership, membership/atributos de role e alterações após lock. A e B devem recusar as mesmas alterações antes de trabalho protegido, com rollback/restauro/revalidação. Não remover nem fundir os dois checkpoints de autoridade.
4. Congelar A/B, manifesto, harness, dependências, seed e imagens antes de cronometrar. A aplicação B difere da A apenas nas duas fontes runtime autorizadas; testes e instrumentação adicionais têm proveniência explícita e são comuns à comparação onde aplicável.
5. M A/B: por revisão042/043, seis pares alternados AB/BA,10 aquecimentos+100 medições por braço/bloco,600 amostras por braço/revisão. Comparar o coletor agregado original A com o coletor otimizado B, mantendo todas as leituras de segurança. Não confundir com o antigo M7/M1.
6. H A/B: quatro pares com ordem AB/BA/AB/BA, fixture nova por braço, mesma matriz de seis cenários e volumes da baseline (36 medidas+7 aquecimentos por braço), total288 tentativas medidas e56 aquecimentos. Prova HTTP/OIDC funcional antes de cada braço. A amostra é diagnóstica, não certificação de capacidade ou C6.
7. Executar braços sequencialmente, sem testes/builds próprios concorrentes; conservar erros, outliers e falhas. Orçamentos existentes: preparação300s, bloco M300s, cenário H180s, drenagem30s, cleanup120s. Não prolongar limites silenciosamente nem produzir PASS com evidência incompleta.
8. Correr sintaxe, testes focados, suites backend/frontend e build antes da carga. Rever independentemente SQL, equivalência, fronteiras de autoridade e metodologia. Após medição, conferir fontes, saída dos processos, drenagem e remoção de todos os recursos próprios.
9. Publicar efeitos A/B por revisão/par/cenário, contagens, p50/p95/máximo, custos SQL/admissão/locks e limites do host. Aceitar melhoria apenas com paridade e segurança preservadas; não atribuir à otimização diferenças entre versões/ambientes. Se o candidato não melhorar, conservar a evidência e declarar o resultado.

## Sequência

Inspeção e regressões → otimização SQL → prova isolada de equivalência/segurança → validação local/revisão → congelar A/B/protocolo → M A/B → H A/B → análise/revisão/fecho. Os resultados anteriores identificam custo elevado na projeção de constraints Central e nos predicados/expansão de ACLs; são hipóteses de otimização a confirmar, não autorização para reduzir cobertura de segurança.

## Resultado — Review, aceitação H pendente

[Relatório e limites](../reviews/central-security-snapshot-sql-performance.md): dois SQL implementados, paridade042/043, deriva e autoridade após lock comprovadas; M2400 PASS. H encontrou um503/LEASE_TIMEOUT no aquecimento do índice4/A e ficou incompleto. A [extensão registada antes da continuação](../references/performance/central-snapshot-ab-continuation.md) concluiu apenas5B/6B/7A, sem repetir a falha nem alterar limites. Total280 medidas200/55 aquecimentos, um dos quais503; oito medidas e um aquecimento não executados. Dados conferidos, protocolo global FAIL. O contrato original e as tentativas permanecem arquivados; o critério de aceitação integral H não foi relaxado.

M p50 melhora15,8–17,0%; HTTP p50 melhora12,1–20,3% nos três pares sem a interrupção. Não demonstra resolução da causa do503 ou desempenho habitual044. Segurança, fontes, testes e cleanup conferidos no [descritor](../references/performance/central-security-snapshot-ab.json).

Próximo passo: diagnosticar a degradação distribuída que originou o LEASE_TIMEOUT e repetir H completo com os mesmos limites e autoridade.
