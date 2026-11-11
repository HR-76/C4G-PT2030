# Trabalho Atual

## Identificação

- Feature: F4.2 — Resolver e pools de tenants
- Tipo: Feature de infraestrutura e segurança multi-tenant
- Estado: Complete

## Objetivo

Implementar e provar localmente o contrato vendor-neutral que transforma um contexto organizacional F3 validado e uma operação interna registada numa lease curta, limitada e vinculada ao tenant correto. A resolução deve usar exclusivamente o Diretório Central materializado pela F4.1, obter material de ligação através de uma abstração sintética de segredos, gerir pools isolados por tenant e versão e falhar fechado perante qualquer ambiguidade, incompatibilidade ou indisponibilidade.

Esta fase autoriza apenas abstrações, adaptadores sintéticos, configuração local determinística e testes automatizados. Não autoriza integração operacional, acesso a tenants reais, provisioning, migrations tenant, rollout ou deploy.

## Resultado esperado

- `TenantResolver` recebe apenas contexto organizacional produzido no servidor e `operationCode` constante de um adaptador registado.
- A resolução relê e valida o snapshot Central da F4.1, sem aceitar do cliente tenant, operação técnica, referências, host, base, região, credenciais ou modo de acesso.
- Um contrato vendor-neutral de segredos resolve apenas `credential_ref` opaca em testes locais e não expõe material sensível fora da fronteira autorizada.
- O gestor de pools identifica cada pool por `tenant_id + connection_version`, aplica limites globais e por tenant, reserva operacional, single-flight, timeouts e expiração idle.
- Cada lease fica vinculada a tenant, organização, versão, revisão, binding digest, operação, módulo e modo de acesso; qualquer mismatch é recusado antes da query funcional.
- Rotação, fencing, drenagem, revogação, backoff e circuit breaker permanecem isolados por tenant e nunca provocam fallback.
- Métricas e erros são sanitizados, têm cardinalidade limitada e não revelam referências opacas, material de ligação ou infraestrutura física.

## Critérios de aceitação

1. Dois tenants sintéticos, associados a organizações distintas, resolvem exclusivamente para os respetivos adaptadores e destinos; tentativas de substituição cruzada são recusadas antes de qualquer query.
2. O input controlado pelo cliente não consegue escolher ou alterar `tenant_id`, `operationCode`, `accessMode`, query module, `database_ref`, `credential_ref`, região, versão ou configuração do pool.
3. `operationCode` desconhecido, duplicado, incompleto ou incoerente com o adaptador/módulo impede resolução ou startup, conforme a fronteira aplicável.
4. Contexto F3 inválido ou alterado, diretório ausente ou ambíguo, organização divergente, provisioning diferente de `READY`, ligação diferente de `AVAILABLE` e schema incompatível falham antes de obter uma lease.
5. Credencial indisponível, marker, geração, fingerprint, binding digest ou versão divergentes, circuit breaker aberto e pool esgotado falham fechado, sem query e sem fallback para Central, Legacy ou outro tenant.
6. Aquisição compara versão, revisão e binding antes e depois da obtenção do material/pool; uma mudança concorrente descarta o resultado intermédio e reinicia a resolução sem reutilizar estado obsoleto.
7. Antes da primeira query funcional, a lease revalida versão corrente e binding digest; mismatch impede a execução.
8. Criações concorrentes do mesmo pool usam single-flight; pools de tenants ou versões diferentes não são coalescidos.
9. Limites locais pequenos e determinísticos provam orçamento global, orçamento por tenant, reserva operacional, timeout de aquisição, libertação obrigatória e expiração idle sem starvation cruzada.
10. Clients com erro de protocolo, transação ou cleanup são descartados; falhas de cleanup são agregadas e nunca convertidas em sucesso.
11. O cutover encaminha novas leases apenas para a nova `connectionVersion`, drena a anterior até ao limite configurado e impede novas aquisições na versão antiga.
12. Suspensão, bloqueio, offboarding ou revogação incrementam o fence e impedem novas leases; operações já iniciadas só podem terminar dentro do timeout contratual.
13. Backoff com jitter determinístico nos testes e circuit breaker por tenant isolam falhas: indisponibilidade de um tenant não abre o circuito, consome a reserva ou redireciona tráfego de outro.
14. Testes sob carga sintética demonstram limites, fairness operacional mínima, ausência de fuga entre tenants e cleanup integral de pools, timers, leases e material de segredo.
15. Logs, erros, traces e métricas não contêm segredos, connection strings, `credential_ref`, `database_ref`, host, nome físico da base ou payload funcional; labels permanecem controladas.
16. Nenhuma migration é executada e a Central persistente, Legacy/UBI, serviços externos e bases tenant reais permanecem intocados durante implementação e validação.

## Restrições

- Tratar membership e contexto F3 como fonte de verdade do acesso; o resolver não concede autorização funcional F5.
- Usar o Diretório Central F4.1 como única fonte de resolução; não duplicar nem inferir bindings.
- Manter `DATABASE_PER_ORGANIZATION` como único modo suportado nesta fase.
- Manter domínio e contratos independentes de Neon, secret manager ou fornecedor de pools.
- Usar apenas referências opacas e material sintético nos testes; nunca persistir ou registar segredos.
- Classificar acesso e selecionar query module apenas pelo catálogo interno registado.
- Falhar fechado perante estado, catálogo, schema, binding, região, saúde ou capacidade desconhecidos.
- Preservar trabalho existente e não relacionado.

## Fora do âmbito

- Escolha ou integração de secret manager real.
- Valores e sizing de produção para pools, reserva, timeouts, probes, backoff ou circuit breaker.
- Ligações a Neon ou a qualquer base tenant real.
- Catálogo funcional definitivo de operações `READ_ONLY`, baseline, ledger, migrations e preflight tenant da F4.3.
- Provisioning, onboarding, offboarding, backup, restore, retenção, legal hold, eliminação e reconciliação operacional da F4.4.
- Adaptação da UBI/Legacy da F4.5.
- Autorização funcional F5, endpoints públicos, frontend, deploy e rollout.

## Dependências e referências

- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f3-membership-session-context.md`
- `backend/src/security/tenantDirectoryRepository.js`
- `backend/src/security/membershipRepository.js`

## Decisões técnicas do plano

- O código F4.2 será uma composição interna e injetável sob `backend/src/security/`; não será ligado a endpoints, rotas Legacy, jobs ou startup de produção nesta fase.
- O catálogo de operações implementará apenas o contrato e a validação estrutural. As operações usadas na prova serão sintéticas e definidas nos testes; o catálogo funcional `READ_ONLY` da release continua reservado à F4.3.
- A elegibilidade F3 será revalidada por um método dedicado do `membershipRepository`, usando `organizationId`, `membershipId`, `membershipVersion` e o instante injetado. Não será inferida de roles nem do snapshot tenant.
- O snapshot F4.1 será projetado para um objeto interno imutável com todos os campos necessários. A Central continuará a guardar apenas referências opacas; a query não obterá material de segredo.
- O provider de credenciais, o verificador do binding e a fábrica de pools serão contratos vendor-neutral. Nesta feature existirão apenas doubles sintéticos; não será criado adaptador Neon nem secret manager real.
- O gestor identificará pools por `tenantId + connectionVersion`. O circuit breaker será por tenant; single-flight e drenagem serão por chave de pool.
- O relógio, scheduler, função de jitter e gerador de identificadores serão injetáveis. Os testes não dependerão de sleeps reais nem de aleatoriedade.
- A lease pública será uma capability opaca e congelada, sem client, SQL genérico, referências ou configuração. O executor invocará exclusivamente o query module registado e conservará o estado sensível em armazenamento privado interno.
- A política local usará valores pequenos definidos em fixtures de teste, não defaults operacionais. A composição sem política explícita falhará no construtor.
- Nenhuma migration, package ou configuração de ambiente é necessária.

## Plano técnico

### 1. Completar as fronteiras de leitura F3/F4.1

- Estender `backend/src/security/membershipRepository.js` com uma revalidação estrita do contexto selecionado. A query deve exigir utilizador, organização e membership ativos, validade temporal, IDs coincidentes e `membership_version` exata; o retorno mantém o payload mínimo e imutável F3.
- Estender `backend/src/security/tenantDirectoryRepository.js` para que `resolveSnapshotByOrganization()` selecione também `credential_ref`, região, política de residência, identidade observada, binding digest, versões mínimas, capacidades verificadas e revisões relevantes.
- Mapear a linha para um snapshot interno explícito e congelado. Zero linhas devolvem ausência; mais de uma continua a falhar como ambiguidade; campos obrigatórios ausentes ou de forma inválida são recusados pelo resolver.
- Não alterar a migration `003`: todos os campos necessários já existem no modelo F4.1.

### 2. Criar erros públicos uniformes e taxonomia interna

- Criar `backend/src/security/tenantRuntimeErrors.js` com erros internos codificados segundo a decisão normativa e uma projeção pública limitada a `TENANT_NOT_AVAILABLE`, `TENANT_READ_ONLY` e `TENANT_OPERATION_UNAVAILABLE`.
- Preservar apenas correlação e identificadores internos mínimos. Causas, mensagens e metadata nunca incluem referências opacas, segredo ou destino físico.
- Garantir que falhas de cleanup são agregadas ao erro primário e que nenhuma delas produz retorno de sucesso.

### 3. Implementar e validar o catálogo interno de operações

- Criar `backend/src/security/tenantOperationCatalog.js` com construção atómica a partir de entradas congeladas: `operationCode`, modo de acesso, query module, classe funcional/operacional e requisitos de schema/capacidade.
- Recusar códigos duplicados, desconhecidos, mutáveis, módulos ausentes, modos incoerentes e entradas incompletas durante a construção.
- O consumidor fornece o adaptador registado, não um código livre. O resolver exige que a constante do adaptador corresponda exatamente à entrada e ao módulo.
- Manter o catálogo de produção vazio nesta fase; fixtures sintéticas exercitam leitura/escrita apenas sobre `COMPATIBLE`. Nenhuma operação é autorizada em `READ_ONLY` até F4.3.

### 4. Definir providers e doubles vendor-neutral

- Criar `backend/src/security/tenantCredentialProvider.js` com validação do contrato `resolve(credentialRef, context)` e descarte/revogação do material. A interface recebe somente referência opaca e identidade/versionamento esperado.
- Criar `backend/src/security/tenantBindingVerifier.js` para validar sinteticamente marker, `tenantId`, geração, identidade observada, fingerprint/capacidades e binding digest antes de qualquer query funcional.
- Adicionar em `backend/test/support/tenantRuntimeDoubles.js` providers controláveis de credenciais, destinos, clients, pools, relógio, scheduler e jitter, todos com inventário de chamadas e cleanup.
- Usar canários sintéticos nos testes de redaction; nunca usar credenciais ou connection strings reais.

### 5. Implementar orçamento, single-flight e lifecycle dos pools

- Criar `backend/src/security/tenantPoolManager.js` com configuração obrigatória validada: limites global e por tenant, reserva operacional, timeout de aquisição, timeout de lease, idle expiration, backoff, janela/limiar do circuit breaker e máximo de tentativas.
- Manter registos privados por `tenantId + connectionVersion`, contadores globais/tenant, fila limitada, mapa single-flight e fence monotónico por tenant.
- Coalescer apenas criação da mesma chave. Pedidos de tenants ou versões diferentes permanecem independentes.
- Aplicar orçamento antes da criação/aquisição; preservar a reserva para classe operacional e usar ordenação FIFO determinística dentro de cada classe sem permitir que um tenant ultrapasse o seu limite.
- Descartar clients com erro de protocolo/transação, timeout ou cleanup. Libertação saudável devolve ao pool uma única vez; release duplicado falha fechado.
- Expirar pools idle pelo scheduler injetado. `drain` bloqueia novas leases da versão, aguarda leases existentes até ao timeout e fecha o pool; `revoke` fecha/descarta imediatamente sem fallback.
- Manter circuit breaker por tenant com `CLOSED`, `OPEN` e uma tentativa `HALF_OPEN`; aplicar backoff e jitter injetados. Falha de um tenant não altera contadores, circuito ou fila de outro.
- Expor snapshots métricos sanitizados com códigos e contagens de cardinalidade limitada, nunca refs ou destinos.

### 6. Implementar resolução, fencing e lease opaca

- Criar `backend/src/security/tenantResolver.js` que recebe dependências explícitas: validador F3, repositório do diretório, catálogo, provider de credenciais, verificador de binding, gestor de pools, política de região, relógio e correlação.
- Validar forma fechada do input; rejeitar propriedades adicionais e qualquer campo de infraestrutura. Obter `operationCode` apenas do adaptador registado.
- Revalidar F3; ler snapshot; exigir correspondência da organização, `DATABASE_PER_ORGANIZATION`, provisioning `READY`, ligação `AVAILABLE`, versão corrente `VALIDATED`, schema `COMPATIBLE`, região permitida e circuito disponível.
- Resolver segredo just-in-time e adquirir/verificar o pool. Depois, reler o snapshot e comparar tenant, versão, revisão da ligação, revisão do schema e binding digest. Qualquer mudança descarta o resultado e reinicia toda a resolução até ao limite determinístico.
- Criar lease opaca vinculada a organização, tenant, versão, revisões, fence, digest, operação, módulo, modo e deadline. O handle expõe apenas execução e libertação idempotentemente controlada; detalhes sensíveis ficam privados.
- Nunca consultar `DATABASE_URL`, pool Legacy, última organização, Central como destino ou outro tenant como fallback.

### 7. Implementar executor e revalidação antes da primeira query

- Criar `backend/src/security/tenantLeaseExecutor.js` para aceitar apenas handles emitidos pelo resolver e apenas o query module já ligado à lease.
- Antes da primeira query funcional, revalidar elegibilidade F3 e snapshot F4.1; comparar versão, revisões, fence e binding digest. Mudança, timeout, drenagem ou revogação invalida e liberta/descarta a lease.
- Executar o módulo através de uma facade limitada do client; não expor SQL genérico a controllers ou serviços. Verificar que o módulo e modo coincidem com o catálogo.
- Libertar sempre em `finally`; agregar falhas de módulo, rollback/cleanup e release sem mascarar a causa primária.

### 8. Integrar lifecycle local sem alterar produção

- Criar uma composição de teste em `backend/src/security/tenantRuntime.js` que monte catálogo, resolver, manager e executor apenas a partir de dependências injetadas.
- Expor comandos internos de `drainVersion`, `revokeVersion` e `blockTenant` para simular eventos já persistidos pela F4.1. Cada comando incrementa/observa o fence, impede novas leases e coordena cleanup.
- Não modificar `productionComposition.js`, variáveis de ambiente ou servidores nesta feature. A integração real só ocorrerá após os gates operacionais próprios.

### 9. Testar por camadas e por matriz adversarial

- Criar `backend/test/f42OperationCatalog.test.js`: forma fechada, duplicados, mutabilidade, coerência adaptador/módulo/modo e ausência de catálogo `READ_ONLY` funcional.
- Criar `backend/test/f42TenantResolver.test.js`: dois tenants, input hostil, gates F3/F4.1, região, segredo, binding, rel leitura/versão/revisão, retry limitado e ausência de fallback.
- Criar `backend/test/f42TenantPoolManager.test.js`: single-flight, limites, reserva, FIFO, timeouts, idle, release/discard, circuit breaker, backoff/jitter e isolamento.
- Criar `backend/test/f42TenantLeaseExecutor.test.js`: capability opaca, revalidação antes da primeira query, módulo/modo, fencing, timeout e cleanup agregado.
- Criar `backend/test/f42TenantRuntimeLoad.test.js`: carga sintética concorrente sobre dois tenants, cutover, drenagem, revogação e inventário final sem pools, leases, timers ou material sensível.
- Atualizar `backend/test/support/doubles.js` apenas se um helper genérico existente precisar de extensão compatível; manter doubles específicos no novo ficheiro.
- Adicionar testes contratuais que varram os novos módulos e outputs por canários de segredo, connection string, refs, host/base, imports Legacy, acesso a `process.env`, SQL genérico e timers reais.

### 10. Validar e preparar revisão

- Executar `node --check` em todos os JavaScript alterados.
- Executar primeiro os testes F4.2 focados e depois `npm test` em `backend/`.
- Executar `git diff --check` e scans focados de segredos, skips, TODOs, timers reais, imports Legacy e acesso direto a configuração de base.
- Confirmar por inventário dos doubles que não houve acesso a Central persistente, Legacy, rede, serviços externos, migrations ou recursos residuais.
- Atualizar este documento apenas com factos e resultados realmente observados e mover para `Review` somente depois de todos os critérios passarem.

## Matriz de validação dos critérios

| Critérios | Evidência planeada |
| --- | --- |
| 1–2 | Matriz de dois tenants, substituições cruzadas e inputs adicionais/infraestruturais em `f42TenantResolver.test.js` |
| 3 | Validação estrutural e coerência do catálogo em `f42OperationCatalog.test.js` |
| 4–5 | Tabela adversarial de cada gate F3/F4.1, segredo, binding, circuito e capacidade, afirmando zero query/fallback |
| 6–7 | Mudanças controladas entre as duas leituras e antes da primeira query, com descarte e retry limitado |
| 8–10 | Concorrência single-flight, orçamento, reserva, timeout, idle e matriz de falhas/cleanup do pool manager |
| 11–12 | Cutover, fence, drenagem, revogação e leases em curso no executor/runtime |
| 13–14 | Relógio/scheduler/jitter determinísticos e carga sintética isolada com inventário final vazio |
| 15 | Canários e scans de erros, logs, traces, métricas e handles públicos |
| 16 | Doubles exclusivos, ausência de integração na composição e inventário que prova zero I/O externo |

## Ficheiros previstos

- Alterar `backend/src/security/membershipRepository.js`.
- Alterar `backend/src/security/tenantDirectoryRepository.js`.
- Criar `backend/src/security/tenantRuntimeErrors.js`.
- Criar `backend/src/security/tenantOperationCatalog.js`.
- Criar `backend/src/security/tenantCredentialProvider.js`.
- Criar `backend/src/security/tenantBindingVerifier.js`.
- Criar `backend/src/security/tenantPoolManager.js`.
- Criar `backend/src/security/tenantResolver.js`.
- Criar `backend/src/security/tenantLeaseExecutor.js`.
- Criar `backend/src/security/tenantRuntime.js`.
- Criar `backend/test/support/tenantRuntimeDoubles.js`.
- Criar os cinco testes F4.2 indicados no plano.
- Alterar `context/current-work.md` apenas para manter estado, decisões e evidência.

## Decisões pendentes e gates posteriores

Não existe decisão material pendente para implementar e testar o âmbito local acima. Permanecem deliberadamente bloqueados e fora desta feature:

1. fornecedor e integração do secret manager;
2. sizing, limites, reserva, timeouts, probes, backoff e circuit breaker de produção;
3. catálogo funcional `READ_ONLY` e preflight físico real da F4.3;
4. integração em `productionComposition.js`, ambientes reais, deploy e rollout;
5. provisioning e políticas operacionais/jurídicas da F4.4.

## Implementação realizada

- O `membershipRepository` revalida agora o contexto F3 por organização, membership, versão e elegibilidade temporal persistida.
- O `tenantDirectoryRepository` projeta um snapshot interno, explícito e imutável com versão/revisão, refs opacas, região, binding, schema, fingerprint e capacidades.
- O catálogo de operações exige entradas e adaptadores fechados, congelados, únicos e coerentes; catálogo vazio falha fechado e não existe catálogo funcional `READ_ONLY` nesta fase.
- Providers vendor-neutral isolam resolução de credenciais e observação sintética do binding, com erros sanitizados e descarte explícito.
- O gestor de pools aplica chave `tenantId + connectionVersion`, single-flight, limites global/tenant, reserva operacional, fila/timeout, idle expiration, fencing, versões negadas após drain/revoke, bloqueio persistente, circuit breaker por tenant e cleanup integral.
- O resolver valida input fechado, revalida F3 e todos os gates F4.1, resolve segredo just-in-time, verifica binding/fingerprint/capacidades, relê o snapshot e reinicia de forma limitada perante mudança concorrente.
- A lease é uma capability opaca com apenas `execute` e `release`; o executor revalida membership, versão, revisões, fence e digest antes da primeira query e liberta ou descarta sempre o client.
- O runtime F4.2 é apenas uma composição injetável. Não foi ligado a `productionComposition.js`, endpoints, jobs, Legacy, Neon ou qualquer serviço externo.

## Validação executada

- Testes F4.2 focados: 87/87 passaram.
- Suite backend completa: 326/326 passou, sem falhas, skips ou TODOs.
- `node --check` passou nos ficheiros JavaScript alterados e os novos testes foram carregados e executados pela suite.
- `git diff --check` passou.
- Scans não encontraram acesso a `process.env`, URLs/configuração de bases, imports Legacy/Central, timers globais, skips, TODOs ou FIXMEs nos novos módulos. As únicas operações temporizadas usam o scheduler injetado.
- A carga sintética concorrente sobre dois tenants terminou com zero pools, leases, filas, timers ou recursos residuais.
- Nenhuma migration, base persistente, rede, serviço externo, provisioning, deploy ou rollout foi executado.

## Desvios ao plano

- Nenhum desvio material. O fingerprint esperado é transportado dentro de `verifiedCapabilities`, já suportado pelo snapshot F4.1, sem alterar a migration `003`.
- A política local permanece obrigatoriamente injetada; não foram introduzidos defaults ou valores operacionais de produção.

## Correções após a primeira revisão formal

- Timeouts de aquisição permanecem ativos durante fila, criação do pool e `connect()`. O caller recebe falha no prazo configurado, o `AbortSignal` é propagado e pools/clients tardios são fechados ou descartados sem reter capacidade ou material no pedido.
- A execução da query usa o mesmo deadline da lease através do scheduler injetado. Query pendente ao expirar a lease falha com código sanitizado e o client é descartado.
- O backoff mantém `nextAttemptAt` por tenant e recusa retries antes do atraso exponencial com jitter; chamadas durante circuito aberto não prolongam a janela.
- Drain/revoke e bloqueio são idempotentes: replay não incrementa novamente o fence. Recuperação de bloqueio exige fence atual e uma versão não negada explicitamente.
- Idle e drain timers são registados e cancelados durante cleanup. O registo do pool só desaparece depois de `end()` concluir; falha permanece visível e retryable para reconciliação.
- Falhas de release/end são convertidas em erros runtime sanitizados antes de atravessarem a lease; erros principal e de cleanup continuam agregados sem expor a mensagem do driver.
- Os testes corretivos cobrem factory cooperativa e não cooperativa, client tardio, query pendente, backoff, replay de lifecycle, recuperação validada, timer residual, falha de `end()` e redaction de cleanup.
- O deadline da lease abrange agora a verificação de binding, a releitura do snapshot e as revalidações de membership/diretório anteriores à primeira query. Timeout em qualquer destas fases descarta e liberta a allocation.
- Uma operação física que ignore abort continua contabilizada no orçamento até terminar e concluir o descarte tardio. O timeout dessa operação alimenta o backoff por tenant, impedindo retries de contornarem os limites.
- Testes regressivos adicionais cobrem binding pendente, revalidação pré-query pendente e `connect()` tardio sob limite unitário com ativação de backoff.
- Continuações tardias de membership ou diretório verificam novamente deadline, estado da lease e fence antes de avançarem. Depois de timeout não conseguem alcançar o query module, mesmo que a dependência pendente resolva posteriormente.
- Falhas dos repositórios durante a revalidação pré-query são convertidas em erros runtime estáveis e sanitizados; canários de connection string provam que mensagens do adapter não atravessam a lease.
- A matriz corretiva inclui agora casos deferred para membership e diretório, canários de erro para ambas as fronteiras e recusa explícita de lease fenced antes da query.
- A capability da lease é estritamente single-use: a transição síncrona `ACTIVE → EXECUTING` antecede qualquer `await`, impedindo uma segunda execução de alcançar revalidação ou query.
- `release()` público durante `EXECUTING` falha com código runtime estável e não toca no client; a libertação única permanece responsabilidade do `finally` da execução original.
- Testes concorrentes provam uma única revalidação, uma única query e uma única release, incluindo recusa de execução e release simultâneas.
- Drain/revoke, bloqueio e encerramento cancelam agora aquisições ainda não resolvidas, removem pedidos da fila, abortam adapters cooperativos e mantêm a capacidade ocupada até ao cleanup de resultados tardios.
- Depois de `connect()`, o gestor revalida encerramento, estado do pool, bloqueio, denylist e fence antes de promover o client a lease; qualquer conflito descarta o client.
- Testes deferred cobrem revoke, block e `closeAll()` durante `connect()` pendente, confirmando rejeição imediata, descarte tardio único, motivo sanitizado e reposição integral da capacidade.
- `TenantRuntimeError` já não aceita nem conserva `cause`; exceções de adapters e repositórios são substituídas na fronteira por códigos e mensagens estáveis, sem transportar o erro original.
- A cobertura de redaction percorre propriedades enumeráveis e não enumeráveis, `cause`, stack, grafo do erro e `util.inspect`, confirmando ausência dos canários de credencial e infraestrutura.
- A política exige agora limites globais e por tenant para a fila, além de uma reserva própria para pedidos operacionais. Pedidos excedentes falham antes de reter material, timer ou task, e testes determinísticos cobrem os três limites e a validação da configuração.
- Cancelamentos de aquisição propagam o motivo sanitizado que os originou. `closeAll()` ignora apenas o `POOL_CLOSED` esperado pelo próprio encerramento e continua a agregar falhas reais de criação ou cleanup; o cenário de criação cooperativa em curso fecha sem falso erro.
- A criação single-flight possui agora lifecycle, sinal de cancelamento, material temporário e conjunto de waiters próprios. O timeout de um waiter não cancela nem rejeita outros pedidos ainda válidos; a criação comum só é abortada quando já não existem waiters e uma falha física partilhada conta uma única vez para o circuito.
- Resultados parcialmente inválidos da pool factory são encerrados antes de perderem a referência. Falha nesse cleanup é sanitizada, agregada ao resultado inválido e refletida nas métricas, sem transportar detalhes do adapter.
- O handle de credencial é agora transferido explicitamente do resolver para o gestor de pools. O gestor conserva a ownership durante fila e criação single-flight e executa `dispose()` exatamente uma vez em sucesso, recusa, timeout, lifecycle ou shutdown; o resolver só mantém cleanup enquanto a transferência ainda não ocorreu.
- A cobertura com material revogável prova que o timeout do primeiro waiter não descarta a credencial enquanto a factory partilhada ainda a utiliza. A carga concorrente confirma 20 disposals para 20 resoluções, sem material residual.
- A rejeição pública por timeout ou lifecycle já não aguarda o descarte do material de credencial. O descarte continua rastreado em background, sem prolongar o deadline observado pelo caller.
- Falhas tardias de descarte permanecem sanitizadas, contabilizadas em `cleanupFailures` e observáveis por `closeAll()`, mesmo depois de o último waiter terminar; a criação single-flight só deixa o registo depois de reconciliar o cleanup.
- Testes regressivos provam rejeição no deadline perante `dispose()` pendente e propagação no shutdown de uma falha de descarte ocorrida depois do timeout.
- Erros externos de cleanup de pools, clients e credenciais são agora substituídos incondicionalmente por códigos runtime sanitizados; nem `AggregateError` nem objetos com nomes internos forjados atravessam a fronteira do adapter.
- Cleanups físicos iniciados depois de timeout ou cancelamento ficam rastreados até à conclusão. `closeAll()` aguarda esses trabalhos e só então reporta, de forma sanitizada, qualquer falha tardia observada.
- A regressão adicional mantém `closeAll()` pendente enquanto o release tardio decorre e confirma por inspeção profunda que canários no erro agregado do adapter não chegam ao resultado final.
- Cada `poolFactory()` e `connect()` físico é agora registado num observer desde o início e só deixa o inventário depois de concluir o eventual cleanup tardio e repor a capacidade.
- `closeAll()` aguarda observers cooperativos até ao limite determinístico de drain. Um adapter que ignore abort mantém a capacidade contabilizada e produz `PHYSICAL_CLEANUP_TIMEOUT`, impedindo que o shutdown declare sucesso com recursos pendentes.
- Os testes distinguem encerramento cooperativo, que aguarda o client tardio e termina limpo, de factory não cooperativa, que falha de forma limitada, sanitizada e observável.
- `pool.end()` possui agora um lifecycle físico separado da tentativa limitada de encerramento. O timeout devolve `POOL_CLEANUP_TIMEOUT`, mantém a entrada e a falha visíveis e não perde a conclusão tardia do adapter.
- Se o `end()` tardio falhar, a entrada continua retryable; uma chamada posterior de reconciliação pode iniciar nova tentativa, limpar `cleanupError` apenas após sucesso e remover então o pool do inventário.
- A cobertura corretiva prova timeout limitado, retenção do pool, falha tardia observável e retry bem-sucedido sem falso estado limpo intermédio.
- A autenticidade de falhas runtime passa a depender da identidade de `TenantRuntimeError` ou de aggregates registados internamente; um erro externo que forje apenas o campo `name` é sanitizado nas fronteiras de query e release.
- O cleanup físico do client é rastreado desde o início e limitado pelo prazo da lease para o caller. Um release não cooperativo não prolonga `LEASE_TIMEOUT`; a operação física permanece contabilizada e reconciliável até terminar.
- `closeAll()` aplica o limite de drain a disposals de credenciais e releases de clients ainda pendentes, devolvendo `CREDENTIAL_CLEANUP_TIMEOUT` ou `CLIENT_CLEANUP_TIMEOUT` sem perder a conclusão tardia nem declarar sucesso prematuro.
- Os testes corretivos acrescentados cobrem nomes runtime forjados com canários, cleanup de client não cooperativo antes e depois do deadline e disposal de credencial pendente com reconciliação posterior.
- A autenticidade de `TenantRuntimeError` depende agora exclusivamente de um `WeakSet` privado preenchido pelo factory interno; construção externa, prototype forgery, cópia de propriedades e aggregates imitadores são sempre sanitizados. O registo privado de aggregates legítimos permanece separado.
- Recusas pré-aquisição por manager encerrado, input inválido ou fila/capacidade esgotada entregam imediatamente o erro primário. O disposal físico decorre num observer rastreado, com handlers completos, e qualquer falha tardia fica sanitizada e observável sem substituir a rejeição original.
- O snapshot expõe apenas contadores allowlisted para disposals de credenciais pendentes, timeouts pendentes de reconciliação e falhas tardias. Timeouts mantêm-se visíveis até ao settlement físico; sucesso tardio limpa o estado e rejeição tardia transita deterministicamente para falha sem dupla contagem ou janela falsamente limpa.
- A cobertura corretiva inclui prototype mutation, construção externa e cópia integral de propriedades; recusas imediatas com disposers pendentes, resolvidos e rejeitados; ausência de `unhandledRejection`; e snapshots antes, durante e depois de timeout, sucesso tardio, rejeição tardia e múltiplos disposals mistos.

## Fecho final da F4.2

### Veredicto

- `ready to close`.
- A revisão formal final contra os 16 critérios de aceitação terminou sem findings acionáveis.
- O âmbito local e sintético aprovado para a F4.2 está integralmente satisfeito.

### Resultado entregue

- Resolver fail-closed que parte exclusivamente do contexto organizacional F3, consulta o snapshot F4.1 e impede seleção de tenant, infraestrutura, credencial, modo ou query module por input externo.
- Catálogo interno fechado, provider de credenciais e verificador de binding vendor-neutral, sem integração com secret manager ou bases reais.
- Pools isolados por `tenantId + connectionVersion`, com single-flight, limites globais e por tenant, reserva operacional, fila limitada, deadlines, idle expiration, backoff, circuit breaker e lifecycle fenced.
- Leases opacas, single-use e limitadas por deadline, com revalidação antes da primeira query e cleanup físico rastreado até conclusão ou reconciliação.
- Erros runtime autenticados por brand privado não falsificável, sanitização integral de erros externos e aggregates confiáveis apenas quando todos os componentes já são internos e confiáveis.
- Recusas pré-aquisição imediatas, sem aguardar credential disposal, mantendo conclusão ou falha tardia rastreada e observável.
- Snapshot sanitizado com gauges de credential disposals pendentes, timeouts pendentes de reconciliação e falhas tardias, sem referências ou metadata sensível e sem dupla contagem.

### Critérios e validação final

- Os 16 critérios de aceitação foram revistos individualmente e satisfeitos por evidência de implementação, testes focados e probes adversariais.
- Testes F4.2 focados: 87/87 passaram.
- Suite backend completa: 326/326 passou, sem falhas, skips ou TODOs.
- `node --check` passou nos 16 ficheiros JavaScript relevantes.
- Probes cobriram prototype forgery, construção externa, clone de propriedades, aggregate externo, canários sensíveis, recusa imediata com disposal pendente, conclusão/rejeição tardias e snapshot antes, durante e depois da reconciliação.
- `git diff --check`, scans de acoplamento, segredos e artefactos gerados passaram.
- Nenhuma migration, Central persistente, base tenant real, Legacy, serviço externo, provisioning, rollout ou deploy foi executado.

### Decisões preservadas

- Membership F3 e diretório F4.1 continuam as únicas fontes de verdade de acesso e resolução; não existe fallback para Central, Legacy ou outro tenant.
- `DATABASE_PER_ORGANIZATION` permanece o único modo suportado nesta fase.
- Credenciais são material temporário com ownership explícito e disposal rastreado; apenas referências opacas atravessam o diretório.
- Clock, scheduler, jitter, adapters e políticas permanecem injetáveis e determinísticos; não existem defaults operacionais de produção.
- A composição F4.2 continua desligada de `productionComposition.js`, endpoints, jobs e ambientes reais.

### Limitações reais e trabalho futuro

- Secret manager, sizing e valores operacionais de produção continuam por decidir e bloqueiam integração operacional real.
- O catálogo funcional `READ_ONLY`, baseline, ledger, migrations e preflight tenant pertencem à F4.3 e não foram iniciados.
- Provisioning, onboarding/offboarding, health operacional, backup/restore e reconciliação reais permanecem fora do âmbito.
- Este fecho não autoriza migrations, acesso persistente, deploy, rollout ou utilização de tenants reais.
