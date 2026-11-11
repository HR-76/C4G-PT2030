# Aplicação local do pacote member_email_delivery

Pedido de 2026-11-06: verificar requisitos e aplicar à base local sem afetar funcionamento existente.

Destino confirmado: PostgreSQL 18, localhost:5432, `c4g_central_dev`, marcador C4G CENTRAL, revisão `048_catalog_read_service_v1`. Preflight inicial PASS. A função ainda não contém a consulta nova. Backup da definição, owner, ACL e search_path em `.tmp/member-email-rollout/before-function.json`.

O SQL sozinho provocaria divergência de fingerprint. A admissão aditiva em `memberEmailAdmission.js` aceita exclusivamente a variante ensaiada da revisão 048, mantendo os fingerprints históricos. Schema e authority são verificados separadamente; outras versões, grants e alterações continuam recusadas. Não altera a ledger de migrations nem presume compatibilidade com a futura 049.

Ensaios executados com transação, lock_timeout 3s, statement_timeout 15s, locks de migrations e de autoridade e ROLLBACK obrigatório:
- Comparação completa do snapshot antes/depois: só mudou a definição de `authority_api.execute`, repetida para os dois destinatários da ACL; todo o resto permaneceu igual.
- Manifesto central, manifesto de autoridade e admissão do leitor PASS após o patch.
- Consulta executada como `c4g_authority_runtime` com UUIDs inexistentes: zero linhas afetadas.
- Rollback e fingerprint original confirmados.
- Evidência em `.tmp/member-email-rollout/rehearsal.json`; scripts de ensaio `.tmp/member-email-rehearsal.cjs` e `.tmp/member-email-validate.cjs`.

Validação: 52 testes focados de admissão, rejeição de drift e leitor PASS. A suite completa inicial encontrou falhas no mock isolado (corrigido para carregar a dependência real) e mudanças concorrentes de faturação/autorização fora deste trabalho. O utilizador confirmou outro trabalho em curso. A API deixou de estar em execução durante a validação.

Estado: **sem COMMIT na base**. Aguardar janela estável e API funcional, repetir preflight e verificar se a base continua na revisão/fingerprint ensaiados. Se diferentes, não reutilizar esta admissão por inferência. Aplicar apenas numa transação com os mesmos locks, provar preservação dos registos de membership/onboarding/ledger, revalidar antes do COMMIT, confirmar preflight com a credencial runtime e saúde HTTP depois. Registar recibo local e repetir como no-op para provar idempotência. Não enviar email nem reiniciar o trabalho concorrente.
