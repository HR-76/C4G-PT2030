# Decisão: admissão do schema Central reutilizada dentro do mesmo pedido HTTP

## Estado

**Aprovada pelo utilizador em 11/11/2026** para a API. Validação em ambiente local; sem gate isolado de segurança, sem deploy.

## Contexto e problema

Cada transação de autoridade começa por `assertAuthorityAdmission`, que executa o preflight completo da Central (marcador, ledger de migrações e impressão digital do schema, cerca de 34 consultas e 65 ms no ambiente local). Um pedido ao diretório da organização abre 13 a 15 transações de autoridade sequenciais; o preflight repetido soma cerca de 1 s dos 1,8 s do pedido. A regra anterior era «No lifetime cache: an already used physical connection is not schema evidence».

O agrupamento de transações foi analisado e rejeitado como solução: as transações restantes são pontos de controlo separados de propósito (antes, durante e depois do trabalho no tenant).

## Decisão

Dentro de **um único pedido HTTP**, o resultado de um preflight Central bem-sucedido pode ser reutilizado pelas transações de autoridade seguintes desse mesmo pedido.

Limites obrigatórios:

- O âmbito nasce com o pedido e não é partilhado entre pedidos, utilizadores, sessões ou processos. Fora de um pedido HTTP (workers, arranque, scripts) nada muda.
- Só um preflight concluído com sucesso é guardado; uma falha nunca é guardada nem substitui uma nova verificação.
- A reutilização expira ao fim de 10 s, o prazo máximo de uma transação de autoridade; um pedido mais longo volta a verificar.
- A evidência fica associada à base de dados em que foi obtida (host, porta e nome); outra base exige novo preflight.
- Continuam a correr **em todas as transações**: a verificação do login `c4g_authority_runtime`, a identidade da base Central, o lock de autoridade e a recolha da metadata de segurança de autoridade depois do lock (`assertAuthoritySecurity`). Sessão, membership, permissões, guardas e auditoria não são afetadas.

## Risco aceite

Uma alteração de schema da Central feita a meio de um pedido deixa de ser detetada pelas transações seguintes desse pedido (janela máxima de 10 s). O pedido seguinte volta a verificar. A metadata de segurança de autoridade (roles, privilégios e funções protegidas) continua a ser lida em cada transação.

## Extensão ao tenant — aprovada pelo utilizador em 11/11/2026

A mesma regra aplica-se à observação de schema e metadados do tenant (`observeTenantRuntimeMetadata`), que corria três vezes por pedido: na preparação da ligação, no início da transação e antes do commit. Dentro de um pedido HTTP, uma observação bem-sucedida é reutilizada pelas seguintes para a mesma base (host, porta, nome), o mesmo `tenant_id` e a mesma geração, com os mesmos limites: nunca entre pedidos, nunca uma falha, no máximo 10 s.

Continuam a correr em todas as fases, na própria ligação: as verificações do login limitado e dos seus roles e privilégios, a correspondência entre a base e o login físicos e o material de credenciais resolvido, e a comparação do resultado com o snapshot do lease (tenant, geração, versão e impressão digital do schema, capacidades). Workers e scripts não têm âmbito de pedido e não mudam.

Risco aceite adicional: uma alteração de schema do tenant entre o início do pedido e o commit, incluindo em operações de escrita, só é detetada no pedido seguinte.

## Extensão à metadata de segurança de autoridade — aprovada pelo utilizador em 11/11/2026

A leitura da metadata de segurança de autoridade depois do lock (`assertAuthoritySecurity`: roles de autoridade, privilégios e funções protegidas), que esta decisão mantinha em todas as transações, passa a seguir a mesma regra: dentro de um pedido HTTP, uma verificação bem-sucedida para a mesma base e a mesma versão do schema é reutilizada pelas transações seguintes, com os mesmos limites (nunca entre pedidos, nunca uma falha, no máximo 10 s). Esta secção substitui, nessa parte, o que está escrito acima em «Limites obrigatórios» e «Risco aceite».

Continuam em todas as transações: a verificação do login `c4g_authority_runtime`, a identidade da base Central e o lock de autoridade. Sessão, membership, permissões, guardas e auditoria não são afetadas. Fora de um pedido HTTP nada muda.

Risco aceite adicional: uma alteração de roles de autoridade, privilégios ou funções protegidas feita a meio de um pedido só é detetada no pedido seguinte.

## Fora do âmbito

Qualquer reutilização entre pedidos.

Contrato e aceitação: [feature](../features/request-scoped-central-admission.md).
