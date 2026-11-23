-- A group has at most one active owner. Ownership transfer demotes the old owner
-- before promoting the new one, inside one transaction.
CREATE UNIQUE INDEX "group_members_one_active_owner"
  ON "group_members" ("group_id")
  WHERE "role" = 'owner' AND "left_at" IS NULL;

-- Invite usage can never exceed its limit, even under concurrent accepts.
ALTER TABLE "group_invites"
  ADD CONSTRAINT "group_invites_uses_within_limit"
  CHECK ("max_uses" IS NULL OR ("uses" >= 0 AND "uses" <= "max_uses"));
