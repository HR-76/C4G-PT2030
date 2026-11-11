# Auditoria de qualidade — incremento 2

Estado: Review — 27/10/2026. Continuação autorizada pelo utilizador, que pediu correções pequenas e um próximo passo explícito no final. [Resultado e evidência](../reviews/code-quality-audit-increment-2/README.md): 27 testes novos; backend 1344 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS, sintaxe de 10 ficheiros PASS. As três falhas anteriores estão resolvidas; auditoria global ainda aberta.

## Baseline e limites

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, worktree inicial com 2540 entradas. Inventário de 30915 ficheiros em `%TEMP%/c4g-audit-increment2-baseline.json`. Preservar o primeiro incremento e todo o trabalho anterior.

Sem migrations, grants/permissões, bases/dados/configuração Dev, deploy ou Git de publicação. Apenas testes com doubles e servidores efémeros locais; não iniciar aplicação, contentores ou gates PostgreSQL/Keycloak. Não alterar políticas, limites, SLO C6 nem a autoridade central. A paginação SQL integral de parceiros/alertas permanece separada: cursores, collation e auditoria não podem mudar silenciosamente.

## Alertas: conteúdo limitado à resposta

1. Manter as consultas de candidatos, ordenação, limites 10000/10001, filtro de prazos, contagens globais, seleção e sequência de autorizações. Substituir apenas `n.*`/conteúdo pela projeção explícita de metadados necessários.
2. No GET, depois de filtrar/ordenar/limitar, carregar somente `title` e `message` dos IDs selecionados, em até duas consultas (alertas e comunicações), com organização+membership+IDs parametrizados. PATCH individual/em lote não carrega esses campos.
3. Os campos de conteúdo são imutáveis para o runtime existente: 029 permite apenas UPDATE(read_at), 030 impede alteração da comunicação. Não reler `read_at`, prazo, estado nem título da candidatura: preservar os valores da primeira consulta, já que não existe isolamento repeatable-read.
4. Distinguir a origem no mapeamento de conteúdo: IDs coincidentes entre tabelas não se confundem. Resultado ausente, duplicado, inesperado ou malformado falha com SERVICE_UNAVAILABLE; sem resposta parcial nem fallback para conteúdo não autorizado.
5. Preservar reconhecimento monotónico, replay, ordem de updates/F7, rollback e verificações finais de autoridade. Não alterar o contrato HTTP nem o cliente frontend.
6. Testar antes da implementação: equivalência de resposta/autorização, limite1/contagens globais, ausência de leitura de conteúdo no PATCH, prazos obsoletos, recusas, limites, colisão entre origens, alteração concorrente dos metadados e falhas de hidratação/auditoria. Comparar bytes de resultados SQL e conteúdos lidos na mesma fixture antes/depois; não confundir doubles com desempenho PostgreSQL produtivo.

## Três falhas anteriores

7. F12/F11: atualizar a fixture para o contrato fechado atual do storage, incluindo abortMultipartSession; conservar e reforçar asserções de disponibilidade, tenant e autorização. Não alterar o contrato do runtime para aceitar doubles incompletos.
8. F5: corrigir o mapeamento explícito das queries para as funções/migrations já aprovadas 030/031. Manter comparações exatas e contagens; não aceitar um hash porque aparece em qualquer migration, nem alterar funções SQL, manifests, grants ou o catálogo de runtime.
9. ClamAV: adicionar regressões determinísticas de cancelamento antes/depois de connect e enquanto a fonte abre/transmite/aguarda resposta. A promise termina com código de cancelamento, nunca CLEAN; não abre storage depois de abort observado; limpa stream/socket sem esperar pelo timeout global desnecessariamente. Respeitar transportes cooperativos e descrever limites de transportes não cooperativos.
10. Substituir a corrida temporal do teste anterior ClamAV por confirmação explícita de que a fonte/socket estão ativos antes de exigir o respetivo fecho. Preservar testes de malware, bytes/hash, timeout, autorização e binding; não aumentar tolerâncias para ocultar falhas.
11. Achado na revisão: propagar o sinal ao HEAD revela que `r2Storage.send` usava o sinal externo em substituição do timeout de 30 segundos. Compor cancelamento externo e deadline existente em cada chamada ao SDK, mantendo os 30 segundos também quando o caller fornece sinal. Testar primeiro expiração com caller ativo, cancelamento antecipado e erro público, com SDK/relógio simulados; sem R2 real. Não mudar retries, credenciais, configuração, limites de bytes nem contratos HTTP. Esta correção pontual de transporte é necessária para não introduzir uma espera ilimitada no novo percurso do scanner.

## Validação e fecho

Regressões primeiro e evidência RED/GREEN. Testes focados, suites backend/frontend completas, node --check dos ficheiros backend alterados e build frontend. Separar falhas anteriores, novas e limitações. Rever mudanças de cada incremento independentemente. Resultado em `context/reviews/code-quality-audit-increment-2/README.md`; terminar com um próximo passo concreto, sem declarar toda a auditoria encerrada.
