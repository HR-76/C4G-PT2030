# Tentativa de arranque — pré-condição Docker indisponível

**28/10/2026 — NOT_RUN antes de infraestrutura.** [Registo seguro](attempt.json), [manifest revisto](sources.json), [preservação](verification.json). Este registo não é uma quinta execução PostgreSQL nem substitui qualquer das quatro falhas anteriores.

O utilizador autorizou uma nova tentativa descartável com diagnóstico temporal. O comando do runbook foi invocado com a imagem local imutável já escolhida, scope C4G_PARTNER_PORTAL_DISPOSABLE_V1 e fontes verificadas. Terminou com exit 1 e GATE_FAILED antes de produzir um diretório de execução. Não foi criado contentor, aplicado SQL/migrations/grants ou executado qualquer probe.

A verificação posterior read-only confirmou Docker CLI e contexto local válidos, mas docker info terminou com exit 1; classificação segura LOCAL_DOCKER_PIPE_NOT_FOUND. O named pipe não estava disponível. Isto não identifica a causa da indisponibilidade do daemon nem comprova que a imagem está agora acessível. Não se iniciou, parou ou reconfigurou qualquer serviço existente.

As 12 regressões temporais foram repetidas e passaram; manifest com 1014 fontes coincide. Nenhuma alteração de código ou teste novo. Suites completas/build não repetidos; validação anterior: foco 207 PASS, backend 1547 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS.

Sem tempos novos, sem medições antes/depois e sem dados para localizar o custo dos três timeouts. A revisão read-only não encontrou bloqueio de código conhecido. Mantêm-se as limitações de tempos inclusivos e do overhead da instrumentação; nenhuma inferência causal foi acrescentada.

Branch feat/f13-organizational-profile, HEAD 0cf519ea22de929d2e52d0b3edb4d72364aa6220; baseline 2625 entradas no worktree e 30999 ficheiros. Os 16 ficheiros das quatro execuções anteriores mantêm os hashes. Runtime, protótipo, fontes de migrations/permissões e dados Dev preservados. Sem commit, merge, push, deploy ou integração.

**Próximo passo:** disponibilizar o daemon Docker local e retomar a tentativa já autorizada, preservando este registo e as quatro execuções anteriores.
