-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';

-- Languages the app speaks (LOCALES in @twg/shared). Time zones are checked by the API.
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("locale" IN ('en', 'vi'));
