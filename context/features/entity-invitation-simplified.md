# Convite de entidade simplificado no Admin

Estado **Review** — 24/11/2026. Pedido do utilizador depois de auditar o fluxo de adesão: «Quero apenas enviar o convite», manter o estado, e «quando o cliente faz submeter os dados da ficha fica como aceite». Complementa [adesão restrita](platform-entity-invited-registration.md), [email e identidade C4G](entity-invitation-email-and-branding.md) e [adesão no staging](staging-entity-admission.md).

## O que muda

**Um só passo para enviar.** «Novo convite» pede o nome e o email do primeiro administrador; «Enviar convite» cria o convite, prepara a conta e emite e envia a ligação, de seguida. Deixam de existir os botões «Rever convite», «Criar convite», «Preparar conta» e «Emitir ligação». Os pedidos ao servidor são os mesmos de antes, pela mesma ordem e com as mesmas chaves de idempotência; só deixam de ser três cliques.

**Quatro estados, calculados no servidor** (a listagem devolve `state` e `detail`; a página só os traduz):

| Estado | Quando | Nota |
| --- | --- | --- |
| Convite enviado | a ligação foi emitida e está válida, ou a pessoa já a abriu e está a preencher a ficha | «Ficha em preenchimento» no segundo caso |
| Aceite | o cliente submeteu a ficha | «Entidade em criação» até a entidade ficar ativa |
| Expirado | a ligação passou da validade sem ter sido usada | |
| Cancelado | o Admin cancelou | |

Um convite criado cuja ligação ainda não saiu (falha a meio do envio) aparece como «Por enviar», com a ação de enviar.

**Duas ações na lista:** «Reenviar» (invalida a ligação anterior e envia outra; disponível enquanto a ligação não foi usada) e «Cancelar» (enquanto o convite não estiver aceite).

**Resultado do envio.** A página diz «Convite enviado por email para …» ou, se o email não sair, mostra a ligação para entrega manual com o motivo, como já fazia.

**Página do cliente.** Enquanto a entidade está em criação, uma falha ao consultar o estado deixa de aparecer como «Esta adesão já não está disponível»: essa mensagem fica só para quando o servidor diz que a adesão não existe; nos outros casos a página diz que não conseguiu confirmar o estado e deixa tentar de novo.

## O que não muda

- O percurso do cliente (ligação, palavra-passe, ficha, criação da entidade) e as regras de segurança do servidor.
- No mesmo navegador com outra conta em sessão, o Keycloak recusa, como antes.
- O modelo do email continua no código.

## Critérios de aceitação

- Com nome e email válidos, um clique em «Enviar convite» leva o convite a «Convite enviado» e mostra para quem foi.
- Se a preparação da conta ou o envio falharem, a página diz em que ponto ficou e «Tentar novamente» retoma sem duplicar o convite.
- A lista mostra, para cada convite, um dos estados acima; um convite com a ficha submetida aparece como «Aceite».
- «Reenviar» não aparece depois de a ligação ter sido usada; «Cancelar» não aparece num convite aceite ou cancelado.
- Os estados vêm do servidor: a página não os deduz das fases internas.

## Limites

- O estado do envio do email só é conhecido no momento do envio; não fica guardado, por isso a lista não diz se o email de um convite antigo foi aceite pelo serviço. Guardá-lo exige escrever na Central, o que fica para depois.
- «Aceite» significa ficha submetida. A entidade fica utilizável um a dois minutos depois, quando a criação termina.
