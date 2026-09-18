-- Radx IT Help Desk — initial schema
-- PostgreSQL 14+ (developed and tested against 16).

-- ===========================================================================
-- Enums
-- ===========================================================================
CREATE TYPE "Role" AS ENUM ('staff', 'agent', 'admin');
CREATE TYPE "AssetCategory" AS ENUM ('laptop', 'desktop', 'phone', 'printer', 'monitor', 'clocking', 'starlink', 'other', 'computer');
CREATE TYPE "AssetStatus" AS ENUM ('active', 'faulty', 'repair', 'retired', 'spare', 'return_pending', 'stolen');
CREATE TYPE "CheckinSource" AS ENUM ('agent', 'manual');
CREATE TYPE "AssetDocumentType" AS ENUM ('policy', 'allocation', 'other');
CREATE TYPE "StaffGroup" AS ENUM ('staff', 'management', 'consultant');
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'waiting', 'resolved', 'closed');
CREATE TYPE "TicketPriority" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "NotificationKind" AS ENUM ('submitted', 'update', 'assigned', 'reply', 'equipment', 'password_reset', 'other');
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE "EquipmentStatus" AS ENUM ('submitted', 'review', 'approved', 'declined', 'ordered', 'issued', 'hold');
CREATE TYPE "EquipmentPriority" AS ENUM ('normal', 'urgent');

-- ===========================================================================
-- Accounts
-- ===========================================================================
CREATE TABLE "auth_user" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL DEFAULT '',
    "last_name" TEXT NOT NULL DEFAULT '',
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "is_superuser" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_user_username_key" ON "auth_user"("username");
CREATE UNIQUE INDEX "auth_user_email_key" ON "auth_user"("email");
CREATE INDEX "auth_user_is_active_idx" ON "auth_user"("is_active");

CREATE TABLE "accounts_userprofile" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'staff',
    "site" TEXT NOT NULL DEFAULT 'ZW',
    "department" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "accounts_userprofile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounts_userprofile_user_id_key" ON "accounts_userprofile"("user_id");
CREATE INDEX "accounts_userprofile_role_idx" ON "accounts_userprofile"("role");

CREATE TABLE "accounts_session" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "accounts_session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounts_session_token_hash_key" ON "accounts_session"("token_hash");
CREATE INDEX "accounts_session_user_id_idx" ON "accounts_session"("user_id");
CREATE INDEX "accounts_session_expires_at_idx" ON "accounts_session"("expires_at");

CREATE TABLE "accounts_passwordresettoken" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    CONSTRAINT "accounts_passwordresettoken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounts_passwordresettoken_token_hash_key" ON "accounts_passwordresettoken"("token_hash");
CREATE INDEX "accounts_passwordresettoken_user_id_idx" ON "accounts_passwordresettoken"("user_id");
CREATE INDEX "accounts_passwordresettoken_expires_at_idx" ON "accounts_passwordresettoken"("expires_at");

CREATE TABLE "core_auditlog" (
    "id" BIGSERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "actor_id" INTEGER,
    "actor_repr" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL DEFAULT '',
    "target_id" TEXT NOT NULL DEFAULT '',
    "ip_address" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "core_auditlog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "core_auditlog_event_created_at_idx" ON "core_auditlog"("event", "created_at");
CREATE INDEX "core_auditlog_actor_id_idx" ON "core_auditlog"("actor_id");
CREATE INDEX "core_auditlog_target_target_id_idx" ON "core_auditlog"("target", "target_id");

-- ===========================================================================
-- Lookup tables
-- ===========================================================================
CREATE TABLE "core_country" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "core_country_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "core_country_code_key" ON "core_country"("code");
CREATE INDEX "core_country_is_active_sort_order_idx" ON "core_country"("is_active", "sort_order");

CREATE TABLE "core_site" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "site_country" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "core_site_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "core_site_name_site_country_key" ON "core_site"("name", "site_country");
CREATE INDEX "core_site_site_country_is_active_idx" ON "core_site"("site_country", "is_active");
CREATE INDEX "core_site_code_idx" ON "core_site"("code");

CREATE TABLE "tickets_ticketcategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tickets_ticketcategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tickets_ticketcategory_slug_key" ON "tickets_ticketcategory"("slug");
CREATE INDEX "tickets_ticketcategory_is_active_sort_order_idx" ON "tickets_ticketcategory"("is_active", "sort_order");

CREATE TABLE "equipment_itemtype" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "equipment_itemtype_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "equipment_itemtype_slug_key" ON "equipment_itemtype"("slug");
CREATE INDEX "equipment_itemtype_is_active_sort_order_idx" ON "equipment_itemtype"("is_active", "sort_order");

-- ===========================================================================
-- Employees
-- ===========================================================================
CREATE TABLE "core_employee" (
    "id" SERIAL NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "job_title" TEXT NOT NULL DEFAULT '',
    "site" TEXT NOT NULL DEFAULT 'ZW',
    "employee_number" TEXT,
    "user_id" INTEGER,
    "staff_group" "StaffGroup" NOT NULL DEFAULT 'staff',
    "alt_email" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "email_password_enc" TEXT,
    "email_password_set_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" INTEGER,
    CONSTRAINT "core_employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "core_employee_email_key" ON "core_employee"("email");
CREATE UNIQUE INDEX "core_employee_employee_number_key" ON "core_employee"("employee_number");
CREATE UNIQUE INDEX "core_employee_user_id_key" ON "core_employee"("user_id");
CREATE INDEX "core_employee_is_deleted_is_active_idx" ON "core_employee"("is_deleted", "is_active");
CREATE INDEX "core_employee_site_idx" ON "core_employee"("site");
CREATE INDEX "core_employee_department_idx" ON "core_employee"("department");
CREATE INDEX "core_employee_staff_group_idx" ON "core_employee"("staff_group");
CREATE INDEX "core_employee_full_name_idx" ON "core_employee"("full_name");

-- ===========================================================================
-- Assets
-- ===========================================================================
CREATE TABLE "core_asset" (
    "id" SERIAL NOT NULL,
    "asset_tag" TEXT,
    "category" "AssetCategory" NOT NULL DEFAULT 'laptop',
    "brand" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "serial_number" TEXT NOT NULL DEFAULT '',
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "assigned_employee_id" INTEGER,
    "assigned_site_id" INTEGER,
    "assigned_to_name" TEXT NOT NULL DEFAULT '',
    "assigned_to_user_id" INTEGER,
    "department" TEXT NOT NULL DEFAULT '',
    "site" TEXT NOT NULL DEFAULT 'ZW',
    "location" TEXT NOT NULL DEFAULT '',
    "mac_address" TEXT NOT NULL DEFAULT '',
    "os_version" TEXT NOT NULL DEFAULT '',
    "office_version" TEXT NOT NULL DEFAULT '',
    "laptop_or_desktop" TEXT NOT NULL DEFAULT '',
    "imei_1" TEXT NOT NULL DEFAULT '',
    "imei_2" TEXT NOT NULL DEFAULT '',
    "cell_number" TEXT NOT NULL DEFAULT '',
    "package" TEXT NOT NULL DEFAULT '',
    "printer_type" TEXT NOT NULL DEFAULT '',
    "toner_type" TEXT NOT NULL DEFAULT '',
    "ip_address" TEXT NOT NULL DEFAULT '',
    "area_code" TEXT NOT NULL DEFAULT '',
    "device_key_hash" TEXT,
    "device_key_prefix" TEXT,
    "device_key_set_at" TIMESTAMP(3),
    "tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3),
    "last_seen_location" TEXT NOT NULL DEFAULT '',
    "acquisition_date" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" INTEGER,
    CONSTRAINT "core_asset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "core_asset_asset_tag_key" ON "core_asset"("asset_tag");
CREATE INDEX "core_asset_is_deleted_status_idx" ON "core_asset"("is_deleted", "status");
CREATE INDEX "core_asset_is_deleted_category_idx" ON "core_asset"("is_deleted", "category");
CREATE INDEX "core_asset_site_idx" ON "core_asset"("site");
CREATE INDEX "core_asset_location_idx" ON "core_asset"("location");
CREATE INDEX "core_asset_assigned_employee_id_idx" ON "core_asset"("assigned_employee_id");
CREATE INDEX "core_asset_assigned_site_id_idx" ON "core_asset"("assigned_site_id");
CREATE INDEX "core_asset_serial_number_idx" ON "core_asset"("serial_number");
CREATE INDEX "core_asset_device_key_prefix_idx" ON "core_asset"("device_key_prefix");
CREATE INDEX "core_asset_brand_model_idx" ON "core_asset"("brand", "model");

-- Spec §3.4: assignment is mutually exclusive — a person OR a site, never both.
-- Enforced in the database as well as in assetService.normaliseAssignment().
ALTER TABLE "core_asset"
    ADD CONSTRAINT "core_asset_assignment_exclusive"
    CHECK ("assigned_employee_id" IS NULL OR "assigned_site_id" IS NULL);

-- Spec note 6: an empty asset tag must be NULL, never ''. Belt and braces
-- alongside the service-layer normalisation, so a stray SQL import cannot
-- create two ''-tagged assets that then collide with each other.
ALTER TABLE "core_asset"
    ADD CONSTRAINT "core_asset_asset_tag_not_blank"
    CHECK ("asset_tag" IS NULL OR length(btrim("asset_tag")) > 0);

CREATE TABLE "core_devicecheckin" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" INTEGER NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "CheckinSource" NOT NULL DEFAULT 'agent',
    "hostname" TEXT NOT NULL DEFAULT '',
    "logged_in_user" TEXT NOT NULL DEFAULT '',
    "wifi_ssid" TEXT NOT NULL DEFAULT '',
    "public_ip" TEXT,
    "geo_city" TEXT NOT NULL DEFAULT '',
    "geo_region" TEXT NOT NULL DEFAULT '',
    "geo_country" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gps_accuracy_m" DOUBLE PRECISION,
    "agent_version" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "core_devicecheckin_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "core_devicecheckin_asset_id_reported_at_idx" ON "core_devicecheckin"("asset_id", "reported_at");

CREATE TABLE "core_assetdocument" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" INTEGER NOT NULL,
    "document_type" "AssetDocumentType" NOT NULL DEFAULT 'other',
    "storage_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" INTEGER,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "core_assetdocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "core_assetdocument_asset_id_idx" ON "core_assetdocument"("asset_id");

-- ===========================================================================
-- Tickets
-- ===========================================================================
CREATE TABLE "tickets_ticket" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "priority" "TicketPriority" NOT NULL DEFAULT 'medium',
    "category" TEXT NOT NULL DEFAULT 'other',
    "device_type" TEXT NOT NULL DEFAULT '',
    "anydesk_id" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'ZW',
    "site_name" TEXT NOT NULL DEFAULT '',
    "asset_number" TEXT NOT NULL DEFAULT '',
    "submitter_name" TEXT NOT NULL DEFAULT '',
    "submitter_email" TEXT NOT NULL DEFAULT '',
    "send_copy" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" INTEGER,
    "submitted_publicly" BOOLEAN NOT NULL DEFAULT false,
    "assigned_to_id" INTEGER,
    "employee_id" INTEGER,
    "asset_id" INTEGER,
    "site" TEXT NOT NULL DEFAULT '',
    "due_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" INTEGER,
    CONSTRAINT "tickets_ticket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tickets_ticket_is_deleted_status_idx" ON "tickets_ticket"("is_deleted", "status");
CREATE INDEX "tickets_ticket_is_deleted_priority_idx" ON "tickets_ticket"("is_deleted", "priority");
CREATE INDEX "tickets_ticket_is_deleted_created_at_idx" ON "tickets_ticket"("is_deleted", "created_at");
CREATE INDEX "tickets_ticket_category_idx" ON "tickets_ticket"("category");
CREATE INDEX "tickets_ticket_country_idx" ON "tickets_ticket"("country");
CREATE INDEX "tickets_ticket_assigned_to_id_idx" ON "tickets_ticket"("assigned_to_id");
CREATE INDEX "tickets_ticket_created_by_id_idx" ON "tickets_ticket"("created_by_id");
CREATE INDEX "tickets_ticket_employee_id_idx" ON "tickets_ticket"("employee_id");
CREATE INDEX "tickets_ticket_asset_id_idx" ON "tickets_ticket"("asset_id");
CREATE INDEX "tickets_ticket_due_date_idx" ON "tickets_ticket"("due_date");
CREATE INDEX "tickets_ticket_submitter_email_idx" ON "tickets_ticket"("submitter_email");

CREATE TABLE "tickets_ticketattachment" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" INTEGER,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tickets_ticketattachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tickets_ticketattachment_ticket_id_idx" ON "tickets_ticketattachment"("ticket_id");

CREATE TABLE "tickets_comment" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "author_id" INTEGER,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tickets_comment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tickets_comment_ticket_id_created_at_idx" ON "tickets_comment"("ticket_id", "created_at");

CREATE TABLE "tickets_notification" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" INTEGER,
    "kind" "NotificationKind" NOT NULL DEFAULT 'other',
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_ids" TEXT NOT NULL DEFAULT '',
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    CONSTRAINT "tickets_notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tickets_notification_status_created_at_idx" ON "tickets_notification"("status", "created_at");
CREATE INDEX "tickets_notification_ticket_id_idx" ON "tickets_notification"("ticket_id");

-- ===========================================================================
-- Equipment requests
-- ===========================================================================
CREATE TABLE "equipment_request" (
    "id" SERIAL NOT NULL,
    "requester_name" TEXT NOT NULL,
    "requester_email" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'ZW',
    "site_name" TEXT NOT NULL DEFAULT '',
    "site_code" TEXT NOT NULL DEFAULT '',
    "employee_id" INTEGER,
    "site_id" INTEGER,
    "other_equipment" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "justification" TEXT NOT NULL DEFAULT '',
    "priority" "EquipmentPriority" NOT NULL DEFAULT 'normal',
    "send_copy" BOOLEAN NOT NULL DEFAULT false,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'submitted',
    "decided_by_id" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" INTEGER,
    CONSTRAINT "equipment_request_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "equipment_request_is_deleted_status_idx" ON "equipment_request"("is_deleted", "status");
CREATE INDEX "equipment_request_is_deleted_created_at_idx" ON "equipment_request"("is_deleted", "created_at");
CREATE INDEX "equipment_request_country_idx" ON "equipment_request"("country");
CREATE INDEX "equipment_request_requester_email_idx" ON "equipment_request"("requester_email");
CREATE INDEX "equipment_request_employee_id_idx" ON "equipment_request"("employee_id");

CREATE TABLE "equipment_requesteditem" (
    "id" BIGSERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "equipment_requesteditem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "equipment_requesteditem_request_id_item_key" ON "equipment_requesteditem"("request_id", "item");
CREATE INDEX "equipment_requesteditem_request_id_idx" ON "equipment_requesteditem"("request_id");
ALTER TABLE "equipment_requesteditem"
    ADD CONSTRAINT "equipment_requesteditem_quantity_positive" CHECK ("quantity" > 0);

CREATE TABLE "equipment_statusevent" (
    "id" BIGSERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "from_status" "EquipmentStatus" NOT NULL,
    "to_status" "EquipmentStatus" NOT NULL,
    "actor_id" INTEGER,
    "actor_repr" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "equipment_statusevent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "equipment_statusevent_request_id_created_at_idx" ON "equipment_statusevent"("request_id", "created_at");

-- ===========================================================================
-- Implicit many-to-many join tables
-- ===========================================================================
CREATE TABLE "_TicketRelatedAssets" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "_TicketRelatedAssets_AB_unique" ON "_TicketRelatedAssets"("A", "B");
CREATE INDEX "_TicketRelatedAssets_B_index" ON "_TicketRelatedAssets"("B");

CREATE TABLE "_EquipmentIssuedAssets" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "_EquipmentIssuedAssets_AB_unique" ON "_EquipmentIssuedAssets"("A", "B");
CREATE INDEX "_EquipmentIssuedAssets_B_index" ON "_EquipmentIssuedAssets"("B");

-- ===========================================================================
-- Foreign keys
-- ===========================================================================
ALTER TABLE "accounts_userprofile" ADD CONSTRAINT "accounts_userprofile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts_session" ADD CONSTRAINT "accounts_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts_passwordresettoken" ADD CONSTRAINT "accounts_passwordresettoken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "core_auditlog" ADD CONSTRAINT "core_auditlog_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "core_employee" ADD CONSTRAINT "core_employee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "core_employee" ADD CONSTRAINT "core_employee_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "core_asset" ADD CONSTRAINT "core_asset_assigned_employee_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "core_employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "core_asset" ADD CONSTRAINT "core_asset_assigned_site_id_fkey" FOREIGN KEY ("assigned_site_id") REFERENCES "core_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "core_asset" ADD CONSTRAINT "core_asset_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "core_asset" ADD CONSTRAINT "core_asset_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "core_devicecheckin" ADD CONSTRAINT "core_devicecheckin_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "core_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "core_assetdocument" ADD CONSTRAINT "core_assetdocument_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "core_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "core_assetdocument" ADD CONSTRAINT "core_assetdocument_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets_ticket" ADD CONSTRAINT "tickets_ticket_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets_ticket" ADD CONSTRAINT "tickets_ticket_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets_ticket" ADD CONSTRAINT "tickets_ticket_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets_ticket" ADD CONSTRAINT "tickets_ticket_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "core_employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets_ticket" ADD CONSTRAINT "tickets_ticket_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "core_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets_ticketattachment" ADD CONSTRAINT "tickets_ticketattachment_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets_ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets_ticketattachment" ADD CONSTRAINT "tickets_ticketattachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets_comment" ADD CONSTRAINT "tickets_comment_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets_ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets_comment" ADD CONSTRAINT "tickets_comment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets_notification" ADD CONSTRAINT "tickets_notification_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets_ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "equipment_request" ADD CONSTRAINT "equipment_request_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "core_employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "equipment_request" ADD CONSTRAINT "equipment_request_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "core_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "equipment_request" ADD CONSTRAINT "equipment_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "equipment_request" ADD CONSTRAINT "equipment_request_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "equipment_requesteditem" ADD CONSTRAINT "equipment_requesteditem_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "equipment_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equipment_statusevent" ADD CONSTRAINT "equipment_statusevent_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "equipment_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_TicketRelatedAssets" ADD CONSTRAINT "_TicketRelatedAssets_A_fkey" FOREIGN KEY ("A") REFERENCES "core_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TicketRelatedAssets" ADD CONSTRAINT "_TicketRelatedAssets_B_fkey" FOREIGN KEY ("B") REFERENCES "tickets_ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_EquipmentIssuedAssets" ADD CONSTRAINT "_EquipmentIssuedAssets_A_fkey" FOREIGN KEY ("A") REFERENCES "core_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_EquipmentIssuedAssets" ADD CONSTRAINT "_EquipmentIssuedAssets_B_fkey" FOREIGN KEY ("B") REFERENCES "equipment_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
