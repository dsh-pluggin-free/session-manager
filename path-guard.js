// Path guards for the session-recycle host half.
// Pure functions: they decide whether a path reported by the persistence
// backend may own a session's log before anything is removed from disk.

import path from 'node:path'

/** Split a path on both Windows and POSIX separators. */
export function splitSegments(target) {
  return String(target)
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0)
}

/** Drop a leading Windows drive segment such as "C:". */
export function stripDriveLetter(segments) {
  return segments.length > 0 && /^[A-Za-z]:$/.test(segments[0]) ? segments.slice(1) : segments
}

/**
 * Does `target` plausibly own `sessionId`'s stored log?
 *
 * Accepts the current per-session-directory layout
 *   .../<sessionId>/session.vN.jsonl.zstd
 * and the historical flat layout
 *   .../<sessionId>.jsonl.zstd
 * while rejecting id-substring collisions.
 *
 * @param {string} target path reported by session persistence
 * @param {string} sessionId safe session id (no separators)
 * @returns {boolean}
 */
export function pathOwnsSession(target, sessionId) {
  if (typeof target !== 'string' || target.length === 0) return false
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false
  const segments = stripDriveLetter(splitSegments(target))
  if (segments.length === 0) return false
  const file = segments[segments.length - 1]
  if (segments.length >= 2 && segments[segments.length - 2] === sessionId) return true
  if (file.includes(sessionId)) {
    const ID_CHAR = /[A-Za-z0-9_-]/
    let from = 0
    while (true) {
      const at = file.indexOf(sessionId, from)
      if (at < 0) return false
      const before = at > 0 ? file[at - 1] : ''
      const after = at + sessionId.length < file.length ? file[at + sessionId.length] : ''
      if (!(before && ID_CHAR.test(before)) && !(after && ID_CHAR.test(after))) return true
      from = at + 1
    }
  }
  return false
}

/** A session id safe to interpolate into a file path. */
export function isSafeSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
}

/**
 * Is `candidate` a directory strictly inside `root`?
 * Both absolute paths in the host filesystem.
 */
export function isStrictlyInside(root, candidate) {
  if (typeof root !== 'string' || typeof candidate !== 'string') return false
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}
