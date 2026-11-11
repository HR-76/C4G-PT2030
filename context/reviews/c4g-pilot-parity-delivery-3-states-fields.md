# Entrega 3 — revisão do incremento de estados e campos

2026-10-17. Implementação, ensaio e ativação autorizada no ambiente habitual concluídos; revisão visual com o utilizador pendente. A entrega 3 completa permanece **In Progress**.

## Resultado implementado

- Novas candidaturas no schema 027 começam em Identificada, privadas ou centrais, sem exigir Matching/perfil. Matriz confirmada de avanço/recuo, motivo e histórico; resultados após submissão e estados terminais preservados.
- Notas, prazo interno e dois orçamentos EUR opcionais, com decimais exatos e distinção entre zero e ausência. Edição por clientes antigos conserva campos omitidos; recibos antigos conservam a resposta original.
- Data do estado e último registo de submissão vêm do último evento pela revisão, mesmo com timestamps fora de ordem. Prazo civil não muda de dia no horário de verão.
- Campos extraídos de `ApplicationForm` e ficha extraída de `ApplicationDetail`, usados também no runtime atual. Mantidos os componentes de equipa/tarefas e revisão documental. Rótulos do catálogo e classificação dos estados abertos no Dashboard atualizados.
- Migração aditiva 027, sem reescrita de candidaturas, tarefas, histórico ou recibos. Schemas anteriores conservam o contrato anterior e recusam campos novos até atualização.

## Provas executadas

| Prova | Resultado |
| --- | --- |
| Build frontend | PASS |
| Testes frontend de candidaturas, tarefas, revisão e oportunidades | 34 PASS |
| Testes backend de contratos, paginação, resumos, tarefas e data civil | 13 PASS, incluindo `TZ=Europe/Lisbon` |
| PostgreSQL 17 — migração 026 → 027 | PASS: fingerprint, rollback transacional, dados antigos, recibos com projeção original, histórico e tarefas preservados |
| PostgreSQL — limites monetários e ordem de eventos | PASS: precisão inválida recusada na base; datas seguem revisão, não máximo cronológico |
| HTTP com duas organizações | PASS: 64 combinações de estados, criação privada/central, campos, CAS, rollback de auditoria, resposta incerta e isolamento |
| Chrome com PostgreSQL e identidades de ensaio | PASS: criar, editar/recarregar, repetir envio perdido, submeter/recuar/aprovar, tarefa preservada e acesso B recusado |
| Capturas | Formulário/detalhe a 1440, 1008 e 390 px; comparação interativa verificada no Chrome |

A matriz HTTP passou na execução longa. O primeiro percurso de browser excedeu a espera de 30 segundos na releitura de estado; a execução posterior, isolada, sincronizou a resposta da transição e verificou API/DOM com limite de 90 segundos. Não foi realizado um ensaio de desempenho. As capturas do formulário foram repetidas após aguardar o título da oportunidade e o fecho do menu móvel.

Scripts reproduzíveis: `test/integration/application-lifecycle/`. Provas visuais e `verification.json`: `output/playwright/c4g-application-lifecycle/`. [Comparação lado a lado](../../output/playwright/c4g-application-lifecycle/comparison.html). Referência: componentes originais do commit `3a79b25539040c2024051cf9ab6295680b760277` com dados simulados; O formulário/detalhe C4G usam persistência descartável; a lista foi atualizada com a captura da instalação habitual vazia. A comparação não representa aprovação visual do utilizador.

## Ativação habitual — concluída após autorização explícita

Inspeção prévia confirmou schema 026 e zero candidaturas/tarefas nesse ambiente. Após o utilizador responder «autorizo», foi executado `node backend/scripts/localPlatform/applicationLifecycle.js --apply`: backup protegido validado, schema 027 aplicado, preservação confirmada e snapshot de runtime atualizado. Privilégios temporários retirados; grants de utilizadores e base central conservados. Backup: `.tmp/local-platform/application-lifecycle-backup-1792270837162`. Prova: `output/playwright/c4g-application-lifecycle/local-upgrade.json` PASS.

A revisão automática tinha rejeitado a primeira tentativa por faltar autorização explícita para a migração irreversível. Essa tentativa não arrancou. A autorização posterior resolveu o impedimento; foi usado o mesmo comando preparado.

Backend reiniciado pelo watcher existente. `test/integration/application-lifecycle/native.cjs` PASS com a conta OIDC existente em localhost:3000: Pessoas, perfil pessoal, Matching, candidaturas, responsáveis e catálogo responderam 200. Lista e formulário central verificados no Chrome; campos de orçamento/notas/prazo e estado inicial Identificada presentes. Comparação de fingerprints antes/depois confirmou pessoas, perfis, candidaturas, tarefas, histórico e recibos inalterados. Zero escritas de negócio e zero erros de página. Capturas `native-list-1440.png` e `native-form-1440.png`; resultado `native-verification.json`.

O ensaio inicial fez uma consulta fora da fila do frontend durante o carregamento do catálogo e recebeu 503; passou após aguardar o carregamento inicial. Corrigido também o seletor do ensaio para distinguir o título da barra superior do título no conteúdo. A inspeção visual identificou sobreposição dos cabeçalhos da lista vazia: corrigida com quebra de linha nos títulos e largura mínima da tabela dentro do contentor com deslocamento horizontal. Build frontend repetido com sucesso. Nova passagem Chrome/OIDC PASS após a correção; lista capturada a 1440/1008/390 px, sem extravasamento horizontal da página. Não foi realizado ensaio de desempenho. As operações de escrita continuam comprovadas no ambiente descartável, sem criar candidaturas fictícias na instalação habitual.

## Limites do incremento

A lista já mostra novos estados, datas e orçamentos, mas a reposição integral das oito colunas, filtros/ordenação e contagens do piloto continua pendente. Parceiros e transporte real de anexos também permanecem por implementar. O painel documental existente foi preservado; não se declara upload/download produtivo concluído. A submissão é registo interno, sem envio ao financiador. Sem commit, push ou deploy.
