# Medição M/H da versão EU v2 de ensaio

31/10/2026 — pedido explícito: executar as medições M/H na versão `eu-writer-trial-0ecb31dc7c705859` e identificar os custos dominantes.

## Âmbito autorizado

Executar os modos `--measure-metadata` e `--measure-http` da cópia fixada em `output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/sources`, sequencialmente, com o manifesto e a prova de prontidão `612a14e5e11c41c1a8d2fc38cda17c7c`. Esta autorização sucede à preparação funcional, que não executava carga. Preservar manifesto, protocolos, fontes e provas anteriores.

Usar exclusivamente as instalações PostgreSQL18/Keycloak descartáveis próprias, portas loopback, imagens locais fixadas, dados sintéticos, papéis limitados e cleanup por ID/nome/label já previstos. Nenhuma base, configuração ou serviço habitual será gerido por este incremento. W opcional e C6 futuro ficam fora do âmbito, assim como implementação ou ativação de otimizações.

## Critérios de aceitação

1. Confirmar identidade das 1844 fontes, ZIP, dependências declaradas, manifesto e prova funcional correspondente antes da execução e integridade após os ensaios.
2. M: concluir 042/043 com seis pares alternados M7/M1, dez aquecimentos e cem chamadas medidas por bloco, 600 amostras por variante/revisão; preservar igualdade funcional, segurança, drift e verificações após lock.
3. H: três fixtures independentes, prova HTTP/OIDC antes da carga em cada uma, 108 tentativas medidas e 21 aquecimentos; respeitar cenários, limites, quantis e métricas do protocolo fixado. Não executar M e H simultaneamente nem lançar testes/build em paralelo com a medição.
4. Conservar todas as tentativas, falhas, timeouts, 503, métricas indisponíveis e limites atingidos. Não converter execução incompleta em PASS nem alterar o protocolo para obter sucesso. Caso se revele defeito do executor, preservar a tentativa e distinguir esse defeito do comportamento do produto; qualquer derivação será explicitamente identificada.
5. Conferir fim dos processos, drenagem e remoção de todos os recursos próprios; manter relatórios brutos ligados por hash.
6. Analisar p50/p95, pares e dispersão M; por cenário/réplica H, analisar metadados Central/tenant, consultas, transações, espera/admissão, checkout/hold, locks, CPU/memória observadas e drenagem. Usar união temporal para intervalos sobrepostos; somas de intervalos do driver não são CPU SQL nem parcelas independentes da latência.
7. Identificar custos dominantes com evidência e limites, sem inventar SLO, ganho em produção ou causalidade não medida. Registar que não há reserva exclusiva do host e distinguir interferência possível de contenda efetivamente observada. Publicar revisão e descritor dos resultados e atualizar o trabalho ativo.

## Fontes

- [Preparação e comandos](../reviews/eu-writer-performance-executors.md).
- [Descritor da versão e prontidão](../references/performance/eu-writer-trial.json).
- [Protocolo original](../references/performance/eu-writer-v2-protocol.md), com os adaptadores já fixados na cópia de ensaio.

Próximo passo: executar M, depois H, conferir integridade/cleanup e analisar os custos observados.
