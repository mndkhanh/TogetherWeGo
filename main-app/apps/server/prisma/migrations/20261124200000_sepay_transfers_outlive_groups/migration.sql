-- A transfer is a bank record and outlives the group its payment was in: deleting a group
-- removes its settlements and leaves the matched transfer with no settlement. So only one
-- direction holds: a transfer linked to a settlement is always 'matched'.
ALTER TABLE "sepay_transactions" DROP CONSTRAINT "sepay_transactions_matched_has_settlement";
ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_settlement_means_matched"
  CHECK ("settlement_id" IS NULL OR "status" = 'matched');
