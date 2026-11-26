import { initializeApp } from "firebase/app"
import { connectAuthEmulator, getAuth } from "firebase/auth"
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore"
import { connectFunctionsEmulator, getFunctions } from "firebase/functions"
import { connectStorageEmulator, getStorage } from "firebase/storage"

const env = import.meta.env
const useEmulators = env.VITE_USE_EMULATORS === "true"
const projectId = env.VITE_FIREBASE_PROJECT_ID || "demo-togetherwego"

export const app = initializeApp({
  // The emulators accept any key; a "demo-" project id never reaches a real project.
  apiKey: env.VITE_FIREBASE_API_KEY || "demo-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  projectId,
  appId: env.VITE_FIREBASE_APP_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
})

export const auth = getAuth(app)
export const db = getFirestore(app)
// Same region as the functions (functions/src/index.ts): close to Vietnam.
export const functions = getFunctions(app, "asia-southeast1")
// Expense photos.
export const storage = getStorage(app)

if (useEmulators) {
  const host = location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8085)
  connectFunctionsEmulator(functions, host, 5001)
  connectStorageEmulator(storage, host, 9199)
}
