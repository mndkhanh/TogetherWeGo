import * as React from "react"

import { CropPicker } from "@/components/crop-picker"
import { Avatar, Button, ErrorText, Field, Input, Loading, Panel, useAction } from "@/components/ui"
import { useUser } from "@/lib/auth"
import { dataErrorMessage } from "@/lib/data"
import { saveMyProfile, useMe } from "@/lib/me"
import { deleteAvatar, PhotoError, squareAvatar, uploadAvatar, type Crop } from "@/lib/photos"

export function ProfilePage() {
  const me = useMe()
  // Lives here: saving changes the key below, which starts the form afresh.
  const [saved, setSaved] = React.useState(false)
  if (!me.ready) return <Loading />
  // Keyed so the form starts from the saved profile once it has loaded.
  return (
    <ProfileForm
      key={`${me.name}|${me.altName ?? ""}|${me.photo ?? ""}`}
      name={me.name}
      altName={me.altName ?? null}
      photo={me.photo ?? null}
      saved={saved}
      setSaved={setSaved}
    />
  )
}

/**
 * The first thing after signing up (or for anyone without a photo yet): a photo and display name
 * are required, the alternative name optional. The app opens once it's saved.
 */
export function ProfileSetup() {
  const me = useMe()
  const [saved, setSaved] = React.useState(false)
  return (
    <ProfileForm
      setup
      name={me.name}
      altName={me.altName ?? null}
      photo={me.photo ?? null}
      saved={saved}
      setSaved={setSaved}
    />
  )
}

/**
 * The photo you're about to save: unchanged, or a new file with the square you picked (`src` is
 * the whole picture, `preview` just that square). A photo is required, so never none.
 */
type PhotoChoice =
  { kind: "keep" } | { kind: "new"; file: File; src: string; crop: Crop; preview: string }

/** A picture being cropped: a new file, or the one already chosen being adjusted. */
interface Cropping {
  file: File
  src: string
  initial?: Crop
}

function ProfileForm({
  name: savedName,
  altName: savedAlt,
  photo: savedPhoto,
  saved,
  setSaved,
  setup = false,
}: {
  setup?: boolean
  name: string
  altName: string | null
  photo: string | null
  saved: boolean
  setSaved: (saved: boolean) => void
}) {
  const user = useUser()
  const [name, setName] = React.useState(savedName)
  const [altName, setAltName] = React.useState(savedAlt ?? "")
  const [photo, setPhoto] = React.useState<PhotoChoice>({ kind: "keep" })
  const [cropping, setCropping] = React.useState<Cropping | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const { busy, error, run, setError } = useAction()
  const changed =
    setup ||
    name.trim() !== savedName ||
    altName.trim() !== (savedAlt ?? "") ||
    photo.kind !== "keep"

  const shown = photo.kind === "new" ? photo.preview : savedPhoto

  React.useEffect(
    () => () => {
      if (photo.kind === "new") {
        URL.revokeObjectURL(photo.src)
        URL.revokeObjectURL(photo.preview)
      }
    },
    [photo],
  )

  const choose = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) return setError("Choose a photo (JPEG or PNG).")
    setError(null)
    setCropping({ file, src: URL.createObjectURL(file) })
  }

  const cropped = async (crop: Crop) => {
    if (!cropping) return
    const { file, src } = cropping
    setCropping(null)
    try {
      const preview = URL.createObjectURL(await squareAvatar(file, crop))
      setSaved(false)
      // The previous choice's links are revoked when it's replaced, so adjusting it needs a
      // fresh link to the same file.
      const adjusting = photo.kind === "new" && photo.src === src
      setPhoto({
        kind: "new",
        file,
        src: adjusting ? URL.createObjectURL(file) : src,
        crop,
        preview,
      })
    } catch (err) {
      if (photo.kind !== "new" || photo.src !== src) URL.revokeObjectURL(src)
      setError(err instanceof PhotoError ? err.message : "Couldn't open that photo.")
    }
  }

  const cancelCrop = () => {
    if (cropping && (photo.kind !== "new" || photo.src !== cropping.src)) {
      URL.revokeObjectURL(cropping.src)
    }
    setCropping(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(false)
    if (!shown) return setError("Add a photo so friends recognise you.")
    if (!name.trim()) return setError("Enter the name your groups should see.")
    const ok = await run(
      async () => {
        const next =
          photo.kind === "new" ? await uploadAvatar(user.uid, photo.file, photo.crop) : savedPhoto
        try {
          await saveMyProfile(user, name, altName, next)
        } catch (err) {
          if (photo.kind === "new" && next) await deleteAvatar(next).catch(() => {})
          throw err
        }
        // The old picture isn't used anywhere now.
        if (savedPhoto && savedPhoto !== next) await deleteAvatar(savedPhoto).catch(() => {})
      },
      (err) => (err instanceof PhotoError ? err.message : dataErrorMessage(err)),
    )
    if (ok) setSaved(true)
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        {setup && <p className="text-sm font-semibold text-brand">Step 1 of 2</p>}
        <h1 className="text-2xl font-extrabold tracking-tight">
          {setup ? "Set up your profile" : "Your profile"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {setup
            ? "Add a photo and the name your groups will see, so friends know it's you."
            : "How you appear to people in your groups."}
        </p>
      </div>

      <Panel>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="flex items-center gap-4">
            <Avatar name={name.trim() || "?"} uid={user.uid} photo={shown} size="lg" />
            <div className="flex flex-col items-start gap-1">
              <Button
                type="button"
                variant={shown ? "secondary" : "primary"}
                onClick={() => fileInput.current?.click()}
              >
                {shown ? "Change photo" : "Add photo"}
              </Button>
              {!shown && <span className="text-xs text-muted">Required</span>}
              {photo.kind === "new" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCropping({ file: photo.file, src: photo.src, initial: photo.crop })
                  }
                >
                  Adjust crop
                </Button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label="Profile photo"
              className="sr-only"
              onChange={(e) => {
                choose(e.target.files?.[0])
                e.target.value = ""
              }}
            />
          </div>

          <Field label="Display name" hint="Shown everywhere: members, expenses, payments.">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setSaved(false)
              }}
              autoComplete="nickname"
              maxLength={60}
              required
            />
          </Field>
          <Field
            label="Alternative name (optional)"
            hint="A nickname or your full name, so friends know it's you."
          >
            <Input
              value={altName}
              onChange={(e) => {
                setAltName(e.target.value)
                setSaved(false)
              }}
              placeholder="Bé Na, Nguyễn Văn An…"
              autoComplete="name"
              maxLength={40}
            />
          </Field>

          <div className="flex items-center gap-3 rounded-xl bg-canvas p-3 ring-1 ring-line">
            <Avatar name={name.trim() || "?"} uid={user.uid} photo={shown} />
            <p className="min-w-0 text-sm">
              <span className="font-semibold">{name.trim() || "Your name"}</span>
              {altName.trim() && <span className="text-muted"> · {altName.trim()}</span>}
            </p>
            <span className="ml-auto text-xs text-muted">Preview</span>
          </div>

          {cropping && (
            <CropPicker
              src={cropping.src}
              initial={cropping.initial}
              onDone={(crop) => void cropped(crop)}
              onCancel={cancelCrop}
            />
          )}

          <ErrorText>{error}</ErrorText>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !changed}>
              {busy ? "Saving…" : setup ? "Continue" : "Save"}
            </Button>
            {!setup && saved && !changed && (
              <span role="status" className="text-sm text-owed">
                Saved. Your groups see the change.
              </span>
            )}
          </div>
        </form>
      </Panel>
    </div>
  )
}
