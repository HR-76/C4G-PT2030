# Adaptador SQL de parceiros — desenho candidato compatível

Estado: **Review — recomendação de desenho, 27/10/2026**. Pedido do utilizador: desenhar o candidato, resolvendo collation, digest legado e consistência antes da integração. [Contrato C1–C6](../features/partner-sql-pagination.md). Sem implementação, ativação ou nova decisão de arquitetura aceite implicitamente.

Continuação posterior autorizada: [protótipo isolado](../features/partner-portal-prototype.md) implementado e testado com doubles, sem integração nem execução PostgreSQL. Os resultados abaixo pertencem ao turno de desenho. A implementação precisou o cleanup: falhas de query ou do port de autoridade deixam rollback ao owner exterior, pois `query()` não expõe estado transacional; só falhas locais tentam CLOSE, pelo client preparado e sem substituir o erro primário.

## Recomendação

Usar um **cursor de servidor PostgreSQL `NO SCROLL WITHOUT HOLD`**, no mesmo client preparado e transação atuais. Abrir uma única seleção de candidatos, ler lotes de 100 e conservar em Node o percurso existente de autorização, projeção, países, filtros, ordenação, digest e cursor público. Um FETCH adicional de uma linha distingue 10000 de 10001.

Este é um leitor SQL com snapshot dos dados estável e compatibilidade v1. **Não é paginação SQL integral nem elimina a seleção em memória.** A preservação exata do digest exige percorrer os bytes de todos os matches; a autoridade continua por recurso. O candidato resolve o desenho dos três pontos pedidos sem introduzir uma tradução incerta de semântica para SQL. Ganhos de desempenho dependem de medição e não são pressupostos.

Produto: associações e contactos privados da candidatura, sem contas/acessos de parceiros. Arquitetura: membership central e contexto server-side, uma base por organização. Implementação atual: `partners.js` lê batches por keyset em instruções separadas; `composition.js` mantém autoridade e auditoria no percurso. Não introduzir o futuro catálogo reutilizável de parceiros neste leitor.

## Decisões do candidato

| Questão | Escolha concreta | Garantia / custo |
| --- | --- | --- |
| Collation, pesquisa e países | Manter as mesmas operações JavaScript/ICU | Mesma semântica do runtime; não depende de uma collation PostgreSQL parecer equivalente |
| Digest e cursor | Reutilizar canonicalização/hash/tokens v1 depois de ordenar todos os matches | Mesmos bytes, binding e validade; continua O(bytes dos matches) |
| Dados entre lotes | Um portal com snapshot da seleção aberto antes do primeiro FETCH | Não mistura versões de body/candidatura/oportunidade entre lotes |
| Autoridade | Mesmos ports, sequência, cache por pedido, drain e verificações finais | Snapshot dos dados não congela membership, política ou leituras de equipa |
| Memória | Manter `visible[]` apenas com projeções autorizadas; raw por lote | Aproxima o perfil atual; não é memória limitada a 100 fichas nem a 25 |
| Persistência e transação | Sem spool, tabela TEMP, funções novas, HOLD ou alteração de isolamento | Sem novo grant/migration; nenhuma nova cópia persistida de contactos |

### 1. Collation resolvida por reutilização, não por aproximação

Conservar literalmente:

```javascript
entityA.localeCompare(entityB, 'pt') || idA.localeCompare(idB)
countryA.localeCompare(countryB, 'pt')
value.toLocaleLowerCase('pt').includes(needle)
```

Para países, conservar `Set` de igualdade exata, exclusão de vazio e sort estável. Se duas strings distintas empatarem na comparação portuguesa, conservar a ordem da primeira aparição no scan por `partner_id`. Country/role continuam exatos; role e q podem casar pessoas diferentes. Não usar SQL `DISTINCT`, `lower`, `LIKE` ou `ILIKE` para substituir estas decisões.

A API de comparação internacional depende da implementação e Node usa ICU. No ambiente observado: Node v24.13.1, ICU 78.2, CLDR 48.0, Unicode 17.0; o collator de nomes resolve `pt` e o default usado nos IDs resolve `pt-PT`. Registar ambas as configurações no gate e repetir os vetores quando mudar a imagem Node/ICU. Não adicionar dados de versão ao cursor existente. [Node 24.13.1](https://nodejs.org/download/release/v24.13.1/docs/api/intl.html), [ECMA-402 CompareStrings](https://tc39.es/ecma402/#sec-comparestrings).

Há um contraexemplo local concreto à tradução automática: `ab` e `a\u00adb`, ambos NFC e com bytes distintos, comparam como iguais em português neste Node. O mesmo ocorre com `a\u200db` e com `A`/`A\ufe0f`. Assim, nomes com IDs inversos exigem desempate por ID. Uma collation PostgreSQL determinística desfaz empates por bytes; uma não determinística também não autoriza deduplicar países por essa igualdade. Não basta escolher `pt-x-icu` pelo nome. [PostgreSQL 18 — collations](https://www.postgresql.org/docs/18/collation.html#COLLATION-NONDETERMINISTIC).

### 2. Digest legado resolvido pelos mesmos bytes

Conservar `pageDigest` e `canonicalize` atuais:

```text
rowBytes(i) = UTF8(canonicalize([projection(i)]).slice(1,-1))
digest = SHA256( UTF8('[') || rowBytes(1) || UTF8(',') || ... || UTF8(']') )
```

Para zero matches, o material é `[]`. A sequência é a ordem final de **todos** os matches autorizados. Conservar profundidade e validação NFC estrita por registo, timestamps ISO, pessoas ativas na ordem persistida e todos os campos atualmente projetados. Não impor novamente 256 KiB à coleção completa.

`SHA256(hash(row1)||hash(row2))`, IDs/revisões, `jsonb::text` e digest da página são outros materiais; não são o digest legado. Não há forma suportada neste protocolo de combinar digests finais por linha para obter o SHA-256 da concatenação canónica. Consequência de desenho: esta compatibilidade não permite custo de digest proporcional apenas a 25 itens.

Reutilizar `createPq1UiTokens`: purpose, key ring, route `partners-browse`, TTL 600 s, contexto e posições atuais. Abrir/verificar o cursor público **depois** do digest, conservando precedência de erros. O cursor público não contém nem identifica o portal PostgreSQL.

Vetor de aceitação já preparado: 26 projeções, 15289 bytes UTF-8, SHA-256 `ac97db797317226f80c125e8770f8250ae6432b8333f0a565fe1eb7273361e21`, com token sintético fixo. O candidato terá de aceitar o token legado e emitir o mesmo token com clock/chave fixados; o baseline terá de aceitar os tokens do candidato. Referência: `backend/test/support/partnerBrowseContract.js`.

### 3. Consistência resolvida por um portal, com autoridade independente

Em PostgreSQL, o SELECT de um portal guarda o snapshot utilizado na abertura e retoma-o nos FETCHs. O código oficial de abertura copia também os parâmetros, incluindo `$1`, e inicia o portal com o snapshot ativo; a execução conserva o snapshot no QueryDesc. [PostgreSQL 18 — abertura](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/commands/portalcmds.c), [snapshot/execução](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/tcop/pquery.c).

O desenho fixa os dados de `application_partner`, `application` e `opportunity` observados por **essa seleção**. Não fixa o estado Central nem o estado das tabelas lidas por autorizações posteriores. Em READ COMMITTED, instruções separadas continuam a poder observar commits recentes. O executor atual não explicita isolation no BEGIN: o gate deve verificar e registar o isolamento efetivo e recusar integração se não for READ COMMITTED, salvo revisão explícita deste desenho. Não mudar configuração para obter PASS. [PostgreSQL 18 — isolamento](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED).

**Mudança temporal proposta, explícita:** alterações de dados posteriores à abertura do portal não entram naquela captura. O pedido seguinte abre outro portal e vê o novo estado; o cursor v1 é invalidado apenas quando a projeção filtrada/visível mudar, como em C5. Não se promete reproduzir os interleavings do scan anterior, que executava vários SELECTs. Esta semântica deve ser demonstrada antes de integração.

Se a autoridade recusar um recurso durante o scan, ele continua excluído; se ficar indisponível/stale, o pedido falha. Alterações que invalidem o guard nas verificações finais continuam a impedir a resposta. Manter a cache existente: um hit reutiliza a decisão já tomada e verifica o guard, sem repetir a query de equipa. «Autoridade atual» significa o protocolo atual completo, não uma leitura nova por candidato nem uma garantia adicional de observar toda a alteração de equipa concorrente. Não reidratar os 25 itens através de outro SELECT; página, países, total e digest derivam das projeções capturadas, sujeitas a esse protocolo de autoridade.

## SQL e algoritmo propostos

**Esboço para revisão; não executado e não é migration.** O nome `c4g_partner_browse_<uuidhex>` é gerado apenas no servidor, com 32 dígitos hexadecimais e prefixo fixo, validado por allowlist ASCII e comprimento inferior a 63 bytes. É um identificador interno, nunca input HTTP nem parâmetro de negócio. Organização vem do contexto validado e usa `$1`; não interpolar valores de utilizador. Nome único evita colisão na sessão; não o incluir em resposta, cursor público, métrica de alta cardinalidade ou log.

```sql
DECLARE c4g_partner_browse_<uuidhex> NO SCROLL CURSOR WITHOUT HOLD FOR
SELECT p.*,
       a.title AS application_title,
       a.status AS application_status,
       a.opportunity_id,
       a.evaluation_id,
       COALESCE(a.central_snapshot->>'title',o.title) AS opportunity_title
FROM opportunity_catalog.application_partner p
JOIN opportunity_catalog.application a USING (organization_id,application_id)
LEFT JOIN opportunity_catalog.opportunity o
  ON o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
WHERE p.organization_id=$1 AND p.active
ORDER BY p.partner_id
LIMIT 10001;

FETCH FORWARD 100 FROM c4g_partner_browse_<uuidhex>;
-- Após processar 10000 candidatos, somente:
FETCH FORWARD 1 FROM c4g_partner_browse_<uuidhex>;
CLOSE c4g_partner_browse_<uuidhex>;
```

Não usar `FOR UPDATE/SHARE`. Não adicionar predicados q/país/papel ou prefiltrar por permissões. `NO SCROLL` exclui navegação para trás no servidor; `WITHOUT HOLD` limita o portal à transação. O anterior/seguinte HTTP continua a abrir um pedido independente, sem reutilizar portais. O fim da transação encerra o portal. [DECLARE](https://www.postgresql.org/docs/18/sql-declare.html), [FETCH](https://www.postgresql.org/docs/18/sql-fetch.html).

```text
protect global APPLICATION_READ
verificar schema
abrir portal na transação/client preparados atuais

visible = []; examined = 0
repetir:
    batch = FETCH (examined == 10000 ? 1 : 100)
    se examined == 10000:
        se batch não vazio: LIMIT_EXCEEDED
        terminar
    para row em batch, em ordem:
        examined += 1
        APPLICATION_READ -> OPPORTUNITY_READ -> F14 opcional
        preservar short-circuit / erro / drain
        se permitido: projetar imediatamente e acrescentar a visible
    se batch.length < 100: terminar

countries = Set exato + sort português de todos os visible
matches = filtros atuais(visible)
ordenar matches pelos comparadores atuais
hash = pageDigest(matches)
validar cursor público e posição atuais
result = projeção da página + total + countries + cursores atuais
fechar portal; só depois permitir a saída bem-sucedida
retornar result ao executor, que ainda conclui auditoria/guard/commit
```

`LIMIT 10001` no SELECT **não autoriza rejeitar antecipadamente**: o candidato 10001 só causa erro depois de processar os primeiros 10000, sem o autorizar ou projetar. Igualmente, não filtrar nem canonicalizar durante FETCH. Hoje um body estruturalmente inválido pode falhar durante projection; uma falha canónica ocorre apenas depois de todas as autorizações. Conservar estas duas precedências distintas.

## Encaixe no protocolo atual

- `tenantLeaseExecutor.js:115–124` fornece o client preparado e valida lease em cada query; `sqlTransactionControl.js` bloqueia BEGIN/COMMIT/ROLLBACK/SAVEPOINT/SET TRANSACTION. DECLARE/FETCH/CLOSE não exigem alterar essa fronteira. Isto é evidência estática, a validar no percurso real.
- `composition.js:92–94` já instala role e GUCs organizacionais. Não mudar role/contexto enquanto o portal está aberto. As políticas atuais de 028 impõem RLS por organização e SELECT; não há necessidade prevista de TEMP, função SECURITY DEFINER ou novo grant.
- `composition.js:177–181` mantém decisões por recurso e checks do guard em hits. `partnersBrowse` não integra `READ_AUDIT_METHODS`; decisões novas mantêm o drain/auditoria síncronos existentes. Não aplicar o buffering de outros endpoints por analogia.
- `teamAccess.js:28` faz leituras no mesmo client durante a autorização; entre FETCHs estes comandos continuam permitidos, um de cada vez, sem `Promise.all` no client. O snapshot do portal não substitui essas leituras.
- Antes do commit, permanecem auditoria, verificação física, revalidação de autoridade/lease, guard e conclusão exterior (`tenantLeaseExecutor.js:175–203`). O portal deve estar fechado antes do `RESET ROLE` da composição.
- Manter timeout de operação de 10 s e limite de resposta de 1 MiB existentes. O timeout por instrução não é o orçamento global do scan; não renovar nem aumentar a lease por FETCH. Cancelamento/expiração usa o percurso atual do executor, sem recorrer a client físico para contornar a lease. O orçamento configurado não prova a duração física máxima do portal; o gate deve medir cancelamento, rollback e libertação dos recursos após expiração.

### Lifecycle e falhas

| Estado/falha | Resultado exigido |
| --- | --- |
| Guard/schema/DECLARE falham | Sem FETCH; falha sanitizada pelo envelope existente |
| FETCH, autorização, auditoria, projeção, limite, filtro, digest ou cursor falham | Nenhuma resposta parcial; preservar causa primária; tentar CLOSE apenas pelo client preparado se ainda utilizável; rollback exterior continua dono do cleanup |
| CLOSE falha no caminho de sucesso | Não devolver sucesso; falhar com indisponibilidade e rollback exterior |
| Lease expira/transação abortada | Não insistir em queries fora da lease, não abrir nova ligação; rollback/descartar ligação pelo executor existente |
| Sucesso | CLOSE concluído, verificações exteriores concluídas, commit/resultado segundo o protocolo atual |

O nome é conhecido mesmo se a resposta ao DECLARE se perder. Um cleanup secundário não deve substituir erro primário por `INVALID_CURSOR` ou sucesso. Erros de portal/SQL não saem para HTTP; diagnóstico usa apenas fase/código permitidos, nunca conteúdo, SQL, cursor público ou identidade do portal. Não introduzir retry/fallback para o leitor antigo após falha: duplicaria observações/auditoria e poderia trocar de snapshot.

## Opções consideradas e custo real

| Opção | Avaliação |
| --- | --- |
| Portal sequencial + semântica Node | **Recomendada para protótipo.** Menor mudança com snapshot consistente e retenção próxima da atual; trabalho global permanece |
| SELECT único com `query().rows` até 10001 | Snapshot coerente e implementação curta, mas pode reter de uma vez todos os bodies recusados e pessoas históricas inativas; não melhora o limite de memória |
| Spool canónico + ranks | Poderia reduzir heap, mas acrescenta persistência temporária de contactos, quotas/cleanup e cuidado com precedência de erros; fora deste candidato |
| SQL integral com collation/fingerprint novos | Exige outro contrato ou prova adicional de tradução exata; não é equivalente por reutilizar `browseSql.js` de candidaturas |

Se N é o número de candidatos no snapshot, o percurso atual faz `floor(min(N,10000)/100)+1` consultas de scan até à sentinela/esgotamento. O candidato faz esse número de FETCHs **mais DECLARE e CLOSE** no sucesso, mantendo schema e autoridade à parte. Para 10000: scan atual 101, candidato 103; com schema, 102 e 104. Não prometer redução de round trips. Pode evitar repetição de plano/keyset, mas só medição permite atribuir benefício líquido.

Todos os bodies dos candidatos lidos continuam a atravessar a ligação. Memória Node inclui o lote bruto e as projeções autorizadas; o digest processa todos os matches. O body bruto pode conter pessoas inativas históricas: o limite de 50 pessoas ativas por input não limita esse histórico. O limite canónico por projeção também não limita todos os dados recusados/lidos. Não declarar teto de bytes a partir do limite de 10000 nem introduzir novo erro/limite público sem decisão separada.

Um portal pode reter versões/recursos durante mais tempo, e planos SQL podem ordenar/materializar internamente. Medir pico de heap/RSS, buffers/temporários do PostgreSQL, duração do snapshot, bytes, queries por camada e p95/máximo; conservar o deadline/SLO existente. O desenho resolve consistência/compatibilidade; paginação em memória e capacidade de produção continuam pendentes.

## Provas antes de integrar

1. Implementar o candidato separado do caminho ativo e um adapter de teste que registe os mesmos 16 cenários reutilizáveis. Reutilizar os seis testes HTTP, controlos negativos e fronteiras existentes. Não mudar o oracle para acomodar o candidato.
2. Acrescentar regressões antes do código: pares NFC com comparação zero/IDs inversos; países distintos com empate; erro canónico cedo + autoridade indisponível depois; sentinela com falha anterior; limites/cancelamento/CLOSE. Corpus e mensagens internas não podem ser normalizados silenciosamente.
3. Em PostgreSQL isolado explicitamente autorizado, gate de snapshot com writer: commit antes de DECLARE; depois de DECLARE mas antes de primeiro FETCH; entre FETCHs; antes da página final. Alterar body, país/nome, pessoas, active, título/estado da candidatura e oportunidade. A resposta usa os dados da captura; pedido seguinte observa alterações. Duas organizações e ligações a candidaturas/origens diferentes são obrigatórias.
4. Testar separadamente mudanças de membership/política/equipa antes e durante o scan, inclusive cache hits e verificação final. Não aceitar que snapshot de dados congele autorização. Comparar trace de decisões e F7 com o baseline em cenários controlados.
5. Provar ausência de portais residuais no sucesso, rollback, erro de FETCH/CLOSE, timeout, desconexão e reutilização da conexão para outra organização. Exigir isolamento efetivo READ COMMITTED, verificar role/GUCs, RLS e que nenhum privilégio novo foi usado. Isolamento diferente bloqueia o gate até revisão explícita, sem ajuste silencioso de configuração.
6. Comparar baseline/candidato sobre dataset estável: respostas integrais, hashes e tokens nos dois sentidos, com clock/chave fixos. Para escritas concorrentes comparar com a semântica de captura definida acima, não exigir os interleavings inconsistentes do baseline.
7. Medir cenários 0/25/26/100/101/10000/10001, muitos recusados, origem partilhada, pessoas inativas históricas e payload grande. Relatar regressões e recusar integração se exceder orçamento ou falhar autoridade/cleanup. Testes com doubles não substituem este gate.

O protótipo local sem integração não requer migrations nem novos grants pelo desenho. Qualquer prova que crie infraestrutura, prepare SQL/roles ou toque bases continua a exigir âmbito isolado explicitamente autorizado. A autorização deste turno é para o desenho, não para executar esses passos.

## Resultado deste turno

Desenho e recomendação documentados; evidência local e conferência de preservação em [revisão](../reviews/partner-sql-adapter-design/README.md). Nenhum comando DECLARE/FETCH/CLOSE foi executado, nenhum candidato foi integrado e nenhum desempenho SQL foi medido.

**Próximo passo:** implementar o protótipo separado do runtime ativo e testar o protocolo do portal com doubles, antes do gate PostgreSQL isolado.
