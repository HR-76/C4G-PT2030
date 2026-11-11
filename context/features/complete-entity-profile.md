# Ficha completa da entidade

Estado: Complete — fecho formal em 26/10/2026.

## Objetivo

Disponibilizar uma ficha administrativa canónica e completa para todas as entidades, incluindo as anteriores ao percurso de adesão. A mesma fonte central é consultada e atualizada pela Administração C4G e pela entidade, dentro de uma matriz explícita de responsabilidades, sem copiar dados privados do tenant nem inventar informação em falta.

## Significado de responsável

O **contacto principal** é a pessoa indicada pela entidade para comunicações operacionais com a C4G sobre a plataforma e candidaturas. Nome, email profissional, telefone profissional e cargo pertencem à ficha da entidade.

Este contacto:

- não é, por essa designação, representante legal;
- não recebe conta, membership, perfil ou acesso;
- não é necessariamente o primeiro administrador nem o responsável de uma candidatura;
- pode coincidir com uma pessoa ou utilizador existente, mas nesta fase não cria nem mantém uma ligação automática;
- é inicialmente proposto a partir do primeiro administrador nas entidades criadas por adesão, permanecendo depois independente e editável.

O primeiro administrador guardado na adesão continua como evidência histórica e não é apresentado como contacto atual quando já existe contacto principal canónico.

## Fonte canónica e fronteiras

- `public.organization` conserva identidade e lifecycle: denominação legal, nome apresentado, tipo, estado e moeda.
- `public.organization_registration.fields` conserva NIF, sigla, morada, contactos institucionais, contacto principal e dimensão declarada.
- `organizational_scope.organization_card` conserva a descrição privada da organização; não volta a ser fonte editável de contactos depois de existir ficha central.
- Admin e entidade usam o mesmo serviço central de ficha. Os endpoints HTTP são distintos porque as autoridades são distintas, mas o contrato, validação, concorrência, recibos e projeção são únicos.
- O preenchimento inicial é explícito. Não há backfill automático, valores fictícios nem cópia silenciosa de contactos legados.

## Campos

| Bloco | Campos | Regra |
| --- | --- | --- |
| Identificação | denominação legal, nome apresentado, país PT, tipo, NIF, sigla, moeda EUR | Identidade central visível; NIF é obrigatório no primeiro preenchimento e fica bloqueado depois de confirmado. |
| Morada | morada, complemento, código postal, localidade, país PT | Morada, código postal e localidade obrigatórios. |
| Contactos institucionais | email, telefone, website | Email e telefone obrigatórios; website opcional. |
| Contacto principal | nome, email profissional, telefone profissional, cargo | Nome, email e telefone obrigatórios; cargo opcional. Não concede acesso. |
| Dimensão | número de trabalhadores, data de referência | Ambos obrigatórios; inteiro não negativo e data civil não futura. |
| Apresentação privada | descrição | Continua editável apenas no perfil da entidade e separada da ficha administrativa central. |

## Matriz de consulta e edição

| Bloco | Administração C4G | Administrador da entidade com `organization_directory.edit` | Outros perfis |
| --- | --- | --- | --- |
| Identificação central | Consulta; confirma NIF no primeiro preenchimento | Consulta; pode indicar NIF apenas enquanto a ficha está por completar | Consulta autorizada |
| Morada e contactos institucionais | Consulta e edição | Consulta e edição | Consulta quando tem acesso ao perfil |
| Contacto principal | Consulta e edição | Consulta e edição | Consulta quando tem acesso ao perfil |
| Dimensão declarada | Consulta e edição | Consulta e edição | Consulta quando tem acesso ao perfil |
| Descrição privada, unidades e pessoas | Sem acesso pela ficha central | Mantém as permissões tenant existentes | Mantém as permissões tenant existentes |
| Utilizadores e acessos | Percurso administrativo existente | Percurso de acessos existente | Conforme perfil existente |

Alterações à denominação legal, nome apresentado, tipo ou NIF já confirmado exigem um percurso futuro de correção de identidade com auditoria própria. Esta feature não permite divergência entre `organization` e a ficha JSON.

## Comportamento

- Uma entidade sem `organization_registration` vê estado **Por completar** e pode iniciar o preenchimento; a identidade existente é apresentada sem edição.
- Uma linha de contactos adotada anteriormente mas sem NIF é igualmente tratada como incompleta e pode ser completada, preservando os contactos atuais até gravação explícita.
- O primeiro preenchimento e as edições usam revisão otimista e `requestId`. Repetir exatamente um resultado incerto não duplica a ficha nem o recibo.
- O servidor valida novamente todos os campos, a sessão, a autoridade atual e a organização alvo.
- O NIF é verificado contra fichas já existentes sob a serialização central usada pela adesão. Colisão devolve revisão fiscal necessária sem revelar a outra entidade.
- Admin C4G nunca recebe por esta API dados privados do tenant, candidaturas, pessoas ou unidades.
- As páginas apresentam valores em falta como `Por preencher`, erros junto dos campos e preservam o formulário depois de falha.

## Critérios de aceitação

1. Entidade existente sem ficha consegue guardar a primeira ficha completa sem alterar identidade, memberships, tenant ou dados operacionais.
2. Ficha criada por adesão continua legível; o contacto principal é projetado inicialmente do administrador histórico sem o transformar em representante legal.
3. Admin C4G e entidade consultam a mesma revisão e os mesmos valores canónicos.
4. Admin C4G e entidade autorizada editam os blocos permitidos; leitor, entidade errada, sessão revogada e C4G não administrador são recusados.
5. NIF inválido, duplicado ou alterado depois da confirmação é recusado; campos obrigatórios e limites são validados no servidor.
6. Escrita concorrente devolve conflito; repetição do mesmo `requestId` devolve o mesmo resultado.
7. A descrição privada e os contactos legados não são sobrescritos silenciosamente.
8. Os dois ecrãs funcionam em desktop e móvel, com identificação bloqueada, estado da ficha e ações acessíveis por teclado.
9. Testes backend cobrem validação, autorização, inicialização, edição, idempotência, conflito e isolamento; testes frontend cobrem os dois ecrãs e estados vazio/edição/erro.
10. `node --check`, testes direcionados e `npm run build` passam.

## Fora do âmbito

- Representante legal, procurações, documentos comprovativos ou validação fiscal externa.
- Alteração posterior de NIF ou identidade legal já confirmada.
- Associação automática do contacto principal a uma conta, membership, pessoa, equipa ou candidatura.
- Email transacional, faturação, contratos ou campos comerciais.
- Backfill automático de dados desconhecidos nas entidades existentes.

## Plano de implementação

1. Estender o contrato central com projeção e validação da ficha permanente e contacto principal, preservando o contrato da adesão.
2. Estender o serviço `organization_registration` com leitura canónica, preenchimento inicial e edição completa para autoridade de entidade e C4G, reutilizando locks, revisão, recibos e auditoria existentes.
3. Expor endpoints simétricos na área da entidade e no diretório C4G, ambos ligados ao mesmo serviço.
4. Criar um componente frontend partilhado de consulta/edição e integrá-lo no Perfil da organização e na Ficha da entidade C4G.
5. Adicionar testes focados de contratos, serviços, HTTP e componentes; executar sintaxe, testes direcionados e build.

## Validação

- Contrato e serviço central: testes de campos fechados, normalização, preenchimento inicial, edição, limpeza de opcionais, NIF bloqueado/duplicado, revisão otimista, replay idempotente, não administrador C4G, permissão recusada, sessão sem organização selecionada e entidade divergente.
- HTTP: os limites da entidade e da Administração C4G encaminham o mesmo comando canónico e devolvem erros de validação fechados.
- Frontend: 16 testes direcionados passam nos dois ecrãs, incluindo ficha vazia, edição completa e preservação do formulário/erros após recusa.
- Composição: 17 testes de composição produtiva/local passam; a ficha fica disponível em OIDC quando o esquema de registo existe e, localmente, não depende do worker de novas adesões.
- Sintaxe: `node --check` passou em todos os ficheiros JavaScript backend alterados.
- Build: `npm run build` passou no frontend (2121 módulos transformados).
- Ambiente local habitual, 21/10/2026: `npm --prefix backend run setup:local` terminou com `LOCAL_PLATFORM_READY`; `/api/local-health` respondeu 200 com API, worker e admission prontos. Backend e frontend ficaram disponíveis em `http://localhost:5000` e `http://localhost:3000`.
- Primeiro preenchimento real local: a entidade C4G foi preenchida explicitamente no ecrã da Administração C4G. A criação produziu `revision: 1`; a correção posterior do número de trabalhadores, confirmada pelo utilizador, produziu `revision: 2`. A API canónica mantém `complete: true` e o mesmo NIF confirmado; o ecrã da própria entidade apresenta os mesmos valores e o estado **Completa**.
- Matriz de edição: no perfil da entidade, o NIF confirmado foi verificado como `readOnly`, enquanto sigla, morada e os restantes campos editáveis permanecem ativos. A abertura e o cancelamento do formulário não produziram nova gravação.
- Validação visual Playwright: Admin e entidade a 1440 × 900, e perfil da entidade a 390 × 844, sem erros de consola nem overflow horizontal. Permanecem apenas os dois avisos de migração futura já emitidos pelo React Router 6. Evidências em `output/playwright/entity-profile/admin-entity-profile-desktop.png`, `entity-profile-desktop.png` e `entity-profile-mobile.png`.
- Dados de validação: morada, contactos institucionais, website e NIF foram confrontados com fontes públicas da C4G. O número de trabalhadores foi corrigido para **8**, por confirmação direta do utilizador, com data de referência `2026-10-21`; Admin e entidade mostram o mesmo valor.

Durante a implementação não foi alterado qualquer registo de entidade existente. Na validação local posterior e pedida pelo utilizador, foi criada explicitamente a primeira ficha canónica da C4G; não houve backfill automático nem alteração de memberships, identidade, tenant ou dados operacionais.

## Fecho formal (26/10/2026)

Os dez critérios de aceitação ficam satisfeitos no âmbito da ficha administrativa canónica. A reconferência executou novamente os cinco testes backend de serviço/HTTP da ficha e incluiu o teste frontend de `OrganizationProfile` na seleção de 39 testes, todos com sucesso. A falha atual do build global está localizada no `EntityAdmission.jsx` ainda em desenvolvimento; o build, a composição, o ambiente habitual e a prova visual exigidos por esta feature tinham passado e permanecem registados acima. Representante legal, validação fiscal externa, email transacional e associação automática do contacto a acessos continuam fora do âmbito.

