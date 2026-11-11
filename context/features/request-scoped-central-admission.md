# Admissão Central por pedido

Estado: Review. [Decisão](../decisions/request-scoped-central-admission.md).

Reduzir o tempo dos pedidos autenticados sem alterar contratos HTTP, permissões ou auditoria: o preflight completo da Central corre uma vez por pedido HTTP em vez de uma vez por transação de autoridade.

## Contrato

- `backend/src/security/requestAdmissionScope.js` cria um âmbito por pedido, montado em `app.js` depois dos parsers de corpo e antes do middleware de sessão.
- `assertAuthorityAdmission` verifica sempre o login; reutiliza o preflight apenas quando existe âmbito do pedido, evidência bem-sucedida da mesma base e idade inferior a 10 s.
- Sem âmbito (workers, arranque, scripts, perda de contexto assíncrono), o comportamento é o anterior: preflight em cada transação.

## Aceitação

- Fora de um pedido: duas admissões executam dois preflights.
- No mesmo pedido: duas admissões executam um preflight; o login é verificado nas duas.
- Pedidos diferentes, incluindo concorrentes, não partilham evidência.
- Preflight falhado não é guardado; a admissão seguinte volta a verificar.
- Evidência com mais de 10 s ou de outra base não é reutilizada.
- Login diferente de `c4g_authority_runtime` é recusado mesmo com evidência guardada.
- Suite backend sem novas falhas; medição local antes/depois dos pedidos do diretório.

## Extensão ao tenant

- `observeTenantRuntimeMetadata` reutiliza, dentro do pedido, a observação bem-sucedida da mesma base, tenant e geração; as verificações de login, roles, privilégios e correspondência física do `bindingVerifier` continuam em todas as fases.
- Aceitação: fora de um pedido, cada observação lê o schema; no mesmo pedido, lê uma vez; pedidos diferentes não partilham; falha não é guardada; outra base, outro tenant ou outra geração obrigam a nova observação.

## Extensão à metadata de segurança de autoridade

- `assertAuthoritySecurity` reutiliza, dentro do pedido, a verificação bem-sucedida da mesma base e versão; login, identidade da Central e lock continuam em todas as transações.
- Aceitação: fora de um pedido, cada chamada verifica; no mesmo pedido, verifica uma vez; pedidos diferentes não partilham; falha não é guardada; outra base ou outra versão obrigam a nova verificação.

## Limites

Sem gate isolado de segurança nem comparação A/B em fixture; medições locais não são latência de produção.

## Verificação — 11/11/2026

Regressão RED antes da implementação (módulo inexistente), depois 9 testes focados aprovados em `backend/test/requestAdmissionScope.test.js`. Suite backend: 2913 aprovados, 7 ignorados, 0 falhas.

Medição no ambiente local habitual (conta da entidade, um pedido isolado de cada tipo, com registo temporário das consultas):

| Pedido | Antes | Depois | Consultas SQL |
|---|---:|---:|---:|
| `GET /api/auth/session` | 338 ms | 179 ms | 177 → 75 |
| Contexto do diretório | 1748 ms | 937 ms | 926 → 456 |
| Unidades | 1662 ms | 914 ms | 832 → 430 |
| Pessoas | 1592 ms | 935 ms | 828 → 426 |

Abertura direta das páginas no navegador (duas amostras cada): Organização 2,2–2,5 s → 1,2 s; Unidades 3,9–4,4 s → 2,0–2,1 s; Pessoas 4,3–4,7 s → 2,4–2,6 s.

O preflight Central passou a correr uma vez por pedido. O tempo restante está sobretudo nas três verificações de schema e metadados do tenant (cerca de 0,5 s por pedido), fora do âmbito desta decisão.

## Verificação da extensão ao tenant — 11/11/2026

Regressão RED (4 testes a falhar) antes da implementação; depois 13 testes focados aprovados no mesmo ficheiro. Suite backend: 2917 aprovados, 7 ignorados, 0 falhas.

| Pedido | Original | Só Central | Central e tenant | Consultas SQL |
|---|---:|---:|---:|---:|
| `GET /api/auth/session` | 338 ms | 179 ms | 143 ms | 177 → 75 |
| Contexto do diretório | 1748 ms | 937 ms | 586 ms | 926 → 338 |
| Unidades | 1662 ms | 914 ms | 463 ms | 832 → 312 |
| Pessoas | 1592 ms | 935 ms | 478 ms | 828 → 308 |

Abertura direta no navegador (duas amostras cada): Organização 0,75–0,81 s; Unidades 1,25–1,31 s; Pessoas 1,39–1,63 s. Mesmas condições e limites da medição anterior.

## Verificação da extensão à metadata de segurança — 11/11/2026

Regressão RED (4 testes a falhar) antes da implementação; depois 18 testes focados aprovados no mesmo ficheiro. O carregador isolado de `backend/test/authoritySecuritySqlOptimization.test.js` passou a admitir a nova dependência; os seus casos correm fora de um pedido e continuam a exigir leitura fresca. Suite backend: 2925 aprovados, 7 ignorados, 0 falhas.

| Pedido | Central e tenant | Com metadata de segurança |
|---|---:|---:|
| `GET /api/auth/session` | 143 ms | 98 ms |
| Contexto do diretório | 586 ms | 412 ms |
| Unidades | 463 ms | 347 ms |
| Pessoas | 478 ms | 453 ms |
| Matching | 1678 ms | 919–977 ms |
| Contexto dos alertas | 559 ms | 388 ms |
| Interesses | 958 ms | 493 ms |
| Candidaturas | 616 ms | 488 ms |
| Parceiros | 468 ms | 361 ms |
| Dashboard | 575 ms | 452 ms |
| O meu trabalho | 459 ms | 429 ms |

Primeira visita no navegador (uma amostra): O meu trabalho 0,48 s; Candidaturas 0,53 s; Parceiros 0,76 s; Matching 1,05 s; Alertas 0,50 s; Catálogo 0,79 s; Interesses 0,55 s; Perfil pessoal 0,68 s. Um pedido por tipo, ambiente local com outro trabalho em curso; não são latências de produção.
