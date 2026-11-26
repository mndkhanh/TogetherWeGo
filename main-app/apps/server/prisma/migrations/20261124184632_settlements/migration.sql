-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('pending', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "ConfirmedVia" AS ENUM ('sepay', 'manual');

-- CreateEnum
CREATE TYPE "SepayTransactionStatus" AS ENUM ('matched', 'unmatched', 'ignored');

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bank_bin" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "sepay_key_hash" TEXT,
    "sepay_key_hint" TEXT,
    "sepay_last_event_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "paid_amount" BIGINT,
    "currency" "Currency" NOT NULL,
    "payment_code" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending',
    "confirmed_via" "ConfirmedVia",
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sepay_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payment_account_id" UUID,
    "sepay_id" BIGINT NOT NULL,
    "account_number" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "content" TEXT NOT NULL,
    "reference_code" TEXT,
    "transferred_at" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "status" "SepayTransactionStatus" NOT NULL,
    "settlement_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "sepay_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_user_id_key" ON "payment_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_sepay_key_hash_key" ON "payment_accounts"("sepay_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_payment_code_key" ON "settlements"("payment_code");

-- CreateIndex
CREATE INDEX "settlements_group_id_created_at_idx" ON "settlements"("group_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "settlements_to_user_id_status_idx" ON "settlements"("to_user_id", "status");

-- CreateIndex
CREATE INDEX "settlements_from_user_id_status_idx" ON "settlements"("from_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sepay_transactions_settlement_id_key" ON "sepay_transactions"("settlement_id");

-- CreateIndex
CREATE INDEX "sepay_transactions_user_id_status_received_at_idx" ON "sepay_transactions"("user_id", "status", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sepay_transactions_user_id_sepay_id_key" ON "sepay_transactions"("user_id", "sepay_id");

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Money invariants, enforced by the database itself ----------

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_paid_amount_positive"
  CHECK ("paid_amount" IS NULL OR "paid_amount" > 0);
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_not_to_self"
  CHECK ("from_user_id" <> "to_user_id");
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payment_code_format"
  CHECK ("payment_code" ~ '^TWG[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$');
-- Each status carries exactly the fields that belong to it.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_status_fields" CHECK (
  CASE "status"
    WHEN 'pending' THEN "paid_amount" IS NULL AND "confirmed_via" IS NULL
                        AND "confirmed_at" IS NULL AND "cancelled_at" IS NULL
    WHEN 'confirmed' THEN "paid_amount" IS NOT NULL AND "confirmed_via" IS NOT NULL
                          AND "confirmed_at" IS NOT NULL AND "cancelled_at" IS NULL
    WHEN 'cancelled' THEN "paid_amount" IS NULL AND "confirmed_via" IS NULL
                          AND "confirmed_at" IS NULL AND "cancelled_at" IS NOT NULL
  END
);

ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_amount_positive"
  CHECK ("amount" > 0);
ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_matched_has_settlement"
  CHECK (("status" = 'matched') = ("settlement_id" IS NOT NULL));

-- A settlement only moves forward: pending -> confirmed | cancelled, or cancelled -> confirmed
-- (the money arrived after all). Once confirmed it is part of everyone's balance and can
-- never change. Settlements are never deleted, except with their whole group.
CREATE FUNCTION settlements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM groups WHERE id = OLD.group_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'settlements cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'settlement % is confirmed and cannot change', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id OR NEW.group_id <> OLD.group_id OR NEW.from_user_id <> OLD.from_user_id
     OR NEW.to_user_id <> OLD.to_user_id OR NEW.amount <> OLD.amount
     OR NEW.currency <> OLD.currency OR NEW.payment_code <> OLD.payment_code
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only the status of settlement % can change', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'settlement % cannot go back to pending', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "settlements_guard"
  BEFORE UPDATE OR DELETE ON "settlements"
  FOR EACH ROW EXECUTE FUNCTION settlements_guard();
