# Entrega 1 — identidade e navegação C4G

2026-10-17. **Review — implementação visual pronta para revisão; sem fecho humano ou validação produtiva.** Execução explicitamente solicitada pelo utilizador a partir de `context/features/c4g-functional-recovery-plan.md`.

## Resultado

- Login, sidebar, título HTML, manifest e referências de ícones usam C4G. Reutilizado `frontend/public/logo-c4g.png`, sem redesenhar marca nem eliminar assets UBI.
- Tokens provisórios semânticos C4G, navegação verde-petróleo, superfícies claras, ação verde com contraste reforçado e aliases para componentes existentes. Estilos de shell isolados em `frontend/src/c4g-shell.css`.
- Modo F12: menu dividido em trabalho diário, organização, ferramentas de qualificação e plataforma. Catálogo comum, oportunidades privadas, matching e candidaturas continuam identificáveis. Importação privada deixa de depender da presença do menu ADMIN; a API continua a autorizar cada operação.
- Fontes centrais visíveis apenas com assignment `C4G_ADMIN`, preservando a guarda de rota existente do trabalho Funding Tenders. Nenhum novo grant, role ou permissão inferida para organizações.
- Organização ativa permanece visível no cabeçalho; redirecionamentos de rotas não autorizadas/desconhecidas no modo F12 regressam a oportunidades, em vez do perfil legacy.
- Salto para conteúdo, foco/menu móvel preservados e tratamento de movimento reduzido no login.

## Disponibilidade, sem esconder limitações

O shell F12 não monta páginas que ainda consultam o modelo legacy: Dashboard, matching, parceiros, perfil pessoal, notificações, utilizadores/investigadores/áreas/centros e detalhe `/legacy`. Mostra “Em integração”, explica o limite e oferece catálogo/candidaturas. Esta escolha implementa o estado de indisponibilidade previsto no plano; **não entrega matching, Dashboard ou alertas multi-tenant**. Esses módulos continuam obrigatórios nas entregas seguintes.

As rotas e o comportamento do runtime legacy permanecem no código e continuam acessíveis nesse modo. O catálogo central e as candidaturas F12 não são substituídos por placeholders. A barreira de apresentação não é uma correção de segurança dos endpoints legacy: autorização e segregação backend continuam a exigir revisão própria. Não foram alterados serviços/backend, schemas, grants ou recolhas nesta entrega.

Os grants finos não são disponibilizados ao shell pela sessão atual. Por isso, não se inventou deteção de capacidades nem administração organizacional completa. A UI separa o assignment de plataforma conhecido; formulários funcionais existentes continuam sujeitos à resposta autoritativa da API. A administração de acessos tenant e alertas universais não estão concluídos por esta alteração de menu.

## Ambiente identificado nesta execução

| Componente | Observação efetiva | Limite |
|---|---|---|
| Frontend ativo | `http://localhost:3100`; HTTP 200, título C4G Funding Platform e CSS novo servido | Processo preexistente preservado; não foi iniciado outro servidor funcional |
| API ativa | `http://localhost:5000`; `/health/ready` 200 READY | Health não prova cada percurso funcional |
| Bases vistas pela API | `/health/db` 200; central e legacy healthy | Nenhuma credencial, destino interno ou versão de tenant exposta/consultada nesta execução |
| Sessão | GET anónimo `/api/auth/session` 401 SESSION_REQUIRED | Sem login real ou alteração de sessão nesta tarefa |
| PostgreSQL de integração | Listeners loopback 5441/5442 observados | Não se presume que sejam todas as bases do processo ativo |
| Worker | Não identificado/verificado nesta tarefa | Não iniciado, parado ou configurado; a evidência do catálogo tem âmbito próprio |
| `.env.local` | Não usado para reconfigurar processos | A análise anterior já mostrou que o ficheiro não prova o ambiente efetivo |

Para rever o visual no ambiente existente, abrir `http://localhost:3100` e atualizar a página. O login real depende da configuração OIDC já existente. Não executar seeds, migrations, resets ou arrancar outro backend como parte desta revisão visual. O build não foi publicado/deployed.

## Validações executadas

| Prova | Resultado e âmbito |
|---|---|
| `npm run build` em frontend | PASS; repetido após correção visual final |
| `npm test -- --reporter=dot` em frontend | **96/96 PASS, 18 ficheiros**; inclui 5 testes novos de shell. Warnings existentes de React Router/jsdom e erro sintético esperado do teste de lazy load não foram falhas da suite |
| `node test/integration/mobile-navigation.cjs` | PASS; Tab/Shift+Tab, skip link, foco contido, Escape, retorno de foco, resize desktop/móvel; sessão sintética |
| `node test/integration/lazy-routes.cjs` | PASS; build, import a pedido, navegação e guarda antes de carregar módulo administrativo; API sintética |
| `node test/integration/c4g-shell.cjs` | PASS sobre build final; branding, organização ativa, menu por assignment, catálogo preservado, nenhuma consulta legacy de matching/professores/notificações, overflow móvel e login; API integralmente simulada |
| Inspeção visual | PNGs desktop/móvel efetivamente inspecionados. Corrigidos captura durante animação com movimento reduzido e apresentação do botão de fechar menu |
| Contraste calculado | Botão principal/branco 5,62:1; texto navegação/fundo 6,34:1; texto principal/branco 15,29:1; secundário/branco 7,59:1. Não é auditoria WCAG integral |
| `git diff --check` do âmbito tracked | PASS; avisos de normalização LF/CRLF, sem erros de whitespace |

Build/testes inicialmente impedidos pelo sandbox (`spawn EPERM`), depois executados com elevação autorizada pela ferramenta. O browser interativo CUA não estava disponível; os testes acima executaram Chrome headless isolado como regressões automatizadas, sem usar sessões reais ou escrever nas bases.

## Capturas

Capturas de teste, com organização e utilizador **sintéticos**; não são prova de conteúdo real do catálogo:

- [Login desktop](login-desktop.png)
- [Login móvel](login-mobile.png)
- [Catálogo desktop](catalogo-desktop.png)
- [Menu móvel](menu-mobile.png)
- [Matching — disponibilidade explícita](matching-availability.png)

## Preservação e pendências

O worktree já continha alterações extensas e continuou a receber trabalho do catálogo. Foram feitos patches focados no frontend e nos testes de shell, sem substituir ficheiros por versões do Git. O estado de Funding Tenders evoluiu por outra tarefa e não foi alterado por esta entrega. Sem commit, push, deploy, migrations, seeds, recolha externa ou mudança de dados.

Pendências: revisão humana do visual; confirmação autenticada no ambiente de demonstração e inventário operacional do worker/tenants sob a tarefa própria; acessibilidade integral fora deste recorte; restantes entregas funcionais do plano. Os ícones reutilizam o logótipo raster existente: uma variante oficial quadrada poderá melhorar legibilidade em tamanhos muito pequenos sem bloquear os percursos.

**Próximo passo:** rever este visual C4G e continuar a entrega 2 sobre a integração do catálogo central já em curso, sem reimplementar o trabalho existente.
