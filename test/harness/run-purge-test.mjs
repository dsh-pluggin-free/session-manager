import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = path.join(process.cwd(), '.tmp', `recycle-harness-${process.pid}`)
const sessionId = 'session-recycle-selftest-0001'
const projectDir = path.join(home, 'sessions', '--project--')
const sessionDir = path.join(projectDir, sessionId)
const logFile = path.join(sessionDir, 'session.v4.jsonl.zstd')
const cacheDir = path.join(home, 'storages', 'session_projcache', 'sessions')
const cacheFile = path.join(cacheDir, `${sessionId}.json`)

process.env.DSH_HOME = home
mkdirSync(sessionDir, { recursive: true })
mkdirSync(cacheDir, { recursive: true })
writeFileSync(logFile, 'header-only-test-log')
writeFileSync(cacheFile, '{}')

const { purgeOne } = await import('../../index.js')

const calls = { unarchive: [], detach: [] }
const snapshot = {
  header: { version: 4, id: sessionId, createdAt: 1, cwd: 'C:\\project', isSeeded: false },
  location: { kind: 'jsonl', path: logFile },
  sizeBytes: 19,
}
const workspace = {
  id: 'ws-test',
  title: 'Test workspace',
  sessionIds: [sessionId],
  detachSession: async (id) => {
    calls.detach.push(id)
  },
}
const ctx = {
  sessionPersistence: {
    stat: async (id) => (id === sessionId ? snapshot : undefined),
  },
  workspaceRegistry: {
    list: () => [workspace],
    unarchiveSession: async (id) => {
      calls.unarchive.push(id)
    },
  },
  get: (name) => (name === 'sessions' ? {} : undefined),
}
const sessions = { get: () => undefined, store: { get: () => undefined } }

const dry = await purgeOne(ctx, sessions, new Set([sessionId]), sessionId, true)
assert.equal(dry.ok, true)
assert.equal(dry.dryRun, true)
assert.equal(dry.insideRoot, true)
assert.equal(existsSync(sessionDir), true, 'dry run must not delete the session directory')

const result = await purgeOne(ctx, sessions, new Set([sessionId]), sessionId, false)
assert.equal(result.ok, true)
assert.equal(result.removed, true)
assert.equal(existsSync(sessionDir), false, 'purge must remove the session directory')
assert.equal(existsSync(cacheFile), false, 'purge must remove the projection cache entry')
assert.deepEqual(calls.unarchive, [sessionId])
assert.deepEqual(calls.detach, [sessionId])

const outsideCtx = {
  ...ctx,
  sessionPersistence: {
    stat: async () => ({
      ...snapshot,
      location: { kind: 'jsonl', path: path.join(home, 'elsewhere', sessionId, 'session.v4.jsonl.zstd') },
    }),
  },
}
await assert.rejects(
  () => purgeOne(outsideCtx, sessions, new Set([sessionId]), sessionId, false),
  /不在本机会话根目录内/,
)

const flatId = 'session-flat-test-0001'
const flatProject = path.join(home, 'sessions', '--flat-project--')
const flatFile = path.join(flatProject, `${flatId}.jsonl.zstd`)
mkdirSync(flatProject, { recursive: true })
writeFileSync(flatFile, 'flat-layout-test-log')
const flatCtx = {
  ...ctx,
  sessionPersistence: {
    stat: async (id) => (id === flatId
      ? {
        header: { version: 4, id: flatId, createdAt: 1, isSeeded: false },
        location: { kind: 'jsonl', path: flatFile },
        sizeBytes: 20,
      }
      : undefined),
  },
}
const flat = await purgeOne(flatCtx, sessions, new Set([flatId]), flatId, false)
assert.equal(flat.ok, true)
assert.equal(flat.layout, 'file')
assert.equal(existsSync(flatFile), false, 'flat layout must remove only the session file')
assert.equal(existsSync(flatProject), true, 'flat layout must keep the shared project directory')

console.log(JSON.stringify({
  ok: true,
  dryRunChecked: true,
  removedDir: !existsSync(sessionDir),
  removedCache: !existsSync(cacheFile),
  unarchiveCalled: calls.unarchive.includes(sessionId) && calls.unarchive.includes(flatId),
  detachCalled: calls.detach.length === 1,
  outsideRootRejected: true,
  flatLayoutFileRemoved: !existsSync(flatFile),
  flatLayoutProjectPreserved: existsSync(flatProject),
}))

await rm(home, { recursive: true, force: true })
