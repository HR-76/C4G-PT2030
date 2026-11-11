# C4G no PostgreSQL local

Este é o ambiente de trabalho C4G: **http://localhost:3000**, API 5000, bases `c4g_central_dev` e `c4g_tenant_dev` do PostgreSQL nativo na porta 5432. Em 2026-10-17 recebeu as nove oportunidades reais e o histórico da demonstração. A conta local e o perfil da organização usam estas bases. A instalação inicial continua a criar apenas a estrutura e os acessos; não inventa dados de negócio.

Instalado e validado nesta máquina em 2026-10-17. A base tenant vazia original ficou preservada como `c4g_tenant_dev_before_c4g_20261017`, conforme autorização expressa. A aplicação usa a nova base compatível com o nome habitual; atualizar/religar a árvore do SQLTools ou pgAdmin se necessário.

## Preparar uma vez

Pré-requisitos desta máquina: PostgreSQL 17 ou 18 em execução, Node 24.5 ou posterior, dependências npm instaladas, Docker Desktop disponível e os contentores Keycloak locais existentes. A configuração privada de identidade e o certificado local ficam em `.tmp/f2-integration`; não executar scripts de reset desse ambiente.

1. Guardar a password de `postgres` na variável `PGPASSWORD` de `backend/.env`. Esse ficheiro não deve ser versionado nem partilhado.
2. Na raiz do repositório, executar:

   ```powershell
   npm run setup:local
   ```

O instalador exige bases vazias no primeiro arranque e recusa objetos/roles C4G desconhecidos. O tenant exige UTF8, ICU `und` e UTC. Uma configuração incompatível é recusada; nenhuma base é apagada ou recriada automaticamente. Após falha parcial, repetir o mesmo comando conserva o estado da instalação.

Só depois da mensagem `LOCAL_PLATFORM_READY` existe uma instalação utilizável. O estado privado fica em `.tmp/local-platform/runtime.json`, com permissões limitadas ao utilizador Windows e SYSTEM. Preservar esta pasta para retomar a instalação e manter identidades, passwords e sessões.

## Arrancar a aplicação

Na raiz do repositório:

```powershell
npm run dev
```

Este comando inicia os serviços de identidade locais existentes quando estiverem parados, aguarda pelo realm OIDC através do endereço HTTPS real e depois arranca e supervisiona a API, o worker configurado e o frontend no mesmo terminal. O perfil ativo do proxy é reconhecido: nesta máquina, o realm usa também `c4g-native-email-idp` e a sua base persistente `c4g-native-email-pg`. Aguarda pela saúde integral da aplicação e apresenta **http://localhost:3000** quando estiver pronta. `Ctrl+C` encerra API, worker e frontend; os serviços de identidade permanecem ativos para acelerar o arranque seguinte. O comando não cria nem recria contentores, não instala dependências e não executa migrations ou seeds.

Para diagnóstico, os componentes continuam disponíveis separadamente a partir da raiz:

```powershell
npm run dev:api
npm run dev:worker
npm run dev:web
```

Cada comando individual ocupa o seu próprio terminal. `npm run dev` dentro de `backend/` também verifica PostgreSQL e retoma os serviços de identidade existentes do perfil ativo antes de iniciar a API. O comando dentro de `frontend/` inicia apenas o Vite. Nesta instalação, o worker exige ainda `npm run dev:worker` num terceiro terminal; o comando único na raiz trata dos três componentes.

Se o Vite apresentar `ECONNREFUSED` em `/api/auth/session` ou `/api/auth/oidc/login`, a API não está disponível na porta 5000. Verificar a mensagem do terminal backend. Se o Docker Desktop estiver fechado, abri-lo e repetir o arranque. Para passar de terminais individuais para o comando único, terminar primeiro esses processos com `Ctrl+C`, evitando portas ocupadas.

Se o ambiente ainda não estiver preparado, executar explicitamente:

```powershell
npm run setup:local
```

O worker processa apenas atualizações pedidas pelo ADMIN. Não há recolha agendada. O arranque diário não repete a transferência de dados.

Abrir **http://localhost:3000**. Os endereços anteriores 3100 (preview) e 5189 (demonstração) foram encerrados na consolidação. A API usa a porta 5000. Se estiver ocupada, identificar e parar a API anterior antes de repetir o arranque. O Vite recusa mudar automaticamente de porta, para manter os endereços OIDC corretos.

O arranque diário não executa migrações, seeds nem alterações de passwords. Para aplicar migrations novas, voltar a executar `npm run setup:local`, que mantém as identidades e os segredos existentes. O endpoint `/api/local-health` confirma a disponibilidade da Central e, após consolidação, o sinal de vida do worker; o arranque também valida o esquema Central e o vínculo físico ao tenant.

## Regressão do orçamento global no Dashboard

Para executar a regressão completa na raiz de `GCNI_C4G`, com o PostgreSQL e o Keycloak locais em execução:

```powershell
npm run test:dashboard-regression
```

Este comando compila o frontend uma vez, valida o cartão e o gráfico e depois executa os dois cenários OIDC. Termina na primeira falha.

Na raiz de `GCNI_C4G`, com o PostgreSQL e o Keycloak locais em execução, usar:

```powershell
npm run test:dashboard-global
```

O comando compila o frontend e abre o Chrome com a conta local da entidade. Requer as dependências do backend, do frontend e de `frontend/test-harness`, as credenciais locais válidas e pelo menos uma candidatura da entidade para servir de referência. Para usar os utilitários PostgreSQL de outra instalação, definir `PG_BIN` com a pasta que contém `pg_dump.exe` e `pg_restore.exe`.

O teste cria cópias temporárias da Central e da base da entidade, acrescenta aprovações em três anos e confere no navegador os valores anuais e mensais contra o PostgreSQL. A cópia da Central começa com as tabelas de coordenação de transações vazias, pois os registos da instância original estão vinculados à base de origem. Cada execução exige que o callback OIDC conclua o login à primeira tentativa. Verifica o texto completo do cartão após selecionar cada ano e após regressar a **Todos os anos**. Uma divergência devolve código de saída diferente de zero. No fim da execução, o teste remove as cópias que criou.

Executar `npm run test:oidc-pending` para testar os dois resultados do login. O comando compila o frontend uma vez e executa dois ensaios isolados. Quando a cópia herda a operação pendente do utilizador, o único callback OIDC deve devolver 503 com o código `SESSION_PERSISTENCE_UNAVAILABLE`. Quando a operação permanece apenas na origem, o único callback deve devolver 302 e o resumo autenticado da entidade deve responder com HTTP 200. Uma divergência em qualquer cenário faz o comando falhar.

## Acessos

**Catálogo habitual corrigido em 02/11/2026:** abrir `/catalogo`. A tabela e a ficha atualizadas estão disponíveis ao Super Admin C4G e aos membros autorizados das entidades pelas rotas habituais, sem depender da janela experimental de cinco minutos. A entrada inicial inclui todos os prazos; o corpus preservado contém 178 oportunidades, paginadas até 25 por página. Interesses e candidaturas continuam privados da entidade. [Validação](context/history/catalog-habitual-access-2026-11-02.md).

**Painel de utilizadores disponível desde 18/10/2026:** Administração C4G → Entidades e utilizadores → Consultar a entidade → Adicionar utilizador. Introduzir nome, email e perfil, rever, criar o acesso por ativar e emitir a ligação temporária. Entregar a ligação manualmente à pessoa, que define a password no Keycloak ou confirma a conta existente. É possível substituir/revogar a ligação, consultar a ativação e gerir perfil/suspensão no mesmo ecrã. O administrador da entidade usa Acessos; o gestor pode adicionar apenas técnicos. Email continua adiado.

A configuração privada deste percurso está em `.tmp/local-platform/members/`. O módulo de ativação foi instalado no contentor Keycloak existente; não recriar o contentor nem apagar essa configuração. A Central usa a migração 021 e o binding da base da entidade passou a ser resolvido pelo diretório central. A prova com duas entidades e a conferência do ambiente habitual estão em [revisão de acessos](context/reviews/platform-member-access.md). A criação de uma nova entidade pelo formulário ainda é um incremento separado.

Depois da instalação, consultar localmente `.tmp/local-platform/access.json`. Contém os nomes de utilizador e as passwords iniciais; não copiar para documentação ou mensagens. Alterar a password nas definições da conta não atualiza esse ficheiro nem faz o instalador repor a password anterior.

- `admin`: administração da plataforma; não recebe membership privada da entidade.
- `hugo`: administrador da entidade C4G, com membership central e permissões de oportunidades/candidaturas e do Perfil da Organização (dados, unidades e pessoas); não recebe administração da plataforma.

Conta nominativa administrativa adicional criada por pedido explícito em 18/10/2026: acesso inicial em `.tmp/local-platform/named-admins/`, com ACL restrita e alteração obrigatória da password. A conta tem administração da plataforma e não herda memberships privadas. As duas contas iniciais foram preservadas. O ecrã de criação de entidades/primeiros acessos ainda não está implementado.

Ambos entram por defeito com utilizador e password. **MFA é opcional em toda a aplicação, incluindo as ações administrativas.** A política `c4g-user-mfa-v1` mantém autenticação recente nas operações sensíveis e todas as verificações de permissões; não exige um autenticador a quem não o ativou.

Para ativar ou desativar: abrir **Segurança da conta → Gerir password e MFA**. Nas definições, escolher **Set up Authenticator application**, ler o QR com a aplicação autenticadora e confirmar o código temporário. Para desativar, usar **Delete** no autenticador e confirmar. O código pedido no login é gerado pela aplicação autenticadora; nunca é o segredo de configuração.

A instalação usa o realm próprio `c4g-native-local`, separado da demonstração. A atualização de 2026-10-17 conserva passwords, utilizadores globais, memberships e permissões. As identidades anteriores continuam preservadas; as sessões da política anterior exigem novo login. As cópias privadas da configuração anterior estão na mesma pasta local. Repetir `npm run setup:local` não ativa/desativa MFA escolhido pelo utilizador nem redefine passwords. A associação única de Hugo à C4G continua selecionada pelo servidor após autenticação.

## Limites deste perfil

É uma composição de desenvolvimento nesta máquina, com diretório de tenant fixado pelo servidor no estado privado. Não constitui provisioning de produção. Usa o administrador PostgreSQL na Central e uma credencial limitada no tenant; o owner técnico exigido pelos manifests é NOLOGIN e perde o privilégio de superutilizador no final do instalador.

Na instalação consolidada, o catálogo usa a integração real EU Funding & Tenders, com até cinco resultados por atualização manual em **ADMIN → Fontes**. A amostra transferida não representa a fonte completa. As quatro oportunidades com prazos futuros e as cinco históricas conservam versões e proveniência. Nenhuma nova recolha foi executada durante a consolidação. Instalações novas, ainda sem consolidação, mantêm a fonte desativada.

R2, e-mail, documentos produtivos e funcionalidades ainda em desenvolvimento mantêm os seus gates próprios. Os dados históricos e os recibos da antiga demonstração permanecem preservados fora do runtime e não são usados como fallback.

Os recibos, snapshot público e cópias privadas anteriores à consolidação estão em `.tmp/local-platform/consolidation`. Preservar a pasta e não publicar os ficheiros privados; a operação de transferência já concluída deixou de fazer parte do código executável.

O perfil histórico Docker foi retirado. O desenvolvimento local usa `npm run dev` na raiz e o setup C4G nativo documentado acima; `npm start` mantém o entrypoint da API.

## Validação isolada

`node test/integration/local-platform/gate.js` usa exclusivamente o cluster de prova PostgreSQL 18 na porta 5564, Vite/API nas portas 5190/5191 e o realm `c4g-native-validation`. Exige a preparação privada existente em `.tmp/local-platform-validation`. Prova login só com password, ativação voluntária, recusa de código errado, preservação do autenticador após reinstalação e desativação através das definições do titular. Não aceita a porta 5432, não apaga bases e preserva os artefactos de prova. A preparação deste cluster é específica desta máquina; o gate não é um instalador de ambientes de CI.

`node test/integration/local-platform/verifyNative.js` valida os dois logins contra os servidores npm dev já em execução em 3000/5000 e as bases efetivas 5432. Não cria oportunidades/candidaturas; escreve apenas os registos de autenticação inerentes ao login e capturas privadas de prova. Inclui atraso no callback e verifica a separação de permissões. Este teste dos acessos iniciais pressupõe MFA ainda não ativado pelo titular; não modifica a escolha de uma conta. Os servidores npm dev iniciados durante a instalação permanecem ativos em segundo plano; os PIDs e logs estão em `.tmp/local-platform`.


## PDFs privados de faturação (06/11/2026)

Instalados na Central (050) e ativados no arranque habitual. Armazenamento privado
local e scanner `c4g-billing-clamav` em loopback; nenhum fornecedor fiscal ligado.
Manter Docker Desktop ativo. Se o scanner foi parado manualmente, usar
`docker start c4g-billing-clamav`. Dados privados e backups em
`.tmp/local-platform/billing-pdfs/`; não apagar nem publicar essa pasta.
Detalhes: [runbook de PDFs](context/runbooks/billing-private-pdfs.md).
