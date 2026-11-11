'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {areas}=require('../../../backend/src/organizationDirectory/thematicAreas');
async function run({central,tenants,http,actor,manager,other,reader,failures,loseNextCommit,failAudit,base}){
 const [a,b]=tenants,root='/api/organization-directory';
 const expected=async(p,status=200)=>{const r=await p;if(r.status!==status)console.error('PERSONAL_HTTP_FAILURE',r.status,r.data,failures.slice(-1));assert.equal(r.status,status);return r.data};
 if(process.env.PILOT_BROWSER_ONLY==='1'){await require('./browser').run({central,tenants,http,actor,manager,other,reader,base});return;}
 if(process.env.PILOT_ACCESS_ONLY==='1'){await require('./access').run({central,tenants,http,actor,manager,other,reader,failures});if(process.env.PILOT_PEOPLE_BROWSER==='1')await require('./browser').run({central,tenants,http,actor,manager,other,reader,base});return;}
 const self=await actor(a.org,['personal_profile.read','personal_profile.edit']);
 assert.equal((await expected(http(self,root+'/me'))).person,null);
 await expected(http(self,root+'/people'),403);
 const p=await expected(http(manager,root+'/people','POST',{name:'Pessoa de ensaio perfil',email:'pessoa@example.invalid',functionLabel:'Projetos',active:true,unitIds:[],primaryUnitId:null,idempotencyKey:randomUUID()}),201);
 const path=root+'/people/'+p.personId;
 const profile={biography:'Experiência de ensaio',keywords:'educação',areaIds:[areas[11].id],expectedRevision:0,idempotencyKey:randomUUID()};
 await expected(http(reader,path+'/profile','PUT',profile),403);
 await expected(http(other,path),404);
 await expected(http(manager,path+'/profile','PUT',profile));
 await expected(http(manager,path+'/profile','PUT',profile));
 await expected(http(manager,path+'/profile','PUT',{...profile,idempotencyKey:randomUUID()}),409);
 const members=await expected(http(manager,root+'/memberships'));assert(members.items.some(m=>m.membershipId===self.membershipId));assert(!members.items.some(m=>m.membershipId===other.membershipId));
 await expected(http(manager,path+'/account','PUT',{membershipId:other.membershipId,expectedRevision:1,idempotencyKey:randomUUID()}),409);
 const link={membershipId:self.membershipId,expectedRevision:1,idempotencyKey:randomUUID()};
 await expected(http(manager,path+'/account','PUT',link));await expected(http(manager,path+'/account','PUT',link));
 const own=await expected(http(self,root+'/me'));assert.equal(own.person.personId,p.personId);assert.equal(own.profile.revision,2);assert.deepEqual(own.profile.areaIds,profile.areaIds);
 await expected(http(self,path+'/account','PUT',{...link,expectedRevision:2,idempotencyKey:randomUUID()}),403);
 await expected(http(self,root+'/me','PUT',{...profile,membershipId:other.membershipId,expectedRevision:2,idempotencyKey:randomUUID()}),400);
 const update={...profile,biography:'Atualizada pelo titular',expectedRevision:2,idempotencyKey:randomUUID()};
 failAudit(true);await expected(http(self,root+'/me','PUT',update),503);failAudit(false);
 assert.equal((await expected(http(self,root+'/me'))).profile.revision,2);
 loseNextCommit();await expected(http(self,root+'/me','PUT',update));
 assert.equal((await expected(http(self,root+'/me'))).profile.biography,update.biography);
 const concurrent=await Promise.all([http(self,root+'/me','PUT',{...update,expectedRevision:3,idempotencyKey:randomUUID()}),http(manager,path+'/profile','PUT',{...update,expectedRevision:3,idempotencyKey:randomUUID()})]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const c=await a.pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await c.query("SELECT set_config('app.organization_id',$1,true)",[b.org]);assert.equal((await c.query('SELECT * FROM organizational_scope.person_profile')).rowCount,0);await c.query('ROLLBACK')}finally{c.release()}
 console.log('PILOT_PERSONAL_PROFILE_POSTGRES_AB_PASS: explicit association, own profile, area persistence, denied cross-tenant/read-only, CAS, idempotency, audit rollback, uncertain commit, RLS');
 await require('./access').run({central,tenants,http,actor,manager,other,reader,failures});
 if(process.env.PILOT_PEOPLE_BROWSER==='1')await require('./browser').run({central,tenants,http,actor,manager,other,reader,base});
}
module.exports={run};
