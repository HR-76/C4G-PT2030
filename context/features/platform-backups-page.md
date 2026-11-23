# Cópias de segurança na Administração C4G

Estado **Review** — 23/11/2026. Mostra ao Admin C4G o estado das cópias descritas em [Cópias de segurança do staging para o R2](staging-backups.md). Operação: [runbook](../runbooks/staging-backups.md).

## Pedido

O utilizador quer, na Administração C4G, uma secção de cópias de segurança com a data da última cópia e a lista das cópias, como no exemplo que enviou. Em 23/11/2026 a VPS confirmou a cópia diária (02:33 UTC, duas bases) e o teste de restauro de domingo (`restore-test-ok`).

## Decisões

- **Só leitura.** A página não cria, apaga, descarrega nem restaura cópias. Não há «Fazer cópia agora»: a API teria de poder executar comandos de administrador sobre a base de dados. Regra do utilizador (23/11/2026): funcionalidade sem risco de segurança, decisões no servidor.
- **Fonte:** o servidor lista os objetos da pasta de cópias no R2 (`backups/<ambiente>/`) com as credenciais que a API já tem. Nada é lido da base de dados nem guardado nela; não há migração.
- **Opt-in:** `PLATFORM_BACKUPS_RUNTIME=r2` liga a leitura; sem a variável a rota responde 503 `BACKUPS_NOT_CONFIGURED` e a página diz que as cópias não estão ligadas neste ambiente. Outro valor impede o arranque.
- **Acesso:** `GET /api/admin/directory/backups`, só Admin C4G, pela mesma verificação de sessão das restantes rotas da Administração. A resposta não contém credenciais, endpoint, bucket, prefixo nem chaves completas: só nome da base, data, tamanho e nome do ficheiro.
- **Estados, sem afirmar mais do que se sabe:**
  - «Disponível»: existem a cópia cifrada e o seu manifesto. O manifesto só é enviado depois de o envio da cópia ter sido conferido (tamanho e SHA-256).
  - «Restauro testado»: o teste semanal restaurou essa cópia com sucesso. O `restore-test.sh` passa a gravar um marcador `<carimbo>.verified.json` ao lado da cópia; a retenção apaga-o com ela.
  - «Incompleta»: há cópia sem manifesto.
- **Em dia:** cada base tem uma cópia disponível com 36 h ou menos (o mesmo limite do `status` da linha de comandos). «Última cópia boa» é a data em que todas as bases ficaram cobertas.
- **Carga:** o servidor guarda o resultado 60 s; cada pedido ao R2 tem limite de 8 s e é feito fora da transação de autorização.

## Critérios de aceitação

- Sem sessão de Admin C4G a rota responde 403 e nunca contacta o R2.
- Com cópias recentes de todas as bases, a página mostra «em dia», a data da última cópia boa, o número de cópias e a tabela (data, base, estado, tamanho, ficheiro), mais recentes primeiro.
- Com a última cópia de uma base com mais de 36 h, a página mostra um aviso e indica a base em atraso; sem cópias, diz que não há cópias.
- Uma cópia com marcador de restauro mostra «Restauro testado» e a data do teste.
- Falha do R2 mostra erro com «Tentar novamente»; não se confunde com «sem cópias».
- Objetos que o código não reconhece sob o prefixo são ignorados.
- Falhar a gravação do marcador não faz falhar o teste de restauro.

## Limites

- As bases mostradas são as que têm objetos no R2. Uma base cuja pasta desapareça por completo deixa de aparecer, em vez de aparecer em falta.
- Os marcadores de restauro só existem a partir do primeiro teste semanal depois desta alteração.
- Continuam por decidir: cópia da base do Keycloak; bucket e token só para as cópias.
