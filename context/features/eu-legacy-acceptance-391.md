# Aceitação EU legada de 391 candidatos v2

Decisão de produto de 01/11/2026: o administrador quer preparar a aceitação OIDC individual dos 391 candidatos arquivados no pacote `1e849d47-89e1-4fad-b2cd-0208c0d348b8`. Os sete conflitos continuam excluídos. Os recibos `PREARCHIVE_ONLY` não autorizam alterar o catálogo.

## Critérios de aceitação

1. Um preview read-only fechado lista exatamente 391 candidatos `funding_candidate_v2` com run/permit vinculados, snapshot/evidência íntegros e identidade/head v1 esperados. Mostra título, programa, dotação numérica e estado da moeda, prazos, fonte e motivos `CHANGE_REQUIRES_APPROVAL`; os sete conflitos são visíveis como excluídos.
2. A fila administrativa exige sessão OIDC, autorização Central, CSRF e origem. Cada identidade tem intenção estável e plano próprio; o administrador revê o preview antes de aprovar. Uma decisão global de chat não substitui a aprovação OIDC individual.
3. Preparação, aprovação e aceitação usam o arquivo durável verificado e repetem CAS, mapping, fence EU e integridade. Não aceitar se o head, candidato, evidência, autoridade ou plano mudou. Cada aceitação preserva UUID e histórico e cria revisão v2/derivados e recibo auditado na mesma transação.
4. O percurso é retomável: intenções e resultados persistem, retry do mesmo request confirma o mesmo efeito; uma falha para a fila. Nenhuma identidade nova, conflito ou candidato sem permit entra no lote.
5. Antes de escrever revisões habituais, ensaiar num PostgreSQL isolado com backup/restauro, casos de recusa, replay, falha parcial e reconciliação; renovar backup/restauro e autoridade no momento da janela. Conferir 391 revisões v2 e 398 identidades preservadas, sete conflitos intactos, valores monetários e prazos iguais aos snapshots aprovados. EU fica `QUIESCED` até decisão separada de retoma.

## Navegação após a janela (decisão de 01/11/2026)

As filas de pré-aprovação e aceitação EU foram ferramentas operacionais da migração, não secções permanentes do produto. Não aparecem na Sidebar nem nos atalhos do dashboard em produção. As rotas diretas permanecem protegidas por sessão, papel de administrador, autoridade OIDC, origem e CSRF para consulta histórica ou recuperação operacional; ocultar links não substitui autorização. A área permanente «Fontes de oportunidades» concentra o estado das APIs e da recolha.
