import { connectFunctionsEmulator, getFunctions } from "firebase/functions"

import { app, useEmulators } from "@/lib/firebase"

/**
 * The Cloud Functions (functions/src/index.ts), in the same region: close to Vietnam. Imported
 * only with `await import("@/lib/functions")`, so the SDK loads when a call is made.
 */
export const functions = getFunctions(app, "asia-southeast1")
if (useEmulators) connectFunctionsEmulator(functions, location.hostname, 5001)

export { httpsCallable } from "firebase/functions"
