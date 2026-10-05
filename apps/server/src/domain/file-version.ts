import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'

export const mediaFileIdentity = (info: BigIntStats): string => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
export const isMediaSha = (hash: unknown): hash is string => typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)
export class MediaVersionError extends Error {
  readonly statusCode = 409
  readonly code = 'MEDIA_VERSION_CHANGED'
}

/** Local-file evidence, not a lock against future external writers. Re-stat at
 * every use; cache bounded evidence only while file identity/times/size match.
 * Open-handle and pathname identity must both remain stable during hashing. */
export class FileVersionVerifier {
  private readonly checked = new Map<string, { signature: string; hash: string; valid: boolean }>()
  constructor(private readonly capacity = 512) {}

  async matches(path: string, expectedHash: string): Promise<boolean> {
    return (await this.verify(path, expectedHash)) !== null
  }

  async verify(path: string, expectedHash: string): Promise<string | null> {
    if (!isMediaSha(expectedHash)) return null
    const hash = expectedHash.toLowerCase()
    const before = await stat(path, { bigint: true })
    if (!before.isFile()) return null
    const identity = mediaFileIdentity(before), cached = this.checked.get(path)
    if (cached?.signature === identity && cached.hash === hash) return cached.valid ? identity : null
    const handle = await open(path, 'r')
    try {
      if (mediaFileIdentity(await handle.stat({ bigint: true })) !== identity) return null
      const digest = createHash('sha256')
      for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk)
      const after = await stat(path, { bigint: true })
      if (!after.isFile() || mediaFileIdentity(after) !== identity || mediaFileIdentity(await handle.stat({ bigint: true })) !== identity) return null
      const valid = digest.digest('hex') === hash
      this.checked.delete(path)
      this.checked.set(path, { signature: identity, hash, valid })
      while (this.checked.size > Math.max(0, this.capacity)) this.checked.delete(this.checked.keys().next().value!)
      return valid ? identity : null
    } finally { await handle.close() }
  }
}
