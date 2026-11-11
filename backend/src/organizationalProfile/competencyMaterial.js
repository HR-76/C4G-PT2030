'use strict';
async function members(client,organizationId,draftId,revision){return (await client.query(`SELECT kind,version_id FROM organization_profile.competency_revision_member
 WHERE organization_id=$1 AND draft_id=$2 AND revision=$3 ORDER BY kind,version_id`,[organizationId,draftId,revision])).rows;}
async function append(client,organizationId,draftId,scope,revision,rows){for(const row of rows)await client.query(`INSERT INTO organization_profile.competency_revision_member
 (organization_id,draft_id,profile_scope_id,revision,kind,version_id) VALUES($1,$2,$3,$4,$5,$6)`,[organizationId,draftId,scope,revision,row.kind,row.version_id]);}
module.exports={members,append};
