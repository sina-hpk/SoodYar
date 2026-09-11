-- Additive migration for automatic market-price refresh.
-- Adds two nullable columns to Asset so an asset can pin a live quote key and
-- record when auto-refresh last wrote a price. Existing rows keep NULL, so no
-- data is rewritten and the migration is safe to run on a populated database.
--
-- Operator command (run only after reviewing, and on a copy first):
--   cd server
--   npx prisma db execute --url "file:./prisma/dev.db" \
--     --file prisma/migrations/20260910120000_add_asset_market_key/migration.sql
-- (Do NOT use `prisma db push` / `prisma migrate` against the live DB.)

ALTER TABLE "Asset" ADD COLUMN "marketKey" TEXT;
ALTER TABLE "Asset" ADD COLUMN "lastAutoPriceAt" DATETIME;
