# Entrega 3 — parceiros e contactos por candidatura

2026-10-17 · Review — implementação e ativação local validadas. Pedido explícito: recuperar parceiros/contactos; anexos reais continuam pendentes.

## Implementação

Recuperados o `PartnerForm` e os cartões da página original `ApplicationDetail`, agora partilhados em `PartnerComponents.jsx`. A página original `Partners.jsx` conserva a tabela de seis colunas e passa a consultar o serviço atual no runtime C4G. Papel inicial Outro, sem obrigação de ser investigador. A ficha inclui entidade, país, interesse, responsável, contacto/email e pessoas com papel, área e contactos. Sem criação de contas ou memberships.

Serviço privado com revisão própria por candidatura, IDs de pessoas estáveis, remoção lógica, snapshots históricos, CAS, recibo idempotente e F7 na mesma transação. Leitura depende das permissões sobre candidatura, origem e avaliação. Escrita também exige edição. Países, contagens e pesquisa derivam das associações autorizadas. Pedidos fixam a organização capturada, e respostas antigas são descartadas na mudança de contexto. Histórico e tarefas preexistentes mantidos.

[Contrato HTTP](../references/application-partners-http.md). Migration 028 aditiva, quatro tabelas com RLS forçada, histórico/recibos imutáveis e sem DELETE/TRUNCATE no runtime. Não altera tabelas de negócio existentes. Checksum `9a403e433ebcab39574d43d882d83d09b2a3b762bab45ec38fa11969ffbdfb27`; fingerprint PostgreSQL 17 `1ccdeb2c22e66d4ea673f604ff4b5b28d634bfb7c85b6611bb9a63758688ab29`.

## Validação executada

- Build PASS; 28 testes frontend e 11 backend PASS; sintaxe dos ficheiros backend alterados PASS.
- PostgreSQL/API descartável PASS: criar/editar/reler, pessoas retiradas conservadas, remoção lógica de associação, revisão concorrente (um sucesso/um conflito), resposta de commit perdida e repetição exata, rollback por falha de auditoria, tarefas/revisão da candidatura preservadas.
- Isolamento A/B, ausência de países/contagens/contactos sem acesso à origem, leitor sem escrita, organização capturada incorreta recusada, RLS direta, paginação de 25 e cursores inválidos após alteração/contexto/filtro PASS.
- Migração aplicada/revertida numa transação descartável, fingerprint conforme. Prova com registos anteriores PASS: notas, orçamentos, tarefas, histórico e recibos exatamente preservados.
- Chrome funcional PASS: criação, edição, remoção de pessoa e associação, histórico após reload, envio perdido/repetição exata, pesquisa/filtros, paginação, organização B vazia e zero erros de página. Larguras 1440/1280/1008/390. Evidência `output/playwright/c4g-application-partners/verification.json`.
- [Comparação final](../../output/playwright/c4g-application-partners/comparison.html) revista: tabela, formulário e cartões originais; marca C4G; ação da candidatura visível a 1440 px; apresentação a 1440/1280/1008/390 sem overflow da página. Formulário com pessoa a 1440/1008/390. `visual-verification.json` PASS. Capturas finais usam um parceiro equivalente ao piloto; ensaio funcional separado com 30 associações.
- Ativação local **PASS**, após autorização explícita «Autorizo». A rejeição inicial da revisão automática ficou resolvida. Executado `node backend/scripts/localPlatform/applicationPartners.js --apply`: migration 028 aplicada no PostgreSQL nativo 18, backup protegido por ACL e inventário do dump verificado, dados de pessoas/perfil/candidaturas/tarefas/histórico/recibos comparados sem alterações. Backup em `.tmp/local-platform/application-partners-backup-1792274495077`; configuração privada preservada. Prova `local-upgrade.json` PASS. Privilégios técnicos temporários retirados e backend reiniciado.
- OIDC habitual **PASS**: `test/integration/application-partners/native.cjs` confirmou HTTP 200 para Pessoas, perfil, Matching, candidaturas/lista/parceiros/responsáveis e catálogo; navegação Parceiros/Candidaturas, criação a partir do catálogo sem guardar, larguras 1440/1008/390, zero erros de página. Fingerprints de negócio iguais antes/depois; nenhum comando de negócio permitido durante esta verificação. Schema 016/028 e role técnico sem login/superuser/createdb/createrole confirmados. Provas `native-verification.json` e capturas `native-*`. O ambiente habitual ainda não tem candidaturas/parceiros; os percursos de escrita foram demonstrados no ensaio descartável, não através de contactos fictícios no ambiente habitual.

Primeiras execuções identificaram o inventário de tabelas do preflight ainda sem 028 e uma autorização adicional não admitida pelo coordenador. Corrigidos o inventário exato e a chamada à autorização de leitura dentro da operação protegida, sem relaxar o coordenador. A primeira passagem de Chrome revelou o placeholder de Parceiros ainda ativo por uma substituição que não reconhecia CRLF; rota corrigida e coberta por teste de navegação.

## Limites

Até 50 pessoas ativas e 100 parceiros ativos por candidatura; pesquisa limitada a 10 000 associações examinadas, com erro explícito, sem truncagem silenciosa. Sem prova de carga nesse limite. Comparação usa dados sintéticos; não infere aprovação visual do utilizador. Anexos reais e fecho integral da entrega 3 permanecem pendentes. Entregas 4–5 não iniciadas; sem Git mutável.
