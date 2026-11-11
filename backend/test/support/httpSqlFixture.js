'use strict';
const {Client}=require('pg');
const {readConfig,connection}=require('../../scripts/localPlatform/config');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(size=57){
 // Only session-local temporary tables in the maintenance database. No Dev DB,
 // migration, grant or persistent table is accessed or modified.
 const config=readConfig(),db=new Client(connection(config,'postgres'));await db.connect();
 try{
 await db.query(`CREATE TEMP TABLE application(organization_id uuid,application_id uuid PRIMARY KEY,opportunity_id uuid,central_opportunity_id uuid,central_revision_id uuid,central_snapshot jsonb,evaluation_id uuid,title text,responsible_membership_id uuid,deadline date,notes text,total_budget numeric(18,2),organization_budget numeric(18,2),status text,revision bigint,created_at timestamptz,updated_at timestamptz);
 CREATE TEMP TABLE opportunity(organization_id uuid,opportunity_id uuid,title text,closing_date date,lifecycle_state text,current_revision_id uuid);
 CREATE TEMP TABLE application_change(organization_id uuid,application_id uuid,revision bigint,kind text,to_status text,recorded_at timestamptz);
 CREATE TEMP TABLE application_participant(organization_id uuid,application_id uuid,membership_id uuid,active boolean);
 CREATE TEMP TABLE person(organization_id uuid,person_id uuid,name text,email text,function_label text,active boolean,revision bigint);
 CREATE TEMP TABLE person_profile(organization_id uuid,person_id uuid,membership_id uuid,area_ids uuid[]);
 CREATE TEMP TABLE person_unit(organization_id uuid,person_id uuid,scope_id uuid,is_primary boolean);
 CREATE TEMP TABLE funding_identity(opportunity_id uuid,external_identifier text);
 CREATE TEMP TABLE revision(revision_id uuid);
 CREATE INDEX ON application(organization_id,central_opportunity_id);
 CREATE INDEX ON application_change(organization_id,application_id);`);
 await db.query(`INSERT INTO application SELECT $1,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$2,NULL,NULL,NULL,NULL,
 'Candidatura '||lpad((n-1)::text,5,'0'),$3,'2026-12-31',NULL,CASE WHEN n%2=0 THEN 9.99 ELSE 100.01 END,NULL,CASE WHEN n%2=0 THEN 'IDENTIFIED' ELSE 'SUBMITTED' END,1,now(),now() FROM generate_series(1,$4) n`,[id(100000),id(100001),id(100002),size]);
 await db.query("INSERT INTO opportunity VALUES($1,$2,'Aviso de teste','2027-01-01','ACTIVE',NULL)",[id(100000),id(100001)]);
 let queries=0,rows=0;const client={query:async(sql,params)=>{queries++;const result=await db.query(sql.replace(/(?:opportunity_catalog|organizational_scope)\./g,'pg_temp.'),params);rows+=result.rows.length;return result;}};
 return {db,client,id,org:id(100000),member:id(100002),close:()=>db.end(),counts:()=>({queries,rows})};
 }catch(error){await db.end();throw error;}
}
module.exports={fixture,id};
