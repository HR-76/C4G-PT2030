'use strict';
// Standalone gate: never reads .env, accepts an external database, or touches Dev.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {manifest,knownManifest,migrationSql}=require('../../../backend/src/security/centralMigrationManifest');
const {applyCentralMigrationsWithManifest}=require('../../../backend/scripts/runCentralMigrations');
const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository');
const {createCentralManualAuthoring}=require('../../../backend/src/fundingTenders/manualAuthoring');
const {createPlatformAudit}=require('../../../backend/src/fundingTenders/audit');
const {eventHash,GENESIS_HASH}=require('../../../backend/src/audit/integrity');
const root=path.resolve(__dirname,'../../..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
  assert.equal(process.argv[2],'--isolated','Explicit isolated gate invocation required');
  assert.ok(process.argv[3]===undefined||process.argv[3]==='--catalog-read-048');
  const targetManifest=process.argv[3]==='--catalog-read-048'?knownManifest.filter(entry=>entry.version<='048_catalog_read_service_v1'):manifest;
  const gateId=randomUUID().replaceAll('-',''),name=`c4g-manual-${gateId}`,database=`manual_gate_${gateId}`;
  const evidence=path.join(root,'output',`central-manual-pg-${gateId}`);
  fs.mkdirSync(evidence,{recursive:true});
  const report={gateId,status:'RUNNING',scope:'DISPOSABLE_POSTGRES_ONLY',checks:[],cleanup:false,limitations:['Synthetic HTTP authentication; no OIDC provider exercised','No tenant databases or production rollout','Writer connection uses isolated installer; production writer login provisioning is not validated']};
  const save=()=>fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(report,null,2));
  let container,adminPool,writerPool,readerPool,server;
  const secret=randomBytes(32).toString('hex');
  const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe'],env:{...process.env,POSTGRES_PASSWORD:secret}}).trim();
  async function check(name,work){report.phase=name;save();await work();report.checks.push({name,status:'PASS'});save();console.log(`PASS ${name}`);}
  try{
    report.phase='CREATE_ISOLATED_POSTGRES';save();
    docker(['info','--format','{{.ServerVersion}}']);
    // The admitted 048 read package is rehearsed on PostgreSQL 18; retain the
    // original PostgreSQL 17 baseline for the historical manual-authoring gate.
    const image=docker(['image','inspect',process.argv[3]==='--catalog-read-048'?'postgres:18-alpine':'postgres:17-alpine','--format','{{.Id}}']);
    assert.match(image,/^sha256:[a-f0-9]{64}$/);
    container=docker(['run','--detach','--name',name,'--label',`c4g.manual-gate=${gateId}`,
      '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=c4g_f12_admin','--env',`POSTGRES_DB=${database}`,
      '--tmpfs',process.argv[3]==='--catalog-read-048'?'/var/lib/postgresql:rw':'/var/lib/postgresql/data:rw','-p','127.0.0.1::5432',image]);
    assert.match(container,/^[a-f0-9]{64}$/);
    const owned=()=>{
      const label=docker(['inspect','--format','{{index .Config.Labels "c4g.manual-gate"}}',container]);
      const actualName=docker(['inspect','--format','{{.Name}}',container]);
      assert.equal(label,gateId);assert.equal(actualName,`/${name}`);
    };
    owned();
    const binding=docker(['port',container,'5432/tcp']);
    assert.match(binding,/^127\.0\.0\.1:\d+$/);
    const port=Number(binding.split(':')[1]);assert.ok(port>1024&&port!==5432);
    const config={host:'127.0.0.1',port,database,password:secret,max:6,connectionTimeoutMillis:5000,query_timeout:15000};
    adminPool=new Pool({...config,user:'c4g_f12_admin'});
    let ready=false;
    for(let i=0;i<40;i++){try{await adminPool.query('SELECT 1');ready=true;break;}catch{await pause(250);}}
    assert.equal(ready,true);
    report.postgres=(await adminPool.query('SHOW server_version')).rows[0].server_version;
    report.image=image;
    await check('EMPTY_ISOLATED_TARGET',async()=>{
      owned();const row=(await adminPool.query('SELECT current_database() db,current_user actor,(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE \'pg_%\' AND n.nspname<>\'information_schema\' AND c.relkind IN (\'r\',\'p\')) tables')).rows[0];
      assert.equal(row.db,database);assert.equal(row.actor,'c4g_f12_admin');assert.equal(row.tables,0);
    });
    await check('EXISTING_CENTRAL_MIGRATIONS_AND_PREFLIGHT',async()=>{
      for(const role of ['c4g_central_owner','c4g_central_runtime'])await adminPool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await adminPool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
      const applied=await applyCentralMigrationsWithManifest(adminPool,targetManifest,migrationSql,{afterSql:async({entry})=>{report.lastMigration=entry.version;save();}});
      assert.equal(applied.length,targetManifest.length);report.migrations={count:applied.length,latest:applied.at(-1)};
      const admitted=await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(adminPool);
      assert.equal(admitted.currentVersion,targetManifest.at(-1).version);
      // The old v1-only fingerprint predates the registered v2/read package.
      // 048 uses the unchanged version-aware central admission above instead.
      if(process.argv[3]===undefined)await require('../../../backend/src/opportunities/preflight').opportunityPreflight(adminPool,'central');
    });
    const admin=randomUUID(),memberA=randomUUID(),memberB=randomUUID(),orgA=randomUUID(),orgB=randomUUID();
    await check('SYNTHETIC_ACTORS_AND_LIMITED_READER_LOGIN',async()=>{
      for(const id of [admin,memberA,memberB])await adminPool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic gate actor',$2,'ACTIVE')",[id,`${id}@example.invalid`]);
      await adminPool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin]);
      for(const [id,user] of [[orgA,memberA],[orgB,memberB]]){
        await adminPool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Synthetic','Synthetic',$2,'UNSPECIFIED','ACTIVE','EUR','USER_OPTIONAL')",[id,`gate-${id}`]);
        await adminPool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[randomUUID(),user,id]);
      }
      // The writer uses the isolated installer; mutation code switches to the catalog runtime role.
      await adminPool.query(`CREATE ROLE manual_gate_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret}'`);
      await adminPool.query('GRANT c4g_catalog_reader TO manual_gate_reader WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');
      writerPool=new Pool({...config,user:'c4g_f12_admin'});readerPool=new Pool({...config,user:'manual_gate_reader'});
      for(const pool of [readerPool])assert.equal((await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0].rolsuper,false);
      const reader=await readerPool.connect();try{const admission=await require('../../../backend/src/security/catalogReaderSchema').createReaderSchemaAdmission(reader);await require('../../../backend/src/security/catalogReaderSecurity').assertReaderSession(reader,admission);}finally{reader.release();}
      assert.equal((await adminPool.query('SELECT count(*)::int n FROM public.organization_membership WHERE global_user_id=$1',[admin])).rows[0].n,0);
    });

    const repository=createFundingRepository({pool:writerPool});
    const service=createCentralManualAuthoring({pool:writerPool,repository});
    const reader=createFundingRepository({pool:readerPool,readRole:true});
    const callInformation={geographySummary:'Portugal e Espanha\nAtividades presenciais ou remotas.',eligibleGroups:'Universidades, PME e associações sem fins lucrativos.',eligibilitySummary:'Consórcio de pelo menos duas entidades.\nApresentar plano de atividades e orçamento.'};
    const body=()=>({requestId:randomUUID(),fields:{title:'Synthetic manual opportunity',funderName:'Synthetic funder',programmeName:'Manual programme',summary:'Original synthetic summary',officialUrl:'https://example.invalid/manual',openingDate:'2020-01-01',closingDate:'2099-12-31',fundingAmountMin:'0',fundingAmountMax:'123456789012345678.123456',currencyCode:'EUR',...callInformation}});
    const counts=async()=>(await adminPool.query(`SELECT
      (SELECT count(*)::int FROM opportunity_catalog.opportunity) opportunities,
      (SELECT count(*)::int FROM opportunity_catalog.revision) revisions,
      (SELECT count(*)::int FROM opportunity_catalog.provenance) provenance,
      (SELECT count(*)::int FROM opportunity_catalog.idempotency_record) receipts,
      (SELECT count(*)::int FROM audit.event) audits,
      (SELECT count(*)::int FROM opportunity_catalog.funding_identity) connector_identities`)).rows[0];
    let command=body(),receipt;
    await check('CREATE_AND_COMMITTED_PERSISTENCE',async()=>{
      receipt=await service.create(admin,command);
      assert.deepEqual(await counts(),{opportunities:1,revisions:1,provenance:1,receipts:1,audits:1,connector_identities:0});
      const row=(await adminPool.query('SELECT r.snapshot,p.source_type,p.source_namespace,p.recorded_by_actor_reference FROM opportunity_catalog.revision r JOIN opportunity_catalog.provenance p USING(revision_id) WHERE r.revision_id=$1',[receipt.revisionId])).rows[0];
      assert.equal(row.source_type,'C4G_MANUAL');assert.equal(row.source_namespace,'C4G_MANUAL_HTTP');assert.equal(row.recorded_by_actor_reference,admin);
      for(const [key,value] of Object.entries(command.fields))assert.equal(row.snapshot[key],value);
      assert.equal(row.snapshot.lifecycleState,'ACTIVE');assert.equal(row.snapshot.validationState,'PENDING_REVIEW');
    });
    await check('CONCURRENT_REPLAY_AND_CHANGED_INTENTION',async()=>{
      const previous=await counts();const replies=await Promise.all(Array.from({length:4},()=>service.create(admin,command)));
      for(const replay of replies)assert.deepEqual(replay,receipt);assert.deepEqual(await counts(),previous);
      await assert.rejects(service.create(admin,{...command,fields:{...command.fields,summary:'Changed'}}),{code:'OPPORTUNITY_DIGEST_MISMATCH'});
      for(const field of Object.keys(callInformation))await assert.rejects(service.create(admin,{...command,fields:{...command.fields,[field]:'Changed call information'}}),{code:'OPPORTUNITY_DIGEST_MISMATCH'});
      assert.deepEqual(await counts(),previous);
      const simultaneous=body();const [a,b]=await Promise.all([service.create(admin,simultaneous),service.create(admin,simultaneous)]);assert.deepEqual(a,b);
      assert.equal((await counts()).opportunities,previous.opportunities+1);
    });
    await check('RECONNECT_REPLAY_AND_LIMITED_CATALOG_READ',async()=>{
      const reconnected=new Pool({...config,user:'c4g_f12_admin'});
      try{const retry=createCentralManualAuthoring({pool:reconnected,repository:createFundingRepository({pool:reconnected})});assert.deepEqual(await retry.create(admin,command),receipt);}finally{await reconnected.end();}
      const list=await reader.list({q:'Synthetic',programme:'Manual programme',temporalState:'OPEN'});
      assert.equal(list.items.length,2);assert.ok(list.items.every(item=>item.source==='C4G_MANUAL'));assert.deepEqual(list.programmes,['Manual programme']);
      assert.equal((await reader.get(receipt.opportunityId)).snapshot.summary,command.fields.summary);
      assert.equal((await reader.revision(receipt.opportunityId,receipt.revisionId)).fundingAmountMax,command.fields.fundingAmountMax);
      const summary=await reader.dashboardSummary('2026-10-29');assert.equal(Number(summary.total),2);
    });
    await check('CALL_INFORMATION_SURVIVES_AUTHORIZED_DETAIL_AND_REVISION_READS',async()=>{
      const detail=await reader.get(receipt.opportunityId),historical=await reader.revision(receipt.opportunityId,receipt.revisionId);
      for(const [field,value] of Object.entries(callInformation)){
        assert.equal(detail.snapshot[field],value);
        assert.equal(historical[field],value);
      }
    });
    await check('DENIED_AUTHORITY_AND_INVALID_INPUT_HAVE_NO_WRITES',async()=>{
      const previous=await counts();
      for(const actor of [memberA,memberB])await assert.rejects(service.create(actor,body()),{code:'FUNDING_FORBIDDEN'});
      for(const extra of [{organizationId:orgA},{actor:admin},{provenance:{sourceType:'C4G_MANUAL'}}])await assert.rejects(service.create(admin,{...body(),...extra}));
      for(const fields of [{closingDate:'1900-01-01'},{officialUrl:'javascript:alert(1)'},{currencyCode:'BADCODE'}]){const input=body();await assert.rejects(service.create(admin,{...input,fields:{...input.fields,...fields}}));}
      for(const [field,limit] of [['geographySummary',2000],['eligibleGroups',4000],['eligibilitySummary',4000]])for(const value of [true,[],{},'x'.repeat(limit+1)]){
        const input=body();await assert.rejects(service.create(admin,{...input,fields:{...input.fields,[field]:value}}));
      }
      assert.deepEqual(await counts(),previous);
      await adminPool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]);
      await assert.rejects(service.create(admin,command),{code:'FUNDING_FORBIDDEN'});
      await adminPool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE global_user_id=$1",[admin]);
    });
    await check('REAL_AUDIT_THEN_FAILURE_ROLLS_BACK_EVERY_TABLE',async()=>{
      const previous=await counts(),head=(await adminPool.query('SELECT * FROM audit.chain_head')).rows;
      const realAudit=createPlatformAudit({source:'API'});
      const failing=createCentralManualAuthoring({pool:writerPool,repository,audit:async(client,event)=>{await realAudit(client,event);throw Error('SYNTHETIC_AFTER_AUDIT_FAILURE');}});
      const failedCommand=body();await assert.rejects(failing.create(admin,failedCommand),/SYNTHETIC_AFTER_AUDIT_FAILURE/);
      assert.deepEqual(await counts(),previous);assert.deepEqual((await adminPool.query('SELECT * FROM audit.chain_head')).rows,head);
      await service.create(admin,failedCommand);assert.equal((await counts()).opportunities,previous.opportunities+1);
    });
    await check('REVOCATION_LOCK_SERIALIZES_WITH_COMMIT',async()=>{
      let entered,release;const inside=new Promise(resolve=>{entered=resolve;}),allowCommit=new Promise(resolve=>{release=resolve;});
      const realAudit=createPlatformAudit({source:'API'});
      const paused=createCentralManualAuthoring({pool:writerPool,repository,audit:async(client,event)=>{await realAudit(client,event);entered();await allowCommit;}});
      const input=body(),writing=paused.create(admin,input);writing.catch(()=>{});
      await Promise.race([inside,writing.then(()=>{throw Error('EXPECTED_AUDIT_BARRIER');})]);
      const revoker=await adminPool.connect();
      try{
        await revoker.query('BEGIN');await revoker.query("SET LOCAL lock_timeout='150ms'");
        await assert.rejects(revoker.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]),{code:'55P03'});
        await revoker.query('ROLLBACK');
      }finally{await revoker.query('ROLLBACK');revoker.release();release();await writing;}
      await adminPool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]);
      await assert.rejects(service.create(admin,input),{code:'FUNDING_FORBIDDEN'});
      await adminPool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE global_user_id=$1",[admin]);
    });
    await check('READER_ACLS_AND_APPEND_ONLY_HISTORY',async()=>{
      const client=await readerPool.connect();try{
        for(const sql of ['DELETE FROM opportunity_catalog.opportunity','UPDATE opportunity_catalog.revision SET snapshot=snapshot','SELECT * FROM opportunity_catalog.provenance','SELECT * FROM public.global_user']){
          await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_catalog_reader');await assert.rejects(client.query(sql),{code:'42501'});await client.query('ROLLBACK');
        }
      }finally{await client.query('ROLLBACK');client.release();}
      await assert.rejects(adminPool.query('UPDATE opportunity_catalog.revision SET snapshot=snapshot'),/OPPORTUNITY_HISTORY_IMMUTABLE/);
      await assert.rejects(adminPool.query('DELETE FROM opportunity_catalog.provenance'),/OPPORTUNITY_HISTORY_IMMUTABLE/);
    });
    await check('HTTP_CREATE_AND_TWO_ORGANIZATIONS_READ_ONLY',async()=>{
      const express=require('../../../backend/node_modules/express');
      const context=async user=>{const row=(await adminPool.query("SELECT m.organization_id FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id JOIN public.global_user u ON u.id=m.global_user_id WHERE m.global_user_id=$1 AND m.status='ACTIVE' AND o.status='ACTIVE' AND u.status='ACTIVE'",[user])).rows[0];return row?{state:'VALID',organizationId:row.organization_id}:{state:'DENIED'};};
      const authenticate=(req,res,next)=>{const id=req.headers['x-fixture-actor'];if(![admin,memberA,memberB].includes(id))return res.sendStatus(401);req.user={id};req.sessionID='synthetic-gate-session';req.authContext={evidence:{authTime:Date.now()/1000-(req.headers['x-expired']?600:0),policyVersion:'manual-gate-v1'}};next();};
      const organizationMiddleware={requireServerSession(req,res,next){next();},async resolveOrganizationContext(req,res,next){if((await context(req.user.id)).state!=='VALID')return res.sendStatus(403);next();},requireOrganizationContext(req,res,next){next();}};
      const routes=require('../../../backend/src/fundingTenders/http').createFundingRouters({express,pool:writerPool,catalogReader:reader,authenticate,organizationMiddleware,sessionRegistry:{resolveOrganizationContext:({globalUserId})=>context(globalUserId)},policyVersion:'manual-gate-v1',recentMfaRequirement:{mfa:false,maxAgeSeconds:300}});
      const app=express();app.use(express.json());app.use('/admin',routes.platformCatalog);app.use('/catalog',routes.catalog);
      app.use('/private',require('../../../backend/src/routes/privateOpportunityRoutes').createPrivateOpportunityRouter({express,authenticate,organizationMiddleware,service:{create(){throw Error('PRIVATE_WRITE_REACHED');},update(){throw Error('PRIVATE_WRITE_REACHED');},archive(){throw Error('PRIVATE_WRITE_REACHED');}}}));
      server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      const request=async(url,actor,method='GET',input,headers={})=>fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{...(actor?{'x-fixture-actor':actor}:{}),'content-type':'application/json',...headers},...(input?{body:JSON.stringify(input)}:{})});
      const input=body(),response=await request('/admin',admin,'POST',input);assert.equal(response.status,201);const created=await response.json();
      assert.equal((await request('/admin',memberA,'POST',body())).status,403);
      assert.equal((await request('/admin',null,'POST',body())).status,401);
      assert.equal((await request('/admin',admin,'POST',body(),{'x-expired':'1'})).status,403);
      for(const user of [memberA,memberB]){
        const detail=await request(`/catalog/${created.opportunityId}`,user);assert.equal(detail.status,200);const detailBody=await detail.json();assert.equal(detailBody.source,'C4G_MANUAL');
        for(const [field,value] of Object.entries(callInformation))assert.equal(detailBody.snapshot[field],value);
        assert.equal((await request('/catalog',user,'POST',body())).status,405);
        for(const [method,url] of [['POST','/private'],['PUT',`/private/${receipt.opportunityId}`],['POST',`/private/${receipt.opportunityId}/archive`]])assert.equal((await request(url,user,method,body())).status,403);
      }
    });
    await check('PERSISTED_AUDIT_CHAIN_AND_FINAL_INVARIANTS',async()=>{
      const rows=(await adminPool.query('SELECT event_data,event_hash FROM audit.event ORDER BY sequence')).rows;
      let previous=GENESIS_HASH;
      for(const row of rows){assert.equal(row.event_data.previousHash,previous);assert.equal(eventHash(row.event_data),row.event_hash);assert.equal(row.event_data.actor.id,admin);assert.equal(row.event_data.organizationId,null);previous=row.event_hash;}
      const final=await counts();assert.equal(final.opportunities,5);assert.equal(final.revisions,5);assert.equal(final.provenance,5);assert.equal(final.receipts,5);assert.equal(final.audits,5);assert.equal(final.connector_identities,0);report.persisted=final;
    });
    report.status='PASS';
  }catch(error){report.status='FAIL';report.failure={phase:report.phase,name:error.name,message:String(error.message).replaceAll(secret,'[REDACTED]').replace(/postgres(?:ql)?:[^\s]+/gi,'[REDACTED]').slice(0,240),code:/^[A-Z0-9_]{2,80}$/.test(error.code||'')?error.code:'GATE_FAILED',...(typeof error.actual==='number'?{actual:error.actual}:{}),...(typeof error.expected==='number'?{expected:error.expected}:{}),...(/^[A-Z0-9_]{3,100}$/.test(error.message||'')?{reason:error.message}:{})};process.exitCode=1;}
  finally{
    if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    const closed=await Promise.allSettled([readerPool?.end(),writerPool?.end(),adminPool?.end()]);
    if(closed.some(item=>item.status==='rejected')){report.status='FAIL';report.poolCleanup='FAILED';process.exitCode=1;}
    if(container){
      try{
        assert.equal(docker(['inspect','--format','{{index .Config.Labels "c4g.manual-gate"}}',container]),gateId);
        assert.equal(docker(['inspect','--format','{{.Name}}',container]),`/${name}`);
        docker(['rm','--force','--volumes',container]);
        assert.equal(docker(['ps','-a','--filter',`label=c4g.manual-gate=${gateId}`,'--format','{{.ID}}']),'');report.cleanup=true;
      }catch{report.cleanup=false;report.status='FAIL';process.exitCode=1;}
    }
    save();console.log(JSON.stringify({status:report.status,checks:report.checks.length,cleanup:report.cleanup,evidence:path.relative(root,evidence)}));
  }
}
main().catch(()=>{console.error('MANUAL_GATE_SETUP_FAILED');process.exitCode=1;});
