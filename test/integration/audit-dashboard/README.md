# Prova transacional da auditoria de leituras

Executar `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/audit-dashboard/proof.ps1` apenas numa janela sem benchmarks. O runner cria um PostgreSQL 17 exclusivo, com segredo efemero, porta loopback e label unica; remove apenas esse contentor e os seus volumes no final. Nao le configuracao Dev.

A fixture HTTP existente provisiona um tenant sintetico com roles reais. O teste usa o resolver, pool, executor F4, verificacao fisica, funcoes F7 e guards centrais duraveis reais. Um modulo de prova READ fornece evidencia sintetica de autorizacao ao guard: nao substitui o gate HTTP/OIDC/F5.

Verifica ausencia de append no enqueue; retorno apenas depois de persistencia e verificacoes finais; hash chain; rollback integral na falha do segundo append; prefixo e append imediato de export critico; perda observada de membership, fence e prazo enquanto PostgreSQL bloqueia realmente em `audit.chain_head`; expiracao do guard; e COMMIT executado com acknowledgement perdido sem resposta de sucesso. As observacoes negativas e falhas sao injetadas exclusivamente em wrappers da fixture. Nao altera migrations, grants do projeto nem dados persistentes.

Resultado sanitizado: `context/reviews/audit-dashboard-contention/postgres-proof.json`. O teste nao mede desempenho e nao demonstra capacidade produtiva.
