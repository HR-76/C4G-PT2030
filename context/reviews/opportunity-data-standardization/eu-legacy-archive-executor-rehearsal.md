# Arquivo EU legado: executor e ensaio isolado (31/10/2026)

## Resultado técnico

O executor `euLegacyArchiveExecutor` processa uma identidade por transação. Reconstrói o candidato a partir do artefacto oficial vinculado ao pacote e recibo OIDC, confirma fonte suspensa, fence e CAS, pede ao SQL 045 a autorização do evento crítico, grava run terminal e candidato no mesmo commit e verifica o snapshot canónico antes do commit. Se a identidade já estiver arquivada, verifica o candidato persistido e responde `ALREADY_ARCHIVED` sem nova inserção. Uma falha antes do commit provoca rollback. O executor não aceita revisões nem retoma a fonte EU.

O gate `test/integration/opportunity-v2/eu-legacy-prearchive-gate.cjs --isolated` passou em PostgreSQL 18 próprio: baseline 044, backup e restauro próprios, instalação 045 **apenas na cópia restaurada**, rejeição de INSERT sem recibo, evento OIDC vinculado, arquivo pelo executor, rollback injetado, replay e limpeza do contentor. Relatório: `output/eu-legacy-prearchive-gate-9dbb52270a3e408d97de4a9a9eabe2aa/report.json` (`PASS`, `cleanup: true`). O ensaio usa uma identidade e evento sintéticos com o snapshot oficial da chamada 11145; não é uma execução das 391 identidades habituais.

Testes focados do executor e do arquivo: PASS. Suite backend completa: 2369 PASS, 0 FAIL, 7 SKIP (log `output/eu-legacy-executor-backend-tests.log`). `node --check` dos ficheiros executados: PASS. O validador de paridade baseado no pacote anterior deixou de correr porque esse pacote expirou, como previsto; não foi usado para autorizar arquivo.

## Pendente para janela habitual

O ensaio isolado prova a transação e o restauro de teste, mas ainda não existe backup/restauro **habitual renovado** nem um comando de lote fechado para os 391 recibos com checkpoint e reconciliação global. A migração 045 continua por instalar na base habitual. O pacote anterior expirou às 23:18:19.263 UTC; os 139 recibos históricos conciliados não autorizam nova escrita. EU permanece `QUIESCED`/fence 7 e o escritor automático suspenso.

Antes de emitir novo pacote e pedir decisões OIDC, executar preflight e backup/restauro habituais próprios, preparar e ensaiar o lote fechado com 391 recibos, confirmar saúde/pausa e renovar o preview read-only de 398 identidades. Emitir o pacote de uma hora só junto da janela de arquivo. Depois da emissão humana, verificar 391 recibos únicos no ledger e executar por identidade; conferir 391 candidatos e zero alterações nos 398 heads, sete conflitos e fonte suspensa. Aprovação do candidato e retoma da EU são decisões posteriores separadas.

## Atualização operacional às 23:52 UTC

O lote fechado `euLegacyArchiveBatchExecutor` valida previamente os 391 recibos e eventos auditados, fonte/fence e instalação 045; processa sequencialmente, usa candidato/permit SQL como checkpoint durável e reconcilia 391 pares de digests no final. Ensaios unitários de 391 itens, falha após 139 commits e retomada dos 252 restantes: PASS. O gate PostgreSQL isolado foi repetido após a alteração do executor: `output/eu-legacy-prearchive-gate-5867d8bc17e247f5aedb845deebc924a/report.json`, PASS e cleanup. Backend completo: 2373 PASS, 0 FAIL, 7 SKIP (`output/eu-legacy-batch-backend-tests.log`).

O perfil de backup `EU_LEGACY_PREARCHIVE` exige digest registado da 045 e baselines Central 044/tenant 034. A preparação habitual `output/eu-legacy-archive-window-06ce8c70-9eed-4b31-94a7-af631b3f960a/preparation.json` passou: pausa 23:50:07 UTC, backup/restauro de 99 tabelas/46743 linhas Central e 142 tabelas/15072 linhas tenant, configuração protegida, restauro comparado, zero drift e saúde retomada às 23:51:05 UTC. Nenhuma migração aplicada e zero candidatos arquivados. O backup está vinculado à preparação; uma futura instalação/arquivo exige novo controlo de fronteira e autoridade no momento da escrita.

Preview read-only `output/eu-legacy-migration-preview-73c5131e-7722-4451-8a95-53f43fee84dd.json`: 398 heads atuais, 391 elegíveis, sete conflitos, EU `QUIESCED`/fence 7, mapeamento alinhado, zero writes. Pacote `1e849d47-89e1-4fad-b2cd-0208c0d348b8` criado às 23:51:19 UTC, expira em **01/11/2026 00:51:19.523 UTC**. Paridade dos 391 artefactos e digests distintos PASS, sem conexão BD. A recolha OIDC humana está pendente; o pacote e a preparação por si só não autorizam instalar 045 ou arquivar.

O comando `scripts/eu-legacy-archive-receipts-preflight.cjs` foi adicionado para conferir read-only o JSON completo e os 391 eventos no ledger enquanto o pacote estiver vigente. A versão final passou 2373 testes backend, 0 falhas, 7 ignorados (`output/eu-legacy-batch-final-tests.log`). Uma leitura agregada read-only do novo pacote às 23:55 UTC encontrou **zero eventos**: a emissão humana ainda não tinha começado. Não executar 045 ou arquivo sem o export completo e a reconciliação.
