'use strict';
const https=require('node:https'),crypto=require('node:crypto');
const {SaxesParser}=require('../../../backend/node_modules/saxes');
const ERROR_LIMIT=4096;
const messages=Object.freeze({SignatureDoesNotMatch:'Request signature rejected.',PreconditionFailed:'Object precondition rejected.',AccessDenied:'Access denied.',ExpiredRequest:'Request expired.',RequestExpired:'Request expired.',NoSuchKey:'Object unavailable.',InvalidArgument:'Request argument rejected.'});
function providerError(bytes){let code;
 try{const text=bytes.toString('utf8');if(text.trimStart().startsWith('{')){const value=JSON.parse(text);code=value.Code||value.code||value.error?.code;}
 else{const parser=new SaxesParser();let inCode=false;parser.on('doctype',()=>{throw Error('DTD');});parser.on('opentag',tag=>{inCode=tag.name==='Code';});parser.on('text',value=>{if(inCode)code=(code||'')+value;});parser.on('closetag',()=>{inCode=false;});parser.write(text).close();}}
 catch{/* A bounded/incomplete diagnostic never becomes a parser failure disclosure. */}
 return Object.hasOwn(messages,code||'')?{code,message:messages[code]}:{code:'UNRECOGNIZED_PROVIDER_ERROR',message:'Provider response rejected.'};
}
function inspectHeaders(response){const h=response.headers,ids={};for(const name of ['x-amz-request-id','x-amz-id-2','cf-ray'])if(typeof h[name]==='string'&&/^[A-Za-z0-9+/=._:-]{1,256}$/.test(h[name]))ids[name]=h[name];
 return{status:response.statusCode,contentType:typeof h['content-type']==='string'&&/^[\w.+/-]+(?:;[\w= .-]+)?$/.test(h['content-type'])?h['content-type']:null,
 contentLength:/^\d+$/.test(h['content-length']||'')&&Number.isSafeInteger(Number(h['content-length']))?Number(h['content-length']):null,requestIds:ids};}
function readDownload(url,{expectedBytes,expectedSha256,headers={},record=()=>{},timeoutMs=30000}){
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||!/^[a-f0-9]{64}$/i.test(expectedSha256||''))return Promise.reject(Error('DOWNLOAD_EXPECTATION_INVALID'));
 return new Promise((resolve,reject)=>{let done=false,timer,response,meta=null,observed=0,retained=0,chunks=[];
 const finish=(code,complete=false)=>{if(done)return;done=true;clearTimeout(timer);
  const diagnostic={...(meta||{}),reservedBytes:expectedBytes,observedBytes:observed,bodyComplete:complete,totalBytes:complete?observed:null,interrupted:!complete,diagnosticBytes:meta?.status===200?0:retained,...(meta&&meta.status!==200?{provider:providerError(Buffer.concat(chunks))}:{})};
  record({kind:'DOWNLOAD_BODY_RESULT',...diagnostic,outcome:code||'VERIFIED'});
  if(code){const error=Object.assign(Error(code),{code,diagnostic});reject(error);response?.destroy();request.destroy();}
  else resolve({status:meta.status,headers:response.headers,body:Buffer.concat(chunks),diagnostic});
 };
 const request=https.request(url,{method:'GET',agent:false,headers},res=>{response=res;meta=inspectHeaders(res);record({kind:'DOWNLOAD_HTTP_HEADERS',...meta,reservedBytes:expectedBytes,observedBytes:0});
  const success=meta.status===200,limit=success?expectedBytes:ERROR_LIMIT;
  if(success&&meta.contentType&&/^(?:text\/(?:html|xml)|application\/(?:json|xml|[^;]+\+xml))(?:;|$)/i.test(meta.contentType)){finish('DOWNLOAD_ERROR_MEDIA');return;}
  if(success&&meta.contentLength!==null&&meta.contentLength!==expectedBytes){finish('DOWNLOAD_DECLARED_LENGTH_MISMATCH');return;}
  res.on('data',chunk=>{observed+=chunk.length;const take=chunk.subarray(0,Math.max(0,limit-retained));if(take.length){chunks.push(take);retained+=take.length;}if(observed>limit)finish(success?'DOWNLOAD_PAYLOAD_LIMIT':'DOWNLOAD_DIAGNOSTIC_LIMIT');});
  res.on('aborted',()=>finish('DOWNLOAD_BODY_INTERRUPTED'));res.on('error',()=>finish('DOWNLOAD_BODY_INTERRUPTED'));
  res.on('end',()=>{if(!res.complete){finish('DOWNLOAD_BODY_INTERRUPTED');return;}if(!success){finish('DOWNLOAD_HTTP_REJECTED',true);return;}
   if(observed!==expectedBytes){finish('DOWNLOAD_LENGTH_MISMATCH',true);return;}
   if(crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex')!==expectedSha256.toLowerCase()){finish('DOWNLOAD_DIGEST_MISMATCH',true);return;}finish(null,true);
  });
 });timer=setTimeout(()=>finish('DOWNLOAD_TIMEOUT'),timeoutMs);request.on('error',()=>finish('DOWNLOAD_TRANSPORT_FAILED'));request.end();
 });
}
module.exports={readDownload,ERROR_LIMIT};
