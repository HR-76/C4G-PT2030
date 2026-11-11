# Central — agregação das consultas de catálogo

28/10/2026 — concluído localmente; parado por pedido do utilizador. Incremento final autorizado pelo utilizador; parar após implementação e validação local. Sem nova execução PostgreSQL, integração do protótipo de parceiros ou otimização adicional.

## Contrato e âmbito

Agregar apenas as sete consultas base de `centralSchemaSnapshot` num SELECT, conservando projeções, filtros, ordenação, tipos, campos opcionais e ordem de serialização. Usar JSON, preservando os fingerprints existentes; não alterar manifests de migrations, grants ou permissões. Manter a canonicalização PostgreSQL 17/18 de NOT NULL e a recusa de formas não suportadas.

Cada chamada recolhe novos metadados. Nenhum cache entre admissões, pedidos, ligações ou locks. Manter recolhas independentes de segurança da autoridade e do catalog reader, os respetivos fingerprints e a verificação fresca após o lock do coordenador. Contratos HTTP, deadlines e decisões de autorização inalterados. Um resultado agregado ausente ou malformado é recusado.

## Aceitação

1. Antes do código: regressões de igualdade byte a byte e de fingerprint face ao contrato anterior, incluindo coleções vazias, campos opcionais, sequência representada por strings e NOT NULL PostgreSQL 18.
2. Alterações em cada categoria do catálogo detetadas no checkpoint seguinte; admissão fresca recusa esquema alterado antes de executar trabalho protegido. Recusa de drift de segurança após o lock preservada.
3. Erros do cliente propagados; resultado agregado exige uma linha e sete arrays. Queries originais preservadas por fixture congelada antes da alteração.
4. Medir contagem de comandos antes/depois em cliente controlado: sete consultas base para uma. Não apresentar esta medida como ganho de latência PostgreSQL.
5. Executar testes focados, suites backend/frontend, build e sintaxe; separar falhas preexistentes. Preservar worktree e sete execuções anteriores. Rever apenas o hash da fonte alterada no manifest corrente do gate.

## Limite de fecho

Depois da validação e relatório, parar conforme pedido. A execução real do novo SQL e o efeito na capacidade ficam pendentes; nenhum gate, deploy, migração, permissão ou dado Dev é abrangido por este incremento.

## Resultado

[Relatório e verificação](../reviews/central-schema-catalog-batch/README.md): 20 testes novos, regressões antes do código; foco 47 PASS, backend 1585 PASS/0 FAIL/7 SKIP preexistentes, frontend 346 PASS/build PASS e sintaxe de quatro ficheiros PASS. Sete consultas base para uma por snapshot, preservando evidência fresca e recusa após o lock. Sem prova de latência/execução SQL real neste incremento. Manifest corrente revisto só para a fonte alterada. Trabalho parado; nenhum novo gate ou otimização iniciado.
