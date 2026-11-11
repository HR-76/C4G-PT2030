'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes,randomUUID}=require('node:crypto');
function create({central,kc}){
 let worker;
 return {
  automatic:true,tenant:{ensure(){throw Error('WORKER_ONLY')}},projection:{ensure(){throw Error('WORKER_ONLY')}},publishCredentials(){throw Error('WORKER_ONLY')},
  resolve:request=>worker.call('resolve',request),
  async startAutomatic(){
   const root=path.join(process.env.ONBOARDING_JOURNAL_DIR,'habitual-worker');fs.mkdirSync(root,{recursive:true});const file=path.join(root,'worker.json');
   if(!fs.existsSync(file)){
    const url=new URL(process.env.F13_S2_ADMIN_URL),authority=new URL(central.authorityConnectionString),installationId=randomUUID();
    const client=(await kc.kc('clients?clientId=c4g-member-worker'))[0];
    fs.writeFileSync(file,JSON.stringify({installationId,issuer:kc.issuer,certificate:process.env.NODE_EXTRA_CA_CERTS,clientId:client.clientId,clientSecret:(await kc.kc('clients/'+client.id+'/client-secret')).value,ownershipKey:randomBytes(32).toString('hex'),journalKey:randomBytes(32).toString('hex'),isolatedProof:{config:{host:url.hostname,port:5598,user:url.username,password:decodeURIComponent(url.password),centralDatabase:'c4g_f13_authority_synthetic_central',tenantDatabase:'unused_tenant'},state:{installationId,admissionAccess:true,authorityPassword:decodeURIComponent(authority.password),permitSecret:central.permitSecret,identity:{issuer:kc.issuer,policyVersion:'c4g-user-mfa-v1'}}}}),{mode:0o600});
   }
   worker=require('../../../backend/src/platformOnboarding/memberWorkerClient').createMemberWorkerClient(file,path.resolve(__dirname,'../../../backend/scripts/localPlatform/admissionWorker.js'));await worker.call('health',{});
  },
  async restart(){await worker.close();await this.startAutomatic()},
  async close(){await worker?.close()}
 };
}
module.exports={create};
