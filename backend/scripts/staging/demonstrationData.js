'use strict';

// Pure demonstration plan: no connection, environment loading or database writes.
// Contract: context/features/staging-demonstration-data.md.
const { createHash } = require('node:crypto');
const BATCH = 'DEMO-20261114';
const titles = [
  'Campus Solar', 'Laboratório de Economia Circular', 'Rede de Mobilidade Sustentável',
  'Observatório da Biodiversidade', 'Academia de Competências Digitais', 'Saúde de Proximidade',
  'Água Inteligente', 'Comunidades de Energia', 'Património Acessível', 'Empreender no Interior',
  'Agricultura Regenerativa', 'Indústria de Baixo Carbono', 'Cidades Resilientes',
  'Escolas Inclusivas', 'Turismo de Natureza', 'Investigação em Materiais Sustentáveis',
  'Rede de Cuidados Integrados', 'Floresta Digital', 'Qualificação para o Emprego',
  'Cooperação Transfronteiriça', 'Mar e Biotecnologia', 'Transição Digital das PME',
  'Eficiência Energética Municipal', 'Alimentação Sustentável', 'Cultura em Rede',
  'Ciência Aberta', 'Inovação Social', 'Habitação e Comunidade',
  'Internacionalização Responsável', 'Territórios Criativos'
];
function stableId(key) {
  const hex = createHash('sha256').update(`${BATCH}:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
function buildPlan(day = '2026-11-14') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T12:00:00Z'))) throw new Error('DEMO_DAY_INVALID');
  const date = offset => new Date(Date.parse(day + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0,10);
  const states = [...Array(5).fill('IDENTIFIED'), ...Array(10).fill('PREPARATION'),
    ...Array(7).fill('SUBMITTED'), ...Array(4).fill('APPROVED'), ...Array(2).fill('REJECTED'), 'CANCELLED', 'ARCHIVED'];
  return { batch: BATCH, day, target: 'https://app-teste.c4g.ai', applications: titles.map((title, index) => ({
    id: stableId(`application:${index}`), title: `[DEMO] ${title}`, status: states[index],
    deadline: date(index < 4 ? index - 12 : 7 + index * 3),
    totalBudget: String(100000 + index * 25000) + '.00',
    organizationBudget: String(30000 + index * 10000) + '.00',
    notes: `Dados fictícios de demonstração. Lote ${BATCH}. Não representa uma candidatura submetida a qualquer financiador.`,
    tasks: ['Analisar elegibilidade', 'Preparar plano e orçamento', 'Rever documentação'].map((name, task) => ({
      id: stableId(`task:${index}:${task}`), title: name, deadline: date(index - 5 + task * 7),
      status: index >= 15 ? 'COMPLETED' : task === 0 && index % 2 === 0 ? 'COMPLETED' : 'OPEN',
      description: `Tarefa fictícia do lote ${BATCH}: ${title}.`
    })),
    partner: { id: stableId(`partner:${index}`), body: {
      entity_name: `[DEMO] Associação Horizonte ${index + 1}`, country: ['Portugal','Espanha','França'][index % 3],
      research_area_interest: title, responsible_person: 'Contacto fictício', contact: '',
      email: `parceiro${index + 1}@example.invalid`, people: []
    } },
    messages: [
      'Mensagem de demonstração: levantamento inicial concluído; próximos passos registados nas tarefas.',
      'Mensagem de demonstração: orçamento e responsabilidades preparados para discussão interna.'
    ].map((body, message) => ({ id: stableId(`message:${index}:${message}`), body }))
  })) };
}
if (require.main === module) {
  const plan = buildPlan();
  console.log(JSON.stringify({ batch: plan.batch, target: plan.target, applications: plan.applications.length,
    tasks: plan.applications.reduce((count, row) => count + row.tasks.length, 0),
    partners: plan.applications.length, messages: plan.applications.reduce((count, row) => count + row.messages.length, 0),
    databaseWrites: false }));
}
module.exports = { BATCH, stableId, buildPlan };
