#!/usr/bin/env node
/**
 * Pretends to be SePay telling the app that money arrived, for trying the flow locally.
 *
 *   pnpm sepay:simulate --key <api key> --account <account number> --amount 150000 --content "TWGABCD2345"
 *
 * The API key is the one "Set up SePay" showed you; the account number is the one you saved in
 * "Getting paid"; put the payment code from the transfer screen in --content. Sends to the
 * dev server's webhook URL unless you pass --url.
 */
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    key: { type: "string" },
    account: { type: "string" },
    amount: { type: "string" },
    content: { type: "string" },
    url: { type: "string", default: "http://localhost:5180/api/sepay-webhook" },
    id: { type: "string" },
  },
})

for (const required of ["key", "account", "amount", "content"]) {
  if (!values[required]) {
    console.error(`Missing --${required}. See the top of scripts/sepay-simulate.mjs.`)
    process.exit(1)
  }
}

const body = {
  id: Number(values.id ?? Date.now() % 1_000_000_000),
  gateway: "Vietcombank",
  transactionDate: new Date().toISOString().slice(0, 19).replace("T", " "),
  accountNumber: values.account,
  subAccount: null,
  code: null,
  content: values.content,
  transferType: "in",
  transferAmount: Number(values.amount),
  referenceCode: "SIMULATED",
  description: `BankAPINotify ${values.content}`,
}

const response = await fetch(values.url, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Apikey ${values.key}` },
  body: JSON.stringify(body),
})
console.log(response.status, await response.text())
process.exit(response.ok ? 0 : 1)
