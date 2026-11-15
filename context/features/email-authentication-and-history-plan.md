# Emails de autenticação, configuração e histórico

Estado: SMTP Resend e recuperação pública validados no staging pelo utilizador em 15/11/2026: opção visível, email recebido, palavra-passe alterada e login concluído. Editor dos emails de autenticação e histórico ainda por implementar. Complementa [o contrato de email](email-templates-and-configuration.md).

## Decisões confirmadas

- Ativar a recuperação de palavra-passe por email, além de disponibilizar a edição do texto.
- Histórico dos três tipos: convite, reposição de palavra-passe e código por email.
- Endereços dos destinatários no histórico: retenção de 90 dias. Esta regra aplica-se ao histórico de envios, não elimina o endereço necessário à conta ativa.
- Só o Admin C4G configura os templates; os dois tipos do Keycloak são globais.
- Segredos SMTP e Resend continuam fora da interface e das respostas HTTP.

## Evidência técnica

- 15/11/2026 — O utilizador confirmou o percurso público completo de recuperação. Não foi realizado um teste separado de expiração ou reutilização da ligação.

- 15/11/2026 — O utilizador executou a ativação e devolveu `Recuperacao de palavra-passe ATIVA no c4g-staging. SMTP e configuracoes verificadas mantiveram-se iguais.` O comando escreveu apenas `resetPasswordAllowed=true` e confirmou por GET, comparando SMTP, realm, fluxos de browser/recuperação, temas, registo e verificação de email. Evidência operacional fornecida pela consola do utilizador; não foi uma execução SSH do agente. Ainda por confirmar: opção no login, envio iniciado pelo utilizador nesse percurso, conclusão da troca e recusa de reutilização da ligação.

- 15/11/2026 — O utilizador confirmou que o comando `execute-actions-email` com `UPDATE_PASSWORD` terminou com sucesso e que recebeu a mensagem na caixa controlada indicada. Isto comprova o envio e a receção desse email administrativo, não ainda o percurso público «Esqueci-me da palavra-passe», conclusão da troca ou uso único. Pediu expressamente ativar a recuperação de palavra-passe. A alteração preparada limita-se a `resetPasswordAllowed=true` pela API administrativa, com leitura prévia e posterior e preservação do SMTP e dos fluxos existentes.

- 15/11/2026 — O utilizador executou na consola da VPS o comando de configuração e devolveu `SMTP configurado e relido. Recuperacao continua desligada. Falta testar o envio.` Configuração SMTP aplicada e confirmada pelo readback da API, segundo esta evidência. Ainda não comprova autenticação SMTP, aceitação pelo Resend ou chegada à caixa; falta destinatário controlado e teste de envio. Não repetir o configurador, que recusa substituir SMTP existente.

- 15/11/2026 — Diagnóstico fornecido pelo utilizador na consola do staging: Keycloak 26.8.0 publicado apenas em `127.0.0.1:8180`; Caddy encaminha o realm `c4g-staging` e recursos, mas devolve 404 à administração. O único JAR na pasta de providers é `c4g-manual-activation.jar`. Consulta SQL só de leitura confirmou `reset_password_allowed=false`, sem host SMTP nem remetente preenchidos. Não alterar diretamente a base para configurar o IdP.
- 15/11/2026 — Resend escolhido pelo utilizador também para os emails do Keycloak. Captura do painel confirma `notificacoes-teste.c4g.ai` com estado `Verified`; o utilizador confirmou a criação da chave dedicada pedida (`keycloak-staging`, Sending access, limitada a esse domínio). O valor da chave não foi fornecido ao chat. SMTP ainda por configurar e testar; recuperação ainda desligada.

- O repositório documenta a extensão externa `c4g-email-verification-26.7.2-c4g.1-rc4.jar`, SHA-256 `1B42592628DBA8E02D6F56031F0B52802FD2C3704727FC189EBF126D8BC951DE`, validada em Keycloak 26.8.0. Não foram encontrados o JAR nem as suas fontes neste checkout ou nas cópias locais consultadas. Pediu-se a localização ao utilizador.
- `backend/scripts/localPlatform/identityLocalization.js` configura apenas o idioma do realm; não demonstra a edição dos textos de email.
- No [provider oficial do Keycloak 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/email/freemarker/FreeMarkerEmailTemplateProvider.java), a recuperação usa `passwordResetSubject` e `password-reset.ftl`. É necessário confirmar os templates e as mensagens efetivamente carregados pelo tema e pela extensão de código antes de escolher as chaves de configuração.
- O contrato exige uma conta de serviço restrita. A revisão do [recurso administrativo oficial](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/services/resources/admin/RealmAdminResource.java) faz parte da análise de permissões; não conceder administração geral do realm por conveniência.
- Docker, Maven e `psql` não estão disponíveis no PATH desta máquina. A prova em Keycloak/PostgreSQL descartáveis precisa de ambiente isolado identificado; não usar as bases habituais para suprir essa ausência.
- O utilizador não sabe onde está o artefacto. Pesquisa adicional no perfil local (excluindo caches, AppData e node_modules) também não o encontrou. Tentou-se consultar apenas os nomes dos JAR em `/srv/c4g-staging/keycloak-providers` pela ligação SSH já conhecida: primeira tentativa expirou antes da autenticação; a segunda foi reposta pelo servidor durante a negociação. Nenhum comando remoto chegou a executar. A continuidade da inspeção do componente depende de acesso SSH funcional ou da recuperação do artefacto/fontes.

## Incrementos e critérios de aceitação

### Preparação da personalização nativa (15/11/2026)

Incremento local: compilador do template de recuperação para as três mensagens nativas `passwordResetSubject`, `passwordResetBody` e `passwordResetBodyHtml` do Keycloak 26.8.0. Variáveis do corpo: `{LigacaoRecuperacao}`, `{Validade}` e `{Logotipo}`; ligação e validade obrigatórias nas partes HTML e texto. Assunto sem variáveis. A validade usa a duração formatada pelo Keycloak, não uma data inventada pela aplicação. HTML sanitizado; o logótipo vem exclusivamente do argumento de composição HTTPS da C4G. Apóstrofos e chavetas literais são escapados para Java MessageFormat. Não gera nem guarda ligações reais.

Critérios: validar variáveis próprias sem alargar as dos convites; provar ligação no `href` e texto, validade, sanitização, escaping e rejeição de dados inválidos. Exportação local de mensagens para revisão, sem publicar nem chamar Keycloak. A rota de localização nativa exige `manage-realm`; não deve ser ligada à conta de serviço da aplicação. Este incremento não anuncia um editor funcional antes de existir publicação restrita e prova num Keycloak descartável.

A lista de emails deixa de afirmar que a recuperação está desligada sem consultar o ambiente; enquanto não existir leitura de estado, informa apenas que o texto é definido no serviço de autenticação.

1. **Contrato do componente de email.** Inspecionar a extensão RC4 e o tema, identificar o caminho efetivo de envio, as variáveis, eventos de sucesso/erro e permissões. Não interpretar um login ou a emissão de um desafio como prova de envio de email.
2. **Editor global dos dois tipos.** Lista de variáveis própria por tipo, validação de ligação/código e validade, HTML sanitizado, logótipo C4G e pré-visualização com exemplos sem efeito. Gravação confirmada pelo serviço de autenticação; falha de publicação mantém estado de erro e não anuncia sucesso. Nenhuma resposta contém `smtpServer`, código real ou ligação de recuperação real.
3. **Ativação da recuperação.** Preparar operação explícita de configuração, com verificação prévia do SMTP, tema e domínio público, preservando o fluxo de autenticação existente. Provar utilizador conhecido/desconhecido sem enumeração, validade, uso único e conclusão da troca de palavra-passe num realm descartável antes da implantação.
4. **Histórico unificado.** Registo separado dos templates, com tipo, origem, organização quando aplicável, destinatário, instante, resultado e código de erro fechado. Captura idempotente por identificador do evento/envio. Sem corpo, código de autenticação, ligação, token ou mensagem de erro do fornecedor. Repetições técnicas não criam envios fictícios. Sucesso SMTP/API significa aceitação pelo transporte, não entrega na caixa.
5. **Retenção.** Apagar ou anonimizar o endereço no próprio registo após 90 dias, inclusive em registos de falha; uma simples ocultação na interface não cumpre a retenção. O executor é repetível, usa tempo do servidor e não apaga contas. Aplicar a mesma regra à fonte de eventos do Keycloak usada pelo histórico, para não conservar cópias dos endereços sem controlo.
6. **Configuração de remetente e resposta.** Validar nome/endereço sem quebras de linha, manter domínio de envio autorizado e mostrar o estado real do serviço. Provar que alterar a configuração não modifica o corpo de uma tentativa já fixada nem os registos anteriores.

## Validação e implantação

- 15/11/2026 — Preparado `backend/scripts/staging/configureKeycloakResend.py` para execução explícita na consola da VPS: usa as credenciais bootstrap presentes no contentor, pede a chave Resend por entrada oculta e publica apenas `smtpServer` na API interna. Host Resend, porta 587/STARTTLS, remetente `no-reply@notificacoes-teste.c4g.ai`. Recusa SMTP existente ou recuperação já ativa; relê antes e depois da escrita, renova o token após a introdução da chave e não segue redirecionamentos nem proxies do ambiente. Não guarda segredos em ficheiros nem os imprime. Cinco testes locais aprovados; ainda não executado no staging, sem teste de entrega. A confirmação pelo utilizador de que as variáveis bootstrap existem não prova que as credenciais continuam válidas.

- Testes de autorização, isolamento, sanitização, eventos duplicados/fora de ordem, falhas do IdP e eliminação efetiva de endereços na fronteira dos 90 dias.
- Migração nova, aditiva, com versão escolhida a partir do manifesto atual (há trabalho concorrente no repositório); não alterar a migração 051 já aplicada.
- Gate em Keycloak 26.8.0, PostgreSQL e SMTP descartáveis. Provar as mensagens realmente capturadas e o histórico efetivamente gravado.
- Implantação, concessões e SMTP externo são operações posteriores ao código e à prova isolada; nenhuma foi executada nesta investigação.
