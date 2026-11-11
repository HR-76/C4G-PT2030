# Recolha agendada do Funding & Tenders

Decisão de 11/11/2026: **uma recolha por dia às 04:00 de Lisboa**, pedida por uma **conta de serviço dedicada**. Fonte por omissão: `EU_FUNDING_TENDERS`. Estado: **implementado, desligado por omissão e ainda não ativado em nenhuma base habitual.**

## Como funciona

O agendador (`backend/src/fundingTenders/scheduledRefresh.js`) corre **dentro do worker de recolha** (`config/fundingTendersWorker.js`), que já constrói o repositório com todas as capacidades que a API usa. Desvio deliberado do executor do chat (comando do sistema): aqui um processo à parte teria de reconstruir essa composição e de verificar o estado do worker; dentro do worker, ambos são garantidos.

- A cada minuto verifica se já passou a hora marcada (hora de Lisboa, com horário de verão) e, se sim, pede **uma** recolha por fonte e por dia com `repository.enqueue(serviceUserId, requestId, source)`.
- O `requestId` deriva do dia e da fonte. Reiniciar o worker, um segundo worker ou repetir o pedido é o mesmo pedido, nunca uma segunda recolha. Se o worker estava desligado às 04:00, pede ao arrancar nesse dia.
- Estado da fonte: fonte suspensa/quiescente, fence desatualizado, escritor EU em falta ou worker por atualizar → **salta o dia** e regista `FUNDING_REFRESH_SKIPPED` (sem alarme; volta a tentar no dia seguinte). Outra recolha em curso (`FUNDING_BUSY`) → repete de 10 em 10 minutos, até 6 tentativas. Erros de configuração (por exemplo conta revogada) → `FUNDING_REFRESH_FAILED` uma só vez por dia.
- Os registos (`stdout` do worker, uma linha JSON) têm só evento, fonte, dia, estado do pedido e motivo; nunca o utilizador de serviço nem mensagens de erro.
- O processamento da recolha é o normal (mesmas verificações de fonte, fence e escritor EU): **o agendador não contorna nada** a não ser o requisito de autenticação recente do ecrã Fontes, que não se aplica a um serviço.

## Conta de serviço

Utilizador global `ACTIVE` com atribuição `C4G_ADMIN` `ACTIVE`, **sem referência de identidade** (ninguém consegue autenticar-se com ela) e sem memberships. Fica como `requested_by` em `funding_run`, por isso a auditoria distingue o que é agendado do que um administrador pediu. Email técnico `funding-scheduler@service.c4g.invalid` (domínio inválido; não recebe correio).

## Ativar (local)

```powershell
node backend/scripts/localPlatform/fundingServiceAccount.js          # simulação: não escreve nada
node backend/scripts/localPlatform/fundingServiceAccount.js --apply  # cria a conta e liga a agenda em runtime.json
```

`--apply` guarda cópia de `runtime.json` em `.tmp/local-platform/funding-schedule-backup-*`, cria a conta numa transação, confirma que mais nada mudou (memberships, grants, outros utilizadores e administradores, referências de identidade) e escreve `funding.schedule = {userId}` em `runtime.json`. A agenda só começa quando o worker for **reiniciado**.

Configuração opcional em `runtime.json` (`funding.schedule`): `sources` (lista) e `at` (`HH:MM`, por omissão `04:00`).

## Fora do perfil local

O worker lê estas variáveis de ambiente (o perfil local deriva-as de `funding.schedule`); qualquer valor inválido impede o arranque do worker:

| Variável | Valor |
| --- | --- |
| `FUNDING_TENDERS_SCHEDULE` | `daily-v1` (omitida = desligado) |
| `FUNDING_TENDERS_SCHEDULE_USER_ID` | UUID do utilizador de serviço (obrigatório) |
| `FUNDING_TENDERS_SCHEDULE_SOURCES` | lista separada por vírgulas, subconjunto das fontes aprovadas; por omissão `EU_FUNDING_TENDERS` |
| `FUNDING_TENDERS_SCHEDULE_AT` | `HH:MM`, por omissão `04:00` |

Em produção, criar a conta de serviço como administrador da Central (as duas linhas descritas acima) com autorização própria.

## Antes de ativar na base habitual

1. A fonte EU está `QUIESCED` e o escritor registado está desatualizado: sem os passos 2 a 4 do [plano de reativação](../references/opportunity-v2/eu-writer-v2.1-reactivation.md), todas as manhãs o agendador salta (`FUNDING_REFRESH_SKIPPED`). Não faz mal, mas também não recolhe.
2. O worker de recolha tem de estar a correr (`npm run dev:worker` ou o supervisor).
3. Cada recolha real contacta a API pública da Comissão Europeia (cerca de 12 pedidos por varredura) e cria dados na Central habitual.

## Verificar

Procurar no `stdout` do worker `FUNDING_REFRESH_REQUESTED` (com `runId`) ou `FUNDING_REFRESH_SKIPPED` (com `reason`) à volta das 04:00; ver o histórico em ADMIN → Fontes. Alerta mínimo: nenhum dos três eventos num dia com o worker ligado às 04:00.
