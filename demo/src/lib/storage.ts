import { connectStorageEmulator, getStorage } from "firebase/storage"

import { app, useEmulators } from "@/lib/firebase"

/** Photos. Imported only with `await import("@/lib/storage")`, so the SDK loads when needed. */
export const storage = getStorage(app)
if (useEmulators) connectStorageEmulator(storage, location.hostname, 9199)

export { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage"
