import type en from "./en.json"

// Type-checks every t("…") key against the English dictionary.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: { translation: typeof en }
  }
}
