// Checks the Vietnamese dictionary against the English one: the same keys, and the same
// {{placeholders}} in every string. TypeScript already fails the build on a missing key; this
// also catches extra keys and a translation that drops or renames a placeholder.
import { readFileSync } from "node:fs"

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../src/i18n/${name}.json`, import.meta.url), "utf8"))

const flatten = (object, prefix = "") =>
  Object.entries(object).flatMap(([key, value]) =>
    typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  )

const placeholders = (text) =>
  [...text.matchAll(/{{(\w+)}}/g)]
    .map((match) => match[1])
    .sort()
    .join(",")

const en = new Map(flatten(load("en")))
const vi = new Map(flatten(load("vi")))
const problems = []

for (const [key, english] of en) {
  const vietnamese = vi.get(key)
  if (vietnamese === undefined) problems.push(`vi is missing ${key}`)
  else if (placeholders(english) !== placeholders(vietnamese)) {
    problems.push(
      `${key}: placeholders differ (en: ${placeholders(english)}, vi: ${placeholders(vietnamese)})`
    )
  }
}
for (const key of vi.keys()) if (!en.has(key)) problems.push(`vi has ${key}, en doesn't`)

if (problems.length > 0) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log(`i18n: ${en.size} strings, English and Vietnamese match`)
