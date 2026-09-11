-- Safe additive migration: only creates independent benchmark tables/indexes.
-- Do not apply automatically to an existing database; review and run on a copy first.
CREATE TABLE "BenchmarkInstrument" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BenchmarkPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentKey" TEXT NOT NULL,
    "priceRial" BIGINT NOT NULL,
    "priceDate" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "ingestMethod" TEXT NOT NULL,
    "ingestBatchId" TEXT,
    "qualityStatus" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "marketDateConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BenchmarkPrice_instrumentKey_fkey"
        FOREIGN KEY ("instrumentKey") REFERENCES "BenchmarkInstrument" ("key")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BenchmarkInstrument_marketKey_key"
    ON "BenchmarkInstrument"("marketKey");
CREATE INDEX "BenchmarkInstrument_isActive_idx"
    ON "BenchmarkInstrument"("isActive");
CREATE UNIQUE INDEX "BenchmarkPrice_instrumentKey_priceDate_key"
    ON "BenchmarkPrice"("instrumentKey", "priceDate");
CREATE INDEX "BenchmarkPrice_priceDate_idx"
    ON "BenchmarkPrice"("priceDate");
CREATE INDEX "BenchmarkPrice_qualityStatus_idx"
    ON "BenchmarkPrice"("qualityStatus");
CREATE INDEX "BenchmarkPrice_instrumentKey_qualityStatus_priceDate_idx"
    ON "BenchmarkPrice"("instrumentKey", "qualityStatus", "priceDate");
