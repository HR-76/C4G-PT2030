'use strict';

// Closed SQL of the email template API (Central 051). The runtime role only reads
// the version tables and calls the write function. Who may write, which version
// comes next and who the author is are decided inside the database function.

const admin = 'SELECT public.email_platform_admin($1,$2) AS allowed';
const recipient = "SELECT primary_email FROM public.global_user WHERE id=$1 AND status='ACTIVE'";

const organization = "SELECT id, display_name FROM public.organization WHERE id=$1 AND status='ACTIVE'";

// The current row of one scope: the highest version, which may be a RESET.
const latest = `SELECT v.version, v.action, v.subject, v.html, v.created_at, u.primary_email AS author
  FROM public.email_template_version v JOIN public.global_user u ON u.id=v.created_by
  WHERE v.template_type=$1 AND v.organization_id IS NOT DISTINCT FROM $2
  ORDER BY v.version DESC LIMIT 1`;

const summary = `SELECT
  COALESCE((SELECT v.action='SAVE' FROM public.email_template_version v
    WHERE v.template_type=$1 AND v.organization_id IS NULL ORDER BY v.version DESC LIMIT 1), false) AS global_customized,
  (SELECT count(*)::int FROM (SELECT DISTINCT ON (v.organization_id) v.action FROM public.email_template_version v
    WHERE v.template_type=$1 AND v.organization_id IS NOT NULL
    ORDER BY v.organization_id, v.version DESC) own WHERE own.action='SAVE') AS organizations`;

const write = 'SELECT * FROM public.email_template_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';

// Logos (increment 5). The image bytes are read only by the public route, by its unguessable name.
const organizationAdmin = 'SELECT public.email_organization_admin($1,$2,$3) AS allowed';

// The current row of one logo scope ($1 NULL is the C4G logo): the highest version, which may be a REMOVE.
const latestLogo = `SELECT v.version, v.action, v.public_id, v.created_at
  FROM public.email_logo_version v
  WHERE v.organization_id IS NOT DISTINCT FROM $1
  ORDER BY v.version DESC LIMIT 1`;

const logoWrite = 'SELECT version, action, public_id FROM public.email_logo_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';

const publicLogo = 'SELECT mime_type, content FROM public.email_logo_version WHERE public_id=$1';

module.exports = Object.freeze({ admin, recipient, organization, latest, summary, write, organizationAdmin, latestLogo, logoWrite, publicLogo });
