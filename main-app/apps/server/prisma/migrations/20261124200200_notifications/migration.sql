-- DropForeignKey
-- An expense can only be linked to an event in its own group. That was a composite foreign
-- key, but Prisma can't model it and its schema diff drops it (as it does just here). A trigger
-- enforces the same rule and survives diffs. Both happen in this one migration, so there is
-- never a moment without the rule.
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_event_same_group_fkey";

CREATE FUNCTION check_expense_event_group() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM events WHERE id = NEW.event_id AND group_id = NEW.group_id
  ) THEN
    RAISE EXCEPTION 'expense % can only link to an event in its own group', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "expenses_event_same_group"
  BEFORE INSERT OR UPDATE OF "event_id", "group_id" ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION check_expense_event_group();

-- The trigger above trusts events.group_id, so an event can never move to another group.
CREATE FUNCTION events_group_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.group_id <> OLD.group_id THEN
    RAISE EXCEPTION 'event % cannot move to another group', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "events_group_fixed"
  BEFORE UPDATE OF "group_id" ON "events"
  FOR EACH ROW EXECUTE FUNCTION events_group_fixed();

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "data" JSONB NOT NULL,
    "outbox_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL,
    "email" BOOLEAN NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","type")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "outbox_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_unprocessed_idx" ON "outbox"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_id_idx" ON "notifications"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_outbox_id_user_id_key" ON "notifications"("outbox_id", "user_id");

-- CreateIndex
CREATE INDEX "email_deliveries_sent_at_created_at_idx" ON "email_deliveries"("sent_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_outbox_id_user_id_key" ON "email_deliveries"("outbox_id", "user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outbox" ADD CONSTRAINT "outbox_attempts_non_negative" CHECK ("attempts" >= 0);
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_attempts_non_negative"
  CHECK ("attempts" >= 0);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_read_after_created"
  CHECK ("read_at" IS NULL OR "read_at" >= "created_at");
