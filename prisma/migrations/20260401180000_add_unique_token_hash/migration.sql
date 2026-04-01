-- DropIndex
DROP INDEX "refresh_token_token_hash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");
