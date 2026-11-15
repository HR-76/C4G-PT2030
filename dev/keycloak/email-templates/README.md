# Publicação restrita de emails de recuperação

SPI experimental para **Keycloak 26.8.0**, validado apenas no Keycloak temporário com base própria e SMTP de captura. Não instalar em staging/produção sem o gate respetivo e autorização de deploy. O SPI JPA do Keycloak não tem garantia de estabilidade; a versão do servidor e a distribuição de compilação ficam fixas.

## Compilar e verificar

Na raiz do repositório, com o JDK 23 local e o ZIP oficial já presente em `.tmp/email-authentication-download/keycloak-26.8.0.zip`:

```powershell
python -B dev/keycloak/email-templates/build.py
node dev/keycloak/email-templates/test/contracts.cjs
```

O script valida o SHA-256 da distribuição, compila com `--release 21` contra os JARs oficiais e cria `.tmp/email-templates-build/c4g-email-templates-26.8.0.jar`. Não usa rede/Maven. O teste compara o compilador Java independente com o compilador Node, incluindo HTML sanitizado, listas, links, aspas, argumentos literais, logótipo, espaços Unicode e pedidos malformados. O gate de integração separado instala o JAR numa instância nova antes do arranque; nenhum destes comandos contacta SMTP.

## Superfície autorizada

Só `GET` e `PUT /realms/{realm}/c4g-email-templates/password-reset`. O token tem de passar a validação nativa do Keycloak, ter audiência e `azp` `c4g-email-templates`, pertencer à conta de serviço atual desse cliente confidencial ativo e conter o papel de cliente `publish-password-reset`. O mesmo papel é verificado novamente na conta atual. O provisionamento deve usar cliente apenas de serviço, `fullScopeAllowed=false`, mapper de audiência e atribuição explícita desse papel. Não atribuir papéis de `realm-management`. O endpoint recusa consultas e não aceita realm, locale, client, SMTP, links reais de recuperação ou destinatários no corpo.

Pedido PUT fechado, máximo 256 KiB, sem chaves desconhecidas/duplicadas:

```json
{
  "action": "SAVE",
  "expectedRevision": 0,
  "idempotencyKey": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "actorId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "template": { "subject": "...", "html": "..." },
  "messages": { "passwordResetSubject": "...", "passwordResetBody": "...", "passwordResetBodyHtml": "..." },
  "logoUrl": null
}
```

`template` é a fonte já sanitizada pelo backend. Java valida independentemente a estrutura e recompila os três valores `MessageFormat`, exigindo igualdade com `messages`; links e validade têm de estar em ambos os corpos. Só os argumentos nativos 0 (link) e 3 (validade formatada) podem ser ativos. HTML é conteúdo de mensagem, nunca uma nova expressão/template FreeMarker. `RESET` exige a fonte original C4G; cria uma nova revisão, não elimina histórico. `actorId` é o editor C4G fornecido pelo backend autorizado; a identidade da conta de serviço é obtida do token/conta Keycloak e guardada separadamente na auditoria.

GET inicial devolve exatamente `{"revision":0,"configured":false}`. Após publicação, GET/PUT devolvem exatamente `revision`, `configured:true`, `action`, `actorId`, `updatedAt` (UTC), `template`, `messages`, `logoUrl` (incluindo null explícito). Nunca devolvem SMTP, token ou detalhes internos. Erros são apenas `{"code":"..."}`, sem eco de corpos/segredos.

## Transação, cache e deriva

O bloqueio pessimista da linha estável do realm serializa até as primeiras publicações concorrentes. Depois do bloqueio, as entidades do realm/localizações são refrescadas e o delegate de escrita regista invalidação da cache Keycloak. Uma transação JPA contém a comparação de revisão, as três mensagens por locale, a versão imutável e a atualização do apontador da revisão atual. Falhas marcam rollback.

Os locales incluem `en`, o default e todos os suportados, no máximo 32 e apenas tags BCP 47 canónicas. Não há mudança silenciosa de configurações de idioma. A primeira operação exige ausência das três chaves geridas. A partir da primeira publicação, GET e PUT verificam igualdade com a revisão guardada e com o conjunto de idiomas. Mudanças externas devolvem `EMAIL_PUBLICATION_DRIFT`; não são sobrescritas. As restantes chaves de tradução, SMTP e fluxos mantêm-se.

A chave de idempotência é única por realm, com SHA-256 do pedido canónico e UUIDs normalizados. Repetir o pedido da revisão **ainda atual** devolve o recibo original, após verificar deriva. Payload diferente com a mesma chave devolve `IDEMPOTENCY_CONFLICT`; repetir uma revisão já substituída devolve `STALE_REVISION`, evitando apresentar uma versão antiga como publicada. A revisão esperada é comparada depois do bloqueio.

## Armazenamento e operação

Liquibase cria `C4G_EMAIL_TEMPLATE_VERSION` (histórico append-only com fonte, mensagens, editor, conta de serviço e hora do servidor) e `C4G_EMAIL_TEMPLATE_HEAD` (apontador atual). Não guarda destinatários, códigos ou links reais. O histórico fica fora dos atributos eager do realm. O formato NCLOB segue as traduções/atributos Keycloak; o gate H2 não substitui validação PostgreSQL antes de deploy. A migração inicial só deve ser editada enquanto não publicada. Remover o JAR não reverte automaticamente as traduções publicadas nem elimina tabelas/histórico; rollback de conteúdo deve ser uma publicação explícita.

Referências oficiais usadas: [extensões REST/JPA](https://github.com/keycloak/keycloak/blob/26.8.0/docs/documentation/server_development/topics/extensions.adoc), [BearerTokenAuthenticator](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/services/managers/AppAuthManager.java), [modelo JPA do realm](https://github.com/keycloak/keycloak/blob/26.8.0/model/jpa/src/main/java/org/keycloak/models/jpa/RealmAdapter.java).
