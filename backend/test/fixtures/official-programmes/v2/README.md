# Corpus S4 — POCTEP integral

`calendar.json` e `open.json` são os corpos HTTP integrais dos endpoints públicos WordPress, obtidos em 30/10/2026 sem credenciais. `manifest.json` fixa URL, instante UTC, tipo MIME, comprimento e SHA-256 dos bytes. Os testes verificam esses hashes e reconstroem os snapshots exclusivamente a partir dos corpos arquivados.

Este corpus tem dez convocatórias no calendário; a nona já é declarada CERRADA e a página de abertas contém apenas a décima. Os campos `modified_gmt` existem neste corpus, ao contrário das projeções históricas de 18/10/2026 na pasta superior. Essas projeções continuam preservadas e provam os horários da nona e décima publicados então, sem serem apresentadas como respostas HTTP integrais.

Interreg Europe reutiliza o XLSX integral da pasta superior. Não se seguem documentos ligados pelo HTML. A cobertura do adaptador é o calendário/tabelas e a frase de horário publicada, com montantes decimais exatos; elegibilidade, apoios individuais, taxas, bases e restantes documentos permanecem NOT_COLLECTED. A extração não afirma cobrir todos os programas Interreg ou chamadas restritas/ações-piloto.

A subpasta `poctep-call10-bases/` contém prova independente do conflito de horário entre as bases portuguesas e espanholas. Não faz parte do transporte do adaptador. O snapshot preserva o horário afirmado pelo HTML, com `BASES_NOT_RECONCILED` e `OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW`, sem inventar uma observação de PDF nem corrigir silenciosamente a fonte. Ver `context/research/interreg-contract-s4.md`.
