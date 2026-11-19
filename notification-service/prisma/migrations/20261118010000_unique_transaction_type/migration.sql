-- DropIndex
DROP INDEX "notifications_transaction_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "notifications_transaction_id_type_key" ON "notifications"("transaction_id", "type");

