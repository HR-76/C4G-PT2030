# Motor real e worker restrito — 2026-11-02

Ligado createPolicyEngine com catálogos de produção, identidade do destinatário, leituras permitidas, bindings de recurso e recarregamento de membership/snapshot sem cache. Sem autoridade do autor/service actor ou MFA fabricado.

Candidato SQL com checksum cria c4g_status_simulation_worker NOLOGIN/NOINHERIT. Grants: SELECT no evento/entrega/ledger, INSERT no ledger e UPDATE(state,reason,lease_until,fence). Sem outbox, DELETE, alteração de mensagem ou candidatura. RLS preservada.

Gate PostgreSQL descartável passou com login restrito e motor real: processamento, resposta perdida, idempotência, suspensão, recusas de leitura/escrita fora de âmbito e isolamento organizacional. Fixtures de identidade/snapshot ainda são carregadas por ports do teste: não é prova do deployment completo ou das credenciais centrais produtivas. Transportes reais não existem nesta execução.

Validação final: 55 testes focados; suite backend 2649 aprovados, 7 ignorados, zero falhas, 2656 total. Evidência application-status-emails-worker-suite.log. Sintaxe e diff verificados. Sem bases da APP, frontend ou deploy alterados; emails reais desativados.

Próximo passo: validar concorrência, expiração de leases e recuperação após reinício com este papel worker e motor real, mantendo simulação e dados isolados.
