import { initializeApp } from "firebase/app"
import { connectAuthEmulator, getAuth } from "firebase/auth"
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore"

const env = import.meta.env
export const useEmulators = env.VITE_USE_EMULATORS === "true"
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
// Storage (photos) and Functions (bank payments) load on first use: see storage.ts and
// functions.ts. Most visits need neither, so they stay out of the first download.

if (useEmulators) {
  const host = location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8085)
}
