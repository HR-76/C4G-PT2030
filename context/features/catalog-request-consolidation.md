# GCNI — avaliação da consolidação de verificações
Estado da avaliação: concluída. Proposta de implementação: Draft, ainda não executada.

## Conclusão
Há margem limitada para reduzir viagens à base dentro de uma única admissão. Não há fundamento para substituir as várias autorizações do pedido por uma decisão única. A identidade do pedido não é a fronteira de segurança: importa a ligação, a transação, o principal, o conjunto de bloqueios e o ponto temporal da observação.

Recomendação: protótipo isolado apenas de C1 e C2. Não alterar a sequência de locks, os pontos de autorização inicial/final, os privilégios, as referências de esquema, os limites de pools ou a semântica da sessão. O benefício é uma hipótese de menos round trips; não é uma previsão de atingir500ms.

## Percurso observado
1. Leitura de sessão: admissão candidata sob lock partilhado42420002, COMMIT; nova transação de autoridade, lock partilhado43001306,1, nova recolha das ACLs e leitura da sessão. A admissão anterior não substitui essa recolha.
2. Serviço de leitura: membership/sessão atuais, exposição inicial e, quando existe snapshot, controlo prévio da geração.
3. Repositório: transação READ ONLY, lock partilhado42420002, identidade limitada, admissão do leitor e SET LOCAL ROLE. Leitura do cabeçalho e dos dados; COMMIT. Cache fria pode exigir outras transações admitidas, sem manter ligações ocupadas à espera de construção partilhada.
4. Após carregar a geração: nova verificação de exposição; preparação/validação da resposta; nova membership e exposição antes de devolver a resposta. /availability tem percurso próprio e mantém revalidação.
5. Renovação da sessão: operação distinta, com admissão própria, bloqueio exclusivo43001306,1, leitura atual, validação e escrita. Não usar a decisão inicial do pedido.

Os advisory locks são um protocolo cooperativo, não bloqueiam todo o DDL ou GRANT possível. Agrupar consultas não autoriza relaxar os restantes mecanismos nem afirmar atomicidade entre a última verificação e o envio dos bytes.

## Matriz de decisão

### C1 — versão PostgreSQL na admissão isolada — Candidato recomendado
isolatedAdmission já valida a versão dentro da transação; nativeConstraintSql volta a consultá-la. Passar apenas esse facto validado à construção da consulta, na mesma invocação/ligação/transação.

Até uma ida à base por admissão aplicável; nenhum hash, ACL ou decisão é reutilizado. O leitor autónomo continua a observar a versão.

### C2 — guardas do leitor e metadados da projeção — Candidato recomendado para protótipo
Agrupar a consulta de parents/privilégios e a recolha do fingerprint da projeção, no ponto posterior de validação, sob o lock42420002 e antes de SET LOCAL ROLE/leitura protegida. Manter a verificação inicial leve de identidade no repositório.

Até uma ida à base por admissão do leitor; manter todas as condições, hashes, valores e precedência de erros. Não eliminar a verificação de privilégios diretos só porque existe membership.

### C3 — versão, marcador central e ledger — Adiado
São leituras no mesmo checkpoint da admissão candidata; poderiam ser agrupadas sem deslocar o lock. A verificação de versões anterior ao BEGIN escolhe o percurso e não é substituível pelo ledger posterior sem novo desenho.

Não incluir na primeira alteração; medir benefício e preservar seleção da via anterior/candidata.

### Admissão prévia e verifyLocked — Não consolidar
A admissão termina com COMMIT; o coordenador abre outra transação e só depois adquire43001306,1. É obrigatório recolher ACLs novamente após adquirir o lock.

Mesmo pedido e mesma ligação não tornam válida a observação anterior.

### Membership e exposição no início/fim — Não consolidar
Leitura inicial autoriza o trabalho; leitura final deteta revogação, alteração de scope, desligamento, retirada e expiração durante a preparação.

Manter também o controlo pré-leitura de gerações retiradas e o controlo da geração efetivamente carregada.

### Leitura da sessão e renovação — Não consolidar
A leitura usa lock partilhado; a renovação é escrita com lock exclusivo e lê a sessão atual antes de validar e escrever. Pode concluir depois dos cabeçalhos.

Não ampliar o lock exclusivo a todo o pedido nem transportar a admissão da leitura para a renovação. Agrupamento existente de escritas pendentes idênticas não é cache de decisões e não será alargado.

### Transações de catálogo e construção de índice — Não consolidar entre transações
Cabeçalho, construção fria do índice e obtenção de payloads podem usar transações distintas. Cada transação deve ser admitida; esperas pela construção partilhada libertam a ligação.

Preservar limites e ausência de starvation; cache de dados imutáveis não autoriza cache de admissões.

### Uma ligação/transação para autenticação, catálogo e política — Fora do âmbito recomendado
Pools, identidades, roles e fronteiras de leitura/escrita são diferentes.

Não somar privilégios, prolongar locks ou adotar REPEATABLE READ para esconder alterações posteriores.

## Contrato do protótipo recomendado
- C1 transporta exclusivamente a versão já observada e validada na mesma invocação. Sem Map global, estado em req, armazenamento na ligação ou valor vindo do cliente. No percurso sem essa observação local, continuar a consultá-la. Não reutilizar snapshots de segurança.
- C2 mantém o guarda inicial de identidade. Produzir metadados e guardas de admissão conjuntamente no ponto posterior, validar todos os campos e todas as condições antes de qualquer mudança para o role de leitura ou acesso protegido. Uma consulta agrupada não elimina validações e deve usar o mesmo principal e transação.
- Não mover consultas através de COMMIT/ROLLBACK, checkout/release, espera de locks, mudança de role ou etapa final de autorização. Não fundir pools de autoridade, catálogo e política.
- Falha, resposta incompleta, versão desconhecida, drift, timeout ou cancelamento recusam o pedido e libertam/descartam a ligação conforme o contrato atual. Sem fallback para uma aprovação anterior.
- Não modificar os fingerprints ou normalizações para aceitar divergências. PostgreSQL17 mantém a via compatível; a incompatibilidade integral da projeção já registada permanece pendente.

## Sequência e critérios de aceitação
1. Criar regressões antes de alterar código: contagem por checkpoint e igualdade exata dos metadados/resultados, incluindo nulos e respostas incompletas. Validar cada recusa de login, membership, privilégio direto, ledger e schema.
2. Implementar C1 e C2 separadamente, apenas na composição isolada. Instrumentar contagens e durações por fase, sem dados de sessão, tokens ou decisões partilhadas. Confirmar redução real de consultas sem aumentar pools.
3. Provar drift na mesma ligação entre duas chamadas; alteração de ACL durante espera do lock; membership revogada durante leitura; desligar/reativar exposição; retirada da geração antes e durante a leitura; expiração antes da resposta; falhas e limpeza.
4. Provar os limites de concorrência: leitores concorrentes, escritor exclusivo, nenhum lock mantido à espera de outro pedido/índice partilhado, ausência de deadlock e separação de permissões.
5. Repetir suites backend/frontend, build, gate PostgreSQL próprio e OIDC isolado. Comparar A/B alternado e carga27/10000, tabela/ficha,10 concorrentes,5 séries de10;200 medições e40 aquecimentos. Zero erros e p95<=500ms por série, sem alterar a meta. Reportar contagens por tipo de checkpoint; não fixar artificialmente o número de renovações agrupadas.
6. Rejeitar ou reverter o protótipo isolado se não reduzir custo de forma útil ou se alterar qualquer garantia. Nunca promover como consequência automática do ensaio.

## Evidência e limites desta avaliação
Inspeção do código e50 testes existentes dirigidos aprovados, sem falhas ou testes ignorados, nesta avaliação. Os testes cobrem, entre outros, recolha após lock, revalidação entre chamadas, recusa de revogação/retirada, limites do repositório e sessões. Validam o comportamento atual, não um protótipo ainda inexistente. Não foram executadas nova carga, migrações ou infraestrutura nesta fase documental.

Referência de desempenho anterior:9dfce593bfaf409ca0bc087b78930460.200 medições sem erros; p95 com10000:625,56ms tabela e572,67ms ficha; capacidade NOT_ACCEPTED. A medição não separa o ganho futuro de cada consolidação. Não extrapolar a redução de round trips para ganho equivalente de latência, nem somar médias de fases sobrepostas como tempo decorrido.

## Autorrevisão
A proposta inicial de reunir verificações pelo identificador do pedido foi restringida ao checkpoint real: antes/depois de lock, transações distintas e antes/depois da leitura não são equivalentes. Identidade, membership, privilégio direto e fingerprint são condições diferentes, mesmo que consultem os mesmos catálogos. C2 preserva o guarda inicial e agrupa apenas a recolha posterior, sem antecipar a evidência para antes da sua fronteira atual. C1 partilha apenas uma capacidade do servidor observada localmente, nunca uma aprovação.

Não se recomenda uma transação abrangente ou elevação de privilégios. Os testes existentes confirmam as fronteiras atuais; continuam necessárias provas adversas específicas para o protótipo. Veredicto: avaliação concluída; C1/C2 recomendados para protótipo isolado, sem promessa de cumprir500ms. Código do serviço, fontes, configurações e ambiente habitual não alterados.

Próximo passo: implementar e medir C1/C2 num protótipo isolado, começando pelos testes de não reutilização e revogação, antes de repetir a carga completa.
