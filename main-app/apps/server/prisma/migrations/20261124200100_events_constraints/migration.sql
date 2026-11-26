-- An expense can only be linked to an event in its own group. The plain FK on event_id
-- (from the previous migration) says the event exists; this one says it is in the same group.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_event_same_group_fkey"
  FOREIGN KEY ("event_id", "group_id") REFERENCES "events"("id", "group_id");

ALTER TABLE "events" ADD CONSTRAINT "events_title_length"
  CHECK (char_length("title") BETWEEN 1 AND 80);
ALTER TABLE "events" ADD CONSTRAINT "events_ends_after_start"
  CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at");
ALTER TABLE "events" ADD CONSTRAINT "events_version_positive" CHECK ("version" >= 1);
ALTER TABLE "events" ADD CONSTRAINT "events_cancelled_fields"
  CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL));

ALTER TABLE "event_comments" ADD CONSTRAINT "event_comments_body_length"
  CHECK (char_length("body") BETWEEN 1 AND 1000);
ALTER TABLE "event_comments" ADD CONSTRAINT "event_comments_deleted_fields"
  CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL));
