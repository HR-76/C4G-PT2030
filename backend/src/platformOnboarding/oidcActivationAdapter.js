'use strict';
const {hash,fail}=require('./contracts');
// Transient OIDC transactions contain no passwords. Lost transactions restart
// authentication with the still-unconsumed invitation; central proofs persist.
//
// The identity provider keeps one session per browser and refuses to authenticate another account over it, on a page
// of its own with no way back. So activation first asks it silently (prompt=none) whether the browser has a session:
//   probe    -> no session, or the invited account's own: the activation request follows at once;
//            -> another account: the page asks before ending that session (conflict), never on its own.
//   conflict -> the visitor agreed: the session ends with the identity the probe returned, then activation follows.
// Anything unexpected in the probe falls back to the activation request, which is what happened before the probe existed.
// Contract: context/features/activation-other-account-session.md.
async function createOidcActivationAdapter({issuer,origin,manualClientId,existingClientId,service,passwordReady,callbackPath='/activation/callback',library=null}){
 if(!['/activation/callback','/api/activation/callback','/api/admission-activation/callback'].includes(callbackPath))fail('ACTIVATION_INVALID');
 const oidc=library||await import('openid-client'),manual=await oidc.discovery(new URL(issuer),manualClientId),existing=await oidc.discovery(new URL(issuer),existingClientId);
 for(const config of [manual,existing])oidc.enableNonRepudiationChecks(config);
 const transactions=new Map(),redirect=origin+callbackPath;
 const sweep=()=>{for(const [state,tx] of transactions)if(tx.until<Date.now())transactions.delete(state);};
 // The activation request itself: the invitation-bound flow for an account without a password, a fresh sign-in otherwise.
 async function authorize(exchange,browserBinding){
  const expected=await service.checkActivation(exchange,browserBinding),hasPassword=await passwordReady(expected.subject),useManual=expected.mode==='CREATED'&&!hasPassword;
  const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce(),config=useManual?manual:existing;
  transactions.set(state,{kind:'auth',exchange,browserBinding,verifier,nonce,config,expected,until:Date.now()+600000});
  return oidc.buildAuthorizationUrl(config,{redirect_uri:redirect,scope:'openid profile email',response_type:'code',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',...(useManual?{c4g_ticket:exchange}:{prompt:'login',max_age:'0'})}).href;
 }
 return {
  async begin(exchange,browserBinding){
   sweep();await service.checkActivation(exchange,browserBinding);
   const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();
   transactions.set(state,{kind:'probe',exchange,browserBinding,verifier,nonce,until:Date.now()+600000});
   return oidc.buildAuthorizationUrl(existing,{redirect_uri:redirect,scope:'openid',response_type:'code',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',prompt:'none'}).href;
  },
  // Called with every return to the callback address. Null means "this is the activation response itself".
  async resume(callback,browserBinding){
   sweep();const url=new URL(callback),state=url.searchParams.get('state'),tx=transactions.get(state);
   if(!tx||tx.browserBinding!==browserBinding)fail('ACTIVATION_INVALID');
   if(tx.kind==='auth')return null;
   const proceed=async()=>{transactions.delete(state);return {next:'redirect',url:await authorize(tx.exchange,browserBinding)};};
   if(tx.kind==='conflict'){
    // Only the return from the sign-out this page asked for, and only once.
    if(!tx.signingOut||url.searchParams.has('code')||url.searchParams.has('error'))fail('ACTIVATION_INVALID');
    return proceed();
   }
   if(tx.used)fail('ACTIVATION_INVALID');tx.used=true;
   if(!url.searchParams.has('code'))return proceed();
   let subject=null,idToken=null;
   try{
    const tokens=await oidc.authorizationCodeGrant(existing,url,{pkceCodeVerifier:tx.verifier,expectedState:state,expectedNonce:tx.nonce,idTokenExpected:true});
    const claims=tokens.claims();if(claims?.iss===issuer&&typeof claims.sub==='string'&&typeof tokens.id_token==='string'){subject=claims.sub;idToken=tokens.id_token;}
   }catch{/* The probe is advisory: without an answer the activation request decides. */}
   if(!subject)return proceed();
   const expected=await service.checkActivation(tx.exchange,browserBinding);
   if(subject===expected.subject)return proceed();
   // Kept only to end that session if the visitor agrees; it activates nothing.
   Object.assign(tx,{kind:'conflict',idToken,verifier:null,until:Date.now()+600000});
   return {next:'confirm',state};
  },
  async signOutUrl(state,browserBinding){
   sweep();const tx=transactions.get(state);
   if(!tx||tx.kind!=='conflict'||tx.browserBinding!==browserBinding||tx.signingOut)fail('ACTIVATION_INVALID');
   await service.checkActivation(tx.exchange,browserBinding);
   tx.signingOut=true;const idToken=tx.idToken;tx.idToken=null;
   return oidc.buildEndSessionUrl(existing,{id_token_hint:idToken,post_logout_redirect_uri:redirect,state}).href;
  },
  async bridge(ticket,subject){sweep();const tx=[...transactions.values()].find(t=>t.kind==='auth'&&t.exchange===ticket);if(!tx)fail('ACTIVATION_INVALID');return service.checkActivation(ticket,tx.browserBinding,subject);},
  callbackContext(url,browserBinding){sweep();const tx=transactions.get(new URL(url).searchParams.get('state'));if(!tx||tx.kind!=='auth'||tx.browserBinding!==browserBinding)fail('ACTIVATION_INVALID');return {exchange:tx.exchange,browserBinding};},
  async verify({callback,exchangeDigest,bindingDigest,expectedIssuer,expectedSubject,requirePasswordSetup}){
   sweep();const url=new URL(callback),tx=transactions.get(url.searchParams.get('state'));
   if(url.origin!==origin||url.pathname!==callbackPath||!tx||tx.kind!=='auth'||hash(tx.exchange)!==exchangeDigest||hash(tx.browserBinding)!==bindingDigest||tx.expected.subject!==expectedSubject||expectedIssuer!==issuer)fail('ACTIVATION_INVALID');
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
