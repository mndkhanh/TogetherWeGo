-- A split moved to another expense (UPDATE of expense_id) must leave BOTH expenses balanced.
-- The first version only re-checked the expense the row moved to.
CREATE OR REPLACE FUNCTION check_expense_splits_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  targets uuid[];
  target uuid;
  expected bigint;
  actual bigint;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    targets := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    targets := ARRAY[OLD.expense_id];
  ELSIF TG_OP = 'UPDATE' AND OLD.expense_id IS DISTINCT FROM NEW.expense_id THEN
    targets := ARRAY[OLD.expense_id, NEW.expense_id];
  ELSE
    targets := ARRAY[NEW.expense_id];
  END IF;

  FOREACH target IN ARRAY targets LOOP
    SELECT amount INTO expected FROM expenses WHERE id = target;
    CONTINUE WHEN NOT FOUND; -- the expense itself was deleted (cascade)
    SELECT COALESCE(SUM(amount), 0) INTO actual FROM expense_splits WHERE expense_id = target;
    IF actual <> expected THEN
      RAISE EXCEPTION 'expense % splits total % does not match amount %', target, actual, expected
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
