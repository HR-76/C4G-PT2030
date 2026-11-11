const IDENTIFIER=/^[a-z][a-z0-9_]{0,62}$/;
const AGGREGATORS=Object.freeze({API:'c4g_tenant_api_capabilities',WORKER:'c4g_tenant_worker_capabilities'});
const ATTRIBUTES=`NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`;
const {bindingDigest}=require('./localTenantCredentialAdapter');
function identifier(value){if(!IDENTIFIER.test(value||''))throw new TypeError('Synthetic role identifier is invalid.');return `"${value}"`;}
async function role(client,name,login,password=null){const quoted=identifier(name);await client.query(`DO $provision$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${name}') THEN CREATE ROLE ${quoted} ${login?'LOGIN':'NOLOGIN'} ${ATTRIBUTES}; END IF; END $provision$`);await client.query(`ALTER ROLE ${quoted} ${login?'LOGIN':'NOLOGIN'} ${ATTRIBUTES}`);if(login){if(typeof password!=='string'||password.length<20)throw new TypeError('Synthetic credential is invalid.');const literal=`'${password.replace(/'/g,"''")}'`;await client.query(`ALTER ROLE ${quoted} PASSWORD ${literal}`);}}
async function membership(client,granted,member){await client.query(`GRANT ${identifier(granted)} TO ${identifier(member)} WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);}
async function configureLocalTenantDatabaseConnect(client,{database,authorizedLogins,knownLogins,migratorRoles=[]}){identifier(database);for(const name of [...authorizedLogins,...knownLogins,...migratorRoles])identifier(name);await client.query(`REVOKE CONNECT ON DATABASE ${identifier(database)} FROM PUBLIC`);for(const name of knownLogins)await client.query(`REVOKE CONNECT ON DATABASE ${identifier(database)} FROM ${identifier(name)}`);for(const name of [...authorizedLogins,...migratorRoles])await client.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(name)}`);}
async function attributes(client,names){const result=await client.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=ANY($1::text[])`,[names]);if(result.rowCount!==names.length)throw new Error('LOCAL_IDENTITY_ROLE_MISSING');for(const row of result.rows)if(row.rolinherit||row.rolsuper||row.rolbypassrls||row.rolcreatedb||row.rolcreaterole||row.rolreplication)throw new Error('LOCAL_IDENTITY_ATTRIBUTE_DRIFT');}
async function validateMemberships(client,{apiLogin,workerLogin,apiRoles,workerRoles}){const managed=[apiLogin,workerLogin,...Object.values(AGGREGATORS)];const expected=new Set([[AGGREGATORS.API,apiLogin],[AGGREGATORS.WORKER,workerLogin],...apiRoles.map(role=>[role,AGGREGATORS.API]),...workerRoles.map(role=>[role,AGGREGATORS.WORKER])].map(edge=>edge.join('>')));const result=await client.query(`SELECT granted.rolname granted,member.rolname member,m.set_option,m.inherit_option,m.admin_option FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE member.rolname=ANY($1::text[])`,[managed]);for(const row of result.rows){const key=`${row.granted}>${row.member}`;if(!expected.has(key))throw new Error('LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP');if(!row.set_option||row.inherit_option||row.admin_option)throw new Error('LOCAL_IDENTITY_MEMBERSHIP_DRIFT');expected.delete(key);}if(expected.size)throw new Error('LOCAL_IDENTITY_MEMBERSHIP_MISSING');const ownership=await client.query(`SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=ANY($1::text[]) LIMIT 1`,[managed]);if(ownership.rowCount)throw new Error('LOCAL_IDENTITY_OBJECT_OWNERSHIP');}
async function validateLocalTenantRoleChain(client,{login,workload,functionalRoles}){
 if(!client||typeof client.query!=='function'||!IDENTIFIER.test(login||'')||!['API','WORKER'].includes(workload)
   ||!Array.isArray(functionalRoles)||!functionalRoles.length||functionalRoles.some(name=>!IDENTIFIER.test(name||'')))throw new TypeError('Local identity role chain input is invalid.');
 const aggregator=AGGREGATORS[workload],expected=new Set([[aggregator,login],...functionalRoles.map(role=>[role,aggregator])].map(edge=>edge.join('>')));
 const names=[login,aggregator,...functionalRoles],profiles=await client.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
  FROM pg_roles WHERE rolname=ANY($1::text[])`,[names]);
 if(profiles.rowCount!==names.length||profiles.rows.some(row=>row.rolinherit||row.rolsuper||row.rolbypassrls||row.rolcreatedb||row.rolcreaterole||row.rolreplication||((row.rolname===login)!==row.rolcanlogin)))throw new Error('LOCAL_IDENTITY_ROLE_CHAIN_INVALID');
 const authority=await client.query(`WITH target AS (SELECT oid FROM pg_roles WHERE rolname=$1), direct_acl AS (
   SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
   UNION ALL SELECT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   UNION ALL SELECT a.grantee FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
   UNION ALL SELECT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   UNION ALL SELECT a.grantee FROM pg_type t CROSS JOIN LATERAL aclexplode(t.typacl) a
   UNION ALL SELECT a.grantee FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
  ) SELECT EXISTS(SELECT 1 FROM direct_acl WHERE grantee=(SELECT oid FROM target)) OR EXISTS(
   SELECT 1 FROM target r WHERE EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid)
    OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid) OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid)
    OR EXISTS(SELECT 1 FROM pg_type t WHERE t.typowner=r.oid) OR EXISTS(SELECT 1 FROM pg_database d WHERE d.datdba=r.oid)
    OR EXISTS(SELECT 1 FROM pg_default_acl d WHERE d.defaclrole=r.oid)) AS elevated`,[aggregator]);
 if(authority.rows[0]?.elevated!==false)throw new Error('LOCAL_IDENTITY_ROLE_CHAIN_INVALID');
 const result=await client.query(`WITH RECURSIVE reachable(roleid) AS (
   SELECT oid FROM pg_roles WHERE rolname=$1
   UNION
   SELECT m.roleid FROM pg_auth_members m JOIN reachable r ON m.member=r.roleid
  )
  SELECT granted.rolname granted,member.rolname member,m.set_option,m.inherit_option,m.admin_option
  FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
  WHERE m.member IN(SELECT roleid FROM reachable) ORDER BY granted.rolname,member.rolname`,[login]);
 for(const row of result.rows){const edge=`${row.granted}>${row.member}`;if(!expected.has(edge)||!row.set_option||row.inherit_option||row.admin_option)throw new Error('LOCAL_IDENTITY_ROLE_CHAIN_INVALID');expected.delete(edge);}
 if(expected.size)throw new Error('LOCAL_IDENTITY_ROLE_CHAIN_INVALID');
 return Object.freeze({login,workload,aggregator,functionalRoles:Object.freeze([...functionalRoles])});
}
async function validateLocalTenantIdentity({candidateConnection,administrativeInspector,resolution},{login,workload,functionalRoles,expectedBindingDigest,expectedDatabase,tenantDatabases,otherLogin=null}){
 if(!candidateConnection||typeof candidateConnection.query!=='function'||!administrativeInspector||typeof administrativeInspector.query!=='function'||candidateConnection===administrativeInspector||!resolution||!['API','WORKER'].includes(workload)||resolution.workload!==workload||resolution.login!==login||resolution.database!==expectedDatabase||login===otherLogin)throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 const candidate=(await candidateConnection.query(`SELECT session_user,current_user,current_database() AS current_database,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication FROM pg_roles r WHERE r.rolname=session_user`)).rows[0];
 if(!candidate||candidate.session_user!==login||candidate.current_user!==candidate.session_user||!candidate.rolcanlogin||candidate.rolinherit||candidate.rolsuper||candidate.rolbypassrls||candidate.rolcreatedb||candidate.rolcreaterole||candidate.rolreplication||/(?:owner|migrator|admin|capabilities|runtime)/i.test(candidate.session_user))throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 const observedBindingDigest=bindingDigest({...resolution,login:candidate.session_user,database:candidate.current_database});
 if(observedBindingDigest!==expectedBindingDigest)throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 const validatePhysical=expectedDatabase!==undefined||tenantDatabases!==undefined,observedDatabase=candidate.current_database,boundDatabase=expectedDatabase||observedDatabase,knownDatabases=tenantDatabases||[boundDatabase];
 if(validatePhysical&&(!IDENTIFIER.test(boundDatabase||'')||!Array.isArray(knownDatabases)||!knownDatabases.includes(boundDatabase)||new Set(knownDatabases).size!==knownDatabases.length))throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 if((await administrativeInspector.query("SELECT 1 FROM pg_roles WHERE rolname='c4g_f4_metadata_executor'")).rowCount){functionalRoles=[...new Set([...functionalRoles,'c4g_f4_metadata_executor'])];}
 const aggregator=AGGREGATORS[workload],otherAggregator=workload==='API'?AGGREGATORS.WORKER:AGGREGATORS.API,roles=[login,aggregator,...functionalRoles];
 const attributesResult=await administrativeInspector.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=ANY($1::text[])`,[roles]);
 if(attributesResult.rowCount!==roles.length)throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 for(const row of attributesResult.rows)if(row.rolinherit||row.rolsuper||row.rolbypassrls||row.rolcreatedb||row.rolcreaterole||row.rolreplication||((row.rolname===login)!==row.rolcanlogin))throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 const expected=new Set([[aggregator,login],...functionalRoles.map(role=>[role,aggregator])].map(edge=>edge.join('>'))),managed=[login,aggregator];
 const edges=await administrativeInspector.query(`SELECT granted.rolname granted,member.rolname member,m.set_option,m.inherit_option,m.admin_option FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE member.rolname=ANY($1::text[])`,[managed]);
 for(const row of edges.rows){const key=`${row.granted}>${row.member}`;if(!expected.has(key)||!row.set_option||row.inherit_option||row.admin_option)throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');expected.delete(key);}if(expected.size)throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 const reachable=await administrativeInspector.query(`WITH RECURSIVE path(roleid) AS (SELECT oid FROM pg_roles WHERE rolname=$1 UNION SELECT m.roleid FROM pg_auth_members m JOIN path p ON p.roleid=m.member) SELECT r.rolname FROM path JOIN pg_roles r ON r.oid=path.roleid`,[login]);
 if(reachable.rows.some(row=>row.rolname===otherAggregator||/(?:owner|migrator)/i.test(row.rolname)))throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 if(validatePhysical){const databaseState=await administrativeInspector.query(`SELECT
   d.datname,r.rolname AS owner,has_database_privilege($1,d.datname,'CONNECT') AS login_connect,
   EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) acl
    WHERE acl.grantee=0 AND acl.privilege_type='CONNECT'
   ) AS public_connect
   FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=ANY($2::text[]) ORDER BY d.datname`,[login,knownDatabases]);
 if(observedDatabase!==boundDatabase||databaseState.rows.length!==knownDatabases.length||databaseState.rows.some(row=>row.public_connect||row.owner===login||row.owner===aggregator||(row.datname===boundDatabase?!row.login_connect:row.login_connect)))throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');}
 const objectState=await administrativeInspector.query(`SELECT
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=ANY($1::text[])) AS class_owned,
   EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname=ANY($1::text[])) AS schema_owned,
   EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname=ANY($1::text[])) AS routine_owned,
   EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE grantee=ANY($1::text[])) AS table_granted,
   EXISTS(SELECT 1 FROM information_schema.role_routine_grants WHERE grantee=ANY($1::text[])) AS routine_granted,
   EXISTS(SELECT 1 FROM information_schema.role_usage_grants WHERE grantee=ANY($1::text[])) AS usage_granted,
   EXISTS(SELECT 1 FROM information_schema.role_column_grants WHERE grantee=ANY($1::text[])) AS column_granted,
   EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole WHERE r.rolname=ANY($1::text[])) AS default_acl_owned`,[managed]);
 if(Object.values(objectState.rows[0]).some(Boolean))throw new Error('LOCAL_IDENTITY_INCOMPATIBLE');
 return Object.freeze({workload,bindingDigest:observedBindingDigest,code:'IDENTITY_COMPATIBLE'});
}
async function createLocalTenantIdentityProvisioner(client){if(!client||typeof client.query!=='function')throw new TypeError('Local identity provisioner requires an administrative client.');return Object.freeze({async reconcile({apiLogin,workerLogin,apiPassword,workerPassword,apiRoles=[],workerRoles=[]}){if(apiLogin===workerLogin)throw new TypeError('Synthetic workload identities must be distinct.');if([apiLogin,workerLogin].some(name=>['c4g_f4_metadata_owner','c4g_f4_metadata_executor'].includes(name)))throw new Error('METADATA_ROLES_MUST_REMAIN_NOLOGIN');for(const [workload,roles] of [['API',apiRoles],['WORKER',workerRoles]])for(const name of roles){identifier(name);if(/(?:owner|migrator)/i.test(name)||(workload==='WORKER'&&name==='c4g_f4_metadata_executor'))throw new Error('UNSAFE_WORKLOAD_MEMBERSHIP');if(name==='c4g_tenant_runtime')throw new Error('C4G_TENANT_RUNTIME_ALLOWLIST_UNPROVEN');if(roles.includes(workload==='API'?AGGREGATORS.WORKER:AGGREGATORS.API))throw new Error('CROSS_WORKLOAD_MEMBERSHIP');}
 if((await client.query("SELECT 1 FROM pg_roles WHERE rolname='c4g_f4_metadata_executor'")).rowCount){apiRoles=[...new Set([...apiRoles,'c4g_f4_metadata_executor'])];workerRoles=[...new Set([...workerRoles,'c4g_f4_metadata_executor'])];}
 await role(client,AGGREGATORS.API,false);await role(client,AGGREGATORS.WORKER,false);await role(client,apiLogin,true,apiPassword);await role(client,workerLogin,true,workerPassword);await membership(client,AGGREGATORS.API,apiLogin);await membership(client,AGGREGATORS.WORKER,workerLogin);for(const name of apiRoles)await membership(client,name,AGGREGATORS.API);for(const name of workerRoles)await membership(client,name,AGGREGATORS.WORKER);await attributes(client,[apiLogin,workerLogin,AGGREGATORS.API,AGGREGATORS.WORKER]);await validateMemberships(client,{apiLogin,workerLogin,apiRoles,workerRoles});return Object.freeze({workloads:Object.freeze(['API','WORKER']),aggregators:AGGREGATORS});},async cleanup({apiLogin,workerLogin,dropAggregators=true}){for(const name of [apiLogin,workerLogin]){await client.query(`DROP ROLE IF EXISTS ${identifier(name)}`);}if(dropAggregators)for(const name of Object.values(AGGREGATORS))await client.query(`DROP ROLE IF EXISTS ${identifier(name)}`);}});}
module.exports={AGGREGATORS,configureLocalTenantDatabaseConnect,createLocalTenantIdentityProvisioner,validateLocalTenantIdentity,validateLocalTenantRoleChain};
