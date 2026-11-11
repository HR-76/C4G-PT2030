'use strict';
const queries={
 get:`SELECT * FROM public.entity_admission_draft WHERE admission_id=$1`,
 receipt:`SELECT * FROM public.entity_admission_draft_receipt WHERE admission_id=$1 AND request_key=$2`,
 save:`INSERT INTO public.entity_admission_draft(admission_id,fields,revision,saved_by) VALUES($1,$2,1,$3) ON CONFLICT(admission_id) DO UPDATE SET fields=$2,revision=entity_admission_draft.revision+1,saved_by=$3,saved_at=clock_timestamp() RETURNING *`,
 remember:`INSERT INTO public.entity_admission_draft_receipt(admission_id,request_key,actor_id,intent_digest,result) VALUES($1,$2,$3,$4,$5)`,
};
module.exports=Object.freeze(Object.fromEntries(Object.entries(queries).map(([k,v])=>[k,v.replace(/\s+/g,' ').trim()])));
