# Diagnóstico LEASE_TIMEOUT e repetição integral de H

31/10/2026 — pedido explícito: diagnosticar o `LEASE_TIMEOUT` e repetir H completo, mantendo os limites e a autoridade. Contrato registado antes de novas provas ou execução.

## Âmbito e critérios de aceitação

1. Preservar a campanha H anterior `bfd7495e00394b85821c568571e26908`, a continuação `fa25d4a600a34e56b6a6d49ec514e9e2`, os seus resultados FAIL e todos os dados. A repetição é uma campanha nova, previamente definida, sem seleção de tentativas favoráveis.
2. Diagnosticar o prazo efetivo a partir do código congelado, dos hashes SQL e da cronologia. Distinguir prazo operacional de 10 s, allocation de 15 s e timeout PostgreSQL por statement; distinguir evidência direta, reconstrução e hipótese de carga do host. Correlacionar apenas timestamps e artefactos não sensíveis do trabalho paralelo.
3. Validar o mecanismo de prazo num ensaio determinístico externo que carrega o executor congelado, com relógio/scheduler e adaptadores controlados. Cobrir operação de 10 s, prazo restante de allocation menor e expiração durante a finalização da autoridade após COMMIT. Esta prova não simula desempenho nem substitui HTTP/PostgreSQL reais. Não alterar runtime, limites, SQL, guardas ou o pacote medido.
4. Repetir uma vez H integral com `central-snapshot-ab-58f2f8910abee80f`, manifesto SHA256 `252c80d48081fe9768d02e9d393060b89d1e32864b62943903aae9bcb9691278`, runner comum original, A/B043/tenant034 e prontidão histórica SHA256 `20b7175d004270c7350a530188dc7f212dfa0180d55c59ae5436eac8a88c8ffd`. Revalidar fontes, dependências, seed e imagens. O runner mantém a nova prontidão HTTP/OIDC de 17 controlos antes de cada braço.
5. Ordem fixa: A/B, B/A, A/B, B/A; oito fixtures novas, seis cenários por braço, 36 medidas e sete aquecimentos por braço: 288 medidas, 56 aquecimentos e 136 controlos. Manter concorrência C1/C2/C4, dois tenants, autoridade fresca antes e após lock e todos os checkpoints. Preparação300 s, cenário180 s, drenagem30 s, cleanup120 s; limites de operação/pools/lease intactos.
6. Executar sequencialmente, sem testes/builds/análises pesadas próprios durante a carga. Registar o contexto do host sem gerir serviços/processos alheios ou declarar exclusividade não demonstrada. Usar apenas recursos sintéticos próprios, imagens locais fixadas e portas loopback; nenhuma base ou serviço habitual é gerido. O pedido autoriza esta repetição isolada e o cleanup pelos IDs próprios.
7. Manter o fail-fast original: qualquer erro continua FAIL e não origina nova tentativa automática. Conferir hashes, processos terminados, drenagem e remoção de todos os recursos efetivamente criados (16 contentores previstos se os oito braços arrancarem) antes de declarar conclusão. Não mascarar falhas de aquecimento.
8. Analisar a nova campanha separadamente com o analisador congelado, em pasta nova, usando a prontidão e M originais. Exigir oito braços PASS, quatro pares completos por cenário, 288/56 e zero inconsistências para H PASS. Publicar latências e custos dominantes, comparar com o histórico e declarar os limites de causalidade. Sucesso novo não apaga o erro anterior nem certifica capacidade/C6 ou desempenho habitual044.

## Entregáveis

Diagnóstico com provas e limites; teste externo e resultado; relatório H novo e análise verificável; descritor com hashes e revisão independente. Não há correção funcional pressuposta: se o diagnóstico demonstrar defeito que exija alteração de runtime, documentar esse incremento e regressão antes de o implementar.

Estado: Implementação — diagnóstico e preparação da repetição.
