import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage"

import { storage } from "@/lib/firebase"

/** At most this many photos on one expense (firestore.rules and storage.rules agree). */
export const MAX_PHOTOS = 4

const LONGEST_SIDE = 1600

/** A photo the browser can't open (a HEIC on some desktops, a broken file). Its message is for people. */
export class PhotoError extends Error {}

const photoRef = (groupId: string, expenseId: string, name: string) =>
  ref(storage, `groups/${groupId}/expenses/${expenseId}/${name}`)

async function open(file: File) {
  return createImageBitmap(file).catch(() => {
    throw new PhotoError(`Couldn't open “${file.name}”. Try a JPEG or PNG photo.`)
  })
}

/** Draws part of a picture onto a canvas of the given size, as a JPEG (drops metadata like location). */
function toJpeg(
  bitmap: ImageBitmap,
  crop: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number },
  name: string,
): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = size.w
  canvas.height = size.h
  canvas.getContext("2d")?.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, size.w, size.h)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PhotoError(`Couldn't open “${name}”.`))),
      "image/jpeg",
      0.82,
    ),
  )
}

/**
 * A phone photo is often 4 to 10 MB. Redrawn at 1600 px on its longest side as a JPEG it's a few
 * hundred KB and still sharp enough to read a receipt.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await open(file)
  const { width: w, height: h } = bitmap
  const scale = Math.min(1, LONGEST_SIDE / Math.max(w, h))
  return toJpeg(bitmap, { x: 0, y: 0, w, h }, { w: Math.round(w * scale), h: Math.round(h * scale) }, file.name)
}

/** Uploads the photos for an expense that's about to be saved. Returns their file names. */
export async function uploadExpensePhotos(
  groupId: string,
  expenseId: string,
  files: File[],
): Promise<string[]> {
  return Promise.all(
    files.slice(0, MAX_PHOTOS).map(async (file, i) => {
      const name = `photo-${i + 1}.jpg`
      await uploadBytes(photoRef(groupId, expenseId, name), await shrink(file), {
        contentType: "image/jpeg",
      })
      return name
    }),
  )
}

export function deleteExpensePhotos(groupId: string, expenseId: string, names: string[]) {
  return Promise.all(
    names.map((name) =>
      deleteObject(photoRef(groupId, expenseId, name)).catch((e: { code?: string }) => {
        // Already gone is fine.
        if (e.code !== "storage/object-not-found") throw e
      }),
    ),
  )
}

export function expensePhotoUrl(groupId: string, expenseId: string, name: string) {
  return getDownloadURL(photoRef(groupId, expenseId, name))
}

// ---------- Profile photos ----------

const AVATAR_SIDE = 256

/** The middle square of the picture, 256 px: a few KB, plenty for a round avatar. */
async function squareAvatar(file: File): Promise<Blob> {
  const bitmap = await open(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const out = Math.min(AVATAR_SIDE, side)
  return toJpeg(
    bitmap,
    { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, w: side, h: side },
    { w: out, h: out },
    file.name,
  )
}

/**
 * Uploads a new profile photo and returns its link. Each upload gets a new file name, so
 * nobody keeps seeing the old picture from their browser's cache.
 */
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  const name = `avatar-${Date.now().toString(36)}.jpg`
  const target = ref(storage, `avatars/${uid}/${name}`)
  await uploadBytes(target, await squareAvatar(file), { contentType: "image/jpeg" })
  return getDownloadURL(target)
}

/** Removes a profile photo you no longer use, given its link. Already gone is fine. */
export async function deleteAvatar(url: string) {
  const path = /\/o\/([^?]+)/.exec(url)?.[1]
  if (!path) return
  await deleteObject(ref(storage, decodeURIComponent(path))).catch((e: { code?: string }) => {
    if (e.code !== "storage/object-not-found") throw e
  })
}
