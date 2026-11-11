# Carregamento do diretório da organização

Estado: In Progress. Reduzir a espera na página Pessoas sem alterar as regras de acesso ou os contratos HTTP.

Após a leitura autorizada do contexto, a lista de pessoas pode ser solicitada enquanto as unidades são carregadas. Não mostrar dados da lista até a leitura de unidades ter terminado com sucesso, quando exigida. A recusa ou falha das unidades deve ocultar o contexto e invalidar respostas pendentes. Mudança de organização, separador, filtros ou novas consultas continua a invalidar respostas antigas. As páginas Perfil e Unidades mantêm os respetivos pedidos e permissões.

Aceitação: regressões para ordem dos pedidos, falha de unidades e respostas tardias, isolamento de organização e funcionalidades existentes; suites frontend/backend e build. Medições sintéticas não são latência de produção.

## Verificação inicial — 10/11/2026

Antes da alteração, a regressão confirmou que a consulta de pessoas não arrancava enquanto unidades aguardava. Depois, com servidor sintético e 400 ms de atraso em cada resposta, contexto terminou em 401 ms; unidades e pessoas começaram no mesmo milissegundo e terminaram em 414/415 ms. Foi observada a lista sintética no navegador. Unidades continua a consultar contexto e unidades sequencialmente (412 e 402 ms); Perfil consultou apenas contexto (403 ms). Não são medições do ambiente habitual nem uma comparação A/B de tempos de abertura.

Regressões focadas: 27 PASS, incluindo contexto recusado, falha de unidades e troca de organização com respostas em atraso. Suite frontend: 848 PASS antes da última adição de teste; build PASS. Suite backend: 2793 PASS e 7 SKIP na repetição com ligações locais permitidas; a primeira execução na sandbox falhou em testes de rede com EACCES. Sem alterações de backend, bases, implantação ou segurança dos endpoints.
