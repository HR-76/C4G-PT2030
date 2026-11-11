# Executor limitado à chamada 11145

Pedido confirmado em 31/10/2026. Estado: **Review — implementado e ensaiado isoladamente**. [Resultado e limites da prova](../../reviews/opportunity-data-standardization/executor-11145.md):17 checks do executor e12 do pacote registado PASS; instalação/aceitação habituais pendentes.

## Âmbito autorizado

Integrar e ensaiar, antes da execução habitual, o percurso completo para recolher a observação real de `EU_FUNDING_TENDERS / CASCADE:11145`, arquivar o candidato v2, preparar o plano, aprová-lo por sessão administrativa autenticada e aceitar exclusivamente esse plano. O ensaio usa PostgreSQL isolado, identidades/sessões de teste explicitamente declaradas e a API pública oficial atual. Não representa aprovação de uma pessoa real nem certifica um novo login no fornecedor OIDC.

Nesta entrega não instalar SQL, recolher para as bases habituais, suspender escritores habituais ou aceitar uma revisão habitual. Não alterar configuração/credenciais/contas reais, nem fazer commit, push ou deploy. Preservar o pacote SQL036–042/tenant034, os normativos S0/Excel, backups e relatórios anteriores. Não ampliar a recolha a outras chamadas/fontes nem ligar implicitamente o coletor genérico.

## Decisões de implementação

O coletor é uma operação administrativa delimitada, com URL, fonte, identidade, limites e adaptador fixados no servidor. Exige a identidade existente e preserva UUID/head, correções, resoluções e vínculos privados até à aceitação. O caminho genérico `repository.apply` não participa na recolha para aprovação.

A autoridade persistida, a identidade e o fence da fonte são verificados antes da consulta pública, numa transação curta. O I/O de rede é limitado e ocorre sem manter locks de sessão. Uma segunda transação revalida autoridade/identidade/fence, cria a execução real, arquiva e rederiva o candidato, verifica completude, conclui o run e audita atomicamente. Falha ou interrupção não deixa um run pendente sem outbox. Não fabricar `SUCCESS` nem marcar uma execução incompleta como concluída. Repetição usa um binding de pedido/ator/operação e devolve o arquivo comprometido, sem adotar um run legado ou outra chamada.

Seleção operacional explícita: `OPPORTUNITY_11145_EXECUTOR=bounded-v2`, desativada por omissão e dependente de `OPPORTUNITY_ACTIVATION_RUNTIME=authenticated-v2` e do pacote admitido normalmente. O worker genérico e as restantes fontes mantêm a configuração anterior.

HTTP sob `/api/admin/opportunity-activation`:

| Operação | Corpo fechado |
| --- | --- |
| `POST /calls/11145/collect` | `requestId`, `expectedSourceFence` |
| `POST /calls/11145/plans` | `requestId`, `runId` |
| `POST /calls/11145/plans/:planId/accept` | `requestId`, `planDigest`, `fence`, `sourceFence` |

Fonte, identidade, arquivo, snapshot, ator, destino e CAS não vêm do cliente. A preparação deriva arquivo/CAS no servidor. O GET factual, aprovação/revogação e suspensão/quiescência usam os contratos autenticados existentes. A aceitação exige scope11145 imutável, digest exato, aprovação atual pelo mesmo ator, TTL, arquivo/mapping, CAS e sourceFence revalidados na transação. Não há aprovação automática, endpoint genérico de publicação ou nova interface nesta entrega; atualizar o cliente comum `frontend/src/api/api.js`.

## Critérios de aceitação

1. Operações fechadas e limitadas à11145; ausência de flag/pacote, fonte/identidade alternativa, corpo desconhecido, snapshot/ator/destino injetado e pedidos sem sessão/origem/CSRF são recusados.
2. Observação atual pelo adaptador real, com limites de tempo/bytes/páginas, evidência verificável e sem valores forçados. O ensaio conserva resposta pública/hash/metadados e compara os factos com o normativo sem o sobrescrever. Expectativas a verificar:120000, moeda `NOT_FOUND`, SUSA/acordo101190010 e sete cut-offs.
3. Arquivo canónico durável produzido pelo executor, sem staging de fixture ou run `SUCCESS` sem recolha. Run completo, `limited=false`, `canonical_v2_required=true`, evidência rederivada e auditoria transacional. Replays/conflitos, falha de rede/parsing/arquivo/auditoria e revogação durante I/O não produzem efeitos parciais nem alteram v1.
4. Plano factual e aprovação autenticada reais no servidor de ensaio, através de middleware de sessão/CSRF e coordenador normais. Aprovação ausente/revogada/expirada, ator diferente, digest/CAS/fence obsoletos ou arquivo/mapping divergente impedem aceitação. Restrição de âmbito também é verificada dentro da composição, não só no router.
5. Aceitação isolada preserva UUID, revisão histórica, correções/resoluções e snapshots/vínculos privados; valor120000, sete prazos e read models comuns concordam com SQL. Auditoria íntegra, replay sem nova revisão e isolamento tenant comprovados. Após EUv2 aceite, a retoma do writer legado EU permanece recusada.
6. Gate próprio com pacote registado e admissão normal; destinos fixos isolados e cleanup confirmado. Identidade/histórico v1 de teste têm proveniência declarada e run legado `ERROR`, sem arquivo canónico; o único novo sucesso de recolha é produzido pelo executor real. Sem acesso às bases habituais.
7. Testes direcionados, suites completas backend/frontend, build, sintaxe e revisão independente. Fixar hashes de implementação/evidência e atualizar o plano operacional com comandos/DTOs, ordem, recuperação e limites. Novas alterações invalidam a prova anterior de bytes para uma futura janela; conservar os relatórios históricos.
