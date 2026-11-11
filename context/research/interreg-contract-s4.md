# S4 — contrato das fontes Interreg Europe e POCTEP

Data: 30/10/2026. Investigação pública e leitura do repositório; sem execução de coletores da APP, acesso a bases, importações ou alteração dos artefactos normativos S0. Skill aplicada: `code-hacks-ai:research`. Este documento fundamenta a implementação S4; não certifica cobertura integral nem autoriza ativação.

## Decisão e contexto

Manter adaptadores próprios para `INTERREG_EUROPE` e `POCTEP`, com evidência por campo, dotação decimal exata e precisão temporal explícita. O contrato v2 não permite deduzir horas de uma data civil, tratar todo Interreg como um programa único ou substituir versões aceites perante conflitos. A recolha central não concede autoridade às organizações para editar o catálogo comum.

O [coletor atual](../../backend/src/fundingTenders/officialSources.js) usa o XLSX oficial Interreg e dois documentos WordPress POCTEP. Já associa identidades ao programa/período/número da chamada e recusa tabelas desconhecidas. Porém, converte orçamento e horários publicados apenas em resumo; o calendário v1 fica em datas civis. `modified` WordPress sem offset não é instante UTC. As fixtures de 18/10 são projeções JSON declaradas no [README](../../backend/test/fixtures/official-programmes/README.md), não os corpos HTTP integrais.

## Factos confirmados e limites

### POCTEP

Em 30/10, o [calendário geral](https://www.poctep.eu/convocatorias/) mostra dez convocatórias: 1–9 encerradas e 10 aberta. A 5.ª tem `52.500 €`, ou seja, decimal canónico `52500`, e a 10.ª tem `21 M€ (inicial)`, ou seja, `21000000`, moeda EUR e qualificador INITIAL. Os restantes números referem dotações FEDER de convocatórias, não montantes por beneficiário. Estado publicado e estado temporal calculado devem permanecer distintos.

A [página das abertas](https://www.poctep.eu/convocatorias-abiertas-poctep-2021-2027/) contém atualmente apenas a 10.ª. Publica abertura em 29/09/2026 às 10:00 e fecho em 17/11/2026 às 14:00, ambos em hora da Espanha peninsular. O montante de 21 milhões é inicial e pode aumentar; os 75% referem a taxa máxima de cofinanciamento, não uma segunda dotação. A 9.ª passou para a [página das encerradas](https://www.poctep.eu/convocatorias-cerradas/), onde subsistem abertura 09/09/2026 às 10:00 e fecho 21/10/2026 às 14:00, igualmente em hora peninsular espanhola. A retirada da página das abertas não apaga a evidência histórica.

Os endpoints configurados [página 2831](https://www.poctep.eu/wp-json/wp/v2/pages/2831) e [página 9396](https://www.poctep.eu/wp-json/wp/v2/pages/9396) são envelopes de conteúdo HTML WordPress. A confirmação web desta investigação foi feita nas páginas renderizadas; novos corpos integrais, hashes e metadados de transporte devem ser fixados separadamente nas fixtures S4. Não alegar uma API tipada de convocatórias ou declarar FULL_RECORD com um recorte de campos.

### Conflito documental da 10.ª POCTEP

As [bases em espanhol, p.12](https://www.poctep.eu/wp-content/uploads/2026/07/Bases_Convo10_ES_VF.pdf) publicam 29/09/2026 às 10:00 até 17/11/2026 às 14:00, com referência explícita à Espanha peninsular. As [bases em português, p.13](https://www.poctep.eu/wp-content/uploads/2026/07/Bases_Convo10_PT_VF.pdf) publicam **09h00 e 13h00**, mas identificam a zona como **“hora da Espanha continental”**. As datas coincidem; as horas literais para a mesma zona diferem uma hora. O orçamento inicial de 21 milhões consta também das bases portuguesas, p.7.

A hipótese de a tradução portuguesa pretender indicar hora de Portugal é plausível, mas continua a ser inferência: o documento não diz isso. Não corrigir silenciosamente o rótulo para `Europe/Lisbon`, nem afirmar concordância de 100% entre documentos oficiais. O [resumo oficial em português](https://www.poctep.eu/portada/9a-e-10a-convocatorias-do-poctep-aprovadas-as-bases-para-as-convocatorias-de-setembro/) repete 10h00/14h00 em Espanha e declara que as bases prevalecem perante divergências; não fornece uma decisão de precedência entre as duas bases linguísticas.

Aplicar §7 do contrato S0: quando ambas as evidências documentais forem incorporadas, `schedule.opening` e `schedule.deadlines` ficam CONFLICT, com os candidatos recuperáveis e revisão necessária. Um snapshot limitado ao HTML pode representar fielmente a afirmação daquele documento, mas deve declarar essa cobertura e não ser certificado como calendário oficial integralmente reconciliado. A revisão editorial é separada da recolha e preserva a última revisão aceite.

Prova reproduzível preservada em [fixtures S4 da 10.ª](../../backend/test/fixtures/official-programmes/v2/poctep-call10-bases/manifest.json): os dois PDFs públicos integrais, instante UTC de download, MIME, tamanho e SHA-256. A [verificação de campos](../../backend/test/fixtures/official-programmes/v2/poctep-call10-bases/verification.json) identifica páginas e valores extraídos com `pypdf` das cópias locais; não é um scraper PDF nem uma observação do coletor runtime. Hash PT `223d8e02453eecab6b1c286467559987a3fbca5af79fdad448ee3a8f9c87965b`; ES `fe755ffc42aac1ed203f3fbb41e36c1eb3a00c603d2a8ce787ee627b91d1d61f`. O recorte S4 HTML/XLSX deve emitir issue explícita de revisão documental para a 10.ª, preservando os horários HTML e sem fabricar refs a PDFs que o transporte não observou.

### Normalização temporal verificável

A base [IANA tzdb, ficheiro europe](https://data.iana.org/time-zones/tzdb/europe) associa Madrid e Paris às regras EU com base UTC+01:00, e Lisboa a UTC+00:00. O horário de verão acrescenta uma hora entre o último domingo de março e o último de outubro. A conversão exige a data e a zona; não usar um offset fixo por programa. As seguintes conversões são resultados técnicos sobre as afirmações das fontes, não resolução do conflito documental:

| Afirmação de origem | UTC canónico | Portugal continental, apresentação calculada |
| --- | --- | --- |
| POCTEP 9, abertura 09/09/2026 10:00 Espanha | `2026-09-09T08:00:00.000Z` | 09:00 |
| POCTEP 9, fecho 21/10/2026 14:00 Espanha | `2026-10-21T12:00:00.000Z` | 13:00 |
| POCTEP 10, abertura HTML/ES 29/09/2026 10:00 Espanha | `2026-09-29T08:00:00.000Z` | 09:00 |
| POCTEP 10, fecho HTML/ES 17/11/2026 14:00 Espanha | `2026-11-17T13:00:00.000Z` | 13:00 |
| POCTEP 10, abertura literal PDF PT 29/09/2026 09:00 Espanha | `2026-09-29T07:00:00.000Z` | 08:00 |
| POCTEP 10, fecho literal PDF PT 17/11/2026 13:00 Espanha | `2026-11-17T12:00:00.000Z` | 12:00 |

Não generalizar “Portugal” às ilhas. Preservar sempre o texto/offset/zona originais e validar a coerência de referências alternativas no mesmo documento. O exemplo oficial da [comunicação POCTEP sobre a 8.ª convocatória](https://www.poctep.eu/pt/comunicacao/) publica 30/09/2025 às 14h00 em Espanha / 13h00 em Portugal; é evidência de uma chamada diferente, não uma correção automática da 10.ª.

### Interreg Europe

A evidência local de 18/10 e o XLSX fixado descrevem apenas três chamadas gerais de 2021–2027, com dotações `EUR 130 million` e datas civis. Isso permite representar `130000000`/EUR por chamada, com âmbito e qualificadores que o ficheiro sustenta, sem extrapolar um orçamento disponível atual ou somar as três linhas como dotação adicional do programa. Chamadas restritas e ações-piloto são cobertura diferente, conforme a [verificação anterior](interreg-poctep-source-verification-2026-10-18.md).

Nesta investigação o leitor web recebeu HTTP 403 para a [página do programa](https://www.interregeurope.eu/call-for-projects) e para o PDF da terceira chamada. A pesquisa indexada no domínio oficial identifica nos [termos da segunda chamada](https://www.interregeurope.eu/sites/default/files/2023-03/Interreg%20Europe%20-%20Second%20call%20-%20Terms%20of%20reference.pdf) fecho em 09/06/2023 às 12:00 CEST, Paris; nos [termos da terceira chamada](https://www.interregeurope.eu/sites/default/files/2024-02/Interreg%20Europe%20-%20Third%20call%20terms%20of%20reference.pdf), 07/06/2024 às 12:00 CEST, Paris. Ambos correspondem a 10:00Z. Este resultado de busca localiza a prova, mas não substitui corpo integral fixado, hash e verificação do documento antes de o tornar evidência de ingestão.

Um [concept note de projeto alojado no domínio](https://www.interregeurope.eu/sites/default/files/2024-04/INTERREG%20EUROPE%20-%20Project%20Proposal%20Concept%20Note.pdf) apresenta CET para a mesma data de junho. O alojamento no domínio não transforma uma proposta de projeto nos termos oficiais da chamada. A extração deve validar o papel do documento; CET literal significa UTC+01:00 e CEST UTC+02:00. Se uma fonte normativa contradisser Paris/CEST, conservar o conflito em vez de normalizar a abreviatura por adivinhação. Sem prova de horário recolhida, o XLSX continua DATE, com incompletude explícita quanto às horas.

## Recomendação de implementação e verificação

- Preservar as identidades existentes `INTERREG_EUROPE:2021-2027:CALL:n` e `POCTEP:2021-2027:CALL:n`; título, ordem, orçamento e calendário não criam novas identidades.
- Extrair números com gramáticas por campo e unidades documentadas: `M€`, `EUR … million`, ponto decimal nas unidades milhões e ponto de milhares em `52.500 €`. Recusar ambiguidade e precisão excessiva sem conversão prévia para `Number`.
- Conservar montante, moeda, qualificadores INITIAL/ESTIMATE, âmbito e taxa como conceitos separados. Publicador/programa não provam automaticamente DIRECT_AWARDER ou PROGRAMME_FUNDER; acrónimo e grant agreement permanecem com ausência explícita quando fora da cobertura.
- Ligar detalhe à tabela da mesma chamada; nunca extrair horas de eventos, execução de projetos ou notícias não associadas. Conflitos entre tabelas, duplicados e documentos não usam “último vence”.
- Arquivar observações imutáveis com URL, SHA-256, instante de observação gerado no servidor, versão de mapping e cobertura efetiva. Não converter `modified` sem fuso em UTC. Preservar as fixtures antigas e acrescentar novas observações sem as reescrever.
- Cobrir com regressões: três chamadas gerais Interreg; dez POCTEP; 52.500 €, 0.9 M€, 21 M€ inicial; mudança DST setembro/novembro; DATE sem hora; horários contraditórios ES/PT; desaparecimento de detalhe da 9.ª; HTML desconhecido; adulteração de evidência e reobservação idempotente. Sem consulta dos restantes programas, a cobertura nunca é “todos os Interreg”.

Next step: integrar estas regras no adaptador S4 e manter os conflitos documentais em revisão antes de qualquer ativação.
