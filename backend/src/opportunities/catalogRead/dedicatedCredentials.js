 'use strict';
const PROFILE=Object.freeze({catalog:Object.freeze({login:'gcni_catalog_reader',role:'c4g_catalog_projection_reader'}),authority:Object.freeze({login:'gcni_catalog_authority',role:'c4g_catalog_projection_membership'}),policy:Object.freeze({login:'gcni_catalog_policy',role:'gcni_control_reader'})});
async function assertDedicatedRole(client,kind){
 const expected=PROFILE[kind];if(!expected)throw Error('CATALOG_CREDENTIAL_PROFILE_INVALID');
 const row=(await client.query(`SELECT rolname,rolcanlogin AND rolconfig IS NULL AND (rolvaliduntil IS NULL OR rolvaliduntil>clock_timestamp()) AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS limited,
 (SELECT COALESCE(json_agg(json_build_object('role',p.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option)),'[]'::json) FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.member=r.oid) AS parents,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN('r','v','m','p') AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS excess
 FROM pg_roles r WHERE rolname=$1`,[expected.login])).rows[0];
 if(!row?.limited||row.excess||row.parents?.length!==1||row.parents[0].role!==expected.role||row.parents[0].admin||row.parents[0].inherit||!row.parents[0].set)throw Error('CATALOG_DEDICATED_ROLE_REJECTED');
 return expected;
}
async function assertDedicatedSession(client,kind,database){
 const expected=await assertDedicatedRole(client,kind);
 const identity=(await client.query('SELECT session_user AS login,current_user AS current,current_database() AS database')).rows[0];
 if(identity?.login!==expected.login||identity.current!==expected.login||identity.database!==database)throw Error('CATALOG_DEDICATED_SESSION_REJECTED');
}
async function normalReadFingerprint(client){
 const names=[PROFILE.catalog.login,PROFILE.authority.login];
 const rows=(await client.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[names])).rows;
 if(rows.length===0)return require('./readSchema').fingerprint(client);
 if(rows.length!==2)throw Error('CATALOG_CREDENTIAL_PAIR_INCOMPLETE');
 await assertDedicatedRole(client,'catalog');await assertDedicatedRole(client,'authority');
 return require('./readSchema').fingerprint(client,...names);
}
module.exports={PROFILE,assertDedicatedRole,assertDedicatedSession,normalReadFingerprint};
