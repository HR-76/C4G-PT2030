# GCNI-CAT-01 — G2: schemas e testes de contrato isolados

G1 aprovado explicitamente pelo utilizador em 01/11/2026. Este pacote cumpre o incremento pedido: schemas e casos de teste. Não implementa APP, API, tokens, SQL, projeções persistidas ou conectores. Não importa módulos da aplicação, lê .env ou inicia serviços.

## Conteúdo

- `schemas/catalog-read.schema.json`: JSON Schema draft 2020-12, 48 definições, DTOs e envelopes de todas as operações G1; queries no formato HTTP (strings), tipos exatos e campos obrigatórios/nullable.
- `fixtures/valid.json`: 18 raízes de exemplo, sintéticas, incluindo todas as secções e tipos de pedido.
- `fixtures/cases.json`: casos positivos/negativos identificados, sem dados operacionais.
- `validate.cjs`: harness puro para Ajv e invariantes que JSON Schema padrão não exprime, incluindo calendário, equivalência local/UTC, contagem da página, TTL, limites de bytes e vínculos de fixtures.
- `contract.test.cjs`: suite Node; não testa servidor ou base real.
- `integration-scenarios.json`: cenários concretos para API/persistência/autoridade futuras, todos `not_executed` nesta etapa.
- `offline-guard.cjs` e `run-tests.py`: execução sem rede pelas APIs usadas pelo harness, sem escrita/processos-filhos no processo Node e com ambiente reduzido.

## Executar

Na pasta `experiments/catalog-read-g2` do GCNI:

```powershell
python run-tests.py
```

Opcionalmente `--report <caminho>` guarda a saída pelo launcher Python. Fora do GCNI usar `--deps-root <pasta-backend-do-GCNI>`. Nenhuma instalação é feita: usa Ajv 8.20.0 e ajv-formats 3.0.1 já disponíveis no backend, sem carregar o seu entrypoint. Node >=24.5 e Python são necessários. O teste não entra automaticamente na suite da aplicação nem altera package/lockfiles do backend.

O processo Node usa o permission model sem autorização para escrita, subprocessos ou addons. Leitura é permitida para resolver dependências e fixtures; não constitui isolamento de leitura do sistema inteiro. O launcher remove variáveis da aplicação e NODE_OPTIONS. O guard bloqueia chamadas HTTP/TCP/fetch usadas por este pacote; é defesa adicional para código conhecido, não sandbox para código hostil. Não há chamadas a fontes nem bases.

## Schema e semântica

O schema é estrito para os produtores desta versão. Não usar remoção de campos, coerção de tipos ou preenchimento automático de defaults. Uma versão futura aditiva necessita de atualização explícita do schema produtor; consumidores podem ignorar campos opcionais futuros, conforme G1.

Formatos locais obrigatórios: civil-date, utc-instant, local-datetime, known-timezone, public-https, decimal-exact, rate-decimal e uuid-csv. O harness regista-os explicitamente; um validador que ignore formatos NÃO oferece a mesma prova. UUID usa também ajv-formats e restrição de versão/variant. Validação cruzada de objetos/respostas é aplicada depois do schema, sem mutar o input.

Decisões de concretização compatíveis com G1: TemporalDate é o objeto discriminado `Date`; `limit` em query HTTP é a string `25` e no envelope é o inteiro 25; instantes conservam a equivalência do UTC com fuso/horário original; conflito exige ao menos duas alternativas distintas; geração fixa asOf e o snapshot expira 900 segundos depois. A comparação de fixtures lista/ficha não verifica assinatura de tokens nem implementa snapshot.

Moeda/namespace sintaticamente válidos não significam pertença a registos oficiais. Reconhecimento de moeda/programa/fonte, sanitação e políticas completas de URL, referência a evidências fora da amostra, autorização, ordenação entre páginas e seleção do próximo prazo dependem do domínio/API. Nunca usar o schema como autorização ou como garantia de segurança de downloads/SSRF. Strings de texto são dados: o rendering inerte será testado na UI.

## Limites da entrega

Testes passados validam schemas, exemplos e invariantes locais. Não comprovam revogação OIDC, tenancy, paginação real sob concorrência, imutabilidade SQL, idempotência de recolhas, geração/assinatura/expiração efetiva dos tokens, desempenho, acessibilidade ou compatibilidade da APP. Esses critérios continuam pendentes e têm cenários próprios. Fontes permanecem sem qualquer ação de reativação; estado vivo não é consultado.

Próximo passo: adaptar os modelos/projeções do GCNI para o contrato aprovado e preparar os ensaios de persistência em base isolada, antes de ligar o serviço de leitura.
