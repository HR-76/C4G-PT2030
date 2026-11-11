# Agregação do catálogo Central — validação local

28/10/2026 — incremento concluído localmente; trabalho parado por pedido do utilizador. [Contrato](../../features/central-schema-catalog-batch.md). Sem nova execução PostgreSQL ou integração do protótipo de parceiros.

## Problema e alteração

`centralSchemaSnapshot` enviava sete consultas sequenciais de catálogo em cada checkpoint fresco. A correção reúne-as num SELECT com sete agregações JSON, preservando as projeções, filtros e ordenações anteriores. Evita seis chamadas ao cliente por checkpoint; não elimina a verificação de esquema nem reutiliza resultados entre decisões.

JSON conserva a ordem das propriedades usada pelo fingerprint. Mantêm-se os tipos, casts de sequência para texto, campos opcionais, ordem de construção do snapshot e canonicalização NOT NULL de PostgreSQL 17/18. Uma linha e sete arrays são obrigatórios; resultado incompleto é recusado. As recolhas de segurança da autoridade/catalog reader e a verificação independente após o lock continuam separadas. Nenhum fingerprint de migration, contrato HTTP, timeout ou decisão de autorização foi alterado.

## Evidência e testes

Antes de alterar o código, congelaram-se os sete SELECTs numa fixture e executaram-se as regressões. Resultado final RED: 17 PASS e duas falhas esperadas — sete chamadas em vez de uma e ausência do novo contrato de resultado agregado. A regressão adicional do coordenador passou antes e depois, demonstrando preservação da admissão fresca.

Foram acrescentados **20 testes**: 19 para bytes/hash, coleções vazias/opcionais, tipos, drift nas sete categorias, equivalência PG17/18, recusa de NOT NULL não canónico, erro do cliente, forma do resultado e contagem de chamadas; um para esquema alterado entre decisões antes de BEGIN/lock/trabalho. O teste existente de revogação de segurança após o lock foi reforçado. Os doubles do preflight foram adaptados ao novo protocolo sem enfraquecer as expectativas.

| Validação | Resultado |
| --- | --- |
| Foco: catálogo, autoridade, preflight e compatibilidade | 47 PASS |
| Suite backend completa | 1585 PASS, 0 FAIL, 7 SKIP preexistentes |
| Suite frontend completa | 346 PASS, 55 ficheiros |
| Build frontend | PASS |
| Sintaxe JavaScript | 4 ficheiros PASS |
| Revisão independente | Sem bloqueadores |
| Manifest corrente do gate | 1014 fontes verificadas; só um hash de fonte alterado |

Não se observaram falhas preexistentes nas suites completas. Os sete SKIP PostgreSQL permanecem explícitos e não contam como prova de integração. Na primeira execução focada do revisor, cinco testes que usam subprocessos ficaram bloqueados pela sandbox; a repetição autorizada passou 26/26 e o foco final passou 47/47. Os erros de expectativa durante a escrita dos testes foram corrigidos antes da implementação.

## Medição e limites

Cliente controlado: **7 → 1 consultas base por snapshot** (menos seis, −85,71%). Duas chamadas sucessivas ao snapshot executam duas recolhas novas; as recolhas de segurança continuam em cada checkpoint. É uma medida de comandos, não de tempo, CPU ou capacidade PostgreSQL.

O novo SELECT não foi executado num servidor PostgreSQL neste incremento. A equivalência de bytes foi exercitada com resultados sintéticos e o descodificador JSON do driver; a fixture verifica a preservação dos SELECTs originais. Execução SQL real, fingerprints reais e efeito na capacidade permanecem por validar. A ordenação parcial preexistente quando há nomes iguais entre schemas foi preservada, não corrigida. A sétima execução anterior continua FAIL; este resultado local não demonstra recuperação dos timeouts nem autoriza integração produtiva.

## Alterações e preservação

- Produção: `backend/src/security/centralSchemaManifest.js`.
- Testes: `backend/test/centralSchemaCatalogBatch.test.js`, `backend/test/support/centralSchemaLegacyQueries.json`, `backend/test/authorityMetadataDedup.test.js` e `backend/test/centralMigrationPreflight.test.js`.
- Contexto: contrato deste incremento, este relatório/verificação, `context/current-work.md`, os contratos de parceiros e o runbook.
- Manifest corrente: `test/integration/partner-portal/sources.json`, apenas o hash da fonte revista e a data de preparação.

Baseline antes de alterações: branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, 2651 entradas no estado Git e 31024 ficheiros inventariados. O worktree já continha alterações extensas, preservadas. [Verificação por hashes](verification.json) regista os ficheiros deste incremento e a preservação das evidências anteriores; artefactos do build/cache de testes são identificados separadamente.

Não foram executados Docker, SQL, migrations, grants, alterações de permissões, acesso a dados Dev, deploy ou operações Git de publicação. As sete execuções anteriores não foram reescritas.

**Próximo passo: parar, conforme pedido.** Não há repetição automática do gate nem nova otimização planeada nesta sequência.
