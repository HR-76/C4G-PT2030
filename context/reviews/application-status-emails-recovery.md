# Concorrência e recuperação — 2026-11-02

Gate PostgreSQL descartável estendido com conexões independentes, autenticadas como status_worker_login e papel c4g_status_simulation_worker. Consumer recuperado usa motor real de autorização e transporte simulado.

Provas aprovadas:
- Duas reservas simultâneas da mesma entrega: uma RESERVED, outra BUSY.
- Antes de 30 segundos a reserva continua bloqueada; no limite exato a nova reserva incrementa fence.
- Atualização com fence anterior é recusada, antes e depois da recuperação.
- Encerramento da conexão após commit da reserva e criação de nova conexão/store/consumer recupera o estado persistente após expiração.
- Recuperação produz uma aceitação simulada; repetir o job não chama novamente o fornecedor.
- Mantidos testes de revogação, resposta perdida, rollback, protocolo fechado e isolamento de organizações.

Tempo controlado injetado, sem espera de 30 segundos. Não foi feito kill de processo SO nem reinício de servidor PostgreSQL; a prova é de perda/reconstrução da conexão e das instâncias do worker sobre persistência real. Identidade e snapshots centrais continuam fixtures. Nenhuma correção funcional foi necessária; apenas o gate foi ampliado. Emails reais desativados, sem bases da APP/deploy alterados.

Próximo passo: validar o ciclo completo do processo worker (arranque, interrupção e reinício), ainda com transporte simulado, antes de qualquer ativação.

Suite backend final: 2649 aprovados, 7 ignorados, zero falhas (2656 total). Evidência: application-status-emails-recovery-suite.log. Gate repetido aprovado; sintaxe e diff --check aprovados.
