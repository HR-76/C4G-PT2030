# Correção das 17 falhas conhecidas

Pedido: resolver as 14 falhas frontend e 3 backend sem alterar comportamento funcional aprovado.

Critérios: suites completas e build; manter estados atuais, navegação, segurança de URLs, exatidão monetária e catálogo SQL fechado. Sem aplicar SQL, enviar emails ou modificar dados.

Diagnóstico e alterações:
- Duas regressões de deep links: `ProtectedRoute` perdia pathname/query/hash ao encaminhar para login. Guardar destino no state da navegação e passá-lo a `DirectLogin`, que conserva a validação de destino relativo e o fluxo OIDC existente.
- Expectativa de início atualizada para `/dashboard`, conservando o teste de negação da administração a membros.
- Orçamentos por estado pertencem à vista `indicadores`; os seis testes passaram a abri-la explicitamente, sem alterar a vista Gráficos inicial nem enfraquecer as verificações monetárias.
- Estado legado `INTENTION` é apresentado como `IDENTIFIED`, conforme `application-list-visual.md`. Corrigir fixtures HTTP e expectativas; conservar linhas legadas no teste backend para provar a normalização. Histórico não alterado.
- Ordem das colunas alinhada com a tabela existente. Teste de URL inseguro agora torna inseguras também as fontes alternativas; teste separado confirma o fallback HTTPS seguro.
- A consulta `memberSql.emailDelivery` estava no catálogo JavaScript mas faltava o pacote SQL correspondente. Preparado `member_email_delivery.up.sql`, aditivo e com checksum fixado, guardas de ownership/patch point e comparação exata de hashes e SQL. Migrações existentes não são reescritas; o pacote **não foi aplicado a nenhuma base**. Ativação exige o procedimento controlado de admissão do manifesto de segurança; esta correção não declara validado o envio real de emails.

Resultado: 78 testes frontend focados e 21 backend focados PASS. Suites completas: frontend 797 PASS/0 FAIL; backend 2672 PASS/0 FAIL/7 SKIP. Build, sintaxe e verificação de whitespace PASS. Logs `.tmp/fix17-{focused,frontend,backend,build}.log`. A suite frontend inclui também o novo teste de fallback HTTPS e os testes existentes de rejeição de destinos externos no login. Nenhum teste foi ignorado para resolver as 17 falhas.
