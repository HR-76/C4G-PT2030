# Evidência da investigação de contenção

Conclusões, fontes, limites e recomendação: [authority-contention.md](../../research/authority-contention.md).

- [Resultados standard](results.json): seis cenários, 35/36 sucessos, um `LEASE_TIMEOUT` reproduzido.
- [Resumo calculado](summary.json) e [log](profile.log).
- [Burst de capacidade](../authority-contention-capacity/results.json): 2/6 sucessos; cinco aquisições expiradas em três pedidos e um quarto pedido com `LEASE_TIMEOUT`.
- [Resumo do burst](../authority-contention-capacity/summary.json).
- [Scripts e instruções](../../../test/integration/http-contention/README.md).

O ensaio standard precede a adição da telemetria explícita de admissão. O burst adicional usa essa telemetria; nenhum deles altera limites ou código da aplicação. `COMPLETE` significa recolha concluída, não aprovação de desempenho.

[Baseline](baseline.json), [comparação de preservação](preservation.json), [verificação de sintaxe e artefactos](verification.json) e [hashes dos scripts](source-hashes.json). Nenhuma suite global ou build foi repetido nesta investigação: não houve alterações de código da aplicação; os scripts de diagnóstico passaram sintaxe e foram executados nos ensaios descritos.
