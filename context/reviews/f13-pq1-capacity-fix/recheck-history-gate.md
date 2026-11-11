# C-PQ1-01 — reconferência do gate de histórico

2026-10-17. **Resolvido no código atual; READY_FOR_HUMAN_REVIEW quanto a este gate.** A correção e as provas já existiam no início desta tarefa. Não houve nova implementação, execução de suites, PostgreSQL ou browser. Foram reconciliadas apenas referências documentais que ainda apresentavam o finding como bloqueador. Os fechos restritos e o trabalho posterior existentes são preservados; esta tarefa não declara novo fecho.

## Correção existente inspecionada

`editorialSource.editorialRevisions` percorre todas as revisões até ao número fixado pelo chamador, em lotes de 25. `loadEditorialRevision` consulta exclusivamente a revisão pedida. Os acumuladores temático/PQ1 mantêm a sequência, o draft, os digests, a autoria das alterações e remoções, os autores materiais e o submissor. Uma verificação isolada não transforma o verificador em autor. A aprovação e a publicação continuam a rederivar a autoria integral para a identidade exata.

O histórico acumulado não é um único artefacto publicado: deixou de ser clonado integralmente sob o teto de 256 KiB. Cada fonte, material, snapshot, resultado e identidade final mantém a canonicalização limitada. Não se corta histórico, não se divide o material para aumentar a capacidade admitida, nem se prolonga o deadline efetivo. O envelope de leitura de 1 MiB é distinto do limite do material.

## Correspondência conferida nesta tarefa

- `tested-scope.json`: **28/29** ficheiros coincidem byte a byte, incluindo todos os ficheiros produtivos do recorte.
- A única divergência é `test/integration/f13/pq1-consolidated-http.js`, SHA256 atual `2fe6ba7641bb4727def0b5d57f9505d96774d3d9153d215f59d0d7874a3b9fcf`. Removendo apenas em memória o ramo posterior `PQ1_PHASE === 'application-link'`, obtém-se exatamente o hash testado `f63a9683c958658864c3f89706234a0919f7d9d1fd9e35b6377243f4ca28de90`. Não se alterou o ficheiro. As fases de capacidade, bytes e histórico permanecem iguais.
- `artifact-hashes.json`: **29/29** artefactos coincidem; logs, imagem, manifesto e resumo anteriores preservados.
- Estes manifestos não cobrem a identidade integral do runtime atual. Existem extensões transversais posteriores para candidaturas, fora do recorte. A reutilização prova a correção de capacidade e os percursos registados; não equivale a uma nova execução integrada de todas essas extensões.
- Inspeção e reconstrução de hashes das dependências identificaram admissão adicional de 021/022 e ramos exclusivos de candidaturas em autorização, execução e recuperação; sem alteração dos algoritmos PQ1 de histórico, canonicalização, limites, locks ou deadlines. O manifesto já inclui a migration 023 do incremento de candidaturas em curso, enquanto as operações inspecionadas admitem até 022. Esta combinação não é certificada pela prova histórica; a admissão posterior é uma pendência externa a C-PQ1-01, observada por inspeção, não uma falha executada nesta tarefa.
- Inspeção distingue os testes unitários com cliente simulado dos harnesses executados sobre PostgreSQL real. As asserções e os logs abaixo foram lidos; os resultados são históricos reutilizados, não reexecutados.

## Evidência reutilizada

| Prova | Resultado registado |
| --- | --- |
| [Capacidade conjunta](capacity-full-final.txt) | 205 revisões, 11 722 539 bytes históricos, 9 lotes; revisão 1 consultável. Snapshot de 242 841 bytes com 2 items e 100 competências, experiências, ligações e verificações. Publicar → ativar → avaliar → consultar → decidir → histórico PASS. Combinação de 100 em todas as coleções recusada por excesso canónico, sem publicação parcial. |
| [Fronteira de bytes e browser](bytes-browser-final.txt) | Snapshot de exatamente 262 144 bytes utilizável; +1 byte recusado sem snapshot/ativação adicional. Publicação preservada. Browser integrado, 30 decisões em duas páginas, A/B e recuperação da intenção original PASS. |
| [Histórico paginado](history.txt) | 53 decisões em três páginas e inserção entre páginas, sem omissões/duplicações; ativações paginadas, snapshot antigo e isolamento A/B PASS. |
| [Regressão de limites](material-limits-final.txt) e [suite backend](backend-final.txt) | Limites, autoria e estados preservados; suite histórica 851/851 PASS. Testes unitários não substituem PostgreSQL/browser. |

## Limites e decisão

Nenhum blocker de capacidade do histórico identificado. As medições locais não garantem histórico ilimitado, throughput ou SLO; o orçamento transacional continua a recusar operações que não terminem a tempo. Não se reduziram proteções para admitir o material.

Mantêm-se UNKNOWN sem resolução automática garantida, bloqueio limitado das operações dependentes, 503 sem prova de rollback e encaminhamento para suporte. Provas locais com IdP sintético não validam staging, produção, IdP externo, dados reais ou armazenamento/antivírus externos. A matriz anterior continua a distinguir execução específica de mecanismos partilhados e inspeção.

Nesta tarefa: conferência de hashes, inspeção direcionada e revisão de diff/whitespace documental. Sem alterações de código, migrations, testes, evidência histórica, índice ou commits; sem stage, commit, push ou deploy. F13/F14 integrais não são declarados Complete.

Próximo passo: revisão humana restrita do percurso ativar → avaliar → explicar → decidir → consultar histórico, usando a [matriz de evidência e pendências](README.md).
