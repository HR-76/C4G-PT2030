# Gate PostgreSQL isolado de parceiros

Pacote preparado para o protótipo; **não executado contra PostgreSQL nesta preparação**. [Contrato](../../../context/features/partner-postgres-gate.md). Não está ligado ao arranque, rotas ou composição ativa.

## Preparação sem infraestrutura

Na raiz do repositório:

```powershell
node test/integration/partner-portal/gate.js --plan
```

Sem argumentos tem o mesmo efeito. Saída `NOT_RUN`, sem Docker, sockets, configuração Dev ou SQL. Exit zero neste modo significa que o plano foi produzido, não que os testes PostgreSQL passaram.

## Âmbito concreto da futura execução

A execução precisa de autorização explícita para este âmbito. O flag `--scope` é uma proteção técnica contra arranque acidental; não substitui essa autorização.

- Um contentor PostgreSQL 17 novo, de uma imagem **já local e identificada por SHA-256 imutável**. Sem pull automático. Não foi escolhido/consultado um ID de imagem nesta preparação.
- Contexto Docker local, via named pipe no Windows ou socket Unix no Linux; contexto e identidade do daemon fixos durante toda a execução. Contextos remotos e variáveis de ligação herdadas são recusados. Não alterar o contexto global do Docker.
- Nome/label aleatórios por execução; porta dinâmica publicada exclusivamente em `127.0.0.1`; sem bind mounts nem volumes do utilizador.
- Central sintética e duas bases tenant no contentor criado. Aplicar os manifests existentes apenas aí; provisionar roles/grants e LOGINs limitados reais. Dados exclusivamente sintéticos. Não editar migrations/grants do produto nem usar Dev.
- Nenhum serviço existente é parado, pausado, reconfigurado ou usado. Não reservar o host por ação automática nem declarar isolamento físico produtivo.
- Remover apenas o contentor próprio e os seus volumes anónimos após conferir novamente ID, nome, label e imagem. Se a identidade deixar de ser comprovável, recusar remoção e registar falha de cleanup.
- Guardar evidência nova em `context/reviews/partner-portal-pg-<runId>/`, sem sobrescrever execuções anteriores. Não guardar passwords, URLs de ligação, SQL bruto, tokens ou chaves.

Após aprovação e escolha do ID local, o comando será:

```powershell
$imageId = 'sha256:SUBSTITUIR_PELOS_64_HEXADECIMAIS_DA_IMAGEM_LOCAL_APROVADA'
node test/integration/partner-portal/gate.js --execute --scope C4G_PARTNER_PORTAL_DISPOSABLE_V1 --image-id $imageId
```

O placeholder é deliberadamente recusado. Não usar um tag mutável ou URL de base. O runner verifica `sources.json` antes de criar infraestrutura; alterações de fontes exigem nova revisão/testes e atualização consciente do manifest, nunca regeneração automática para passar o gate.

Limites operacionais do runner: cada comando Docker até 30 s; readiness até 30 tentativas; preparação até 180 s; probes de repositório até 180 s; autoridade até 120 s; capacidade até 900 s; fecho do environment até 10 s, seguido de remoção do contentor próprio mesmo se esse fecho falhar. Estes são limites do harness, não aumentos das leases ou SLO da aplicação. Uma fase que exceda o orçamento falha e impede PASS.

## Matriz e evidência

| Grupo | Preparado | O que demonstra quando executado |
| --- | --- | --- |
| Repositório | 14 cenários, incluindo matriz dos 16 contratos | LOGIN limitado/FORCE RLS, ligações cruzadas, equivalência/cursor/collation, três pontos de snapshot, sucesso/erro/cancelamento/desconexão/reutilização |
| Autoridade | 9 cenários | Membership/política com cada ordem de chegada, sessão revogada, equipa antes/durante leitura e cache, falha real de F7 |
| Capacidade | 13 cenários × 2 pares AB/BA | Volumes 0/25/26/100/101/10000/10001, recusados, origem partilhada/distinta, filtro seletivo, histórico inativo e payload grande |

Os readers de repositório usam PostgreSQL real com ports de autorização controlados. A prova de autoridade é separada e usa a composição, membership, coordenador, guard e F7 reais. A composição é carregada num módulo privado do processo do gate, substituindo apenas a factory de parceiros para `partnersBrowse`; não altera fontes, `require.cache` global ou o runtime ativo.

A matriz conserva o oracle dos 16 cenários. Dois tipos de fixture podem ser recusados no armazenamento: a origem central com avaliação incompatível com `application_exact_origin`, e o surrogate Unicode isolado. A evidência deve registar cenário, SQLSTATE/constraint e `EXPECTED_STORAGE_REJECTION`; isso **não conta como PASS de leitura dessa fixture**. Os restantes cenários e as partes de leitura executadas continuam obrigatórios. Rejeições imprevistas ou asserções falhadas nunca são convertidas nessa categoria.

`pg_cursors` é observado na sessão que abriu o portal, depois de CLOSE/ROLLBACK. Para desconexão, observa-se o desaparecimento do backend, sem inferir portais de outra sessão. A inspeção não exporta nomes de portais nem a coluna `statement`. [PostgreSQL 17: cursores](https://www.postgresql.org/docs/17/view-pg-cursors.html).

RLS tem prova positiva e negativa com LOGIN sem SUPERUSER/BYPASSRLS/ownership, FORCE RLS e GUC organizacional. Não usar o bootstrap privilegiado para declarar isolamento do reader. [PostgreSQL 17: Row Security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

Membership/policy writers usam APIs reais e barreiras, incluindo a espera pelo guard. Não aguardar o commit do writer enquanto o reader está artificialmente suspenso. Nos dois testes de visibilidade/cache de equipa durante o scan, o writer é SQL sintético direto: a composição/autoridade do reader são reais, mas esses casos não provam a concorrência do endpoint auditado de mutação de equipa. Sessões autenticadas são sintéticas; não se declara prova OIDC/browser.

Um contexto Docker pode apontar para um daemon remoto; o loopback publicado aí não identifica o loopback local. Por isso, o endpoint e daemon locais são verificados antes da publicação de porta e de qualquer SQL. [Docker: contexts](https://docs.docker.com/engine/manage-resources/contexts/).

## Capacidade e critérios

Usar os limites existentes: operação 10000 ms, admissão 5000 ms, resposta 1048576 bytes, sentinela 10001 e máximo de 25 itens. Não aplicar aos parceiros o SLO C6 de admissão nem inventar teto de heap/RSS ou SLO produtivo de p95. Aquecimentos separados; todas as tentativas AB/BA preservadas; nenhum descarte seletivo de falhas.

- Tempo de operação observado: BEGIN principal até settlement da composição; o executor continua a impor o deadline integral. Admissão observada separadamente no pool manager.
- Queries: LOGIN tenant e protocolo exterior, excluindo SQL Central e observações admin. Chamadas ao port de autorização incluem hits de cache; não são contagem de SQL de autorização.
- Memória: picos amostrados do processo do gate, incluindo fixtures e instrumentação; não são teto de produção nem isolamento do consumo exclusivo do adaptador.
- Temporários PostgreSQL: delta observado de `pg_stat_database`, agregado por base e sujeito a atraso de publicação; não equivale a EXPLAIN/BUFFERS por query.
- Respostas: bytes JSON do resultado; o hash comparativo reduz cursores a contexto/posição, sem persistir assinatura/expiração. Compatibilidade dos tokens assinados é provada no grupo de repositório.
- Cleanup: observar pool e atividade PostgreSQL após settlement. Timeout devolvido não significa que o cleanup físico já acabou. Cleanup incerto interrompe carga e escritas de fixture posteriores.

O collector é sequencial: a concorrência deste pacote é de readers/writers nos probes de consistência/autoridade. Não é prova de throughput HTTP ou capacidade produtiva sob carga concorrente. O resultado mantém `productionCapacityApproved:false` e `integrationAuthorized:false`, incluindo quando o gate local passa.

## Resultado e repetição

O setup emite `setupDiagnostic` com a última fase, tenant sintético `A`/`B` ou `null`, estado `RUNNING`/`FAILED`/`READY`, classificação e código por lista permitida. Fases distinguem validação do destino, pool admin, fixture Central, roles, provisioner, actor/ensure/project/credenciais/pools/preflight/oportunidade por tenant e configuração/instrumentação do runtime. Não são guardados mensagens de erro, stack, SQL, destinos, nomes de recursos ou credenciais. Códigos não previstos resultam em `UNKNOWN`/`null`; não são copiados só por terem formato válido.

Uma falha de setup passa a produzir `ENVIRONMENT_SETUP_FAILED` no resultado exterior; `ENVIRONMENT_SETUP_TIMEOUT` mantém precedência quando o orçamento expira. Esta é uma alteração intencional do diagnóstico do harness, sem mudança de contratos da aplicação. O erro original continua a ser relançado internamente. `localCleanup` distingue `NOT_STARTED`, `RUNNING`, `COMPLETED` e `FAILED`; indica apenas o retorno do fecho local, sem substituir `cleanup.environmentClosed`, remoção física do contentor ou provas de cleanup de cursores. Um timeout pode conservar a fase e o fecho ainda em curso. O campo é recolhido em memória e persistido nos checkpoints/final do runner; não é garantia de recuperação após morte abrupta do processo.

Em `TENANT_ENSURE`, os campos aditivos `substep`, `substepStatus` e `substepFailure` distinguem binding/reserva, aquisição/lock admin, roles/base, configuração tenant, migração, criação/reconciliação de identidades, grants de ligação, preflight, LOGINs, publicação Central e fecho/unlock/release. O provisionador exato é carregado num módulo privado com dependências observadas; sem reescrever fontes, alterar cache global ou acrescentar queries. O observador é sequencial, como o setup deste gate. A primeira falha observada fica conservada durante cleanup, mesmo se o provisionador original devolver posteriormente uma falha secundária. O erro devolvido e o comportamento original não são alterados.

Erros de migração são reconhecidos pela identidade privada e pelo `internalCode` permitido, incluindo agregados com no máximo oito causas e profundidade três. Getters, proxies, ciclos e conteúdo desconhecido não são executados/exportados. Outros códigos de provisionamento/diretório são reconhecidos por listas exatas. Helpers legados que usam `Error('IDENTIFICADOR_FIXO')` só são reconhecidos por igualdade exata com identificadores verificados nas fontes; a saída contém uma constante permitida, nunca texto livre. Detalhes e limites estão no [relatório das subetapas](../../../context/reviews/partner-ensure-diagnostic/README.md).

`evidence.json` contém execução, casos, amostras, aquecimentos, falhas de observação, cleanup e verdict; `sources.json` arquiva os hashes das fontes fixadas, não o seu conteúdo. A avaliação exige as mesmas fontes no workspace. O avaliador recalcula capacidade e valida invariantes dos probes, não aceita apenas flags PASS. Falta de caso, métrica, fonte, aquecimento ou cleanup impede PASS.

```powershell
node test/integration/partner-portal/gate.js --evaluate context/reviews/partner-portal-pg-ID_DA_EXECUCAO/evidence.json
```

Só PASS real sai zero no modo de execução/avaliação; evidência incompleta ou falha sai não zero. O modo `--plan` é uma preparação explicitamente distinta. Não repetir para procurar PASS sem conservar e explicar a falha anterior.

Primeira execução autorizada: [FAIL no setup](../../../context/reviews/partner-portal-pg-f8ca4c45e35a826640ac25d2f8fa97ef/README.md). O diagnóstico posterior foi [validado offline](../../../context/reviews/partner-setup-diagnostic/README.md); a evidência e o manifest arquivados dessa tentativa não foram reescritos. A avaliação com fontes atuais recusa intencionalmente o manifest antigo por desvio de fontes.

O preflight exterior passou a receber explicitamente `{ timeoutMs: 15000 }`, mantendo o manifest por omissão. É o mesmo `statement_timeout` por statement usado pelo provisionador, sem alteração do prazo global de setup ou da aquisição. A [regressão](../../../context/reviews/partner-preflight-timeout/README.md) cobre configuração do timeout e rollback/release/fecho após falha, usando preflight real e cliente controlado. A omissão anterior não explica a falha observada em `TENANT_ENSURE`. As duas tentativas continuam preservadas; não houve execução PostgreSQL neste incremento.

Após a [terceira tentativa](../../../context/reviews/partner-portal-pg-972f46fb06d1bc8d9fde2d3ac2290943/README.md), o gate passou a enviar `options: '-c timezone=UTC'` nas ligações tenant fornecidas ao provisionador, antes da primeira query. A opção também acompanha os pools owner/limitados que recebem essa configuração. O provisionador e o contrato estrito mantêm-se inalterados; as credenciais publicadas continuam com a forma original, e novas ligações usam o default de base já configurado pelo provisionador. Não se altera o contexto Docker, o ambiente do processo ou serviços existentes.

A [regressão da configuração de sessão](../../../context/reviews/partner-session-configuration/README.md) reproduz com pool controlado a sessão antiga que não recebe o novo default de ALTER DATABASE; com arranque UTC, o validador original passa. Os desvios de encoding, TimeZone, provider/locale ICU e versão de collation continuam recusados. Este resultado não identifica retroativamente qual campo divergiu na terceira tentativa e não é prova PostgreSQL; as três falhas continuam intactas.

## Diagnóstico temporal dos três cenários falhados

Após a [quarta tentativa](../../../context/reviews/partner-portal-pg-942a2b58f6d8b84fbb3510ea7d00714f/README.md), o harness acrescenta `temporalDiagnostic` às 18 operações (aquecimentos e pares AB/BA) de `volume-10000`, `volume-10001` e `profile-distinct-origins`. A matriz, fixtures, ordem, limites e veredito funcional mantêm-se. A preparação deste diagnóstico não executa PostgreSQL.

Cada operação tem snapshots `atSettlement` e `afterCleanup`: contagens iniciadas/concluídas/falhadas/pendentes, duração inclusiva total/máxima e tempo pendente observado. Fases: entrada completa da operação, resolve, lease, protect, reader, cleanup, membership/dados/política/auditoria de autorização e queries físicas Central/tenant. Os tempos são sobrepostos; não somar como decomposição exclusiva. `OPERATION` inclui a preparação anterior ao BEGIN principal, mas não é uma nova definição do limite contratual.

O miss é identificado pela chamada real de revalidação de membership dentro do autorizador. Hit exige o percurso de binding/guard da cache e retorno normal sem essa chamada. Uma recusa antecipada sem prova do percurso ou um guard que falha fica em `AUTHORIZATION_UNRESOLVED`; não se inventa uma segunda cache. O tempo de hit inclui a verificação original do guard. Os ports de autoridade e o coordenador conservam as suas identidades privadas; só as dependências do autorizador e os módulos privados do harness são observados.

As queries Central são observadas nos clientes físicos dos dois pools sintéticos, sem duplicar Pool.query. Incluem protocolo transacional; o tempo não inclui a aquisição anterior do cliente. A instrumentação tenant mede apenas client.query, excluindo hooks exteriores. Nenhum SQL, parâmetro, identificador, token, mensagem ou stack é exportado. Há 16 categorias fixas e até 1024 spans simultâneos; exceder o limite ou falhar o relógio invalida o diagnóstico sem substituir o resultado original. Trabalho tardio conserva o contexto da amostra inicial. Spans ainda pendentes após cleanup deixam diagnóstico incompleto e impedem PASS pelo estado do observador.

`VALID` significa apenas que o diagnóstico foi recolhido sem erro; não transforma timeout em sucesso nem prova cobertura funcional. `AUTHORIZATION_MEMBERSHIP` mede essa dependência, não o decisor inteiro; o port inclusivo e os restantes subtotais completam a observação. Overhead real com PostgreSQL continua por medir e deve ser considerado antes de atribuir causalidade. A [verificação offline](../../../context/reviews/partner-temporal-diagnostic/README.md) não substitui uma nova execução autorizada.

A [quinta execução](../../../context/reviews/partner-portal-pg-c834629bb382012fd47feb1e60a3041d/README.md) terminou FAIL: mesmos três cenários com LEASE_TIMEOUT, custo dominante nas autorizações sem cache e 15/18 diagnósticos temporais INCOMPLETE. O cleanup tenant não prova quiescência Central. Foi identificada a omissão em requireCleanup: diagnóstico pendente é registado, mas só cleanupMs null interrompe a carga. As medições ficam preservadas com esta limitação; nenhuma integração aprovada.

Correção de interrupção: `requireCleanup` recusa também qualquer span pendente em `afterCleanup`, incluindo diagnóstico INVALID. A amostra e o erro original ficam registados; não arranca outra variante, par ou cenário. O cenário fica INCOMPLETE, com `CAPACITY_CLEANUP_UNCONFIRMED` e `CAPACITY_FIXTURE_ARCHIVE_DEFERRED`; a fixture não é arquivada pelo probe e o runner mantém o fecho exterior do environment/contentor. Relógio inválido sem spans pendentes conserva o comportamento anterior. A observação temporal continua limitada aos três cenários definidos; não é prova de quiescência Central em cenários sem instrumentação.

A [sexta execução](../../../context/reviews/partner-portal-pg-7c5816a90760a11c54b070cce86fa74b/README.md) validou a interrupção em PostgreSQL: 20 medições/12 aquecimentos, com paragem no candidato de volume-10000, primeira pendência após cleanup. LEASE_TIMEOUT preservado, fixture adiada e sete cenários seguintes NOT_RUN; fecho exterior e remoção confirmados. Gate global FAIL por timeouts/cobertura interrompida. Execução única, 188,768 s; cinco tentativas anteriores intactas.

A [correção por decisão](../../../context/reviews/partner-authorization-read-group/README.md) está validada localmente: partnersBrowse agrupa apenas membership/F5 brutos, sem incluir política tenant ou F7 no grupo novo. Preserva cache/guard, consultas e prazos; 12 casos adicionais, foco 166 PASS e suites/build PASS. Manifest corrente altera apenas três fontes. A instrumentação continua a observar as chamadas reais de membership/dados; não se substituem os ports privados. O ganho real permanece por medir, sem reescrever as seis execuções anteriores.

A [sétima execução](../../../context/reviews/partner-portal-pg-fa1ecdc4e3305af458dc4fb67a96154a/README.md) mediu efeito parcial: miss médio 223,88→141,99 ms e linhas 3700→5800 no warmup baseline de volume-10000, mas persiste LEASE_TIMEOUT. O gate parou na primeira pendência após cleanup, com 20 medições/11 aquecimentos. Nos casos pequenos comuns, média +7,25%, sem melhoria geral demonstrada. Environment/contentor fechados/removidos; seis tentativas anteriores preservadas.

**Estado atual — parado por pedido do utilizador:** [agregação do catálogo Central](../../../context/reviews/central-schema-catalog-batch/README.md) concluída localmente. 20 testes novos; foco 47 PASS e suites/build PASS. Consultas base 7→1, com admissão fresca e verificação após o lock preservadas. Manifest corrente revisto apenas para centralSchemaManifest; sete execuções anteriores intactas. Nenhum novo gate foi executado: SQL real, latência e capacidade continuam por validar. Não iniciar nova execução, integração ou otimização nesta sequência.
