'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
async function run({central,tenants,http,actor,manager,other,reader,failures}){
 const [a,b]=tenants,root='/api/organization-directory';
 const expected=async(p,status=200)=>{const r=await p;if(r.status!==status)console.error('ACCESS_FAILURE',r,failures.slice(-1));assert.equal(r.status,status);return r.data};
 const self=await actor(a.org,['personal_profile.read','personal_profile.edit']);
 const statusPath=root+'/memberships/'+self.membershipId+'/status';
 const suspend={status:'SUSPENDED',expectedRevision:1,idempotencyKey:randomUUID()};
 await expected(http(reader,statusPath,'PUT',suspend),403);
 await expected(http(other,statusPath,'PUT',suspend),404);
 const membershipB=await actor(b.org,['personal_profile.read'],self.id);
 const person=await expected(http(manager,root+'/people','POST',{name:'Pessoa com acesso de ensaio',email:'',functionLabel:'',active:true,unitIds:[],primaryUnitId:null,idempotencyKey:randomUUID()}),201);
 await expected(http(manager,root+'/people/'+person.personId+'/account','PUT',{membershipId:self.membershipId,expectedRevision:0,idempotencyKey:randomUUID()}));
 assert.equal((await expected(http(self,root+'/me'))).person.personId,person.personId);
 assert.equal((await expected(http(membershipB,root+'/me'))).person,null);
 await expected(http(manager,statusPath,'PUT',suspend));await expected(http(manager,statusPath,'PUT',suspend));
 const states=(await central.pool.query('SELECT organization_id,status FROM public.organization_membership WHERE global_user_id=$1',[self.id])).rows;
 assert.equal(states.find(s=>s.organization_id===a.org).status,'SUSPENDED');assert.equal(states.find(s=>s.organization_id===b.org).status,'ACTIVE');
 assert.equal((await central.pool.query('SELECT status FROM public.global_user WHERE id=$1',[self.id])).rows[0].status,'ACTIVE');
 const revoked=await http(self,root+'/me');assert([401,403,409].includes(revoked.status),'Suspended membership must lose HTTP access');
 assert.equal((await expected(http(membershipB,root+'/me'))).person,null);
 assert.equal((await expected(http(manager,root+'/people/'+person.personId))).person.active,true);
 await expected(http(manager,statusPath,'PUT',{status:'ACTIVE',expectedRevision:2,idempotencyKey:randomUUID()}));
 assert.equal((await central.pool.query('SELECT status FROM public.organization_membership WHERE id=$1',[self.membershipId])).rows[0].status,'ACTIVE');

 console.log('PILOT_MEMBERSHIP_ACCESS_AB_PASS: denied read-only/cross-tenant, suspension/reactivation/idempotency, revoked HTTP access, same identity retains access in second organization, person preserved');
}
module.exports={run};
