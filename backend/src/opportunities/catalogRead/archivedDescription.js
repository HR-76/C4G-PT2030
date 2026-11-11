'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {buildEvidence}=require('../../fundingTenders/sourceEvidence');
const {adaptEuOpportunityV2}=require('../../fundingTenders/adapterV2');
const {contentDigestV2}=require('../v2/digests');
const {sourceDescription}=require('../../fundingTenders/sourceDescription');
const manifest=require('./storedEvidence.manifest.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
// Offline enrichment of the detail response only. The immutable generation and
// summary remain unchanged; no remote source is queried and no HTML is trusted.
function loadArchivedDescription(directory=path.resolve(__dirname,'../../../../context/references/opportunity-v2/evidence')) {
  const documents={};
  for(const name of ['eu-11145.json','eu-11145.metadata.json']){
    const bytes=fs.readFileSync(path.join(directory,name));
    if(sha(bytes)!==manifest.files[name])throw Error('CATALOG_DESCRIPTION_EVIDENCE_MISMATCH');
    documents[name]=JSON.parse(bytes.toString('utf8'));
  }
  const metadata=documents['eu-11145.metadata.json'],response=documents['eu-11145.json'];
  const evidence=buildEvidence(metadata.externalIdentifier,response.results);
  // Same pinned evidence under either mapping: the published v2.0 revision or the live adapter's.
  const sourceDigests=new Set([contentDigestV2(require('./acceptedEu11145').acceptedEu11145(evidence,metadata)),contentDigestV2(adaptEuOpportunityV2(evidence,{observedAt:metadata.observedAt}))]);
  const artifactHash=sha(JSON.stringify(evidence));
  const raw=evidence.variants[0]?.metadata?.description;
  if(!Array.isArray(raw)||raw.length!==1||typeof raw[0]!=='string')return detail=>detail.detail;
  const full=sourceDescription(raw[0],raw[0].length+1);
  if(!full)return projection=>projection.detail;
  return projection=>{
    if(!sourceDigests.has(projection.sourceDigest))return projection.detail;
    const refs=projection.collections.evidence.filter(e=>e.contentSha256===artifactHash&&e.locator?.jsonPointer==='/variants/0/metadata/description/0');
    if(!refs.length)return projection.detail;
    const truncated=full.length>80000;
    return {...projection.detail,description:{state:'PRESENT',value:truncated?full.slice(0,79900)+'\n[Excerto — consulte a fonte oficial.]':full,evidenceIds:refs.map(e=>e.id)},descriptionTruncated:truncated,descriptionSourceUrl:metadata.officialUrl};
  };
}
module.exports={loadArchivedDescription};
