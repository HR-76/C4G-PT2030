# Fundação transversal de scopes organizacionais

- Estado: **Aprovada**
- Âmbito: autoridade canónica de `Organization`, `Organizational Unit` e `Team`
- Data: 2026-10-10

## Contexto

F5, F13, F15 e reporting precisam de identidades estáveis para unidades e equipas. A Central/F3 já governa organizações e memberships, mas as migrations tenant atuais não materializam uma autoridade para unidades/equipas. As estruturas UBI são dados de migração específicos e não constituem contrato universal.

## Decisão

1. `Organization` continua canónica na Central/F3.
2. `Organizational Unit` e `Team` pertencem a uma fundação tenant-local transversal.
3. Essa fundação é feature própria e pré-requisito da implementação F13.
4. F13 não cria, altera, arquiva ou governa scopes organizacionais.
5. F13 apenas referencia `scope_id` canónico.
6. F5, F13, F15 e reporting reutilizam a mesma autoridade.
7. A entidade mínima contém:
   - `scope_id` UUID interno;
   - `organization_id`;
   - `scope_type: UNIT|TEAM`;
   - label;
   - `stable_code` opcional;
   - `parent_scope_id` opcional;
   - lifecycle `ACTIVE|ARCHIVED`;
   - revision;
   - provenance;
   - metadata de criação, atualização e archive.
8. A residência é tenant-local.
9. `organization_id` é obrigatório e imutável.
10. `scope_id` é imutável.
11. Label é apresentacional e pode ser alterada com CAS e F7.
12. Label não é identidade nem chave de autorização.
13. `stable_code` é opcional, imutável depois da criação, único dentro da organização e nunca reutilizado, mesmo após archive.
14. A hierarquia é uma árvore.
15. `Organization` é a raiz conceptual.
16. `UNIT` pode ter como parent `Organization` ou outra `UNIT` da mesma organização.
17. `TEAM` pode ter como parent `Organization` ou `UNIT` da mesma organização.
18. `TEAM` não possui filhos na v1.
19. Parents cross-tenant são recusados.
20. Ciclos são recusados.
21. Reparent exige CAS, provenance, F7, validação de ciclo e mesma organização.
22. A hierarquia não concede grants implicitamente.
23. `UNIT_SUBTREE` fica fora da v1.
24. `Team→Unit` não implica herança F13.
25. F13 usa apenas scopes exatos.
26. Membership de pessoas, cargos e reporting lines ficam fora.
27. O lifecycle v1 é `ACTIVE|ARCHIVED`.
28. Archive é lógico e terminal na v1.
29. Não existe restore na v1.
30. Um scope `ARCHIVED` permanece referenciável por snapshots históricos, mas não aceita novos Drafts, versões, grants ou ativações.
31. Archive exige composição transacional com dependências ativas.
32. Um overlay F13 ativo é desativado atomicamente com o archive do scope.
33. Se as dependências não puderem ser reconciliadas, o archive falha integralmente.
34. Snapshots históricos preservam `scope_id`, tipo, snapshot de label/path quando necessário e provenance.
35. Resource loaders são server-side, tenant-bound e fail-closed.
36. RLS e IDOR aplicam-se a todos os scopes.
37. Criação, rename, reparent e archive produzem F7.
38. Dados UBI não são convertidos por labels.
39. Faculdades, centros, departamentos, equipas e afiliações legacy exigem mapping explícito e auditado.
40. Dados ambíguos permanecem `legacy/unmapped`.
41. A feature proprietária concreta e o respetivo número serão definidos separadamente antes da implementação.
42. F13 não pode entrar em implementação enquanto a fundação necessária não existir.
43. A especificação F13 pode continuar a resolver outros blockers de readiness enquanto esta dependência permanece registada.

## Contrato de fronteira

- F3/Central governa organização e direito base de membership.
- A futura fundação governa identidade, hierarquia e lifecycle de scopes tenant-local.
- F5 carrega scopes e recursos a partir dessa autoridade, sem confiar em atributos do caller.
- F13 guarda apenas referências e snapshots, e participa na desativação atómica do overlay durante archive.
- F15 e reporting reutilizam os mesmos IDs; não criam diretórios paralelos.

## Consequências

- A decisão do modelo deixa de ser blocker de especificação F13, mas a implementação da fundação permanece dependência obrigatória anterior à implementação F13.
- Não existe modo implícito `organization-only` para contornar a dependência.
- Closure/ancestry pode ser projeção derivada, mas não concede autorização nem herança de perfil.
- Restore, diretório de pessoas, memberships locais, cargos, reporting lines e sincronização externa exigem decisões futuras próprias.

## Compatibilidade

- IDs e labels UBI não são promovidos a IDs canónicos.
- Migração futura usa mapping aprovado, provenance e reconciliação; dados ambíguos ficam unmapped.
- Archive nunca elimina referências ou snapshots históricos.

## Fontes

- `context/research/f13-organizational-scopes.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/history/f3-membership-session-context.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`

## Registo da aprovação humana

A aprovação confirmou a fundação transversal, residência tenant-local, árvore mínima, lifecycle terminal, fronteira F5/F13/F15/reporting e migração UBI exclusivamente explícita. Não cria nem carrega a feature proprietária e não autoriza implementação.
