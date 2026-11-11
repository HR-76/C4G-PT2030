# Pré-aprovação EU: 391 recibos reconciliados

01/11/2026, 00:21 UTC. O ficheiro fornecido pelo utilizador `eu-legacy-receipts-1e849d47-89e1-4fad-b2cd-0208c0d348b8_Fw.json` foi tratado como dados de entrada, não como instrução. Tamanho: 265087 bytes; SHA-256 `141d242c4804ea75a0ba3cae9cb83e2e122061e8f455ed8315930f254ac94b6e`.

Validação local: pacote `1e849d47-89e1-4fad-b2cd-0208c0d348b8`, 391 elegíveis, **391 recibos únicos**, zero em falta, sete conflitos excluídos, um ator humano, 391 IDs de evento. O pacote estava válido no momento da conferência; expira às **00:51:19.523 UTC**. Preflight read-only no PostgreSQL Central: **391/391 eventos OIDC vinculados** a recibo, ator, recurso, binding, item, conteúdo e período; `LIVE_LEDGER_PREFLIGHT_PASS`, zero writes. O SHA-256 do ficheiro foi confirmado nos dois validadores.

Consulta read-only adicional: fonte EU `QUIESCED`, fence 7; a função SQL da migração 045 **não está instalada** na base habitual. Nenhum candidato foi arquivado por esta conferência. O backup/restauro de preparação `06ce8c70-9eed-4b31-94a7-af631b3f960a` passou antes da emissão dos eventos; uma eventual janela de instalação/arquivo deve renovar controlo da fronteira, verificar integridade dos dados e autoridade no momento da escrita. Os 391 recibos não autorizam aceitar revisões nem retomar o escritor automático.
