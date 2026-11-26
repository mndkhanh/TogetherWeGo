import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth"
import * as React from "react"

import { auth } from "@/lib/firebase"

type AuthState =
  { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; user: User }

const PROFILE_CHANGED = "twg:profile-changed"

const AuthContext = React.createContext<AuthState>({ status: "loading" })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ status: "loading" })
  React.useEffect(() => {
    const update = () => {
      const user = auth.currentUser
      setState(user ? { status: "signed-in", user } : { status: "signed-out" })
    }
    // A profile change (the name, right after sign-up) doesn't fire onAuthStateChanged.
    window.addEventListener(PROFILE_CHANGED, update)
    const stop = onAuthStateChanged(auth, update)
    return () => {
      stop()
      window.removeEventListener(PROFILE_CHANGED, update)
    }
  }, [])
  return <AuthContext value={state}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  return React.use(AuthContext)
}

/** Only for screens behind <RequireAuth>. */
export function useUser(): User {
  const state = useAuth()
  if (state.status !== "signed-in") throw new Error("useUser outside a signed-in screen")
  return state.user
}

/** The name other members see. */
export function displayName(user: User): string {
  return user.displayName?.trim() || user.email?.split("@")[0] || "Someone"
}

export async function signUp(name: string, email: string, password: string): Promise<User> {
  const { user } = await createUserWithEmailAndPassword(auth, email, password)
  await setSignInName(user, name)
  return user
}

/** Keeps the sign-in account's name in step with your profile (see saveProfile). */
export async function setSignInName(user: User, name: string) {
  await updateProfile(user, { displayName: name.trim() })
  window.dispatchEvent(new Event(PROFILE_CHANGED))
}

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider())
}

export function signOut() {
  return firebaseSignOut(auth)
}

/** Firebase error codes => something a person can act on. */
export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string }).code ?? ""
  const messages: Record<string, string> = {
    "auth/invalid-credential": "That email and password don't match an account.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "There's already an account with this email. Sign in instead.",
    "auth/weak-password": "Use at least 6 characters for the password.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/network-request-failed": "Can't reach the server. Check your connection.",
  }
  return messages[code] ?? "Something went wrong. Try again."
}
