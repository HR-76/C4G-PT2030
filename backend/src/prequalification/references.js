'use strict';
const source=require('../organizationalProfile/pq1Source');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {fail}=require('./release');
// Lock published release rows against lifecycle mutation until transaction ends.
async function validateReferences(client,org,content){
 const concepts=[...content.items.filter(i=>i.conceptRef).map(i=>({ref:i.conceptRef,domain:i.domain})),
  ...content.assertions.filter(a=>a.conceptRef).map(a=>({ref:a.conceptRef,domain:'COMPETENCY'}))];
 const releases=[...new Set(concepts.map(c=>c.ref.releaseId))].sort();
 for(const release of releases)await client.query('SELECT release_id FROM organization_profile.catalog_release WHERE release_id=$1 ORDER BY release_id FOR SHARE',[release]);
 if(concepts.length){const rows=(await client.query(`SELECT c.concept_id,c.scheme_id,c.release_id,s.scheme_code,r.release_version,r.semantic_digest,c.organization_id
  FROM organization_profile.concept c JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id AND s.release_id=c.release_id
  JOIN organization_profile.catalog_release r ON r.release_id=c.release_id
  WHERE c.concept_id=ANY($1::uuid[]) AND (c.organization_id IS NULL OR c.organization_id=$2) AND r.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL FOR SHARE OF c,s,r`,[concepts.map(c=>c.ref.conceptId),org])).rows;
  for(const c of concepts){const row=rows.find(r=>r.concept_id===c.ref.conceptId&&r.scheme_id===c.ref.schemeId&&r.release_id===c.ref.releaseId&&r.scheme_code===c.domain);
   if(!row||(c.ref.releaseVersion&&row.release_version!==c.ref.releaseVersion)||(c.ref.releaseDigest&&row.semantic_digest!==c.ref.releaseDigest))fail('REFERENCE_INCOMPATIBLE');}
 }
 // Descriptor/catalog records are append-only. Exact method interpretation only.
 for(const v of content.verifications)if(canonicalize(await source.method(client,org,v.method.methodId))!==canonicalize(v.method))fail('REFERENCE_INCOMPATIBLE');
 for(const e of content.experiences){const entry=await source.catalogEntry(client,org,e.typeRef.entryId,'EXPERIENCE_TYPE');if(entry.release_id!==e.typeRef.releaseId)fail('REFERENCE_INCOMPATIBLE');}
 return source.documentAuthorizations(client,org,content.links);
}
module.exports={validateReferences};
