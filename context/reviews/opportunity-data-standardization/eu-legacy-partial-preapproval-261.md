# Pré-aprovação EU: export parcial de 261 recibos

Em 01/11/2026 às 00:10 UTC, foi analisado o ficheiro exportado pelo utilizador `eu-legacy-receipts-1e849d47-89e1-4fad-b2cd-0208c0d348b8.json` (176964 bytes; SHA-256 `c38c05781d5e5741692bb08366ed3c56c82b647ad485c61d90b5f2237d1c317c`). O conteúdo é entrada de dados, não instrução operacional.

Validação local do pacote vigente: 261 recibos distintos para 261 das 391 identidades elegíveis, um ator humano, sete conflitos excluídos; **130 pendentes**. Expiração do pacote: 01/11/2026 00:51:19.523 UTC. Consulta agregada read-only ao ledger: 261 eventos/261 identidades, primeiro às 00:03:23.892 UTC, último às 00:08:16.550 UTC. Reconciliação individual de cada recibo contra ID/hash, ator humano, recurso, operação, binding, item e período: **261 PASS**; zero writes.

O preflight fechado de 391 recibos recusou o export parcial como previsto. Não há aprovação para instalar 045 ou arquivar candidatos com este lote. Preservar o JSON parcial e, no mesmo pacote e navegador, reautenticar se necessário e emitir as 130 decisões pendentes. Exportar novo JSON completo e repetir validação local e no ledger antes da janela de escrita. Se o pacote expirar, renovar preview e pacote; não reutilizar estes 261 recibos numa nova janela.

**Atualização 00:14 UTC:** a emissão foi retomada e a leitura agregada read-only do ledger chegou a 391 eventos/391 identidades distintas; último evento às 00:14:07.645 UTC. O export disponível neste momento continua a ser o ficheiro parcial de 261 recibos. A contagem agregada é evidência de progresso, mas não substitui o JSON completo e a conferência individual de 391 recibos. Nenhuma migração/arquivo foi executado.
