'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {lookup}=require('../src/organizationalProfile/editorialUiRecovery');
const {snapshotDigest}=require('../src/security/tenantAuthorityRecovery');
const {intentionLookupQuery,execute}=require('../src/security/authorityProtocolQueries');
const {editorialUiConfiguration}=require('../src/config/editorialUi');
test('dedicated UI key configuration fails closed without disclosing supplied values',()=>{
 for(const raw of [undefined,'not-json','[]','{"private":"secret-canary"}'])assert.throws(()=>editorialUiConfiguration({PROFILE_EDITORIAL_UI_KEYS_JSON:raw,PROFILE_EDITORIAL_UI_KEY_ID:'private'}),e=>e.code==='EDITORIAL_UI_KEY_NOT_CONFIGURED'&&!e.message.includes('canary'));
 assert.equal(editorialUiConfiguration({PROFILE_EDITORIAL_UI_KEYS_JSON:JSON.stringify({local:'a'.repeat(32)}),PROFILE_EDITORIAL_UI_KEY_ID:'local'}).tokenKeyId,'local');
});
test('new authority query is closed and binds five parameters; arbitrary lookup stays denied',async()=>{
 let call;await execute({query:async(sql,args)=>(call={sql,args},{rows:[{result:{rows:[],rowCount:0}}]})},intentionLookupQuery,['org','subject','key','EDITORIAL_PUBLISH','resource']);
 assert.equal(call.args[1].length,5);await assert.rejects(()=>execute({},'SELECT * FROM public.authority_commit_guard'),{code:'42501'});
 assert.match(intentionLookupQuery,/LIMIT 101$/);assert(!intentionLookupQuery.startsWith('SELECT *'));
});
function fixture({state='TENANT_COMMITTED',reconciliation='COMMITTED',row=null,guards=true}={}){
 const org=randomUUID(),actor=randomUUID(),id=randomUUID(),key=randomUUID();const physical={tenantId:org,organizationId:org,connectionVersion:1};
 const guard={guard_id:randomUUID(),protected_operations:[{resourceId:id}],intention_digest:'a'.repeat(64),deadline:'2030-01-01T00:00:00Z',state,reconciliation_result:reconciliation,source_binding:{snapshotDigest:snapshotDigest(physical)}};
 const result={versionId:id,state:'PUBLISHED',active:false};let parameters;
 const client={async query(sql){if(sql.includes('editorial_idempotency_record'))return{rows:row?[{intention_digest:guard.intention_digest,result_projection:result}]:[]};if(sql.includes('SELECT candidate_id'))return{rows:[{candidate_id:randomUUID()}]};return{rows:[]};}};
 const opts={input:{operation:'PUBLISH',resourceId:id,idempotencyKey:key},context:{actor:{id:actor,organizationId:org},correlationId:randomUUID()},handle:{},authority:{resolve:async()=>({})},data:{authorizationDataPort:{load:async()=>({grants:[]})},membershipPort:{revalidate:async()=>({})}},policy:{evaluate:()=>({allowed:true})},catalogs:{operationCatalog:{resolve:()=>({})}},coordinator:{pool:{query:async(sql,args)=>(assert.equal(sql,intentionLookupQuery),parameters=args,{rows:guards?[guard]:[]})}},dependencies:{directoryRepository:{resolveSnapshotByOrganization:async()=>physical},credentialProvider:{resolve:async()=>({dispose:async()=>{}})},poolManager:{acquire:async()=>({client,release:async()=>{}})},bindingVerifier:{verify:async()=>{}}},clock:{now:()=>new Date('2026-01-01')}};
 return {opts,guard,parameters:()=>parameters,expected:[org,actor,key,'EDITORIAL_PUBLISH',id]};
}
test('lookup four outcomes require distinct evidence; absent receipt is not rollback',async()=>{
 for(const [config,status] of [[{row:true},'CONFIRMED'],[{state:'ABORTED',reconciliation:'ROLLED_BACK'},'FAILED_FINAL'],[{state:'PREPARED',reconciliation:null},'RESOLVING'],[{guards:false},'UNKNOWN'],[{row:false},'UNKNOWN']]){
 const f=fixture(config),result=await lookup(f.opts);assert.equal(result.status,status);assert.deepEqual(f.parameters(),f.expected);assert(!JSON.stringify(result).includes('digest'));assert.equal(result.receipt!==null,status==='CONFIRMED');}
});
test('lookup refuses revoked reader and mismatched protected resource',async()=>{
 const f=fixture({row:true});f.opts.policy.evaluate=()=>({allowed:false});await assert.rejects(()=>lookup(f.opts),{code:'NOT_AUTHORIZED'});assert.equal(f.parameters(),undefined);
 const other=fixture({row:true});other.guard.protected_operations=[{resourceId:randomUUID()}];assert.equal((await lookup(other.opts)).status,'UNKNOWN');
});

test('Central 010 changes only the closed function and restores the exact 009 definition',()=>{
 const {migrationSql}=require('../src/security/centralMigrationManifest');
 const old=migrationSql('009_authority_commit_guard','up').sql;
 const start=old.indexOf('CREATE FUNCTION authority_api.execute('),end=old.indexOf('\nDO $$ DECLARE tab text;',start);
 const restored=old.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 assert.equal(migrationSql('010_editorial_intention_lookup','down').sql.split('\n').slice(1).join('\n'),restored);
 const up=migrationSql('010_editorial_intention_lookup','up').sql;
 assert(!/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+(TABLE|public\.)/i.test(up));
 for(const direction of ['up','down'])assert.throws(()=>migrationSql('010_editorial_intention_lookup',direction,()=>up+'\nSELECT 1;'),/checksum mismatch/);
});

test('editorial parser and middleware errors remain sanitized even in development',async()=>{
 const express=require('express'),app=express();
 const {createErrorHandler}=require('../src/app');const reported=[];
 app.use('/api/organization-profile/editorial-ui',express.json({limit:'256kb'}));
 app.post('/api/organization-profile/editorial-ui/drafts',(req,res,next)=>next(new Error('restricted-digest-canary')));
 app.use(createErrorHandler({nodeEnv:'development',reportError(error){reported.push(error);}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const [body,status] of [['{"restricted-digest-canary":',400],[JSON.stringify({content:'x'.repeat(270000)}),413],['{}',503]]){
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api/organization-profile/editorial-ui/drafts`,{method:'POST',headers:{'content-type':'application/json'},body});
 const value=await r.json();assert.equal(r.status,status);assert.deepEqual(Object.keys(value).sort(),['correlationId','error']);assert(!JSON.stringify(value).includes('canary'));}
 assert.deepEqual(reported,[{code:'SERVICE_UNAVAILABLE'}]);assert(!JSON.stringify(reported).includes('canary'));
 }finally{await new Promise(r=>server.close(r));}
});

test('RESOLVING is not disclosed when authority is revoked during lookup',async()=>{
 const f=fixture({state:'PREPARED',reconciliation:null});
 f.opts.authority.resolve=async()=>{throw Object.assign(new Error('revoked'),{code:'AUTHORITY_STALE'});};
 await assert.rejects(()=>lookup(f.opts),{code:'NOT_AUTHORIZED'});
});
