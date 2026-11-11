# GCNI — CPU e esperas da referência reposta
Data: 2026-11-02. Estado: Complete nesta recolha; revisão pronta a fechar.
Ensaio `4784ed114d97436cb30d82d48217c2e8`;evidências em `context/reviews/catalog-read-acceptance-load/4784ed114d97436cb30d82d48217c2e8`.

## Resultado
Maior custo SQL: verificação do esquema central,57,9–59,7% do tempo SQL (execução+planeamento,observador excluído). Pool catálogo p95 213,2–237,3ms;pool sessões secundário.469 polls,zero observações bloqueadas;cinco observações WalSync,sem evidência de I/O dominante. Não inferir inexistência de esperas curtas.

27/10000;tabela/ficha;10concorrentes;2janelas alternadas por cenário;50pedidos/janela+10warmups.400medições+80warmups válidos.10k p95 controlo:tabela592,1ms/ficha533,7ms;perfil583,4/537,6ms. Capacidade NOT_ACCEPTED. Não usar uma campanha para afirmar overhead causal.

CPU PG7,72–7,96s/50pedidos (vários núcleos);Node1,49–1,97s;janela3,27–3,57s. Node inclui cliente Playwright,TLS,evidências e profiler;perfil mostra fingerprint/canonicalização e parsing PG,mas não representa só backend. CPU PG inclui observador/fundo e fronteiras externas ligeiramente mais largas. Estatísticas PG são tempo decorrido por consulta, não perfil nativo por função C. As janelas controlo também têm pg_stat_statements e fases/sessões instrumentadas.

## Validação e autorrevisão
-18 checks OIDC/controlo PASS, incluindo drift de permissões/recovery,revogação sem dados,reversão e isolamento.
-28 testes existentes dirigidos PASS:catalogRestore,catalogReadIsolatedAdmission,coordinatedSessionStore,isolatedSessionReadConcurrency,sessionTouchCoalescing.
-3 testes de instrumentação PASS:callbacks/promises/resultados/erros/leases/touch e limpeza de falha de setup.
-Verificador independente confirmou400+80,8janelas,4perfis,zero perdas,50sessionRead+50touch por janela,SQL core/projection/authority igual entre cliente e servidor. Core=100+leaders touch e authority=150+2×leaders,coerente com validação por pedido.
-Quatro hashes da referência reposta preservados;sem alterações backend/src/frontend;nenhuma otimização de runtime.
-Setup de observador privado mantém snapshots dos esquemas admitidos;serviço passou admissão e teste negativo de privilégios.
-ExposiçãoOFF,fontesQUIESCED,zero recolhas,2contentores próprios removidos. Saída1 do launcher decorre de NOT_ACCEPTED por capacidade,não de falha funcional.
-Autorrevisão corrigiu no harness limpeza após falha de setup e preservação de Promise de touch sem callback. Caminhos não usados na campanha bem-sucedida (touch HTTP usa callback);versão executada preservada em work/catalog-cpu/executed,versão final coberta por testes. Sem repetir carga por alterações só nesses caminhos auxiliares.
-Frontend/build/suite integral não repetidos:runtime inalterado;validação dirigida e ensaio real são os checks proporcionais a esta tarefa.

## Decisão
Diagnóstico concluído;sem promoção,reativação de fontes,cache de decisões ou alteração de permissões do serviço. Manter referência. Não aumentar pools com base apenas na fila observada. Limites:uma máquina,dados sintéticos,carga aquecida,janelas curtas,sem federação externa e sem SLA de produção.

Próximo passo:decompor o plano da consulta do esquema central para localizar os subplanos caros e definir alternativa de metadados rigorosamente equivalentes antes de implementar.
