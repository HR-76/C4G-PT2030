# GCNI — perfil de CPU e esperas da referência
Estado: Complete nesta recolha diagnóstica (Review concluída). Recolha diagnóstica autorizada; runtime inalterado.

Referência reposta: mesmos quatro hashes da reposição. Só PostgreSQL/Keycloak próprios; fontesQUIESCED,exposiçãoOFF no fim. Não aplicar otimizações.

Medir CPU Node (amostragem inspector local, sem porta de depuração), CPU do contentor PostgreSQL,custo de aquisição/posse de ligação, duração das consultas por classe sem texto/parâmetros e espera por locks; estatísticas de planeamento/execução do PostgreSQL e amostras de pg_stat_activity. Observer privado sem grants ao serviço; provar fingerprint antes/depois de o instalar. Capturar perfis apenas nas janelas de carga, não no seed.

27/10000,tabela/ficha,10 concorrentes. Duas janelas por cenário: controlo e perfil,5 séries de10 por janela,10 aquecimentos antes de cada. Ordem alternada entre cenários.400 pedidos medidos+80 aquecimentos. Estatísticas PostgreSQL ligadas em ambas; monitorização/CPU profiler só nas janelas perfiladas. Não tratar a diferença de duas janelas como estimativa causal precisa do overhead. Meta500ms mantida, diagnóstico não certifica capacidade.

Separar CPU, tempo de consulta cliente, execuçãoSQL, espera por pool e amostras de wait events. Somatórios de operações concorrentes não são tempo decorrido. Não interpretar pg_stat_activity active sem wait_event como prova de CPU. Perfis Node incluem também o cliente de ensaio no mesmo processo; distinguir backend,pg,Playwright/TLS,harness,idle/GC e não atribuído.

Testar preservação de callbacks/resultados/erros na instrumentação. Registar perdas ou falhas de observação, sem inventar zeros. Verificar contratos, revogação, limpeza, hashes e autorrevisão; indicar o custo dominante com limites claros.


Resultado: custo dominante SQL na verificação do esquema central (57,9–59,7% de execução+planeamento SQL das janelas perfiladas). Central+authority+projeção dominam a carga. Espera p95 por ligação ao catálogo 213,2–237,3ms; nenhuma observação de transação bloqueada em 469 amostras temporais (não exclui bloqueios curtos). CPU PostgreSQL 7,72–7,96s/50 pedidos versus Node 1,49–1,97s, em janelas 3,27–3,57s; contadores não são latência nem perfil nativo de funções PG.

400 medições+80 aquecimentos, zero erros/contratos inválidos;18 checks OIDC/segurança PASS;28 testes existentes dirigidos PASS;3 testes da instrumentação PASS;verificação independente de contagens/drain/perfis PASS. Runtime inalterado. Capacidade NOT_ACCEPTED, meta500ms preservada. Limites e autorrevisão em [histórico](../history/catalog-cpu-waits-2026-11-02.md).
