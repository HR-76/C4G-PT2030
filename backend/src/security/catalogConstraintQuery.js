'use strict';
// Read server capability at this checkpoint. Only SQL representation changes;
// no metadata, schema fingerprint or authorization decision is retained.
async function nativeConstraintSql(client,sql){
 const major=await require('./centralMigrationPreflight').assertSupportedPostgresMajor(client);
 if(major<18)return sql;
 const expression="COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)";
 if(sql.split(expression).length!==2)throw Error('CENTRAL_CONSTRAINT_QUERY_SHAPE_CHANGED');
 return sql.replace(expression,'COALESCE(con.conenforced,false)');
}
module.exports={nativeConstraintSql};
