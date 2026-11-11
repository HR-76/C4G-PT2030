'use strict';
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {preflightCentral}=require('../../../backend/src/security/centralMigrationPreflight');
const {createAuthorityCoordinator}=require('../../../backend/src/security/authorityCoordinator');
const protocol=require('../../../backend/src/security/authorityProtocolQueries');

// Real LOGIN sessions, never SET ROLE on a superuser connection as a proxy.
async function authorityAclFixture(central){
  const url=new URL(central.connectionString);url.username='c4g_central_runtime';url.password=randomBytes(32).toString('hex');
  await central.pool.query(`ALTER ROLE c4g_central_runtime LOGIN PASSWORD '${url.password}'`);
  const generalPool=new Pool({connectionString:url.toString(),max:1});
  const general=await generalPool.connect();
  await central.pool.query('ALTER ROLE c4g_central_runtime NOLOGIN');
  const outsiderUrl=new URL(central.connectionString);outsiderUrl.username='r6_acl_untrusted';outsiderUrl.password=randomBytes(32).toString('hex');
  await central.pool.query(`CREATE ROLE r6_acl_untrusted LOGIN PASSWORD '${outsiderUrl.password}'`);
  const outsider=new Pool({connectionString:outsiderUrl.toString(),max:1});
  const denied=work=>assert.rejects(work,error=>error.code==='42501');
  async function checkPrivileges(){
    assert.deepEqual((await general.query('SELECT session_user,current_user')).rows[0],{session_user:'c4g_central_runtime',current_user:'c4g_central_runtime'});
    const tables=['authority_commit_guard','authority_write_request','authority_write_permit','authority_scope_epoch','authority_f5_state'];
    for(const client of [general,central.authorityPool]){
      for(const table of tables)for(const sql of [`SELECT * FROM public.${table}`,`INSERT INTO public.${table} DEFAULT VALUES`,
        `DELETE FROM public.${table}`,`TRUNCATE public.${table}`])await denied(()=>client.query(sql));
      await denied(()=>client.query("UPDATE public.authority_commit_guard SET state='ABORTED'"));
      for(const [table,column]of [['authority_write_request','state'],['authority_write_permit','epoch'],
        ['authority_scope_epoch','epoch'],['authority_f5_state','authorization_version']])
        await denied(()=>client.query(`UPDATE public.${table} SET ${column}=${column}`));
      await denied(()=>client.query("SELECT nextval('public.authority_epoch_seq')"));
      for(const role of ['c4g_authority_owner','c4g_authority_coordinator'])await denied(()=>client.query(`SET ROLE ${role}`));
      await denied(()=>client.query('CREATE TABLE public.forbidden_authority_object(id int)'));
      await denied(()=>client.query('ALTER TABLE public.authority_commit_guard DISABLE TRIGGER ALL'));
      await denied(()=>client.query('DROP TABLE public.authority_commit_guard'));
      await denied(()=>client.query('CREATE ROLE forbidden_authority_role'));
      await denied(()=>client.query('SELECT public.authority_protocol_guard()'));
    }
    await denied(()=>central.authorityPool.query('SET ROLE c4g_central_runtime'));
    await denied(()=>general.query("SELECT authority_api.execute('invalid',ARRAY[]::text[],NULL)"));
    for(const pool of [{connect:async()=>({query:(...a)=>general.query(...a),release(){}}),query:(...a)=>general.query(...a)},central.pool]){
      const wrong=createAuthorityCoordinator({pool,permitSecret:central.permitSecret});
      await assert.rejects(()=>wrong.withAuthority(()=>{}),error=>error.code==='AUTHORITY_LOGIN_REQUIRED');
    }
    await denied(()=>protocol.execute(central.authorityPool,'SELECT 1; DROP TABLE public.authority_commit_guard',[],null));
    const quoted=await protocol.execute(central.authorityPool,'SELECT sess FROM public.application_session_store WHERE sid=$1',
      ["$1' OR TRUE; DELETE FROM public.authority_commit_guard; --"]);
    assert.deepEqual(quoted.rows,[],'bound data must never be interpolated as SQL or recursively replaced');
  }
  async function checkDrift(){
    const tests=[];
    const pair=(name,up,down)=>tests.push({name,up,down});
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])pair(privilege,
      `GRANT ${privilege} ON public.authority_commit_guard TO c4g_central_runtime`,
      `REVOKE ${privilege} ON public.authority_commit_guard FROM c4g_central_runtime`);
    pair('COLUMN_UPDATE','GRANT UPDATE(state) ON public.authority_commit_guard TO c4g_central_runtime','REVOKE UPDATE(state) ON public.authority_commit_guard FROM c4g_central_runtime');
    pair('SEQUENCE_USAGE','GRANT USAGE ON public.authority_epoch_seq TO c4g_central_runtime','REVOKE USAGE ON public.authority_epoch_seq FROM c4g_central_runtime');
    pair('EXECUTE_GENERAL','GRANT EXECUTE ON FUNCTION authority_api.execute(text,text[],text) TO c4g_central_runtime','REVOKE EXECUTE ON FUNCTION authority_api.execute(text,text[],text) FROM c4g_central_runtime');
    pair('MEMBERSHIP','GRANT c4g_authority_coordinator TO c4g_central_runtime','REVOKE c4g_authority_coordinator FROM c4g_central_runtime');
    pair('ADMIN_OPTION','GRANT c4g_authority_coordinator TO c4g_authority_runtime WITH ADMIN TRUE','GRANT c4g_authority_coordinator TO c4g_authority_runtime WITH ADMIN FALSE, INHERIT TRUE, SET FALSE');
    pair('SET_OPTION','GRANT c4g_authority_coordinator TO c4g_authority_runtime WITH SET TRUE','GRANT c4g_authority_coordinator TO c4g_authority_runtime WITH SET FALSE, INHERIT TRUE, ADMIN FALSE');
    pair('OWNER','ALTER TABLE public.authority_commit_guard OWNER TO c4g_central_owner','ALTER TABLE public.authority_commit_guard OWNER TO c4g_authority_owner');
    pair('PUBLIC_SELECT','GRANT SELECT ON public.authority_commit_guard TO PUBLIC','REVOKE SELECT ON public.authority_commit_guard FROM PUBLIC');
    pair('PUBLIC_EXECUTE','GRANT EXECUTE ON FUNCTION authority_api.execute(text,text[],text) TO PUBLIC','REVOKE EXECUTE ON FUNCTION authority_api.execute(text,text[],text) FROM PUBLIC');
    pair('PUBLIC_SCHEMA','GRANT USAGE ON SCHEMA authority_api TO PUBLIC','REVOKE USAGE ON SCHEMA authority_api FROM PUBLIC');
    pair('PUBLIC_CREATE','GRANT CREATE ON SCHEMA public TO PUBLIC','REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    pair('RUNTIME_TABLE','GRANT SELECT ON public.authority_commit_guard TO c4g_authority_runtime','REVOKE SELECT ON public.authority_commit_guard FROM c4g_authority_runtime');
    for(const attribute of ['SUPERUSER','BYPASSRLS','CREATEROLE','CREATEDB','REPLICATION','INHERIT'])pair(attribute,
      `ALTER ROLE c4g_authority_runtime ${attribute}`,`ALTER ROLE c4g_authority_runtime NO${attribute}`);
    pair('LOGIN','ALTER ROLE c4g_authority_coordinator LOGIN','ALTER ROLE c4g_authority_coordinator NOLOGIN');
    pair('ROLE_CONFIG',"ALTER ROLE c4g_authority_runtime SET search_path TO public",'ALTER ROLE c4g_authority_runtime RESET search_path');
    for(const recipient of ['PUBLIC','r6_acl_untrusted']){
      for(const table of ['application_session_store','application_session','organization_membership','global_user','organization','oidc_transaction','c4g_schema_migration','c4g_database_identity'])
        pair(`F3_${table}_${recipient}`,`GRANT SELECT ON public.${table} TO ${recipient}`,`REVOKE SELECT ON public.${table} FROM ${recipient}`);
      for(const [table,column] of [['application_session_store','sess'],['global_user','primary_email']])
        pair(`F3_COLUMN_${table}_${recipient}`,`GRANT SELECT(${column}) ON public.${table} TO ${recipient}`,`REVOKE SELECT(${column}) ON public.${table} FROM ${recipient}`);
      pair(`F3_GRANT_OPTION_${recipient}`,`GRANT UPDATE ON public.organization_membership TO ${recipient}${recipient==='PUBLIC'?'':' WITH GRANT OPTION'}`,
        `REVOKE UPDATE ON public.organization_membership FROM ${recipient}`);
    }
    await denied(()=>outsider.query('SELECT sess FROM public.application_session_store'));
    for(const {name,up,down} of tests){
      await central.pool.query(up);
      try{
        let called=false;
        await assert.rejects(()=>preflightCentral(central.pool),/drift/i,`${name}: canonical preflight must reject excess privilege`);
        await assert.rejects(()=>central.coordinator.withAuthority(()=>{called=true;}),error=>error.code==='AUTHORITY_SECURITY_DRIFT',`${name}: runtime admission`);
        assert.equal(called,false,`${name}: no functional callback admitted`);
        if(name==='MEMBERSHIP')await denied(()=>general.query("SELECT authority_api.execute('invalid',ARRAY[]::text[],NULL)"));
      }finally{await central.pool.query(down);}
      await preflightCentral(central.pool);
    }
    return tests.length;
  }
  async function checkWarmSchemaDrift(){
    // Keep exactly the same acquired physical client after its first admission.
    const client=await central.authorityPool.connect();
    const coordinator=createAuthorityCoordinator({pool:{query:(...a)=>client.query(...a),
      connect:async()=>({query:(...a)=>client.query(...a),release(){}})},permitSecret:central.permitSecret});
    const constraint=(await central.pool.query(`SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint
      WHERE conrelid='public.authority_commit_guard'::regclass AND pg_get_constraintdef(oid) LIKE '%deadline%created_at%'`)).rows[0];
    assert.ok(constraint);assert.match(constraint.conname,/^[a-z_]+$/);
    const version='009_authority_commit_guard';
    const checksum=(await central.pool.query('SELECT checksum_sha256 FROM public.c4g_schema_migration WHERE version=$1',[version])).rows[0].checksum_sha256;
    const cases=[
      {up:()=>central.pool.query(`ALTER TABLE public.authority_commit_guard DROP CONSTRAINT "${constraint.conname}"`),
       down:()=>central.pool.query(`ALTER TABLE public.authority_commit_guard ADD CONSTRAINT "${constraint.conname}" ${constraint.definition}`)},
      {up:()=>central.pool.query('UPDATE public.c4g_schema_migration SET checksum_sha256=$1 WHERE version=$2',['0'.repeat(64),version]),
       down:()=>central.pool.query('UPDATE public.c4g_schema_migration SET checksum_sha256=$1 WHERE version=$2',[checksum,version])}
    ];
    try{for(const test of cases){
      await coordinator.withAuthority(()=>{});
      await test.up();let called=false;
      try{
        await assert.rejects(()=>preflightCentral(central.pool),/drift|Applied migration metadata differs/i);
        await assert.rejects(()=>coordinator.withAuthority(()=>{called=true;}),/drift|Applied migration metadata differs/i);
        assert.equal(called,false,'warmed physical client must reject before functional callback');
      }finally{await test.down();}
      await preflightCentral(central.pool);await coordinator.withAuthority(()=>{});
    }}finally{client.release();}
    return cases.length;
  }
  async function attackActiveGuard(guard){
    // Even an accidental SELECT/UPDATE grant cannot manufacture the private
    // finalization permit. The permit is never persisted, only its digest.
    await central.pool.query('GRANT SELECT,UPDATE,DELETE ON public.authority_commit_guard TO c4g_central_runtime');
    await central.pool.query('GRANT SELECT ON public.application_session_store TO PUBLIC');
    try{
      await assert.rejects(()=>preflightCentral(central.pool),/drift/i);
      await assert.rejects(()=>central.coordinator.withAuthority(()=>{}),error=>error.code==='AUTHORITY_SECURITY_DRIFT');
      await denied(()=>general.query("UPDATE public.authority_commit_guard SET state='ABORTED',reconciliation_result='ROLLED_BACK',resolved_at=clock_timestamp() WHERE guard_id=$1",[guard.guard_id]));
      await denied(()=>general.query('DELETE FROM public.authority_commit_guard WHERE guard_id=$1',[guard.guard_id]));
      await general.query("SELECT set_config('authority.finalization_permit',$1,false)",['f'.repeat(64)]);
      await denied(()=>general.query("UPDATE public.authority_commit_guard SET state='ABORTED',reconciliation_result='ROLLED_BACK',resolved_at=clock_timestamp() WHERE guard_id=$1",[guard.guard_id]));
      const sql=protocol.queries.find(q=>q.startsWith('UPDATE public.authority_commit_guard SET state=$2,reconciliation_result=$3'));
      assert.ok(sql);
      for(const permit of [null,'f'.repeat(64)])await denied(()=>protocol.execute(central.authorityPool,sql,[guard.guard_id,'ABORTED','ROLLED_BACK'],permit));
      assert.equal((await central.pool.query('SELECT state FROM public.authority_commit_guard WHERE guard_id=$1',[guard.guard_id])).rows[0].state,'PREPARED');
    }finally{
      await central.pool.query('REVOKE SELECT,UPDATE,DELETE ON public.authority_commit_guard FROM c4g_central_runtime');
      await central.pool.query('REVOKE SELECT ON public.application_session_store FROM PUBLIC');
      await preflightCentral(central.pool);
    }
  }
  return{checkPrivileges,checkDrift,checkWarmSchemaDrift,attackActiveGuard,async close(){general.release();await generalPool.end();
    await outsider.end();await central.pool.query('DROP ROLE r6_acl_untrusted');}};
}
module.exports={authorityAclFixture};
