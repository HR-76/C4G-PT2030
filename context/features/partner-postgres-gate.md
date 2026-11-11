# Parceiros — preparação do gate PostgreSQL isolado

Estado: **Review — 28/10/2026**. Preparação concluída; primeira execução isolada autorizada **FAIL no setup**, antes dos probes. Pedido explícito: preparar o gate de snapshot, RLS, revogação, cleanup e capacidade antes da integração. [Protótipo](partner-portal-prototype.md) e [contrato C1–C6](partner-sql-pagination.md).

## Âmbito autorizado

Preparar runner, probes, avaliadores, regressões offline e instruções de execução em `test/integration/partner-portal/`. Não executar Docker, PostgreSQL, migrations, grants, writers ou carga neste turno. Não importar o protótipo no runtime ativo. A preparação não autoriza a futura execução de infraestrutura.

O futuro runner deve criar um único contentor descartável próprio, PostgreSQL 17 como nos gates existentes, por ID de imagem imutável já local, porta dinâmica apenas em loopback e sem mounts de diretórios do utilizador. Central e duas bases tenant são criadas apenas aí, usando fontes de migrations existentes sem as editar. O grupo de repositório usa LOGINs limitados e RLS reais com ports de autoridade controlados; o grupo separado de autoridade usa composição, membership, guard e F7 reais. Doubles de infraestrutura ficam exclusivamente nos testes offline da preparação.

## Critérios de aceitação

1. CLI sem argumentos ou com `--plan` não abre sockets, carrega configuração Dev nem cria infraestrutura. Executar exige modo e âmbito explícitos; não aceitar URLs externas, credenciais de Dev ou fallback de configuração.
2. Antes de qualquer SQL, conferir ID, nome, label de ownership, imagem imutável, porta loopback e ausência de bind mounts. Cleanup apenas do contentor identificado como próprio; falha de prova de ownership impede remoção arbitrária.
3. Gate de repositório: isolamento efetivo READ COMMITTED, LOGIN sem SUPERUSER/BYPASSRLS/ownership, FORCE RLS e duas organizações; equivalência/cursor/collation, snapshots antes/depois de DECLARE e entre FETCHs, erro/cancelamento/desconexão e reutilização. `pg_cursors` deve ser consultado na mesma sessão; observador externo só prova término do backend.
4. Gate de autoridade real: guard e writers coordenados por barreiras, membership/política/sessão, equipa/cache e auditoria. Não exigir commit de writer bloqueado enquanto o reader aguarda no teste. A cache conserva decisões já tomadas e verifica o guard; não inventar revogação de equipa instantânea em hits.
5. Capacidade: comparar baseline/candidato em pares AB/BA, guardar todas as tentativas e métricas completas. Usar limites existentes de 10 s/operação, 5 s/admissão e 1 MiB/resposta; não transplantar SLO C6 nem inventar tetos de heap/RSS. Medir queries, linhas, bytes, memória, temporários e cleanup, distinguindo timeout devolvido de cleanup físico concluído.
6. Evidência incompleta, cenário obrigatório não executado, fonte alterada, cleanup falhado ou ambiente não identificado não pode produzir PASS global. PASS local não constitui aprovação de capacidade produtiva nem autorização de integração.
7. Testes offline primeiro (RED), sintaxe, foco, suites backend/frontend e build. Nenhuma prova PostgreSQL será declarada executada nesta preparação; registar limitações de fixtures/armazenamento sem alterar o oracle para acomodar o candidato.

## Plano

Preparar environment/probes e avaliadores em módulos sem efeitos no import → regressões offline e runner com modo plan → manifest de fontes e matriz de evidência → revisão independente → suites/build e conferência de preservação. A execução real posterior exige um âmbito concreto revisto e autorizado, sem tocar serviços existentes.

## Resultado da preparação

[Runbook executável](../../test/integration/partner-portal/README.md) e [relatório/validação](../reviews/partner-postgres-gate-preparation/README.md). Preparados 14 cenários de repositório, nove de autoridade e 13 de capacidade, com pares AB/BA. Runner offline por omissão, ownership/daemon local verificados antes de SQL, deadlines e cleanup limitado ao contentor próprio. O avaliador rejeita evidência contraditória/incompleta; manifest fixa 1011 fontes.

72 novos testes offline; foco 152 PASS, backend 1490 PASS/0 FAIL/7 SKIP, frontend 346 PASS e build PASS; sintaxe de 14 ficheiros PASS. Regressões escritas antes das implementações/correções do gate. Runtime, protótipo, oracle, contratos públicos e limites existentes preservados. Nenhum Docker, SQL, migration, grant, alteração de permissão ou acesso Dev executado nesta preparação.

As provas PostgreSQL e medições antes/depois continuam pendentes. O collector de capacidade é sequencial; não prova throughput HTTP concorrente nem capacidade produtiva. A matriz distingue rejeições previstas de armazenamento de PASS de leitura, e os writers sintéticos de equipa não provam concorrência do endpoint auditado. Estes limites constam do runbook.

## Execução autorizada em 28/10/2026

O utilizador autorizou posteriormente o âmbito concreto do runbook, incluindo migrations/grants exclusivamente no contentor criado. [Primeira tentativa e evidência](../reviews/partner-portal-pg-f8ca4c45e35a826640ac25d2f8fa97ef/README.md): imagem PostgreSQL 17 local imutável, fontes verificadas, preflight 17/READ COMMITTED aprovado; setup falhou com `GATE_FAILED`. Nenhum probe ou amostra de capacidade executado. Contentor próprio removido e ausência confirmada por ID/label; fecho lógico do environment não comprovado. Evidência original FAIL conservada, sem repetição nem integração. A causa do setup ainda não é identificável pela classificação sanitizada disponível.

## Diagnóstico seguro — Review (28/10/2026)

Incremento autorizado após a primeira falha: acrescentar fase de setup, tenant sintético A/B e classificação por lista permitida, sem mensagens, stack, SQL, credenciais ou identificadores reais. Registar a última fase antes de cada operação e distinguir falha primária de resultado do fecho local. Preservar o erro original e os critérios do gate; não converter fecho local em prova de cleanup PostgreSQL. Testar primeiro falhas simuladas do environment real, incluindo canários sensíveis, códigos desconhecidos e falha secundária de cleanup. Executar foco, suites e build, rever e atualizar conscientemente o manifest. A evidência da primeira execução permanece imutável; sem nova execução PostgreSQL neste incremento.

[Resultado e validação](../reviews/partner-setup-diagnostic/README.md): sete regressões, foco 159 PASS; backend 1497 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS, sintaxe de três ficheiros PASS. Campo aditivo `setupDiagnostic` e código exterior `ENVIRONMENT_SETUP_FAILED`, mantendo timeout explícito; fecho local não substitui prova física. Manifest de 1011 fontes atualizado apenas para os dois módulos revistos. Primeira execução/evidência preservada; nenhuma nova infraestrutura ou SQL neste incremento. A causa real continua pendente da nova tentativa.

## Segunda tentativa — FAIL (28/10/2026)

[Resultado e evidência](../reviews/partner-portal-pg-a7dc74a8441914bb00646b077a009ce9/README.md). Execução autorizada com diagnóstico revisto e a mesma imagem local imutável. PostgreSQL 17/READ COMMITTED confirmado; falha `ENVIRONMENT_SETUP_FAILED` em `TENANT_ENSURE`, tenant A, classificação `UNKNOWN`. Fecho local concluído e contentor próprio removido, com ausência confirmada por ID/label; critérios globais de cleanup continuam não comprovados. Nenhum probe ou medição. Primeira falha preservada; sem alteração de código, runtime ou fontes de migrations/permissões. Causa funcional ainda desconhecida dentro de `ensure`.

## Diagnóstico de TENANT_ENSURE — Review (28/10/2026)

Incremento autorizado: regressões e diagnóstico dos erros de domínio/subetapas. Apenas harness/testes/documentação; sem modificar o provisionador, migrations, grants, autoridade ou runtime, e sem nova execução PostgreSQL. Carregar o provisionador exato num módulo privado com dependências observadas, sem substituição textual, cache global ou queries adicionais. Distinguir reserva/lock/roles/base/configuração/migração/identidades/preflight/LOGINs/publicação, conservar a subetapa primária durante cleanup e não exportar SQL, parâmetros, mensagens, stack ou identificadores. Classificar apenas códigos verificados nas fontes, incluindo erros de migração com identidade privada; limitar causas agregadas e rejeitar conteúdo desconhecido. Provar falhas e percurso equivalente com regressões antes de implementar. Executar foco, suites/build e revisão, atualizar o manifest conscientemente e preservar as duas tentativas.

[Resultado e validação](../reviews/partner-ensure-diagnostic/README.md): 27 novos testes; foco 186 PASS; backend 1524 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS, sintaxe seis ficheiros PASS. Classificação por listas verificadas, identidade privada de erros de migração e causas agregadas limitadas; subetapa primária preservada durante cleanup. Percurso completo observado equivalente em operações/argumentos/resultados com doubles; factories frozen suportadas. Manifest de 1013 fontes revisto; runtime e duas tentativas intactos. Sem nova execução PostgreSQL. Achado preexistente separado: o preflight exterior omite `timeoutMs` obrigatório, confirmado offline sem ligação; não explica `TENANT_ENSURE`.

## Timeout do preflight exterior — Review (28/10/2026)

Correção autorizada e limitada à chamada do harness: passar `undefined` para conservar o manifest por omissão e `{ timeoutMs: 15000 }`, como nos preflights já usados pelo provisionador. Este valor configura o `statement_timeout` de cada statement; não é um novo prazo total de aquisição/preflight e não altera o deadline global de setup. Regressão primeiro, com environment/preflight reais e dependências de infraestrutura controladas: aquisição, BEGIN, configuração do timeout e falha injetada seguida de rollback/release/fecho dos pools. Preservar erro primário, autoridade, runtime, duas tentativas e todos os contratos; sem execução PostgreSQL neste incremento. Foco, suites, build e atualização consciente do manifest obrigatórios.

[Resultado e validação](../reviews/partner-preflight-timeout/README.md): regressão RED por argumento em falta antes da alteração de uma linha. Preflight real com cliente controlado configura `15000ms`, preserva o erro branded e faz rollback/release/fecho dos três pools e Central. Uma regressão nova; foco 187 PASS, backend 1525 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS, sintaxe de dois ficheiros PASS; revisão independente PASS. Manifest de 1013 fontes atualizado só para o environment. Sem nova execução PostgreSQL, sem alteração do runtime ou das duas evidências anteriores. A causa da falha em `TENANT_ENSURE` continua pendente.

## Terceira tentativa — FAIL com causa classificada (28/10/2026)

[Resultado e evidência](../reviews/partner-portal-pg-972f46fb06d1bc8d9fde2d3ac2290943/README.md). Execução autorizada com 1013 fontes verificadas; PostgreSQL 17/READ COMMITTED confirmado. `TENANT_ENSURE`, tenant A, subetapa `MIGRATION`: erro branded `DATABASE_CONFIGURATION_MISMATCH`. O conjunto de verificações de configuração está identificado; o campo divergente não foi exportado. Hipótese a testar: sessão do pool já aberta antes do ALTER DATABASE timezone, que só define o default para novas sessões. Fecho local concluído e contentor removido/ausência confirmada; nenhum probe ou medição. Duas falhas anteriores intactas, sem alteração de código ou relaxamento do contrato.

## Configuração da sessão antes da migração — Review (28/10/2026)

Incremento autorizado: reproduzir com pool controlado a sessão aberta antes de ALTER DATABASE timezone e corrigir apenas a configuração das ligações tenant do gate. Definir TimeZone `UTC` no arranque das ligações usadas pelo provisionador, antes da primeira query; manter o provisionador, migration runner e `validateDatabaseContract` originais. Regressões primeiro com environment/provisionador/validador reais, controlo negativo sem configuração e recusa de desvios de encoding/ICU/collation. Confirmar encaminhamento da opção pelo driver instalado e preservar cleanup/erro primário. Não declarar que a fixture prova qual campo divergiu na terceira tentativa; nenhuma nova execução PostgreSQL neste incremento. Foco, suites/build, revisão e atualização consciente do manifest; três evidências intactas.

[Resultado e validação](../reviews/partner-session-configuration/README.md): oito regressões (controlo da sessão antiga, percurso positivo RED→GREEN e seis recusas de configuração). Opção de arranque `-c timezone=UTC` apenas no objeto de ligação tenant do gate; provisionador/runner/validador originais. Foco 195 PASS, backend 1533 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS; sintaxe de dois ficheiros PASS e revisão independente sem bloqueios. Manifest de 1013 fontes revisto apenas para environment. Sem PostgreSQL/Docker neste incremento; três evidências intactas. Corrigido o cenário reproduzido, sem concluir retroativamente o campo divergente da terceira tentativa.

## Quarta tentativa — FAIL na capacidade (28/10/2026)

[Resultado, medições e evidência](../reviews/partner-portal-pg-942a2b58f6d8b84fbb3510ea7d00714f/README.md). Com startup UTC, setup READY e contrato estrito original aprovado; sem concluir retroativamente o campo divergente anterior. Repositório 14/14 e autoridade 9/9 PASS; matriz conserva duas rejeições de armazenamento previstas e completeReadCoverage false. Capacidade completa: 52 medições e 26 aquecimentos; 12 medições e seis aquecimentos com LEASE_TIMEOUT em volume-10000, volume-10001 e profile-distinct-origins, nas duas variantes. Dez cenários concluídos com respostas/autorizações equivalentes e duas queries adicionais no candidato. Custo raiz ainda por localizar; não há aprovação de integração/capacidade produtiva.

Fecho do environment e remoção do contentor concluídos, sem erros; ausência verificada por ID/label. Reavaliação offline reproduziu FAIL. Oito regressões de sessão repetidas PASS; sem código novo, suites/build não repetidos. Três falhas anteriores e fontes preservadas; migrations/grants e dados sintéticos exclusivamente no contentor descartável autorizado.

**Próximo passo:** preparar regressões e diagnóstico temporal por fase, SQL Central/tenant e hits/misses de autorização nos três cenários falhados, preservando limites, autoridade, contratos e as quatro tentativas, antes de outra execução.


## Diagnóstico temporal — Review (28/10/2026)

Âmbito autorizado: regressões primeiro e instrumentação privada do harness para volume-10000, volume-10001 e profile-distinct-origins; sem nova execução PostgreSQL. Observar duração inclusiva das fases resolve/lease/protect/reader, queries Central/tenant, decisão real e port de autorização, distinguindo cache hit apenas após sucesso sem chamada ao decisor. Não reconstruir cache nem alterar decisões, deadlines, SQL, contratos, fixtures ou ordem AB/BA.

Critérios: relógio monotónico; agregados limitados e sem SQL/argumentos/identificadores/erros livres; observação inclui falhas, spans pendentes no settlement e cleanup; correlação assíncrona isolada por amostra; nenhuma soma de tempos sobrepostos apresentada como tempo exclusivo. Falha do observador preserva retorno/erro original e invalida o diagnóstico. Testar os três perfis, cache/recusa/guard, erro/timeout e atividade tardia, queries por Promise/callback e ausência de instrumentação fora do contexto. Manter fontes e quatro execuções intactas, executar foco/suites/build e atualizar manifest só após revisão. Custo real da instrumentação e causa dos timeouts ficam por medir numa execução posterior.


[Resultado e evidência offline](../reviews/partner-temporal-diagnostic/README.md): 14 regressões novas; foco 207 PASS, backend 1547 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS, sintaxe de cinco ficheiros PASS. Instrumentação privada com 16 agregados e snapshots de settlement/cleanup; miss observado na revalidação de membership e hit confirmado pelo percurso de binding/guard, mantendo os objetos de autoridade originais. SQL Central/tenant e fases não alteram contratos/deadlines. Manifest 1014 fontes revisto apenas nos três módulos do harness. Microbenchmark sintético de 20000 chamadas: coleta inativa/ativa 1,507→13,378 ms, sem inferência de desempenho PostgreSQL. Quatro tentativas preservadas; nenhuma nova execução PostgreSQL/Docker ou integração.

**Próximo passo:** executar nova tentativa isolada com este diagnóstico, preservando as quatro falhas anteriores e os limites atuais, para localizar o custo antes de propor uma correção.


## Nova tentativa — pré-condição Docker indisponível (28/10/2026)

[Registo](../reviews/partner-portal-precondition-20261028-01/README.md). Invocação autorizada terminou GATE_FAILED/exit 1 antes de criar infraestrutura. CLI/contexto local válidos, mas daemon indisponível com LOCAL_DOCKER_PIPE_NOT_FOUND observado por consultas read-only. Nenhum runId de execução disponível, contentor, SQL, probe ou medição nova. Fontes verificadas e 12 regressões temporais PASS; sem código alterado. Quatro execuções anteriores preservadas; custo dos timeouts ainda por localizar. A autorização mantém-se; falta disponibilizar o daemon local.


## Quinta execução — FAIL com diagnóstico temporal (28/10/2026)

[Resultado e análise](../reviews/partner-portal-pg-c834629bb382012fd47feb1e60a3041d/README.md). Após o utilizador disponibilizar Docker, execução única com manifest de 1014 fontes, PostgreSQL 17/READ COMMITTED e setup READY. Repositório 14/14 e autoridade 9/9 PASS; 52 medições/26 aquecimentos e os mesmos 12+6 timeouts. Misses concluídos representam 88,74–97,46% do tempo observado no reader; autorização fresca/consultas Central identificadas como caminho dominante, sem causalidade exclusiva de cada comando, host ou instrumentação.

15/18 diagnósticos INCOMPLETE por trabalho Central ainda pendente após cleanup tenant. requireCleanup verifica apenas cleanupMs e permite novas amostras/arquivo; FAIL global correto, mas quiescência por amostra não comprovada. Fecho final e remoção do contentor PASS, ausência por ID/label verificada. Quatro execuções anteriores e pré-condição preservadas; nenhum código/runtime/Dev alterado.

**Próximo passo:** regressão e correção pequena da interrupção do gate perante spans Central pendentes, conservando erro original e adiando arquivo da fixture, antes de repetir a medição ou otimizar autorização.

## Interrupção por trabalho pendente — Review (28/10/2026)

Correção autorizada apenas no harness, sem nova execução PostgreSQL. Após cleanup tenant com duração finita, qualquer span ainda pendente no snapshot temporal impede novas operações, variantes, pares e cenários; o arquivo da fixture fica delegado ao fecho exterior do environment. Preservar a amostra e o erro original, os códigos existentes de cleanup não confirmado/arquivo adiado e todos os limites e contratos. Um diagnóstico INVALID com spans pendentes também interrompe; relógio inválido sem pendências mantém o comportamento existente.

Aceitação: regressões RED→GREEN para pendência no aquecimento e numa medição, ausência de novas chamadas/arquivo, estado INCOMPLETE e LEASE_TIMEOUT intacto; controlo quiescente continua a matriz e arquiva; cleanup exterior do runner continua executado. Validar testes focados, suites completas, build e sintaxe. Preservar as cinco execuções e a pré-condição; atualizar apenas o manifest corrente. Sem otimização da autorização neste incremento.

[Resultado](../reviews/partner-central-quiescence/README.md): seis regressões novas, RED→GREEN; foco 68 PASS, backend 1553 PASS/0 FAIL/7 SKIP preexistentes, frontend 346 PASS/build PASS e sintaxe de três ficheiros PASS. O guard existente passa a recusar spans pendentes, mantendo o erro primário e delegando o fecho ao runner. Doubles: 78 operações antes → 31–34 depois, consoante o ponto de falha; cinco fixtures anteriores arquivadas e a afetada preservada até fecho exterior. Sem nova medição PostgreSQL ou otimização da autorização. Manifest de 1014 fontes atualizado apenas para capacityProbe.

## Sexta execução — interrupção validada (28/10/2026)

[Resultado](../reviews/partner-portal-pg-7c5816a90760a11c54b070cce86fa74b/README.md): única tentativa, 188,768 s; repositório 14/14 e autoridade 9/9 PASS. Foram registadas 20 medições e 12 aquecimentos; volume-10000/candidato é a primeira pendência após cleanup e a última operação. Baseline anterior manteve LEASE_TIMEOUT mas terminou os spans durante cleanup. Candidato conserva erro/diagnóstico, adia arquivo da fixture e impede os sete cenários seguintes. Fecho exterior/remoção PASS, ausência independente por ID/label confirmada; reavaliação FAIL por observador/cobertura interrompida. Cinco execuções e fontes intactas, apenas documentação/artefactos novos. Interrupção do gate comprovada; custo da autorização continua pendente, sem aprovação de capacidade/integração.

**Próximo passo:** corrigir o custo repetido das transações Central por decisão de autorização com regressões de equivalência, revogação e auditoria antes do código, sem repetir o gate antes dessa alteração.

## Correção de leituras por decisão — Review (28/10/2026)

[Contrato](partner-authorization-read-group.md) e [resultado local](../reviews/partner-authorization-read-group/README.md). Apenas partnersBrowse agrupa membership/F5 brutos; política tenant e F7 ficam fora do novo grupo. Sem cache entre decisões, alterações de SQL/limites ou integração do protótipo. 12 casos adicionais; foco 166 PASS, backend 1565 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS, sintaxe PASS. Contagens controladas 2→1 transações/14→8 comandos; ganho PostgreSQL ainda não medido. Manifest corrente altera só composition, authorizationService e resourceAuthorization. Seis execuções e pré-condição preservadas; nova execução não realizada neste incremento.

## Sétima execução — efeito parcial da correção (28/10/2026)

[Resultado e comparação](../reviews/partner-portal-pg-fa1ecdc4e3305af458dc4fb67a96154a/README.md): uma tentativa de 201,068 s, FAIL. Repositório 14/14 e autoridade 9/9 PASS; 20 medições/11 aquecimentos. Primeiro volume-10000/baseline com LEASE_TIMEOUT e pendência após cleanup interrompeu tudo; fixture adiada, sete cenários NOT_RUN. Miss inclusivo médio 223,88→141,99 ms e linhas 3700→5800 no warmup comparável, ainda insuficiente; medições pequenas +7,25% em média e host não controlado. Fecho/remoção confirmados, seis execuções intactas e apenas documentação/artefactos alterados. Próxima intervenção: agregar as consultas de catálogo de centralSchemaSnapshot preservando snapshot/fingerprint, admissão fresca e verificação pós-lock, com regressões antes da alteração.

## Paragem após o incremento final (28/10/2026)

[Agregação do catálogo Central](../reviews/central-schema-catalog-batch/README.md) concluída localmente: 20 testes novos, foco 47 PASS, backend 1585 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS. Consultas base 7→1; sem medição PostgreSQL, cache novo ou alteração da verificação após o lock. Manifest corrente altera só centralSchemaManifest. Sete execuções anteriores preservadas. O utilizador determinou a paragem após estas melhorias: nenhum gate, integração ou otimização adicional será iniciado nesta sequência. Os próximos passos históricos acima não constituem uma execução pendente.
