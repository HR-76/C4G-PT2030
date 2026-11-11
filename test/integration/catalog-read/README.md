# GCNI — serviço de leitura e ensaio isolado

Executar, a partir de um workspace com pasta work:

```powershell
python <GCNI>/test/integration/catalog-read/run-isolated.py --isolated --workspace work --report resultado.json
```

Requer PostgreSQL 18 nativo em C:/Program Files/PostgreSQL/18/bin, Node e dependências existentes. O launcher cria cluster/base próprios, conta e segredo efémeros, porta aleatória/loopback, e encerra o cluster no finally. Não aceita URL ou configuração da APP. Diagnósticos permanecem no workspace; ficheiro de password é removido.

O gate aplica a cadeia conhecida até 045 e o pacote local 046–048, testa atualização 047→048, replay/rollback/admissão, persistência, aprovações, roles e HTTP. A fonte sintética é colocada em QUIESCED pelas transições normais. Não são abertas fontes externas. Os números locais não são registos do manifesto operacional. Não executar estes SQL manualmente na base habitual.

## Composição do serviço

`backend/src/opportunities/catalogRead/readRuntime.js` exporta createReadRuntime. Recebe express, catalogPool, authorityPool, authorityLogin, policyVersion, key (Buffer privado de 32 bytes) e clock opcional. Não cria pools, lê variáveis de ambiente, abre portas ou monta rotas globais. O proprietário da composição deve fechar os pools.

Montar o router em /api/catalog-read/v1 depois do middleware de sessão GCNI existente. Nunca fornecer principal, organização, nomes de ligação, roles ou chaves a partir do cliente. O serviço consulta e revalida a store central; não cria um segundo login. O gate usa express-session/connect-pg-simple reais e cookies assinados de identidades sintéticas, sem simular uma autenticação externa OIDC como prova concluída.

Configuração do login catálogo: limitado/NOINHERIT, apenas membership não administrativa e SET na role c 4 g_catalog_projection_reader. Login autoridade: limitado/NOINHERIT, apenas membership não administrativa e SET na role c 4 g_catalog_projection_membership. Nenhuma permissão direta de tabela ao login catálogo. Nomes são configuração privada do servidor; readSchema.admitReader valida o par explícito. Sem membros concedidos à APP por este incremento.

Contrato G1/G2 intacto. Projeções 1.2 conservam inputs validados internamente para reconstruir estados no asOf; não os devolvem em HTTP. Projeções anteriores são preservadas, mas o novo serviço exige reconstrução autorizada em 1.2 antes de as consumir. Gerações vazias são válidas. Snapshots autenticados/cifrados duram 900 segundos absolutos, são vinculados ao sujeito/âmbito/versões e não autorizam acesso. Retenção atual conserva todo o histórico, sem limpeza automática.

O gate final tem 36 verificações. A suite backend e os 13 testes novos do serviço incluem keyset, contexto, expiração, filtros, temporalidade, bytes e revogação. Consulte context/features/catalog-read-isolated-service.md para resultados, matriz de aceitação e limites. A interface está integrada apenas no modo catalog-isolated. Não há ativação habitual, OIDC externo exercitado ou prova de carga 10000/p95.

## Revisão da interface isolada

A partir de frontend, construir com `node node_modules/vite/bin/vite.js build --config vite.catalog-isolated.config.js --mode catalog-isolated --outDir <workspace>/work/catalog-ui-review/dist`. A pasta de revisão deve ser filha direta de work. O build habitual mantém a interface anterior.

Acrescentar ao launcher `--ui-review <workspace>/work/catalog-ui-review`. Apenas nesta opção o gate serve o build e cria uma sessão sintética. O endereço efémero aparece em ready.json; abrir esse endereço inicializa a sessão e encaminha para /catalogo. O perfil tem membership real na base própria, mas não prova OIDC externo. Não reutilizar o helper ui-review.cjs no servidor da APP.

O controlador de testes lê command.json na pasta de revisão: `{ "id": 1, "action": "expire" }`. Cada comando usa ID diferente. Ações: expire (avança relógio sintético), reset-clock, unavailable/restore (drift de permissões controlado), revoke (suspende a membership sintética), finish (termina revisão e prossegue gate). Confirmação em ack.json. Não escrever snapshot, cookies ou credenciais nestes ficheiros. Limite de revisão: 15 minutos; o launcher encerra o cluster no finally. Uma revisão repetida deve usar uma pasta nova, evitando comandos antigos.

Interface: filtros e paginação em memória; só filtros e ID no URL. Não há importação de fontes, publicação automática ou escrita tenant. Testes em frontend/src/pages/Opportunities/CatalogReadWorkspace.test.jsx. Resultado em context/features/catalog-read-isolated-ui.md.

Próximo passo: aceitação funcional e carga representativa antes de ativação habitual.
