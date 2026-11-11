# F13-PQ1-PUBLISH — correção da confirmação desfasada

**Review — READY_FOR_HUMAN_REVIEW**, sem fecho humano. Correção autorizada após finding médio da revisão read-only e NO-GO anterior. [Contrato](../../features/f13-pq1-publish.md); [evidência original preservada](../f13-pq1-publish/README.md).

## Finding e resolução

Reprodução anterior: selecionar competência A → Guardar competências → alterar para B → Confirmar; o painel apresentava B mas o comando enviado conservava A. O probe da revisão executou os componentes reais com API simulada, sem escrita em PostgreSQL; não foi uma prova de persistência real.

**Resolvido:** `Pq1Details` notifica alterações de inputs/selects através de `onChangeCapture`; adicionar/remover declarações e adicionar experiências notificam explicitamente. `Pq1Profile` invalida a confirmação recebendo essa notificação. O utilizador mantém a possibilidade de editar, mas deve iniciar e confirmar novamente a ação. Não se recompõe silenciosamente uma confirmação já apresentada nem se envia automaticamente uma gravação. A correção abrange competências, experiências, seleções de evidência, método, validade e motivo de revogação. A edição temática já invalidava a confirmação e mantém esse comportamento.

Alterações produtivas limitadas a `frontend/src/pages/Pq1/Pq1Details.jsx` e `Pq1Profile.jsx`. Sem alteração de contratos HTTP, serviços backend, grants, migrations, CAS, idempotência, recuperação ou publicação. Não reabre a confirmação editorial de critérios da oportunidade.

## Validação executada nesta correção

- `npm test` em frontend: **62/62 PASS**, 9 ficheiros. Inclui **14 regressões novas** em `confirmation.test.jsx`, usando o painel real e API simulada.
- Cinco casos conferem valores efetivamente enviados após nova confirmação: competência A→B, período da experiência, validade, método (incluindo null permitido) e motivo de revogação. Um sexto confere documento da ligação de evidência.
- Oito casos adicionais cancelam uma submissão pendente após alterar conhecimento, tipo/início da experiência, seleções de declaração/experiência, adicionar/remover competência ou adicionar experiência.
- Os casos verificam ausência de confirmação, pedidos e envelope de intenção após a alteração; só uma nova confirmação produz o pedido com o valor atualizado. A suite existente de UNKNOWN e isolamento da UI também passou.
- `npm run build`: PASS, 2062 módulos, bundle JS 589.82 kB / gzip 175.45 kB; permanece o aviso de tamanho >500 kB. JSX validado pelo build.
- Revisão read-only do delta e whitespace, incluindo teste novo: PASS. Conferência final de hashes/HEAD/índice em `validation.json`.

Resultados acima observados nas ferramentas desta tarefa, registados como resumo em `validation.json`; não são transcrições de logs que não foram guardados. Nenhum teste backend, gate PostgreSQL ou browser integral foi repetido nesta correção: não houve alteração dessas camadas. O browser integral anterior não constitui execução da nova regressão; a prova nova é ao nível dos componentes React e payload da API simulada.

## Matriz de aceitação e evidência reutilizada

Complementa PUB-01/PUB-07: coerência entre formulário editável, confirmação explícita e comando enviado. PUB-11 mantém cobertura da suite atual de pendências; o protocolo de recuperação não mudou. Para os demais critérios, reutilizar [matriz original](../f13-pq1-publish/acceptance-matrix.md) e as provas correspondentes, não declarar uma nova execução. Os 22 artefactos originais foram conferidos sem divergências e não alterados. `tested-snapshot.json` regista hashes atuais do recorte, hashes anteriores e diferenças face aos 652 ficheiros do snapshot original; não reatribui a este código uma execução browser histórica.

A revisão final do delta não identificou outro finding material no recorte corrigido. O NO-GO anterior não é apagado: a sua causa foi corrigida e está pronta para nova revisão/decisão humana. Não foi declarado GO humano nem fecho.

## Limitações mantidas

503 não demonstra falha definitiva. Uma intenção pode permanecer UNKNOWN; bloqueios são por recurso/dependência e não por organização, com encaminhamento para suporte e sem garantia de resolução automática. Continuam explícitas as combinações de sessão/membership, MFA e F7 sustentadas por mecanismos partilhados/inspeção, sem execução PQ1 específica. Provas locais não validam produção, staging, IdP externo, conteúdo real, SLO ou acessibilidade integral. F13 integral permanece In Progress; não há READY, ativação ou avaliação F14.

Próximo passo: revisão read-only desta correção para nova decisão humana de fecho restrito.
