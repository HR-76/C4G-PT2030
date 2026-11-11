'use strict';
const {createContext,runWithContext}=require('./context');const {parseTraceContext}=require('./propagation');
function createOperationalContextMiddleware({service='c4g-api'}={}){return (req,res,next)=>{let trace=null;try{trace=parseTraceContext(req.headers||{});}catch{return res.status(400).json({error:{code:'TRACE_CONTEXT_INVALID',message:'Invalid trace context.'}});}const operation=req.route&&req.route.path?'http.request':'http.request';const ctx=createContext({service,component:'http',operation,traceId:trace&&trace.traceId,spanId:trace&&trace.spanId});runWithContext(ctx,next);};}
module.exports={createOperationalContextMiddleware};
