SET ROLE c4g_opportunity_tenant_owner;

-- Assignment metadata is written atomically to the immutable review receipt.
-- Historical receipts lack this key and remain outside both indexes.
CREATE UNIQUE INDEX application_document_receipt_assigned_request
 ON opportunity_catalog.application_document_receipt
 (organization_id, resource_id, (result_projection ->> 'requestId'))
 WHERE result_projection ? 'reviewerMembershipId';

CREATE INDEX application_document_receipt_by_reviewer
 ON opportunity_catalog.application_document_receipt
 (organization_id, (result_projection ->> 'reviewerMembershipId'), (result_projection ->> 'requestId'))
 WHERE result_projection ? 'reviewerMembershipId';

RESET ROLE;
