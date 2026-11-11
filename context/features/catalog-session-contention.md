# GCNI — esperas e renovação de sessões
Estado: Review. Pedido explícito de 01/11/2026; apenas ensaio isolado, sem fontes nem promoção.

## Critérios
1. Medir pool, admissão, lock, verificação sob lock e renovação, incluindo trabalho após cabeçalhos; agregados sem identificadores e sem alterar erros/retornos.
2. Baseline instrumentada antes da correção; não misturar preparação, aquecimento e carga medida. Preservar dados brutos e limites.
3. Corrigir apenas contenção comprovada; conservar membership fresca, expiração idle/absoluta, revogação, locks de escrita, grants, ledger, proteção de snapshots e dados atuais. Sem cache de decisões de autorização.
4. Opções novas de comportamento limitadas à composição isolada explícita; testes de concorrência, falhas e revogação antes da correção; suites completas, build e aceitação real local.
5. Repetir27/10000 oportunidades, tabela/ficha,10 concorrentes,5 séries de10,10 aquecimentos/cenário, pools de catálogo e membership com 2 ligações. Zero erros e p95<=500ms em cada série para aprovação. Reportar eventual reprovação sem alterar meta.
6. Autorrevisão, limpeza própria e exposição OFF; não certificar IdP externo ou SLA produtivo.

Execução: instrumentação, correção e carga final concluídas; ver resultado abaixo.

## Correção candidata a validar após medição
Se comprovada duplicação de renovações, agrupar apenas pedidos autenticados com mesmo SID e auth integralmente igual enquanto a transação ainda espera pela admissão/lock. Fechar o grupo antes de ler a sessão atual e validar a revogação; chegadas posteriores fazem nova renovação. Sem intervalo temporal de cache e sem guardar resultado concluído. Limitar grupos pendentes a256; saturação, anónimo, legado ou auth diferente usam o percurso original. Propagar falhas a todos os participantes, remover o grupo em falha/conclusão e preservar os dados atuais, limites físicos/absolutos e writer exclusivo. Exigir regressões antes de aplicar.

## Resultado
Funcional PASS; carga NOT_ACCEPTED. Ver histórico `context/history/catalog-session-contention-2026-11-01.md`. Meta500ms preservada. Próximo passo: otimizar as consultas de admissão do esquema e das permissões, mantendo a validação fresca por pedido, e repetir a carga isolada.
