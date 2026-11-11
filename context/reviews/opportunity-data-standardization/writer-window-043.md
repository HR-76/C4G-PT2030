# Janela habitual 043 — preparação validada e aprovada

31/10/2026, 16:10 UTC/Europe-Lisbon. **Review: preparação concluída; instalação043 e primeiro ciclo ainda por executar.** [Contrato](../../references/opportunity-v2/writer-window-043-contract.md), [runbook de execução/recuperação](../../references/opportunity-v2/writer-window-043-runbook.md) e [descritor](../../references/opportunity-v2/writer-window-043.json).

## Resultado habitual comprovado

| Verificação | Resultado |
| --- | --- |
| Baseline física | Central042 / tenant034; preflights, ledger e fingerprints válidos |
| Fonte EU | `QUIESCED`, fence3; zero runs pendentes e leases |
| Catálogo | 538 oportunidades:537 v1 e uma v2; identidade11145 e revisão5 preservadas |
| Preview11145 | `UNCHANGED` semântico; o digest do snapshot difere apenas com a nova evidência de captura |
| Dotação | `120000`, persistido como PostgreSQL `numeric` (`120000.00000000`) |
| Moeda e prazos | Moeda `NOT_FOUND`/SQL NULL; sete prazos. Não se infere EUR |
| Backup/restauro | PASS:236 tabelas,54664 linhas, sete configurações; dados/esquemas/sequências/roles/ACL verificados |
| Pausa | 16:08:35.982–16:09:36.680Z;60,698 segundos; API, worker e admissões recuperados |
| Aprovação | OIDC normal, CSRF e administrador persistido; plano/digest atual; um evento auditado; replay sem segundo evento |
| Preservação final | Hashes iguais nas34 tabelas do catálogo,129 tabelas de negócio tenant e sete configurações |

O descritor habitual `opportunityEuWriter` continua ausente. Não houve instalação043, configuração/retomaEU, enqueue de recolha nem aceitação de revisão. As escritas habituais desta preparação limitam-se ao percurso normal de autenticação e ao evento de aprovação operacional; a pausa/reabertura dos processos foi necessária para o backup coordenado.

## Plano e aprovação concretos

- Janela: `d439a44e-e005-4a79-bb9d-c18c5b65b4b6`.
- [Plano fechado](../../../output/opportunity-eu-writer-window-d439a44e-e005-4a79-bb9d-c18c5b65b4b6/plan.json): digest `5ab4ef3642754b35f3c4ce6452bc3cc5f7485f0f01b194da8eefc1ad578caaf7`.
- Expiração: **2026-10-31T17:09:44.661Z**. Mudanças nos inputs, configuração, fonte/fence, revisão, pacote ou evidência invalidam o plano antes dessa hora. A expiração não é renovada automaticamente.
- [Aprovação OIDC real](../../../output/opportunity-eu-writer-window-d439a44e-e005-4a79-bb9d-c18c5b65b4b6/approval-eeb33a84-850b-4049-9c2e-4884fe09a0bf.json), aceite pelo ledger às16:10:08.362Z. Evento `01a192b9-b907-7066-9094-05580c96441e`, hash `18b181a1fa98a62d4745f7764103324625e839a2d0f09c32f24737d0a0b41582`.
- Âmbito explícito `PREPARATION_ONLY`: certifica a aprovação deste plano de preparação; não substitui revalidação física, autoridade atual nem os comandos autenticados da execução posterior.
- Pacote043 inalterado: `opportunity-eu-writer-v2`, digest `2bdae82ddd6516e3b31bf33699f5213adaf6c36ae038a59c59f2123752033ee7`; SQL SHA256 `68562ede29f9c6063105c132331d7defb7b776d6ad5e928b3b1e843925af3f62`.
- CAS11145: oportunidade `01a14a80-9143-7177-ba86-9fa72d09fb64`, revisão `f6fe19fd-12d7-4c38-920a-b456dd74e9a9`, rowVersion5. Conteúdo `355df5dc59a25556d9103fa276921d7e43d66a1087630481b0c4867460a96ce6`.

O plano fixa instalação043, seleção explícita do writer, configuração/retoma autenticadas e **um único pedido EU Funding & Tenders**. O orçamento de observação é300s; suspender ao terminar ou atingir esse orçamento, drenar e reconhecer quiescência. O estado final previsto é `QUIESCED`, para conferir arquivos,11145, decisões REVIEW, contadores e auditoria antes de ampliar. O ciclo normal pode percorrer outras identidades; não é um coletor exclusivo11145. Novas identidades e migrações v1 continuam para revisão humana.

## Evidência da pausa e recuperação

[Janela completa](../../../output/opportunity-eu-writer-window-d439a44e-e005-4a79-bb9d-c18c5b65b4b6/window.json), [preview vinculado](../../../output/opportunity-v2-window/preview-f6adadcd-41f0-4890-a199-682587daaa7b/writer-habitual-preview.json), [backup/restauro](../../../output/opportunity-v2-window/d439a44e-e005-4a79-bb9d-c18c5b65b4b6/backup-restore-4fd2b7d6-88ba-414c-99ad-03dd46ffbd83.json) e [verificação final de leitura](../../../output/opportunity-eu-writer-window-d439a44e-e005-4a79-bb9d-c18c5b65b4b6/after.json).

Cópia privada própria: `.tmp/local-platform/opportunity-v2-backup-4fd2b7d6-88ba-414c-99ad-03dd46ffbd83`, ACL restrita ao utilizador e SYSTEM. Central94 tabelas/40942 linhas; tenant142/13722. Restauro PostgreSQL18 em novo cluster isolado, com identidade/destino verificados; suplemento exato de16 ACLs tenant; cleanup confirmado. A fonte permaneceu igual durante a pausa. O backup anterior035/033 não foi reutilizado.

A cópia é consistente no momento registado. Autenticação/auditoria e operação normal posteriores acrescentam escritas; a execução deve renovar a cópia na sua própria pausa ou comprovar/reconciliar essas diferenças. O restauro lógico não substituiu as bases habituais, não certifica perda zero de escritas posteriores nem o restabelecimento das credenciais de login num destino novo. A SQL043 é irreversível: falha após commit exige manter EU suspensa e recuperar capacidade/configuração ou usar restauro coordenado, sem downgrade para writer v1.

## Implementação e validação

Foi acrescentado um perfil fechado042/034 ao backup, mantendo o default035/033; um preview próprio com rederivação dos bytes públicos; orquestrador exclusivamente de preparação; construtor do plano; e cliente de aprovação com allowlist HTTP. A ponte HTTP usa auditoria operacional existente, sem migração adicional ou reutilização semântica de `activation_plan_v2`.

As rotas `GET /api/admin/opportunity-activation/eu-writer/windows/:windowId` e `POST .../:windowId/approve` verificam evidência, hashes e baseline042, head/CAS, fonte quiescente e autoridade persistida. Locks e verificação física na mesma transação impedem aprovar contra uma baseline já migrada. A aprovação tem evento determinístico por intenção, auditoria obrigatória e replay idempotente. O cliente comum frontend inclui os dois métodos, sem retries de escrita automáticos.

- [Gate PostgreSQL/PgBoss renovado](../../../output/opportunity-v2-writer-d0c97da917724e6691acd8bb5b51059c/verification.json):27 checks PASS,854 hashes estáveis, cleanup. Quatro novos checks exercitam aprovação sobre042, auditoria/replay, drift/expiração/revogação/CSRF e preservação; seguem-se todos os cenários do writer043. Sessões, configurações e evidência de janela desse gate são fixtures declaradas; o OIDC e backup habituais acima são provas separadas reais.
- [Validação local](../../../output/opportunity-eu-writer-window-validation-b8df682c-44d5-446e-a31a-4564ebb9347f/validation.json): backend2235 PASS/0 FAIL/7 SKIP; frontend495 PASS; build PASS; testes operacionais15 PASS; sintaxe18 PASS. A primeira suite frontend falhou apenas na lista fechada de métodos HTTP; atualizada a regressão para os dois novos métodos, foco e suite completa passaram. Log inicial preservado.
- Integridade:16 artefactos normativos S0, Excel original/fixture iguais e149 SQL do gate anterior sem alterações, incluindo043. O Excel normativo de177 linhas permanece intacto.
- Revisões independentes do código e dos artefactos públicos sem bloqueantes. Plano liga856 inputs públicos e sete hashes de configurações privadas. A baseline histórica de desempenho e os gates anteriores não foram recalculados para ocultar os novos deltas operacionais.

Limites mantidos: o gate do writer não certifica uma credencial física de worker com privilégios mínimos de ponta a ponta; essa identidade deve ser verificada na execução. A aprovação verifica Central/source/head em tempo real, mas a baseline tenant é vinculada à evidência de restauro e deve voltar a ser verificada antes de instalar. Aprovação não constitui lease de manutenção.

Próximo passo: executar a janela043 e o primeiro ciclo EU com revalidação/backup da pausa atual, sessão administrativa recente, auditoria e suspensão final conforme o plano; se o plano expirar ou houver drift, renovar a preparação e a aprovação.
