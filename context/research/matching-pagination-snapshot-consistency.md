# PERF-03 — desenho de snapshot e consistência

Estado: recomendação técnica para implementação e prova; não é uma arquitetura implantada nem uma prova de aceitação. Decisão solicitada: como paginar matching com ordem global e recusa de dados ou autoridade desatualizados, entre Central e tenant.

## Evidência e restrições

- O produto tem catálogo Central e base operacional separada por organização ([arquitetura](../architecture.md)). `matching.js` lê fontes em páginas, recusa mais de 1000 itens e volta a validar o contexto antes de devolver resultados. A UI ainda apresenta o conjunto numa só resposta.
- O [contrato PERF-03](../features/audit-remediation.md) exige completude, ordem global, invalidação por alterações, cursores vinculados a ator e organização, limites e teste com mais de 1000 pessoas e oportunidades. A [prova de fence](../reviews/matching-snapshot-fence-20261109-b/results.json) mostra bloqueio apenas para um escritor sintético participante; não prova o runtime. A prova anterior mostra que dois snapshots independentes podem combinar estados que nunca coexistiram.
- `person`, `person_profile` e `person_unit` têm caminhos de escrita distintos. A Central também tem estado de oportunidade, revisão e correções/estado de fonte. A lista integral das tabelas e escritores que afetam a projeção, filtros, visibilidade e ordenação precisa de auditoria antes da ativação; esta lista não é uma garantia de cobertura.
- `catalogReader` e as operações protegidas têm admissões e papéis próprios. O executor tenant usa transações read-only para leituras comuns, mas possui exceções fechadas read-write para leituras auditadas, incluindo diretório e oportunidades privadas; essa exceção não autoriza automaticamente persistir snapshots. O leitor Central inicia `BEGIN READ ONLY` e rejeita privilégios excessivos. `catalogReader.list` calcula `asOf` em cada chamada; uma captura paginada tem de fixar o mesmo instante para todos os leitores. A [auditoria de escritores e autoridade](matching-perf03-writers-authority-plan.md) detalha as consequências.
- PostgreSQL mantém um snapshot por transação em REPEATABLE READ; não fornece um snapshot global automático entre bases. Os locks de linha duram até ao fim da transação e só protegem escritores que entrem em conflito no mesmo marcador. Locks em REPEATABLE READ exigem cuidado com o momento de aquisição e o snapshot ([isolamento](https://www.postgresql.org/docs/18/transaction-iso.html), [locks](https://www.postgresql.org/docs/18/explicit-locking.html), [consistência](https://www.postgresql.org/docs/18/applevel-consistency.html)).

## Opções

| Opção | Avaliação |
| --- | --- |
| Snapshot durável no tenant, com marcadores transacionais por fonte | Recomendada: permite paginação limitada e partilhada entre processos, mantém dados da organização no tenant e deteta deriva. Exige migrações, cobertura de todos os escritores, coordenação de autoridade e prova de contenção. |
| Novo varrimento limitado em cada página, com fingerprint | Evita guardar o resultado, mas precisa do mesmo protocolo entre fontes em cada varrimento; o protótipo existente não garante captura estável e repete todo o trabalho. Não recomendado para a primeira implementação. |

## Desenho recomendado

### Estado e fronteiras

- Guardar no tenant um cabeçalho e linhas ordenadas de projeção mínima, nunca uma cópia dos snapshots completos de origem. O cabeçalho contém identificador aleatório, organização, ator e sessão ou vínculo de autoridade, operação, filtros normalizados, versão do algoritmo e catálogo de áreas, `asOf`, versões das fontes, estado, número de linhas/bytes e validade absoluta. A data e a hora de cálculo são fixas para toda a captura e apresentação.
- Cursores opacos autenticados com chave própria e rotação vinculam identificador do snapshot, posição, tamanho, organização, ator, sessão, operação, filtros, versão e expiração. Validar limites, assinatura e binding antes de qualquer leitura; um cursor não autoriza acesso. Não reutilizar implicitamente a finalidade ou chave dos tokens editoriais.
- Ordenação materializada e total: por pessoa, áreas descendente, prazo, identificador e origem; por oportunidade, áreas descendente, nome e identificador. Fixar a regra de nulos, precisão temporal e comparação de nomes numa versão do algoritmo; provar equivalência à regra existente antes de a alterar. Um ordinal persistido fornece páginas sem ordenar subconjuntos. A resposta distingue total completo, página e continuação.
- Estados propostos `BUILDING`, `READY`, `INVALID`, `EXPIRED`: apenas `READY` pode ser lido; `READY` e linhas completas são publicados atomicamente na transação tenant. Uma falha ou resultado incerto nunca dá acesso a uma construção parcial. Repetições são idempotentes ou criam nova construção sem tornar parcial visível.

### Marcadores e captura

1. Criar marcador monotónico na Central para alterações relevantes do catálogo e marcador por organização no tenant para oportunidades privadas e diretório/perfis. Todos os escritores relevantes devem bloquear e incrementar o marcador na **mesma transação** da alteração, incluindo jobs, importações, SQL de administração e paths indiretos. Falha, falta de marcador ou versão de protocolo incompatível impede matching. Inventário, privilégios e enforcement de triggers/grants são gates; não confiar apenas na boa vontade de chamadas de aplicação.
2. Admitir pedido e validar sessão, membership, tenant, recurso e capacidades segundo o protocolo existente. Abrir transações coordenadas em ordem fixa Central → tenant, com timeout estrito. Adquirir locks partilhados em ambos os marcadores antes de ler dados de qualquer fonte; verificar o modo de isolamento e obtenção de snapshot para evitar snapshot anterior ao lock. Leituras protegidas e gravação exigem portas e perfis mínimos novos, submetidos ao mesmo protocolo de autoridade: transações atuais read-only não podem simplesmente ser convertidas em read-write.
3. Após ambos os locks estarem efetivos, fixar `asOf` e ler integralmente as fontes relevantes com cursores internos estáveis, sem mudar transação ou sessão, produzindo resultados incrementalmente com limites explícitos de linhas, bytes, duração e concorrência. A interseção dos períodos dos locks oferece um instante comum **apenas se** todos os escritores relevantes respeitarem os marcadores e a leitura ocorrer depois de ambos os locks. Classificar e ordenar em armazenamento limitado, não numa coleção ilimitada na memória da API.
4. Sob os mesmos locks, revalidar autoridade e contexto segundo a ordem de locks comprovada do coordenador existente; guardar versões observadas e publicar atomicamente cabeçalho e linhas. Só devolver a primeira página após commit confirmado e verificação de autoridade aplicável. Se a ordem de locks colidir com o protocolo de autoridade, não ativar: desenhar e testar uma ordem conjunta ou outro mecanismo. Perda de qualquer ligação, rollback, timeout, sobrecarga ou falha de fonte recusa sem resultados parciais.

### Continuação e invalidação

Para cada página, autenticar e resolver novamente a autoridade; verificar cursor, dono, expiração, estado, filtros e versão; adquirir os marcadores relevantes na mesma ordem e comparar versões atuais com as guardadas. Validar de novo a autoridade no ponto protegido de publicação e ler as linhas sob proteção. Alteração de qualquer fonte, perfil, visibilidade, versão de algoritmo ou tenant, revogação ou validade ultrapassada recusa a página e exige novo cálculo; não apresentar página parcial nem reutilizar o cursor. O ponto de linearização deve ser demonstrado contra commits concorrentes, não apenas por duas leituras de versão. Tempo é igualmente entrada: expirar o snapshot até ao próximo instante que possa alterar a classificação temporal ou recusar e recalcular; o prazo máximo de validade é também um teto.

### Orçamentos, recuperação e retenção

- Valores exatos de produção dependem de capacidade medida. O desenho exige limites configurados e finitos para tamanho de página, linhas e bytes por snapshot, tempo de captura, espera de locks, snapshots por ator/tenant, espaço total e concorrência global/por tenant; ao exceder qualquer limite, falhar fechado e indicar capacidade sem sugerir que o resultado é completo. Os testes fixam valores sintéticos, não os promovem a SLO.
- `BUILDING` órfão após crash nunca é publicado; commit incerto é reconciliado pelo identificador e estado persistido. Expiração torna dados inacessíveis mesmo se a limpeza falhar; quotas contam também órfãos até reconciliação. Aplicar RLS e privilégios mínimos aos cabeçalhos e linhas, sem colocar dados de tenant na Central ou em logs.
- A arquitetura atual prevê retenção com `REVIEW_MANUAL` por defeito e não eliminação automática. A expiração lógica é parte do desenho; a eliminação física/limpeza automática de dados temporários necessita de política específica aprovada. Até aí, quotas e procedimento manual auditável são obrigatórios; não pressupor cleanup automático nem implantação operacional.

## Gates para implementação e validação

1. Inventariar entradas exatas e todas as mutações, incluindo correções de fonte e tempo; demonstrar que alterações fora da página incrementam a versão. Testar bypass por roles, SQL direto, batch, migrações, jobs e falhas. Definir grants, RLS, versionamento e rollout de escritores antes de habilitar leitores; desativar o caminho na presença de versões mistas.
2. Reproduzir em PostgreSQL descartável com Central e dois tenants: mais de 1000 oportunidades e pessoas, várias fontes e empates; concatenar páginas e comparar com ordenação global de referência. Validar páginas vazias, nulos, mudança de dia/prazo, tamanhos, cursores expirados/adulterados e bindings diferentes.
3. Controlar interleavings: escrita antes/durante/depois de cada lock, escrita fora da página, falha entre bases, commit incerto, corrida de revogação e mudança de perfil, isolamento cruzado, locks/ordem de autoridade, timeout e crash. Provar ausência de mistura de estados e de publicação após revogação no ponto definido; testar violações de protocolo e falha fechada.
4. Exercitar HTTP/OIDC, auditoria, RLS, rotação de chave e de ligação, múltiplos processos, restart, quotas e cleanup autorizado. Medir bloqueio de escritores, memória, I/O, latências e contenção antes de escolher orçamentos. Executar suites e build, sem bases habituais nem fornecedores reais.

## Limites da decisão

O protocolo proposto é um desenho, não uma demonstração de viabilidade no runtime: a cobertura completa dos escritores, a compatibilidade com transações read-only e com a ordem do coordenador de autoridade, e a retenção física ainda têm de ser resolvidas e provadas. Se um destes gates falhar, PERF-03 permanece aberto; não substituir por cache local nem elevar simplesmente o limite atual.
