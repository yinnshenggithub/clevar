-- WhatsApp Coexistence: existing WhatsApp Business app numbers linked via Meta
-- Embedded Signup share the whatsapp_channels table with manually-configured
-- Cloud API numbers. No RLS change — whatsapp_channels is control-plane.

ALTER TABLE "whatsapp_channels"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'cloud',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN "display_phone_number" TEXT;
