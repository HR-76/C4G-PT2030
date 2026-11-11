"use strict";
const {event,LABELS}=require('./contracts');
// Adapted from UBI emailTemplates: escaped paragraph layout + HTML/text CTA.
function escapeHtml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function render(input,{publicOrigin}={}){
 const s=event(input);let origin;try{origin=new URL(publicOrigin);}catch{throw new TypeError('INVALID_PUBLIC_ORIGIN');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new TypeError('INVALID_PUBLIC_ORIGIN');
 const link=new URL(`/candidaturas/${s.applicationId}`,origin);link.searchParams.set('organizacao',s.organizationId);
 const time=new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',dateStyle:'short',timeStyle:'long'}).format(new Date(s.occurredAt));
 const subject=`[${s.organizationName}] Candidatura atualizada — ${LABELS[s.toStatus]}`;
 const lines=[s.organizationName,s.title,`${LABELS[s.fromStatus]} → ${LABELS[s.toStatus]}`,`${time} (Europe/Lisbon)`,'Esta alteração é um registo interno e não constitui uma submissão oficial.'];
 return Object.freeze({templateVersion:1,subject,text:[...lines,`Abrir candidatura: ${link.href}`].join('\n'),html:`<!doctype html><html lang="pt"><body style="font-family:Arial,sans-serif;color:#10251c"><h1>${escapeHtml(subject)}</h1>${lines.map(line=>`<p>${escapeHtml(line)}</p>`).join('')}<p><a href="${escapeHtml(link.href)}">Abrir candidatura</a></p></body></html>`});
}
module.exports={render};
