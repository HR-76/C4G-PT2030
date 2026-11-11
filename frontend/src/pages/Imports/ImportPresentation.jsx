import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'

export const terminal = new Set(['CANCELLED', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED', 'RECONCILIATION_REQUIRED'])
export const stateLabel = { UPLOADED: 'Carregada', READY_FOR_CONFIRMATION: 'Pronta para confirmar', QUEUED: 'Em fila', RUNNING: 'Em processamento', CANCELLATION_REQUESTED: 'Cancelamento pedido', CANCELLED: 'Cancelada', COMPLETED: 'Concluída', COMPLETED_WITH_ISSUES: 'Concluída com ocorrências', FAILED: 'Falhou', RECONCILIATION_REQUIRED: 'Resultado por reconciliar' }
const fieldLabel = {externalIdentifier: 'Referência', title: 'Título', funderName: 'Financiador', programmeName: 'Programa', summary: 'Descrição', eligibilitySummary: 'Beneficiários', openingDate: 'Início previsto', closingDate: 'Fim previsto'}
const outcomeLabel = {CREATED: 'Criada', EXACT: 'Duplicada — não criada', POSSIBLE: 'Possível duplicado', INVALID: 'Linha inválida', REJECTED: 'Rejeitada', CONFLICT: 'Falha ao importar'}
const codes = {
  IMPORT_EXTERNAL_IDENTIFIER_REQUIRED: 'Falta a referência do aviso.', IMPORT_TITLE_REQUIRED: 'Falta a designação do aviso.', IMPORT_FUNDER_NAME_REQUIRED: 'Falta o programa.',
  IMPORT_OPENING_DATE_INVALID: 'Data de início inválida.', IMPORT_CLOSING_DATE_INVALID: 'Data de fim inválida.', IMPORT_FORMULA_NOT_ALLOWED: 'Uma coluna utilizada contém uma fórmula.',
  IMPORT_CREATED: 'Oportunidade criada.', IMPORT_EXACT_DUPLICATE: 'Já existe uma oportunidade igual.', IMPORT_POSSIBLE_DUPLICATE: 'Reveja a oportunidade semelhante antes de decidir.',
  IMPORT_POSSIBLE_ACCEPTED: 'Criação confirmada na revisão.', IMPORT_POSSIBLE_REJECTED: 'Criação rejeitada na revisão.', IMPORT_LINE_FAILED: 'Não foi possível importar esta linha.',
}
const civilDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : '—'
function Code({value}) { return <span>{codes[value] || 'Verifique os campos e a ordem das datas.'} <small className="text-muted">({value})</small></span> }
export function importError(error) {
  const code = error.response?.data?.error?.code || '', status = error.response?.status
  if (code === 'CENTRAL_IMPORT_NOT_CONFIGURED') return 'A importação para o catálogo C4G não está disponível.'
  if (code === 'OPPORTUNITY_IMPORT_NOT_CONFIGURED') return 'A importação de oportunidades privadas não está disponível.'
  if (code === 'IMPORT_HEADER_DECISION_REQUIRED') return 'Há colunas não reconhecidas. Escolha o tratamento de cada uma.'
  if (code === 'IMPORT_HEADER_REJECTED') return 'O ficheiro foi rejeitado conforme a decisão sobre as colunas.'
  if (code.includes('DIGEST') || code.includes('RECONCILIATION') || code.includes('COMMIT')) return 'É necessário conferir o resultado guardado. Consulte a importação antes de tentar novamente.'
  if (code.includes('MFA') || code.includes('AUTH_EVIDENCE')) return 'Volte a autenticar-se para confirmar esta operação.'
  if (status === 401) return 'A sessão terminou. Autentique-se novamente.'
  if (status === 403) return 'Não tem autorização atual para esta operação.'
  if (status === 404) return 'A importação ou o relatório não está disponível nesta organização.'
  if (status === 409) return 'O estado mudou ou já existe uma importação em processamento. Consulte o histórico antes de repetir.'
  if (status === 413) return 'O ficheiro excede o limite de 10 MiB.'
  if (status === 400) return 'Verifique o formato .xlsx, a folha e as colunas do Plano de Avisos Portugal 2030.'
  return 'Não foi possível confirmar a operação. Volte a consultar o estado ou repita o mesmo pedido.'
}

export function ImportPreview({preview, busy, onBack, onConfirm, canConfirm}) {
  return <section className="import-preview"><h3>Pré-visualização</h3>
    <dl className="dl-list"><div className="dl-row"><dt>Folha</dt><dd>{preview.sheetName}</dd></div><div className="dl-row"><dt>Total de linhas</dt><dd>{preview.totalRows}</dd></div><div className="dl-row"><dt>Válidas</dt><dd>{preview.validRows}</dd></div><div className="dl-row"><dt>Com erros</dt><dd>{preview.errorRows}</dd></div></dl>
    <p>Nenhuma oportunidade foi criada. A confirmação processa apenas as linhas válidas; duplicados exatos não criam novos registos e possíveis duplicados ficam para revisão.</p>
    <details><summary>Conferir colunas utilizadas e ignoradas</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Informação</th><th>Coluna do ficheiro</th></tr></thead><tbody>{Object.entries(preview.mapping.fields).map(([field, value]) => <tr key={field}><td>{fieldLabel[field] || field}</td><td>{value.source}</td></tr>)}</tbody></table></div><p>Colunas ignoradas: {preview.mapping.ignored?.join(', ') || 'nenhuma'}.</p><p>A dotação global do aviso não é tratada como orçamento por candidatura.</p></details>
    {preview.preview.length > 0 && <><h4>Linhas válidas</h4><p className="text-muted">A mostrar {preview.preview.length} de {preview.validRows} linhas válidas.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>Linha</th><th>Referência</th><th>Título</th><th>Programa</th><th>Início previsto</th><th>Fim previsto</th></tr></thead><tbody>{preview.preview.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.externalIdentifier}</td><td>{row.snapshot.title}</td><td>{row.snapshot.programmeName || '—'}</td><td>{civilDate(row.snapshot.openingDate)}</td><td>{civilDate(row.snapshot.closingDate)}</td></tr>)}</tbody></table></div></>}
    {preview.errors.length > 0 && <><h4>Linhas com erros</h4><div className="table-wrap"><table className="data-table"><thead><tr><th>Linha do Excel</th><th>Correções necessárias</th></tr></thead><tbody>{preview.errors.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.codes.map(code => <p key={code}><Code value={code}/></p>)}</td></tr>)}</tbody></table></div></>}
    <div className="form-actions"><button className="btn btn-secondary" disabled={Boolean(busy)} onClick={onBack}>Voltar à validação</button><button className="btn btn-primary" disabled={Boolean(busy) || !canConfirm || preview.validRows === 0} onClick={onConfirm}>{busy === 'confirm' ? 'A confirmar…' : `Importar ${preview.validRows} linhas válidas`}</button></div>
  </section>
}

export function ImportResult({detail, busy, onCancel, onReview, onDownload, onRefresh}) {
  const {job, outcomes} = detail
  return <section className="detail-section"><h3>Resultado da importação</h3><p role="status"><strong>{stateLabel[job.state] || job.state}</strong> · {job.processedRows} de {job.totalRows} linhas processadas</p>
    <dl className="dl-list"><div className="dl-row"><dt>Criadas</dt><dd>{job.createdRows}</dd></div><div className="dl-row"><dt>Duplicadas</dt><dd>{job.exactRows}</dd></div><div className="dl-row"><dt>Por rever</dt><dd>{job.possibleRows}</dd></div><div className="dl-row"><dt>Rejeitadas</dt><dd>{job.rejectedRows}</dd></div><div className="dl-row"><dt>Falhas</dt><dd>{job.conflictRows}</dd></div></dl>
    <div className="form-actions"><button className="btn btn-outline" disabled={Boolean(busy)} onClick={onRefresh}>Atualizar resultado</button>{!terminal.has(job.state) && <button className="btn btn-danger" onClick={() => onCancel(job.importId)} disabled={Boolean(busy) || job.state === 'CANCELLATION_REQUESTED'}>Cancelar importação</button>}{job.reportDocumentVersionId && <button className="btn btn-outline" disabled={Boolean(busy)} onClick={() => onDownload(job.importId)}><Download size={14}/> Descarregar relatório CSV</button>}</div>
    {job.state === 'RECONCILIATION_REQUIRED' && <p className="alert">O relatório precisa de ser reconciliado com as decisões guardadas. Não inicie outra importação para repetir estas linhas.</p>}
    {outcomes.length > 0 && <div className="table-wrap"><table className="data-table"><thead><tr><th>Linha</th><th>Resultado</th><th>Informação</th><th>Oportunidade</th><th>Decisão</th></tr></thead><tbody>{outcomes.map(row => <tr key={row.line}><td>{row.line}</td><td>{outcomeLabel[row.state] || row.state}</td><td><Code value={row.code}/></td><td>{row.resultId || row.conflictId ? <Link to={`/oportunidades/${row.resultId || row.conflictId}`}>{row.resultId ? 'Consultar criada' : 'Consultar existente'}</Link> : '—'}</td><td>{row.state === 'POSSIBLE' ? <><button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => onReview(row.line, 'CREATE')}>Criar separadamente</button> <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => onReview(row.line, 'REJECT')}>Não importar</button></> : '—'}</td></tr>)}</tbody></table></div>}
  </section>
}
