// Host half of the session recycle bin.
//
// Soft delete is the platform's native "archive": archived sessions disappear
// from the normal sidebar list and stay fully recoverable. The recycle bin lists
// exactly that archive set. Permanent deletion removes the session's own log
// directory and the derived projection-cache entry, then clears the archive mark
// and workspace account so the runtime cannot resurrect a ghost row.

import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isSafeSessionId, isStrictlyInside, pathOwnsSession } from './path-guard.js'

export const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry', 'sessions']

const ROUTE_PREFIX = '/session-recycle'
const MAX_BODY_BYTES = 1_000_000
const MAX_BATCH = 200
const TITLE_CACHE_LIMIT = 500

/** @type {Map<string, { title: string | null, updatedAt: number | null }>} */
const titleCache = new Map()
let legacyMutation = Promise.resolve()

function logError(...args) {
  console.error('[session-recycle]', ...args)
}

function homeDir() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.length > 0) return configured
  return path.join(os.homedir(), '.dsh')
}

function sessionsRoot() {
  return path.join(homeDir(), 'sessions')
}

function legacyIndexPath() {
  return path.join(homeDir(), 'sessions-manager-trash', 'index.json')
}

function migrationMarkerPath() {
  return path.join(homeDir(), 'session-recycle', 'migrated.json')
}

function archivedIds(ctx) {
  const value = ctx.workspaceRegistry && ctx.workspaceRegistry.archivedSessionIds
  return Array.isArray(value) ? value.map(String) : []
}

function statusError(message, status, code) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function normalizeIds(input) {
  if (!Array.isArray(input)) throw statusError('sessionIds must be an array', 400, 'bad_request')
  const unique = []
  const seen = new Set()
  for (const raw of input) {
    const id = String(raw)
    if (!isSafeSessionId(id)) throw statusError(`invalid session id: ${id}`, 400, 'bad_request')
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  if (unique.length === 0) throw statusError('sessionIds must not be empty', 400, 'bad_request')
  if (unique.length > MAX_BATCH) throw statusError(`at most ${MAX_BATCH} sessions per request`, 400, 'bad_request')
  return unique
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        fail(statusError('request body too large', 413, 'body_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(statusError('invalid JSON body', 400, 'bad_json'))
      }
    })
    req.on('error', (error) => fail(error))
  })
}

function sendJson(res, status, body) {
  if (res.headersSent) return
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(payload))
  res.end(payload)
}

function assertSameOrigin(ctx, req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin.length === 0) return
  let expected
  try {
    expected = new URL(ctx.webServer.getOrigin())
  } catch {
    return
  }
  let actual
  try {
    actual = new URL(origin)
  } catch {
    throw statusError('invalid origin', 403, 'forbidden')
  }
  if (actual.origin === expected.origin) return
  const loopback = (hostname) => hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  if (loopback(actual.hostname) && loopback(expected.hostname) && actual.port === expected.port) return
  throw statusError('cross-origin request refused', 403, 'forbidden')
}

function registerRoute(ctx, suffix, handler) {
  const routePath = `${ROUTE_PREFIX}${suffix}`
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
          return
        }
        if (req.headers['x-dsh-session-recycle'] !== '1') {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        assertSameOrigin(ctx, req)
        const body = await readJson(req)
        await handler(req, res, body)
      } catch (error) {
        const status = typeof error.status === 'number' ? error.status : 500
        if (status >= 500) logError(`${routePath}:`, error)
        sendJson(res, status, {
          ok: false,
          error: error.code || 'internal',
          message: String((error && error.message) || error),
        })
      }
    },
  }), `session-recycle:route:${suffix}`)
}

function rememberTitles(items) {
  for (const item of items) {
    if (!item || typeof item.sessionId !== 'string') continue
    titleCache.set(item.sessionId, {
      title: typeof item.title === 'string' ? item.title : null,
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : null,
    })
  }
  while (titleCache.size > TITLE_CACHE_LIMIT) {
    const oldest = titleCache.keys().next().value
    if (oldest === undefined) break
    titleCache.delete(oldest)
  }
}

async function readTitles(ctx, ids) {
  const result = new Map()
  const missing = []
  for (const id of ids) {
    const cached = titleCache.get(id)
    if (cached) result.set(id, cached)
    else missing.push(id)
  }
  if (missing.length === 0) return result
  const query = ctx.get('sessionQuery')
  if (!query || typeof query.readTitleSnapshots !== 'function') return result
  let snapshots = []
  try {
    snapshots = await query.readTitleSnapshots(missing)
  } catch (error) {
    logError('title snapshots failed:', error)
    return result
  }
  const fresh = []
  for (const entry of Array.isArray(snapshots) ? snapshots : []) {
    if (!entry || entry.status !== 'fulfilled') continue
    const title = entry.value && entry.value.title
    const value = {
      title: title && typeof title.title === 'string' ? title.title : null,
      updatedAt: title && Number.isFinite(title.updatedAt) ? title.updatedAt : null,
    }
    titleCache.set(entry.sessionId, value)
    fresh.push({ sessionId: entry.sessionId, title: value.title, updatedAt: value.updatedAt })
    result.set(entry.sessionId, value)
  }
  rememberTitles(fresh)
  return result
}

async function buildList(ctx) {
  const ids = archivedIds(ctx)
  const workspaces = ctx.workspaceRegistry.list()
  const titleMap = await readTitles(ctx, ids)
  const items = []
  for (const sessionId of ids) {
    const snapshot = await ctx.sessionPersistence.stat(sessionId).catch(() => undefined)
    const header = snapshot && snapshot.header
    const title = titleMap.get(sessionId)
    const workspace = workspaces.find((candidate) => candidate.sessionIds.includes(sessionId))
    items.push({
      sessionId,
      title: (title && title.title) || null,
      updatedAt: (title && title.updatedAt) || (header && header.createdAt) || null,
      createdAt: (header && header.createdAt) || null,
      cwd: (header && header.cwd) || null,
      workspaceTitle: workspace ? workspace.title : null,
      workspaceId: workspace ? String(workspace.id) : null,
      sizeBytes: snapshot && Number.isFinite(snapshot.sizeBytes) ? snapshot.sizeBytes : null,
      missing: snapshot === undefined,
    })
  }
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return items
}

async function listArchived(ctx, req, res) {
  const items = await buildList(ctx)
  sendJson(res, 200, { ok: true, items })
}

async function listIds(ctx, req, res) {
  sendJson(res, 200, { ok: true, ids: archivedIds(ctx) })
}

async function archiveSessions(ctx, req, res, body) {
  const ids = normalizeIds(body.sessionIds)
  const stopActivity = body.stopActivity !== false
  const results = []
  for (const sessionId of ids) {
    try {
      await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity })
      titleCache.delete(sessionId)
      results.push({ sessionId, ok: true })
    } catch (error) {
      results.push({ sessionId, ok: false, error: String((error && error.message) || error) })
    }
  }
  sendJson(res, 200, { ok: results.every((entry) => entry.ok), results })
}

async function restoreSessions(ctx, req, res, body) {
  const ids = normalizeIds(body.sessionIds)
  const results = []
  for (const sessionId of ids) {
    try {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
      results.push({ sessionId, ok: true })
    } catch (error) {
      results.push({ sessionId, ok: false, error: String((error && error.message) || error) })
    }
  }
  sendJson(res, 200, { ok: results.every((entry) => entry.ok), results })
}

async function removeLegacyTrashEntry(sessionId) {
  const index = legacyIndexPath()
  const operation = legacyMutation.then(async () => {
    let store
    try {
      store = JSON.parse(await fsp.readFile(index, 'utf8'))
    } catch {
      return
    }
    if (!store || !Array.isArray(store.items)) return
    const nextItems = store.items.filter((entry) => !entry || String(entry.sessionId) !== sessionId)
    const purged = Array.isArray(store.purgedSessionIds)
      ? store.purgedSessionIds.filter((entry) => String(entry) !== sessionId)
      : []
    if (nextItems.length === store.items.length && purged.length === (store.purgedSessionIds || []).length) return
    store.items = nextItems
    store.purgedSessionIds = purged
    const temp = `${index}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fsp.rename(temp, index)
  })
  legacyMutation = operation.catch(() => {})
  await operation.catch(() => {})
}

async function purgeSessions(ctx, req, res, body) {
  const ids = normalizeIds(body.sessionIds)
  const dryRun = body.dryRun === true
  const archived = new Set(archivedIds(ctx))
  const sessions = ctx.get('sessions')
  const results = []
  for (const sessionId of ids) {
    try {
      results.push(await purgeOne(ctx, sessions, archived, sessionId, dryRun))
    } catch (error) {
      results.push({
        sessionId,
        ok: false,
        error: String((error && error.message) || error),
        code: error && error.code ? error.code : undefined,
      })
    }
  }
  sendJson(res, 200, { ok: results.every((entry) => entry.ok), dryRun, results })
}

export async function purgeOne(ctx, sessions, archived, sessionId, dryRun) {
  if (!archived.has(sessionId)) {
    throw statusError('该会话不在回收站中，已拒绝彻底删除', 409, 'not_archived')
  }
  const snapshot = await ctx.sessionPersistence.stat(sessionId).catch(() => undefined)
  const location = snapshot && snapshot.location && snapshot.location.path
  const liveSession = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
  const entered = sessions && sessions.store && typeof sessions.store.get === 'function'
    ? sessions.store.get(sessionId)
    : undefined
  const hasDetach = !!(entered && typeof entered.detach === 'function')
  const report = {
    sessionId,
    ok: true,
    dryRun,
    live: !!liveSession,
    hasDetach,
    location: typeof location === 'string' ? location : null,
    sizeBytes: snapshot && Number.isFinite(snapshot.sizeBytes) ? snapshot.sizeBytes : null,
  }
  let sessionDir = null
  let deleteFileOnly = false
  if (typeof location === 'string' && location.length > 0) {
    if (!pathOwnsSession(location, sessionId)) {
      throw statusError('日志路径与会话 ID 不匹配，已停止彻底删除', 409, 'path_mismatch')
    }
    const parentDir = path.dirname(location)
    if (!isStrictlyInside(sessionsRoot(), parentDir)) {
      throw statusError('日志目录不在本机会话根目录内，已停止彻底删除', 409, 'path_outside_root')
    }
    if (path.basename(parentDir) === sessionId) {
      sessionDir = parentDir
      report.layout = 'directory'
    } else {
      // Historical flat layout: the id is part of the file name, so only this
      // file belongs to the session — never remove its shared project folder.
      deleteFileOnly = true
      report.layout = 'file'
    }
    report.sessionDir = sessionDir
    report.insideRoot = true
  }
  if (dryRun) return report

  if (liveSession) {
    if (!hasDetach) {
      throw statusError('该会话仍驻留在 DSH 内存中，当前宿主未提供安全移除入口；请重启 DSH 后再试', 409, 'live_session')
    }
    if (typeof sessions.flush === 'function') {
      try {
        await sessions.flush(liveSession)
      } catch (error) {
        logError('flush before purge failed:', error)
      }
    }
    entered.detach()
    const retirement = ctx.sessionPersistence && ctx.sessionPersistence.retirements
      ? ctx.sessionPersistence.retirements.get(sessionId)
      : undefined
    if (retirement && typeof retirement.then === 'function') await retirement
  }

  if (sessionDir) {
    await fsp.rm(sessionDir, { recursive: true, force: true })
    report.removed = true
  } else if (deleteFileOnly) {
    await fsp.rm(location, { force: true })
    report.removed = true
  }

  const projectionCache = path.join(homeDir(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  try {
    await fsp.rm(projectionCache, { force: true })
    report.projectionRemoved = true
  } catch (error) {
    report.projectionError = String((error && error.message) || error)
  }

  try {
    for (const workspace of ctx.workspaceRegistry.list()) {
      if (!workspace.sessionIds.includes(sessionId)) continue
      try {
        await workspace.detachSession(sessionId)
      } catch (error) {
        logError(`detach ${sessionId} from workspace failed:`, error)
      }
    }
  } catch (error) {
    logError('workspace detach scan failed:', error)
  }

  try {
    await ctx.workspaceRegistry.unarchiveSession(sessionId)
    report.unarchived = true
  } catch (error) {
    report.unarchiveError = String((error && error.message) || error)
  }

  titleCache.delete(sessionId)
  await removeLegacyTrashEntry(sessionId)
  return report
}

async function diagnose(ctx, req, res) {
  const root = sessionsRoot()
  const ids = archivedIds(ctx)
  const sessions = ctx.get('sessions')
  const workspaces = ctx.workspaceRegistry.list()
  const entries = []
  for (const sessionId of ids) {
    const snapshot = await ctx.sessionPersistence.stat(sessionId).catch(() => undefined)
    const location = snapshot && snapshot.location && snapshot.location.path
    const live = !!(sessions && typeof sessions.get === 'function' && sessions.get(sessionId))
    const entered = sessions && sessions.store && typeof sessions.store.get === 'function'
      ? sessions.store.get(sessionId)
      : undefined
    const workspace = workspaces.find((candidate) => candidate.sessionIds.includes(sessionId))
    let exists = false
    if (typeof location === 'string') {
      try {
        await fsp.access(location)
        exists = true
      } catch {
        exists = false
      }
    }
    entries.push({
      sessionId,
      live,
      hasDetach: !!(entered && typeof entered.detach === 'function'),
      hasLocation: typeof location === 'string',
      location: typeof location === 'string' ? location : null,
      pathOwnsSession: typeof location === 'string' ? pathOwnsSession(location, sessionId) : null,
      insideRoot: typeof location === 'string' ? isStrictlyInside(root, path.dirname(location)) : null,
      logExists: exists,
      workspaceTitle: workspace ? workspace.title : null,
      missing: snapshot === undefined,
    })
  }
  sendJson(res, 200, {
    ok: true,
    home: homeDir(),
    sessionsRoot: root,
    count: ids.length,
    entries,
  })
}

async function migrateLegacyTrash(ctx) {
  const marker = migrationMarkerPath()
  try {
    await fsp.access(marker)
    return
  } catch {
    // not migrated yet
  }
  let raw
  try {
    raw = JSON.parse(await fsp.readFile(legacyIndexPath(), 'utf8'))
  } catch {
    return
  }
  const items = raw && Array.isArray(raw.items) ? raw.items : []
  const ids = []
  const seen = new Set()
  for (const entry of items) {
    const id = entry && entry.sessionId ? String(entry.sessionId) : ''
    if (!isSafeSessionId(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (ids.length === 0) {
    await writeMigrationMarker([])
    return
  }
  const archived = new Set(archivedIds(ctx))
  const results = []
  let hardFailure = false
  for (const sessionId of ids) {
    if (archived.has(sessionId)) {
      results.push({ sessionId, skipped: 'already-archived' })
      continue
    }
    const snapshot = await ctx.sessionPersistence.stat(sessionId).catch(() => undefined)
    if (snapshot === undefined) {
      results.push({ sessionId, skipped: 'missing' })
      continue
    }
    try {
      await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })
      archived.add(sessionId)
      results.push({ sessionId, archived: true })
    } catch (error) {
      hardFailure = true
      results.push({ sessionId, error: String((error && error.message) || error) })
    }
  }
  if (!hardFailure) await writeMigrationMarker(results)
}

async function writeMigrationMarker(results) {
  const target = migrationMarkerPath()
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(temp, JSON.stringify({
    version: 1,
    migratedAt: new Date().toISOString(),
    source: legacyIndexPath(),
    results,
  }, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fsp.rename(temp, target)
}

export function apply(ctx) {
  registerRoute(ctx, '/ping', async (req, res) => {
    sendJson(res, 200, { ok: true, plugin: '@local/dsh-session-recycle' })
  })
  registerRoute(ctx, '/ids', (req, res) => listIds(ctx, req, res))
  registerRoute(ctx, '/list', (req, res) => listArchived(ctx, req, res))
  registerRoute(ctx, '/archive', (req, res, body) => archiveSessions(ctx, req, res, body))
  registerRoute(ctx, '/restore', (req, res, body) => restoreSessions(ctx, req, res, body))
  registerRoute(ctx, '/purge', (req, res, body) => purgeSessions(ctx, req, res, body))
  registerRoute(ctx, '/diagnose', (req, res) => diagnose(ctx, req, res))

  ctx.effect(() => {
    const timer = setTimeout(() => {
      migrateLegacyTrash(ctx).catch((error) => logError('legacy trash migration failed:', error))
    }, 2500)
    return () => clearTimeout(timer)
  }, 'session-recycle:legacy-migration')
}
