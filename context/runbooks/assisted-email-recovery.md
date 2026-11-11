# Recuperação assistida após perda de acesso ao email

Estado: procedimento proposto e ensaiado em laboratório em 11/11/2026. Destina-se à perda da caixa usada pela verificação adicional C4G.

## Papéis de apoio

| Papel | Responsabilidade | Acesso necessário |
| --- | --- | --- |
| Apoio de primeira linha | Abrir o pedido, localizar a conta e encaminhar para verificação. | Criar pedidos e consultar os dados mínimos para identificar a conta. |
| Verificador de identidade | Conferir presencialmente o documento com o registo institucional anterior e atestar a correspondência. | Consultar o registo autorizado e registar o resultado da verificação. |
| Aprovador de segurança | Rever a verificação e autorizar a intervenção para a conta e o endereço aprovados, com prazo. | Aprovar ou recusar o pedido e consultar o registo de auditoria. Deve ser uma pessoa distinta do verificador. |
| Operador de identidade | Executar a intervenção aprovada no Keycloak e no registo de sessões C4G. Confirmar as revogações e registar o resultado. | Permissões restritas para alterar a conta no fornecedor e revogar as sessões C4G dessa conta. A aprovação é prévia e deve constar do pedido. |

O administrador da organização pode encaminhar o pedido. A confirmação de identidade, aprovação e execução seguem os papéis acima. Estes papéis descrevem o procedimento de apoio e requerem atribuição nominal e delegação de permissões antes de uso operacional.

## Confirmar a identidade e aprovar a intervenção

1. Abrir um pedido de recuperação com referência própria e localizar a conta pelo identificador interno. Registar o novo endereço solicitado e confirmar que está disponível para esta conta.
2. Um responsável autorizado confirma presencialmente a identidade, comparando um documento apresentado com o registo institucional anterior ao incidente. Registar o resultado e o identificador do verificador. Se a identidade não puder ser confirmada por esta via, manter o pedido pendente e encaminhar para o responsável pela segurança. Conhecer a palavra-passe, controlar a caixa nova ou declarar o endereço antigo é insuficiente.
3. Um segundo responsável revê e aprova o pedido. A aprovação deve indicar a referência, a conta, o endereço de substituição, o âmbito e a validade. Uma alteração do endereço ou uma aprovação expirada exige nova validação. Registar quem aprovou e quem executou. Guardar o mínimo necessário para auditoria, sem cópias de documentos de identidade, palavras-passe, códigos ou ligações.

## Executar e confirmar a recuperação

1. Com a aprovação válida, suspender temporariamente o início de sessão e revogar as sessões do fornecedor de identidade e da aplicação. Confirmar a revogação antes de devolver o acesso.
2. Registar o endereço novo como ainda por verificar. Invalidar a palavra-passe anterior, os desafios ligados ao endereço perdido e a credencial de verificação por email correspondente. Preservar os restantes fatores. Configurar as ações obrigatórias de confirmação do novo email, definição de nova palavra-passe e reativação da verificação adicional C4G. Confirmar que as ações estão configuradas antes de reabrir a conta.
3. Emitir uma ligação de validade curta para a caixa nova. O titular abre a ligação, define a nova palavra-passe e confirma a reativação com um código recebido nessa caixa. Se a entrega ou qualquer ação obrigatória falhar, manter o caso aberto e conter novamente o acesso até resolver a falha.
4. Confirmar um novo início de sessão com a nova palavra-passe e o código C4G. Confirmar a rejeição da palavra-passe anterior e a invalidação das sessões anteriores. Registar o resultado e encerrar o pedido.

## Evidência do ensaio

Keycloak 26.8.0 com a extensão C4G, PostgreSQL e Mailpit descartáveis. O Chrome usou um cliente OIDC de ensaio com PKCE. A conferência presencial foi simulada com um documento fictício comparado com um registo de teste anterior ao pedido. O verificador e o aprovador tinham chaves de ensaio distintas e atestaram a mesma conta e endereço novo.

- Uma sessão nova sem acesso ao código do email antigo ficou sem código de autorização OIDC.
- Um documento divergente, uma aprovação que reutilizava a identidade do verificador e a troca do endereço após aprovação foram recusados. O perfil e a credencial permaneceram iguais.
- Após aprovação, a ligação de cinco minutos foi entregue apenas à caixa nova. O endereço manteve o estado por verificar até à abertura da ligação. A troca da palavra-passe manteve pendente a ação obrigatória de reativação por email, concluída com um código da caixa nova.
- Um novo início de sessão aceitou a palavra-passe nova e o código da caixa nova. A palavra-passe anterior e a renovação da sessão OIDC anterior foram recusadas. A caixa antiga não recebeu mensagens durante a intervenção.

### Sessões C4G e autenticador TOTP

Uma segunda prova usou a aplicação C4G em Chrome, com composição real do backend, OIDC, Central e tenant descartáveis. Foram abertas duas sessões da conta a recuperar e uma sessão de controlo de outro utilizador da mesma organização.

- Depois da suspensão e do logout no Keycloak, as duas sessões antigas ainda respondiam `200` no endpoint de sessão C4G. A revogação explícita no registo central (`revokeUser`) mudou as duas sessões para `REVOKED`, eliminou os registos correspondentes do armazenamento de sessão e fez as duas sessões responderem `401`. A sessão de controlo continuou a responder `200`.
- A substituição do fator de email manteve o identificador e a data de criação do autenticador TOTP original. Depois da recuperação, a C4G recusou acesso enquanto a conta não apresentou esse TOTP e o código da caixa nova. O novo início de sessão e o Dashboard passaram e as duas sessões antigas continuaram recusadas.

O ensaio usou a operação interna de revogação C4G através do executor de laboratório. Antes de uso operacional, falta atribuir nominalmente os papéis, validar a conferência presencial e disponibilizar um meio autorizado e auditado para o operador executar a revogação. A preservação foi verificada com TOTP, sem ensaio de passkeys ou outros fatores.
