# Correção da seleção atual — 2026-10-17

## Causa comprovada

Duas consultas públicas de diagnóstico, cada uma limitada a cinco resultados e sem escrita, confirmaram:

1. A fonte devolve estado `31094502` em registos cujos prazos conhecidos já passaram. Acrescentar um intervalo `deadlineDate >= 2026-10-17` à consulta não os eliminou; não se assumiu que esse filtro era suportado/eficaz.
2. `deadlineDate` pode ser uma lista de várias rondas. A implementação anterior guardava apenas a primeira, mesmo quando existiam prazos futuros.
3. Ordenar por prazo descendente devolveu uma amostra com datas futuras. Cinco resultados incluíram duas representações da mesma identidade externa, que o mecanismo existente deduplicou.

A [documentação oficial da Comissão](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis) documenta a pesquisa POST com query multipart e códigos de referência; não é prova de atualidade de cada registo. A conclusão acima vem das respostas observadas, não apenas da documentação.

## Correção

- `backend/src/fundingTenders/source.js`: ordenação descendente, parâmetro de idioma, interpretação de todas as datas fornecidas e seleção do primeiro prazo civil igual ou posterior à data UTC fixada no início da recolha. Exclui prazos inteiramente passados, ausentes e estado explicitamente não aberto/futuro. Datas malformadas continuam a contar como falha de registo; exclusões por atualidade não são falhas de transporte.
- Mantêm-se uma página/cinco resultados no ambiente demo, timeout, retries, idempotência, correções e snapshots. Não há varrimento ilimitado para preencher resultados. A seleção privilegia os registos recentes devolvidos pela fonte; não garante todas as oportunidades nem ordenação global por prazo mais próximo.
- `frontend/src/pages/Opportunities/CentralOpportunities.jsx`: filtro existente de fecho preenchido com hoje UTC ao abrir. Limpar filtros permite consultar o histórico. A API sem filtros mantém a consulta integral.
- Não apaga nem arquiva automaticamente registos antigos, não altera candidaturas e não certifica elegibilidade. A regra é de data civil: o horário-limite no próprio dia deve ser confirmado na fonte oficial. O próximo prazo é o próximo entre os fornecidos pela API, sem reinterpretar etapas ou condições específicas.

## Resultado real

Após reiniciar só API/worker da demo, uma atualização manual limitada terminou `SUCCESS`: **quatro oportunidades criadas, zero atualizadas, zero falhadas**. Os cinco resultados recebidos incluem uma identidade duplicada. A base tem **quatro oportunidades com prazo atual/futuro e cinco antigas preservadas**.

Prazos apresentados: 12/11/2026, 03/01/2027 e 31/05/2028, conforme os registos recolhidos. A amostra continua parcial e não deve ser apresentada como catálogo completo ou validação independente das condições do financiador.

## Verificação

- Backend: 16/16 testes focados PASS, incluindo múltiplas datas desordenadas, passado/hoje/futuro, datas inválidas/ausentes, estado fechado, deduplicação e limite sem preenchimento automático.
- Frontend: 100/100 PASS; default de data, limpeza para histórico e paginação cobertos. Build PASS.
- Chrome real com login OIDC/MFA: atualização concluída, quatro registos atuais consultados, detalhe aberto e candidatura anterior continuou acessível. Os cinco identificadores anteriores permanecem na consulta integral.
- Abertura visual adicional PASS: alternância atual → histórico → atual comprovada no browser, com captura final em [real-catalog.png](real-catalog.png). Sessões ADMIN/gestor deixadas abertas; sem nova recolha nesta reconferência.
- Sintaxe dos módulos/scripts alterados e diff do recorte PASS. Sem mudança de schema, permissões, fontes adicionais, cron, bases habituais ou operações Git mutáveis.

O contador transitório `excluded` do adaptador é verificado nos testes; não foi acrescentado ao schema/UI nesta correção. O histórico de execuções mantém os contadores persistidos existentes.

Próximo passo: rever o catálogo atual no ambiente http://localhost:5189/catalogo antes de avançar para outra funcionalidade.
