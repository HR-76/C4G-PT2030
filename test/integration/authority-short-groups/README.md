# Prova dos grupos curtos de autoridade

Executar apenas sem benchmarks concorrentes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/authority-short-groups/proof.ps1 -Report authority-short-groups
```

O runner cria PostgreSQL 17 numa porta loopback efemera, com nome e label exclusivos. Remove apenas o contentor cuja label corresponde ao UUID desta execucao. Nao le configuracao Dev. A fixture Central e a mesma usada pelo gate HTTP/OIDC, com as migrations atuais e LOGIN real limitado.

A prova compara `captureAuthenticatedRequest` + `resolve` e `guardIdentity` + `resolve`, separados ou dentro de um callback curto `withAuthority`. Exige duas transacoes/advisory locks antes e uma depois, menos 33 chamadas de infraestrutura, quatro coletas de seguranca antes e duas depois, e sequencia exata dos hashes das consultas F3 preservada. Nao escreve SID, parametros, tokens, credenciais ou ligacoes no resultado.

A sequencia F3 e observada no transporte real `authority_api.execute`, antes da expansao SQL feita pela fixture: a verificacao da identidade da base tambem pertence ao catalogo fechado, mas quando executada diretamente e infraestrutura. Filtrar apenas o SQL expandido confundiria essas duas origens. O observador guarda apenas o hash estatico reconhecido da consulta de protocolo. Contagens e hashes sao gravados antes das assertions; falhas guardam apenas codigo, linha do teste e valores escalares numericos/booleanos seguros.

Tambem verifica callbacks aninhados e sucessivos; nova admissao e verificacao depois do lock em `prepare`; revogacao real de membership e sessao com avancos de epochs entre grupo e `prepare`; ACL drift cometido depois do grupo e restaurado na fixture; expiracao entre os dois metodos; e um unico budget partilhado. Os casos temporais usam apenas um relogio injetado neste processo.

Os probes de `prepare` usam um binding sintetico e um cliente PostgreSQL pertencente a fixture, e recusam antes de emitir um guard. Nao alegam binding F4 ou commit tenant. A persistencia, cadeia de auditoria, rollback e commit incerto sao cobertos separadamente por `test/integration/audit-dashboard/proof.ps1`; o bloqueio advisory real com drift depois do preflight e coberto por `test/integration/authority-metadata/proof.ps1`. O gate HTTP/OIDC e o profile inalterados validam os callsites efetivamente compostos; esta prova nao substitui esses gates nem mede desempenho.

Resultado: `context/reviews/<Report>/postgres-short-groups.json`. Todas as mutacoes, incluindo grants negativos e revogacoes, ocorrem exclusivamente na base descartavel.
