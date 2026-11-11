# Parceiros — desenho do adaptador SQL candidato

Data: 27/10/2026. Estado: **Review, desenho sem integração**. [Desenho, algoritmo e fontes primárias](../../research/partner-sql-adapter-design.md), [contrato existente](../../features/partner-sql-pagination.md).

## Resultado

Recomendado um portal PostgreSQL `NO SCROLL WITHOUT HOLD` na transação/client preparados atuais, com FETCH de 100 candidatos e sentinela de um. A mesma seleção fixa os dados entre lotes; o percurso atual continua a decidir acesso por recurso e a concluir auditoria/guard antes da resposta. A mudança temporal de várias capturas para uma captura dos dados está explícita no desenho e exige prova antes da integração.

Ordenação, pesquisa, países, projeção, digest e cursor v1 continuam em Node. Isto preserva a semântica em vez de a aproximar com uma collation SQL ou um novo fingerprint. **O candidato ainda percorre todos os candidatos e mantém projeções autorizadas em memória; não entrega paginação SQL integral de 25 itens.** Não há ganho de desempenho declarado.

O desenho define SQL parametrizado pela organização, identificador interno do portal, precedência dos erros, sentinela após as primeiras 10000 autorizações, fecho/rollback, ausência de fallback e gates de compatibilidade, concorrência, revogação, cleanup e capacidade. Não é uma decisão de arquitetura aceite implicitamente.

## Evidência local e validação

- Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline anterior às edições: **2556 entradas no worktree, 30930 ficheiros inventariados**. O trabalho existente foi preservado.
- Node v24.13.1 / ICU 78.2: três pares NFC com bytes distintos comparam como iguais em português. Com IDs inversos, desempatar por bytes inverte a ordem relativamente ao comparator atual. É uma observação Node e simulação do desempate por bytes, **não uma medição PostgreSQL**. [Observações](observations.json).
- Digest legado reproduzido: 26 projeções, 15289 bytes UTF-8, SHA-256 `ac97db797317226f80c125e8770f8250ae6432b8333f0a565fe1eb7273361e21`.
- Testes focados existentes reexecutados neste turno: **31 PASS, 0 FAIL, 0 SKIP**, incluindo contrato HTTP, cursor, autoridade e fronteira 10000. Comando abaixo. Não foram adicionados testes ou código de aplicação neste turno.
- Última suite completa, executada no incremento anterior: backend **1369 PASS / 0 FAIL / 7 SKIP**; frontend **346 PASS**, build **PASS**. Não reexecutada neste turno de documentação; não apresentar estes números como nova execução. [Registo anterior](../partner-sql-pagination-contract/verification.json).
- Nenhum PostgreSQL, DECLARE/FETCH/CLOSE, gate RLS, writer concorrente ou medição SQL executado. A viabilidade do encaixe no executor é evidência estática; a equivalência do candidato continua por provar.
- Revisão independente estática concluída, sem bloqueadores no algoritmo. Incorporadas duas precisões: gate exige READ COMMITTED, e hits da cache conservam a decisão e verificam o guard sem nova consulta de equipa. O orçamento de 10 s também não é apresentado como prova da duração física do cleanup.

```powershell
# Em backend/
node --experimental-test-isolation=none --test test/applicationPartners.test.js test/partnerBrowseBoundary.test.js test/partnerPaginationContract.test.js test/partnerPaginationHttpContract.test.js
```

## Alterações e limites

Ficheiros deste incremento:

- `context/research/partner-sql-adapter-design.md` — desenho, alternativas, fontes, custos e gates.
- `context/features/partner-sql-pagination.md` — ligação e enquadramento da recomendação.
- `context/current-work.md` — estado ativo e continuidade.
- `context/reviews/partner-sql-adapter-design/README.md` — este relatório.
- `context/reviews/partner-sql-adapter-design/observations.json` — observações locais reproduzidas.
- `context/reviews/partner-sql-adapter-design/verification.json` — resultados e conferência de preservação.

Não foram corrigidos defeitos de runtime nem adicionados testes de regressão neste incremento. Foram resolvidas as escolhas de desenho para os três bloqueios: manter a collation JavaScript, conservar exatamente o material do digest e capturar os dados num portal. A semântica temporal proposta exige aceitação e testes antes da integração.

Medições antes/depois: não aplicável, porque não há implementação. Contagem teórica para 10000 candidatos: scan/schema **102 → 104** comandos, mantendo autoridade/auditoria à parte. O portal acrescenta DECLARE/CLOSE; memória global, bytes transferidos, custo das autorizações e desempenho continuam pendentes. Pessoas históricas inativas podem aumentar bodies brutos, e o plano PostgreSQL pode materializar dados. O gate deverá medir estes custos dentro da lease atual.

A verificação compara metadados de todos os ficheiros inventariados com a baseline; não é um snapshot externo das bases. Só foram editados os seis ficheiros de contexto listados. **Migrations, grants/permissões, dados Dev, configurações, dependências e código de aplicação/testes não foram alterados.** Não houve commit, merge, push ou deploy. As sete exclusões da suite completa anterior permanecem registadas separadamente; não houve falha nos testes deste turno.

**Próximo passo:** implementar um protótipo separado do runtime ativo, começando pelos testes do protocolo do portal e pelos contraexemplos documentados; depois preparar a prova PostgreSQL isolada, antes de qualquer integração.
