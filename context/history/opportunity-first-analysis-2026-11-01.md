# Primeira análise das oportunidades — 01/11/2026

Concluídos a [simplificação da apresentação](../features/opportunity-first-analysis.md) e o [exame documental da API EU](../research/eu-funding-api-compliance-2026-11-01.md).

Lista e ficha mostram nome/código, abertura/fecho, dotação da call, descrição e programa financiador, com acesso à fonte. Preservados ações, valores exatos, moeda desconhecida, períodos previstos, múltiplas rondas e avisos relevantes. Removidos blocos redundantes, projeto associado e contagens de qualidade da primeira análise. Atribuição e indicação das adaptações C4G acrescentadas para EU.

Validação: regressões RED→GREEN; revisão independente sem achados pendentes; frontend 554 PASS, backend 2403 PASS/7 SKIP, build PASS; oito capturas sintéticas desktop/mobile sem erros ou cortes. Nenhuma alteração de dados, recolha, migrations, retoma EU ou publicação.

Limitação documentada: a descrição canónica EU deriva apenas de `raw.summary`; a narrativa de `metadata.description` exige evolução versionada do adaptador e tratamento controlado das revisões aceites. A UI encaminha para a fonte quando não dispõe de descrição distinta.

Este arquivo encerra apenas o bloco desta feature; os restantes trabalhos em `current-work.md` foram preservados.
