'use strict';
const {bootstrapTelemetry}=require('./observability/bootstrap');
module.exports=bootstrapTelemetry({service:'c4g-worker',env:process.env});
