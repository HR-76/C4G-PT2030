# Percurso integrado simulado — 2026-11-03

GCNI_C4G. Gates executados em dois ambientes PostgreSQL descartáveis independentes, para ORG_ADMIN e CONTRIBUTOR. Corrigida a fixture que usava ORG_MEMBER (perfil inexistente no catálogo real); não foi alterado código funcional ou o catálogo de permissões.

Sequência executada em cada gate:
1. Repositório real grava transição, histórico, evento, entregas e outbox; repetição do recibo não duplica.
2. Consumidor usa motor real com perfil/grants explícitos, worker restrito e transporte simulado. Mensagem persistida no ledger de simulação.
3. Harness extrai URL da própria mensagem persistida, verifica organização/candidatura e abre esse caminho no Chrome headless com o build da APP.
4. Sessão começa noutra organização. Antes de confirmar, zero pedidos de detalhe e zero seleções automáticas.
5. Confirmação explícita seleciona a organização; o detalhe apresentado deriva da linha real do PostgreSQL da fixture. A decisão de leitura é avaliada pelo motor real.
6. Link para organização indisponível não faz GET do detalhe.
7. Removidos grants na fonte central da fixture: reabrir o link apresenta recusa 403, sem título privado da candidatura.

Ambos os gates também repetiram rollback, revogação, concorrência, leases, SIGKILL/reinício e janela aceitação/commit com idempotência simulada.

Validação complementar: 56 testes backend da componente e 32 testes frontend de gate/rotas/login aprovados. Sintaxe dos scripts e diff verificados. Suites completas/build aprovados na etapa anterior, não reexecutados nesta etapa de harness; nenhum ficheiro funcional frontend/backend alterado.

Limites explícitos: navegador usa HTTP/sessão interceptados; autorização de leitura usa motor real, dados vêm de PostgreSQL. Não é login OIDC real nem servidor HTTP produtivo. A autorização do comando de transição e auditoria no gate continuam ports de fixture. Mensagem apresenta estado histórico e página estado atual, comportamento intencional. Não foi avaliada autorização para o membro efetuar transições: o perfil é destinatário/leitor neste percurso. Sem emails reais, alterações à APP em execução ou deploy.

Comandos: backend/node scripts/testStatusEmailTransaction.js --browser; repetir com --member. O helper statusEmailBrowserProbe reaproveita o harness Playwright e Chrome instalados. Todos os containers são removidos no finally.

Próximo passo: consolidar a prontidão desta componente e as pendências para ativação futura (manifestos/fingerprints, fontes de autoridade produtivas, worker/dispatcher e configuração do fornecedor), mantendo envios desligados.
