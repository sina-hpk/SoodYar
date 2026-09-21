-- Additive migration: per-asset opt-out of automatic pricing.
-- Existing rows default to enabled, so behaviour is unchanged until the owner
-- switches an asset to manual. No data is rewritten.
--
-- Operator command (review first, ideally on a copy):
--   cd server
--   npx prisma db execute --url "file:./prisma/dev.db" \
--     --file prisma/migrations/20260911150000_add_asset_auto_price_enabled/migration.sql

ALTER TABLE "Asset" ADD COLUMN "autoPriceEnabled" BOOLEAN NOT NULL DEFAULT true;
