# Entidades e utilizadores — criação de entidade e primeiro administrador

Estado: Draft — detalhe funcional e visual solicitado em 18/10/2026. Aplica frontend-design à identidade C4G já aprovada. Especificação, sem implementação nem criação de contas/entidades. Integra a [proposta de administração C4G](platform-customer-administration.md).

Atualização de execução: [prova isolada de viabilidade PASS, 18/10/2026](../reviews/platform-onboarding-isolated-proof.md), autorizada posteriormente. Criadas apenas contas/entidades descartáveis no laboratório; ecrã e serviço de produto ainda por implementar. A formulação inicial acima refere-se à fase de especificação.

## Objetivo

O administrador C4G encontra os clientes, identifica quem os administra e prepara uma nova entidade com o primeiro administrador. A interface distingue registo, preparação do espaço e disponibilidade de acesso. Candidaturas privadas continuam fora desta área.

## Direção visual e revisão do brief

Preservar o logótipo existente, navegação lateral C4G e densidade das tabelas do piloto. A informação principal é a lista de entidades, com ações visíveis. Sem painel inicial de indicadores ou cartões decorativos. Alinhamento à esquerda, separadores discretos e formulário em página inteira, para permitir revisão sem modal longo.

Tokens existentes: navegação #075B59, destaque de marca #5FAD2F, ação com contraste #39751F, texto #20262B, fundo #F6F8F8, superfície #FFFFFF. Bordas usam o token existente #E3E8EB. Tipografia `var(--font)` do produto, predominando Segoe UI em Windows; título 24 px/600, secções 18 px/600, texto e campos 14 px, notas 12 px. Verde claro não será usado para texto pequeno sobre branco. Estados incluem sempre texto, não apenas cor.

Revisão do conceito: manter a lista como elemento dominante e remover cartões de resumo que repetiriam os filtros. A marca, densidade e navegação existentes têm prioridade sobre uma nova linguagem visual. Apenas o percurso de criação recebe numeração, porque representa passos reais. Não introduzir animações automáticas.

## Navegação e página principal

Entrada **Entidades e utilizadores** no grupo **Plataforma C4G**, acessível apenas com autoridade C4G atual. Rota proposta `/administracao/entidades`; independente da organização selecionada. Não reutilizar `/utilizadores`, que continua a gerir os acessos da organização ativa.

Dois separadores previstos: **Entidades** e **Utilizadores**. O primeiro é o ponto de entrada. Utilizadores oferece consulta por nome/email e entidade, com contas únicas e vínculos discriminados; o comando inicial de criação pertence ao percurso Nova entidade. Não expor alteração de papéis de plataforma ou suspensão global neste primeiro incremento.

```text
Plataforma C4G       Entidades e utilizadores       [Nova entidade]
                    [Entidades]  [Utilizadores]

                    [Pesquisar nome ou identificação fiscal...]
                    [Situação: Todas] [Preparação: Todas] [Limpar]

                    Entidade | Administradores | Contas ativas
                             | Situação | Preparação | Ações
                    ------------------------------------------------
                    [resultados reais; sem clientes de demonstração]
                    ------------------------------------------------
                    [Anterior]    Página … de …    [Seguinte]
```

Nome da entidade abre a ficha. Ações visíveis: **Abrir entidade** e, quando necessário, **Continuar preparação**. Mostrar administradores atuais, sem assumir que o primeiro administrador permanece responsável para sempre. Contas ativas significam vínculos ativos nessa entidade; não contam pessoas do diretório nem parceiros.

Situação da entidade e preparação técnica são colunas distintas. Rótulos finais mapeiam estados existentes, não criam uma máquina de estados paralela no frontend. Exemplos de apresentação: situação Ativa/Suspensa; preparação Por iniciar/Em preparação/Disponível/Requer intervenção. Filtros, contagens e ações vêm de dados autorizados do servidor. Nunca mostrar zero quando a leitura falhou.

Lista vazia: “Ainda não existem entidades. Crie a primeira entidade e indique o seu administrador.” Pesquisa sem resultados: “Nenhuma entidade corresponde aos filtros.” Erro: “Não foi possível consultar as entidades”, com **Tentar novamente**. Paginação e pesquisa devem manter a posição ao regressar da ficha.

## Nova entidade — proposta de campos

Página com **Voltar às entidades**, título **Nova entidade** e sequência **1 Entidade / 2 Primeiro administrador / 3 Rever e criar**. Botões Voltar/Continuar preservam o formulário. Antes da confirmação final, não são criados recursos nem contas; sair com alterações pede confirmação para descartar. Rascunho apenas em memória neste primeiro recorte, sem guardar contactos no armazenamento do browser.

### 1. Entidade

| Campo | Proposta | Comportamento |
| --- | --- | --- |
| Nome da entidade | Obrigatório | Nome apresentado nas listas e na seleção da organização. |
| Denominação legal | Opcional nesta fase | Preenchida separadamente se diferir do nome; necessária posteriormente conforme faturação. |
| País | Obrigatório | Portugal pode ser sugestão visível, editável; sem inferir pelo email. |
| NIF / identificação fiscal | Opcional na preparação | Validar formato conforme país quando preenchido; necessário antes da faturação quando aplicável. |
| Sigla | Opcional | Não substitui a identidade estável nem precisa de ser universalmente única. |
| Website | Opcional | Validar URL; não desencadeia recolha de dados. |

São propostas de obrigatoriedade, não requisitos comerciais já aprovados. Nome obrigatório não implica unicidade: entidades homónimas são possíveis. Mesmo identificador fiscal normalizado no mesmo país deve levar à revisão do registo existente; não fundir nem duplicar automaticamente. Sem NIF, avisos por nome semelhante não provam identidade.

Não exigir organograma, competências, pessoas, orçamento, plano comercial, dados de pagamento ou documentos para preparar o registo. Estes serão completados nos percursos próprios. O nome/NIF comercial e o perfil da organização precisam de fonte canónica e sincronização definidas antes da implementação; não criar duas fichas editáveis divergentes.

### 2. Primeiro administrador

| Campo | Proposta | Comportamento |
| --- | --- | --- |
| Nome completo | Obrigatório para conta nova | Identifica a pessoa a quem será entregue o acesso. |
| Email | Obrigatório | Validar e verificar colisão no servidor. Não constitui, isoladamente, prova de titularidade. |
| Perfil | Fixo | **Administrador da entidade**; não concede administração C4G. |

Texto de ajuda: “Esta pessoa irá administrar a entidade e gerir os acessos da sua equipa.” Sem campo de palavra-passe. Telefone, departamento e competências não são necessários nesta etapa. Não criar automaticamente ficha de pessoa, departamento, relação laboral ou inscrição em newsletters.

Conta existente: mostrar à C4G apenas a identidade necessária à confirmação, com indicação “Conta existente — manter os restantes acessos”. A associação deve usar o identificador global verificado e o percurso de aceitação definido; não alterar nome, credenciais ou vínculos existentes a partir deste formulário. Conta suspensa ou colisão de identidade requer resolução explícita, sem reativação automática. Uma consulta iniciada para outro email não pode preencher o email atual.

**Decisão confirmada pelo utilizador em 18/10/2026:** permitir já ativação por ligação temporária, entregue manualmente pela C4G. Email automático mantém-se adiado. Esta confirmação fecha a escolha do canal; não significa que o mecanismo já existe nem autoriza envios a terceiros neste turno. Não transformar o script local de password temporária numa funcionalidade de produto por inferência.

### Entrega manual e ativação do primeiro acesso

Depois de o espaço estar disponível e o destinatário resolvido, a ficha apresenta **Gerar ligação de ativação**. Mostrar nome, email, entidade e perfil antes da emissão. A ligação destina-se exclusivamente a esse primeiro acesso, não a uma sessão administrativa da C4G.

Após gerar, apresentar **Copiar ligação**, data/hora de validade e indicação “Entregue esta ligação apenas ao administrador indicado”. A cópia não prova entrega: a interface mantém “A aguardar ativação”. Histórico regista emissão, substituição, revogação e aceitação, nunca o segredo. Não mostrar a ligação em tabelas, auditoria, logs ou exportações.

Regra técnica proposta para o primeiro incremento: validade de 24 horas desde a emissão, uso único e revogação pela C4G. **Gerar nova ligação** invalida a anterior e exige confirmação; **Revogar ligação** não suspende outros acessos da pessoa. O prazo é um valor inicial explícito, não uma escolha já confirmada pelo utilizador nem um novo sistema de configuração. Após ativação, recuperação de conta segue o percurso de identidade existente, sem reemitir um convite consumido.

A ligação só é apresentada na emissão; não guardar o token em claro na base ou no armazenamento persistente do browser. Se a resposta se perder, consultar o estado sem recuperar o segredo; permitir substituição explícita e segura após reconciliação. Renovar e aceitar simultaneamente exige controlo de concorrência e resultado inequívoco.

Ao abrir a ligação, apresentar **Ativar acesso à entidade**, destinatário e perfil quando a ligação for válida. Abrir a página por GET, pré-visualizador ou scanner não consome o convite nem concede acesso. Exigir ação explícita do destinatário. Conta nova define a sua própria palavra-passe no serviço de identidade; a C4G não a escolhe nem a conhece. Conta existente autentica-se na identidade esperada e aceita o novo vínculo, mantendo a palavra-passe e restantes acessos. Uma sessão de outra conta não pode aceitar o convite.

Antes da ativação, revalidar validade/revogação, identidade, entidade, preparação técnica e perfil associado no servidor. O token não pode conceder papel C4G nem alterar o destinatário. Não marcar email como verificado apenas porque a ligação foi copiada ou entregue manualmente: a verificação do endereço é distinta da entrega do convite.

Ligação inválida, expirada, revogada ou já utilizada apresenta mensagem sem revelar dados pessoais e orienta a contactar a C4G; não cria outra conta. Falha técnica permite verificar/retomar o resultado sem consumir definitivamente o acesso antes da conclusão. Estado “Ativado” exige confirmação da identidade, aceitação e vínculo elegível, não apenas abertura da ligação.

O desenho técnico deve ligar este fluxo ao OIDC existente, com segredo aleatório forte, digest persistido, proteção contra tentativas repetidas e fuga por URL/referrer/telemetria, e troca segura para o serviço de identidade. Não criar autenticação paralela. A URL deve usar a origem configurada e HTTPS fora do desenvolvimento; localhost não é uma ligação utilizável por um cliente externo. Disponibilidade pública e configuração de identidade serão verificadas antes de entrega real.

### 3. Rever e criar

Mostrar dois blocos compactos, Entidade e Primeiro administrador, cada um com **Editar**. Apresentar nome, país, identificação fiscal se indicada, nome/email da pessoa, perfil e método de entrega escolhido. Tornar explícito se o acesso ficará pendente. Não mostrar um plano pago ou período experimental inventado.

```text
Nova entidade
1 Entidade       2 Primeiro administrador       3 Rever e criar

Entidade                                               [Editar]
Nome, país, identificação fiscal quando indicada

Primeiro administrador                                 [Editar]
Nome, email, Administrador da entidade
Entrega do acesso: ligação temporária entregue pela C4G

[Voltar]                                      [Criar entidade]
```

**Criar entidade** confirma uma única intenção no servidor. Duplo clique, resposta perdida ou repetição não criam duplicados. Enquanto há resultado incerto, manter a intenção e oferecer **Verificar resultado**, sem permitir novo envio com campos diferentes até reconciliar.

## Resultado e ficha da entidade

Após confirmação persistida, abrir a ficha criada, com resumo do resultado e três verificações independentes: **Registo da entidade**, **Espaço da entidade**, **Primeiro administrador**. Cada uma indica o que está concluído, pendente ou falhou, com a ação seguinte permitida. Registo criado não significa espaço disponível nem convite enviado. Não usar percentagens fictícias.

Se só existe registo: “Entidade registada. A preparação do espaço ainda não está concluída.” Se o acesso aguarda envio: “Primeiro administrador indicado. Entrega do acesso pendente.” Falha recuperável conserva a entidade e oferece retoma autorizada; não obriga a repetir toda a criação. Recibo de sucesso nunca depende apenas de um pedido aceite pelo serviço de identidade.

Ficha inicial com **Resumo**, **Utilizadores** e **Histórico administrativo**. Histórico limitado a criação, preparação e acessos, com autor/data/resultado, sem eventos privados de candidaturas ou segredos. Em Utilizadores, distinguir conta, perfil na entidade, estado do vínculo e ativação/aceitação. Faturação e comunicação entram em incrementos posteriores; não mostrar separadores vazios que sugiram funcionalidade pronta.

## Responsividade e acessibilidade

Desktop 1440 px: aproveitar a largura do conteúdo para tabela; formulário limitado a cerca de 880 px. Dois campos por linha apenas quando curtos. Email e nomes longos quebram sem truncar informação essencial.

Mobile 390 px: menu recolhido conforme shell atual, filtros e campos numa coluna, resultados com rótulos de coluna e ações sempre acessíveis. Passo atual indicado por texto e posição; rever todos os dados antes de confirmar. Evitar ações fixas que tapem campos com teclado aberto.

Labels persistentes, indicação de campos obrigatórios, erros junto ao campo e resumo focável, foco visível, navegação por teclado e anúncios de resultado. Mudança de passo coloca foco no título; erro mantém valores e leva ao primeiro campo inválido. Carregamento não apaga resultados já conhecidos silenciosamente.

## Contrato técnico a concretizar antes de implementar

[Plano de implementação preparado em 18/10/2026](platform-entities-implementation-plan.md): componentes verificados, alterações centrais, contratos HTTP propostos, preparação de múltiplos tenants, prova Keycloak sem email e matriz de validação. A inspeção encontrou campos obrigatórios centrais ausentes do formulário inicial (denominação legal, tipo e moeda de reporting); o plano explicita a proposta de resolução sem alterar silenciosamente o contrato. Feature mantém Draft até fechar estes pontos e comprovar a ponte de ativação.

Reutilizar identidade OIDC, membership central, auditoria e diretório/ciclo de vida aprovados. Rotas administrativas novas, cliente em api.js e autorização C4G em cada pedido. Não permitir ao browser escolher nomes de bases, segredos, região arbitrária ou bindings.

O comando de criação precisa de estado persistido e repetição segura entre Central, serviço de identidade e preparação do tenant. Projeções obrigatórias, base isolada, esquema, saúde e recuperação devem estar verificados antes de declarar acesso disponível. Uma falha parcial preserva referências e histórico para retoma; não apaga recursos automaticamente.

O backend determina os estados e capacidades apresentados. Mudança/revogação de autoridade durante o percurso invalida novos comandos; retorno atrasado de sessão anterior é descartado. Permissões de entidade não dão acesso às rotas de plataforma.

Provisionamento real continua sujeito aos gates existentes de infraestrutura, residência, segredos, backup e restore. Um protótipo visual ou ensaio local não os encerra. O incremento deverá distinguir execução local validada de disponibilização a clientes reais.

## Aceitação e validação planeada

1. C4G lista entidades e abre a ficha; outros perfis são recusados. Ensaiar duas entidades com contas distintas, sem exposição de dados privados, e recusar uma segunda membership não removida para a mesma identidade.
2. Criar uma entidade e primeiro administrador com revisão explícita. Provar conta nova, conta existente, email inválido, homónimo e colisão fiscal, sem alterações automáticas a outras identidades/vínculos.
3. Demonstrar estados pendentes e falhas reais em cada etapa; repetição, concorrência, sessão revogada e resultado incerto não duplicam nem ativam acesso prematuro.
4. Provar ativação por ligação manual para conta nova e existente, disponibilidade do catálogo e isolamento da entidade nova. Validar expiração, revogação, substituição, reutilização, conta errada, scanner GET, concorrência e falha parcial; nenhum segredo em logs/histórico. A C4G não conhece a palavra-passe e entrega manual não verifica automaticamente o email. Ensaio local não prova acessibilidade externa.
5. Preservar os perfis internos aprovados, tarefas e histórico. Primeiro administrador não ganha papel C4G, e C4G não ganha membership privada implicitamente.
6. Validar teclado, campos longos, erros, vazio, 1440/390 px e comparação com o shell C4G. Build, node --check, testes de autorização/migração/idempotência e base descartável antes de ativação local.

Esta especificação foi revista contra os componentes e tokens existentes. Não foi construído nem testado um ecrã novo neste turno.

Próximo passo: preparar a implementação do percurso Entidade → Primeiro administrador → ligação temporária, com integração de identidade e preparação do espaço verificadas antes da ativação.
