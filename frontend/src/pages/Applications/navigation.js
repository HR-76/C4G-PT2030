const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
const knownPath=new RegExp(`^/(?:calendario|(?:catalogo|interesses|candidaturas|oportunidades)(?:/${uuid})?)$`,'i')
export function applicationReturnTarget(value,fallback='/candidaturas') {
 if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f]/.test(value))return fallback
 try { const url=new URL(value,'https://c4g.invalid');return url.origin==='https://c4g.invalid'&&knownPath.test(url.pathname)?url.pathname+url.search+url.hash:fallback } catch {return fallback}
}
export const applicationDetailTarget=(id,returnTo)=>`/candidaturas/${id}?retorno=${encodeURIComponent(applicationReturnTarget(returnTo))}`
