import { deviceTimeZone } from "@/i18n"

/**
 * The time zone dates are shown and entered in: the account's when signed in (the same one
 * its emails and notifications use, so an event never shows two different times), this
 * device's otherwise.
 */
let zone = deviceTimeZone()

export function currentTimeZone(): string {
  return zone
}

export function setTimeZone(timeZone: string): void {
  zone = timeZone
}

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** The wall-clock date and time of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone = zone): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  }
}

/** How far the zone is ahead of UTC at that instant, in ms (DST-aware). */
function offsetAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000
}

/**
 * The instant at a wall-clock date and time in a zone. Checked twice, so it stays right across
 * a daylight-saving change.
 */
export function fromZoned(p: Parts, timeZone = zone): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  let result = guess - offsetAt(new Date(guess), timeZone)
  result = guess - offsetAt(new Date(result), timeZone)
  return new Date(result)
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "YYYY-MM-DD" for an instant, in the current zone. */
export function isoDateIn(instant: Date, timeZone = zone): string {
  const p = zonedParts(instant, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** "HH:mm" for an instant, in the current zone. */
export function isoTimeIn(instant: Date, timeZone = zone): string {
  const p = zonedParts(instant, timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}
