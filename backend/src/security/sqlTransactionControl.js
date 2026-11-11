'use strict';

const COMMANDS = Object.freeze([
  /^(?:BEGIN|START\s+TRANSACTION)(?:\s+(?:WORK|TRANSACTION|ISOLATION|READ|DEFERRABLE|NOT)\b)?/i,
  /^(?:COMMIT|END)(?:\s+(?:WORK|TRANSACTION|AND)\b)?/i,
  /^(?:ROLLBACK|ABORT)(?:\s+(?:WORK|TRANSACTION|TO|AND)\b)?/i,
  /^SAVEPOINT\b/i,
  /^RELEASE\s+SAVEPOINT\b/i,
  /^SET\s+TRANSACTION\b/i,
  /^SET\s+CONSTRAINTS\b/i
]);

function topLevelSql(sql) {
  if (typeof sql !== 'string') return '';
  let output='';let index=0;let state='code';let tag='';let blockDepth=0;
  while(index<sql.length){
    const pair=sql.slice(index,index+2);
    if(state==='line'){if(sql[index]==='\n'){state='code';output+='\n';}else output+=' ';index+=1;continue;}
    if(state==='block'){if(pair==='/*'){blockDepth+=1;output+='  ';index+=2;continue;}if(pair==='*/'){blockDepth-=1;output+='  ';index+=2;if(blockDepth===0)state='code';continue;}output+=sql[index]==='\n'?'\n':' ';index+=1;continue;}
    if(state==='single'){if(sql[index]==="'"&&sql[index+1]==="'"){output+='  ';index+=2;continue;}if(sql[index]==="'")state='code';output+=sql[index]==='\n'?'\n':' ';index+=1;continue;}
    if(state==='double'){if(sql[index]==='"'&&sql[index+1]==='"'){output+='  ';index+=2;continue;}if(sql[index]==='"')state='code';output+=sql[index]==='\n'?'\n':' ';index+=1;continue;}
    if(state==='dollar'){if(sql.startsWith(tag,index)){output+=' '.repeat(tag.length);index+=tag.length;state='code';continue;}output+=sql[index]==='\n'?'\n':' ';index+=1;continue;}
    if(pair==='--'){state='line';output+='  ';index+=2;continue;}
    if(pair==='/*'){state='block';blockDepth=1;output+='  ';index+=2;continue;}
    if(sql[index]==="'"){state='single';output+=' ';index+=1;continue;}
    if(sql[index]==='"'){state='double';output+=' ';index+=1;continue;}
    const dollar=sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
    if(dollar){state='dollar';tag=dollar;output+=' '.repeat(dollar.length);index+=dollar.length;continue;}
    output+=sql[index];index+=1;
  }
  return output;
}

function transactionControlStatements(sql) {
  return Object.freeze(topLevelSql(sql).split(';').map(value=>value.trim()).filter(Boolean)
    .filter(statement=>COMMANDS.some(pattern=>pattern.test(statement))));
}

function assertNoTransactionControl(sql, message='Transaction control belongs to the outer owner.') {
  if(transactionControlStatements(sql).length)throw new TypeError(message);
  return true;
}

module.exports={assertNoTransactionControl,topLevelSql,transactionControlStatements};
