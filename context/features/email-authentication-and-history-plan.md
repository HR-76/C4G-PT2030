# Emails de autenticação, configuração e histórico

Estado: decisões de produto confirmadas em 14/11/2026; integração técnica em investigação. Complementa [o contrato de email](email-templates-and-configuration.md). Não está implementado nem ativo.

## Decisões confirmadas

- Ativar a recuperação de palavra-passe por email, além de disponibilizar a edição do texto.
- Histórico dos três tipos: convite, reposição de palavra-passe e código por email.
- Endereços dos destinatários no histórico: retenção de 90 dias. Esta regra aplica-se ao histórico de envios, não elimina o endereço necessário à conta ativa.
- Só o Admin C4G configura os templates; os dois tipos do Keycloak são globais.
- Segredos SMTP e Resend continuam fora da interface e das respostas HTTP.

## Evidência técnica

- O repositório documenta a extensão externa `c4g-email-verification-26.7.2-c4g.1-rc4.jar`, SHA-256 `1B42592628DBA8E02D6F56031F0B52802FD2C3704727FC189EBF126D8BC951DE`, validada em Keycloak 26.8.0. Não foram encontrados o JAR nem as suas fontes neste checkout ou nas cópias locais consultadas. Pediu-se a localização ao utilizador.
- `backend/scripts/localPlatform/identityLocalization.js` configura apenas o idioma do realm; não demonstra a edição dos textos de email.
- No [provider oficial do Keycloak 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/email/freemarker/FreeMarkerEmailTemplateProvider.java), a recuperação usa `passwordResetSubject` e `password-reset.ftl`. É necessário confirmar os templates e as mensagens efetivamente carregados pelo tema e pela extensão de código antes de escolher as chaves de configuração.
- O contrato exige uma conta de serviço restrita. A revisão do [recurso administrativo oficial](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/services/resources/admin/RealmAdminResource.java) faz parte da análise de permissões; não conceder administração geral do realm por conveniência.
- Docker, Maven e `psql` não estão disponíveis no PATH desta máquina. A prova em Keycloak/PostgreSQL descartáveis precisa de ambiente isolado identificado; não usar as bases habituais para suprir essa ausência.
- O utilizador não sabe onde está o artefacto. Pesquisa adicional no perfil local (excluindo caches, AppData e node_modules) também não o encontrou. Tentou-se consultar apenas os nomes dos JAR em `/srv/c4g-staging/keycloak-providers` pela ligação SSH já conhecida: primeira tentativa expirou antes da autenticação; a segunda foi reposta pelo servidor durante a negociação. Nenhum comando remoto chegou a executar. A continuidade da inspeção do componente depende de acesso SSH funcional ou da recuperação do artefacto/fontes.

## Incrementos e critérios de aceitação

1. **Contrato do componente de email.** Inspecionar a extensão RC4 e o tema, identificar o caminho efetivo de envio, as variáveis, eventos de sucesso/erro e permissões. Não interpretar um login ou a emissão de um desafio como prova de envio de email.
2. **Editor global dos dois tipos.** Lista de variáveis própria por tipo, validação de ligação/código e validade, HTML sanitizado, logótipo C4G e pré-visualização com exemplos sem efeito. Gravação confirmada pelo serviço de autenticação; falha de publicação mantém estado de erro e não anuncia sucesso. Nenhuma resposta contém `smtpServer`, código real ou ligação de recuperação real.
3. **Ativação da recuperação.** Preparar operação explícita de configuração, com verificação prévia do SMTP, tema e domínio público, preservando o fluxo de autenticação existente. Provar utilizador conhecido/desconhecido sem enumeração, validade, uso único e conclusão da troca de palavra-passe num realm descartável antes da implantação.
4. **Histórico unificado.** Registo separado dos templates, com tipo, origem, organização quando aplicável, destinatário, instante, resultado e código de erro fechado. Captura idempotente por identificador do evento/envio. Sem corpo, código de autenticação, ligação, token ou mensagem de erro do fornecedor. Repetições técnicas não criam envios fictícios. Sucesso SMTP/API significa aceitação pelo transporte, não entrega na caixa.
5. **Retenção.** Apagar ou anonimizar o endereço no próprio registo após 90 dias, inclusive em registos de falha; uma simples ocultação na interface não cumpre a retenção. O executor é repetível, usa tempo do servidor e não apaga contas. Aplicar a mesma regra à fonte de eventos do Keycloak usada pelo histórico, para não conservar cópias dos endereços sem controlo.
6. **Configuração de remetente e resposta.** Validar nome/endereço sem quebras de linha, manter domínio de envio autorizado e mostrar o estado real do serviço. Provar que alterar a configuração não modifica o corpo de uma tentativa já fixada nem os registos anteriores.

## Validação e implantação

- Testes de autorização, isolamento, sanitização, eventos duplicados/fora de ordem, falhas do IdP e eliminação efetiva de endereços na fronteira dos 90 dias.
- Migração nova, aditiva, com versão escolhida a partir do manifesto atual (há trabalho concorrente no repositório); não alterar a migração 051 já aplicada.
- Gate em Keycloak 26.8.0, PostgreSQL e SMTP descartáveis. Provar as mensagens realmente capturadas e o histórico efetivamente gravado.
- Implantação, concessões e SMTP externo são operações posteriores ao código e à prova isolada; nenhuma foi executada nesta investigação.
