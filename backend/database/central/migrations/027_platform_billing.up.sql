-- Central, additive and deliberately empty: no billing data is inferred or backfilled.
CREATE TABLE public.billing_account (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL UNIQUE REFERENCES public.organization(id) ON DELETE RESTRICT,
 current_version bigint NOT NULL DEFAULT 1 CHECK(current_version > 0),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,organization_id),
 UNIQUE(id,organization_id,current_version),
 CHECK(current_version = revision)
);

CREATE TABLE public.billing_account_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 billing_account_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version > 0),
 legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 1 AND 200 AND legal_name = btrim(legal_name)),
 tax_country text NOT NULL CHECK(tax_country ~ '^[A-Z]{2}$'),
 tax_identifier text NOT NULL CHECK(length(tax_identifier) BETWEEN 1 AND 32 AND tax_identifier = btrim(tax_identifier)),
 address_line_1 text NOT NULL CHECK(length(address_line_1) BETWEEN 1 AND 200 AND address_line_1 = btrim(address_line_1)),
 address_line_2 text CHECK(address_line_2 IS NULL OR (length(address_line_2) <= 200 AND address_line_2 = btrim(address_line_2))),
 postal_code text NOT NULL CHECK(length(postal_code) BETWEEN 1 AND 32 AND postal_code = btrim(postal_code)),
 locality text NOT NULL CHECK(length(locality) BETWEEN 1 AND 120 AND locality = btrim(locality)),
 region text CHECK(region IS NULL OR (length(region) <= 120 AND region = btrim(region))),
 billing_email text NOT NULL CHECK(length(billing_email) BETWEEN 3 AND 254 AND billing_email = btrim(billing_email)),
 contact_name text CHECK(contact_name IS NULL OR (length(contact_name) <= 160 AND contact_name = btrim(contact_name))),
 external_source text CHECK(external_source IS NULL OR external_source IN ('TOCONLINE','FE_AP','OTHER')),
 external_customer_ref text CHECK(external_customer_ref IS NULL OR (length(external_customer_ref) <= 160 AND external_customer_ref = btrim(external_customer_ref))),
 payment_terms_days integer NOT NULL CHECK(payment_terms_days BETWEEN 0 AND 365),
 notes text CHECK(notes IS NULL OR length(notes) <= 4000),
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(billing_account_id,version),
 UNIQUE(id,organization_id),
 UNIQUE(billing_account_id,organization_id,version),
 FOREIGN KEY(billing_account_id,organization_id)
   REFERENCES public.billing_account(id,organization_id) ON DELETE RESTRICT,
 CHECK((tax_country <> 'PT') OR tax_identifier ~ '^[1-9][0-9]{8}$'),
 CHECK(external_customer_ref IS NULL OR external_source IS NOT NULL)
);

ALTER TABLE public.billing_account
 ADD CONSTRAINT billing_account_current_version_fk
 FOREIGN KEY(id,organization_id,current_version)
 REFERENCES public.billing_account_version(billing_account_id,organization_id,version)
 DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.billing_cycle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE RESTRICT,
 account_version_id uuid NOT NULL,
 period_start date NOT NULL,
 period_end date NOT NULL,
 service_description text NOT NULL CHECK(length(service_description) BETWEEN 1 AND 500 AND service_description = btrim(service_description)),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount numeric(20,6) NOT NULL CHECK(amount > 0),
 planned_issue_date date,
 due_date date NOT NULL,
 contract_reference text CHECK(contract_reference IS NULL OR (length(contract_reference) <= 160 AND contract_reference = btrim(contract_reference))),
 notes text CHECK(notes IS NULL OR length(notes) <= 4000),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','READY_TO_ISSUE','ISSUED','CREDITED','CANCELLED')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 updated_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,organization_id),
 UNIQUE(id,organization_id,currency),
 FOREIGN KEY(account_version_id,organization_id)
   REFERENCES public.billing_account_version(id,organization_id) ON DELETE RESTRICT,
 CHECK(period_start <= period_end)
);

CREATE TABLE public.billing_cycle_revision (
 billing_cycle_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision > 0),
 account_version_id uuid NOT NULL,
 period_start date NOT NULL,
 period_end date NOT NULL,
 service_description text NOT NULL CHECK(length(service_description) BETWEEN 1 AND 500),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount numeric(20,6) NOT NULL CHECK(amount > 0),
 planned_issue_date date,
 due_date date NOT NULL,
 contract_reference text CHECK(contract_reference IS NULL OR length(contract_reference) <= 160),
 notes text CHECK(notes IS NULL OR length(notes) <= 4000),
 state text NOT NULL CHECK(state IN ('DRAFT','READY_TO_ISSUE','ISSUED','CREDITED','CANCELLED')),
 changed_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 change_reason text CHECK(change_reason IS NULL OR (length(change_reason) BETWEEN 1 AND 500 AND change_reason = btrim(change_reason))),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(billing_cycle_id,revision),
 FOREIGN KEY(billing_cycle_id,organization_id)
   REFERENCES public.billing_cycle(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(account_version_id,organization_id)
   REFERENCES public.billing_account_version(id,organization_id) ON DELETE RESTRICT,
 CHECK(period_start <= period_end)
);

CREATE TABLE public.billing_fiscal_document (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 billing_cycle_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 source_code text NOT NULL CHECK(source_code IN ('TOCONLINE','FE_AP','OTHER')),
 issuer_reference text NOT NULL CHECK(length(issuer_reference) BETWEEN 1 AND 160 AND issuer_reference = btrim(issuer_reference)),
 document_type text NOT NULL CHECK(document_type IN ('INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT','CREDIT_NOTE','DEBIT_NOTE')),
 document_number text NOT NULL CHECK(length(document_number) BETWEEN 1 AND 160 AND document_number = btrim(document_number)),
 external_document_id text CHECK(external_document_id IS NULL OR (length(external_document_id) <= 200 AND external_document_id = btrim(external_document_id))),
 issue_date date NOT NULL,
 due_date date NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 subtotal numeric(20,6) NOT NULL CHECK(subtotal >= 0),
 tax_total numeric(20,6) NOT NULL CHECK(tax_total >= 0),
 total numeric(20,6) NOT NULL CHECK(total > 0),
 corrects_document_id uuid,
 state text NOT NULL DEFAULT 'ISSUED' CHECK(state IN ('ISSUED','CREDITED','CANCELLED')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 updated_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,organization_id),
 UNIQUE(id,organization_id,currency),
 UNIQUE(source_code,issuer_reference,document_type,document_number),
 FOREIGN KEY(billing_cycle_id,organization_id,currency)
   REFERENCES public.billing_cycle(id,organization_id,currency) ON DELETE RESTRICT,
 FOREIGN KEY(corrects_document_id,organization_id,currency)
   REFERENCES public.billing_fiscal_document(id,organization_id,currency) ON DELETE RESTRICT,
 CHECK((document_type IN ('CREDIT_NOTE','DEBIT_NOTE')) = (corrects_document_id IS NOT NULL)),
 CHECK(subtotal + tax_total = total),
 CHECK(corrects_document_id IS NULL OR corrects_document_id <> id)
);

CREATE UNIQUE INDEX billing_fiscal_document_primary_cycle
 ON public.billing_fiscal_document(billing_cycle_id)
 WHERE document_type IN ('INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT');

CREATE TABLE public.billing_fiscal_document_revision (
 billing_document_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision > 0),
 state text NOT NULL CHECK(state IN ('ISSUED','CREDITED','CANCELLED')),
 reason text CHECK(reason IS NULL OR (length(reason) BETWEEN 1 AND 500 AND reason = btrim(reason))),
 changed_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(billing_document_id,revision),
 FOREIGN KEY(billing_document_id,organization_id)
   REFERENCES public.billing_fiscal_document(id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE public.billing_payment_record (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 billing_document_id uuid NOT NULL,
 record_type text NOT NULL CHECK(record_type IN ('PAYMENT','REVERSAL')),
 reverses_payment_id uuid,
 amount numeric(20,6) NOT NULL CHECK(amount > 0),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 effective_on date NOT NULL,
 method_code text NOT NULL CHECK(method_code IN ('BANK_TRANSFER','DIRECT_DEBIT','CARD_PROVIDER','OTHER')),
 external_reference text CHECK(external_reference IS NULL OR (length(external_reference) <= 200 AND external_reference = btrim(external_reference))),
 note text CHECK(note IS NULL OR length(note) <= 1000),
 origin text NOT NULL DEFAULT 'MANUAL_C4G' CHECK(origin = 'MANUAL_C4G'),
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,billing_document_id,organization_id,currency),
 FOREIGN KEY(billing_document_id,organization_id,currency)
   REFERENCES public.billing_fiscal_document(id,organization_id,currency) ON DELETE RESTRICT,
 FOREIGN KEY(reverses_payment_id,billing_document_id,organization_id,currency)
   REFERENCES public.billing_payment_record(id,billing_document_id,organization_id,currency) ON DELETE RESTRICT,
 CHECK((record_type = 'REVERSAL') = (reverses_payment_id IS NOT NULL)),
 CHECK(reverses_payment_id IS NULL OR reverses_payment_id <> id)
);

CREATE TABLE public.billing_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE RESTRICT,
 operation_code text NOT NULL CHECK(operation_code IN (
  'ACCOUNT_WRITE','CYCLE_CREATE','CYCLE_EDIT','CYCLE_TRANSITION',
  'DOCUMENT_RECORD','DOCUMENT_TRANSITION','PAYMENT_RECORD','PAYMENT_REVERSE'
 )),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 event_code text NOT NULL CHECK(event_code IN (
  'PLATFORM_BILLING_ACCOUNT_CHANGED','PLATFORM_BILLING_CYCLE_CHANGED',
  'PLATFORM_BILLING_DOCUMENT_RECORDED','PLATFORM_BILLING_DOCUMENT_CHANGED',
  'PLATFORM_BILLING_PAYMENT_RECORDED','PLATFORM_BILLING_PAYMENT_REVERSED'
 )),
 resource_type text NOT NULL CHECK(resource_type IN ('BILLING_ACCOUNT','BILLING_CYCLE','BILLING_DOCUMENT','BILLING_PAYMENT')),
 resource_id uuid NOT NULL,
 previous_revision bigint CHECK(previous_revision IS NULL OR previous_revision >= 0),
 new_revision bigint CHECK(new_revision IS NULL OR new_revision > 0),
 detail_code text NOT NULL CHECK(detail_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 correlation_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,
 UNIQUE(organization_id,operation_code,idempotency_key)
);

CREATE TABLE public.billing_command_receipt (
 organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE RESTRICT,
 operation_code text NOT NULL CHECK(operation_code IN (
  'ACCOUNT_WRITE','CYCLE_CREATE','CYCLE_EDIT','CYCLE_TRANSITION',
  'DOCUMENT_RECORD','DOCUMENT_TRANSITION','PAYMENT_RECORD','PAYMENT_REVERSE'
 )),
 request_key uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL CHECK(jsonb_typeof(result_projection) = 'object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,operation_code,request_key)
);

CREATE FUNCTION public.billing_document_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cycle_amount numeric(20,6); corrected_type text; corrected_state text;
 cycle_state text; corrected_total numeric(20,6); credited_total numeric(20,6);
 debited_total numeric(20,6); net_paid numeric(20,6);
BEGIN
 SELECT amount,state INTO STRICT cycle_amount,cycle_state FROM public.billing_cycle
  WHERE id=NEW.billing_cycle_id AND organization_id=NEW.organization_id AND currency=NEW.currency FOR UPDATE;
 IF TG_OP='INSERT' AND NEW.document_type IN ('INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT') THEN
  IF cycle_state<>'READY_TO_ISSUE' THEN
   RAISE EXCEPTION 'BILLING_CYCLE_NOT_READY' USING ERRCODE='23514';
  END IF;
  IF NEW.total<>cycle_amount THEN
   RAISE EXCEPTION 'BILLING_DOCUMENT_TOTAL_MISMATCH' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.corrects_document_id IS NOT NULL THEN
  SELECT document_type,state,total INTO STRICT corrected_type,corrected_state,corrected_total
   FROM public.billing_fiscal_document
   WHERE id=NEW.corrects_document_id AND billing_cycle_id=NEW.billing_cycle_id
    AND organization_id=NEW.organization_id AND currency=NEW.currency FOR UPDATE;
  IF corrected_type NOT IN ('INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT') THEN
   RAISE EXCEPTION 'BILLING_CORRECTION_TARGET_INVALID' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND (cycle_state<>'ISSUED' OR corrected_state<>'ISSUED') THEN
   RAISE EXCEPTION 'BILLING_CYCLE_NOT_ISSUED' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.document_type='CREDIT_NOTE' THEN
   SELECT COALESCE(sum(total) FILTER (WHERE document_type='CREDIT_NOTE' AND state<>'CANCELLED'),0),
    COALESCE(sum(total) FILTER (WHERE document_type='DEBIT_NOTE' AND state<>'CANCELLED'),0)
    INTO credited_total,debited_total FROM public.billing_fiscal_document
    WHERE corrects_document_id=NEW.corrects_document_id AND organization_id=NEW.organization_id;
   SELECT COALESCE(sum(CASE record_type WHEN 'PAYMENT' THEN amount ELSE -amount END),0)
    INTO net_paid FROM public.billing_payment_record
    WHERE billing_document_id=NEW.corrects_document_id AND organization_id=NEW.organization_id;
   IF credited_total+NEW.total+net_paid>corrected_total+debited_total THEN
    RAISE EXCEPTION 'BILLING_CREDIT_EXCEEDS_BALANCE' USING ERRCODE='23514';
   END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD.state='ISSUED' AND NEW.state='CANCELLED'
     AND NEW.document_type='DEBIT_NOTE' THEN
   SELECT COALESCE(sum(total) FILTER (WHERE document_type='CREDIT_NOTE' AND state<>'CANCELLED'),0),
    COALESCE(sum(total) FILTER (WHERE document_type='DEBIT_NOTE' AND state<>'CANCELLED'),0)
    INTO credited_total,debited_total FROM public.billing_fiscal_document
    WHERE corrects_document_id=NEW.corrects_document_id AND organization_id=NEW.organization_id;
   SELECT COALESCE(sum(CASE record_type WHEN 'PAYMENT' THEN amount ELSE -amount END),0)
    INTO net_paid FROM public.billing_payment_record
    WHERE billing_document_id=NEW.corrects_document_id AND organization_id=NEW.organization_id;
   IF net_paid>corrected_total+debited_total-NEW.total-credited_total THEN
    RAISE EXCEPTION 'BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION authority_api.execute_platform_billing(query_code text, parameters text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $billing_authority$
DECLARE statement text; parameter_count integer; result_rows jsonb; affected bigint;
BEGIN
 IF session_user<>'c4g_authority_runtime' THEN
  RAISE EXCEPTION 'AUTHORITY_LOGIN_REQUIRED' USING ERRCODE='42501';
 END IF;
 CASE query_code
 WHEN '3b04f66244ed8d4ad5172964c703971ae37926ef761bce190d883e7432635236' THEN statement:='SELECT u.id FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id JOIN public.platform_admin_assignment a ON a.global_user_id=u.id WHERE s.sid=$1 AND u.id=$2 AND s.status=''ACTIVE'' AND s.expires_at>clock_timestamp() AND s.revocation_version=u.session_revocation_version AND u.status=''ACTIVE'' AND a.role_code=''C4G_ADMIN'' AND a.status=''ACTIVE''';
 WHEN '03ff4f20a8b6ea95a897dd2f75c906b96781137cae2824d47bf1d0d3da7f0c48' THEN statement:='SELECT organization_id FROM public.billing_cycle WHERE id=$1';
 WHEN '6f973ed6ff2f3a0d9d95b678c3ab3f50aa425fb1dd2c7fbd2b6456d43d808f96' THEN statement:='SELECT organization_id FROM public.billing_fiscal_document WHERE id=$1';
 WHEN '2acaff4b43d28fb29d820f2ae85d6fecd728fdae7a134a0b7835017a3b3cfd5c' THEN statement:='SELECT organization_id FROM public.billing_payment_record WHERE id=$1';
 WHEN '889e8aea4843286103312a3dbff38e7a061524b88f882f9673923a25b7c9119a' THEN statement:='SELECT id FROM public.organization WHERE id=$1 AND status=''ACTIVE'' FOR SHARE';
 WHEN '72a210db9bb42743c741304829fe8080ac772cbdaf93412b2ad695c71abe8ee6' THEN statement:='SELECT intent_digest,result_projection FROM public.billing_command_receipt WHERE organization_id=$1 AND operation_code=$2 AND request_key=$3';
 WHEN '1aecf70af028b73f8ffbfa813141f1261562a755796ead7768d1978b165da82f' THEN statement:='SELECT * FROM public.billing_account WHERE organization_id=$1 FOR UPDATE';
 WHEN '37c0f063578b0d9921f5b2d85083a57e690311a22ec2723c3f872d4b2d1da651' THEN statement:='SELECT * FROM public.billing_account_version WHERE id=$1 AND organization_id=$2';
 WHEN '8861d7c3aa2dc810a39671e23fa3f6d33fc209948ea3358312b31d8557a53ab3' THEN statement:='INSERT INTO public.billing_account(id,organization_id,current_version,revision) VALUES($1,$2,1,1) RETURNING *';
 WHEN '57fedab16d74e25d32d045196a534a550636c5b4f5db1aba2dfb4c8f13b34676' THEN statement:='INSERT INTO public.billing_account_version(id,billing_account_id,organization_id,version,legal_name,tax_country,tax_identifier,address_line_1,address_line_2,postal_code,locality,region,billing_email,contact_name,external_source,external_customer_ref,payment_terms_days,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *';
 WHEN 'aa1a3c8a96d09810a2f5a4fabc95f47513de859ddd4f617fa944de8b08252ce4' THEN statement:='UPDATE public.billing_account SET current_version=$3,revision=$3,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$4 RETURNING *';
 WHEN '648d91d04453e24975748ff988ea71af2f2a75769675a7129a423e1b8bfa429a' THEN statement:='INSERT INTO public.billing_cycle(id,organization_id,account_version_id,period_start,period_end,service_description,currency,amount,planned_issue_date,due_date,contract_reference,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *';
 WHEN 'cda36bf01eb8578d224b384b6c706c771ecbf77614db135abc81a5b8f46497ee' THEN statement:='SELECT * FROM public.billing_cycle WHERE id=$1 AND organization_id=$2 FOR UPDATE';
 WHEN '3efa1df5ea375df1da93e6c6d2e08a87ac82721882a0d568e27cc31b77dd7008' THEN statement:='UPDATE public.billing_cycle SET account_version_id=$3,period_start=$4,period_end=$5,service_description=$6,currency=$7,amount=$8,planned_issue_date=$9,due_date=$10,contract_reference=$11,notes=$12,revision=revision+1,updated_by=$13,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$14 AND state=''DRAFT'' RETURNING *';
 WHEN 'd389081c09222bec662daed0b31c1788fc680b3670481545611936614a60850f' THEN statement:='UPDATE public.billing_cycle SET state=$3,revision=revision+1,updated_by=$4,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$5 RETURNING *';
 WHEN 'f12d07705bdcf03e444f12869d33938d9c5f6ff60016ae6049096745372c86ba' THEN statement:='INSERT INTO public.billing_cycle_revision(billing_cycle_id,organization_id,revision,account_version_id,period_start,period_end,service_description,currency,amount,planned_issue_date,due_date,contract_reference,notes,state,changed_by,change_reason) SELECT id,organization_id,revision,account_version_id,period_start,period_end,service_description,currency,amount,planned_issue_date,due_date,contract_reference,notes,state,$2,$3 FROM public.billing_cycle WHERE id=$1 RETURNING *';
 WHEN 'f5ce70d8fbbc273c4f6b09e225b5eceac227d8e62b3dc9c122a2c9b0b04ccd9a' THEN statement:='INSERT INTO public.billing_fiscal_document(id,billing_cycle_id,organization_id,source_code,issuer_reference,document_type,document_number,external_document_id,issue_date,due_date,currency,subtotal,tax_total,total,corrects_document_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *';
 WHEN 'c760cfeeb53edf3f1cb38ee38c9c4d741244e0f6f45dfdd82298ec7a23e2295b' THEN statement:='SELECT * FROM public.billing_fiscal_document WHERE id=$1 AND organization_id=$2';
 WHEN '6910127df9f5870d6511c18709ebcf54ef6b9900c5e26d36439785eddfd77e75' THEN statement:='SELECT * FROM public.billing_fiscal_document WHERE id=$1 AND organization_id=$2 FOR UPDATE';
 WHEN 'acac615857c279df7a9c23e15ef397eeb609f1d3c96533d011f497d974283b01' THEN statement:='SELECT COALESCE(sum(total) FILTER (WHERE document_type=''CREDIT_NOTE'' AND state<>''CANCELLED''),0)::text AS credit_amount,COALESCE(sum(total) FILTER (WHERE document_type=''DEBIT_NOTE'' AND state<>''CANCELLED''),0)::text AS debit_amount FROM public.billing_fiscal_document WHERE corrects_document_id=$1 AND organization_id=$2';
 WHEN '27f0c5d441adfd253ae0ccccee8c7f4a4cc0e01c5d8d2d947c3028b6a1e6c441' THEN statement:='UPDATE public.billing_fiscal_document SET state=$3,revision=revision+1,updated_by=$4,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$5 RETURNING *';
 WHEN '5511866fde538aab8d07d52da51b310bca0a535c16d4c83b324d35e8bfacc26a' THEN statement:='INSERT INTO public.billing_fiscal_document_revision(billing_document_id,organization_id,revision,state,reason,changed_by) SELECT id,organization_id,revision,state,$2,$3 FROM public.billing_fiscal_document WHERE id=$1 RETURNING *';
 WHEN '446e8d592adbc1a86387a991feb5e45e1342e12b76cd08967ea05b883e3e9278' THEN statement:='INSERT INTO public.billing_payment_record(id,organization_id,billing_document_id,record_type,reverses_payment_id,amount,currency,effective_on,method_code,external_reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *';
 WHEN 'c17343cde47eab284018d45523dcd09eb7211fc56aa3c3ff75d75c27f6be8184' THEN statement:='SELECT p.*,d.billing_cycle_id,d.document_type,d.state AS document_state FROM public.billing_payment_record p JOIN public.billing_fiscal_document d ON d.id=p.billing_document_id AND d.organization_id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2';
 WHEN 'b05066349c01375956280c32200bfef2ddb91b9c04320ec002f276f2a4821210' THEN statement:='SELECT * FROM public.billing_payment_record WHERE id=$1 AND organization_id=$2 FOR UPDATE';
 WHEN 'fe8922b4f4929c83c382002b77efbec85baa8e719cfbbb7dc521ccd7f06d16e0' THEN statement:='SELECT (d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0))::text AS total,COALESCE(p.paid_amount,0)::text AS paid_amount,(d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0)-COALESCE(p.paid_amount,0))::text AS balance_amount,COALESCE(p.payment_count,0)::text AS payment_count,COALESCE(p.reversal_count,0)::text AS reversal_count FROM public.billing_fiscal_document d LEFT JOIN (SELECT billing_document_id,sum(CASE record_type WHEN ''PAYMENT'' THEN amount ELSE -amount END) AS paid_amount,count(*) FILTER (WHERE record_type=''PAYMENT'') AS payment_count,count(*) FILTER (WHERE record_type=''REVERSAL'') AS reversal_count FROM public.billing_payment_record GROUP BY billing_document_id) p ON p.billing_document_id=d.id LEFT JOIN (SELECT corrects_document_id,sum(total) FILTER (WHERE document_type=''CREDIT_NOTE'' AND state<>''CANCELLED'') AS credit_amount,sum(total) FILTER (WHERE document_type=''DEBIT_NOTE'' AND state<>''CANCELLED'') AS debit_amount FROM public.billing_fiscal_document GROUP BY corrects_document_id) a ON a.corrects_document_id=d.id WHERE d.id=$1 AND d.organization_id=$2';
 WHEN 'e1a0f9e03015945479ea140d41365a0a860c098a0142899bb84d72451f4c1d60' THEN statement:='INSERT INTO public.billing_activity(organization_id,operation_code,actor_id,event_code,resource_type,resource_id,previous_revision,new_revision,detail_code,correlation_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,occurred_at';
 WHEN '2a70dc6e7aba2293af0300722da87a54792d74f8c468cfe9b122a248c65e9c22' THEN statement:='INSERT INTO public.billing_command_receipt(organization_id,operation_code,request_key,actor_id,intent_digest,result_projection) VALUES($1,$2,$3,$4,$5,$6) RETURNING result_projection';
 WHEN '72f5e46d8c508f4def11beff55078c9449348cec04bf97e19ab20bb647189066' THEN statement:='WITH payment_totals AS ( SELECT billing_document_id, COALESCE(sum(CASE record_type WHEN ''PAYMENT'' THEN amount ELSE -amount END),0) AS paid_amount, count(*) FILTER (WHERE record_type=''PAYMENT'') AS payment_count, count(*) FILTER (WHERE record_type=''REVERSAL'') AS reversal_count FROM public.billing_payment_record GROUP BY billing_document_id ), adjustment_totals AS ( SELECT corrects_document_id AS billing_document_id, COALESCE(sum(total) FILTER (WHERE document_type=''CREDIT_NOTE'' AND state<>''CANCELLED''),0) AS credit_amount, COALESCE(sum(total) FILTER (WHERE document_type=''DEBIT_NOTE'' AND state<>''CANCELLED''),0) AS debit_amount FROM public.billing_fiscal_document WHERE corrects_document_id IS NOT NULL GROUP BY corrects_document_id ), cycle_financials AS ( SELECT c.*,o.display_name AS organization_name,o.legal_name AS organization_legal_name, d.id AS document_id,d.document_type,d.document_number,d.issue_date,d.due_date AS document_due_date, d.state AS document_state,d.revision AS document_revision, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0) END AS adjusted_total, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE COALESCE(p.paid_amount,0) END AS paid_amount, COALESCE(a.credit_amount,0) AS credit_amount,COALESCE(a.debit_amount,0) AS debit_amount, COALESCE(p.payment_count,0) AS payment_count,COALESCE(p.reversal_count,0) AS reversal_count FROM public.billing_cycle c JOIN public.organization o ON o.id=c.organization_id LEFT JOIN public.billing_fiscal_document d ON d.billing_cycle_id=c.id AND d.document_type IN (''INVOICE'',''SIMPLIFIED_INVOICE'',''INVOICE_RECEIPT'') LEFT JOIN payment_totals p ON p.billing_document_id=d.id LEFT JOIN adjustment_totals a ON a.billing_document_id=d.id ), cycle_projection AS ( SELECT f.*,GREATEST(f.adjusted_total-f.paid_amount,0) AS balance_amount, CASE WHEN f.paid_amount=0 AND f.payment_count>0 AND f.reversal_count>0 THEN ''REVERSED'' WHEN f.paid_amount=0 THEN ''UNPAID'' WHEN GREATEST(f.adjusted_total-f.paid_amount,0)=0 THEN ''PAID'' ELSE ''PARTIALLY_PAID'' END AS payment_state FROM cycle_financials f ) SELECT currency, COALESCE(sum(adjusted_total) FILTER (WHERE document_id IS NOT NULL),0)::text AS billed_amount, COALESCE(sum(paid_amount),0)::text AS received_amount, COALESCE(sum(balance_amount),0)::text AS outstanding_amount, COALESCE(sum(balance_amount) FILTER (WHERE document_state=''ISSUED'' AND document_due_date<$4::date),0)::text AS overdue_amount, count(document_id)::text AS document_count, count(DISTINCT organization_id) FILTER (WHERE balance_amount>0)::text AS organizations_with_balance FROM cycle_projection WHERE ($1::date IS NULL OR period_end>=$1) AND ($2::date IS NULL OR period_start<=$2) AND ($3::text IS NULL OR currency=$3) GROUP BY currency ORDER BY currency';
 WHEN '9ad87f999afca23da59d2e38ccb6bfa6535628c4c1e0ac514b500f100d6cbee5' THEN statement:='WITH payment_totals AS ( SELECT billing_document_id, COALESCE(sum(CASE record_type WHEN ''PAYMENT'' THEN amount ELSE -amount END),0) AS paid_amount, count(*) FILTER (WHERE record_type=''PAYMENT'') AS payment_count, count(*) FILTER (WHERE record_type=''REVERSAL'') AS reversal_count FROM public.billing_payment_record GROUP BY billing_document_id ), adjustment_totals AS ( SELECT corrects_document_id AS billing_document_id, COALESCE(sum(total) FILTER (WHERE document_type=''CREDIT_NOTE'' AND state<>''CANCELLED''),0) AS credit_amount, COALESCE(sum(total) FILTER (WHERE document_type=''DEBIT_NOTE'' AND state<>''CANCELLED''),0) AS debit_amount FROM public.billing_fiscal_document WHERE corrects_document_id IS NOT NULL GROUP BY corrects_document_id ), cycle_financials AS ( SELECT c.*,o.display_name AS organization_name,o.legal_name AS organization_legal_name, d.id AS document_id,d.document_type,d.document_number,d.issue_date,d.due_date AS document_due_date, d.state AS document_state,d.revision AS document_revision, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0) END AS adjusted_total, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE COALESCE(p.paid_amount,0) END AS paid_amount, COALESCE(a.credit_amount,0) AS credit_amount,COALESCE(a.debit_amount,0) AS debit_amount, COALESCE(p.payment_count,0) AS payment_count,COALESCE(p.reversal_count,0) AS reversal_count FROM public.billing_cycle c JOIN public.organization o ON o.id=c.organization_id LEFT JOIN public.billing_fiscal_document d ON d.billing_cycle_id=c.id AND d.document_type IN (''INVOICE'',''SIMPLIFIED_INVOICE'',''INVOICE_RECEIPT'') LEFT JOIN payment_totals p ON p.billing_document_id=d.id LEFT JOIN adjustment_totals a ON a.billing_document_id=d.id ), cycle_projection AS ( SELECT f.*,GREATEST(f.adjusted_total-f.paid_amount,0) AS balance_amount, CASE WHEN f.paid_amount=0 AND f.payment_count>0 AND f.reversal_count>0 THEN ''REVERSED'' WHEN f.paid_amount=0 THEN ''UNPAID'' WHEN GREATEST(f.adjusted_total-f.paid_amount,0)=0 THEN ''PAID'' ELSE ''PARTIALLY_PAID'' END AS payment_state FROM cycle_financials f ) SELECT count(*)::text AS total FROM cycle_projection WHERE ($1='''' OR strpos(lower(organization_name),lower($1))>0 OR strpos(lower(organization_legal_name),lower($1))>0 OR strpos(lower(COALESCE(document_number,'''')),lower($1))>0 OR strpos(lower(COALESCE(contract_reference,'''')),lower($1))>0) AND ($2::uuid IS NULL OR organization_id=$2) AND ($3::date IS NULL OR period_end>=$3) AND ($4::date IS NULL OR period_start<=$4) AND ($5::text IS NULL OR state=$5) AND ($6::text IS NULL OR payment_state=$6) AND ($7::boolean IS NULL OR (document_state=''ISSUED'' AND balance_amount>0 AND document_due_date<$9::date)=$7) AND ($8::text IS NULL OR currency=$8)';
 WHEN '29f914dfc72c262a5b472e70c8103a2873d3c8e1139760ec0a0540089226b609' THEN statement:='WITH payment_totals AS ( SELECT billing_document_id, COALESCE(sum(CASE record_type WHEN ''PAYMENT'' THEN amount ELSE -amount END),0) AS paid_amount, count(*) FILTER (WHERE record_type=''PAYMENT'') AS payment_count, count(*) FILTER (WHERE record_type=''REVERSAL'') AS reversal_count FROM public.billing_payment_record GROUP BY billing_document_id ), adjustment_totals AS ( SELECT corrects_document_id AS billing_document_id, COALESCE(sum(total) FILTER (WHERE document_type=''CREDIT_NOTE'' AND state<>''CANCELLED''),0) AS credit_amount, COALESCE(sum(total) FILTER (WHERE document_type=''DEBIT_NOTE'' AND state<>''CANCELLED''),0) AS debit_amount FROM public.billing_fiscal_document WHERE corrects_document_id IS NOT NULL GROUP BY corrects_document_id ), cycle_financials AS ( SELECT c.*,o.display_name AS organization_name,o.legal_name AS organization_legal_name, d.id AS document_id,d.document_type,d.document_number,d.issue_date,d.due_date AS document_due_date, d.state AS document_state,d.revision AS document_revision, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0) END AS adjusted_total, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE COALESCE(p.paid_amount,0) END AS paid_amount, COALESCE(a.credit_amount,0) AS credit_amount,COALESCE(a.debit_amount,0) AS debit_amount, COALESCE(p.payment_count,0) AS payment_count,COALESCE(p.reversal_count,0) AS reversal_count FROM public.billing_cycle c JOIN public.organization o ON o.id=c.organization_id LEFT JOIN public.billing_fiscal_document d ON d.billing_cycle_id=c.id AND d.document_type IN (''INVOICE'',''SIMPLIFIED_INVOICE'',''INVOICE_RECEIPT'') LEFT JOIN payment_totals p ON p.billing_document_id=d.id LEFT JOIN adjustment_totals a ON a.billing_document_id=d.id ), cycle_projection AS ( SELECT f.*,GREATEST(f.adjusted_total-f.paid_amount,0) AS balance_amount, CASE WHEN f.paid_amount=0 AND f.payment_count>0 AND f.reversal_count>0 THEN ''REVERSED'' WHEN f.paid_amount=0 THEN ''UNPAID'' WHEN GREATEST(f.adjusted_total-f.paid_amount,0)=0 THEN ''PAID'' ELSE ''PARTIALLY_PAID'' END AS payment_state FROM cycle_financials f ) SELECT id AS cycle_id,organization_id,organization_name,organization_legal_name, account_version_id,period_start,period_end,service_description,currency,amount::text AS cycle_amount, planned_issue_date,due_date,contract_reference,state AS cycle_state,revision AS cycle_revision, document_id,document_type,document_number,issue_date,document_due_date,document_state,document_revision, adjusted_total::text AS adjusted_total,credit_amount::text AS credit_amount,debit_amount::text AS debit_amount, paid_amount::text AS paid_amount,balance_amount::text AS balance_amount,payment_state, (document_state=''ISSUED'' AND balance_amount>0 AND document_due_date<$9::date) AS overdue FROM cycle_projection WHERE ($1='''' OR strpos(lower(organization_name),lower($1))>0 OR strpos(lower(organization_legal_name),lower($1))>0 OR strpos(lower(COALESCE(document_number,'''')),lower($1))>0 OR strpos(lower(COALESCE(contract_reference,'''')),lower($1))>0) AND ($2::uuid IS NULL OR organization_id=$2) AND ($3::date IS NULL OR period_end>=$3) AND ($4::date IS NULL OR period_start<=$4) AND ($5::text IS NULL OR state=$5) AND ($6::text IS NULL OR payment_state=$6) AND ($7::boolean IS NULL OR (document_state=''ISSUED'' AND balance_amount>0 AND document_due_date<$9::date)=$7) AND ($8::text IS NULL OR currency=$8) ORDER BY period_start DESC,id DESC LIMIT $10 OFFSET $11';
 WHEN '8446eb23f67e1ccf0e490b241672b95b6b680a23c84edc2847f05e2eeadb5ae3' THEN statement:='WITH payment_totals AS ( SELECT billing_document_id, COALESCE(sum(CASE record_type WHEN ''PAYMENT'' THEN amount ELSE -amount END),0) AS paid_amount, count(*) FILTER (WHERE record_type=''PAYMENT'') AS payment_count, count(*) FILTER (WHERE record_type=''REVERSAL'') AS reversal_count FROM public.billing_payment_record GROUP BY billing_document_id ), adjustment_totals AS ( SELECT corrects_document_id AS billing_document_id, COALESCE(sum(total) FILTER (WHERE document_type=''CREDIT_NOTE'' AND state<>''CANCELLED''),0) AS credit_amount, COALESCE(sum(total) FILTER (WHERE document_type=''DEBIT_NOTE'' AND state<>''CANCELLED''),0) AS debit_amount FROM public.billing_fiscal_document WHERE corrects_document_id IS NOT NULL GROUP BY corrects_document_id ), cycle_financials AS ( SELECT c.*,o.display_name AS organization_name,o.legal_name AS organization_legal_name, d.id AS document_id,d.document_type,d.document_number,d.issue_date,d.due_date AS document_due_date, d.state AS document_state,d.revision AS document_revision, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0) END AS adjusted_total, CASE WHEN d.id IS NULL OR d.state=''CANCELLED'' THEN 0 ELSE COALESCE(p.paid_amount,0) END AS paid_amount, COALESCE(a.credit_amount,0) AS credit_amount,COALESCE(a.debit_amount,0) AS debit_amount, COALESCE(p.payment_count,0) AS payment_count,COALESCE(p.reversal_count,0) AS reversal_count FROM public.billing_cycle c JOIN public.organization o ON o.id=c.organization_id LEFT JOIN public.billing_fiscal_document d ON d.billing_cycle_id=c.id AND d.document_type IN (''INVOICE'',''SIMPLIFIED_INVOICE'',''INVOICE_RECEIPT'') LEFT JOIN payment_totals p ON p.billing_document_id=d.id LEFT JOIN adjustment_totals a ON a.billing_document_id=d.id ), cycle_projection AS ( SELECT f.*,GREATEST(f.adjusted_total-f.paid_amount,0) AS balance_amount, CASE WHEN f.paid_amount=0 AND f.payment_count>0 AND f.reversal_count>0 THEN ''REVERSED'' WHEN f.paid_amount=0 THEN ''UNPAID'' WHEN GREATEST(f.adjusted_total-f.paid_amount,0)=0 THEN ''PAID'' ELSE ''PARTIALLY_PAID'' END AS payment_state FROM cycle_financials f ) SELECT p.id AS cycle_id,p.organization_id,p.organization_name,p.organization_legal_name, p.account_version_id,p.period_start,p.period_end,p.service_description,p.currency, p.amount::text AS cycle_amount,p.planned_issue_date,p.due_date,p.contract_reference,p.notes AS cycle_notes, p.state AS cycle_state,p.revision AS cycle_revision,p.created_at AS cycle_created_at,p.updated_at AS cycle_updated_at, v.legal_name,v.tax_country,v.tax_identifier,v.address_line_1,v.address_line_2,v.postal_code,v.locality, v.region,v.billing_email,v.contact_name,v.external_source,v.external_customer_ref,v.payment_terms_days,v.notes AS account_notes, p.document_id,p.document_type,p.document_number,p.issue_date,p.document_due_date,p.document_state,p.document_revision, p.adjusted_total::text AS adjusted_total,p.credit_amount::text AS credit_amount,p.debit_amount::text AS debit_amount, p.paid_amount::text AS paid_amount,p.balance_amount::text AS balance_amount,p.payment_state, (p.document_state=''ISSUED'' AND p.balance_amount>0 AND p.document_due_date<$2::date) AS overdue FROM cycle_projection p JOIN public.billing_account_version v ON v.id=p.account_version_id AND v.organization_id=p.organization_id WHERE p.id=$1';
 WHEN 'de51cf7af3f27cd43f52e1b57bae4726e37f12ff2d238bce05f9664b9d0e1481' THEN statement:='SELECT id,billing_cycle_id,organization_id,source_code,issuer_reference,document_type, document_number,external_document_id,issue_date,due_date,currency,subtotal::text AS subtotal, tax_total::text AS tax_total,total::text AS total,corrects_document_id,state,revision,created_at,updated_at FROM public.billing_fiscal_document WHERE billing_cycle_id=$1 ORDER BY issue_date,id';
 WHEN '18f18d7a9a907df04a56e911959a13c65d70d11713d9fd7855604daadd489794' THEN statement:='SELECT p.id,p.billing_document_id,p.record_type,p.reverses_payment_id,p.amount::text AS amount, p.currency,p.effective_on,p.method_code,p.external_reference,p.note,p.created_by,p.created_at FROM public.billing_payment_record p JOIN public.billing_fiscal_document d ON d.id=p.billing_document_id WHERE d.billing_cycle_id=$1 ORDER BY p.effective_on,p.created_at,p.id';
 WHEN '4b4cf9ae23791ad8888fed6369aa5bad51f749fede9f75f2811194753644bb8a' THEN statement:='SELECT a.id,a.operation_code,a.occurred_at,a.actor_id,a.event_code,a.resource_type,a.resource_id, a.previous_revision,a.new_revision,a.detail_code,a.correlation_id FROM public.billing_activity a WHERE a.organization_id=$2 AND ( (a.resource_type=''BILLING_CYCLE'' AND a.resource_id=$1) OR (a.resource_type=''BILLING_DOCUMENT'' AND EXISTS( SELECT 1 FROM public.billing_fiscal_document d WHERE d.id=a.resource_id AND d.billing_cycle_id=$1)) OR (a.resource_type=''BILLING_PAYMENT'' AND EXISTS( SELECT 1 FROM public.billing_payment_record p JOIN public.billing_fiscal_document d ON d.id=p.billing_document_id WHERE p.id=a.resource_id AND d.billing_cycle_id=$1))) ORDER BY a.occurred_at,a.id';
 WHEN '9fa6a5d0bb5b3408b92ee9e364b2b83b865085fa2d774a557f2622184532ae1a' THEN statement:='SELECT o.id AS organization_id,o.display_name AS organization_name,o.legal_name AS organization_legal_name, o.status AS organization_status,a.id AS account_id,a.current_version,a.revision AS account_revision, a.created_at AS account_created_at,a.updated_at AS account_updated_at,v.id AS account_version_id, v.version,v.legal_name,v.tax_country,v.tax_identifier,v.address_line_1,v.address_line_2,v.postal_code, v.locality,v.region,v.billing_email,v.contact_name,v.external_source,v.external_customer_ref, v.payment_terms_days,v.notes,v.created_by,v.created_at AS version_created_at FROM public.organization o LEFT JOIN public.billing_account a ON a.organization_id=o.id LEFT JOIN public.billing_account_version v ON v.billing_account_id=a.id AND v.organization_id=a.organization_id AND v.version=a.current_version WHERE o.id=$1';
 ELSE RAISE EXCEPTION 'AUTHORITY_QUERY_DENIED' USING ERRCODE='42501';
 END CASE;
 SELECT COALESCE(max((match[1])::integer),0) INTO parameter_count
 FROM regexp_matches(statement,'\$([0-9]+)','g') AS match;
 IF cardinality(parameters)<>parameter_count OR EXISTS(SELECT 1 FROM unnest(parameters) p WHERE length(p)>1048576) THEN
  RAISE EXCEPTION 'AUTHORITY_PARAMETERS_INVALID' USING ERRCODE='42501';
 END IF;
 SELECT string_agg(match[1]||CASE WHEN match[3] IS NOT NULL THEN quote_nullable(parameters[match[3]::integer]) ELSE '' END,'')
 INTO statement FROM regexp_matches(statement,'([^$]*)(\$([0-9]+)|$)','g') AS match;
 IF statement LIKE 'SELECT %' OR statement LIKE 'WITH %' THEN
  EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM ('||statement||') AS q' INTO result_rows;
  affected:=jsonb_array_length(result_rows);
 ELSIF statement LIKE '% RETURNING %' THEN
  EXECUTE 'WITH changed AS ('||statement||') SELECT COALESCE(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM changed q' INTO result_rows;
  affected:=jsonb_array_length(result_rows);
 ELSE
  EXECUTE statement; GET DIAGNOSTICS affected=ROW_COUNT; result_rows:='[]'::jsonb;
 END IF;
 RETURN jsonb_build_object('rows',result_rows,'rowCount',affected);
END
$billing_authority$;

ALTER FUNCTION authority_api.execute_platform_billing(text,text[]) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION authority_api.execute_platform_billing(text,text[]) FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime,c4g_authority_coordinator;

DO $$
DECLARE definition text;
 needle constant text := ' ELSE RAISE EXCEPTION ''AUTHORITY_QUERY_DENIED'' USING ERRCODE=''42501'';';
 replacement constant text := ' ELSE RETURN authority_api.execute_platform_billing(query_code,parameters);';
BEGIN
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN
  RAISE EXCEPTION 'AUTHORITY_EXECUTOR_PATCH_POINT_INVALID';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;

ALTER FUNCTION authority_api.execute(text,text[],text) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION authority_api.execute(text,text[],text) FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION authority_api.execute(text,text[],text) TO c4g_authority_coordinator;

CREATE FUNCTION public.billing_payment_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE document_total numeric(20,6); document_state text; document_type text;
 original_amount numeric(20,6); original_date date; already_reversed numeric(20,6); net_paid numeric(20,6);
 credited_total numeric(20,6); debited_total numeric(20,6);
BEGIN
 IF NEW.record_type='PAYMENT' THEN
  SELECT d.total,d.state,d.document_type INTO STRICT document_total,document_state,document_type
   FROM public.billing_fiscal_document d
   WHERE d.id=NEW.billing_document_id AND d.organization_id=NEW.organization_id AND d.currency=NEW.currency FOR UPDATE;
  IF document_state<>'ISSUED' OR document_type NOT IN ('INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT') THEN
   RAISE EXCEPTION 'BILLING_DOCUMENT_NOT_PAYABLE' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(CASE record_type WHEN 'PAYMENT' THEN amount ELSE -amount END),0)
   INTO net_paid FROM public.billing_payment_record
   WHERE billing_document_id=NEW.billing_document_id AND organization_id=NEW.organization_id;
  SELECT COALESCE(sum(fd.total) FILTER (WHERE fd.document_type='CREDIT_NOTE' AND fd.state<>'CANCELLED'),0),
   COALESCE(sum(fd.total) FILTER (WHERE fd.document_type='DEBIT_NOTE' AND fd.state<>'CANCELLED'),0)
   INTO credited_total,debited_total FROM public.billing_fiscal_document fd
   WHERE fd.corrects_document_id=NEW.billing_document_id AND fd.organization_id=NEW.organization_id;
  document_total:=document_total+debited_total-credited_total;
  IF net_paid+NEW.amount>document_total THEN
   RAISE EXCEPTION 'BILLING_PAYMENT_EXCEEDS_BALANCE' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT amount,effective_on INTO STRICT original_amount,original_date
   FROM public.billing_payment_record
   WHERE id=NEW.reverses_payment_id AND billing_document_id=NEW.billing_document_id
    AND organization_id=NEW.organization_id AND currency=NEW.currency AND record_type='PAYMENT' FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO already_reversed FROM public.billing_payment_record
   WHERE reverses_payment_id=NEW.reverses_payment_id AND record_type='REVERSAL';
  IF already_reversed+NEW.amount>original_amount OR NEW.effective_on<original_date THEN
   RAISE EXCEPTION 'BILLING_REVERSAL_INVALID' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.billing_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'BILLING_HISTORY_IMMUTABLE' USING ERRCODE='55000';
END $$;

CREATE FUNCTION public.billing_require_authority_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE keys text[]; old_row jsonb; new_row jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 keys:=ARRAY['ORG:'||COALESCE(new_row->>'organization_id',old_row->>'organization_id')];
 IF NOT EXISTS (
  SELECT 1 FROM public.authority_write_permit p
  JOIN public.authority_write_request r ON r.request_id=p.request_id
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
   AND p.scope_keys && keys AND r.state='WAITING' AND p.phase='APPLY'
 ) THEN RAISE EXCEPTION 'AUTHORITY_COORDINATOR_REQUIRED'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.authority_commit_guard
  WHERE scope_keys && keys AND state IN ('PREPARED','TENANT_COMMIT_UNKNOWN')
 ) THEN RAISE EXCEPTION 'AUTHORITY_GUARD_PENDING'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE TRIGGER billing_document_validate BEFORE INSERT OR UPDATE ON public.billing_fiscal_document
 FOR EACH ROW EXECUTE FUNCTION public.billing_document_validate();
CREATE TRIGGER billing_payment_validate BEFORE INSERT ON public.billing_payment_record
 FOR EACH ROW EXECUTE FUNCTION public.billing_payment_validate();

CREATE INDEX billing_cycle_organization_period ON public.billing_cycle(organization_id,period_start DESC,id DESC);
CREATE INDEX billing_cycle_state_due ON public.billing_cycle(state,due_date,id);
CREATE INDEX billing_document_cycle ON public.billing_fiscal_document(billing_cycle_id,issue_date DESC,id DESC);
CREATE INDEX billing_document_due ON public.billing_fiscal_document(due_date,id) WHERE state='ISSUED';
CREATE INDEX billing_payment_document ON public.billing_payment_record(billing_document_id,created_at,id);
CREATE INDEX billing_activity_resource ON public.billing_activity(organization_id,resource_type,resource_id,occurred_at,id);

DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY[
  'billing_account','billing_account_version','billing_cycle','billing_cycle_revision',
  'billing_fiscal_document','billing_fiscal_document_revision','billing_payment_record',
  'billing_activity','billing_command_receipt'
 ] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO c4g_authority_owner',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO c4g_central_runtime',tab);
  EXECUTE format('CREATE TRIGGER authority_first_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.authority_metadata_lock()',tab);
  EXECUTE format('CREATE TRIGGER authority_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.billing_require_authority_write()',tab);
  EXECUTE format('CREATE CONSTRAINT TRIGGER authority_effect_commit_guard AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.authority_effect_commit_guard()',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY[
  'billing_account_version','billing_cycle_revision','billing_fiscal_document_revision',
  'billing_payment_record','billing_activity','billing_command_receipt'
 ] LOOP
  EXECUTE format('CREATE TRIGGER zz_billing_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.billing_immutable()',tab);
 END LOOP;
END $$;

-- Billing projections enrich rows with a deliberately narrow slice of the
-- organization directory. The central runtime receives only those columns;
-- runtime writes and all remaining organization fields stay denied.
GRANT SELECT(id,display_name,legal_name,status) ON public.organization TO c4g_central_runtime;

ALTER FUNCTION public.billing_document_validate() OWNER TO c4g_authority_owner;
ALTER FUNCTION public.billing_payment_validate() OWNER TO c4g_authority_owner;
ALTER FUNCTION public.billing_immutable() OWNER TO c4g_authority_owner;
ALTER FUNCTION public.billing_require_authority_write() OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.billing_document_validate() FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
REVOKE ALL ON FUNCTION public.billing_payment_validate() FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
REVOKE ALL ON FUNCTION public.billing_immutable() FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
REVOKE ALL ON FUNCTION public.billing_require_authority_write() FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;

DO $$
DECLARE tab text; name text; definition text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint
   WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format(
   'ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''PLATFORM_BILLING_ACCOUNT_CHANGED'',''PLATFORM_BILLING_CYCLE_CHANGED'',''PLATFORM_BILLING_DOCUMENT_RECORDED'',''PLATFORM_BILLING_DOCUMENT_CHANGED'',''PLATFORM_BILLING_PAYMENT_RECORDED'',''PLATFORM_BILLING_PAYMENT_REVERSED''))',
   tab,name,substring(definition from 8 for length(definition)-8)
  );
 END LOOP;
END $$;

ALTER TABLE audit.event DROP CONSTRAINT funding_platform_audit;
ALTER TABLE audit.event ADD CONSTRAINT funding_platform_audit CHECK(
 organization_id IS NOT NULL OR (
  ledger_location='CENTRAL' AND tenant_id IS NULL
  AND event_data->>'operationCode' IN ('OPPORTUNITY_CENTRAL_MANAGE','PLATFORM_ONBOARDING','PLATFORM_BILLING')
 )
);

DO $$
DECLARE definition text;
 needle constant text := 'COALESCE(p_event_data->>''operationCode'','''') NOT IN (''OPPORTUNITY_CENTRAL_MANAGE'',''PLATFORM_ONBOARDING'')';
 replacement constant text := 'COALESCE(p_event_data->>''operationCode'','''') NOT IN (''OPPORTUNITY_CENTRAL_MANAGE'',''PLATFORM_ONBOARDING'',''PLATFORM_BILLING'')';
BEGIN
 SELECT pg_get_functiondef('audit.append_platform_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text,text,text,jsonb)'::regprocedure)
 INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN
  RAISE EXCEPTION 'PLATFORM_AUDIT_PATCH_POINT_INVALID';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
