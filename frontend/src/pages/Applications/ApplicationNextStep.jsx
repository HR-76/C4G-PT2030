// Recovered from the UBI detail's APPLICATION_STATUS_NEXT_ACTION guidance.
// Current C4G terminal states remain read-only guidance, never transitions.
export const NEXT_STEP = Object.freeze({
 IDENTIFIED:'Decidir o responsável e o prazo e iniciar a preparação.',
 INTENTION:'Preparar os elementos da candidatura e definir a coordenação interna.',
 PREPARATION:'Completar equipa, parceiros e documentação antes de registar a submissão.',
 SUBMITTED:'Acompanhar a resposta do financiador e manter os documentos da submissão atualizados.',
 APPROVED:'Acompanhar a aceitação e manter os registos de execução atualizados.',
 REJECTED:'Rever o feedback do financiador para futuras candidaturas.',
 CANCELLED:'Consultar os motivos do cancelamento e preservar o histórico.',
 ARCHIVED:'Consultar o histórico e os documentos da candidatura arquivada.',
})
export default function ApplicationNextStep({status,showNavigation=true}){
 return <section className="detail-section application-next-step" aria-label="Orientação da candidatura">
  <h3>Próximo passo</h3><p>{NEXT_STEP[status]||'Acompanhar o histórico e manter a candidatura atualizada.'}</p>
  {showNavigation&&<nav className="application-section-navigation" aria-label="Secções da candidatura">
   <a className="btn btn-outline" href="#dados-orcamento">Dados e orçamento</a>
   <a className="btn btn-outline" href="#equipa-tarefas">Equipa e tarefas</a>
   <a className="btn btn-outline" href="#parceiros">Parceiros</a>
   <a className="btn btn-outline" href="#documentos-revisao">Documentos e revisão</a>
   <a className="btn btn-outline" href="#historico-candidatura">Histórico</a>
  </nav>}
 </section>
}

