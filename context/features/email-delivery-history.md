# Histórico de envios

## Âmbito confirmado — 15/11/2026

O utilizador confirmou `CODIGO_POR_EMAIL_RETIRADO` e a ausência da opção em Email e Segurança da conta no staging. Pediu continuar com o histórico. Abrange convites de colaboradores (incluindo testes identificados) e recuperação pública de palavra-passe. Não implementar autenticador próprio nem reintroduzir código por email.

Só o Admin C4G consulta o histórico global. Campos: tipo, origem, entidade quando aplicável, destinatário, instante, resultado. `ACCEPTED` significa aceitação pelo transporte; nunca afirmar entrega na caixa. Timeout/resultado ambíguo é `UNCONFIRMED`. Não guardar corpo, assunto, segredo, ligação, IP, token, resposta SMTP ou erro livre.

Endereços dos destinatários são anulados fisicamente após 90 dias; leitura também omite endereços vencidos, sem consultar o endereço atual da conta. Limpeza automática repetível, com tempo do servidor, incluindo falhas. Metadados sem destinatário permanecem. As bases operacionais das contas não são apagadas por esta política. Cópias de segurança seguem a política própria de retenção e acesso.

## Implementação e critérios anteriores ao código

- Registos de convites separados dos recibos operacionais e versões de templates, na Central; chave estável por convite/intenção de teste. Registar antes de contactar o transporte e atualizar o mesmo registo, preservando aceitação confirmada perante respostas tardias. Uma falha posterior de registo não deve provocar reenvio automático.
- Recuperação: listener dos eventos nativos `SEND_RESET_PASSWORD`/`SEND_RESET_PASSWORD_ERROR` em Keycloak 26.8.0. Nenhum autenticador nem transporte próprio. Registo mínimo em tabela JPA própria, chave idempotente por evento. Não inferir envio de login ou alteração de palavra-passe. Email administrativo de ações e teste SMTP não são recuperação pública e ficam fora desta categoria.
- Leitura restrita no provider, com papel dedicado; sessão/estatuto Admin C4G validados na Central antes e depois da leitura remota. Histórico indisponível deve aparecer como erro, não lista vazia.
- API pagina por cursor e ordenação determinística; filtros fechados por tipo/resultado. Interface em Administração → Email, datas Europe/Lisbon, estados vazio/erro/carregamento e paginação.
- Nenhuma retrocarga inventada: começa com a ativação dos coletores. Envios anteriores não têm evidência suficiente para reconstruir um histórico completo.
- Provar autorização/revogação, entidades, duplicação, concorrência, erros e remoção física dos endereços no limite dos 90 dias. Gate PostgreSQL e Keycloak próprios com SMTP de captura; nenhum envio real nos testes. Implantação só depois dos gates, por comandos na consola VPS conforme preferência do utilizador.

## Resultado de implementação e validação — 15/11/2026

Implementados: migração aditiva Central `056_email_delivery_history`, captura dos convites no percurso real de envio, listener nativo do Keycloak com tabela própria e papel `read-delivery-history`, API global autorizada, paginação por cursor com ordenação estável entre origens, filtros e página em Administração → Email. A base não concede SELECT direto da tabela ao runtime. Uma intenção já aceite não volta a contactar o transporte. Um registo cuja aceitação foi confirmada não é rebaixado por uma resposta tardia. Falha antes de preparar o histórico impede o envio; falha ao guardar o resultado conserva UNCONFIRMED e sinaliza recolha degradada.

Retenção: limpeza Central a cada minuto na API, incluindo no arranque; temporizador autónomo de um minuto no Keycloak, além da operação restrita de limpeza. Endereços vencidos deixam imediatamente de sair nas leituras. Nenhum endereço é reposto por replay, nem resolvido a partir da conta atual. As rotinas dependem dos serviços em execução; a limpeza Central recupera no arranque depois de uma paragem.

Provas: [57 verificações Keycloak 26.8.0/PostgreSQL 17.11](../../test/integration/email-history/evidence-keycloak-postgres17.json), seis mensagens de captura e zero envios externos; inclui falha SMTP, permissão separada/revogação, eliminação efetiva de endereços e execução autónoma do temporizador. [Central PostgreSQL 18](../../test/integration/email-history/evidence-central.json): instalador registado/repetível, variantes genérica, logins de staging e eliminação de utilizadores, permissões, concorrência, anonimização e não restauração por replay. Na variante genérica, leitura por Admin C4G e recusa após expirar a sessão também comprovadas.

Testes focados backend aprovados, incluindo percurso de convites (13), histórico/HTTP/executor (28), ledger e preflight do catálogo (30), e configurador VPS com mocks (3). A nova migração exigiu também prolongar os contratos de ledger e preflight do catálogo até 056; regressão de ledger falhou antes e passou depois, mantendo recusa de versões omitidas/checksums alterados. Build frontend, lint global e sintaxe aprovados. Frontend completo: 1140 PASS/1 timeout em Pq1; o ficheiro passou na repetição junto dos testes de histórico (30/30). Backend completo final: 3390 PASS/3 FAIL/9 SKIP; falhas já conhecidas nos dois source guards antigos de allowlists 052/053 (a implementação de upload usa manifesto dinâmico) e em SEC-AC-01/sessionStorage. As três provas de invitação adicionadas depois desta suite também passaram isoladamente.

Limites: sem verificação visual no navegador nem implantação desta funcionalidade no staging. Configurador e Dockerfile Linux preparados; o Dockerfile não foi executado nesta máquina. Sem commit/push feito pelo agente. [Sequência de implantação pela VPS e recuperação](../../test/integration/email-history/README.md). Após migrar, API e worker têm de usar imagens que conheçam 056; desligar a funcionalidade não torna uma imagem antiga compatível com o novo esquema.
