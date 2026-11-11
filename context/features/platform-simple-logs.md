# Logs simples da plataforma

Estado: Review. Pedido e implementação inicial em 18/10/2026; apresentação revista em 21/10/2026.

## Contrato

Página «Logs» na Administração C4G, apenas para administradores atuais da plataforma, sem exigir uma entidade selecionada. Tabela com utilizador (nome/email quando identificado), data/hora em Europe/Lisbon, tipo (entrada/erro) e descrição simples. Pesquisa por utilizador, filtro de tipo, paginação fixa de 15 eventos e atualização manual. A pesquisa, o filtro e a limpeza regressam à primeira página; os controlos Anterior/Seguinte respeitam os limites e indicam a página atual e o total de páginas. Texto explicativo redundante não permanece visível: limites relevantes do histórico ficam num ícone de informação junto ao título, acessível por rato, teclado e tecnologia assistiva. Sem dashboards, exportação, configurações ou eliminação de histórico.

Uma entrada corresponde ao login OIDC concluído. Renovação da sessão, mudança de entidade e step-up não são entradas novas. Não reinterpretar sessões antigas como logins. Histórico novo começa na ativação do registo; comunicar este limite na página.

Registar erros de autenticação reportados pelo controlador e respostas HTTP 5xx da aplicação. Mensagens fixas e códigos fechados, sem passwords, tokens, sessões, URLs, payloads, stack traces ou dados de candidaturas. Utilizador não autenticado aparece como «Não identificado». Não é um visor de logs internos do Keycloak nem de falhas do browser/infraestrutura fora da aplicação. Falha de recolha deve ficar explícita, sem impedir login ou duplicar respostas.

## Implementação e aceitação

- Registo central aditivo 026, persistente após reinício, sem alterações de contas/memberships/dados tenant. Runtime sem poderes de apagar/editar eventos.
- Leitura autorizada no servidor, com revalidação de C4G e sessão atuais; recusada a administradores/gestores/técnicos das entidades e anónimos.
- Captura do login reutiliza o hook existente; captura HTTP observa apenas estado final e identidade autenticada, sem inspecionar conteúdo.
- A API devolve no máximo 15 eventos por página, depois de aplicar pesquisa e filtro, numa ordenação estável por data e identificador decrescentes.
- O cabeçalho evita subtítulo e nota informativa permanentes; o tooltip preserva a data inicial do registo, o fuso horário e as exclusões conhecidas, com nome acessível e foco visível.
- Testes direcionados de autorização/revogação, paginação, captura e exclusão de segredos, prova PostgreSQL; frontend build e testes, revisão 1440/390.
- Backup privado e restauro verificado antes da migração habitual. Conferir login real e página local; erros artificiais apenas no ensaio isolado.

## Resultado e verificação

- `/administracao/logs`, menu C4G e `GET /api/admin/directory/logs` ligados. Leitura revalida sessão e administração atuais antes e depois da consulta. Filtros parametrizados, páginas de 15, ordem por data e identificador.
- Recolha pelo hook OIDC e estado HTTP final. Mensagens fixas, identidade central, datas em Europe/Lisbon. Sessões renovadas, mudança de entidade e step-up não geram entradas. A própria consulta de logs não gera eventos de erro, para evitar realimentação.
- Migração `026_platform_logs` verificada primeiro em PostgreSQL descartável. Histórico persistente; role `c4g_central_runtime` tem SELECT/INSERT, sem UPDATE/DELETE/TRUNCATE. Sem alteração de credenciais ou contas.
- Sete grupos de integração PostgreSQL PASS: login/captura/sanitização, HTTP, perfis de entidade e anonimato, paginação e reinicialização do serviço, permissões SQL, falha de recolha e revogação concorrente. 17 testes backend de regressão e 21 frontend PASS; build e sintaxe PASS.
- Backup privado central/tenant, restauro descartável e comparação de todas as tabelas dos schemas abrangidos PASS. Migração habitual aplicada; fingerprints de dados anteriores preservados. API, worker de catálogo e worker de adesão saudáveis.
- Chrome com conta administrativa local já existente: uma entrada por login, filtro/limpeza, acesso anónimo 401, capturas 1440/390 sem overflow e sem erros JavaScript. Nenhuma conta/entidade ou erro fictício criado no ambiente habitual.
- Revisão de 21/10/2026: teste unitário backend confirma limite e offset de 15; quatro testes direcionados do ecrã confirmam o total de páginas e a navegação; sintaxe e build frontend PASS. O gate PostgreSQL foi atualizado para 15/15/15/11 eventos em quatro páginas, mas não foi repetido nesta revisão por depender da composição isolada.
- Simplificação de 21/10/2026: removidos o subtítulo redundante e a nota permanente. Data inicial, fuso horário e exclusões permanecem num tooltip junto ao título, acessível por foco e descrito para tecnologia assistiva. Quatro testes direcionados e build frontend PASS.

Evidência: `output/playwright/c4g-logs/{service-verification,local-upgrade,native-verification}.json` e `native-logs-{1440,390}.png`. Instalação explícita local: `backend/scripts/localPlatform/logsSetup.js --apply`; o startup não migra bases. Rollback operacional: desativar `platformLogs` na configuração local e reiniciar, preservando o histórico; restauro apenas sob decisão explícita.

## Limites

Este é um histórico simples de suporte, não substitui auditoria de segurança nem captura erros internos do Keycloak, browser ou infraestrutura. Erros esperados 4xx de validação/permissões não entram como falhas técnicas. Os nomes/emails apresentados são os atuais da conta central. A captura é assíncrona para não impedir o login: fila limitada a 500 e timeout de cinco segundos; falhas ficam sinalizadas no processo e no ecrã. Uma interrupção abrupta pode perder eventos ainda em memória; não se promete entrega garantida. O contador de falhas de recolha reinicia com o processo. O ambiente habitual continua a usar a configuração local privilegiada anterior; os limites SQL foram comprovados com a role runtime na prova isolada, não constituem aprovação de produção.

Próximo passo: rever a página de logs com o utilizador.
