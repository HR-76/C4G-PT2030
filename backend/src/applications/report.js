'use strict';
const {Workbook}=require('exceljs');
const {fail}=require('./contracts');
const labels={IDENTIFIED:'Identificada',INTENTION:'Intenção',PREPARATION:'Preparação',SUBMITTED:'Submetida',APPROVED:'Aprovada',REJECTED:'Rejeitada',CANCELLED:'Cancelada',ARCHIVED:'Arquivada'};
const consultedAt=new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',
 year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const text={vertical:'middle',horizontal:'left',indent:1};
const wrapped={...text,wrapText:true};
const center={vertical:'middle',horizontal:'center'};
const number={...text,horizontal:'right'};
const eur='#,##0.00" €"';
const columns=[
 {header:'Candidatura',width:43,alignment:wrapped},
 {header:'Oportunidade',width:38,alignment:wrapped},
 {header:'Estado',width:16,alignment:text},
 {header:'Responsável',width:20,alignment:wrapped},
 {header:'Unidade principal do responsável',width:30,alignment:wrapped},
 {header:'Prazo interno',width:16,alignment:center,format:'dd/mm/yyyy'},
 {header:'Prazo da oportunidade',width:24,alignment:{...center,wrapText:true},format:'dd/mm/yyyy'},
 {header:'Orçamento total (EUR)',width:23,alignment:number,format:eur},
 {header:'Orçamento da organização (EUR)',width:24,alignment:number,format:eur},
 {header:'ID',width:39,alignment:center},
 {header:'Revisão',width:12,alignment:center},
];
const bodyFont={name:'Arial',size:10,color:{argb:'FF243A50'}};
const fill=argb=>({type:'pattern',pattern:'solid',fgColor:{argb}});
const rowFills=[fill('FFFFFFFF'),fill('FFF0F5FA')];

function parse(method,value){
 const allowed=method==='reportExport'?['digest']:['cursor'];
 if(Object.keys(value).some(key=>!allowed.includes(key)))fail();
 if(method==='report'&&value.cursor!==undefined&&(typeof value.cursor!=='string'||!value.cursor||value.cursor.length>4096))fail();
 if(method==='reportExport'&&(typeof value.digest!=='string'||!/^[a-f0-9]{64}$/.test(value.digest)))fail();
 return {...value};
}
function budgetCell(value){
 if(value==null)return null;
 const amount=Number(value);
 // Excel can store 15 significant digits, including the two decimal places for cents.
 if(!Number.isFinite(amount)||Math.abs(amount)>=1e13)return String(value);
 return amount;
}
function dateCell(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-03-01')return value;
 return new Date(`${value}T00:00:00Z`);
}
function opportunityDeadline(item){
 if(item.opportunityClosingDate)return {value:dateCell(item.opportunityClosingDate),planned:false};
 const planned=item.opportunityPlannedClosing;
 if(planned?.precision==='PERIOD'&&planned.label)return {value:`${planned.label} (previsto)`,planned:true};
 if(planned?.precision==='DATE'&&planned.value){
  const date=dateCell(planned.value);
  return {value:date instanceof Date?date:`${date} (previsto)`,planned:true};
 }
 if(planned?.precision==='INSTANT'&&planned.value)return {value:`${planned.value} (previsto)`,planned:true};
 return {value:'Não indicado',planned:false};
}
function wrappedLines(value,width){
 if(value==null)return 1;
 const usableWidth=width-7;
 return String(value).split(/\r?\n/).reduce((total,line)=>{
  let lines=1,length=0;
  for(const word of line.split(/\s+/)){
   if(length&&length+1+word.length>usableWidth){
    lines++;
    length=0;
   }
   length+=word.length+(length?1:0);
   if(length>usableWidth){
    lines+=Math.floor((length-1)/usableWidth);
    length=(length-1)%usableWidth+1;
   }
  }
  return total+lines;
 },0);
}
function workbook(result){
 const book=new Workbook();
 const sheet=book.addWorksheet('Candidaturas');
 sheet.columns=columns.map(({width})=>({width}));
 const title=sheet.addRow(['Relatório de candidaturas']);
 title.height=29;
 title.getCell(1).font={...bodyFont,size:16,bold:true,color:{argb:'FF163550'}};
 title.getCell(1).alignment=text;
 for(const [label,value] of [['Organização',result.organizationName],['Consultado em',consultedAt.format(new Date(result.generatedAt))]]){
  const row=sheet.addRow([label,value]);
  row.height=19;
  row.alignment=text;
  row.font=bodyFont;
  row.getCell(1).font={...bodyFont,bold:true};
 }
 sheet.addRow([]).height=8;
 const header=sheet.addRow(columns.map(column=>column.header));
 header.height=33;
 header.font={...bodyFont,bold:true,color:{argb:'FFFFFFFF'}};
 header.fill=fill('FF234A6A');
 header.alignment={...center,wrapText:true};
 header.border={right:{style:'hair',color:{argb:'FFB7C9D9'}}};
 sheet.views=[{state:'frozen',xSplit:1,ySplit:header.number,showGridLines:false}];
 const unitLabels=new Map(result.units.map(unit=>[unit.unitId,unit.label]));
 for(const item of result.items){
  const unitLabel=result.unitsAvailable?(unitLabels.get(item.unitId)||'Sem unidade atribuída'):'Sem acesso ao diretório';
  const closing=opportunityDeadline(item);
  const values=[item.title,item.opportunityTitle,labels[item.status]||item.status,item.responsibleName,unitLabel,
   dateCell(item.deadline),closing.value,budgetCell(item.totalBudget),budgetCell(item.organizationBudget),item.applicationId,item.revision];
  const row=sheet.addRow(values);
  row.font=bodyFont;
  row.fill=rowFills[(row.number-header.number-1)%2];
  let lines=1;
  columns.forEach(({alignment,format,width},index)=>{
   const cell=row.getCell(index+1);
   const value=values[index];
   cell.alignment=alignment;
   if(format)cell.numFmt=typeof value==='string'?'@':format;
   if(alignment.wrapText&&typeof value==='string')lines=Math.max(lines,wrappedLines(value,width));
  });
  if(closing.planned&&closing.value instanceof Date)row.getCell(7).numFmt='dd/mm/yyyy" (previsto)"';
  row.height=Math.min(400,7+13*lines);
 }
 sheet.autoFilter={from:{row:header.number,column:1},to:{row:sheet.rowCount,column:columns.length}};
 return book.xlsx.writeBuffer();
}
module.exports={parse,workbook};
