# AUD-054 — Filas e backpressure

Estado: parcial. Revisão de código e testes locais, sem medição de carga nem acesso a ambientes produtivos.

- O worker de documentos impede ciclos simultâneos no mesmo processo e processa tipos e lotes sequencialmente; a configuração limita cada lote a 1–10 (`backend/src/documentWorker.js`). Isto não limita o número de processos nem o total de mensagens duráveis.
- A outbox é gravada em transação e o relay reclama no máximo dez itens por passagem; o adaptador publica no pg-boss. Não foi identificado neste percurso um limite distribuído para a acumulação ou uma política de admissão quando o consumidor atrasa (`backend/src/async/outboxRepository.js`, `outboxRelay.js`, `adapters/pgBossQueueAdapter.js`). Isto não prova saturação real.
- `createDocumentConcurrency` limita a fila em memória por organização e globalmente e os testes unitários verificam rejeição, cancelamento e libertação de capacidade. A pesquisa por referências encontrou chamadas apenas nos testes, não no runtime. Não se deve atribuir este limite ao processamento produtivo sem integração e testes.
- A gestão de pools tenant possui uma fila limitada com reserva operacional (`backend/src/security/tenantPoolManager.js`); este limite protege a admissão a pools e não é uma quota da outbox ou do pg-boss.
- Os testes direcionados `node --test test/documentConcurrencyBounds.test.js test/f9AsyncExecution.test.js` passaram: 20 testes. Estes testes não demonstram limites distribuídos nem comportamento com consumidores parados.

Risco: crescimento prolongado de pendências e atraso de processamento caso a entrada exceda a capacidade, com possível impacto na disponibilidade e justiça entre organizações. Severidade proposta: alta; dimensão e frequência desconhecidas.

Para correção: acordar o comportamento de admissão por tipo de trabalho, definir limites com base em capacidade medida e preservar operações críticas, idempotência e recuperação. Uma contagem anterior à inserção sem coordenação transacional não constitui limite seguro entre produtores concorrentes. A decisão deve cobrir outboxes por tenant e fila central, estados já aceites, retries e erros devolvidos aos utilizadores.

Decisões do utilizador: ao atingir a capacidade segura, recusar temporariamente novos trabalhos não críticos e permitir nova tentativa; reservar capacidade para segurança, análise de documentos e recuperação. Trabalhos já aceites não podem ser descartados por esta política. Os limiares e a dimensão da reserva devem resultar de medições, não foram definidos. É necessário identificar os pontos de admissão transacionais, preservar replay idempotente, e determinar como comunicar indisponibilidade e quando permitir nova tentativa antes de implementar.

Inventário inicial: `document.scan` é análise de documentos; `document.reconcile` e `document.expire_upload` são candidatos a recuperação, a confirmar em cada efeito; `funding_tenders.refresh` e `application.status.notify` são trabalhos existentes cujo tratamento deve ser confirmado face à definição de criticidade. Retries e replays de trabalhos já aceites precisam de tratamento que não os impeça de concluir.

Critérios para a solução: (1) admissão e consumo da capacidade devem ser atómicos entre processos e não podem abrir uma janela entre contagem e inserção; (2) repetição idempotente de um pedido já aceite continua possível mesmo sob saturação; (3) trabalhos não críticos novos recebem recusa transitória recuperável, sem deixar alterações parciais; (4) a reserva aprovada é mantida sem permitir que um produtor escolha a sua própria classe; (5) os limites e reserva são configuráveis e devidamente medidos; (6) filas central e tenant, falhas, recuperação e isolamento são verificados em PostgreSQL isolado.

Validação necessária: teste isolado com múltiplos produtores e consumidores parados, cruzando limiares e organizações; verificar ausência de perda, rejeição explícita quando aplicável, retomada após recuperação, retries idempotentes e reserva operacional. Requer infraestrutura PostgreSQL isolada e autorização própria conforme AGENTS.md. Não aplicar alterações nem carga às bases habituais.
