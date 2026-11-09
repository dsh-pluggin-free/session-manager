import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromRender = createRequire(import.meta.url)
const React = requireFromRender('react')
const { JSDOM } = requireFromRender('jsdom')

const html = `<!doctype html><html><head></head><body>
  <div class="regionArea">
    <div data-slot="sidebar.workspaces">
      <div class="root">
        <div class="sectionHeader">
          <span class="sectionLabel">会话</span>
          <div class="searchSlot">
            <div class="search">
              <button class="searchButton" aria-label="搜索会话" aria-expanded="false"><svg></svg></button>
              <input class="searchInput" />
            </div>
          </div>
          <div class="headerActions"><button type="button">视图</button></div>
        </div>
        <div class="listArea">sessions</div>
      </div>
    </div>
  </div>
  <div class="footArea">
    <div class="footerActions">
      <div data-slot="sidebar.footer.action">
        <div data-dsr-recycle-section data-dsr-bin-open="false" class="dsr-recycle-section"></div>
      </div>
    </div>
    <div class="settingsArea"></div>
  </div>
</body></html>`

const dom = new JSDOM(html, { url: 'http://127.0.0.1/' })
const { window } = dom
const document = window.document
globalThis.MutationObserver = window.MutationObserver

// A stale control from a previous HMR generation must be removed on apply.
const stale = document.createElement('button')
stale.dataset.dsrHeadControl = 'collapse'
stale.textContent = 'stale'
document.querySelector('.sectionHeader').appendChild(stale)

let frames = []
window.requestAnimationFrame = (callback) => {
  frames.push(callback)
  return frames.length
}
window.cancelAnimationFrame = () => {}
function flushFrames() {
  const current = frames
  frames = []
  for (const callback of current) callback()
}

let code = readFileSync(new URL('../client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
code = code.replace(
  "    return {\n      inject: ['slots', 'locale'],",
  "    window.__dsrTest = { ui, syncHeaderControls, setSessionsCollapsed, toggleSessionsCollapsed, openPanel, closePanel };\n\n    return {\n      inject: ['slots', 'locale'],",
)

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, items: [] }),
})

const registrations = []
const ctx = {
  effect(fn) {
    const disposer = fn()
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
  locale: {
    register() {
      return () => {}
    },
    subscribe() {
      return () => {}
    },
    bind() {
      return (key) => key
    },
  },
  slots: {
    inject(_name, callback) {
      return callback()
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

const loader = { load(options) { loader.options = options } }
window.__ModuleLoader__ = loader
new Function('window', 'document', code)(window, document)
const plugin = loader.options.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected module: ${id}`)
})
plugin.apply(ctx)
flushFrames()

const label = document.querySelector('.sectionLabel')
const collapse = document.querySelector('[data-dsr-head-control="collapse"]')
const select = document.querySelector('[data-dsr-head-control="select"]')
const searchSlot = document.querySelector('.searchSlot')
const listArea = document.querySelector('.listArea')
const root = document.querySelector('.root')
const region = document.querySelector('.regionArea')

assert.ok(label && collapse && select && searchSlot, 'both controls injected')
assert.equal(label.nextElementSibling, collapse, 'collapse button follows the section label')
assert.equal(select.nextElementSibling, searchSlot, 'select button sits left of the search slot')
assert.equal(document.querySelectorAll('[data-dsr-head-control="collapse"]').length, 1)
assert.equal(document.querySelectorAll('[data-dsr-head-control="select"]').length, 1)
assert.equal(collapse.getAttribute('aria-expanded'), 'true')
assert.equal(select.getAttribute('aria-pressed'), 'false')

collapse.click()
flushFrames()
assert.equal(root.dataset.dsrSessionsCollapsed, 'true')
assert.equal(region.style.flex, '0 0 auto')
assert.equal(collapse.getAttribute('aria-expanded'), 'false')
assert.equal(collapse.dataset.active, 'true')

collapse.click()
flushFrames()
assert.equal(root.dataset.dsrSessionsCollapsed, 'false')
assert.notEqual(region.style.flex, '0 0 auto')
assert.equal(collapse.getAttribute('aria-expanded'), 'true')

select.click()
flushFrames()
assert.equal(select.getAttribute('aria-pressed'), 'true')
assert.equal(select.dataset.active, 'true')
assert.equal(window.__dsrTest.ui.mode, true)

select.click()
flushFrames()
assert.equal(select.getAttribute('aria-pressed'), 'false')
assert.equal(window.__dsrTest.ui.mode, false)

// Expanding search must reveal the list, even if the section was collapsed.
window.__dsrTest.setSessionsCollapsed(true)
flushFrames()
assert.equal(root.dataset.dsrSessionsCollapsed, 'true')
document.querySelector('.search').classList.add('searchExpanded')
window.__dsrTest.syncHeaderControls()
flushFrames()
assert.equal(window.__dsrTest.ui.sessionsCollapsed, false)
assert.equal(root.dataset.dsrSessionsCollapsed, 'false')
document.querySelector('.search').classList.remove('searchExpanded')

// Re-render simulation: removing the injected buttons must be repaired by the observer.
collapse.remove()
select.remove()
window.__dsrTest.syncHeaderControls()
assert.ok(document.querySelector('[data-dsr-head-control="collapse"]'))
assert.ok(document.querySelector('[data-dsr-head-control="select"]'))

// Downward expansion: the footer grows, the session region shrinks to its header.
const section = document.querySelector('[data-dsr-recycle-section]')
const outlet = document.querySelector('[data-slot="sidebar.footer.action"]')
const footerActions = document.querySelector('.footerActions')
const footArea = document.querySelector('.footArea')
window.__dsrTest.openPanel()
flushFrames()
assert.equal(window.__dsrTest.ui.open, true)
assert.equal(root.dataset.dsrSessionsCollapsed, 'true')
assert.equal(region.style.flex, '0 0 auto')
assert.equal(section.style.flex, '1 1 auto')
assert.equal(outlet.style.flex, '1 1 auto')
assert.equal(footerActions.style.flex, '1 1 auto')
assert.equal(footArea.style.flex, '1 1 auto')

window.__dsrTest.closePanel()
flushFrames()
assert.equal(window.__dsrTest.ui.open, false)
assert.equal(root.dataset.dsrSessionsCollapsed, 'false')
assert.notEqual(region.style.flex, '0 0 auto')
assert.notEqual(section.style.flex, '1 1 auto')
assert.notEqual(footArea.style.flex, '1 1 auto')

console.log(JSON.stringify({
  ok: true,
  injectedAfterLabel: true,
  injectedBeforeSearch: true,
  collapseHidesList: true,
  collapseRestores: true,
  selectToggles: true,
  observerReinjects: true,
  expandsDownward: true,
  layoutRestores: true,
  registrations: registrations.map((entry) => entry.options.name),
}))

dom.window.close()
