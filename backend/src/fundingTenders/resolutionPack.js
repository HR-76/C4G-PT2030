'use strict';

// Reviewed 2026-10-28. Public raw responses are bundled locally: this package
// never fetches, reads output/ artifacts, mutates a database or chooses a global
// datasource precedence. Changing evidence requires a new documentary review.
const raw = require('./resolutionPackEvidence.json');
const { buildEvidence } = require('./sourceEvidence');
const { validateTemporal } = require('../opportunities/temporal');
const CEF_DATES = [
  '2022-01-19T17:00:00+01:00', '2022-06-07T17:00:00+02:00',
  '2022-11-10T17:00:00+01:00', '2023-04-13T17:00:00+02:00',
  '2023-11-07T17:00:00+01:00'
];
const cefNews = {
  url: 'https://cinea.ec.europa.eu/news-events/news/cef-transport-almost-eu450-million-requested-deployment-alternative-fuel-supply-infrastructure-2023-11-08_en',
  title: 'CINEA — quinta e última ronda AFIF',
  locator: 'Notícia de 08/11/2023: confirmação do encerramento da quinta e última ronda em 07/11/2023.'
};
const specifications = [
  ['CEF-T-2021-AFIFCOEN-WORKS-LNG', '1a4ad5f95b46592fce98390c81efa0127a1df5d3fc69ffe401e2890eb77eca6e', 'coen'],
  ['CEF-T-2021-AFIFCOEN-WORKS-ZE', '2c1f71e74096520b40e8688e4135c134343d34925d2a30c911ba48bf43129ecf', 'coen'],
  ['CEF-T-2021-AFIFGEN-UNITS', '59824a57345dcd6efcca71f4e204b2bfecaed87fa6d42dadc4c30845cad90cbe', 'gen'],
  ['CEF-T-2021-AFIFGEN-WORKS-LNG', '1d0eded3060634272de874146c8189b1086a62790db5479e5121d0124579ba86', 'gen']
].map(([externalIdentifier, expectedFingerprint, envelope]) => ({
  externalIdentifier, expectedFingerprint,
  fields: {
    closingDate: '2023-11-07',
    sourceTemporal: { status: 'CLOSED', statusCode: '31094503', deadlines: [...CEF_DATES], openings: ['2021-09-16'] }
  },
  reason: 'A convocatória e a confirmação CINEA estabelecem cinco rondas e encerramento da última em 07/11/2023 às 17:00 de Bruxelas. A data anteriormente apresentada era a primeira ronda.',
  note: 'A quinta ronda foi adiada de 19/09/2023 para 07/11/2023 e restringida a propostas apoiadas por um Implementing Partner. As cinco rondas são conservadas; não existe evidência de cancelamento deste aviso.',
  sources: [
    { url: `https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/cef/wp-call/2021/call-fiche_cef-t-2021-afif${envelope}_en.pdf`, title: `Convocatória AFIF ${envelope === 'coen' ? 'Coesão' : 'Geral'} — V3, 19/07/2023`, locator: 'Páginas 2, 5 e 14: histórico, identificação dos temas e calendário, às 17:00 de Bruxelas.' },
    cefNews
  ]
}));
specifications.push({
  externalIdentifier: 'ERASMUS-EDU-2022-ECHE-CERT-FP',
  expectedFingerprint: '045e67bef0d0bc98cb164521641e581a77221cd5ca0a403f02dee0602476119e',
  fields: {
    closingDate: '2026-03-24',
    sourceTemporal: {
      status: 'OPEN', statusCode: '31094502', openings: ['2022-02-23'],
      deadlines: ['2022-05-03', '2023-01-26T17:00:00+01:00', '2024-01-25T17:00:00+01:00', '2025-01-28T17:00:00+01:00', '2026-03-24T17:00:00+01:00']
    }
  },
  reason: 'A ficha ECHE V4 confirma a retirada do corte de 2027 e o adiamento do último corte de 27/01/2026 para 24/03/2026, às 17:00 de Bruxelas.',
  note: 'A fonte continua a indicar o aviso como aberto, mas todos os prazos do calendário vigente já passaram. Esta certificação não atribui financiamento direto. A primeira ronda conserva apenas a data, sem hora comprovada; mantém-se a abertura publicada pela fonte.',
  sources: [
    { url: 'https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/erasmus/wp-call/2022/call-fiche_erasmus-edu-2022-eche-cert_en.pdf', title: 'Convocatória ECHE — V4, 11/11/2025', locator: 'Páginas 2 e 5: retirada de 26/01/2027, adiamento para 24/03/2026 e calendário às 17:00 de Bruxelas.' },
    { url: 'https://erasmus-plus.ec.europa.eu/funding-opportunities/erasmus-charter-for-higher-education-1', title: 'Erasmus Charter for Higher Education', locator: 'Prazo de candidatura: 24/03/2026 às 17:00 de Bruxelas.' }
  ]
}, {
  externalIdentifier: 'ESC-HUMAID-2021-QUAL-LABEL-FP',
  expectedFingerprint: '378735432cf6c3f1e8aabf90c95bc410fe0079a96342258a981aa489719dfbec',
  fields: {
    closingDate: '2026-09-22',
    sourceTemporal: {
      status: 'CLOSED', statusCode: '31094503', openings: ['2021-06-10'],
      deadlines: ['2021-09-22', '2022-03-24', '2022-09-22', '2023-03-16', '2023-09-21', '2024-09-24', '2025-09-23T17:00:00+02:00', '2026-09-22T17:00:00+02:00']
    }
  },
  reason: 'O guia ESC 2026 confirma o prazo de 22/09/2026 às 17:00 de Bruxelas. O portal oficial indica que a sessão está encerrada e que a submissão está indisponível.',
  note: 'A certificação mantém avaliações periódicas durante o programa. O prazo de setembro de 2026 servia projetos da convocatória de 2027. O encerramento desta sessão não extingue a certificação. Os prazos históricos sem hora comprovada conservam apenas a data.',
  sources: [
    { url: 'https://youth.europa.eu/sites/default/files/inline-files/european_solidarity_corps_guide_2026_EN.pdf', title: 'Guia do Corpo Europeu de Solidariedade 2026', locator: 'Páginas 68 e 73: certificação contínua e corte de 22/09/2026 às 17:00 de Bruxelas.' },
    { url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/ESC-HUMAID-2021-QUAL-LABEL-FP', title: 'Funding & Tenders — sessão ESC humanitária', locator: 'Dados oficiais consultados e arquivados em 28/10/2026: sessão encerrada e sistema de submissão indisponível.' }
  ]
});
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const decisions = freeze(specifications.map(specification => {
  const evidence = buildEvidence(specification.externalIdentifier, raw[specification.externalIdentifier]);
  if (evidence.fingerprint !== specification.expectedFingerprint) throw new Error('Reviewed funding evidence fingerprint mismatch');
  return { ...specification, fields: { ...specification.fields, sourceTemporal: validateTemporal(specification.fields.sourceTemporal) }, evidence };
}));
module.exports = { decisions };
