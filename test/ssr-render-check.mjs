import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromRender = createRequire(import.meta.url)
const React = requireFromRender('react')
const { renderToStaticMarkup } = requireFromRender('react-dom/server')

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const instrumented = code.replace(
  "    return {\n      inject: ['slots', 'locale'],",
  "    window.__dsrTest = { ui, enterSelection, exitSelection, toggleSelected, openPanel, closePanel, openConfirm, closeConfirm, archiveSelected, restoreItem, confirmPurge, refreshList, refreshIds };\n\n    return {\n      inject: ['slots', 'locale'],",
)
assert.notEqual(instrumented, code, 'test instrumentation must be inserted')

const registrations = []
const cleanups = []
const head = { appendChild() {} }
const doc = {
  head,
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

const ctx = {
  effect(fn) {
    const disposer = fn()
    if (typeof disposer === 'function') cleanups.push(disposer)
    return () => {}
  },
  locale: {
    register() {
      return () => {}
    },
  },
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
  get() {
    return undefined
  },
}

new Function('window', 'document', instrumented)(window, doc)
const loaded = window.__loaded
assert.ok(loaded && loaded.factory, 'ModuleLoader registration')
const plugin = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected module: ${id}`)
})
assert.deepEqual(plugin.inject, ['slots', 'locale'])
plugin.apply(ctx)
assert.equal(registrations.length, 3)

const byName = new Map(registrations.map((entry) => [entry.options.name, entry.Component]))
const Footer = byName.get('sidebar.footer.action')
const Overlay = byName.get('shell.overlay')
const Leading = byName.get('sidebar.session.row.leading')
assert.ok(Footer && Overlay && Leading, 'all three slot components registered')

const ZH = {
  title: '会话回收站',
  untitled: '未命名会话',
  empty: '回收站为空。删除的会话会先放在这里。',
  restore: '恢复',
  purge: '彻底删除',
  footNote: '彻底删除会从本机移除会话日志，无法恢复。',
  selectEnter: '选择会话',
  selectExit: '退出选择',
  selectSelected: '已选择 {count} 个会话',
  delete: '删除',
  cancel: '取消',
  selectHint: '删除的会话会先移入回收站；运行中的会话会先停止当前工作。',
  confirmTitle: '彻底删除这个会话？',
  confirmBody: '“{title}”的本地会话日志将从这台电脑上移除。',
  confirmWarn: '此操作不可撤销。',
  confirmAction: '彻底删除',
  noticeArchived: '已移入回收站 {count} 个会话',
  noticePartial: '已移入回收站 {ok} 个，{fail} 个失败',
  noticeRestored: '已恢复到原工作区',
  noticePurged: '已从本机彻底删除',
  working: '处理中…',
  collapse: '收起',
  openTrash: '打开会话回收站',
  missingLog: '日志缺失',
  ungrouped: '未分组',
  defaultWorkspace: '默认工作区',
  trashSelectAll: '全选',
  trashClearSelection: '取消全选',
  trashSelected: '已选 {count} 个',
  trashDeleteSelected: '彻底删除所选',
  confirmBatchTitle: '彻底删除所选的 {count} 个会话？',
  confirmBatchBody: '所选会话的本地日志将从这台电脑上移除。',
  noticePurgedBatch: '已从本机彻底删除 {count} 个会话',
  selectCheck: '选择此会话',
  selectUncheck: '取消选择此会话',
}
const t = (key, params = {}) => {
  let text = ZH[key] ?? key
  for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value))
  return text
}

const footerHtml = renderToStaticMarkup(React.createElement(Footer, { wide: true, t }))
assert.match(footerHtml, /会话回收站/)
assert.match(footerHtml, /data-dsr-trigger/)

const test = window.__dsrTest
assert.equal(renderToStaticMarkup(React.createElement(Overlay, { t })), '')

test.ui.items = [{
  sessionId: 'session-abc',
  title: '测试会话',
  workspaceTitle: '默认工作区',
  updatedAt: Date.now(),
  sizeBytes: 1024,
  missing: false,
}]
test.ui.count = 1
test.ui.open = true
const openHtml = renderToStaticMarkup(React.createElement(Footer, { wide: true, t }))
assert.match(openHtml, /会话回收站/)
assert.match(openHtml, /测试会话/)
assert.match(openHtml, /恢复/)
assert.match(openHtml, /彻底删除/)
assert.match(openHtml, /全选/)
assert.match(openHtml, /彻底删除所选/)

test.ui.mode = true
test.ui.open = false
test.ui.selected.add('session-abc')
const selectionHtml = renderToStaticMarkup(React.createElement(Footer, { wide: true, t }))
assert.match(selectionHtml, /已选择 1 个会话/)
assert.match(selectionHtml, /运行中的会话会先停止当前工作/)

const circleHtml = renderToStaticMarkup(React.createElement(Leading, { sessionId: 'session-abc', t }))
assert.match(circleHtml, /role="checkbox"/)
assert.match(circleHtml, /aria-checked="true"/)

test.ui.mode = false
test.ui.selected.clear()
test.ui.confirmItem = { sessionId: 'session-abc', title: '测试会话' }
const confirmHtml = renderToStaticMarkup(React.createElement(Overlay, { t }))
assert.match(confirmHtml, /彻底删除这个会话/)
assert.match(confirmHtml, /测试会话/)
assert.match(confirmHtml, /aria-modal="true"/)

for (const dispose of cleanups.reverse()) dispose()

console.log(JSON.stringify({
  ok: true,
  registrations: registrations.map((entry) => entry.options.name),
  footerLength: footerHtml.length,
  openPanelLength: openHtml.length,
  selectionLength: selectionHtml.length,
  confirmLength: confirmHtml.length,
  circleLength: circleHtml.length,
}))
