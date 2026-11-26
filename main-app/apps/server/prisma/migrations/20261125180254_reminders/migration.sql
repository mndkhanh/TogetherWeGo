-- CreateTable
CREATE TABLE "event_reminders" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "handled_at" TIMESTAMPTZ(3),
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_reminders" (
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "debt_reminders_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateIndex
CREATE INDEX "event_reminders_due_idx" ON "event_reminders"("due_at");

-- CreateIndex
CREATE INDEX "event_reminders_event_id_idx" ON "event_reminders"("event_id");

-- AddForeignKey
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_reminders" ADD CONSTRAINT "debt_reminders_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_reminders" ADD CONSTRAINT "debt_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules Prisma can't express.
ALTER TABLE "event_reminders"
  ADD CONSTRAINT "event_reminders_kind_check" CHECK ("kind" IN ('24h', '1h')),
  ADD CONSTRAINT "event_reminders_outcome_check" CHECK ("outcome" IN ('sent', 'skipped')),
  -- Handled and outcome go together: either both are set or neither is.
  ADD CONSTRAINT "event_reminders_handled_check" CHECK (("handled_at" IS NULL) = ("outcome" IS NULL));
