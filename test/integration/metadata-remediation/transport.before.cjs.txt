'use strict';
// Compact only the wire representation. Restore the exact ordered objects before
// the existing fingerprint/constraint checks. Never retain observed metadata.
const layouts=Object.freeze(Object.fromEntries(Object.entries({
 tables:['table_name'],
 columns:['table_name','ordinal','column_name','data_type','not_null','identity_kind','generated_kind','default_expression'],
 constraints:['table_name','constraint_name','constraint_type','definition'],
 indexes:['table_name','index_name','definition'],
 triggers:['table_name','trigger_name','definition'],
 triggerFunctions:['function_schema','function_name','identity_arguments','language','definition','volatility','is_strict','security_definer','parallel_safety','configuration'],
 authoritySequence:['seqstart','seqincrement','seqmin','seqmax','seqcache','seqcycle']
}).map(([k,v])=>[k,Object.freeze(v)])));
function compactCatalogSql(sql){
 const fields=Object.values(layouts);let i=0;
 if((sql.match(/json_agg\(catalog_row\)/g)||[]).length!==fields.length)throw Error('CENTRAL_SCHEMA_QUERY_SHAPE_CHANGED');
 return sql.replace(/json_agg\(catalog_row\)/g,()=>`json_agg(json_build_array(${fields[i++].map(k=>'catalog_row.'+k).join(',')}))`);
}
function decodeCatalog(row){
 const invalid=()=>{throw Error('CENTRAL_SCHEMA_SNAPSHOT_INVALID');};
 if(!row||typeof row!=='object'||Object.keys(row).length!==Object.keys(layouts).length)invalid();
 return Object.fromEntries(Object.entries(layouts).map(([field,names])=>{
  if(!Array.isArray(row[field]))invalid();
  return [field,row[field].map(values=>{
   if(!Array.isArray(values)||values.length!==names.length)invalid();
   return Object.fromEntries(names.map((name,i)=>[name,values[i]]));
  })];
 }));
}
function compactAuthoritySql(sql){
 const projection='pg_get_functiondef(p.oid) definition,p.prosecdef security_definer',end=') AS snapshot';
 if(sql.split(projection).length!==2||!sql.endsWith(end))throw Error('AUTHORITY_SECURITY_QUERY_SHAPE_CHANGED');
 return sql.replace(projection,'NULL::text AS definition,p.prosecdef security_definer,p.oid::bigint AS _definition_id')
  .slice(0,-end.length)+end+`,(SELECT jsonb_object_agg(p.oid::text,pg_get_functiondef(p.oid)) FROM protected_functions p WHERE EXISTS(SELECT 1 FROM function_privileges a WHERE a.function_oid=p.oid)) AS definitions`;
}
function decodeAuthority(row){
 const invalid=()=>{throw Error('AUTHORITY_SECURITY_SNAPSHOT_INVALID');};
 if(!row||!row.snapshot||typeof row.snapshot!=='object'||Array.isArray(row.snapshot))invalid();
 const {snapshot,definitions}=row;
 if(snapshot.functions===null){if(definitions!==null)invalid();return snapshot;}
 if(!Array.isArray(snapshot.functions)||!definitions||typeof definitions!=='object'||Array.isArray(definitions))invalid();
 const used=new Set();
 for(const f of snapshot.functions){
  if(!f||!Number.isSafeInteger(f._definition_id)||f._definition_id<1||f.definition!==null)invalid();
  const id=String(f._definition_id);
  if(!Object.hasOwn(definitions,id)||typeof definitions[id]!=='string')invalid();
  f.definition=definitions[id];delete f._definition_id;used.add(id);
 }
 if(used.size!==Object.keys(definitions).length)invalid();
 return snapshot;
}
module.exports={layouts,compactCatalogSql,decodeCatalog,compactAuthoritySql,decodeAuthority};
