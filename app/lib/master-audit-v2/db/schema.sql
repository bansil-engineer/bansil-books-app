-- Phase 1 internal source-version foundation. No commercial computation or sync runner.
-- Execute only through the explicit in-memory factory (decimal validator required).
CREATE TABLE v2_schema_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1)
) STRICT;
INSERT INTO v2_schema_meta VALUES(1,1);
CREATE TABLE organizations (
 organization_id TEXT PRIMARY KEY CHECK(length(trim(organization_id))>0)
) STRICT;
CREATE TABLE financial_years (
 organization_id TEXT NOT NULL, fy_id TEXT NOT NULL,
 date_from TEXT NOT NULL, date_to TEXT NOT NULL,
 PRIMARY KEY(organization_id,fy_id),
 FOREIGN KEY(organization_id) REFERENCES organizations(organization_id),
 CHECK(date_from GLOB '[0-9][0-9][0-9][0-9]-04-01' AND date(date_from)=date_from),
 CHECK(date(date_from,'+1 year','-1 day') IS NOT NULL AND date_to=date(date_from,'+1 year','-1 day'))
) STRICT;
CREATE TABLE source_documents (
 organization_id TEXT NOT NULL, document_id TEXT NOT NULL,
 document_type TEXT NOT NULL CHECK(document_type IN ('SO','PO','INVOICE','BILL','CREDIT_NOTE','VENDOR_CREDIT','CUSTOMER_PAYMENT','VENDOR_PAYMENT','STOCK_ADJUSTMENT','ASSEMBLY')),
 remote_id TEXT NOT NULL CHECK(length(trim(remote_id))>0),
 PRIMARY KEY(organization_id,document_id),
 UNIQUE(organization_id,document_type,remote_id),
 FOREIGN KEY(organization_id) REFERENCES organizations(organization_id)
) STRICT;
CREATE TABLE document_versions (
 organization_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL,
 version_number INTEGER NOT NULL CHECK(version_number>0), fy_id TEXT NOT NULL,
 document_date TEXT NOT NULL CHECK(length(document_date)=10 AND date(document_date) IS NOT NULL AND date(document_date)=document_date),
 source_revision TEXT, observed_at TEXT NOT NULL CHECK(length(trim(observed_at))>0),
 raw_payload TEXT NOT NULL CHECK(json_valid(raw_payload)),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
 expected_line_count INTEGER NOT NULL CHECK(expected_line_count>=0),
 PRIMARY KEY(organization_id,document_id,version_id),
 UNIQUE(organization_id,document_id,version_number),
 FOREIGN KEY(organization_id,document_id) REFERENCES source_documents(organization_id,document_id),
 FOREIGN KEY(organization_id,fy_id) REFERENCES financial_years(organization_id,fy_id)
) STRICT;
CREATE TRIGGER version_fy BEFORE INSERT ON document_versions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM financial_years f WHERE f.organization_id=NEW.organization_id AND f.fy_id=NEW.fy_id AND NEW.document_date BETWEEN f.date_from AND f.date_to)
 THEN RAISE(ABORT,'DOCUMENT_OUTSIDE_FY') END;
END;
CREATE TABLE document_version_lines (
 organization_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL,
 line_id TEXT NOT NULL CHECK(length(trim(line_id))>0), item_id TEXT, unit TEXT,
 quantity TEXT, quantity_scale INTEGER, quantity_missing_reason TEXT,
 amount TEXT, amount_scale INTEGER, amount_missing_reason TEXT,
 PRIMARY KEY(organization_id,document_id,version_id,line_id),
 FOREIGN KEY(organization_id,document_id,version_id) REFERENCES document_versions(organization_id,document_id,version_id),
 CHECK((quantity IS NULL AND quantity_scale IS NULL AND length(trim(quantity_missing_reason))>0 AND quantity_missing_reason IS NOT NULL)
 OR (quantity IS NOT NULL AND quantity_scale IS NOT NULL AND quantity_missing_reason IS NULL AND v2_decimal_valid(quantity,quantity_scale)=1)),
 CHECK((amount IS NULL AND amount_scale IS NULL AND length(trim(amount_missing_reason))>0 AND amount_missing_reason IS NOT NULL)
 OR (amount IS NOT NULL AND amount_scale IS NOT NULL AND amount_missing_reason IS NULL AND v2_decimal_valid(amount,amount_scale)=1))
) STRICT;
-- A seal means the acquisition adapter validated completeness, including endpoint-specific
-- requirements. SQL additionally checks line count; it cannot prove remote truth.
CREATE TABLE version_seals (
 organization_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL,
 validation_rule_version TEXT NOT NULL CHECK(length(trim(validation_rule_version))>0),
 evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference))>0),
 sealed_at TEXT NOT NULL CHECK(length(trim(sealed_at))>0),
 PRIMARY KEY(organization_id,document_id,version_id),
 FOREIGN KEY(organization_id,document_id,version_id) REFERENCES document_versions(organization_id,document_id,version_id)
) STRICT;
CREATE TRIGGER seal_count BEFORE INSERT ON version_seals BEGIN
 SELECT CASE WHEN (SELECT expected_line_count FROM document_versions WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND version_id=NEW.version_id)
 != (SELECT count(*) FROM document_version_lines WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND version_id=NEW.version_id)
 THEN RAISE(ABORT,'INCOMPLETE_LINES') END;
END;
CREATE TRIGGER sealed_lines BEFORE INSERT ON document_version_lines BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM version_seals WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND version_id=NEW.version_id)
 THEN RAISE(ABORT,'VERSION_SEALED') END;
END;
CREATE TABLE document_current (
 organization_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,document_id),
 FOREIGN KEY(organization_id,document_id,version_id) REFERENCES version_seals(organization_id,document_id,version_id)
) STRICT;
CREATE TRIGGER current_identity BEFORE UPDATE ON document_current WHEN NEW.organization_id!=OLD.organization_id OR NEW.document_id!=OLD.document_id BEGIN
 SELECT RAISE(ABORT,'CURRENT_IDENTITY_IMMUTABLE');
END;
CREATE TRIGGER current_forward BEFORE UPDATE ON document_current BEGIN
 SELECT CASE WHEN (SELECT version_number FROM document_versions WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND version_id=NEW.version_id)
 < (SELECT version_number FROM document_versions WHERE organization_id=OLD.organization_id AND document_id=OLD.document_id AND version_id=OLD.version_id)
 THEN RAISE(ABORT,'VERSION_REGRESSION') END;
END;
CREATE TRIGGER current_no_replace BEFORE INSERT ON document_current WHEN EXISTS(SELECT 1 FROM document_current WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id) BEGIN
 SELECT RAISE(ABORT,'USE_EXPLICIT_PROMOTION');
END;
CREATE TRIGGER current_no_delete BEFORE DELETE ON document_current BEGIN SELECT RAISE(ABORT,'CURRENT_DELETE_FORBIDDEN'); END;
CREATE TABLE audit_events (
 organization_id TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL,
 occurred_at TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 PRIMARY KEY(organization_id,event_id),
 FOREIGN KEY(organization_id) REFERENCES organizations(organization_id)
) STRICT;
CREATE TRIGGER organizations_no_update BEFORE UPDATE ON organizations BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER organizations_no_delete BEFORE DELETE ON organizations BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER organizations_no_replace BEFORE INSERT ON organizations WHEN EXISTS(SELECT 1 FROM organizations WHERE organization_id=NEW.organization_id) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER financial_years_no_update BEFORE UPDATE ON financial_years BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER financial_years_no_delete BEFORE DELETE ON financial_years BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER financial_years_no_replace BEFORE INSERT ON financial_years WHEN EXISTS(SELECT 1 FROM financial_years WHERE organization_id=NEW.organization_id AND fy_id=NEW.fy_id) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER source_documents_no_update BEFORE UPDATE ON source_documents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER source_documents_no_delete BEFORE DELETE ON source_documents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER source_documents_no_replace BEFORE INSERT ON source_documents WHEN EXISTS(SELECT 1 FROM source_documents WHERE organization_id=NEW.organization_id AND (document_id=NEW.document_id OR (document_type=NEW.document_type AND remote_id=NEW.remote_id))) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER document_versions_no_update BEFORE UPDATE ON document_versions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER document_versions_no_delete BEFORE DELETE ON document_versions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER document_versions_no_replace BEFORE INSERT ON document_versions WHEN EXISTS(SELECT 1 FROM document_versions WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND (version_id=NEW.version_id OR version_number=NEW.version_number)) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER document_version_lines_no_update BEFORE UPDATE ON document_version_lines BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER document_version_lines_no_delete BEFORE DELETE ON document_version_lines BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER document_version_lines_no_replace BEFORE INSERT ON document_version_lines WHEN EXISTS(SELECT 1 FROM document_version_lines WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND version_id=NEW.version_id AND line_id=NEW.line_id) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER version_seals_no_update BEFORE UPDATE ON version_seals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER version_seals_no_delete BEFORE DELETE ON version_seals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER version_seals_no_replace BEFORE INSERT ON version_seals WHEN EXISTS(SELECT 1 FROM version_seals WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER audit_events_no_replace BEFORE INSERT ON audit_events WHEN EXISTS(SELECT 1 FROM audit_events WHERE organization_id=NEW.organization_id AND event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER v2_schema_meta_no_update BEFORE UPDATE ON v2_schema_meta BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER v2_schema_meta_no_delete BEFORE DELETE ON v2_schema_meta BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER v2_schema_meta_no_replace BEFORE INSERT ON v2_schema_meta WHEN EXISTS(SELECT 1 FROM v2_schema_meta WHERE singleton=NEW.singleton) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
