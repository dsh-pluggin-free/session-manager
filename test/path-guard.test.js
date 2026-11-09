import assert from 'node:assert/strict'
import test from 'node:test'
import { isSafeSessionId, isStrictlyInside, pathOwnsSession } from '../path-guard.js'

test('current per-session-directory layout on Windows', () => {
  const target = 'C:\\Users\\me\\.dsh\\sessions\\--project--\\session-abc\\session.v4.jsonl.zstd'
  assert.equal(pathOwnsSession(target, 'session-abc'), true)
})

test('current per-session-directory layout on POSIX', () => {
  const target = '/home/me/.dsh/sessions/--project--/session-abc/session.v4.jsonl.zstd'
  assert.equal(pathOwnsSession(target, 'session-abc'), true)
})

test('legacy flat filename layout', () => {
  assert.equal(pathOwnsSession('C:\\logs\\session-abc.jsonl.zstd', 'session-abc'), true)
  assert.equal(pathOwnsSession('/logs/session-abc.jsonl', 'session-abc'), true)
})

test('rejects id substring collisions', () => {
  assert.equal(pathOwnsSession('C:\\logs\\session-abcdef.jsonl.zstd', 'session-abc'), false)
  assert.equal(pathOwnsSession('C:\\logs\\prefix-session-abc.jsonl.zstd', 'session-abc'), false)
})

test('rejects unrelated paths and malformed ids', () => {
  assert.equal(pathOwnsSession('C:\\logs\\other.jsonl.zstd', 'session-abc'), false)
  assert.equal(pathOwnsSession('', 'session-abc'), false)
  assert.equal(pathOwnsSession('C:\\logs\\session-abc.jsonl.zstd', ''), false)
  assert.equal(isSafeSessionId('session-abc'), true)
  assert.equal(isSafeSessionId('..\\evil'), false)
  assert.equal(isSafeSessionId('session/abc'), false)
})

test('containment requires a strict descendant', () => {
  assert.equal(isStrictlyInside('C:\\Users\\me\\.dsh\\sessions', 'C:\\Users\\me\\.dsh\\sessions\\p\\session-abc'), true)
  assert.equal(isStrictlyInside('C:\\Users\\me\\.dsh\\sessions', 'C:\\Users\\me\\.dsh\\sessions'), false)
  assert.equal(isStrictlyInside('C:\\Users\\me\\.dsh\\sessions', 'C:\\Users\\me\\.dsh\\other\\session-abc'), false)
})
