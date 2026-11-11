# Gate OIDC do arquivo EU legado

31/10/2026. Continuação do contrato [evidência EU legada](../../features/eu-legacy-evidence-review.md). Âmbito: 398 identidades EU ainda em v1 e sem candidato; 391 têm evidência oficial apta a decisão, sete permanecem em conflito. Este incremento não aceita oportunidades, não escreve candidatos na base habitual e não retoma a recolha automática. A fonte permanece `QUIESCED`, fence 7.

## Implementação

- O percurso `createCandidateArchiveV2().stage()` identifica uma identidade EU v1 antes do `INSERT`. Exige recibo OIDC com `packageId`, `itemDigest`, `bindingDigest`, `eventId`, `eventHash` e `actorId`. Reabre o pacote local, verifica hashes, evidência integral, snapshot, observação, conteúdo, CAS e fence. Sem recibo, ou com pacote/dados alterados, falha antes do arquivo.
- O evento de aprovação crítica liga o item e o binding ao digest conjunto de conteúdo e fingerprint da evidência. A função SQL `audit.eu_legacy_prearchive_event_v1` confere evento real aceite, ator humano, identidade, digests, prazo e hash do evento com leitura restrita por RLS. O runtime não recebe `SELECT` geral no ledger.
- A migração aditiva 045 cria um registo de uso único por evento e run, uma função de autorização e um trigger `BEFORE INSERT` que impedem bypass do gate JavaScript. Uma exceção transacional estrita ao guard EU 043 permite criar apenas um run terminal de migração e o candidato exato enquanto a fonte está suspensa. O guard anterior continua a aplicar-se aos outros writes.
- A migração 045 está **registada no código, mas não instalada na base habitual**. O escritor automático não fornece recibo para v1 e permanece bloqueado nesse caso; a fonte EU não pode ser retomada nesta fase. A instalação habitual e a migração por identidade exigem janela própria, backup/restauro real, preview atual e aprovações OIDC válidas.

## Ensaio e regressões

- Regressão RED: o escritor canónico arquivava um candidato v1 sem recibo. Depois do gate, o mesmo pedido falha antes do `INSERT`. Recibos malformados ou com pacote não verificável falham também.
- [Gate PostgreSQL 18 isolado](../../../output/eu-legacy-prearchive-gate-d6d7b0b760a14a08b13d69224f61305c/report.json): base sintética 044, backup `pg_dump`, restauro numa segunda base descartável, instalação registada 045 e preflight/fingerprints PASS. `INSERT` direto sem recibo rejeitado. Evento crítico sintético, vínculo exato, arquivo de um candidato e replay PASS; ator, hash, conteúdo, evidência e fence errados rejeitados. `SELECT` geral da auditoria negado. Fonte final `QUIESCED`; contentor descartável removido. O evento sintético não substitui login OIDC real nem aprovação humana.
- Testes focados do arquivo e pré-aprovação: 15/15 PASS. Preflight e pacotes afetados: 30/30 PASS. Frontend: 497/497 PASS; build PASS. Suite backend completa na forma final do recibo: 2364 PASS, zero FAIL, sete SKIP ([log](../../../output/eu-legacy-prearchive-backend-test-final-2.log)).

## Preview renovado e decisões pendentes

- [Preview read-only](../../../output/eu-legacy-migration-preview-ae47292c-3e48-4f85-904a-465e543ac6b9.json): 398/398 CAS atuais, 391 `CHANGE_REQUIRES_APPROVAL`, sete `NO_CANDIDATE`, alinhamento do mapeamento PASS, zero escritas. Probe com a role runtime para três IDs PASS.
- [Pacote OIDC por identidade](../../../output/eu-legacy-preapproval-70ddd8ae-e9ea-4611-b8f2-8cc386ade24d/plan.json) e [fila de revisão](../../../output/eu-legacy-preapproval-70ddd8ae-e9ea-4611-b8f2-8cc386ade24d/queue.csv): `packageId=70ddd8ae-e9ea-4611-b8f2-8cc386ade24d`, válido até **23:18:19 UTC, 31/10/2026**. `approvalState=NOT_REQUESTED`. Os sete conflitos não são aprováveis por este pacote.
- A aprovação deve vir de administrador humano com sessão OIDC/MFA válida, pela rota protegida individual. O pacote expira em uma hora; uma decisão posterior exige novo preview e novo pacote. A aprovação de pré-arquivo só permite o arquivo; a aceitação do candidato continua a exigir revisão e aprovação separadas.
- [Procedimento para o revisor](../../references/opportunity-v2/eu-legacy-prearchive-approval-runbook.md) com consulta e POST autenticados por item. A APP local apresenta agora uma fila visual protegida em `/administracao/aprovacoes-eu`, com emissão sequencial de recibos OIDC individuais e exportação. Nenhum recibo humano foi emitido por este desenvolvimento; a fila do navegador não substitui reconciliação com o ledger.
- Validação da fila visual: backend 2364 PASS/7 SKIP/0 FAIL ([log final](../../../output/eu-legacy-approval-ui-backend-test-final.log)); frontend 499 PASS/0 FAIL e build PASS. O teste de segurança restringe o `sessionStorage` a intenções e recibos com campos fechados. A APP local respondeu em `3000` e a API em `5000`; uma chamada sem sessão à rota administrativa foi recusada com 401. O percurso OIDC humano permanece por executar.

## Recuperação e limites

O dump do ensaio contém apenas dados sintéticos e foi restaurado com paridade de contagem e preflight 044 antes da migração 045. Nenhuma base habitual foi restaurada ou migrada nesta fase. Para a futura janela habitual, guardar backup/restauro próprios antes de instalar 045 ou arquivar qualquer candidato; em caso de falha, manter EU `QUIESCED`, parar novas operações, reconciliar ledger, candidatos e runs, e restaurar apenas no procedimento autorizado. Uma aprovação expirada, um evento sem hash válido ou um CAS/fence alterado não pode ser aproveitado.
