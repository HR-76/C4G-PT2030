'use strict';
const {hash,fail}=require('./contracts');
// Transient OIDC transactions contain no passwords. Lost transactions restart
// authentication with the still-unconsumed invitation; central proofs persist.
async function createOidcActivationAdapter({issuer,origin,manualClientId,existingClientId,service,passwordReady,callbackPath='/activation/callback'}){
 if(!['/activation/callback','/api/activation/callback','/api/admission-activation/callback'].includes(callbackPath))fail('ACTIVATION_INVALID');
 const oidc=await import('openid-client'),manual=await oidc.discovery(new URL(issuer),manualClientId),existing=await oidc.discovery(new URL(issuer),existingClientId);
 for(const config of [manual,existing])oidc.enableNonRepudiationChecks(config);
 const transactions=new Map();
 const sweep=()=>{for(const [state,tx] of transactions)if(tx.until<Date.now())transactions.delete(state);};
 return {
  async begin(exchange,browserBinding){
   sweep();const expected=await service.checkActivation(exchange,browserBinding),hasPassword=await passwordReady(expected.subject),useManual=expected.mode==='CREATED'&&!hasPassword;
   const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce(),config=useManual?manual:existing;
   transactions.set(state,{exchange,browserBinding,verifier,nonce,config,expected,until:Date.now()+600000});
   return oidc.buildAuthorizationUrl(config,{redirect_uri:origin+callbackPath,scope:'openid profile email',response_type:'code',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',...(useManual?{c4g_ticket:exchange}:{prompt:'login',max_age:'0'})}).href;
  },
  async bridge(ticket,subject){sweep();const tx=[...transactions.values()].find(t=>t.exchange===ticket);if(!tx)fail('ACTIVATION_INVALID');return service.checkActivation(ticket,tx.browserBinding,subject);},
  callbackContext(url,browserBinding){sweep();const tx=transactions.get(new URL(url).searchParams.get('state'));if(!tx||tx.browserBinding!==browserBinding)fail('ACTIVATION_INVALID');return {exchange:tx.exchange,browserBinding};},
  async verify({callback,exchangeDigest,bindingDigest,expectedIssuer,expectedSubject,requirePasswordSetup}){
   sweep();const url=new URL(callback),tx=transactions.get(url.searchParams.get('state'));
   if(url.origin!==origin||url.pathname!==callbackPath||!tx||hash(tx.exchange)!==exchangeDigest||hash(tx.browserBinding)!==bindingDigest||tx.expected.subject!==expectedSubject||expectedIssuer!==issuer)fail('ACTIVATION_INVALID');
   await service.checkActivation(tx.exchange,tx.browserBinding,expectedSubject);
   if(tx.proof)return tx.proof;
   if(tx.verifying)fail('ACTIVATION_INVALID');tx.verifying=true;
   try{
    const tokens=await oidc.authorizationCodeGrant(tx.config,url,{pkceCodeVerifier:tx.verifier,expectedState:url.searchParams.get('state'),expectedNonce:tx.nonce,idTokenExpected:true});
    const claims=tokens.claims();if(claims?.iss!==issuer||claims.sub!==expectedSubject)fail('ACTIVATION_INVALID');
    const ready=await passwordReady(expectedSubject);if(requirePasswordSetup&&!ready)fail('ACTIVATION_INVALID');
    tx.proof=Object.freeze({issuer,subject:claims.sub,exchangeDigest,bindingDigest,passwordSetupComplete:ready});return tx.proof;
   }finally{tx.verifying=false;}
  }
 };
}
module.exports={createOidcActivationAdapter};
