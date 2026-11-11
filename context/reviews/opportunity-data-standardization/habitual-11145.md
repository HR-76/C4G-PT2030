# Chamada 11145 — janela habitual concluída

**Concluída e verificada em 31/10/2026.** A instalação local habitual passou a Central 042/tenant 034 e a chamada `CASCADE:11145` foi aceite no contrato v2 como revisão5. A aprovação foi executada pelo fluxo OIDC administrativo real, em cumprimento do pedido explícito do utilizador, com sessão recente, origem/CSRF e digest factual atual. Não foi fabricada uma sessão ou aprovação por SQL.

[Contrato autorizado](../../references/opportunity-v2/habitual-11145-contract.md), [descritor final](../../references/opportunity-v2/habitual-11145.json) e [resumo verificável](../../../output/opportunity-v2-habitual/validation-summary.json).

## Resultado habitual

| Elemento | Resultado verificado |
| --- | --- |
| Oportunidade / programa | Gnomon Internships Offer / Digital Europe Programme (DIGITAL) |
| Identidade preservada | `01a14a80-9143-7177-ba86-9fa72d09fb64` / `CASCADE:11145` |
| Revisão anterior | `01a184d1-0c76-714d-bff6-b141fd140159`, rowVersion 4 |
| Revisão aceite | `f6fe19fd-12d7-4c38-920a-b456dd74e9a9`, revisão5/rowVersion 5/schemaVersion 2 |
| Total funding available | Decimal canónico `"120000"`; SQL `numeric`, `120000.00000000` ✅ |
| Moeda da dotação | `NOT_FOUND`, SQL `NULL`; sem inferir EUR ✅ |
| Projeto e prazos | SUSA / acordo 101190010; sete cut-offs, projeções SQL iguais aos valores ISO do snapshot ✅ |
| Catálogo | 538 oportunidades: uma v2 e 537 restantes preservadas |
| Histórico e dados privados | 1501 revisões anteriores e 129 tabelas de negócio tenant com hashes preservados |
| Auditoria | Seis eventos novos, cadeia válida, recursos/digests e ator autenticado correspondentes |
| Replay | Mesmo recibo, sem nova revisão nem auditoria duplicada |
| Estado EU | `QUIESCED`, fence 3, zero leases ativos; writer EU legado não retomado |
| Serviços | API, worker e admissões saudáveis após a operação |

[Verificação posterior READ ONLY](../../../output/opportunity-v2-habitual-afa2ccb8-21cd-48b0-874f-e06bfec830d6/after.json) compara SQL, leitores físicos de catálogo, lista/detalhe e snapshot histórico v1. A [baseline antes da aceitação](../../../output/opportunity-v2-habitual-afa2ccb8-21cd-48b0-874f-e06bfec830d6/before.json) fixa os hashes usados para preservação. As tabelas privadas incluem interesses, candidaturas e unidades; esta prova não afirma que todas têm registos.

## Janela, cópia e instalação

Os serviços estavam inicialmente parados. O supervisor foi reposto pelo mecanismo local existente e a saúde foi confirmada antes da pausa. O login OIDC real e a leitura administrativa também passaram antes da instalação, sem operações de negócio nesse primeiro login.

O preview público foi renovado às15:18:17.872 (hora de Lisboa/UTC): HTTP 200, 20580 bytes, um resultado, SHA-256 `3ae2d08ba0ba3c7431831ee42fd315ba5de259efdf7fe7ac5edca55b1e4baa91`. Os factos mantiveram o contentDigest normativo `355df5dc59a25556d9103fa276921d7e43d66a1087630481b0c4867460a96ce6`.

A pausa contínua decorreu das 15:18:20.908 às15:19:22.524: **61,616 segundos**. Backup próprio `opportunity-v2-backup-342224a3-ab03-4ab7-b14f-08a459f0ee86`, protegido por ACL, com **216 tabelas, 54007 linhas e sete ficheiros de configuração**. Restauro lógico PostgreSQL18 em cluster isolado PASS, incluindo dados, sequências, schema, roles/ACLs e configuração; cluster encerrado. Imediatamente antes do SQL, a janela voltou a comprovar os hashes da cópia sob locks de leitura, ausência de sessões externas e processos parados.

[Recibo de backup/restauro](../../../output/opportunity-v2-window/afa2ccb8-21cd-48b0-874f-e06bfec830d6/backup-restore-342224a3-ab03-4ab7-b14f-08a459f0ee86.json) e [recibo integral da janela](../../../output/opportunity-v2-habitual-afa2ccb8-21cd-48b0-874f-e06bfec830d6/window.json). Os ficheiros privados permanecem na pasta protegida `.tmp/local-platform/opportunity-v2-backup-342224a3-ab03-4ab7-b14f-08a459f0ee86`; segredos não foram copiados para os relatórios públicos.

O pacote `opportunity-v2-activation-11145`, digest `4f83267f1c2d3f41c604453f3489136397f661fbc06a99de8b79ed2980674e7a`, aplicou Central036–042/tenant034 pelos migradores normais. Foram preservados prefixos históricos, identidade/generation, dados e credenciais. A observação tenant034 foi publicada no diretório central. Fingerprints finais: Central `0cb6ef8f6e00cc8e9209864addab966c9772a9bb5d886b0165d49a67e1d21e82`; tenant `731d37b0fbe3a2af7484710d8bbc4a1f3bd0f4687f42b1b8e0c14602346a63e3`.

A configuração mudou apenas no âmbito registado: seleção `authenticated-v2`/`bounded-v2`, schema dos snapshots runtime/member e atualização dos metadados runtime connectionRevision 1/fence 0 para 2/1, obtidos do diretório normal. O consumidor member já tinha 2/1. Os restantes campos, credenciais, contas e atribuições funcionais de acesso foram preservados. Os defaults do código continuam desativados; esta seleção pertence à instalação habitual concreta.

## Recolha e aprovação autenticada

Uma sessão OIDC nova executou o fluxo às15:19:42–15:19:56. A recolha real criou o run `00b9015a-8120-81bd-8011-0b99b72a55e2`, completo e auditado, com arquivo canónico durável. A suspensão/quiescência precedeu a preparação/aceitação. O plano `a8f5271a-3c81-4fa8-bb38-2c30edaa730b` teve digest `3daadd64f7b9f8455285277d4a06dac23324526cc59217aa99328ce3361e012f`; a revisão factual confirmou fonte, identidade, montante, moeda, projeto, sete prazos, mapping, CAS e campos protegidos antes da aprovação.

[Recibo autenticado](../../../output/opportunity-v2-habitual-afa2ccb8-21cd-48b0-874f-e06bfec830d6/approval-57325a83-6a15-44e0-9ea3-a723f816ab02.json). As chamadas passaram pelo middleware/sessão/CSRF e pelas verificações de autoridade/aprovação no commit. O automatismo executou a instrução do utilizador através da conta administrativa existente; não se afirma que houve um clique humano adicional na interface. Credenciais/tokens ficaram apenas em memória, sem exportação de cookies. A política individual de MFA não foi alterada.

A [exportação pública aceite](../../../output/opportunity-v2-habitual-afa2ccb8-21cd-48b0-874f-e06bfec830d6/accepted-11145.json) conserva snapshot, evidência canónica, digests e recibo. É um artefacto factual para rastreabilidade; não substitui backup integral nem autoriza replay fora dos controlos da API.

A revisão independente dos recibos confirmou IDs/digests cruzados e reprocessou a evidência exportada com o adaptador real: snapshot canónico, contentDigest e payloadDigest coincidem com a aprovação e a revisão aceite. Não foram encontradas credenciais nos seis JSON públicos revistos. O restauro comprovado é lógico; não se afirma ter restaurado credenciais de login num novo destino operacional.

## Validação e correções anteriores à janela

- Backend completo: **2181 PASS, 0 FAIL, 7 SKIP**; frontend: **492 PASS**, build PASS; nove testes operacionais da raiz e sintaxe de 15 ficheiros PASS.
- [Gate do instalador e cliente HTTP](../../../output/opportunity-v2-installer-1f1a8e94cfd442e2b6b0dba528a68ccb/verification.json): oito checks, 772 hashes, cleanup PASS; recuperação após commit central parcial, replay e cliente operacional real comprovados.
- [Gate registado renovado](../../../output/opportunity-v2-registered-8b7b3ef5959840949451a6e9affa2f3c/verification.json): 12 checks, 400 hashes, cleanup PASS.
- S0: 16 artefactos preservados; Excel original/fixture 177 linhas intacto; 148 SQL inalterados. [Integridade antes da execução](../../../output/opportunity-v2-habitual/integrity-before-window.json).
- Revisão independente sem bloqueantes. A passagem backup→instalação ganhou revalidação de dados/configuração/pausa com regressão RED→GREEN.

Dois ensaios isolados FAIL foram conservados: o primeiro revelou falta de transação no harness que usa `SET LOCAL ROLE`; o segundo identificou `rowVersion` textual no catálogo versus numérico no recibo. Corrigiram-se o harness e a comparação estrita do cliente, com regressões e novas suites/gates. Nenhum SQL ou guard de autorização foi enfraquecido. A execução habitual passou à primeira tentativa.

## Recuperação e continuidade

O backup é anterior à instalação e à aceitação; um eventual restauro deve usar novas bases/generation, reconciliar todas as escritas posteriores e provar autenticação/bindings antes de trocar o destino. Não restaurar por cima da instalação atual nem executar down/reescrita de ledger. O restauro lógico não certifica desastre de máquina, novo fornecedor OIDC, armazenamento externo ou um RTO completo.

EU permanece quiescente após a primeira aceitação v2. A flag do executor não liga o arquivo canónico do worker genérico, e o escritor legado não pode ser retomado. Portugal2030, Interreg/POCTEP e as restantes identidades EU não foram migradas/aceites por esta janela. Os helpers de preparação que exigem035/033 já não se aplicam à baseline habitual atual.

Próximo passo: integrar e ensaiar o escritor EU compatível com v2 antes da retoma controlada da recolha automática.
