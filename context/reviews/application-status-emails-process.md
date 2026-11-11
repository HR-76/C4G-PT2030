# Interrupção e reinício de processo — 2026-11-02

Gate ampliado com fork de Node em processos OS distintos, login status_worker_login/papel c4g_status_simulation_worker e store PostgreSQL real. Consumer e transporte simulado são construídos dentro de cada processo filho. Autoridade é solicitada por IPC ao serviço de fixture no pai, que executa o motor real com dados centrais atuais. Credenciais efémeras via IPC, nunca argumentos/logs; apenas processos criados pelo gate são terminados.

Provas aprovadas:
1. Processo confirma reserva persistida e é terminado com SIGKILL antes do transporte.
2. Novo processo antes de expirar lease retorna DELIVERY_BUSY, zero chamadas.
3. Processo iniciado após expiração e suspensão do membro retorna RECONCILIATION_REQUIRED, zero chamadas.
4. Após restaurar membership, novo processo recupera e aceita exatamente uma vez na simulação.
5. Terminado esse processo, novo processo encontra ACCEPTED persistido e não chama transporte.

Relógio controlado, PostgreSQL/container descartáveis. Cleanup aguarda exits e remove container. Não foram necessárias alterações funcionais do consumidor. Teste usa host isolado do consumer/registry, não arranca worker global/dispatch da APP. Não é prova da interrupção entre aceitação externa e gravação do resultado: essa janela requer fornecedor simulado com estado independente do worker e permanece etapa seguinte. Não há Resend nem emails reais.

Próximo passo: validar interrupção após aceitação pelo fornecedor simulado e antes da gravação local, mantendo a idempotência do fornecedor independente do processo worker.

Validação final: gate repetido aprovado; backend 2649 aprovados, 7 ignorados, zero falhas (2656 total), exit 0. Evidência application-status-emails-process-suite.log. Sintaxe dos três scripts e diff verificados.
