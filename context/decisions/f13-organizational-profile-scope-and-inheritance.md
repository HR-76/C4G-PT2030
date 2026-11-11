# Decisão: âmbito e herança do perfil organizacional F13

## Estado

**Aprovada.**

## Contexto

A F13 precisa representar um perfil institucional tenant-local sem confundir organização, unidade e equipa, sem copiar a hierarquia de autorização F5 para a composição de conteúdo e sem obrigar a futura F14 a reconstruir resultados a partir de estado mutável.

O modelo lógico prevê unidades e equipas, mas as migrations tenant atuais ainda não materializam essas entidades. A decisão define o contrato de perfil e referenciação; não atribui à F13 a governação da estrutura organizacional.

## Decisão

1. Existe obrigatoriamente um perfil-base versionado ao nível da organização.
2. Podem existir overlays opcionais por unidade ou equipa.
3. F13 não cria nem governa entidades organizacionais:
   - referencia apenas IDs canónicos existentes;
   - se unidade/equipa não existir como entidade governada, o respetivo overlay não pode ser criado;
   - referências arquivadas ou incompatíveis falham fechado.
4. Um overlay referencia explicitamente:
   - o seu âmbito;
   - o ID canónico do âmbito;
   - a versão organizacional-base;
   - a sua própria versão.
5. Equipas não herdam implicitamente overlays de unidades.
6. A composição válida é explícita:
   - perfil organizacional;
   - opcionalmente um overlay aprovado do âmbito solicitado.
7. Exclusões herdadas nunca podem ser relaxadas por overlay.
8. Valores adicionais ou mais restritivos podem ser permitidos apenas conforme o contrato fechado de cada campo.
9. Alterar ou ativar nova versão organizacional:
   - não modifica overlays existentes;
   - não os rebasa;
   - não reescreve snapshots já publicados;
   - exige nova revisão do overlay para adotar a nova base.
10. A ativação materializa um snapshot efetivo:
    - imutável;
    - tenant-local;
    - digestado;
    - ligado às versões exatas usadas;
    - reproduzível historicamente.
11. A F14 recebe apenas:
    - `effective_profile_version_id`;
    - `digest`;
    - versão de schema/regra aplicável.
12. A F14 não recompõe perfis a partir de estado mutável.
13. Perfis incompletos podem existir em `Draft`.
14. Apenas snapshots que satisfaçam uma política de completude versionada podem ficar disponíveis para F14.
15. Autoria e aprovação seguem maker-checker:
    - editor cria ou altera `Draft`;
    - aprovador distinto, autorizado por F5, aprova;
    - ativação exige grant explícito;
    - todas as ações relevantes produzem F7;
    - exceções não são implícitas.

## Invariantes

- `ORGANIZATION` é o âmbito-base obrigatório; `UNIT` e `TEAM` são overlays opcionais.
- `UNIT_SUBTREE` pode autorizar operações F5, mas não cria herança de conteúdo.
- A composição inicial contém, no máximo, uma versão organizacional e um overlay aprovado.
- Não existe merge genérico, precedência por ordem temporal ou `last write wins`.
- O âmbito e as versões são resolvidos pelo serviço a partir do recurso autorizado; não são escolhidos livremente pelo caller.
- Arquivar unidade/equipa impede nova utilização do overlay, mas preserva versões e snapshots históricos.
- Ativação, aprovação e consumo normal nunca alteram versões publicadas.

## Impacto nos critérios F13

- **F13-AC-06 a AC-12:** ficam definidos o versionamento imutável, ativação por âmbito, preservação histórica, composição explícita, autoria e maker-checker.
- **F13-AC-18:** unidade/equipa são referências canónicas pré-existentes e ativas; F13 não as cria.
- **F13-AC-19:** exclusões herdadas são monotónicas e não podem ser relaxadas.
- **F13-AC-21 e AC-22:** aprovação/ativação exigem grants F5 distintos e ações relevantes produzem auditoria F7.
- **F13-AC-32:** F14 consome somente a referência do snapshot efetivo, digest e versão de schema/regra, sem recomposição mutável.

## Alternativas rejeitadas

- **Perfil apenas organizacional:** não representa especializações legítimas de unidade/equipa.
- **Perfis completos e independentes por âmbito:** permitem contradições, duplicação e perda das restrições institucionais comuns.
- **Herança automática por árvore de unidades ou equipa→unidade:** confunde autorização com composição e torna reorganizações capazes de alterar resultados sem nova versão.
- **Rebase automático de overlays:** reescreve significado histórico e quebra a aprovação original.

## Decisões ainda pendentes

- modelo canónico das entidades unidade/equipa, se ainda inexistente;
- grants F5 exatos;
- política de dados desconhecidos;
- política de completude;
- taxonomias;
- representação financeira e operacional;
- fronteira entre exclusão F13 e regra de elegibilidade F14.

## Consequências

- A primeira implementação de overlays fica bloqueada até existir uma fonte tenant-local canónica para unidade/equipa.
- Uma nova versão organizacional exige revisão explícita dos overlays que pretendam adotá-la.
- O armazenamento terá de preservar versões componentes e o snapshot efetivo materializado.
- A futura F14 recebe um contrato reduzido e reproduzível, mas não recebe regras de composição nem acesso ao draft corrente.

## Fontes

- `context/project-overview.md`
- `context/architecture.md`
- `context/features/matching-and-qualification.md`
- `context/references/logical-data-dictionary.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f12-opportunity-catalog.md`
- `context/research/f13-organizational-profile-scope.md`

## Registo da aprovação humana

A aprovação humana confirmou o perfil-base organizacional obrigatório, overlays opcionais por unidade/equipa, composição explícita sem herança equipa→unidade, exclusões monotónicas, snapshots efetivos imutáveis e maker-checker. Esta decisão não autoriza implementação enquanto a F13 permanecer em `Draft`.
