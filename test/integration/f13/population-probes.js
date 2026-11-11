'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const methods=['create','edit','read','submit','verify','reject','dispute','revoke'];
async function runPopulationProbes({central,a,b,fixtures,decisions,metrics,controls}){
 const service=a.bound.service;const release=randomUUID(),unit=randomUUID(),method=randomUUID(),reason=randomUUID(),purpose=randomUUID(),metricRelease=randomUUID(),metric=randomUUID(),basis=randomUUID(),level=randomUUID(),geo=randomUUID(),territory=randomUUID(),group=randomUUID(),geoScheme=randomUUID(),groupScheme=randomUUID(),taxonomyRelease=randomUUID();
 const scope=db=>({type:'ORGANIZATION',id:db.org,organizationId:db.org});
 async function grants(db,u,list){await central.data.change({organizationId:db.org,membershipId:u.membershipId,expectedVersion:u.version,grants:list,assuranceRequirements:central.requirement});u.version++;u.handle=await db.bound.captureAuthenticatedRequest(u.request);}
 const all=db=>[...methods.map(op=>({permission:'profile_population.'+op,scope:scope(db)})),{permission:'document.read',scope:scope(db)}];
 async function actor(db){const u=await central.user(db.org,randomUUID(),randomUUID());u.version=1;await grants(db,u,all(db));return u;}
 const maker=await actor(a),checker=await actor(a),revoker=await actor(a),other=await actor(b);
 // This exhaustive gate can exceed the real 300s MFA window. Simulate a fresh
 // explicit synthetic OIDC authentication between groups, never inside a race
 // or the absent/stale-MFA probes; production freshness policy is unchanged.
 async function refreshActors(){for(const u of [maker,checker,revoker]){const sess=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[u.sid])).rows[0].sess;await evidence({...sess.auth.evidence,authTime:Math.floor(Date.now()/1000)},u);}}
 const create=(extra={})=>({assertionId:randomUUID(),assertionKind:'SERVED_POPULATION',countValue:'123456789',unitId:unit,metricId:metric,countingBasisId:basis,territoryRefs:[{geographicId:geo,coverageKind:'FULL'}],groupRefs:[{conceptId:group,schemeId:groupScheme,releaseId:taxonomyRelease}],organizationalScopeId:null,startDate:'2025-01-01',endDate:'2025-12-31',provenanceRef:randomUUID(),documentVersionIds:[],idempotencyKey:randomUUID(),...extra});
 const cmd=(op,id,revision,extra={})=>({assertionId:id,...(op==='read'?{reasonId:reason,purposeId:purpose}:{expectedRevision:revision}),...(op==='verify'?{methodId:method,validFrom:new Date(Date.now()-1000).toISOString(),validUntil:null}:{}),...(['reject','dispute','revoke'].includes(op)?{reasonId:reason}:{}),idempotencyKey:randomUUID(),...extra});
 async function counts(db){return(await db.pool.query(`SELECT (SELECT count(*) FROM organization_profile.population_assertion)::int heads,(SELECT count(*) FROM organization_profile.population_assertion_revision)::int revisions,(SELECT count(*) FROM organization_profile.population_idempotency_record)::int keys,(SELECT count(*) FROM organization_profile.population_revision_territory)::int territories,(SELECT count(*) FROM organization_profile.population_revision_group)::int groups,(SELECT count(*) FROM audit.event)::int events`)).rows[0];}
 async function denied(work){const before=await counts(a),beforeB=await counts(b);await assert.rejects(work);assert.deepEqual(await counts(a),before);assert.deepEqual(await counts(b),beforeB);}
 await denied(()=>service.create(create(),maker.handle)); // Empty catalogs fail closed.
 for(const db of [a,b]){
  await db.pool.query("INSERT INTO organization_profile.population_catalog_release(release_id,release_version,lifecycle) VALUES($1,'synthetic-test-only','PUBLISHED')",[release]);
  for(const [id,kind,code] of [[unit,'UNIT','SYNTHETIC_UNIT'],[method,'METHOD','SYNTHETIC_METHOD'],[reason,'REASON','SYNTHETIC_REASON'],[purpose,'PURPOSE','SYNTHETIC_PURPOSE'],[level,'GEOGRAPHIC_LEVEL','SYNTHETIC_LEVEL']])await db.pool.query('INSERT INTO organization_profile.population_catalog_entry(entry_id,release_id,kind,stable_code,unit_code,operations) VALUES($1,$2,$3,$4,$5,$6)',[id,release,kind,code,kind==='UNIT'?'SYNTHETIC_POPULATION_UNIT':null,methods.map(op=>op.toUpperCase())]);
  await db.pool.query("INSERT INTO organization_profile.metric_catalog_release(metric_release_id,release_version,lifecycle,semantic_digest,provenance) VALUES($1,'synthetic-population-test','DRAFT',$2,'{}')",[metricRelease,'a'.repeat(64)]);
  await db.pool.query("INSERT INTO organization_profile.metric_definition(metric_id,metric_release_id,metric_code,value_kind,unit_code) VALUES($1,$2,'SYNTHETIC_COUNT','COUNT','SYNTHETIC_POPULATION_UNIT')",[metric,metricRelease]);
  await db.pool.query("UPDATE organization_profile.metric_catalog_release SET lifecycle='PUBLISHED' WHERE metric_release_id=$1",[metricRelease]);
  await db.pool.query("INSERT INTO organization_profile.population_catalog_entry(entry_id,release_id,kind,stable_code,metric_id,unit_id,operations) VALUES($1,$2,'COUNTING_BASIS','SYNTHETIC_BASIS',$3,$4,$5)",[basis,release,metric,unit,methods.map(op=>op.toUpperCase())]);
  await db.pool.query("INSERT INTO organization_profile.catalog_release(release_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,'GLOBAL','synthetic-population-geography','DRAFT',$2,'{}')",[taxonomyRelease,'c'.repeat(64)]);
  for(const [id,code,domain] of [[geoScheme,'ADMINISTRATIVE_AREA','TERRITORY'],[groupScheme,'SERVED_POPULATION_GROUP','NONE']])await db.pool.query('INSERT INTO organization_profile.scheme(scheme_id,release_id,scheme_code,relation_domain) VALUES($1,$2,$3,$4)',[id,taxonomyRelease,code,domain]);
  for(const [id,scheme,code] of [[territory,geoScheme,'SYNTHETIC_TERRITORY'],[group,groupScheme,'SYNTHETIC_GROUP']])await db.pool.query("INSERT INTO organization_profile.concept(concept_id,scheme_id,release_id,stable_code,provenance) VALUES($1,$2,$3,$4,'{}')",[id,scheme,taxonomyRelease,code]);
  await db.pool.query("UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=now() WHERE release_id=$1",[taxonomyRelease]);
  await db.pool.query('INSERT INTO organization_profile.population_geographic_concept(geographic_id,release_id,concept_id,scheme_id,taxonomy_release_id,level_id) VALUES($1,$2,$3,$4,$5,$6)',[geo,release,territory,geoScheme,taxonomyRelease,level]);
 }
 // Exact tenant-owned geography/taxonomy fixtures, plus foreign ownership stored
 // only by the isolated administrative fixture. Runtime reads must not see it.
 async function localReferences(owner){
  const rr=randomUUID(),tr=randomUUID(),gs=randomUUID(),bs=randomUUID(),tc=randomUUID(),bc=randomUUID(),lv=randomUUID(),gid=randomUUID();
  await a.pool.query("INSERT INTO organization_profile.population_catalog_release(release_id,organization_id,release_version,lifecycle) VALUES($1,$2,$3,'PUBLISHED')",[rr,owner,'synthetic-local-'+rr]);
  await a.pool.query("INSERT INTO organization_profile.population_catalog_entry(entry_id,release_id,organization_id,kind,stable_code,operations) VALUES($1,$2,$3,'GEOGRAPHIC_LEVEL','SYNTHETIC_LEVEL',$4)",[lv,rr,owner,methods.map(op=>op.toUpperCase())]);
  await a.pool.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT',$3,'DRAFT',$4,'{}')",[tr,owner,'synthetic-local-'+tr,'d'.repeat(64)]);
  for(const [id,code,domain] of [[gs,'ADMINISTRATIVE_AREA','TERRITORY'],[bs,'SERVED_POPULATION_GROUP','NONE']])await a.pool.query('INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,$4,$5)',[id,tr,owner,code,domain]);
  for(const [id,scheme,code] of [[tc,gs,'SYNTHETIC_TERRITORY'],[bc,bs,'SYNTHETIC_GROUP']])await a.pool.query("INSERT INTO organization_profile.concept(concept_id,scheme_id,release_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,$5,'{}')",[id,scheme,tr,owner,code]);
  await a.pool.query("UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=now() WHERE release_id=$1",[tr]);
  await a.pool.query('INSERT INTO organization_profile.population_geographic_concept(geographic_id,organization_id,release_id,concept_id,scheme_id,taxonomy_release_id,level_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[gid,owner,rr,tc,gs,tr,lv]);
  return {territory:{geographicId:gid,coverageKind:'UNSPECIFIED'},group:{conceptId:bc,schemeId:bs,releaseId:tr}};
 }
 const local=await localReferences(a.org),foreign=await localReferences(b.org);
 const many=create({territoryRefs:[...create().territoryRefs,local.territory],groupRefs:[...create().groupRefs,local.group]});
 await service.create(many,maker.handle);
 const manyRead=await service.read(cmd('read',many.assertionId),maker.handle);
 assert.equal(manyRead.territoryRefs.length,2);assert.equal(manyRead.groupRefs.length,2);
 assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.population_revision_territory WHERE assertion_id=$1',[many.assertionId])).rows[0].n,2);
 assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.population_revision_group WHERE assertion_id=$1',[many.assertionId])).rows[0].n,2);
 for(const patch of [{territoryRefs:[foreign.territory]},{groupRefs:[foreign.group]},{groupRefs:[{...local.group,releaseId:taxonomyRelease}]},{territoryRefs:[{...local.territory,geographicId:local.group.conceptId}]}])await denied(()=>service.create(create(patch),maker.handle));
 // Direct SQL cannot add material links that were not declared in that revision.
 for(const [table,columns,values] of [
  ['population_revision_territory','geographic_id,coverage_kind',[local.territory.geographicId,'FULL']],
  ['population_revision_group','concept_id,scheme_id,release_id',[foreign.group.conceptId,foreign.group.schemeId,foreign.group.releaseId]]]){
  const client=await a.pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');await client.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
   const params=[a.org,many.assertionId,1,...values];
   await assert.rejects(()=>client.query('INSERT INTO organization_profile.'+table+'(organization_id,assertion_id,revision,'+columns+') VALUES('+params.map((_,i)=>String.fromCharCode(36)+(i+1)).join(',')+')',params));
  }finally{await client.query('ROLLBACK');client.release();}
 }
 for(const countValue of ['0','1','9007199254740993']){const c=create({countValue});await service.create(c,maker.handle);assert.equal((await service.read(cmd('read',c.assertionId),maker.handle)).countValue,countValue);}
 for(const countValue of ['-1','1e2','1.5',1])await denied(()=>service.create(create({countValue}),maker.handle));
 for(const patch of [{startDate:'2025-02-30'},{startDate:'2026-01-01'},{unitId:method},{countingBasisId:method},{territoryRefs:[{geographicId:geo,coverageKind:'ESTIMATED'}]},{territoryRefs:[{geographicId:geo,coverageKind:'PARTIAL',percentage:50}]},{groupRefs:[{conceptId:group,schemeId:geoScheme,releaseId:taxonomyRelease}]},{groupRefs:[{conceptId:group,schemeId:groupScheme,releaseId:randomUUID()}]}])await denied(()=>service.create(create(patch),maker.handle));
 const noCount={countValue:null,unitId:null,metricId:null,countingBasisId:null};
 const territoryOnly=create({...noCount,assertionKind:'TERRITORY',groupRefs:[],territoryRefs:[{geographicId:geo,coverageKind:'PARTIAL'}]});
 const targetOnly=create({...noCount,assertionKind:'TARGET_GROUP',territoryRefs:[]});
 await service.create(territoryOnly,maker.handle);await service.create(targetOnly,maker.handle);
 assert.equal((await service.read(cmd('read',territoryOnly.assertionId),maker.handle)).assertionKind,'TERRITORY');
 assert.equal((await service.read(cmd('read',targetOnly.assertionId),maker.handle)).assertionKind,'TARGET_GROUP');
 await denied(()=>service.create(create({...noCount,assertionKind:'TARGET_GROUP'}),maker.handle));
 // Locations are canonical F13-P1 references, never assertion authority or territorial coverage.
 const ownLocation=randomUUID(),archivedLocation=randomUUID(),foreignLocation=randomUUID();
 for(const [db,id,archived] of [[a,ownLocation,false],[a,archivedLocation,true],[b,foreignLocation,false]]){
  const client=await db.pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[db.org]);
   await client.query("INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id,lifecycle,archived_at,archived_by_actor_id,archive_reason_code) VALUES($1,$2,'UNIT','Synthetic location','{}','HUMAN',$3,'HUMAN',$3,$4,$5,$6,$7)",[id,db.org,maker.id,archived?'ARCHIVED':'ACTIVE',archived?new Date():null,archived?maker.id:null,archived?'SYNTHETIC_REASON':null]);await client.query('COMMIT');
  }finally{await client.query('ROLLBACK');client.release();}
 }
 const located=create({organizationalScopeId:ownLocation});await service.create(located,maker.handle);
 assert.equal((await service.read(cmd('read',located.assertionId),maker.handle)).organizationalScopeId,ownLocation);
 for(const organizationalScopeId of [archivedLocation,foreignLocation,randomUUID(),a.org])await denied(()=>service.create(create({organizationalScopeId}),maker.handle));

 for(const field of ['actor','organizationId','membershipId','correlationId','assurance','resourceId'])await denied(()=>service.create({...create(),[field]:randomUUID()},maker.handle));
 await refreshActors();const c=create();const first=await service.create(c,maker.handle);assert.equal(first.revision,1);assert.deepEqual(await service.create(c,maker.handle),first);await denied(()=>service.create({...c,countValue:'4'},maker.handle));
 const crossOperationRead=await service.read(cmd('read',c.assertionId,undefined,{idempotencyKey:c.idempotencyKey}),maker.handle);assert.equal(crossOperationRead.countValue,'123456789');assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.population_idempotency_record WHERE idempotency_key=$1',[c.idempotencyKey])).rows[0].n,2);
 const pinnedRead=cmd('read',c.assertionId),pinnedResult=await service.read(pinnedRead,maker.handle);
 const edit={...create({assertionId:c.assertionId}),expectedRevision:1};assert.equal((await service.edit(edit,maker.handle)).revision,2);
 assert.deepEqual(await service.read(pinnedRead,maker.handle),pinnedResult);
 assert.equal((await service.read(cmd('read',c.assertionId),maker.handle)).revision,2);
 const pinnedEvents=(await a.pool.query("SELECT event_data FROM audit.event WHERE event_code='POPULATION_ASSERTION_READ' AND idempotency_key=$1",['F13_POPULATION_READ:'+pinnedRead.idempotencyKey])).rows;
 assert.equal(pinnedEvents.length,1);assert.equal(pinnedEvents[0].event_data.payload.newVersion,'1');
 await denied(()=>service.read({...pinnedRead,reasonId:unit},maker.handle));
 await denied(()=>service.read(cmd('read',c.assertionId,undefined,{purposeId:reason}),maker.handle));
 await denied(()=>service.read(cmd('read',c.assertionId,undefined,{reasonId:purpose}),maker.handle));
 // DATE is a civil date, independent of the Node process timezone or DST.
 const originalTz=process.env.TZ;
 try{for(const timezone of ['UTC','Europe/Lisbon']){process.env.TZ=timezone;for(const [startDate,endDate] of [['2025-01-01','2025-01-31'],['2025-07-01','2025-07-31']]){
  const dates=create({startDate,endDate});await service.create(dates,maker.handle);const key=cmd('read',dates.assertionId),before=await service.read(key,maker.handle);assert.equal(before.startDate,startDate);assert.equal(before.endDate,endDate);
  await service.edit({...dates,startDate:endDate,endDate,expectedRevision:1,idempotencyKey:randomUUID()},maker.handle);
  const current=await service.read(cmd('read',dates.assertionId),maker.handle);assert.equal(current.startDate,endDate);assert.equal(current.endDate,endDate);assert.deepEqual(await service.read(key,maker.handle),before);
 }} }finally{if(originalTz===undefined)delete process.env.TZ;else process.env.TZ=originalTz;}
 const raced=await Promise.allSettled([0,1].map(()=>service.edit({...edit,expectedRevision:2,idempotencyKey:randomUUID()},maker.handle)));assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected'&&r.reason.code==='F13_STALE_REVISION').length,1);
 const same=create();assert.deepEqual(...await Promise.all([service.create(same,maker.handle),service.create(same,maker.handle)]));
 await b.bound.service.create(c,other.handle);await denied(()=>b.bound.service.read(cmd('read',same.assertionId),other.handle));
 await refreshActors();await service.submit(cmd('submit',c.assertionId,3),maker.handle);await denied(()=>service.verify(cmd('verify',c.assertionId,4),maker.handle));await service.verify(cmd('verify',c.assertionId,4),checker.handle);await service.dispute(cmd('dispute',c.assertionId,5),maker.handle);await service.revoke(cmd('revoke',c.assertionId,6),revoker.handle);
 const rejected=create();await service.create(rejected,maker.handle);await service.submit(cmd('submit',rejected.assertionId,1),maker.handle);await denied(()=>service.reject(cmd('reject',rejected.assertionId,2),maker.handle));await service.reject(cmd('reject',rejected.assertionId,2),checker.handle);
 const revoked=create();await service.create(revoked,maker.handle);await service.submit(cmd('submit',revoked.assertionId,1),maker.handle);await service.verify(cmd('verify',revoked.assertionId,2),checker.handle);await denied(()=>service.revoke(cmd('revoke',revoked.assertionId,3),maker.handle));await denied(()=>service.revoke(cmd('revoke',revoked.assertionId,3),checker.handle));await service.revoke(cmd('revoke',revoked.assertionId,3),revoker.handle);
 // Exhaustive state/operation matrix, including effective expiry (not a stored state).
 await refreshActors();
 const states={DRAFT:same.assertionId,SUBMITTED:null,VERIFIED:null,REJECTED:rejected.assertionId,DISPUTED:null,REVOKED:revoked.assertionId,EXPIRED:null};
 for(const state of ['SUBMITTED','VERIFIED','DISPUTED','EXPIRED']){const x=create();await service.create(x,maker.handle);await service.submit(cmd('submit',x.assertionId,1),maker.handle);if(state!=='SUBMITTED')await service.verify(cmd('verify',x.assertionId,2,state==='EXPIRED'?{validFrom:new Date(Date.now()-10000).toISOString(),validUntil:new Date(Date.now()-1000).toISOString()}:{}),checker.handle);if(state==='DISPUTED')await service.dispute(cmd('dispute',x.assertionId,3),checker.handle);states[state]=x.assertionId;}
 const origins={edit:['DRAFT'],submit:['DRAFT'],verify:['SUBMITTED'],reject:['SUBMITTED'],dispute:['VERIFIED'],revoke:['VERIFIED','DISPUTED']};
 for(const [state,id] of Object.entries(states)){const rev=(await a.pool.query('SELECT head_revision FROM organization_profile.population_assertion WHERE assertion_id=$1',[id])).rows[0].head_revision;for(const op of Object.keys(origins))if(!origins[op].includes(state))await denied(()=>service[op](op==='edit'?{...create({assertionId:id}),expectedRevision:Number(rev)}:cmd(op,id,Number(rev)),checker.handle));}
 const exp=create();await service.create(exp,maker.handle);await service.submit(cmd('submit',exp.assertionId,1),maker.handle);const until=Date.now()+5000;await service.verify(cmd('verify',exp.assertionId,2,{validUntil:new Date(until).toISOString()}),checker.handle);const read=cmd('read',exp.assertionId);assert.equal((await service.read(read,maker.handle)).state,'VERIFIED');await new Promise(resolve=>setTimeout(resolve,Math.max(1,until-Date.now()+30)));assert.equal((await service.read(read,maker.handle)).state,'EXPIRED');assert.equal((await a.pool.query('SELECT state FROM organization_profile.population_assertion_revision WHERE assertion_id=$1 AND revision=3',[exp.assertionId])).rows[0].state,'VERIFIED');
 // Every operation is authorized separately by real F5, without implicit grants.
 await refreshActors();
 const restricted=await actor(a);for(const op of methods){await grants(a,restricted,methods.filter(m=>m!==op).map(m=>({permission:'profile_population.'+m,scope:scope(a)})));const id=op==='edit'||op==='submit'?states.DRAFT:op==='verify'||op==='reject'?states.SUBMITTED:states.VERIFIED;const rev=Number((await a.pool.query('SELECT head_revision FROM organization_profile.population_assertion WHERE assertion_id=$1',[id])).rows[0].head_revision);await denied(()=>service[op](op==='create'?create():op==='edit'?{...create({assertionId:id}),expectedRevision:rev}:cmd(op,id,rev),restricted.handle));}
 await grants(a,restricted,[{permission:'profile_population.read',scope:scope(a),resourceId:randomUUID(),resourceType:'POPULATION_ASSERTION'}]);await denied(()=>service.read(cmd('read',same.assertionId),restricted.handle));
 // Denied grants cannot disclose existence, CAS revision, lifecycle or document availability by error class.
 await grants(a,restricted,[]);
 const denyUniform=work=>denied(()=>work().catch(error=>{assert.equal(error.code,'F13_AUTHORIZATION_REQUIRED');throw error;}));
 for(const id of [same.assertionId,states.VERIFIED,randomUUID()]){
  await denyUniform(()=>service.read(cmd('read',id),restricted.handle));
  for(const expectedRevision of [1,999])await denyUniform(()=>service.edit({...create({assertionId:id}),expectedRevision},restricted.handle));
 }
 await denyUniform(()=>service.create(create({organizationalScopeId:archivedLocation}),restricted.handle));
 await denyUniform(()=>service.create(create({documentVersionIds:[randomUUID()]}),restricted.handle));
 const old=maker.handle;await grants(a,maker,all(a));await denied(()=>service.create(c,old));
 // Exact document binding + cumulative DOCUMENT_READ, including revoked replay.
 await refreshActors();
 const docFact=create(),doc=randomUUID(),version=randomUUID();await a.pool.query("INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,'POPULATION_ASSERTION',$3,$4,$5)",[doc,a.org,docFact.assertionId,maker.id,randomUUID()]);await a.pool.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,created_by_actor_id,observed_size,sha256) VALUES($1,$2,$3,1,$4,'DOCUMENTS',32,'PDF',$5,'application/pdf','synthetic-population.pdf','AVAILABLE','CLEAN',$6,$7,$8,32,$5)`,[version,doc,a.org,randomUUID(),'b'.repeat(64),randomUUID(),randomUUID(),maker.id]);docFact.documentVersionIds=[version];
 await grants(a,restricted,all(a).filter(g=>g.permission!=='document.read'));await denied(()=>service.create(docFact,restricted.handle));await service.create(docFact,maker.handle);const docRead=cmd('read',docFact.assertionId);const originalDocRead=await service.read(docRead,maker.handle);assert.deepEqual(originalDocRead.documentVersionIds,[version]);
 await service.edit({...docFact,documentVersionIds:[],expectedRevision:1,idempotencyKey:randomUUID()},maker.handle);
 assert.deepEqual(await service.read(docRead,maker.handle),originalDocRead);
 await grants(a,maker,all(a).filter(g=>g.permission!=='document.read'));await denied(()=>service.read(docRead,maker.handle));
 assert.deepEqual((await service.read(cmd('read',docFact.assertionId),maker.handle)).documentVersionIds,[]);
 await grants(a,maker,all(a));await service.edit({...docFact,expectedRevision:2,idempotencyKey:randomUUID()},maker.handle);
 await service.submit(cmd('submit',docFact.assertionId,3),maker.handle);
 await denied(()=>service.verify(cmd('verify',docFact.assertionId,4),restricted.handle));await service.verify(cmd('verify',docFact.assertionId,4),checker.handle);
 await grants(a,maker,all(a).filter(g=>g.permission!=='document.read'));await denied(()=>service.read(docRead,maker.handle));await denied(()=>service.create(docFact,maker.handle));await grants(a,maker,all(a));
 await assert.rejects(()=>grants(a,restricted,[...all(a).filter(g=>g.permission!=='document.read'),{permission:'document.read',scope:scope(b),resourceId:doc,resourceType:'DOCUMENT'}]));
 await grants(a,restricted,[...all(a).filter(g=>g.permission!=='document.read'),{permission:'document.read',scope:scope(a),resourceId:randomUUID(),resourceType:'DOCUMENT'}]);await denied(()=>service.read(cmd('read',docFact.assertionId),restricted.handle));await denied(()=>b.bound.service.create({...docFact,assertionId:randomUUID(),idempotencyKey:randomUUID()},other.handle));
 await a.pool.query("UPDATE document_storage.document_version SET state='QUARANTINED',scan_state='ERROR' WHERE version_id=$1",[version]);await denied(()=>service.read(docRead,maker.handle));await a.pool.query("UPDATE document_storage.document_version SET state='AVAILABLE',scan_state='CLEAN' WHERE version_id=$1",[version]);
 // Recent MFA failure, before mutation, for verify/reject/revoke.
 await refreshActors();
 async function evidence(value,u=checker){const sess=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[u.sid])).rows[0].sess;sess.auth.evidence=value;await central.coordinator.write([central.coordinator.sessionKey(u.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[sess,sess.auth.absoluteExpiresAt/1000,u.sid]));u.handle=await a.bound.captureAuthenticatedRequest(u.request);}
 const validEvidence=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[checker.sid])).rows[0].sess.auth.evidence;
 for(const value of [{...validEvidence,amr:[]},{...validEvidence,authTime:Math.floor(Date.now()/1000)-1000}]){await evidence(value);for(const [op,state] of [['verify','SUBMITTED'],['reject','SUBMITTED'],['revoke','VERIFIED']]){const id=states[state],rev=Number((await a.pool.query('SELECT head_revision FROM organization_profile.population_assertion WHERE assertion_id=$1',[id])).rows[0].head_revision);await denied(()=>service[op](cmd(op,id,rev),checker.handle));}}await evidence(validEvidence);
 const revokerEvidence=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[revoker.sid])).rows[0].sess.auth.evidence;
 for(const value of [{...revokerEvidence,amr:[]},{...revokerEvidence,authTime:Math.floor(Date.now()/1000)-1000}]){await evidence(value,revoker);await denied(()=>service.revoke(cmd('revoke',states.VERIFIED,3),revoker.handle));}await evidence(revokerEvidence,revoker);
 // R1-001: VERIFY retry and uncertain COMMIT reauthorize original material,
 // not the successful checker as a newly introduced author. Real Central/F5/F11.
 await refreshActors();
 async function submitted(){const fact=create();await service.create(fact,maker.handle);await service.submit(cmd('submit',fact.assertionId,1),maker.handle);return fact;}
 async function exactlyOneVerification(command){
  const result=(await a.pool.query("SELECT (SELECT count(*) FROM organization_profile.population_assertion_revision WHERE assertion_id=$1)::int revisions,(SELECT count(*) FROM organization_profile.population_idempotency_record WHERE organization_id=$2 AND operation='POPULATION_VERIFY' AND idempotency_key=$3)::int keys,(SELECT count(*) FROM audit.event WHERE event_code='POPULATION_ASSERTION_VERIFIED' AND idempotency_key=$4)::int events",[command.assertionId,a.org,command.idempotencyKey,'F13_POPULATION_VERIFY:'+command.idempotencyKey])).rows[0];
  assert.deepEqual(result,{revisions:3,keys:1,events:1});
 }
 const normalVerify=cmd('verify',(await submitted()).assertionId,2);
 const normalVerified=await service.verify(normalVerify,checker.handle);
 assert.deepEqual(await service.verify(normalVerify,checker.handle),normalVerified);
 await exactlyOneVerification(normalVerify);
 await denied(()=>service.verify(normalVerify,maker.handle));
 await denied(()=>service.verify({...normalVerify,expectedRevision:999},checker.handle).catch(error=>{assert.equal(error.code,'F13_IDEMPOTENCY_CONFLICT');throw error;}));
 const staleChecker=checker.handle;
 await grants(a,checker,all(a).filter(g=>g.permission!=='profile_population.verify'));
 await denied(()=>service.verify(normalVerify,staleChecker));await denied(()=>service.verify(normalVerify,checker.handle));
 await grants(a,checker,all(a));assert.deepEqual(await service.verify(normalVerify,checker.handle),normalVerified);
 for(const value of [{...validEvidence,amr:[]},{...validEvidence,authTime:Math.floor(Date.now()/1000)-1000}]){await evidence(value);await denied(()=>service.verify(normalVerify,checker.handle));}
 await refreshActors();
 const concurrentVerify=cmd('verify',(await submitted()).assertionId,2);
 const concurrentVerified=await Promise.all([service.verify(concurrentVerify,checker.handle),service.verify(concurrentVerify,checker.handle)]);
 assert.deepEqual(concurrentVerified[0],concurrentVerified[1]);await exactlyOneVerification(concurrentVerify);
 const unknownVerify=cmd('verify',(await submitted()).assertionId,2);controls.commit(1);
 const recoveredVerify=await service.verify(unknownVerify,checker.handle);
 assert.deepEqual(await service.verify(unknownVerify,checker.handle),recoveredVerify);await exactlyOneVerification(unknownVerify);
 assert.equal((await central.pool.query("SELECT reconciliation_result FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='RECOVERED'",[unknownVerify.idempotencyKey])).rows[0].reconciliation_result,'COMMITTED');
 const twiceVerify=cmd('verify',(await submitted()).assertionId,2);controls.commit(2);
 await assert.rejects(()=>service.verify(twiceVerify,checker.handle),{code:'F13_PERSISTENCE_UNAVAILABLE'});
 assert.equal((await service.verify(twiceVerify,checker.handle)).revision,3);await exactlyOneVerification(twiceVerify);
 // Verify on the real document-bound assertion above was revision 5. Read the
 // original intention from the immutable revision for a faithful command retry.
 const docVerified=(await a.pool.query('SELECT method_id,valid_from,valid_until FROM organization_profile.population_assertion_revision WHERE assertion_id=$1 AND revision=5',[docFact.assertionId])).rows[0];
 const docKey=(await a.pool.query("SELECT idempotency_key FROM organization_profile.population_idempotency_record WHERE assertion_id=$1 AND operation='POPULATION_VERIFY'",[docFact.assertionId])).rows[0].idempotency_key;
 const docVerify={assertionId:docFact.assertionId,expectedRevision:4,methodId:docVerified.method_id,validFrom:docVerified.valid_from.toISOString(),validUntil:docVerified.valid_until?.toISOString()||null,idempotencyKey:docKey};
 assert.equal((await service.verify(docVerify,checker.handle)).revision,5);
 await grants(a,checker,all(a).filter(g=>g.permission!=='document.read'));await denied(()=>service.verify(docVerify,checker.handle));
 await grants(a,checker,all(a));assert.equal((await service.verify(docVerify,checker.handle)).revision,5);
 await service.revoke(cmd('revoke',docFact.assertionId,5),revoker.handle);
 assert.equal((await service.verify(docVerify,checker.handle)).revision,5);
 await grants(a,checker,all(a).filter(g=>g.permission!=='document.read'));await denied(()=>service.verify(docVerify,checker.handle));await grants(a,checker,all(a));
 process.stdout.write(JSON.stringify({verifyReplayMakerCheckerHistorical:true,verifyConcurrentReplaySingleEffect:true,verifyCommitUnknownRecovered:true,verifyDoubleUnknownNoFalseSuccess:true,verifyReplayGrantVersionMfaRevocationDenied:true,verifyReplayHistoricalDocumentGrant:true})+'\n');
 // Every new F7 failure rolls back heads, versions, idempotency and audit atomically.
 await refreshActors();
 controls.audit(true);try{for(const op of methods){const id=['edit','submit'].includes(op)?states.DRAFT:['verify','reject'].includes(op)?states.SUBMITTED:states.VERIFIED;const rev=Number((await a.pool.query('SELECT head_revision FROM organization_profile.population_assertion WHERE assertion_id=$1',[id])).rows[0].head_revision);await denied(()=>service[op](op==='create'?create():op==='edit'?{...create({assertionId:id}),expectedRevision:rev}:cmd(op,id,rev),op==='revoke'?revoker.handle:checker.handle));}}finally{controls.audit(false);}
 controls.commit(1);const unknown=create();const recovered=await service.create(unknown,maker.handle);assert.deepEqual(await service.create(unknown,maker.handle),recovered);assert.equal((await central.pool.query("SELECT reconciliation_result FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='RECOVERED'",[unknown.idempotencyKey])).rows[0].reconciliation_result,'COMMITTED');
 const unknownRead=cmd('read',c.assertionId);controls.commit(1);const recoveredRead=await service.read(unknownRead,maker.handle);assert.equal(recoveredRead.revision,7);assert.deepEqual(await service.read(unknownRead,maker.handle),recoveredRead);
 const twiceRead=cmd('read',c.assertionId);controls.commit(2);await assert.rejects(()=>service.read(twiceRead,maker.handle),{code:'F13_PERSISTENCE_UNAVAILABLE'});assert.equal((await service.read(twiceRead,maker.handle)).revision,7);
 const raw=await a.pool.connect();try{await raw.query('BEGIN');await raw.query('SET LOCAL ROLE c4g_organization_profile_runtime');await raw.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);await assert.rejects(()=>raw.query('UPDATE organization_profile.population_assertion_revision SET count_value=$1',['1']),/permission denied|append|immutable/i);}finally{await raw.query('ROLLBACK');raw.release();}
 const orphan=await a.pool.connect();try{await orphan.query('BEGIN');await orphan.query('SET LOCAL ROLE c4g_organization_profile_runtime');await orphan.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);await orphan.query(`INSERT INTO organization_profile.population_assertion_revision(organization_id,assertion_id,profile_scope_id,revision,operation,state,knowledge_status,assertion_kind,count_value,unit_id,metric_id,counting_basis_id,territory_refs,group_refs,organizational_scope_id,start_date,end_date,provenance_ref,document_version_ids,actor_subject_id,membership_id,correlation_id,authorization_evidence) SELECT organization_id,assertion_id,profile_scope_id,revision+1,'EDIT',state,knowledge_status,assertion_kind,count_value,unit_id,metric_id,counting_basis_id,territory_refs,group_refs,organizational_scope_id,start_date,end_date,provenance_ref,document_version_ids,actor_subject_id,membership_id,correlation_id,authorization_evidence FROM organization_profile.population_assertion_revision WHERE assertion_id=$1 AND revision=1`,[same.assertionId]);await assert.rejects(()=>orphan.query('COMMIT'),/F13_POPULATION_INVALID_HEAD/);}finally{await orphan.query('ROLLBACK');orphan.release();}
 for(const sql of ['DELETE FROM organization_profile.population_assertion_revision','TRUNCATE organization_profile.population_assertion_revision','SELECT object_id FROM document_storage.document_version','UPDATE organizational_scope.scope SET lifecycle=\'ARCHIVED\'']){const client=await a.pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');await client.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);await assert.rejects(()=>client.query(sql));}finally{await client.query('ROLLBACK');client.release();}}
 controls.commit(2);const twice=create();await assert.rejects(()=>service.create(twice,maker.handle),{code:'F13_PERSISTENCE_UNAVAILABLE'});assert.equal((await service.create(twice,maker.handle)).revision,1);assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.population_assertion_revision WHERE assertion_id=$1',[twice.assertionId])).rows[0].n,1);
 // The two uncertain commits may have persisted the authorized operation, but must never return a false success.
 const down=createTenantMigrationRunner({pool:a.pool,observationPublisher:{async publish(){}},scheduler:{setTimeout,clearTimeout},timeoutMs:15000});await assert.rejects(()=>down.downgrade({tenantId:a.org,databaseGenerationId:a.gen,expectedRevision:4,targetVersion:manifest[11].version,correlationId:'population-down-protected',idempotencyKey:'population-down-protected'}));
 assert.equal((await preflightTenant(a.pool,{tenantId:a.org,databaseGenerationId:a.gen},manifest,{timeoutMs:10000})).schemaFingerprint,manifest[12].schemaFingerprint);
 const events=(await a.pool.query("SELECT event_code,event_data FROM audit.event WHERE catalog_version='f13-population-events-v1'")).rows;assert.deepEqual([...new Set(events.map(e=>e.event_code))].sort(),['POPULATION_ASSERTION_CREATED','POPULATION_ASSERTION_EDITED','POPULATION_ASSERTION_READ','POPULATION_ASSERTION_SUBMITTED','POPULATION_ASSERTION_VERIFIED','POPULATION_ASSERTION_REJECTED','POPULATION_ASSERTION_DISPUTED','POPULATION_ASSERTION_REVOKED'].sort());for(const {event_data:event} of events){const payload=JSON.stringify(event.payload);assert.ok(!/countValue|count_value|territory|geograph|groupRefs|unit|document|filename|123456789|population\.pdf/i.test(payload));assert.ok(!payload.includes(doc)&&!payload.includes(version)&&!payload.includes(ownLocation)&&!payload.includes(geo)&&!payload.includes(group));const decision=decisions.find(d=>d.result==='ALLOW'&&d.correlationId===event.correlationId&&d.operationCode===event.operationCode);assert.ok(decision);assert.equal(event.payload.assuranceLevel,decision.assuranceLevel);assert.equal(event.payload.policyVersion,decision.policyVersion);}
 for(const {event_code,event_data:event} of events){if(['POPULATION_ASSERTION_READ','POPULATION_ASSERTION_REJECTED','POPULATION_ASSERTION_DISPUTED','POPULATION_ASSERTION_REVOKED'].includes(event_code)){assert.equal(event.payload.reasonRef,reason);assert.equal(event.payload.reasonReleaseRef,release);assert.equal(event.payload.reasonCatalogVersion,'synthetic-test-only');}if(event_code==='POPULATION_ASSERTION_READ'){assert.equal(event.payload.purposeRef,purpose);assert.equal(event.payload.purposeReleaseRef,release);assert.equal(event.payload.purposeCatalogVersion,'synthetic-test-only');}}
 for(const key of [pinnedRead,unknownRead,twiceRead])assert.equal((await a.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='POPULATION_ASSERTION_READ' AND idempotency_key=$1",['F13_POPULATION_READ:'+key.idempotencyKey])).rows[0].n,1);
 assert.equal(events.length,(await a.pool.query('SELECT count(*)::int n FROM organization_profile.population_idempotency_record')).rows[0].n);
 for(const m of metrics)assert.deepEqual(Object.keys(m.labels).sort(),['operation','resultClass']);assert.ok(metrics.length);
 process.stdout.write(JSON.stringify({civilDatesUtcAndLisbon:true,readReplayPinnedToAuditedRevision:true,readReplayHistoricalDocumentGrant:true,reasonPurposePersistedF7:true,readCommitUnknownNoDuplicate:true,populationTransitionsMatrix:true,expiredDerivedReplay:true,integerCountsExact:true,territoryTargetServedDistinct:true,canonicalLocations:true,catalogMetricUnitBasisCompatibility:true,revokerIndependentOfVerifier:true,invalidPeriodsCatalogs:true,casAndConcurrentReplay:true,realF5EightAsymmetricGrants:true,deniedMetadataUniform:true,tenantIsolation:true,makerChecker:true,missingStaleMfa:true,documentReadRevokedReplayDenied:true,documentNoImplicitAccess:true,eightF7Rollback:true,populationSensitiveDataAbsentF7F10:true,commitUnknownRecovered:true,appendOnly:true,downRefusesData:true})+'\n');
}
module.exports={runPopulationProbes};


