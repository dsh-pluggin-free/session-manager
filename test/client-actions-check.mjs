import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const instrumented = code.replace(
  "    return {\n      inject: ['slots', 'locale'],",
  "    window.__dsrTest = { ui, enterSelection, exitSelection, toggleSelected, toggleTrashSelected, toggleSelectAllTrash, openBatchConfirm, openPanel, closePanel, openConfirm, closeConfirm, archiveSelected, restoreItem, confirmPurge, refreshList, refreshIds };\n\n    return {\n      inject: ['slots', 'locale'],",
)
assert.notEqual(instrumented, code, 'test instrumentation must be inserted')

const registrations = []
const cleanups = []
const calls = { fetch: [], refresh: 0 }
const doc = {
  head: { appendChild() {} },
  body: {},
  createElement() {
    return { setAttribute() {}, remove() {}, textContent: '' }
  },
  querySelector() {
    return null
  },
  querySelectorAll() {
    return []
  },
}
const window = {
  innerWidth: 1200,
  innerHeight: 800,
  requestAnimationFrame() {
    return 0
  },
  cancelAnimationFrame() {},
  __ModuleLoader__: { load(options) { window.__loaded = options } },
}
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}

const sessionsService = {
  refresh: async () => {
    calls.refresh += 1
  },
}
const ctx = {
  effect(fn) {
    const disposer = fn()
    if (typeof disposer === 'function') cleanups.push(disposer)
    return () => {}
  },
  locale: { register() { return () => {} } },
  slots: {
    inject(_name, callback) {
      const disposer = callback()
      if (typeof disposer === 'function') cleanups.push(disposer)
      return () => {}
    },
    register(options, Component) {
      registrations.push({ options, Component })
      return () => {}
    },
  },
  get(name) {
    if (name === 'sessions') return sessionsService
    return undefined
  },
}

const listItems = [{ sessionId: 's1', title: 'One', updatedAt: 1, missing: false }]
let archiveResults = [{ sessionId: 's1', ok: true }]
let purgeResults = [{ sessionId: 's1', ok: true }]

globalThis.fetch = async (url, options) => {
  calls.fetch.push({
    url: String(url),
    method: options && options.method,
    body: options && options.body ? JSON.parse(options.body) : null,
  })
  const path = String(url)
  let body
  if (path.endsWith('/ids')) body = { ok: true, ids: ['s1'] }
  else if (path.endsWith('/list')) body = { ok: true, items: listItems }
  else if (path.endsWith('/archive')) body = { ok: true, results: archiveResults }
  else if (path.endsWith('/restore')) body = { ok: true, results: [{ sessionId: 's1', ok: true }] }
  else if (path.endsWith('/purge')) body = { ok: true, results: purgeResults }
  else body = { ok: false, error: 'unexpected' }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

new Function('window', 'document', instrumented)(window, doc)
const plugin = window.__loaded.factory((id) => {
  if (id === 'react') {
    return {
      createElement() { return null },
      Fragment: 'Fragment',
      useState: (value) => [value, () => {}],
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    }
  }
  throw new Error(`unexpected module: ${id}`)
})
plugin.apply(ctx)
const test = window.__dsrTest

test.enterSelection()
assert.equal(test.ui.mode, true)
test.toggleSelected('s1')
test.toggleSelected('s2')
assert.equal(test.ui.selected.size, 2)

archiveResults = [{ sessionId: 's1', ok: true }, { sessionId: 's2', ok: false }]
await test.archiveSelected()
assert.equal(test.ui.mode, false)
assert.equal(test.ui.busy, false)
assert.equal(test.ui.open, true)
assert.equal(test.ui.items.length, 1)
assert.deepEqual(test.ui.notice, { key: 'noticePartial', params: { ok: 1, fail: 1 } })
assert.ok(calls.fetch.some((entry) => entry.url.endsWith('/archive') && entry.method === 'POST'))

const item = test.ui.items[0]
test.openConfirm(item)
assert.equal(test.ui.confirmItem.sessionId, 's1')
await test.confirmPurge()
assert.equal(test.ui.confirmItem, null)
assert.equal(test.ui.notice.key, 'noticePurged')
assert.ok(calls.refresh >= 1, 'purge should refresh the Host session list')

await test.restoreItem(item)
assert.equal(test.ui.notice.key, 'noticeRestored')
assert.equal(test.ui.busy, false)

listItems.push({
  sessionId: 's2',
  title: 'Two',
  updatedAt: 2,
  workspaceTitle: '默认工作区',
  missing: false,
})
test.ui.items = [...listItems]
test.ui.trashSelected.add('s1')
test.ui.trashSelected.add('s2')
assert.equal(test.ui.trashSelected.size, 2)
test.openBatchConfirm()
assert.equal(test.ui.confirmBatch, true)
assert.deepEqual(test.ui.confirmIds.sort(), ['s1', 's2'])
purgeResults = [{ sessionId: 's1', ok: true }, { sessionId: 's2', ok: true }]
await test.confirmPurge()
assert.equal(test.ui.confirmIds, null)
assert.equal(test.ui.trashSelected.size, 0)
assert.deepEqual(test.ui.notice, { key: 'noticePurgedBatch', params: { count: 2 } })
const batchPurge = [...calls.fetch].reverse().find((entry) => entry.url.endsWith('/purge'))
assert.deepEqual(batchPurge.body.sessionIds.sort(), ['s1', 's2'])

test.openPanel()
assert.equal(test.ui.open, true)
await test.refreshList(true)
assert.equal(test.ui.loading, false)

purgeResults = [{ sessionId: 's1', ok: false, error: 'denied' }]
test.openConfirm(item)
await test.confirmPurge()
assert.equal(test.ui.confirmItem.sessionId, 's1', 'failed purge must keep the confirmation open')
assert.match(test.ui.error, /denied/)

for (const dispose of cleanups.reverse()) dispose()

console.log(JSON.stringify({
  ok: true,
  archiveTransition: true,
  purgeRefresh: calls.refresh,
  restoreTransition: true,
  batchTrashPurge: true,
  panelRefresh: true,
  failureKeepsConfirmation: true,
  fetchCalls: calls.fetch.map((entry) => entry.url.replace(/^.*\/session-recycle/, '')),
}))
