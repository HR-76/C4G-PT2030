# Ensaio Docker isolado da release candidata

Preparado para execução num computador de ensaio com Docker Engine Linux local e Docker Compose v2 compatível. Não instala Docker nem usa SSH, contexto remoto, staging ou a VPS de produção. A máquina de preparação atual não tem Docker disponível; não há resultado de construção, `compose config` ou execução de contentores para declarar como aprovado.

## Fase A — imagem candidata e PostgreSQL reais

O executor `run.cjs` cria um projeto com UUID próprio, rede interna e três volumes exclusivamente seus. Nenhuma porta é publicada. A password PostgreSQL é aleatória, criada dentro do volume privado, usada apenas no cluster sintético e eliminada com os volumes no fim. Não há binds de diretórios do host nem acesso ao socket Docker nos contentores.

O contentor de prova herda a imagem candidata sem substituir o código da aplicação e acrescenta apenas os testes. Partilha o namespace de rede do seu PostgreSQL para usar `127.0.0.1`; a exceção de transporte sem TLS é a mesma exceção explícita dos gates descartáveis, não uma opção do CLI de produção. A prova cobre bootstrap, schemas058/041, perfis, editorial/PQ1 e ciclo de contas conforme os checks do `probe.cjs`, com comandos PostgreSQL e logins limitados reais. O fornecedor OIDC é simulado pelo teste.

Esta fase **não demonstra** arranque HTTP completo da API, TLS, Keycloak/SMTP/Resend reais, R2 ou scanner. Os recibos incluem esses limites. Não existe endpoint fictício que devolva READY para substituir a prontidão real.

1. Construir a imagem candidata da revisão final usando `deploy/production/Dockerfile`, com a label `org.opencontainers.image.revision=<SHA completo>`. Disponibilizar localmente essa imagem e a imagem PostgreSQL18 por referências imutáveis reais. O executor verifica a label e nunca publica imagens.
2. Copiar `images.example.json` para um ficheiro local, preencher os digests reais e o SHA. Não há passwords nesse ficheiro. O exemplo deliberadamente não é executável.
3. Confirmar plano sem arrancar Docker nem criar recursos:

```text
node deploy/rehearsal/production/run.cjs --images /private/rehearsal-images.json --mode fresh
```

4. Num ambiente local de ensaio autorizado, executar os percursos separadamente:

```text
node deploy/rehearsal/production/run.cjs --images /private/rehearsal-images.json --mode fresh --apply
node deploy/rehearsal/production/run.cjs --images /private/rehearsal-images.json --mode full --apply
```

Cada execução cria recursos novos, verifica que o projeto não existe e faz `compose config --quiet`, preparação dos volumes, arranque PostgreSQL e execução do gate. No fim, inclusive após falha, termina apenas esse projeto e remove os seus volumes declarados. Não usa `prune`, `--remove-orphans` ou operações contra outros projetos. A imagem derivada do gate fica localmente disponível para diagnóstico; a sua eliminação posterior é opcional e limitada ao ID/tag registado pela execução.

Os recibos ficam em `.tmp/production-rehearsal-<uuid>/`: intenção, resultados sanitizados quando o gate conclui e estado de execução/limpeza, incluindo contexto e ID/tag da imagem derivada. Se a limpeza falhar, o processo termina com erro e regista `cleanup:false`; usar exclusivamente o nome do projeto registado para investigar. Nunca substituir isso por limpeza global do Docker. O executor recusa `DOCKER_HOST`, endpoints TCP/SSH, contextos denominados staging/production e motores não Linux. Um contexto indicado por `DOCKER_CONTEXT` passa pela mesma verificação e é fixado explicitamente nos comandos seguintes. Recusa `BUILDX_BUILDER`/`BUILDKIT_HOST`, inspeciona o builder `default` sem o arrancar e exige driver `docker` no endpoint local; o build usa esse builder explicitamente. A associação do builder `default` ao daemon/contexto está descrita na [documentação Docker](https://docs.docker.com/build/builders/).

## Fase B — aplicação completa e fornecedores

Preparar esta fase numa infraestrutura de aceitação separada, usando os mesmos digests e os modelos em `deploy/production`; os nomes de recursos, domínios de ensaio, contas, buckets e segredos têm de ser próprios. Não reutilizar a pasta `/srv/c4g-production` nem os seus ficheiros. O compose de produção não é invocado pelo executor da faseA.

Inputs concretos para preparar antes de arrancar a API:

| Componente | Configuração e prova necessárias |
| --- | --- |
| PostgreSQL | CA/hostname verificados, Central058/tenant041 e recibo do bootstrap; os logins da API são limitados e os de instalação não entram na API. |
| Keycloak | Realm/client OIDC, conta inicial verificada, clientes de ativação e email, provider de ativação/email e propriedades geradas. Callbacks exatos do domínio de ensaio, ponte privada e MFA opcional. |
| Convites/eliminação | `member-http.json`, `member-worker.json`, bindings reais publicados e seleção explícita do perfil editorial de produção. |
| Email/faturação | Domínio/remetente de teste verificados, transporte de teste restrito a destinatários autorizados, `billing-mail.env` e credencial SQL própria. Não enviar mensagens reais como efeito de uma repetição. |
| Armazenamento/scanner | Buckets privados de ensaio, prova das operações condicionais de R2 e ClamAV pronto. Não declarar as flags de capacidade antes da prova. |
| API/frontend | Imagem e build da mesma revisão, ficheiros privados gerados, trusted proxies verificados, cookies Secure/HttpOnly, CSRF e headers. |

Aceite a executar e registar, sem substituir os resultados por mocks:

- `/health/ready` real com HTTP200 e JSON `status=READY`, seguido de login, logout e confirmação recente de sessão com MFA opcional.
- Perfil editorial/PQ1, criação manual e importação PT2030, incluindo ficheiro/PDF autenticado.
- Convite, email, ativação, mudança de perfil, revogação e eliminação com falha/retoma controlada.
- Pedido de validação de faturação e entrega pelo worker próprio; edição/publicação de email de autenticação e consulta do histórico.
- Duas entidades de ensaio, isolamento de leitura/escrita/exportação e ausência de acesso implícito por C4G_ADMIN.
- Backup/restauro coerente de Central, tenants, identidade, configuração e objetos; tempo e perda admissível medidos, com monitorização e responsável.

Os dados nominais da primeira entidade e administrador de produção permanecem num ficheiro privado, por preencher pelo utilizador. Identidades sintéticas desta fase não se transformam em contas de produção. A execução da faseB e o deploy continuam ações separadas; este pacote prepara os meios e não os executa automaticamente.
