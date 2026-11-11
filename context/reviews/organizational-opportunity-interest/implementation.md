# Interesse organizacional — implementação e validação local

**Atualização final de 30/10: ativado e retomado no ambiente habitual.** [Migrações, permissões, correções HTTP e provas finais](activation-completed.md). O estado pendente referido na avaliação inicial abaixo foi superado.

Data de trabalho: 30/10/2026. [Contrato funcional](../../features/organizational-opportunity-interest.md) e [contrato HTTP](../../references/opportunity-interests-http.md). Estado: código implementado e integração PostgreSQL isolada aprovada; ativação no ambiente habitual pendente.

## Resultado

- O catálogo regista um interesse privado da organização, com zero ou várias unidades, sem criar candidatura. Lista, detalhe, notas, arquivo e histórico usam um agregado próprio, recibos idempotentes e revisão concorrente.
- Administradores, gestores e técnicos têm regras explícitas de sinalização; consulta apenas lê. Gestão e abertura de candidatura exigem as permissões correspondentes. Unidades não concedem acesso nem adicionam pessoas à equipa.
- Abrir candidatura é um passo posterior: título sugerido e unidades do interesse são apresentados para revisão. Responsável, prazo interno, orçamentos e inclusão na equipa continuam explícitos. A revisão observada pelo interesse é conservada; a candidatura confirma a revisão atual da fonte.
- Associações da candidatura são independentes. Filtros diretos e «Sem unidade atribuída» usam EXISTS e não multiplicam as contagens. Facetas históricas respeitam a autoridade e equipa da candidatura. A métrica anterior de reporting pela unidade do responsável mantém a sua definição.
- Armazenamento indisponível, reenvio, respostas tardias e Voltar/Cancelar têm recuperação e contexto preservados. O browser guarda apenas a intenção de envio, por utilizador/organização; o registo funcional pertence ao tenant.

## Código principal

Backend: `src/opportunityInterests/`, `routes/opportunityInterestRoutes.js`, extensão de `applications/`, catálogos de autorização/auditoria e composição produtiva. Frontend: `pages/Interests/`, catálogo, formulário/lista de candidaturas, API e limpeza de intenções no fim da sessão.

`033_organizational_opportunity_interests.up.sql` é uma migração aditiva. Inclui agregado, associações de unidades, histórico, recibos, referências opcionais na candidatura, FKs por organização, RLS forçada, guardas de arquivo/imutabilidade, ACL restrita e três eventos F7. Não converte `organization_opportunity` nem reclassifica candidaturas antigas. Está registada no manifest com o fingerprint medido no ensaio isolado.

## Verificação local

- Frontend: suite completa 461 PASS; build PASS.
- Backend: suite completa 1775 PASS, 1 FAIL preexistente e 7 SKIP. A falha é `fundingEnrichmentPersistence.test.js:33`, «enrichment discovery defers every new identity until its complete known lookup», já observada no diagnóstico e fora dos ficheiros deste incremento.
- Foram reproduzidas antes da correção regressões de armazenamento, resposta tardia, navegação, modal após alteração de filtros, perda de notas no retry e conservação de vínculos a unidades arquivadas.
- Revisão cruzada corrigiu a validação SQL do par interesse/revisão, o alinhamento dos eventos de auditoria nas constraints da base e a leitura conjunta das unidades apenas para as candidaturas autorizadas da página. O gate usa append F7 real; os testes unitários não são tratados como prova PostgreSQL. Os três testes puros da preparação do gate passaram.
- Reenvio após resultado incerto seguido de conflito definitivo permite corrigir os dados; recusas de acesso no reenvio conservam a pendência, pois não provam ausência de efeito. Sete casos novos passaram. O formulário manteve os testes anteriores.
- Chrome real com respostas API sintéticas: 12 capturas inspecionadas em 1440 e 390 px. Percurso catálogo → registo com duas unidades → análise → abertura de candidatura preenchida; consulta apenas lê. Sem overflow, erros JavaScript ou API inesperada; teclado e retorno dos filtros verificados. O corte de caminhos longos teve RED→GREEN. Browser e servidor efémero foram encerrados.
- Sintaxe dos 24 ficheiros JavaScript de backend/gate e `git diff --check` do âmbito passaram. Build final após correções visuais passou.

Artefactos em `output/organizational-opportunity-interest/`: `backend-after-pg-final.log` (1783 casos: 1775 PASS, 1 FAIL, 7 SKIP), `frontend-suite-final.log` (461 PASS), `browser-verification.json`, harness sintético e 12 PNGs. Build final confirmado. Nenhuma escrita numa API real.

## PostgreSQL isolado autorizado — 30/10/2026

O [gate preparado](../../../test/integration/opportunity-interests/README.md) tem duas fases: medição da candidata dentro de uma transação revertida; depois, com fingerprint medido registado, verificação pelo runner/preflight original em nova base descartável, login runtime independente, concorrência e replay por nova ligação. Os testes de invocação/descritor são puros e não criam infraestrutura.

O utilizador autorizou explicitamente as duas fases. PostgreSQL 17.11 com imagem já instalada, porta loopback efémera e dados sintéticos. Medição: **13 checks PASS**, em `output/opportunity-interests-pg-18dd7a60568347909046310933cfb3b9/verification.json`. Verificação pelo runner/preflight original: **15 checks PASS**, em `output/opportunity-interests-pg-82f934d2a9c94c648d4017997129fc13/verification.json`. Todos os contentores das tentativas foram removidos com confirmação por ID/nome/label; nenhum recurso habitual foi alterado.

O primeiro ensaio reproduziu erro `22P02` na validação das novas FKs sobre candidaturas preexistentes, com RLS forçada e um setting organizacional vazio de uma ligação reutilizada. A migração passou a validar essas duas FKs como owner com NO FORCE temporário, sob o ACCESS EXCLUSIVE já adquirido, e a repor FORCE antes de terminar a mesma transação. A validação final confirma RLS forçada; não existe janela externa sem proteção. O ensaio de rollback confirmou o schema032, ledger e registos anteriores exatamente iguais. Na segunda fase, foi corrigida uma expectativa da fixture que supunha escala monetária `0.00`, comparando agora com o valor original exato.

Fingerprint registado: `d3526c7287fade9a1009ce223be8d36769c38b9345f89e9c72180cb940c793bc`; checksum SQL: `62f725ea391fc75a3f49bc7ddd886347cbdb7efc5c0a992e3a85ffc57cc4b0ed`. Provas reais: upgrade idempotente, preservação de candidatura/recibo anterior, login runtime sem superuser/BYPASSRLS/ownership, isolamento A/B, guardas de unidades, conversão atómica, histórico/arquivo, rollback após append F7 e duas gravações concorrentes com replay numa nova ligação.

O gate declara as portas sintéticas de autoridade/catálogo/responsável; não substitui a integração HTTP/OIDC produtiva. A aplicação de schema e grants no ambiente pretendido continua a exigir âmbito próprio. A feature não está marcada como Complete nem anunciada como operacional no ambiente atual.

Não houve commit, merge, push, deploy ou alteração de bases/contas/grants habituais. SQL aplicado apenas às bases descartáveis autorizadas. Trabalho preexistente e não relacionado foi preservado. A manutenção administrativa central de oportunidades continua no incremento complementar AC-15.

Preparação posterior autorizada em30/10: [plano de ativação](activation.md). Consulta READ ONLY encontrou tenant030 físico canónico com ledger histórico recusado; a passagem isolada032→033 não autoriza ignorar essa diferença. Plano de grants mínimo e ferramenta exclusivamente de preparação concluídos, com cinco testes PASS. Ambiente habitual preservado; execução ainda bloqueada pelas condições descritas no plano.

## Resultado atualizado — compatibilidade e ensaio 030 → 033

Em 30/10/2026, o pedido foi concluído: **19 checks PASS**, cleanup confirmado. Relatório: `output/opportunity-interests-pg-eac59665ab194914b0e9b8c9ec8f642f/verification.json`.

O prefixo histórico exato de 30 entradas é reconhecido sem reescrever o ledger. Entradas posteriores continuam integralmente validadas. O preflight mantém a verificação do schema físico, ownership e ACL/RLS. Corrigida também a seleção imutável do manifest no preparador.

O runner original aplicou031/032/033; repetição sem efeitos. Uma falha injetada antes de033 desfez031/032, dados e ledger. Drift físico e corrupção histórica foram recusados. Todas as colunas das 30 entradas históricas, incluindo timestamps, e os dados anteriores inventariados foram preservados. A reconstrução do ledger histórico acontece apenas na construção inicial da fixture sintética descartável, antes da baseline de preservação; não é um procedimento de reparação do ambiente habitual.

Reconsulta habitual READ ONLY: preflight PASS; schema030, fingerprint, digest do ledger, contagens/digests inventariados, autoridade Central e digest da configuração runtime iguais à observação anterior. Recibo privado: `.tmp/local-platform/opportunity-interest-historical-recheck.json`. Status: `PREPARED_DEPENDENCIES_IDENTIFIED`. Nenhuma migração, grant ou reinício aplicado.

Regressões RED→GREEN; foco histórico/gate/preparador 14 PASS. Backend 1783 PASS, 1 FAIL preexistente em `fundingEnrichmentPersistence.test.js:33`, 7 SKIP. Frontend 461 PASS; build PASS. Logs: `output/organizational-opportunity-interest/*-historical.log`.

Próximo passo: preparar backups protegidos e verificar o restauro isolado antes da ativação autorizada.
