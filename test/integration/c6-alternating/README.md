# Comparação C6 alternada

Na raiz: `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/c6-alternating/run.ps1`.

Usa o harness capacity existente sem o editar, em seis fixtures novas, ordem A/B/A/B/A/B. A são os três ficheiros anteriores guardados em `grouped-authority-validation/before`; B são as fontes atuais com hashes fixados no relatório desse incremento. O preload compila apenas esses módulos sob o filename original, mantendo resolução, branding e protocolo. Ambos os lados usam o mesmo observador adicional; as fontes do worktree não são substituídas. O processo recusa contextos ou hashes diferentes e regista os três módulos efetivamente carregados.

Antes de cada execução: mesmo plano de energia, configuração/imagens Docker e conjunto de contentores anteriores; três intervalos de um segundo CPU total ≤25%, memória livre ≥4 GiB; CPU agregada dos contentores anteriores ≤10% de um core. Não para processos/contentores anteriores nem muda energia/afinidade/limites. Durante a prova, amostra CPU/memória do host, CPU/event loop Node a cada 500 ms e CPU dos contentores anteriores a cada cinco segundos. As consultas Docker acrescentam overhead igual nos dois lados; CPU de contentor tem escala por core, CPU do host é normalizada por todos os cores. Não grava nomes, comandos ou ambiente dos processos.

Só os runners existentes criam/limpam as suas fixtures por UUID e label. O runner externo verifica que os contentores anteriores sobrevivem. Recusa sobrescrever pastas de resultados. Preserva falhas, aquecimentos, contagens, configuração e dados brutos; interferência observada não é apagada nem convertida em sucesso.

Não é um host dedicado: não controla frequência efetiva, temperatura, todos os processos Windows ou serviços externos ao Docker. O protocolo reduz e observa interferência, não prova ausência de interferência. Os três pares e seis pedidos por burst não aprovam capacidade produtiva. Um p95 de seis amostras é o máximo empírico, não estimativa estável de cauda. Não misturar estes tempos com ensaios sem este observador.
