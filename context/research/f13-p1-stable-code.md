# F13-P1 — Política de `stable_code`

- **Estado:** Investigação; recomendação sujeita a aprovação humana
- **Decisão a suportar:** Qual contrato de canonicalização, comparação, unicidade, atribuição e imutabilidade deve reger o `stable_code` opcional de Units e Teams sem o transformar em identidade primária ou fonte de compatibilidade ambígua?
- **Âmbito:** apenas `stable_code` da fundação tenant-local; não redefine UUID, labels, referências externas ou mappings legacy

## Contexto e factos do repositório

### Contratos aprovados

- `scope_id` UUID é a identidade interna imutável. A decisão da fundação define `stable_code` como opcional, único na organização, imutável depois da criação e nunca reutilizável após archive.
- Units e Teams partilham a mesma autoridade tenant-local e a mesma organização. Labels são apresentacionais e não constituem identidade ou chave de autorização.
- Archive é terminal, não elimina a row e preserva referências históricas. Consequentemente, um código atribuído pode continuar reservado pela própria row arquivada, sem mecanismo auxiliar de tombstone.
- F5 resolve resources server-side e scopes exatos. O código não pode substituir `scope_id`, `organization_id`, lifecycle ou autorização.
- F7 proíbe conteúdo livre desnecessário em eventos críticos; a decisão de archive exclui expressamente códigos livres do respetivo payload.

### Padrões implementados reutilizáveis e limites

- Catálogos F5, F7, F9 e F12 usam códigos ASCII fechados, tipicamente `^[A-Z][A-Z0-9_]{0,63}$`. Este padrão demonstra previsibilidade entre JavaScript e PostgreSQL, mas representa códigos controlados pelo produto, não aliases institucionais.
- A canonicalização de oportunidades aplica NFC, trim e, nalguns identificadores, conversão ASCII para uppercase. É adequada ao seu contrato de deduplicação, mas transformar input institucional faria representações distintas convergirem silenciosamente e complicaria intenção/idempotência.
- Canonical JSON exige strings já em NFC e recusa normalização implícita. Este padrão mais conservador é apropriado para uma chave estável.
- O preflight tenant valida PostgreSQL 17 e collation ICU `und`, mas não existe contrato aprovado que torne comparações locale-dependent estáveis entre runtimes e upgrades.
- Os schemas atuais usam constraints e unique indexes PostgreSQL para invariantes concorrentes. Não existe `citext` nem um contrato geral de código Unicode case-insensitive que possa ser reutilizado com segurança.
- `organization.type_code`, códigos F12, external identifiers e labels UBI têm authorities e semânticas diferentes. Nenhum constitui `stable_code` canónico de Unit/Team.

### Lacuna atual

Não existe padrão aprovado que fixe simultaneamente grammar, representação persistida, igualdade, âmbito de uniqueness, mutabilidade, exposição e compatibilidade de um alias institucional. A decisão é necessária antes de definir validation, constraint, índice, digest de intenção e contrato de lookup.

## Semântica proposta

`stable_code` é um **alias institucional tenant-local, opcional e estável**, útil para reconhecimento humano e lookup exato dentro de uma organização. Não é:

- identidade primária ou FK;
- autoridade de autorização;
- path hierárquico;
- código externo ou mapping legacy;
- chave global C4G;
- prova de compatibilidade entre versões;
- fonte para inferir tipo, parent, lifecycle ou organização.

O UUID continua a ser a única identidade canónica em APIs internas, referências persistentes, F5, F7, snapshots e integrações. Uma API pode aceitar o código como filtro de lookup explicitamente organization-bound, mas resolve primeiro a row e continua a autorizar pelo resource server-side. URLs canónicos e referências duráveis usam UUID; um eventual alias em URL não é identidade nem prova de acesso.

## Opções comparadas

| Opção | Vantagens | Riscos/custos | Avaliação |
|---|---|---|---|
| A. Unicode livre, case-insensitive | Maior liberdade editorial; preserva grafias locais | NFC/case folding/collation variam; homógrafos; igualdade difícil de reproduzir entre JS/PostgreSQL; migrations e índices dependentes de locale | Rejeitar para v1 |
| B. ASCII canónico restrito | Igualdade bytewise; constraints simples; comportamento estável; corpus adversarial finito | Menor expressividade; códigos atuais incompatíveis exigem mapping explícito | Recomendada |
| C. Valor preservado + chave normalizada | Mantém apresentação original e permite lookup normalizado | Duas representações podem divergir; normalização passa a ter semântica; labels já satisfazem apresentação; maior superfície de drift | Não justificada |

## Recomendação

Adotar a opção B: uma única forma ASCII já canónica, validada e armazenada sem transformação.

### Grammar e limites

- Tipo: string ASCII.
- Comprimento: 1 a 64 bytes/caracteres ASCII.
- Regex canónica: `^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$`.
- O primeiro carácter é uma letra `A-Z`.
- Letras posteriores, dígitos, hífen e underscore são permitidos.
- Hífen e underscore apenas separam segmentos: não podem iniciar, terminar ou repetir consecutivamente.
- Espaço, ponto, slash, backslash, controlos, caracteres não ASCII e Unicode são recusados.
- Uma string que corresponda à forma textual canónica de UUID é recusada defensivamente. A grammar já exclui a maioria das formas, mas a regra explícita impede ambiguidade futura caso a grammar evolua.
- Não são definidos prefixes semânticos ou reservados na v1. O código não codifica tipo, parent ou organização.

O limite de 64 é coerente com os catálogos fechados existentes e evita um novo envelope arbitrário. Permitir um código de uma letra não cria ambiguidade técnica e evita inventar uma necessidade mínima inexistente.

### Algoritmo de canonicalização

1. Exigir string, sem coerção.
2. Exigir comprimento entre 1 e 64 bytes ASCII.
3. Recusar qualquer byte fora de ASCII.
4. Exigir correspondência exata à regex canónica.
5. Recusar forma UUID canónica.
6. Devolver exatamente o input, sem trim, NFC, case folding, transliteração ou substituição.

Input não canónico é recusado; não é corrigido. Assim, `abc`, ` ABC`, `ABC `, `ÁBC`, `A.B`, `A--B` e `A__B` não são representações equivalentes de `ABC`: são inputs inválidos. O cliente pode ajudar na edição, mas o boundary do domínio não transforma intenção.

### Comparação

- Igualdade é bytewise e case-sensitive sobre a forma canónica.
- JavaScript usa igualdade estrita da string validada.
- PostgreSQL usa `text` com constraint ASCII e comparação/índice sob `COLLATE "C"` ou expressão explicitamente collated equivalente.
- Não usar collation default, ICU para igualdade, `citext`, `lower()`, locale-aware uppercase ou Unicode normalization.

Como apenas uppercase ASCII é válido, JavaScript e PostgreSQL produzem a mesma igualdade sem tabela de equivalências.

### Unicidade

- A chave única é `(organization_id, stable_code)`.
- A unicidade abrange `UNIT` e `TEAM`, todos os parents e todos os lifecycles.
- `UNIT` e `TEAM` não podem partilhar código na mesma organização.
- O código não é único globalmente entre organizações.
- Rows com `NULL` coexistem; o índice não usa predicate que exclua `ARCHIVED`.
- A constraint/índice PostgreSQL é a autoridade concorrente. Checks application-side podem melhorar UX, mas não substituem a constraint.

Isto evita referências ambíguas quando o tipo ou parent muda e garante que archive nunca liberta um alias histórico.

### Lifecycle e atribuição

- O código é escolhido apenas no create ou fica `NULL`.
- Depois do create, tanto o valor como a ausência ficam imutáveis na v1.
- Não existe transição `NULL → código`, código → outro código ou código → `NULL`.
- Rename, reparent e archive não alteram o código.
- Scope arquivado continua a reservar o código indefinidamente.
- Não existe reutilização, mesmo após archive, e não existe delete físico.

Não foi encontrado caso operacional aprovado que justifique atribuição tardia. Permiti-la exigiria uma nova operação F5, evento F7, CAS/idempotência e semântica de referências anteriores; além disso, contrariaria a decisão vigente de imutabilidade depois da criação. Uma futura necessidade deve produzir decisão e versão próprias.

## Integridade PostgreSQL conceptual

Sem desenhar a migration, o contrato exige:

- coluna nullable `text`;
- CHECK que valide comprimento e regex sob semântica ASCII/C;
- CHECK defensivo contra UUID textual;
- unique index não parcial em `(organization_id, stable_code COLLATE "C")`;
- enforcement de imutabilidade em toda atualização, incluindo `NULL → valor`, preferencialmente no boundary persistente além da validação application-side;
- RLS tenant e FK/constraints compostas já exigidas pela fundação.

O manifest/fingerprint/postflight deve fixar constraint, collation explícita e índice. Startup deve recusar drift. Uma alteração futura de grammar ou igualdade exige nova versão de schema/CompatibilityManifest; não altera ou reinterpreta rows históricas.

## Concorrência e idempotência

- Creates concorrentes com o mesmo código na organização: a unique constraint permite um commit; o outro recebe conflito sanitizado.
- O digest de intenção inclui `stable_code` exatamente como validado, inclusive `NULL`.
- A mesma idempotency key e mesma forma canónica convergem.
- Lowercase, whitespace ou Unicode não são formas equivalentes: falham validação antes de persistência.
- A mesma key com `stable_code` diferente ou `NULL` versus valor é intenção divergente.
- Commit incerto é reconciliado pela intenção persistida e pela row; não por nova tentativa de normalização.

## F5, F7, exposição e confidencialidade

- Create reutiliza a operação F5 de criação e carrega organização/scope server-side; não nasce uma operação de atribuição tardia.
- Não existe operação de update de `stable_code` na v1.
- O evento F7 de create pode referenciar apenas `scope_id`, tipo e resultado seguro. O código não é necessário no payload crítico.
- O código recebe classificação tenant-local `INTERNAL`: não é secret, mas também não é identificador público.
- Pode aparecer numa projeção tenant autorizada ou export explicitamente autorizado; não aparece por default em logs, traces, métricas, mensagens de erro ou decisões deny-preserving.
- Collision, IDOR e lookup inexistente usam erro público uniforme e sanitizado, sem revelar scope, tipo, lifecycle ou organização concorrente.
- Não há validação fiável que prove que um alias não contém nome ou PII. A grammar reduz a superfície, mas a política editorial deve proibir PII; telemetry e F7 continuam sem o valor.

## Legacy, imports e referências externas

- Nunca inferir `stable_code` de label, path, faculdade, centro, departamento, equipa ou código UBI.
- Códigos legacy permanecem preservados na fonte ou num futuro mapping/external-reference governado, com authority, provenance e resolução de colisões explícita.
- Um import futuro não translitera, uppercases ou trunca automaticamente.
- Código compatível com a grammar só pode ser adotado após mapping/aprovação explícitos e verificação de unicidade; compatibilidade sintática não prova identidade.
- Colisões ficam unresolved/unmapped; não recebem suffix automático.
- External references têm identidade e lifecycle próprios e não usam a coluna `stable_code` como armazenamento genérico.

## Compatibilidade N/N-1

- A grammar, limites, comparação, collation e regra de lifecycle pertencem ao schema/release bundle.
- Writer N emite apenas a forma N.
- Reader N/N-1 aceita a tuple exata declarada; adapter não recanonicaliza nem altera o código histórico.
- Tornar a grammar mais permissiva ou restritiva requer nova versão, corpus de compatibilidade e estratégia explícita. Não há revalidação retroativa silenciosa.
- N-2, versão futura, collation divergente ou index/constraint drift falham fechado.

## Erros públicos fechados

Categorias conceptuais, sem fixar ainda códigos finais:

- input inválido;
- conflito de estado/revision;
- conflito de recurso/uniqueness;
- intenção idempotente divergente;
- resource indisponível/inexistente uniforme;
- incompatibilidade de schema/contract.

Nenhum erro devolve o código conflituante, owner, tipo, parent, lifecycle ou confirmação cross-tenant.

## Casos adversariais e provas futuras

O corpus deve incluir:

- limites 0, 1, 64 e 65;
- lowercase e mixed case;
- whitespace inicial/final/interno, tabs e newlines;
- NFC/NFD, acentos, Cyrillic/Greek homoglyphs, emoji, surrogates e controlos;
- ponto, slash, backslash, dois separadores, separador inicial/final;
- formas UUID, SQL/metacharacters e strings de path traversal;
- mesmo código em parents e tipos diferentes na mesma organização;
- mesmo código em organizações A/B;
- concorrência create/create e retry após commit incerto;
- reuse após archive;
- tentativas `NULL → code`, code → `NULL` e code → code;
- idempotency key com inputs exatos, inválidos e divergentes;
- collision/IDOR sem enumeração;
- drift de regex, collation, constraint e índice no startup/postflight;
- N/N-1 autorizado e tuples recusadas.

Property tests devem provar que todo valor aceite é ASCII, já canónico, idempotente e comparado de forma igual em JS/PostgreSQL. PostgreSQL 17 deve provar uniqueness concorrente e reserva depois de archive.

## Impacto nos 33 acceptance criteria

- **AC-03/04/05:** separa definitivamente UUID, label e código; torna AC-04 verificável por grammar, bytewise uniqueness e não reutilização.
- **AC-10/11:** archive preserva e reserva o código.
- **AC-13/14:** imutabilidade elimina update tardio; digest de create fixa `NULL` ou valor exato.
- **AC-15/16:** uniqueness e lookup permanecem tenant-bound, com erros uniformes.
- **AC-17–20:** não cria permission/evento novo; create autorizado cobre atribuição inicial, e F7/telemetry não expõem o código.
- **AC-25/28/29:** fingerprint, CompatibilityManifest e startup passam a validar grammar, collation, constraint e índice.
- **AC-30:** legacy não é inferido nem convertido.
- **AC-31/32:** corpus JS/PG e regressões estruturais tornam a política demonstrável.

Não se altera o número, estado ou intenção dos 33 critérios; nenhum fica `PASS` por esta investigação.

## Riscos

- Instituições podem possuir códigos históricos com espaços, pontos, lowercase ou Unicode. A mitigação é external reference/mapping explícito, não relaxar a identidade comparável.
- Um alias `INTERNAL` ainda pode conter texto identificável. A mitigação é minimização editorial e exclusão de telemetry/audit payloads.
- A imutabilidade de `NULL` pode exigir um novo ciclo caso o código só seja conhecido mais tarde. Não há caso aprovado hoje; uma evolução deve ser deliberada e versionada.
- `COLLATE "C"` tem de ser explicitado em schema, índice e probes para não depender da default ICU da base.

## Decisões humanas necessárias

1. Aprovar ou corrigir a opção B e a definição de `stable_code` como alias institucional, nunca identidade.
2. Aprovar a grammar `^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$` e limite 1–64.
3. Aprovar rejeição, em vez de transformação, de input não canónico.
4. Aprovar uniqueness por organização através de UNIT e TEAM, incluindo archived.
5. Aprovar imutabilidade total após create, incluindo ausência de atribuição tardia na v1.
6. Aprovar classificação `INTERNAL` e exclusão do valor de F7/logs/traces por default.

## Fontes internas

- `context/decisions/organizational-scope-foundation.md`
- `context/decisions/f13-p1-organizational-scope-archive.md`
- `context/features/f13-p1-organizational-scope-foundation.md`
- `context/decisions/f13-schema-policy-compatibility.md`
- `backend/src/opportunities/normalization.js`
- `backend/src/audit/canonicalJson.js`
- `backend/src/audit/event.js`
- `backend/src/authorization/catalogs.js`
- `backend/src/security/tenantMigrationManifest.js`
- `backend/src/security/tenantMigrationPreflight.js`
- `backend/database/tenant/migrations/003_f11_private_document_storage.up.sql`
- `backend/database/tenant/migrations/004_f12_opportunity_catalog.up.sql`

Não foram necessárias fontes externas: a decisão é um contrato local e a evidência interna resolve as alternativas relevantes.
