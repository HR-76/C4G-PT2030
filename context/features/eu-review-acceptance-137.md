# Aceitação EU dos 137 candidatos em revisão

Decisão de 01/11/2026: concluir a fiabilidade da fonte EU após o lote legado de 391, preservando os sete conflitos em quarentena e exigindo decisões OIDC próprias para os 137 candidatos arquivados num run `SUCCESS`.

## Critérios de aceitação

1. Um preview read-only atual revalida exatamente os 137 arquivos `funding_candidate_v2`, decisões `REVIEW`, evidência, identidade e CAS v1. Não reutiliza o pacote/recibos dos 391 nem aceita os sete conflitos.
2. O pacote expira, liga cada identidade a arquivo, snapshot, mapping, preview e cabeça esperada. A rota administrativa direta exige sessão, autoridade Central recente, origem e CSRF; não entra na Sidebar ou no dashboard.
3. Cada identidade recebe plano, decisão OIDC e aceitação v2 próprios, com replay idempotente e paragem na primeira falha. O escritor comum revalida arquivo, plano, CAS e fence 7. Nenhuma decisão de chat serve como recibo OIDC.
4. Antes de escrita habitual: teste/regressão, paridade read-only com o escritor, ensaio SQL isolado e backup/restauro atual Central045/tenant034. Depois: 137 revisões e recibos conciliados individualmente, montantes e prazos iguais aos snapshots, 391 anteriores intocados e sete conflitos em v1.
5. A fonte EU permanece `QUIESCED` até janela de retoma distinta. Os sete conflitos têm decisão explícita de quarentena; só uma nova evidência oficial não contraditória pode desbloquear aceitação.
