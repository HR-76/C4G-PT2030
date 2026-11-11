# Entrega 4 — recuperação da importação Portugal 2030

18/10/2026 · Review. Preparação implementada e verificada; ativação/importação real pendentes por decisão do utilizador. Entrega 4 global continua em curso.

## Resultado e âmbito

Recuperada a composição de `Import.jsx` do piloto (`2fa3b1c`): zona de ficheiro, resumo da pré-visualização, tabelas, ações e histórico. Mantidos identidade C4G e contrato XLSX F12. O utilizador confirmou «Manter configuração para o final; preparar o percurso agora». Não foram configurados R2/antivírus nem ativado o runtime de importação.

- Escolha explícita de folha, correspondência de colunas e decisões sobre colunas desconhecidas. Pré-visualização distingue válidas/erros e não cria oportunidades. Link para o Excel oficial substitui o template legado; não chama o backend antigo.
- Resultado por linha, contadores, duplicados exatos, revisão humana de possíveis duplicados, links para oportunidades privadas, cancelamento, atualização manual e relatório CSV. Histórico permite retomar upload/pré-visualização.
- Página limpa o estado ao mudar organização/utilizador e descarta respostas tardias, pedidos encadeados e downloads desse contexto. Ações pendentes bloqueiam concorrência na página; upload de resposta incerta repete ficheiro/requestId. Erro de histórico nunca é apresentado como histórico vazio. Mensagens respeitam MFA por escolha individual.
- Corrigidas datas civis Excel (incluindo época 1904), preservação da linha física e deteção de fórmulas após linhas vazias. Worker e criação por revisão conferem os bytes contra o digest do original aprovado.
- Mapeamento versão 2 inclui `parserVersion: portugal2030-civil-physical-v2`: uma confirmação antiga não autoriza silenciosamente outra interpretação. Jobs com digest de mapping antigo falham antes de criar novas linhas; originais, resultados e histórico conservam-se. Antes da ativação em qualquer ambiente com imports preexistentes, inventariar jobs antigos e definir revalidação/reconciliação; não os reescrever automaticamente.
- GET `/api/imports/:id` devolve adicionalmente `sheets` para UPLOADED/READY_FOR_CONFIRMATION, após autorização e leitura privada com verificação de integridade. Rotas e argumentos do cliente existentes mantidos. Sem migrations, grants, alteração de tenancy ou publicação no catálogo comum.

## Verificação

| Prova | Resultado |
| --- | --- |
| Backend direcionado | 33 PASS: parser, fluxo, HTTP, entrypoints, autoridade worker e ausência de efeitos ao importar módulos |
| Frontend | 11 PASS: indisponibilidade, validação, decisões, repetição, resposta tardia, contexto, retoma, confirmação e resultado |
| Build frontend | PASS |
| Sintaxe JS alterado e scripts de validação | PASS |
| PostgreSQL descartável, API e worker reais | PASS: duas organizações, preview sem criação, EXACT/POSSIBLE/DISTINCT/INVALID, outbox/pg-boss/inbox, commit incerto, repetição, cancelamento, rollback F7/F11, revogação e zero queries legacy |
| Excel oficial | 177 linhas válidas, zero erros e zero identificadores repetidos; resultados idênticos em UTC, Lisboa e Los Angeles |
| Chrome OIDC habitual | Página real devolve 503 NOT_CONFIGURED, envio desativado, explicação visível; nenhuma importação real |
| Browser com HTTP de ensaio | Ficheiro → folha → decisão sobre coluna → validação → confirmação → resultado → revisão → CSV; 1440/390 px, zero erros de página/overflow global |
| Preservação | Fingerprints do catálogo central e negócio tenant iguais antes/depois; zero escritas de negócio reais pelo browser |

O teste PostgreSQL detetou uma lista desatualizada de migrações esperadas na fixture partilhada. Foi atualizada explicitamente para incluir 017/018, mantendo as asserções de rollback e preflight; o gate foi repetido. Não se alteraram migrações aplicadas nem dados reais.

Provas: [backend](../../output/portugal2030/backend-tests.log), [frontend](../../output/portugal2030/frontend-tests.log), [build](../../output/portugal2030/frontend-build.log), [PostgreSQL](../../output/portugal2030/postgresql-validation.log), [browser](../../output/playwright/c4g-portugal2030/native-verification.json), [Excel oficial](../../output/portugal2030/official-verification.json).

## Fonte e comparação

O [Plano Anual de Avisos oficial](https://portugal2030.pt/plano-anual-de-avisos/) apontava para o [XLSX de 14/09/2026](https://portugal2030.pt/wp-content/uploads/sites/3/2026/09/PlanoAnualAvisos_download_140926-1.xlsx). Ficheiro descarregado: 65.667 bytes, SHA-256 `f5d81e3a2fcf31fac5b4545a4e7625c9f0c22333f28cc301ad4b61a7845f5869`, folha `Sheet1`, cabeçalho físico na linha 2. A página pública indicava 172 avisos, enquanto o ficheiro contém 177 linhas: a prova reporta o ficheiro exato e não presume sincronização do site nem abertura/eligibilidade dos avisos.

[Comparação lado a lado](../../output/playwright/c4g-portugal2030/comparison.html). Capturas inspecionadas: composição do piloto reconhecível, marca C4G, tabelas completas sem corte de ações/texto e navegação móvel com scroll dentro das tabelas. Ensaio de resultado com três linhas válidas e uma inválida identificado como simulado. Não se infere aprovação visual do utilizador.

## Pendências e veredicto

Preparação pronta para revisão visual. **Fecho operacional bloqueado por verificação real adiada pelo utilizador:** falta compor armazenamento privado UE/antivírus e inspeção documental F11 com API/worker de importação, validar original/relatório e executar uma importação autorizada na instalação habitual. O backend habitual continua com imports desativados; as correções ficam preparadas no código. Fixtures e PostgreSQL descartável não validam os fornecedores externos. Não declarar esta fatia ou a entrega 4 concluídas.

Próximo passo: recuperar e verificar os alertas existentes, mantendo a configuração documental para o final.
