# Admissão e outbox restrita — 2026-11-02

Consulta central registada no protocolo JavaScript, hash validado contra o candidato SQL e limite SQL de 1000 candidatos. Composição usa coordinator.withAuthority/coordinator.pool. Pacote próprio com checksums; sem registo em installers ou mudança de fingerprints de produção.

A função enqueue_status_delivery substitui acesso direto à tabela outbox. Runtime recebe apenas EXECUTE; owner não-login recebe INSERT. Search path fixo, PUBLIC revogado, valida contexto organizacional, entrega pendente e envelope fechado desta operação. Sem UPDATE/DELETE de jobs.

Gate executado em PostgreSQL descartável, com duas bases. Central liga como c4g_authority_runtime e seleciona coordinator; tenant usa papel c4g_opportunity_tenant_runtime, incluindo login restrito separado nos testes negativos. Definição real do executor central recuperada da migração 025, candidato aplicado; fixtures mínimas de dados. Não constitui migração integral até à versão de produção nem validação do fingerprint de toda essa instalação.

Comprovados: consulta admitida; recusa de SQL não admitido e leitura direta central; recusa de SELECT/INSERT/UPDATE/DELETE diretos da outbox; recusa de enqueue cruzado; commit, replay sem duplicação, rollback após outbox, indisponibilidade e suspensão. Sem emails; containers removidos no finally. Nenhuma base da APP alterada.

Testes focados da componente: 39 aprovados. Testes do catálogo de autoridade: 9 aprovados. O teste de comparação exata foi estendido para incluir o candidato; manteve os hashes/contagens das extensões existentes.

Próximo passo: integrar o consumidor com transporte simulado e revalidação de acesso por destinatário. Antes de ativação real, validar o pacote completo de migração/fingerprint no deployment alvo. Emails continuam desativados.

Suite backend final: 2640 testes, 2633 aprovados, 7 ignorados, zero falhas; exit 0. Evidência: application-status-emails-security-suite.log. Verificação sintática e diff --check aprovados.
