# GCNI-CAT-01 / G1 — contrato detalhado de leitura

Versão proposta: `gcni-catalog-read/1.0` · 01/11/2026.
Estado: desenho técnico concluído nesta entrega; não implementado nem validado contra um servidor. Exemplos sintéticos. Não altera o contrato existente `opportunity-read-v2.0`.

## 1. Fronteira e compatibilidade

Novas rotas propostas: `/api/catalog-read/v1`. Consumidas pelas páginas existentes `/catalogo` e `/catalogo/:id` quando a implementação estiver validada. As rotas `/api/central-opportunities`, `/api/admin/central-opportunities` e `/api/opportunities` permanecem com o comportamento atual. Nunca trocar o envelope atual por este formato sem mudar explicitamente o cliente.

A mesma API de leitura atende catálogo comum autorizado e administração, mas não dá permissões administrativas. O servidor resolve o âmbito a partir da sessão OIDC e da autoridade atual; não aceita organizationId, base de dados, perfil ou credenciais de ligação no pedido. Não usa Bearer do laboratório nem um segundo login. Documentos privados de candidaturas, notas, interesse e contadores privados ficam fora deste DTO e continuam nos serviços autorizados existentes.

Todos os pedidos revalidam sessão, membership/atribuição administrativa e permissões. Nenhum token de snapshot concede acesso. `Cache-Control: private, no-store`; sem ETag/304 nesta versão; `Content-Type: application/json; charset=utf-8`. Sem CORS adicional nem cache partilhada. Headers e tokens não devem ser registados em logs; logar requestId, código de resultado e métricas sem pesquisa ou dados privados.

## 2. Operações

| Método e caminho relativo | Parâmetros | Resposta 200 |
| --- | --- | --- |
| GET /opportunities | filtros da secção 3; snapshot e cursor opcionais na primeira página | ListResponse |
| GET /opportunities/{id} | snapshot opcional | DetailResponse; sem snapshot abre contexto de leitura novo para ligação direta |
| GET /opportunities/{id}/windows | snapshot obrigatório, cursor opcional | CollectionResponse<Window> |
| GET /opportunities/{id}/funding | snapshot obrigatório, cursor opcional | CollectionResponse<FundingLine> |
| GET /opportunities/{id}/funding-rules | snapshot obrigatório, cursor opcional | CollectionResponse<FundingRule> |
| GET /opportunities/{id}/documents | snapshot obrigatório, cursor opcional | CollectionResponse<DocumentVersion> |
| GET /opportunities/{id}/conflicts | snapshot obrigatório, cursor opcional | CollectionResponse<Conflict> |
| GET /opportunities/{id}/relationships | snapshot obrigatório, cursor opcional | CollectionResponse<Relationship> |
| GET /opportunities/{id}/history | snapshot obrigatório, cursor opcional | CollectionResponse<Event> |
| GET /opportunities/{id}/evidence | snapshot obrigatório, cursor opcional | CollectionResponse<Evidence> |
| GET /options | dimensão obrigatória: programme/source/kind; snapshot opcional; q opcional; cursor opcional | CollectionResponse<Option> |

IDs: UUID interno validado; parâmetros desconhecidos ou repetidos são erro. Cada coleção usa paginação de 25 itens, limitada também por bytes. A ficha não inclui coleções ilimitadas. A resposta contém descritores dessas coleções; a UI carrega a secção aberta. Evidence pode receber `ids` como parâmetro único CSV (1–25 UUID únicos) para localizar referências concretas; não pode combinar ids com cursor. A ordem nesse modo é UUID crescente. Referência inexistente nessa oportunidade/revisão é erro 404 sem detalhe sobre outros recursos.

Options pesquisa labels autorizadas pelo prefixo normalizado e ordena label normalizada + ID. Não depende apenas dos resultados da página. Não devolve contagens nesta versão. Um snapshot criado por options pode iniciar uma lista na mesma geração; o primeiro cursor da lista vincula os filtros escolhidos. Snapshot não é colocado na URL partilhável do browser; é mantido em memória.

## 3. Pesquisa e filtros

| Parâmetro | Tipo/limite | Regra normativa |
| --- | --- | --- |
| q | string, 1–200 caracteres Unicode após trim/NFC | Pesquisa case/acento insensível em código/título; termos separados por espaço combinados com E, cada termo pode ocorrer em qualquer dos dois campos. Não pesquisa PDFs nem fuzzy. |
| programme | string 1–100 | ID estável de programa presente em options; um por consulta. |
| source | string 1–100 | Namespace da fonte presente em options; múltiplas fontes de um item não duplicam linhas. |
| kind | enum | planned_notice, published_notice, grant_topic, cascade_call, call_for_proposals, unknown. Mapping versionado; desconhecido permanece consultável. |
| status | enum | planned, forthcoming, open, closed, suspended, cancelled, conditional, unknown. Estado da oportunidade, não da candidatura da organização. |
| quality | enum | partial, conflicted, stale. Cada filtro é um predicado; um registo pode corresponder aos três. Sem parâmetro significa todas. |
| deadline_from / deadline_to | YYYY-MM-DD, data civil real | Limites inclusivos sobre a data oficial do prazo resumido sustentado. from <= to. Não usar datas condicionais/conflituosas ou intervalos ambíguos como um fecho certo. |
| funding_min | string decimal não negativa, até 24 dígitos inteiros e 8 decimais | Requer currency; sem expoente, separador de milhares ou sinal. Sem arredondar. |
| currency | [A-Z]{3} | Código reconhecido pela versão de normalização; sozinho filtra dotação de call/aviso sustentada nessa moeda. Sem câmbio. |
| sort | enum, default -observed_at | title, deadline, -deadline, -observed_at. Nulos/valores incertos no fim em ambas as direções; desempate ID crescente. |
| limit | inteiro literal 25 | Único valor de produção nesta versão; omissão =25. Não copiar opções 2/50/100 do laboratório. |
| snapshot | token opaco, máximo 4096 caracteres ASCII URL-safe | Seleciona geração imutável e asOf; obrigatório com cursor. |
| cursor | token opaco, máximo 4096 caracteres ASCII URL-safe | Nunca offset nem UUID simples; continua consulta vinculada. |

Vazio é omitido pelo cliente; servidor rejeita valores vazios, parâmetros repetidos, excesso de comprimento e desconhecidos com 400. E entre dimensões. `programme`/`source` desconhecidos na geração →422 FILTER_VALUE_UNKNOWN; enum inválido →400. Não ignorar filtros para devolver tudo.

O filtro financeiro compara uma única dotação da call/aviso sustentada, ou o agregado explicitamente publicado pela fonte. Sem esse valor único comparável o item não passa funding_min/currency. Não somar tópicos, grupos partilhados ou valores concorrentes. A UI explica esta exclusão quando o filtro está ativo.

Ordenação por título usa chave normalizada NFC/casefold/acentos removidos, com algoritmo versionado; não depende da collation variável do browser. Por prazo usa `(dataOficial, precisão, horaLocalConhecida)` apenas para prazos sustentados; data sem hora mantém precisão própria e ordena antes de horas no mesmo dia, sem inventar 00:00. É uma ordenação de datas publicadas, não uma comparação universal de instantes. Observação usa timestamp UTC, não data de revisão humana.

Estado inicial proposto: preservar fecho desde hoje, visível e removível. O cliente usa a data UTC atual, conforme comportamento existente, e envia deadline_from explicitamente; API sem esse parâmetro não aplica restrição temporal oculta. Limpar filtros remove também essa data e mostra todo o universo autorizado. Não reaplicar ao voltar da ficha. O controlo informa que datas incertas/condicionais ficam fora do filtro de prazo; sem intervalo podem aparecer na pesquisa.

Áreas: fora da v1 executável enquanto mapping/taxonomia do plano de descoberta não estiverem aprovados. A proposta visual mostra o local futuro, sem controlo funcional. Não aceitar `areas` para o ignorar. É dependência registada AC18, não critério aprovado por esta entrega.

## 4. Geração, snapshot e cursor

Proposta: projeção de catálogo construída fora dos GET e publicada atomicamente pelo mecanismo autorizado de projeção. Uma geração publicada contém a relação completa `opportunityId → revisionId`, fontes/opções/classificações e cortes de histórico/evidência. Geração parcial nunca serve leituras. Não se copiam dados privados tenant para essa projeção.

GET inicial fixa `generationId`, `asOf` e política temporal. O servidor emite snapshot assinado/autenticado, com versão, geração, asOf, issuedAt, expiresAt, sujeito/âmbito autorizado e epoch de autorização. Não contém payloads nem dados privados legíveis. TTL proposto: 15 minutos absolutos; sem renovação deslizante. Pedidos iniciados após expiresAt retornam 410. Geração retida pelo menos até 15 minutos após deixar de ser atual, mais 60 segundos de margem; lease de leitura protege pedidos em execução. Sem geração disponível →503, nunca fallback para cabeças mutáveis.

Não persistir sessões/snapshots durante GET; tokens verificáveis e gerações previamente publicadas permitem leitura sem escrita. A retenção e publicação são trabalho futuro G2, não mecanismo já existente no GCNI. Se uma restrição de segurança tornar uma revisão indisponível, revalidar e falhar de forma explícita; não substituir a revisão silenciosamente.

Cursor autenticado vincula snapshot, rota/coleção, opportunityId quando aplicável, filtros canónicos, ordem, tamanho de página, versão do contrato, última chave e âmbito. Repetir o mesmo pedido sob a mesma autorização produz os mesmos itens. Comparar filtros e ordem canónicos (trim/NFC e defaults), não a ordem textual dos query params. Cursor de outra coleção, oportunidade ou filtro →409 CURSOR_CONTEXT_MISMATCH. Assinatura inválida →400 INVALID_CURSOR. Snapshot de outro sujeito/âmbito →403 SNAPSHOT_SCOPE_MISMATCH, sem revelar o proprietário.

Ficha aberta da lista usa o mesmo snapshot e a revisão apontada na geração. Relações podem abrir outra oportunidade da mesma geração, mesmo fora do filtro da lista, sempre com autorização atual. Sem snapshot, a ficha abre a geração atual e devolve um snapshot próprio. Uma geração antiga nunca concede acesso revogado; tokens não sobrevivem a revogação/mudança de âmbito. Renovação normal de cookie não deve invalidar contexto sem mudança de autoridade.

Histórico e evidências são limitados ao corte de dados da geração e à revisão selecionada; eventos futuros, inclusive retroativos com effectiveDate antiga, não entram num snapshot antigo. Ordem das coleções: windows por ordem oficial, depois ID; funding/funding-rules por ID; documents por publishedDate decrescente, nulos no fim, ID; conflicts por ID; relationships por targetId/ID; history por recordedAt decrescente/ID; evidence por retrievedAt decrescente/ID.

Sem contagem total obrigatória; `hasMore` é calculado, não inferido de `items.length===25`. Limite de resposta: lista 1 MiB UTF-8, detalhe e coleções 512 KiB, incluindo envelope. Página pode ter menos de 25 por orçamento de bytes e cursor correto; não omitir factos silenciosamente. Um item individual que não cabe →503 PROJECTION_ITEM_TOO_LARGE e alerta operacional. Conteúdo integral de documento não é transportado neste JSON.

## 5. Tipos comuns e envelope

Todos os campos descritos são obrigatórios salvo indicação `?`; nullable não significa omitido. Strings de texto são texto simples, nunca HTML executável. Enums desconhecidos não são convertidos em valores existentes. Evolução incompatível requer v2; campos opcionais aditivos podem ser ignorados pelos clientes.

`Meta = {contractVersion: "gcni-catalog-read/1.0", requestId: UUID, generationId: UUID, snapshot: string, asOf: timestampUTC, expiresAt: timestampUTC, normalizationVersion: string}`.

`Page = {limit: 25, returned: integer>=0, hasMore: boolean, nextCursor: string|null}`. hasMore=true exige nextCursor não nulo e ao menos um item; false exige null. Não há cursor de retorno: cliente preserva páginas enquanto o snapshot é válido.

`ListResponse = {data: Summary[], page: Page, meta: Meta}`.
`DetailResponse = {data: Detail, meta: Meta}`.
`CollectionResponse<T> = {data: T[], page: Page, meta: Meta}`.

`Fact<T> = {state: PRESENT|NOT_FOUND|NOT_COLLECTED|NOT_APPLICABLE|CONFLICT|UNSUPPORTED, value: T|null, evidenceIds: UUID[]}`. PRESENT exige valor válido; restantes estados exigem null. Alternativas conflituosas vivem em Conflict. Evidências são IDs da revisão com acesso verificável; ausência de recolha não significa fonte sem informação.

`Temporal` é união discriminada:
- `{kind:"date", date:"YYYY-MM-DD"}`;
- `{kind:"instant", utc:timestampUTC, originalLocal:string, originalTimezone:string}` (fuso/offset oficial conhecido);
- `{kind:"local_datetime", local:"YYYY-MM-DDTHH:mm:ss", timezone:null}` (hora sem fuso conhecido);
- `{kind:"period", from:TemporalDate|null, to:TemporalDate|null, label:string}` com pelo menos um limite ou label significativo.

TimestampUTC: RFC3339 terminado em Z, precisão até milissegundos. Datas/horas exigem validação de calendário, não só regex. Não converter local_datetime em instant até conhecer fuso com evidência. Derivação de aberto/encerrado em data/horário ambíguo é conservadora e explicada, não presume fronteira à meia-noite.

`Money = {amount: decimalString, currency: string|null, scope: call|notice|topic|project|programme|unknown, basis: planned|confirmed|unknown, sharedGroupId: UUID|null}`. Amount segue precisão do filtro, mas pode ser zero; valores negativos inválidos para dotação.

`CollectionDescriptor = {completeness: complete|partial|unknown|not_applicable, href: relativePath}`. complete refere completude conhecida da coleção na revisão, não que todas as páginas estejam carregadas. Lista vazia partial/unknown não permite afirmar inexistência. href é rota interna conhecida sem credenciais; cliente anexa snapshot em memória.

## 6. Summary e Detail

`Summary`:

| Campo | Tipo e semântica |
| --- | --- |
| id / revisionId | UUID estáveis da oportunidade e revisão fixada |
| externalCode / title | Fact<string>; IDs externos podem ser múltiplos em sources |
| kind | enum do filtro kind |
| descriptionExcerpt | Fact<string>, até 280 caracteres; excerto determinístico com indicação de truncagem no detalhe, não resumo inventado |
| programmes | {items: [{id:string,label:string}], completeness:complete|partial|unknown} |
| sources | [{namespace:string,externalId:string,officialUrl:string|null}] |
| opening | Fact<Temporal> |
| deadline | {state:supported|conditional|conflicted|unknown|not_applicable, at:Temporal|null, label:string, scopeLabel:string, windowId:UUID|null} |
| funding | Fact<Money> para call/aviso; quando múltipla sem valor único, value=null/UNSUPPORTED e label adequado |
| fundingLabel | string informativa sem alterar valor/natureza |
| status | {code:enum status,label:string,basis:source|derived|reviewed|unknown,scopeLabel:string} |
| quality | {flags:(partial|conflicted|stale)[],reviewRequired:boolean} |
| freshness | {observedAt:timestampUTC|null,reviewedAt:timestampUTC|null,expectedRefreshAt:timestampUTC|null,state:current|stale|unknown} |
| officialLinks | [{label:string,url:string}] com validação HTTPS e políticas existentes |

Para deadline.state supported exige at e windowId; conditional pode ter at apenas acompanhado de label condicional e não passa filtro de data; conflicted/unknown usam at=null. Não ocultar estado publicado divergente: a ficha preserva sourceStatus e a razão da derivação. Sem taxa de atualização conhecida, freshness=unknown; não inventar SLA. stale deriva da política versionada da fonte e asOf, não do relógio do browser.

`Detail = {summary:Summary, description:Fact<string>, descriptionTruncated:boolean, descriptionSourceUrl:string|null, sourceStatus:Fact<string>, statusExplanation:string, collections:{windows,funding,fundingRules,documents,conflicts,relationships,history,evidence}:CollectionDescriptor}`.

Descrição textual limitada a 80 000 caracteres na projeção; descriptionTruncated=true exige indicação e fonte para conteúdo completo. Nunca cortar condições estruturadas para caber no resumo. A propriedade não autoriza truncar payload original armazenado.

## 7. DTOs das secções

| DTO | Campos obrigatórios |
| --- | --- |
| Window | id UUID; scopeLabel string; phase string|null; round integer>=1|null; sequence integer>=1|null; opening Fact<Temporal>; closing Fact<Temporal>; applicability confirmed|conditional|disputed|unknown; condition string|null; supersedesId UUID|null; effectiveAt Temporal|null; evidenceIds UUID[]. conditional exige condition não vazia; supersedes não apaga anterior. |
| FundingLine | id UUID; label string; money Fact<Money>; programmeId string|null; fundCode string|null; period string|null; evidenceIds UUID[]. |
| FundingRule | id UUID; scopeLabel string; baseRate Fact<decimalString>; bonusPercentagePoints Fact<decimalString>; capRate Fact<decimalString>; conditions string|null; evidenceIds UUID[]. Percentagens entre 0 e 100; bónus não somado automaticamente. |
| DocumentVersion | id UUID (versão); documentId UUID (documento lógico); title string; versionLabel string|null; role string; contentSha256 string|null; publishedAt Temporal|null; effectiveAt Temporal|null; observedAt timestampUTC; sourceUrls string[]; supersedesVersionId UUID|null; supersessionScope string|null; preservation archived|reference_only|unknown; evidenceIds UUID[]. archived exige hash SHA256 de 64 hex; reference_only não garante bytes históricos. Substituição exige âmbito. URLs validados, sem links privados. |
| Conflict | id UUID; fieldPath string; scopeLabel string; severity material|informational; status unresolved|resolved; reason string; alternatives [{id UUID,valueText string,evidenceIds UUID[]}]; selectedAlternativeId UUID|null; decision {decidedAt timestampUTC,reason string}|null. Não expor identidade privada do revisor no catálogo comum. unresolved exige seleção/decisão null; resolved exige decisão; pode resolver sem selecionar alternativa, com motivo explícito. |
| Relationship | id UUID; targetId UUID; targetExternalCode string; relation plan_to_notice|call_to_topic|supersedes|related; confidence confirmed|probable|disputed; explicitOfficialLink boolean; differences string[]; evidenceIds UUID[]. IDs só se destino for autorizado na geração; não expor alvo privado. |
| Event | id UUID; kind string versionada; recordedAt timestampUTC; effectiveAt Temporal|null; description string; revisionId UUID; evidenceIds UUID[]. Eventos administrativos privados não integram este fluxo. |
| Evidence | id UUID; namespace string; retrievedAt timestampUTC; sourceUrl string|null; contentSha256 string|null; preservation archived|reference_only|unknown; locator {pages:integer[],sheet:string|null,range:string|null,section:string|null,jsonPointer:string|null}. archived exige hash; IDs não permitem download arbitrário. |
| Option | id string; label string; namespace string|null; deprecated boolean. Não devolver opções fora do universo autorizado nem IDs inventados pelo cliente. |

Limites de strings/arrays adicionais serão impostos no schema de implementação e no orçamento global; uma rejeição de projeção deve ser observável, nunca convertida em coleção complete vazia. Conteúdo longo integral fica na evidência original. Não há endpoint de escrita ou aceitação de conflito neste contrato.

Limites normativos para o schema futuro: títulos/labels 500 caracteres; códigos e IDs não UUID 200; texto de condição, explicação, diferença ou alternativa 8 000; URLs 2 048; hash 64 hex; páginas do localizador inteiros positivos; restantes strings curtas 1 000. Arrays internos por item até 100 referências; sources/programmes/officialLinks até 32; alternatives até 100. As listas de topo são paginadas. Uma oportunidade que exceda limites deve originar diagnóstico de projeção e 503 quando não puder ser apresentada fielmente; não cortar coleções e marcá-las completas. Os limites não alteram o original nem autorizam rejeitar silenciosamente dados da fonte.

## 7.1. Sequência exemplificativa

```http
GET /api/catalog-read/v1/opportunities?q=energia&deadline_from=2026-11-01&sort=deadline&limit=25
GET /api/catalog-read/v1/opportunities?q=energia&deadline_from=2026-11-01&sort=deadline&limit=25&snapshot=TOKEN&cursor=CURSOR
GET /api/catalog-read/v1/opportunities/10000000-0000-4000-8000-000000000003?snapshot=TOKEN
GET /api/catalog-read/v1/opportunities/10000000-0000-4000-8000-000000000003/documents?snapshot=TOKEN
```

TOKEN/CURSOR são marcadores ilustrativos, não valores válidos. Nas páginas seguintes o cliente repete os mesmos parâmetros efetivos; defaults omitidos são normalizados. Snapshot reutilizado conserva asOf/expiresAt originais; não renova o prazo. Sessão é transportada pelo mecanismo existente, não pelo URL. `exemplos-leitura.json` contém respostas sintéticas de lista, ficha, prazo condicional, documento, evidência e expiração; representa outra consulta, sem filtro temporal, para incluir o prazo condicionado.

## 8. Erros e recuperação

Envelope: `{error:{code:string,message:string,requestId:UUID,fields:[{name:string,reason:string}],retryable:boolean}}`. Nunca ecoar token, SQL, ligação de base ou conteúdo da exceção. fields pode estar vazio.

| HTTP | code | Ação da interface |
| --- | --- | --- |
| 400 | INVALID_QUERY / INVALID_CURSOR / INVALID_SNAPSHOT | Mostrar erro de pesquisa; não repetir automaticamente nem retirar filtros em silêncio. |
| 401 | SESSION_REQUIRED | Limpar dados sensíveis em memória e usar fluxo OIDC existente. |
| 403 | ACCESS_DENIED / SNAPSHOT_SCOPE_MISMATCH | Limpar contexto; sem tentativas com outra organização fornecida pelo cliente. |
| 404 | OPPORTUNITY_NOT_FOUND / RESOURCE_NOT_FOUND | Não revelar existência de recurso inacessível. |
| 409 | CURSOR_CONTEXT_MISMATCH | Oferecer reinício da pesquisa preservando filtros. |
| 410 | SNAPSHOT_EXPIRED / SNAPSHOT_UNAVAILABLE | Manter filtros, informar e oferecer resultados atualizados; nunca misturar páginas. |
| 422 | FILTER_VALUE_UNKNOWN | Indicar filtro não disponível nesta geração; correção explícita. |
| 429 | RATE_LIMITED | Respeitar Retry-After em segundos; ação manual disponível após espera. |
| 503 | CATALOG_UNAVAILABLE / PROJECTION_ITEM_TOO_LARGE | Não substituir erro por lista vazia; tentar novamente com limite e orientação. |

Erros inesperados: 500 INTERNAL_ERROR, requestId e mensagem genérica; sem retry automático ilimitado. Para GET, máximo duas tentativas automáticas apenas em falhas de rede/503 transitório, com espera crescente e cancelamento; não repetir PROJECTION_ITEM_TOO_LARGE. Política concreta de rate limit reutiliza o serviço existente; não inventa quota por fonte.

Ordem das verificações: sessão e autoridade antes de qualquer acesso a recurso; parsing com limites; autenticação/âmbito do token; validade temporal; vínculo do cursor; procura autorizada na geração. Resource 404 não distingue inexistência de falta de acesso específico. Falha de serviço de autoridade fecha acesso com 503, nunca usa decisão antiga para contornar revogação.

## 9. Aceitação de G1 versus implementação

G1 entrega uma proposta concreta e contrato suficiente para orientar schemas/testes; não afirma cobertura operacional. Rastreio: filtros AC02–03/08; snapshots AC04–05; temporalidade AC06–07; versões AC09; relações AC10; qualidade AC11; autoridade AC13–15; UI AC16; descrição AC17; performance AC19. Ingestão AC12 e migrações AC20 permanecem G2/G5. AC18 depende do contrato temático próprio.

Orçamento proposto para ensaio futuro: GET lista p95 <=500 ms e ficha p95 <=500 ms no servidor, sem rede externa, 25 itens, 10 consultas concorrentes, conjunto sintético de 10 000 oportunidades, 5 execuções após aquecimento. Comparar também com baseline no mesmo equipamento; regressão >10% requer análise antes de aceitar. Estes são alvos de desenho, não medições nem SLA aprovado de produção.

Autorrevisão: snapshot foi separado de revisão individual; GET não escreve snapshots; paginação inclui secções potencialmente grandes; autorização atual prevalece sobre consistência histórica; filtros financeiros não somam dotações; datas sem fuso não são UTC; funções privadas permanecem nos serviços existentes. A versão pública do contrato exige schemas executáveis e ensaios reais antes de ser declarada implementada.

Próximo passo: rever a proposta G1 de apresentação e parâmetros, e preparar G2 com schemas e fixtures de regressão em ambiente isolado, sem reativar fontes.
