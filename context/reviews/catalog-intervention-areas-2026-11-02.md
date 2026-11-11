# Revisão — áreas de intervenção do Catálogo C4G
Estado: Complete
Veredicto: ready to close — critérios satisfeitos, sem bloqueios.

## Resultado
174 oportunidades classificadas com evidência, 4 Por classificar, num corpus de 178. Uma oportunidade pode ter várias áreas; os totais por área não são aditivos.

## Implementação verificada
- Famílias gerais versionadas, referências às 30 subáreas existentes sem modificar os seus IDs nem o matching.
- Regras limitadas a títulos/resumos/temas explícitos, objetivos PT2030 conhecidos com scheme/fonte correspondentes e evidência arquivada já validada por digest. Programa financiador não determina setor.
- Evidência com regra, campo, excerto e URL quando publicada. Classificação calculada sobre a revisão autorizada, sem reescrever snapshots. Relatório JSON adjacente guarda todas as identidades, revisões, digests e resultados.
- Áreas de intervenção substitui as antigas colunas Áreas/Descrição da call na tabela central. Descrição completa, Tipificação, objetivos publicados (Topic) e restantes campos mantidos na ficha. Fundamento consultável.
- Filtro validado antes da ligação; aplicado no servidor antes da paginação, com varrimento limitado e cursor sobre a última identidade emitida. Metadados incluídos no limite de bytes da resposta. Exportação inclui a classificação C4G.
- Autoridade de plataforma e membership mantidas; sem nova via de acesso ou alteração de permissões.

## Validação
- Regressão inicial falhou por módulo inexistente antes da implementação.
- Testes backend: 2 559 passaram, 7 omitidos pela suite existente, zero falhas.
- Frontend: 632 passaram em 80 ficheiros. Dois testes antigos exigiam a descrição na tabela; ajustados ao novo contrato, mantendo navegação/foco e dotações.
- Build passou. Sintaxe dos módulos backend alterados verificada.
- Browser admin C4G_ADMIN e hugo ORG_ADMIN: 178 identidades em 8 páginas, sem duplicações; filtros Digital, Educação, Por classificar e Biotecnologia confrontados com o corpus completo; Digital mostra 4 resultados na interface.
- Expansão da descrição integral confirmada no browser, incluindo o seu excerto final, e fundamento das áreas aberto nos dois perfis. Membership de Hugo confirmada na base central como ORG_ADMIN ACTIVE.
- Lista/ficha usam classificação idêntica, descrição arquivada mantida, nenhum erro JavaScript. Desktop e móvel sem overflow da página. Super Admin com zero pedidos de interesses/candidaturas privados; membro apenas pelas vias existentes autorizadas.
- Base preservada: 178 oportunidades, 178 revisões, zero funding_run, EU QUIESCED. Sem recolhas, migrações ou publicação de produção.

## Casos sem evidência suficiente
- Funcionamento de CIT multifunções e espaços equiparados
- Programa Escolhas
- Apoio a Infraestruturas de Base Tecnológica – Regulamento STEP
- Programa Escolhas (2027/2029)

## Distribuição
| Área | Oportunidades |
|---|---:|
| Digital | 4 |
| Saúde | 3 |
| Biotecnologia | 0 |
| Energia | 13 |
| Ambiente e Clima | 22 |
| Indústria e Materiais | 0 |
| Educação e Formação | 45 |
| Emprego e Inclusão | 42 |
| Agricultura | 0 |
| Mar e Oceanos | 5 |
| Mobilidade e Transportes | 9 |
| Cultura e Património | 0 |
| Turismo | 0 |
| Defesa e Segurança | 1 |
| Espaço | 0 |
| Empreendedorismo e Empresas | 32 |
| Investigação e Inovação | 21 |
| Habitação | 8 |
| Administração Pública | 6 |
| Assistência Técnica | 7 |
| Migração e Integração | 4 |
| Cidades e Território | 0 |

## Limites
Classificação descritiva e recalculável, não certificação de elegibilidade. Famílias sem evidência, incluindo Biotecnologia, mantêm zero atribuições. Não houve nova recolha. O varrimento do filtro serve este corpus local; acima do limite de 10 400 candidatos falha explicitamente em vez de apresentar um resultado parcial.
