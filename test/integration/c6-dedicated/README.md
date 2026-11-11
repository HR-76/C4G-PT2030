# C6 com ordem equilibrada e SLO aprovado

Harness exclusivamente de prova local, com [protocolo](../../../context/reviews/c6-dedicated-slo/protocol.json) e reserva explícita do computador pelo utilizador.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/c6-dedicated/run.ps1
node --test test/integration/c6-dedicated/slo.test.js
node test/integration/c6-dedicated/analyze.js
```

## Critério obrigatório de regressão

A [decisão aprovada](../../../context/decisions/2026-10-27-c6-admission-slo.md) fixa a política versionada [policy.json](policy.json): **p95 de admissão ≤3000 ms, máximo ≤4000 ms, margem ≥1000 ms para timeout fixo de 5000 ms e zero erros HTTP/admissão**, separadamente por variante. A CLI não aceita overrides. Usa os valores disponíveis sem arredondamento adicional para decidir; os quantis apresentados são arredondados.

Para aprovar uma série completa futura, a etapa obrigatória é:

```powershell
node test/integration/c6-dedicated/gate.js context/reviews/NOVA-SERIE/comparison.json
if ($LASTEXITCODE -ne 0) { throw 'C6_REGRESSION_GATE_FAILED' }
```

`gate.js` é read-only: confere hashes, manifests das fontes A/B, ordem, 72 respostas/216 admissões, aquecimentos, políticas, checks de autoridade, contagens de protocolo/auditoria e telemetria; recalcula o SLO. Só PASS devolve **exit 0**. Regressão, ambiente inválido, evidência ausente/inconsistente ou falha de leitura devolvem **exit 1** e código seguro. `COMPLETE` e exit 0 do analisador de diagnóstico não substituem este gate.

`run.ps1` confere o SLO antes de operar contentores e chama análise/gate **depois do finally de reposição do host**, guardando `regression-gate.json` em UTF-8. Uma falha do gate termina o runner com erro. As execuções históricas mantêm os artefactos originais; não lhes é acrescentado um novo resultado automaticamente.

Testes focados, sem executar carga:

```powershell
node --test test/integration/c6-dedicated/slo.test.js test/integration/c6-dedicated/gate.test.js
node test/integration/c6-dedicated/gate.js context/reviews/c6-dedicated-slo-repeat/comparison.json
```

O gate suporta novos diretórios de evidência no workspace. O executor desta comparação continua a fixar os três módulos e nomes históricos: para uma nova variante, preparar antes da carga um novo protocolo, destinos permitidos e manifests de fontes (`hashes` para A, `sourceHashes` para B), sem sobrescrever os anteriores. A política de SLO mantém-se; alterar workload, invariantes ou critérios exige revisão explícita, não relaxamento para obter PASS.

O runner recusa reusar o relatório. Os comandos de teste/análise devem correr depois dos workloads. Nova série exige nomes/pastas novos e atualização explícita da allowlist do preload, preservando os resultados anteriores.

Ordem fixada no protocolo: AB, BA, AB, BA, AB, BA; A=antes dos três agrupamentos, B=depois. Doze fixtures novas, um aquecimento e seis pedidos concorrentes por burst. O profile capacity e a instrumentação HTTP originais são chamados sem alterações. `preload.js` difere do observador anterior apenas na allowlist de nomes de relatório; mantém hashes fixados e todos os métodos/validações. `hostCheck.js` é idêntico ao anterior.

O runner admite apenas os dois contentores anteriores identificados (`c4g-postgres17-dev`, `c4g-collabora-code`), inicialmente running e não paused. Pausa-os, verifica a ausência de outros contentores entre fixtures e retoma exatamente os pausados por esta execução no finally. Não elimina contentores/volumes Dev nem usa as bases Dev. Só o runner capacity original remove as suas fixtures, por UUID/label. Se o processo for terminado abruptamente, conferir o estado registado em host-control.json e repor manualmente os contentores nele identificados.

Regista plano de energia, recursos e imagens Docker; recusa drift. Antes de cada execução exige três intervalos CPU ≤25% e memória livre ≥4 GiB. `background.ps1` observa o conjunto inicial acessível de processos Windows, sem nomes/comandos/ambiente nos resultados, excluindo a plataforma Docker/WSL que aloja a prova e os processos de controlo. A média é ponderada pela duração das amostras que intercetam C6. Média >5%, amostra >10%, lacuna >5 s, observador incompleto ou memória insuficiente invalidam o ambiente para PASS. Processos novos/inacessíveis, frequência efetiva e temperatura não estão totalmente atribuídos/controlados; a reserva é operacional, não prova de isolamento físico.

`slo.js` avalia cada variante contra os limites aprovados e preserva erros/tentativas falhadas. p95 nearest rank sobre as admissões medidas (108 por variante se todos os pedidos terminarem), máximo ≤4 s em todos os bursts, margem ≥1 s para o timeout 5 s, p95 ≤3 s e zero erros. `INVALID_ENVIRONMENT` e `INCOMPLETE_EVIDENCE` nunca são PASS, mesmo com bons tempos; os resultados observados ficam disponíveis. Um SLO não aprovado é recusado. Os testes verificam fronteiras, máximo oculto por p95 baixo, p95 excessivo, erros com timings bons e falta de evidência/isolamento.

A análise compara hashes carregados, políticas, checks de segurança, SQL/protocolo/auditoria, resposta e fonte do SLO; separa diferenças por ordem AB/BA. Não aumentar limites, mudar o SLO depois de observar resultados, eliminar bursts desfavoráveis ou inferir capacidade produtiva de uma série local.


A repetição preservada usou `run.ps1 -Report c6-dedicated-slo-repeat -Prefix c6-dedr` e `node test/integration/c6-dedicated/analyze.js c6-dedicated-slo-repeat`. Os dois destinos já existem e não devem ser reexecutados por cima. O contador exige versão `fractional-double-v2`, com ambos os argumentos de Math.Max explicitamente double. `observer.test.ps1` verifica incrementos fracionários e amostragem real; executar sem workloads concorrentes. A primeira série com contador v1 é INVALID_ENVIRONMENT e permanece integralmente preservada.

A série seguinte usou `run.ps1 -Report c6-regression-20261027-01 -Prefix c6-reg1`, com manifests próprios conferidos contra os mesmos pins A/B. Esse destino também está ocupado e não deve ser reutilizado. [Resultado](../../../context/reviews/c6-regression-20261027-01/README.md): 72/72 respostas, mas gate automático FAIL/INVALID_ENVIRONMENT e máximos fora do SLO. O runner devolveu 1 após retomar os serviços. `protocol.json` é finalizado antes da análise; o veredicto final fica em `regression-gate.json`, sem alterar os hashes já analisados.
