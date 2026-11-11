# Fecho das correções de auditoria — estado em 09/11/2026

O pedido é fechar as correções com evidência. Este registo fecha apenas as verificações e correções cujo âmbito foi efetivamente demonstrado; não autoriza produção nem substitui os critérios de aceitação pendentes.

| Área | Estado | Evidência / limite |
| --- | --- | --- |
| Contradição documental MFA | Corrigida documentalmente | [Decisão de identidade](../decisions/multi-tenant-identity-and-data.md) assinala a substituição pela política opcional corrente. Não verifica implantação. |
| Cancelamento de retry da fonte | Corrigido no recorte testado | [Remediação](../features/audit-remediation.md) regista regressão e suites; dependência e restantes fornecedores permanecem. |
| Identidade e isolamento | Cenários isolados PASS; não encerrado para implantação | [Gates](threat-model-identity-isolation-20261109.md) cobrem sessão, RLS e revogação; configuração e privilégios produtivos não demonstrados. |
| Leituras centrais | Aberto | [Contratos e inventário](../features/central-read-contract-inventory.md) são parciais; SQL filtrado não prova isolamento ao nível da role; faltam gates integrados específicos. |
| Matching >1000 | Aberto | [Contrato](../features/audit-remediation.md): paginação consistente ainda não implementada nem testada no runtime. |
| Restauro | Validações sintéticas PASS; operacional aberto | [Objetos/auditoria](threat-recovery-20261109-v2/results.json) e [WAL](wal-recovery-proof-20261109-c/results.json) têm âmbito limitado; RPO/RTO e exercício completo pendentes. |
| R2 real | Adiado por instrução do utilizador | Sem validação no fornecedor real; manter para o final. |
| Metas e baseline | Aberto | [Baseline](../features/baseline-metas-30-dias.md) preparada mas não iniciada; metas e responsabilidades carecem de confirmação. |
| Decisões arquiteturais | Parcial | [Propostas](../decisions/2026-11-09-architectural-gaps-proposals.md) não estão aprovadas; não atribuir aceitação por inferência. |

Sem testes novos nesta revisão documental; não foram alteradas bases, permissões ou fornecedores. Os resultados anteriores são os indicados nas ligações e não validam os pontos ainda abertos.
