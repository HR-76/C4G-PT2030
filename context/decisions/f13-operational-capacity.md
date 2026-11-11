# Decisão: capacidade operacional institucional F13

## Estado

**Aprovada.**

## Contexto

A F13 precisa representar recursos e serviços institucionalmente disponibilizáveis num horizonte definido sem se transformar em sistema de recursos humanos, inventário patrimonial, agenda ou planeamento de projetos. Competência e experiência demonstram aptidão e histórico; não provam disponibilidade operacional corrente.

## Decisão

1. Capacidade operacional é representada por assertions agregadas, temporais, versionadas e governadas.
2. F13 não mantém:
   - pessoas individuais;
   - horários;
   - timesheets;
   - avaliação;
   - recrutamento;
   - inventário detalhado;
   - reservas;
   - manutenção;
   - procurement;
   - planeamento de projetos.
3. Scopes permitidos na v1:
   - `ORGANIZATION`;
   - `UNIT`.
4. `TEAM` fica fora da v1 devido a:
   - risco de dupla contagem;
   - grupos pequenos;
   - reidentificação;
   - granularidade operacional excessiva.
5. Uma métrica pertence a catálogo fechado e versionado.
6. A definição da métrica fixa:
   - dimensão;
   - unidade;
   - scopes permitidos;
   - horizontes;
   - representações admitidas;
   - agregabilidade;
   - regras de coverage;
   - validade;
   - confidencialidade;
   - possibilidade de `NONE`/`NOT_APPLICABLE`;
   - métodos de verificação.
7. O caller não cria códigos, unidades, roles de capacidade ou regras de rollup.
8. Valores usam representação autorizada pela métrica:
   - exato;
   - intervalo;
   - banda.
9. Representações incompatíveis não coexistem.
10. Valores numéricos usam decimal exato.
11. Capacidade é associada a período ou horizonte explícito.
12. Capacidade pontual e recorrente são semanticamente distintas.
13. Papéis fechados v1:
    - `TOTAL`;
    - `COMMITTED`;
    - `RESERVED`;
    - `AVAILABLE`.
14. Estes papéis não são automaticamente derivados uns dos outros.
15. Qualquer derivação exige política fechada e versionada.
16. Uma inconsistência entre papéis não é corrigida silenciosamente.
17. Coverage identifica o universo coberto pela assertion.
18. Partition identifica subconjuntos que podem participar em rollup.
19. Rollup só é permitido quando:
    - partitions são explicitamente disjuntas;
    - `metric_code` e `catalog_version` coincidem;
    - períodos/horizontes coincidem;
    - unidades coincidem;
    - scope composition policy autoriza;
    - não existe overlap conhecido.
20. Ausência de prova de disjunção impede rollup.
21. Capacidade organizacional não é soma automática de unidades.
22. Overlay de unidade não altera nem subtrai implicitamente capacidade organizacional.
23. FTE:
    - apenas para métricas que o definam;
    - com metodologia e período;
    - em agregado;
    - sem identidade pessoal;
    - não é unidade universal.
24. Modos de acesso v1:
    - `OWNED`;
    - `LEASED`;
    - `PARTNER_ACCESS`;
    - `CONTRACTED`.
25. Modo de acesso não implica disponibilidade.
26. Instalações, equipamentos, serviços e capacidade humana permanecem categorias distintas.
27. Competência e experiência não equivalem a disponibilidade operacional.
28. Estados de availability e verification são independentes.
29. Evidência F11 não produz verificação automática.
30. Verificação exige método, autoridade F5, provenance, timestamp e validade opcional.
31. Counts pequenos ou sensíveis:
    - podem ser `WITHHELD`;
    - podem usar banda autorizada;
    - não são expostos quando permitam reidentificação.
32. Snapshot operacional preserva:
    - assertion versions;
    - catálogo;
    - períodos;
    - coverage/partitions;
    - policy version;
    - projeção autorizada;
    - digest.
33. Atualizações não alteram snapshots históricos.
34. F13 não calcula scoring, elegibilidade ou adequação.
35. F14 só interpreta capacity assertions por regra explícita e versionada.
36. Pipeline de candidaturas fica responsável por disponibilidade ou reservas específicas de uma candidatura futura.

## Invariantes

- Assertions são tenant-local e referenciam apenas organização/unidade canónicas, ativas e resolvidas internamente.
- Um valor possui exatamente uma representação permitida pela métrica; ausência nunca é convertida em zero.
- Scope, coverage, partition, unidade, período, role de capacidade e política de rollup fazem parte da semântica versionada.
- Rollup é deny-by-default: sem prova de disjunção e compatibilidade integral, não ocorre.
- Assertions publicadas e snapshots são imutáveis; correções criam nova versão ou supersession.
- Dados pessoais, inventário, reserva ou utilização detalhada não entram no snapshot F13.

## Segurança, autorização e auditoria

- Declaração, verificação, aprovação, publicação, retirada, consulta restrita e exportação exigem grants F5 próprios e produzem F7 conforme a classe transacional aplicável.
- Maker-checker aplica-se à aprovação/verificação quando o declarante participou na assertion ou evidência.
- RLS/IDOR isolam organizações e unidades; referências inexistentes, arquivadas ou de outro tenant falham fechado.
- Evidência F11 conserva autorização, estado `CLEAN`, binding, retenção e minimização próprios; a referência não concede acesso documental implícito.
- F10, respostas e exports não expõem cardinalidades sensíveis, IDs pessoais ou detalhes que permitam reidentificação.

## Impacto nos critérios F13

- **F13-AC-05, AC-06 e AC-09:** catálogo, valores, períodos, coverage, policies, assertions e snapshots são fechados, versionados e imutáveis.
- **F13-AC-12 e AC-17:** provenance e o contrato operacional passam a ter semântica normativa.
- **F13-AC-18:** a v1 admite apenas organização/unidade canónicas; `TEAM` permanece explicitamente fora.
- **F13-AC-20:** estados desconhecidos ou retidos não são convertidos em zero/capacidade.
- **F13-AC-21, AC-22, AC-24 e AC-25:** autorização, auditoria, observabilidade e isolamento cobrem assertions e projeções sensíveis.
- **F13-AC-30:** roles, valores, bandas e rollups não constituem scoring ou elegibilidade.
- **F13-AC-32:** snapshots fixam assertions, catálogo, períodos, coverage/partitions, policy, projeção e digest consumíveis pela F14.

## Decisões ainda pendentes

- seed de métricas;
- horizons concretos;
- metodologias FTE;
- coverage/partition policies;
- métodos de verificação;
- confidencialidade e redaction;
- retenção;
- regras F14;
- eventual suporte `TEAM` futuro.

## Consequências

- A v1 favorece agregados governados em vez de detalhe operacional, reduzindo dados pessoais e acoplamento a RH/ativos.
- O custo de explicitar coverage e partitions é aceite para impedir dupla contagem e rollups não reproduzíveis.
- Organização e unidade podem coexistir sem que uma seja inferida da outra; snapshots têm de declarar a composição usada.
- Reservas ou disponibilidade específicas de uma candidatura serão responsabilidade de uma capacidade futura, não de F13.

## Fontes

- `context/project-overview.md`
- `context/architecture.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-competencies-and-experience.md`
- `context/decisions/f13-financial-capacity.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f10-operational-observability.md`
- `context/history/f11-private-document-storage.md`
- `context/research/f13-operational-capacity.md`
- [European Commission — European research infrastructures](https://research-and-innovation.ec.europa.eu/strategy/strategy-research-and-innovation/our-digital-future/european-research-infrastructures_en)
- [OECD — Frascati Manual 2015](https://www.oecd.org/content/dam/oecd/en/publications/reports/2015/10/frascati-manual-2015_g1g57dcb/9789264239012-en.pdf)

## Registo da aprovação humana

A aprovação humana confirmou assertions agregadas e temporais, scopes `ORGANIZATION|UNIT`, exclusão de `TEAM` na v1, catálogo fechado, papéis de capacidade independentes, rollup com prova de disjunção, FTE contextual, access modes fechados, verificação explícita e snapshots imutáveis. Esta decisão não seleciona seeds, horizons, metodologias, policies, grants ou regras F14 e não autoriza implementação enquanto a F13 permanecer em `Draft`.
