# Ligação e recuperação de envios

O trabalho requer ligação. Quando o navegador comunica que está offline, a interface deve avisar que consultas e gravações exigem ligação e que o restabelecimento não reenvia automaticamente pedidos. A indicação do navegador não confirma que o servidor esteja acessível; os erros de rede continuam a ser tratados pelos fluxos existentes.

Critérios: o aviso aparece e desaparece com os eventos de ligação, sem apagar dados nem disparar pedidos; envios de resultado incerto mantêm a chave de idempotência e exigem repetição explícita; conflitos e autorização são verificados pelo servidor. A recuperação existente é limitada ao armazenamento de sessão do navegador e não promete persistência após o fecho do separador ou do navegador. Filas de workers continuam a obedecer aos seus prazos e políticas de repetição próprias.
