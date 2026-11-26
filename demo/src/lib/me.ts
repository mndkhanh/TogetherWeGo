import { displayName, setSignInName, useUser } from "@/lib/auth"
import { saveProfile, useMyProfile, type Me } from "@/lib/data"

/**
 * You, as groups see you: your profile's names, or the sign-in name until you've saved a
 * profile. `ready` is false while the profile loads, so nothing is written with a stale name.
 */
export function useMe(): Me & { ready: boolean; complete: boolean } {
  const user = useUser()
  const profile = useMyProfile(user.uid)
  return {
    uid: user.uid,
    name: profile.data?.name ?? displayName(user),
    altName: profile.data?.altName ?? null,
    photo: profile.data?.photo ?? null,
    ready: profile.data !== undefined || profile.error !== null,
    // Set up: a saved profile with a photo. Until then the app asks for one first.
    complete: Boolean(profile.data?.photo),
  }
}

/** Your names and photo, everywhere: profile, every group you're in, and the sign-in account. */
export async function saveMyProfile(
  user: ReturnType<typeof useUser>,
  name: string,
  altName: string,
  photo: string | null,
) {
  await saveProfile(user.uid, name, altName, photo)
  await setSignInName(user, name)
}
