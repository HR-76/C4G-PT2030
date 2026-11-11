# Interesse organizacional e abertura de candidatura

Estado: **Review — ativado no ambiente habitual em 30/10/2026; schema031–033, permissões e retoma verificados.** [Prova final](../reviews/organizational-opportunity-interest/activation-completed.md). As etapas abaixo conservam o âmbito histórico das autorizações anteriores.

### Compatibilidade histórica e ensaio 030 → 033 — Review (pedido explícito de 30/10)

Resultado: 19 checks PASS no ensaio isolado, cleanup confirmado; preflight habitual READ ONLY PASS, sem alterações do ambiente. Backend 1783 PASS/1 FAIL preexistente/7 SKIP; frontend 461 PASS/build PASS. Evidência atualizada no plano de ativação.

Âmbito aprovado: admitir apenas o prefixo histórico exato de30 entradas já identificado, preservando todas as linhas, inclusive após acrescentar031–033. Seleções canónicas do manifest até030 também devem reconhecer esse prefixo. Apenas os fingerprints desse prefixo conhecido são históricos; checksums, ordem, versões, flags e todas as entradas posteriores continuam exatos. O preflight mantém a verificação independente do schema físico canónico, ownership e ACL/RLS. Nenhum SQL histórico ou ledger habitual é reescrito.

Critérios: regressões RED→GREEN para seleção030 e prolongamento031/032/033; recusar corrupção de qualquer campo histórico ou de novas entradas e manifests alternativos; ensaio PostgreSQL descartável com baseline histórica sintética, recusa de drift físico, rollback de upgrade falhado, preservação do ledger e dados, upgrade030→033 e repetição sem efeitos. Revalidar o ambiente habitual apenas em leitura; não ativar migrações/permissões nem reiniciar serviços.

## Pedido e decisões confirmadas

### Ativação 031–033 e grants — In Progress (autorização explícita de 30/10)

Revalidar após retoma, repetir janela e backup/restauro sem divergência, migrar pelo runner original, publicar033 na Central com CAS/auditoria e acrescentar apenas os grants previstos sob locks ORG/MEMBER. Preservar ledger, dados anteriores, políticas, assurance, identidades e configuração não relacionada. Atualizar apenas schema nos snapshots privados runtime/workers. Ensaiar a sequência numa cópia restaurada, incluindo replay sem duplicados; validar preflight, grants, saúde e leitura HTTP após ativação. Se a migração confirmar mas faltar coerência Central/configuração, manter consumers parados até reconciliar; nenhum downgrade improvisado. Não iniciar serviços externos ou worker de documentos.

### Janela controlada e renovação — Review (pedido explícito de 30/10)

Resultado: janela executada, backups/restauro PASS sem divergência nas duas bases, zero trabalho ativo na pausa, serviços retomados com saúde confirmada. Ativação pendente. [Evidência](../reviews/organizational-opportunity-interest/maintenance-window.md).

Preparar pausa dos consumidores habituais identificados, renovar backups e provar restauro sem divergência durante a janela. Conferir supervisor, descendentes e portas; impedir novas escritas com locks transitórios enquanto se confirma ausência de recolhas RUNNING e se para exclusivamente essa árvore. Não terminar sessões PostgreSQL nem processos desconhecidos. Preservar filas, schema, grants e configuração. Recusar atividade estranha. Retomar o supervisor habitual em finally e verificar saúde. Não ativar031–033. A cópia é válida para a janela observada; após retoma, nova validação/renovação é necessária antes da futura ativação.

### Backup e restauro antes da ativação — Review (30/10)

Resultado: cópia protegida e restauro isolado PASS, 210 tabelas e preflights originais verificados; suplemento de 16 ACLs explícitas preserva fingerprint estrito. Instâncias encerradas, sem alterações habituais pelo procedimento. Atividade concorrente na Central exige renovação na janela de ativação. [Evidência e limites](../reviews/organizational-opportunity-interest/backup-restore.md).

Pedido explícito: backups protegidos da Central, tenant e configuração privada; validar restauro isolado. Critérios: ACL Windows restrita antes de copiar dados; dumps consistentes por snapshot READ ONLY, hashes e inventário completo; restauro PostgreSQL18 separado, sem serviços consumidores; comparação de dados e preflight original; encerramento verificado da instância temporária. Preservar backups e ambiente habitual. Não aplicar031–033, grants ou reiniciar serviços habituais. Os snapshots são por base, não um backup distribuído atómico; renovar/verificar antes da futura ativação se houver alterações.

O utilizador pediu a análise integral da sinalização/criação de oportunidades e da abertura de candidatura. Confirmou depois: **guardar interesse na organização e abrir candidatura mais tarde**. Aprovou o avanço para o contrato e critérios de aceitação e acrescentou a associação de departamentos/unidades para segmentar, tanto em universidades como em câmaras municipais e outras organizações.

Na clarificação de acesso de 30/10/2026, confirmou que **administradores da organização, gestores e técnicos podem registar interesse; o perfil de consulta apenas lê**. A análise/gestão e a abertura de candidatura continuam sujeitas às permissões de gestão existentes.

Esta decisão substitui o comportamento pretendido de [Registar interesse na tabela](catalog-table-interest.md), que abria diretamente o formulário de candidatura. Não recodifica estados ou dados históricos. A [criação central exclusiva C4G](central-manual-opportunity-authoring.md) mantém-se.

## Produto pretendido, arquitetura e implementação atual

- **Produto:** descoberta → interesse privado da organização → análise humana → abertura explícita de uma ou várias candidaturas → preparação, registo de submissão e resultado. Matching é apoio opcional; não é condição de sinalização ou abertura.
- **Arquitetura:** catálogo e proveniência comuns na Central; interesses, afetações a unidades, candidaturas, notas e histórico na base da organização. A membership central atual continua a fonte de verdade do acesso.
- **Baseline observada antes desta implementação:** `CatalogInterestButton` apenas consultava a revisão e navegava para `PrivateApplications`. O formulário exige título, responsável e prazo interno; cria em `IDENTIFIED`. Não existia interesse organizacional funcional independente. Unidades hierárquicas já existem em `organizational_scope.scope`.
- Existe a relação técnica `opportunity_catalog.organization_opportunity`, sem o contrato de interesse humano aqui definido. Não converter os seus registos anteriores em interesses por inferência. O desenho físico deve usar um agregado explícito de interesse, preservando aquela relação e documentando qualquer reutilização meramente referencial.

## Contrato funcional

### 1. Registar e acompanhar interesse

1. A ação no catálogo e no detalhe central regista interesse na organização autenticada; não cria candidatura, não muda o catálogo e não abre o formulário completo de candidatura.
2. O registo exige apenas uma oportunidade central acessível e não arquivada. Organização, autor, membership, instante e identidade da revisão observada são resolvidos/validados no servidor. Título do projeto, responsável, prazo interno e orçamentos não são pedidos nesta etapa.
3. Há um único agregado de interesse por organização e oportunidade central. Um novo clique sobre um interesse já ativo devolve o mesmo registo, sem substituir autor, notas ou unidades. Não confundir esta unicidade com a candidatura: a mesma oportunidade pode originar várias candidaturas.
4. Unidades podem ser indicadas opcionalmente na sinalização. O gesto deve permitir guardar sem as preencher e conservar o contexto do catálogo. Após sucesso, mostrar «Interesse registado» e acesso ao detalhe. Falha nunca aparece como sucesso.
5. A lista de interesses da organização é acessível a partir do Catálogo C4G. Inclui oportunidade, autor/data, unidades e situação do interesse, com pesquisa, filtro por unidade, arquivo e paginação no servidor. O detalhe reúne fonte, referência, calendário oficial, notas, unidades, histórico e candidaturas que o utilizador pode consultar.
6. Gestores/administradores autorizados podem editar notas/unidades e arquivar um interesse, com motivo e histórico. O arquivo não elimina o registo nem cancela candidaturas. Um clique em Registar interesse não reabre um registo arquivado: apresenta o estado existente. Reabertura e workflow configurável ficam fora do primeiro incremento.
7. Não criar seguidores, subscrições, emails ou uma candidatura por pessoa que sinalize. O interesse é organizacional; novas sinalizações não transformam automaticamente membros de um departamento em interessados ou participantes.
8. Estado inicial do interesse é ativo. A análise é representada por notas, histórico e decisão explícita de abrir candidatura ou arquivar; não introduzir nesta entrega um segundo pipeline de etapas configuráveis.

### 2. Departamentos e unidades

- Reutilizar o tipo genérico `UNIT` e a hierarquia existente. Não criar modelos específicos de faculdade, centro de investigação, divisão municipal ou empresa, nem departamentos em texto livre neste fluxo.
- Uma associação pode conter zero, uma ou várias unidades. Sem seleção significa **«Sem unidade atribuída»**, nunca «Todas as unidades». Não existe unidade principal obrigatória nem herança da unidade principal do responsável.
- Usar IDs canónicos da mesma organização e apresentar o caminho hierárquico para distinguir nomes iguais. Novas associações admitem apenas unidades ativas e autorizadas; `TEAM`, unidades estrangeiras e IDs inexistentes são recusados. Limite inicial: 50 unidades distintas, coerente com o diretório existente.
- O filtro inicial corresponde à associação direta à unidade selecionada. Não incluir descendentes silenciosamente. Uma futura opção «Incluir subunidades» exige comportamento explícito e teste próprio.
- Selecionar uma unidade serve para segmentação. Não concede acesso a candidaturas, não cria grants, não adiciona participantes e não altera a política de equipa dos técnicos.
- Disponibilizar um seletor mínimo de unidades para utilizadores autorizados a sinalizar/gerir interesses. Não conceder leitura de pessoas ou de todo o diretório para permitir esta seleção. Falha/recusa da consulta não equivale a lista vazia e não limpa associações existentes.
- Separar esse seletor de atribuição das opções de filtro de leitura. Todos os leitores autorizados, incluindo o perfil de consulta, recebem as opções necessárias para filtrar os registos que podem consultar, sem grants gerais de diretório. Unidades arquivadas ainda referenciadas continuam disponíveis nos filtros históricos; não passam por isso a ser elegíveis para novas associações.
- Renomear ou mover uma unidade mantém o vínculo pelo ID. Arquivo conserva afetações e identificação histórica; novas associações a essa unidade deixam de ser admitidas. Não acrescentar um bloqueio de arquivo apenas por existir um interesse/candidatura: conservar as guardas atuais de estrutura/pessoas e mostrar a afetação anterior como histórica. Validar associação e arquivo sob coordenação de concorrência consistente.

### 3. Abrir candidatura

- A ação é posterior e explícita, dependente de autorização atual para gerir o interesse e criar candidatura. Consulta ou sinalização por um técnico não lhe concede essa capacidade.
- O formulário mostra referência, programa, fonte e prazo(s) oficial(ais), além da oportunidade. Sugere título editável, respeitando o limite de 200 caracteres, e pré-seleciona as unidades do interesse para revisão pelo utilizador.
- O responsável é uma membership central elegível, selecionada explicitamente. Não atribuir automaticamente a responsabilidade ao autor da sinalização ou à pessoa correspondente no Matching.
- O prazo interno continua obrigatório e distinto do prazo oficial. Pode existir uma ação explícita para usar um prazo oficial escolhido; nunca selecionar automaticamente uma ronda nem copiar o fecho silenciosamente.
- Orçamento total e orçamento da organização continuam opcionais, exatos e `null` quando desconhecidos. Não copiar dotação, montante máximo do aviso ou percentagem de financiamento. Zero permanece um valor explícito diferente de desconhecido.
- A abertura grava candidatura, referência ao interesse/revisão utilizada, afetações confirmadas, histórico, auditoria e recibo numa única transação tenant. Mudança relevante da revisão da oportunidade ou do interesse exige revisão explícita do contexto; nunca substituir entradas silenciosamente.
- Unidades da candidatura passam a ser uma associação própria. Alterações posteriores no interesse, responsável ou ficha da pessoa não redistribuem candidaturas existentes. Unidades entretanto arquivadas ficam visíveis no interesse, mas exigem remoção/substituição explícita antes de uma nova associação à candidatura.
- Uma repetição técnica devolve a mesma candidatura. Criar outra exige uma nova ação explícita; mostrar previamente as candidaturas acessíveis já associadas. Não revelar nomes ou contagens de candidaturas que o utilizador não pode consultar.
- A inclusão do responsável na equipa deve ser explícita e autorizada, com explicação quando um técnico ainda não terá acesso. Se escolhida durante a abertura, integrar a inclusão na mesma transação e exigir também autorização de gestão de equipa; não alargar grants por efeito da responsabilidade.
- O estado inicial da candidatura continua `IDENTIFIED`. `INTENTION` permanece uma etapa da candidatura existente, distinta do interesse organizacional. Nenhuma candidatura ou evento anterior é convertido em interesse, reclassificado ou apagado.

### 4. Acesso, segurança e histórico

| Ação | Perfis funcionais admitidos, sempre com autoridade/grants atuais |
| --- | --- |
| Consultar interesses da própria organização | Administrador, gestor, técnico e consulta |
| Registar interesse, com unidades opcionais | Administrador, gestor e técnico |
| Editar análise/notas/unidades ou arquivar interesse | Administrador e gestor autorizados |
| Abrir candidatura | Administrador/gestor com as permissões atuais de criação e leitura das origens |
| Consultar ou gerir candidatura resultante | Política atual da candidatura; técnico limitado à equipa |

A Administração C4G sem membership de cliente não recebe acesso implícito a interesses privados. Não derivar autoridade do nome do perfil no browser. O servidor devolve capacidades por ação e revalida membership, recurso e política em cada operação. As novas permissões do interesse são distintas das permissões de candidatura e do diretório; a sua instalação deve ser explícita no catálogo e perfis controlados.

Escritas usam revisão esperada quando aplicável, chave idempotente, digest da intenção, recibo e auditoria atómicos. Repetição reautoriza o acesso, recuperando o resultado confirmado sem voltar a executar a mutação. Leituras, resumos, filtros, exportações e históricos mantêm o mesmo âmbito organizacional. Referências indisponíveis não revelam dados de outra entidade.

### 5. Segmentação, contagens e reporting

O reporting atual deriva a unidade da unidade principal da pessoa ligada ao responsável (`applications/reportSql.js`). Esta medida não é a afetação explícita da candidatura. Preservar a métrica existente com nome/definição que identifique a unidade do responsável; introduzir a segmentação explícita separadamente, sem substituir silenciosamente números históricos.

Adicionar filtro de unidade às listas de interesses e candidaturas. «Todas» significa ausência de filtro; «Sem unidade atribuída» procura registos sem associação explícita. Registos anteriores permanecem sem afetações novas; não executar backfill a partir das pessoas.

Contagens globais usam IDs distintos. Uma candidatura associada a duas unidades pode aparecer nos dois recortes, mas conta uma vez no total global. Não somar esses subtotais como se fossem partições disjuntas. Não inventar percentagens de repartição financeira; valores de uma candidatura não se tornam duas receitas ou dois orçamentos. Exportações devem conservar esta distinção e as permissões do ecrã.

## Correções e incrementos complementares aprovados no diagnóstico

1. **Recuperação da candidatura:** tratar falha de armazenamento antes de enviar, apresentar erro recuperável, conservar intenção/recibo nos resultados incertos e impedir redirecionamento por resposta de um formulário abandonado. Preservar chave e conteúdo no retry.
2. **Navegação:** Voltar/Cancelar regressam ao contexto central ou ao interesse de origem, conservando filtros e paginação pertinentes; eliminar o regresso indevido às oportunidades privadas históricas.
3. **Autoria central:** acrescentar consulta de possíveis duplicados antes da publicação manual e decisão explícita perante correspondências, sem fusão automática. Preparar correção/arquivo administrativo com revisão, proveniência e histórico. Este incremento não é pré-condição técnica da sinalização de uma oportunidade já existente e não altera dados de clientes.

## Modelo e integração técnica

Contrato HTTP deste incremento: [interesses organizacionais e unidades](../references/opportunity-interests-http.md). O âmbito de implementação pedido inclui P0–P3 e a coerência de segmentação/contagens. A manutenção administrativa central de P4/AC-15 permanece incremento complementar independente, sem condicionar este percurso.

- Agregado tenant de interesse com identidade, oportunidade central/revisão observada, autor/membership, timestamps, estado de arquivo, notas e revisão concorrente; relações de unidades, histórico e recibos próprios. Unicidade por organização/oportunidade, incluindo o registo arquivado.
- Relações de unidades do interesse e da candidatura com chaves/FKs compostas por organização. Alterações conservam histórico; evitar apagar/recriar associações sem evidência da revisão anterior.
- Referência opcional da candidatura ao interesse de origem e à revisão usada. Campos ausentes de clientes/recibos antigos conservam semântica; não introduzir alterações retroativas nos digests de idempotência.
- Cliente HTTP em `frontend/src/api/api.js`; módulo/rotas próprios de interesses, reutilizando os mecanismos de autoridade, leases, auditoria e transação. Não disfarçar interesse como `APPLICATION` nem usar `application.create` para permitir a sinalização por técnicos.
- Contrato HTTP definido antes do código: criação, lista/detalhe/histórico, edição, arquivo, unidades elegíveis, resumo privado dos IDs da página e abertura atómica de candidatura. Lista paginada, limites explícitos e capacidades por ação; sem um pedido de resumo por linha do catálogo.
- Migrações aditivas, sem reescrever SQL aplicado. Inventariar próximo ordinal durante a implementação. Atualizar manifests, checksums, fingerprints, capabilities, ACL/RLS, catálogos F5/F7, preflight e compatibilidade de todos os consumidores afetados. Verificar necessidade real de extensão central de autoridade, sem a presumir nem excluir.
- Preservar `organization_opportunity`, oportunidades privadas, candidaturas, receipts, estados, equipas e histórico existentes. Não ativar uma versão de schema nova apenas por mudar um fingerprint esperado.

## Plano de implementação

1. **P0 — regressões do percurso atual.** Reproduzir falha de armazenamento, resposta tardia e perda do contexto; corrigir com testes RED→GREEN. Inventariar contratos/pins e preservar baseline antes das alterações de domínio.
2. **P1 — contratos de dados/autoridade e persistência.** Fixar DTOs HTTP/erros, entidades físicas, permissões/operações e migração aditiva. Implementar sinalização idempotente, leitura, gestão, unidades mínimas e histórico com testes de isolamento/concorrência.
3. **P2 — catálogo e interesses.** Alterar lista/detalhe para guardar interesse; mostrar resumo privado coerente, lista/detalhe de interesses, unidades e filtros. Conservar navegação, resultados incertos e acessibilidade.
4. **P3 — abertura e segmentação da candidatura.** Implementar operação atómica, formulário com sugestões/contexto, afetações próprias, ligação ao interesse, equipa explícita e filtro de unidades. Provar compatibilidade de candidaturas e recibos anteriores.
5. **P4 — contagens e manutenção central.** Validar contagens/exportações sem duplicação e distinguir classificação histórica pela unidade do responsável. Implementar prevenção de duplicados e correção/arquivo central como recorte identificado, sem fundir identidades existentes.
6. **P5 — validação e ativação controladas.** Suites completas/build/sintaxe, revisão de segurança/fluxo e prova visual. Preparar gate PostgreSQL/HTTP com duas organizações e dados sintéticos; executar apenas no âmbito isolado autorizado. Aplicação de SQL no ambiente habitual, rollout e deploy exigem autorização própria, após evidência concreta.

## Critérios de aceitação

| ID | Comportamento verificável | Prova prevista |
| --- | --- | --- |
| AC-01 | Registar interesse não cria candidatura nem exige campos da candidatura; permanece após nova sessão/leitura | Domínio, HTTP, browser |
| AC-02 | Admin/gestor/técnico sinalizam; consulta só lê; Admin C4G sem membership não lê interesses privados | Autorização, revogação, HTTP A/B |
| AC-03 | Repetição/cliques concorrentes sobre a mesma oportunidade reutilizam o interesse sem substituir conteúdo | Concorrência, PostgreSQL, UI |
| AC-04 | Zero/uma/várias unidades persistem; unidades estrangeiras, TEAM, inexistentes/inativas são recusadas | Contratos, FK/RLS, HTTP |
| AC-05 | Seleção de unidade não concede acesso, não altera equipa e não expõe o diretório completo aos técnicos | Grants, IDOR, browser |
| AC-06 | Pesquisa/unidade/arquivo/paginação são coerentes para todos os leitores, incluindo consulta; filtro exato, unidades arquivadas referenciadas e sem unidade funcionam; erro não vira vazio | Repositório, HTTP, UI |
| AC-07 | Renomear/mover/arquivar unidade preserva vínculos/histórico; corrida de arquivo não admite nova associação inválida | PostgreSQL e concorrência |
| AC-08 | Abertura conserva revisão da origem, sugere título/unidades, exige responsável elegível/prazo interno e não copia orçamento | Domínio, HTTP, formulário |
| AC-09 | Candidatura, referência ao interesse, unidades e equipa opcional autorizada são atómicos; retry não duplica | Rollback, commit incerto, PostgreSQL |
| AC-10 | Alterar interesse/pessoa/responsável não altera afetações de candidaturas existentes | Regressão de independência |
| AC-11 | Candidaturas/estados/recibos anteriores permanecem; nova candidatura começa Identificada; várias candidaturas deliberadas são possíveis | Upgrade, regressão de replay/lifecycle |
| AC-12 | Totais globais e valores não duplicam com múltiplas unidades; exportação segue as permissões e definição do ecrã | Reporting SQL, A/B, exportação |
| AC-13 | Armazenamento indisponível/5xx/reload/saída durante envio têm erro e recuperação seguros; respostas tardias não navegam | Testes de componente e browser |
| AC-14 | Voltar/Cancelar conservam origem, filtros e contexto; desktop 1440 e móvel 390 funcionam por teclado e sem overflow | Browser e inspeção visual |
| AC-15 | Criação manual mostra duplicados prováveis; correção/arquivo preservam identidade, versões e referências privadas | Autoria central, concorrência, HTTP |

## Implementação e validação em 30/10/2026

Sem submissão externa, IA, Matching obrigatório, novo pipeline configurável, notificações/seguidores, distribuição financeira automática, acesso por departamento ou reativação da autoria privada. Uma futura sugestão de oportunidade em falta por um cliente à C4G continua distinta deste fluxo.

P0–P3 implementados em código: domínio tenant de interesses com histórico/recibos, capacidades distintas, segmentação múltipla por UNIT, catálogo/lista/detalhe, formulário posterior preenchido, ligação de origem e equipa opcional explícita. Filtros de candidaturas usam EXISTS sem multiplicar totais. Opções históricas de unidades da candidatura são limitadas às candidaturas acessíveis, incluindo a política de equipa. O reporting existente pela unidade do responsável mantém a sua definição.

O interesse conserva a revisão observada. Ao abrir candidatura, consulta-se a revisão central atual; se tiver mudado, o formulário avisa e exige confirmação do contexto apresentado. A revisão atual escolhida é novamente verificada no servidor; não se substitui o snapshot histórico do interesse.

Validação local: **frontend 461 PASS e build PASS; backend 1775 PASS, 1 FAIL preexistente em `fundingEnrichmentPersistence.test.js:33`, 7 SKIP**. Regressões de armazenamento indisponível, resposta tardia e contexto de navegação tiveram RED→GREEN. Revisão cruzada corrigiu perda de notas no retry, modal tardio após mudar filtros, conservação de associações a unidades arquivadas, par de referência/revisão obrigatório no SQL e allowlist F7 dos três novos eventos. Ver [evidência de implementação](../reviews/organizational-opportunity-interest/implementation.md).

A migração aditiva `033_organizational_opportunity_interests` está **registada no manifest com fingerprint medido e validada em PostgreSQL descartável**. O utilizador autorizou as duas fases do [gate isolado](../../test/integration/opportunity-interests/README.md): medição com rollback (13 checks PASS) e verificação pelo runner/preflight original com login runtime independente, concorrência e replay (15 checks PASS). O primeiro ensaio reproduziu e permitiu corrigir a validação de FKs sobre candidaturas preexistentes sob RLS forçada; a proteção é reposta na mesma transação antes do commit. Preservação de dados/recibos anteriores e isolamento A/B foram confirmados. Todos os contentores descartáveis foram removidos. Nenhuma base habitual, conta ou grant real foi alterado; sem commit, push ou deploy.

As provas PostgreSQL cobrem persistência, RLS, concorrência e rollback reais. As portas de autoridade, catálogo e responsável do gate são sintéticas; a integração HTTP/OIDC no ambiente pretendido continua por confirmar após ativação explícita. AC-15 é o incremento independente de autoria central. Não declarar a feature operacional no ambiente habitual enquanto schema/grants não forem ativados.

Preparação da ativação concluída em leitura: [plano](../reviews/organizational-opportunity-interest/activation.md). A baseline habitual é030, com fingerprint físico canónico mas ledger histórico recusado pelo preflight atual. Há uma membership elegível e três grants adicionais previstos. Não aplicar diretamente033 nem executar o setup geral. Próximo passo: compatibilizar a baseline histórica preservando o ledger e ensaiar030→033 antes da ativação e confirmação HTTP/OIDC integrada.
