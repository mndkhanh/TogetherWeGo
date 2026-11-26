-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('equal', 'exact', 'percent', 'shares');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "split_type" "SplitType" NOT NULL,
    "spent_on" DATE NOT NULL,
    "receipt_key" TEXT,
    "created_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_splits" (
    "expense_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "expense_splits_pkey" PRIMARY KEY ("expense_id","user_id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "diff" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_group_id_spent_on_id_idx" ON "expenses"("group_id", "spent_on" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "expense_splits_user_id_idx" ON "expense_splits"("user_id");

-- CreateIndex
CREATE INDEX "activity_log_entity_entity_id_created_at_idx" ON "activity_log"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_log_group_id_created_at_idx" ON "activity_log"("group_id", "created_at");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Money invariants enforced by the database (defence in depth) ----------

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_version_positive" CHECK ("version" >= 1);
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_value_non_negative" CHECK ("value" >= 0);

-- The splits of an expense must add up to its amount. Checked at COMMIT (deferred), so a
-- transaction may replace the splits row by row; a bug that leaves them unbalanced rolls back.
CREATE FUNCTION check_expense_splits_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  expected bigint;
  actual bigint;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.expense_id;
  ELSE
    target := NEW.expense_id;
  END IF;

  SELECT amount INTO expected FROM expenses WHERE id = target;
  IF NOT FOUND THEN
    RETURN NULL; -- the expense itself was deleted (cascade)
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO actual FROM expense_splits WHERE expense_id = target;
  IF actual <> expected THEN
    RAISE EXCEPTION 'expense % splits total % does not match amount %', target, actual, expected
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "expenses_splits_total"
  AFTER INSERT OR UPDATE OF "amount" ON "expenses"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_splits_total();

CREATE CONSTRAINT TRIGGER "expense_splits_total"
  AFTER INSERT OR UPDATE OR DELETE ON "expense_splits"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_splits_total();

-- The activity log is an audit trail: rows can be added, never changed or removed.
-- (Deleting a whole group still cascades, since that removes the group's history with it.)
CREATE FUNCTION activity_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = OLD.group_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'activity_log is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "activity_log_append_only"
  BEFORE UPDATE OR DELETE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION activity_log_append_only();
