# GCNI — custo por fase e correção da carga durável

Estado: Review — desempenho ainda não aceite. Pedido autorizado: medir autenticação, controlos e leitura, corrigir o ponto limitante sem reduzir segurança e repetir a carga isolada.

## Critérios
1. Instrumentação explícita do ensaio, sem identidades ou tokens: pré-router/autenticação, membership, política durável, repositório/verificação e restante tempo. Sem cache de decisões de acesso; observadores não alteram o resultado.
2. Baseline instrumentada antes de corrigir, com o mesmo OIDC local e pools de duas ligações; perfil de 27 oportunidades serve diagnóstico, não aprovação de capacidade.
3. Alterar apenas o ponto sustentado pela medição. Preservar membership fresca, verificação final, versão/lease, revogações, identidade limitada, fingerprints/ledger, locks, transações e limites de payload/conexões.
4. Regressão antes da correção, suites backend/frontend e build; gates aplicáveis e aceitação OIDC durável repetida. Carga final completa: 27/10000 oportunidades, lista/ficha, 10 concorrentes, 5 séries de 10 e 10 aquecimentos por cenário; zero erros e p95 <=500 ms em cada série.
5. Evidência antes/depois com limites de comparação explícitos; revisão, OFF final e limpeza própria. Nenhuma promoção, fonte ou serviço externo ativado.

Próximo passo: medir as esperas de bloqueio e a renovação de sessões, corrigir a contenção demonstrada e repetir a carga isolada.

## Refinamento confirmado pela análise
A consulta exata de sessão é serializada pelo lock exclusivo global, embora seja apenas leitura. Ensaiar, mediante opção explícita vinculada à capacidade de admissão isolada, BEGIN READ ONLY e lock partilhado para essa única consulta. Preservar o mesmo lock exclusivo para escritas, touch, restantes SELECTs e callbacks. A verificação de segurança continua depois da aquisição do lock. Exigir prova PostgreSQL de duas leituras simultâneas, escritor bloqueado, recusa de escrita na transação de leitura e leitura posterior à remoção sem sessão. Sem alteração de migrações ou ativação habitual.

## Contrato imutável do pacote
A instrumentação e revisão identificaram ainda recálculo síncrono de 46 ficheiros SQL (811398 bytes) em cada admissão: 7,5–12 ms por recálculo nesta máquina, bloqueando o event loop sob concorrência. Fixar exatamente os hashes já aceites num contrato JSON versionado, verificar ficheiros e manifestos ao carregar a composição e manter a consulta do ledger da base em cada admissão. O instalador de migrações mantém a validação de ficheiros em cada execução. Mudanças posteriores aos ficheiros SQL não podem alargar o conjunto permitido pelo processo em execução; alterações de pacote requerem novo artefacto e reinício. Não se guardam decisões de autorização, snapshots de metadados ou resultados de admissão da base.

## Resultado do incremento
Instrumentação, correções e carga final executadas. Run 94f5668f52794405aea70d7341c734ef. Funcional PASS; carga NOT_ACCEPTED, sem mudança da meta de 500 ms. Backend 2479 PASS / 7 SKIP; frontend 580 PASS, build PASS; PostgreSQL 36 PASS. Ver histórico `context/history/catalog-read-performance-phases-2026-11-01.md`.
