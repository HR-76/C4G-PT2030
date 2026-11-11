# Escritor EU v2 — integração e ensaio

Estado: **Review — integração e ensaio isolado concluídos**, 31/10/2026. [Contrato](../../references/opportunity-v2/eu-writer-contract.md), [descritor final](../../references/opportunity-v2/eu-writer.json) e [procedimento operacional](../../references/opportunity-v2/eu-writer-runbook.md). Este incremento não instalou o pacote nem retomou a fonte no ambiente habitual.

## Comportamento implementado

| Situação | Resultado |
| --- | --- |
| Identidade existente v2, mapping igual, factos iguais, sem proteção/conflito | Aceitação automática da observação; conserva revisão e rowVersion |
| Identidade existente v2, alteração factual sem perdas/conflitos | Uma revisão v2; projeções e observações normalizadas na mesma transação |
| Nova identidade ou migração v1 | Candidato arquivado e decisão `REVIEW`; catálogo preservado |
| Perda de informação, conflito, ambiguidade, mapping divergente, correção/resolução protegida | Revisão obrigatória; conserva a revisão aceite |
| Arquivo inválido, autoridade perdida, lease/fence obsoleto | Recusa dos efeitos; sem fallback para o writer v1 |

A política é a confirmada pelo utilizador: atualizar automaticamente oportunidades já v2 quando não há perdas ou conflitos e enviar novos IDs/migrações v1 para revisão. Aplica-se à família EU, incluindo as seleções CORDIS e Erasmus do índice comum; não introduz fontes autónomas novas.

O transporte v2 está ligado ao worker normal, com arquivo canónico obrigatório e rederivação dos dados. A descoberta P3 continua a exigir lookup completo antes da avaliação de uma nova identidade. O refresh inclui identidades v2 que não têm metadados legados. Interreg/POCTEP mantêm o percurso existente.

## Autoridade e persistência

A escrita usa `FUNDING_TENDERS_CENTRAL` como ator SERVICE. A aprovação humana existente continua separada. O serviço prova o pedido administrativo persistido, run, inbox/outbox, execução, leases, fences, modo, política e digest do mapping; não aceita um simples contexto SERVICE fornecido pelo chamador.

Os helpers SQL de emissão de permits são exclusivos da role `c4g_eu_writer_runtime`. A role de aprovação humana e o leitor de catálogo não recebem essa capacidade. A prova é vinculada à transação, arquivo e CAS; triggers diferidos revalidam a autoridade no commit. A persistência partilhada usa o mesmo cliente do worker, sem transações aninhadas. Catálogo, projeções, observações, auditoria, decisão, resultado do item e contadores confirmam ou revertem conjuntamente.

Recibos de aceitação/revisão e auditoria vinculam intenção, arquivo, mapping, política, execução e fences. Repetições usam as identidades duráveis; a alteração de uma intenção não é tratada como replay legítimo. Uma observação em staging não avança a frescura aceite.

## Evolução aditiva e consumidores

O novo pacote `opportunity-eu-writer-v2` acrescenta Central043 sobre042. O pacote11145, os SQL036–042, tenant034 e defaults de migração permanecem preservados. A admissão reconhece042 e043 explicitamente, verifica fingerprints físicos e também definições/owners/ACL dos helpers. O guard recusa escritas legadas sobre EU canónica, incluindo claims de runs canónicos por código antigo.

A seleção é explícita e desativada por omissão. API e worker publicam/verificam política e mapping iguais; configurar ou retomar a fonte exige sessão administrativa atual e heartbeat compatível. Reiniciar o processo não configura nem retoma automaticamente EU.

`GET /admin/opportunity-activation/eu-writer/reviews` oferece consulta paginada e autenticada dos candidatos para revisão, com razões, arquivo e CAS esperado. `POST .../sources/eu/writer` configura apenas a política derivada no servidor, enquanto a fonte está quiescente e sem runs pendentes. O cliente comum suporta esses contratos. O histórico mostra as pendências separadas das atualizações; elas não contam como oportunidades criadas/atualizadas. Não foi introduzido um executor HTTP genérico para aceitar novos IDs.

## Validação e correções encontradas

- [Gate PostgreSQL final](../../../output/opportunity-v2-writer-2da50ff68436466da34be54c00c2c4bf/verification.json): **23 checks PASS**,842 hashes atuais e cleanup confirmado. Baseline11145 obtida por transporte público real e aceite pelo percurso autenticado com sessão sintética; cenários de mudança e restantes programas usam fixtures declaradas. Instalação042→043, replay do migrador e admissão física PASS. Auditoria111 eventos íntegra; estado final isolado `QUIESCED`, fence16, `CANONICAL_V2`.
- SQL11145: dotação numérica **120000**, moeda `NOT_FOUND`/NULL e **sete prazos**. UNCHANGED conserva head; mudança segura cria uma revisão. Leitores físicos central/tenant confirmaram paridade v1/v2, histórico, snapshots/vínculos privados e isolamento entre organizações.
- Worker e PgBoss reais: NEW/v1/perda→REVIEW; redelivery sem duplicações; falha após efeitos e antes da decisão reverte head, recibo e auditoria; retry conserva conteúdo, raiz e deadline; suspensão concorrente recusa o handler obsoleto e permite recuperação pela entrega durável original.
- Aprovação humana normal de um candidato novo arquivado, seguida de refresh, comprovou a identidade exclusivamente v2: cria o target sem fabricar metadados legados e termina UNCHANGED. CORDIS/Erasmus produziram um arquivo e decisão REVIEW cada, sem criar identidades. Com EU quiescente, as três seleções EU foram recusadas; Interreg criou3 registos v1 e POCTEP2, através do worker existente.
- Provas negativas reais: administrador revogado, owner/fence/execução errados, alterações em helpers/ACL, writer legado e GUC fabricada recusados. A role humana e o leitor não podem emitir permits. Uma execução válida sem permit de candidato não pode alterar correções protegidas.
- Frontend: **494 testes PASS**, 63 ficheiros, build PASS. A regressão do histórico reproduziu a omissão de candidatos em revisão antes da correção.
- Backend: **2216 PASS,0 FAIL,7 SKIP**; os skips preexistentes permanecem explícitos. A primeira suite revelou33 falhas em fixtures antigas de manifestos/asserção do nome do ledger. Os três ficheiros de teste foram adaptados ao manifesto fechado `knownManifest`, mantendo as recusas de drift e versões desconhecidas; foco42 PASS. [Primeira execução preservada](../../../output/opportunity-eu-writer/backend-tests-first-failure.log), [suite final](../../../output/opportunity-eu-writer/backend-tests.log).
- Verificação operacional5 PASS e `node --check` de53 ficheiros PASS. [Resumo verificável](../../../output/opportunity-eu-writer/validation-summary.json), com hashes dos logs e da prova final.
- Revisões independentes: configuração/HTTP/consulta/auditoria e writer/persistência sem findings acionáveis após as correções. A revisão SQL identificou a semântica de retry da inbox `UNCERTAIN`; corrigida sem estender a deadline original e confirmada fisicamente.
- Medições isoladas encontraram e corrigiram sintaxe SQL e comparação enum/texto que os doubles não detetavam. As recusas não produziram alterações parciais no catálogo. Os relatórios das tentativas e respetivo cleanup permanecem guardados.
- Integridade verificada:16 artefactos S0, Excel177 linhas e148 ficheiros SQL anteriores, com o mesmo digest do pacote11145.

## Limites e ativação posterior

A baseline habitual continua a ser a última observada na [janela11145](habitual-11145.md): Central042/tenant034,11145 na revisão5, EU quiescente/fence3. Este incremento não realizou migração, alteração de configuração ou retoma habitual, nem certifica um novo estado dessa base através de uma leitura posterior.

A prova usa infraestrutura descartável, sessões e identidades sintéticas; não equivale a um login OIDC real ou aprovação humana habitual. O worker do gate usa uma ligação proprietária isolada, exercendo os helpers sob a role limitada. A ligação física mínima para esses helpers é testada separadamente; isso não certifica uma credencial de worker com privilégios mínimos de ponta a ponta.

A política de encaminhar metadados previamente protegidos num head v2 para revisão foi testada unitariamente. O SQL confirmou a recusa de alterar correções a partir de uma mera execução autorizada; o gate não fabricou metadados protegidos preexistentes mediante desativação de triggers. As variantes sintéticas de programas não certificam novas consultas oficiais em tempo real fora da11145.

Próximo passo: preparar a janela habitual de ativação043 e retoma controlada, com preview, backup/restauro e aprovação autenticada atuais, seguindo o procedimento operacional.
