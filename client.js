window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useSyncExternalStore } = React

    const NS = 'sessionRecycle'
    const API = '/session-recycle'

    const EN = {
      metaTitle: 'Session recycle bin',
      title: 'Session recycle bin',
      untitled: 'Untitled session',
      empty: 'The recycle bin is empty. Deleted sessions will appear here.',
      restore: 'Restore',
      purge: 'Delete permanently',
      footNote: 'Deleted sessions are kept on this computer until you permanently delete them here.',
      selectEnter: 'Select sessions',
      selectExit: 'Exit selection',
      selectSelected: '{count} selected',
      delete: 'Delete',
      cancel: 'Cancel',
      selectHint: 'Deleting moves sessions to the recycle bin; running sessions are stopped first.',
      confirmTitle: 'Delete this session permanently?',
      confirmBody: 'The local session log for "{title}" will be removed from this computer.',
      confirmWarn: 'This cannot be undone.',
      confirmAction: 'Delete permanently',
      noticeArchived: 'Moved {count} session(s) to the recycle bin',
      noticePartial: 'Moved {ok} session(s); {fail} failed',
      noticeRestored: 'Restored to its original workspace',
      noticePurged: 'Removed from this computer',
      noticePurgedBatch: 'Removed {count} sessions from this computer',
      noticePurgedPartial: 'Removed {ok}; {fail} could not be removed',
      trashSelectAll: 'Select all',
      trashClearSelection: 'Clear selection',
      trashSelected: '{count} selected',
      trashDeleteSelected: 'Delete selected',
      confirmBatchTitle: 'Delete {count} sessions permanently?',
      confirmBatchBody: 'The local session logs for the selected sessions will be removed from this computer.',
      working: 'Working...',
      collapse: 'Collapse',
      headerCollapse: 'Collapse sessions',
      headerExpand: 'Expand sessions',
      openTrash: 'Open session recycle bin',
      missingLog: 'Log missing',
      ungrouped: 'Ungrouped',
      defaultWorkspace: 'Default workspace',
      selectCheck: 'Select this session',
      selectUncheck: 'Unselect this session',
      error: 'Operation failed: {message}',
    }

    const ZH = {
      metaTitle: '会话回收站',
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
      noticePurgedBatch: '已从本机彻底删除 {count} 个会话',
      noticePurgedPartial: '已删除 {ok} 个，{fail} 个未能删除',
      trashSelectAll: '全选',
      trashClearSelection: '取消全选',
      trashSelected: '已选 {count} 个',
      trashDeleteSelected: '彻底删除所选',
      confirmBatchTitle: '彻底删除所选的 {count} 个会话？',
      confirmBatchBody: '所选会话的本地日志将从这台电脑上移除。',
      working: '处理中…',
      collapse: '收起',
      headerCollapse: '折叠会话',
      headerExpand: '展开会话',
      openTrash: '打开会话回收站',
      missingLog: '日志缺失',
      ungrouped: '未分组',
      defaultWorkspace: '默认工作区',
      selectCheck: '选择此会话',
      selectUncheck: '取消选择此会话',
      error: '操作失败：{message}',
    }

    let clientContext
    let listInFlight = false

    const ui = {
      open: false,
      mode: false,
      selected: new Set(),
      trashSelected: new Set(),
      archivedIds: [],
      items: [],
      count: 0,
      loading: false,
      error: '',
      busy: false,
      confirmItem: null,
      confirmIds: null,
      confirmBatch: false,
      notice: null,
      sessionsCollapsed: false,
      sessionsCollapsedBeforeBin: false,
      version: 0,
      listeners: new Set(),
    }

    function emit() {
      ui.version += 1
      for (const listener of ui.listeners) listener()
    }

    function subscribe(listener) {
      ui.listeners.add(listener)
      return () => ui.listeners.delete(listener)
    }

    function getSnapshot() {
      return ui.version
    }

    function getService(name) {
      try {
        return clientContext && typeof clientContext.get === 'function' ? clientContext.get(name) : undefined
      } catch {
        return undefined
      }
    }

    // ---- injected header controls -------------------------------------------------
    // ui-workspace's section header (title + search + view actions) has no slot.
    // These two controls are injected next to its search button and kept in sync
    // across React re-renders, locale changes, and sidebar remounts.

    const SAVED_STYLES = new Map()
    const HEADER_OWNER = `dsr-${Math.random().toString(36).slice(2)}`
    let headerObserver = null
    let headerAttrObserver = null
    let headerFrame = 0
    let rowsFrame = 0
    let headerCollapse = null
    let headerSelect = null

    function rememberStyle(element) {
      if (!element || SAVED_STYLES.has(element)) return
      SAVED_STYLES.set(element, {
        flex: element.style.flex,
        minHeight: element.style.minHeight,
        display: element.style.display,
        flexDirection: element.style.flexDirection,
      })
    }

    function setStyle(element, property, value) {
      if (!element) return
      rememberStyle(element)
      element.style[property] = value
    }

    function restoreStyle(element) {
      const saved = SAVED_STYLES.get(element)
      if (!saved) return
      element.style.flex = saved.flex
      element.style.minHeight = saved.minHeight
      element.style.display = saved.display
      element.style.flexDirection = saved.flexDirection
      SAVED_STYLES.delete(element)
    }

    function browserParts() {
      const region = document.querySelector('[data-slot="sidebar.workspaces"]')?.parentElement
      const header = region ? region.querySelector('[class*="sectionHeader"]') : null
      const root = header ? header.parentElement : null
      return { region, header, root }
    }

    /**
     * Apply the host layout needed by the expanded recycle bin and the collapsed
     * session list. Every mutated inline property is restored on close/unload.
     */
    function applyHostChrome() {
      const { region, root } = browserParts()
      if (root) root.dataset.dsrSessionsCollapsed = ui.sessionsCollapsed ? 'true' : 'false'
      if (ui.open || ui.sessionsCollapsed) {
        setStyle(region, 'flex', '0 0 auto')
        setStyle(region, 'minHeight', '0')
      } else {
        restoreStyle(region)
      }

      const section = document.querySelector('[data-dsr-recycle-section]')
      if (!section) return
      const outlet = section.closest('[data-slot="sidebar.footer.action"]')
      const footerActions = outlet ? outlet.parentElement : null
      const footArea = footerActions ? footerActions.parentElement : null

      if (ui.open) {
        for (const element of [outlet, footerActions, footArea, section]) {
          setStyle(element, 'flex', '1 1 auto')
          setStyle(element, 'minHeight', '0')
        }
        setStyle(outlet, 'display', 'flex')
        setStyle(outlet, 'flexDirection', 'column')
      } else {
        for (const element of [section, outlet, footerActions, footArea]) restoreStyle(element)
      }
    }

    function restoreHostChrome() {
      for (const element of [...SAVED_STYLES.keys()]) restoreStyle(element)
      for (const element of document.querySelectorAll('[data-dsr-sessions-collapsed]')) {
        delete element.dataset.dsrSessionsCollapsed
      }
    }

    function setSessionsCollapsed(value) {
      const next = !!value
      if (ui.sessionsCollapsed === next) {
        applyHostChrome()
        emit()
        return
      }
      ui.sessionsCollapsed = next
      applyHostChrome()
      emit()
    }

    function toggleSessionsCollapsed() {
      if (ui.open) {
        closePanel()
        setSessionsCollapsed(false)
        return
      }
      setSessionsCollapsed(!ui.sessionsCollapsed)
    }

    function headerIcon(kind) {
      if (kind === 'collapse') {
        return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
      }
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8 12.2l2.6 2.6 5-5.6"/></svg>'
    }

    function createHeaderButton(kind) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsr-head-btn'
      button.dataset.dsrHeadControl = kind
      button.dataset.dsrOwner = HEADER_OWNER
      button.draggable = false
      button.style.pointerEvents = 'auto'
      button.innerHTML = headerIcon(kind)
      button.addEventListener('pointerdown', (event) => event.stopPropagation())
      button.addEventListener('mousedown', (event) => event.stopPropagation())
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (kind === 'collapse') toggleSessionsCollapsed()
        else if (ui.mode) exitSelection()
        else enterSelection()
      })
      return button
    }

    function removeForeignHeaderControls() {
      for (const element of document.querySelectorAll('[data-dsr-head-control]')) {
        if (element.dataset.dsrOwner !== HEADER_OWNER) element.remove()
      }
    }

    function removeHeaderButtons() {
      if (headerCollapse && headerCollapse.parentElement) headerCollapse.remove()
      if (headerSelect && headerSelect.parentElement) headerSelect.remove()
    }

    function syncHeaderControls() {
      const { header } = browserParts()
      if (!header || !header.querySelector('[class*="sectionLabel"]')) {
        removeHeaderButtons()
        return
      }
      removeForeignHeaderControls()
      if (!headerAttrObserver || headerAttrObserver.target !== header) {
        if (headerAttrObserver) headerAttrObserver.disconnect()
        headerAttrObserver = new MutationObserver(scheduleHeaderSync)
        headerAttrObserver.target = header
        headerAttrObserver.observe(header, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        })
      }
      if (!ui.open && ui.sessionsCollapsed && header.querySelector('[class*="searchExpanded"]')) {
        setSessionsCollapsed(false)
        return
      }
      const label = header.querySelector('[class*="sectionLabel"]')
      const searchSlot = header.querySelector('[class*="searchSlot"]')
      if (!label || !searchSlot) {
        removeHeaderButtons()
        return
      }

      if (!headerCollapse) headerCollapse = createHeaderButton('collapse')
      if (!headerSelect) headerSelect = createHeaderButton('select')

      if (!headerCollapse.isConnected || headerCollapse.previousElementSibling !== label) {
        label.insertAdjacentElement('afterend', headerCollapse)
      }
      if (!headerSelect.isConnected || headerSelect.nextElementSibling !== searchSlot) {
        header.insertBefore(headerSelect, searchSlot)
      }

      let translate = (key) => key
      try {
        if (clientContext && clientContext.locale) translate = clientContext.locale.bind(NS)
      } catch {
        // locale service not ready: fall back to key text for one frame
      }
      const collapseLabel = ui.sessionsCollapsed ? translate('headerExpand') : translate('headerCollapse')
      headerCollapse.title = collapseLabel
      headerCollapse.setAttribute('aria-label', collapseLabel)
      headerCollapse.setAttribute('aria-expanded', ui.sessionsCollapsed ? 'false' : 'true')
      headerCollapse.dataset.active = ui.sessionsCollapsed ? 'true' : 'false'

      const selectLabel = ui.mode ? translate('selectExit') : translate('selectEnter')
      headerSelect.title = selectLabel
      headerSelect.setAttribute('aria-label', selectLabel)
      headerSelect.setAttribute('aria-pressed', ui.mode ? 'true' : 'false')
      headerSelect.dataset.active = ui.mode ? 'true' : 'false'

      applyHostChrome()
    }

    function applyArchivedIds(ids) {
      ui.archivedIds = Array.isArray(ids) ? ids.map(String) : []
      scheduleRowsSync()
    }

    /**
     * The native browser can be set to "show archived", where an archived row
     * stays visible (gray). This plugin owns the archive lifecycle, so archived
     * sessions belong in the recycle bin rather than the active row list: hide
     * those native rows while they remain in the archive set.
     */
    function syncHiddenRows() {
      const archived = new Set(ui.archivedIds)
      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        const key = row.getAttribute('data-row-key') || ''
        const sessionId = key.slice('session:'.length)
        if (archived.has(sessionId)) {
          if (row.dataset.dsrArchivedHidden !== 'true') row.dataset.dsrArchivedHidden = 'true'
        } else if (row.dataset.dsrArchivedHidden === 'true') {
          delete row.dataset.dsrArchivedHidden
        }
      }
    }

    function scheduleRowsSync() {
      if (rowsFrame) return
      rowsFrame = window.requestAnimationFrame(() => {
        rowsFrame = 0
        syncHiddenRows()
      })
    }

    function scheduleHeaderSync() {
      if (headerFrame) return
      headerFrame = window.requestAnimationFrame(() => {
        headerFrame = 0
        syncHeaderControls()
      })
    }

    function installHeaderObserver() {
      if (headerObserver) return
      headerObserver = new MutationObserver(() => {
        scheduleHeaderSync()
        scheduleRowsSync()
      })
      headerObserver.observe(document.body, { childList: true, subtree: true })
      scheduleHeaderSync()
      scheduleRowsSync()
    }

    function disposeHeaderObserver() {
      if (headerObserver) headerObserver.disconnect()
      headerObserver = null
      if (headerAttrObserver) headerAttrObserver.disconnect()
      headerAttrObserver = null
      if (headerFrame) window.cancelAnimationFrame(headerFrame)
      if (rowsFrame) window.cancelAnimationFrame(rowsFrame)
      headerFrame = 0
      rowsFrame = 0
      removeHeaderButtons()
      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        delete row.dataset.dsrArchivedHidden
      }
      headerCollapse = null
      headerSelect = null
    }

    async function postJson(route, body) {
      const response = await fetch(`${API}${route}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-dsh-session-recycle': '1',
        },
        body: JSON.stringify(body || {}),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data || (data.ok === false && data.error)) {
        const message = data && (data.message || data.error) ? (data.message || data.error) : `HTTP ${response.status}`
        throw new Error(String(message))
      }
      return data
    }

    async function refreshList(silent) {
      if (listInFlight) return
      listInFlight = true
      if (!silent) {
        ui.loading = true
        emit()
      }
      try {
        const data = await postJson('/list', {})
        ui.items = Array.isArray(data.items) ? data.items : []
        ui.count = ui.items.length
        ui.error = ''
        pruneTrashSelection()
      } catch (error) {
        ui.error = String((error && error.message) || error)
      } finally {
        listInFlight = false
        ui.loading = false
        emit()
      }
    }

    async function refreshIds() {
      const data = await postJson('/ids', {})
      const ids = Array.isArray(data.ids) ? data.ids : []
      const changed = ids.length !== ui.count
      ui.count = ids.length
      applyArchivedIds(ids)
      return changed
    }

    function openPanel() {
      if (ui.mode) {
        ui.mode = false
        ui.selected.clear()
      }
      if (!ui.open) {
        ui.sessionsCollapsedBeforeBin = ui.sessionsCollapsed
        ui.sessionsCollapsed = true
      }
      ui.open = true
      ui.error = ''
      applyHostChrome()
      emit()
      refreshList(true)
    }

    function closePanel() {
      if (!ui.open) return
      ui.open = false
      ui.trashSelected.clear()
      ui.sessionsCollapsed = ui.sessionsCollapsedBeforeBin
      applyHostChrome()
      emit()
    }

    function togglePanel() {
      if (ui.open) closePanel()
      else openPanel()
    }

    function enterSelection() {
      if (ui.open) {
        ui.open = false
        ui.sessionsCollapsedBeforeBin = false
        ui.trashSelected.clear()
      }
      ui.mode = true
      ui.selected.clear()
      ui.sessionsCollapsed = false
      ui.error = ''
      applyHostChrome()
      emit()
    }

    function exitSelection() {
      ui.mode = false
      ui.selected.clear()
      ui.error = ''
      emit()
    }

    function toggleSelected(sessionId) {
      if (!ui.mode) return
      if (ui.selected.has(sessionId)) ui.selected.delete(sessionId)
      else ui.selected.add(sessionId)
      emit()
    }

    function toggleTrashSelected(sessionId) {
      if (ui.trashSelected.has(sessionId)) ui.trashSelected.delete(sessionId)
      else ui.trashSelected.add(sessionId)
      emit()
    }

    function toggleSelectAllTrash() {
      if (ui.items.length > 0 && ui.trashSelected.size === ui.items.length) {
        ui.trashSelected.clear()
      } else {
        ui.trashSelected = new Set(ui.items.map((item) => item.sessionId))
      }
      emit()
    }

    function pruneTrashSelection() {
      const present = new Set(ui.items.map((item) => item.sessionId))
      for (const id of [...ui.trashSelected]) {
        if (!present.has(id)) ui.trashSelected.delete(id)
      }
    }

    function openConfirm(item) {
      ui.confirmItem = item
      ui.confirmIds = [item.sessionId]
      ui.confirmBatch = false
      ui.error = ''
      emit()
    }

    function openBatchConfirm() {
      const ids = [...ui.trashSelected]
      if (ids.length === 0) return
      ui.confirmItem = null
      ui.confirmIds = ids
      ui.confirmBatch = true
      ui.error = ''
      emit()
    }

    function closeConfirm() {
      ui.confirmItem = null
      ui.confirmIds = null
      ui.confirmBatch = false
      emit()
    }

    async function archiveSelected() {
      if (ui.busy) return
      const ids = [...ui.selected]
      if (ids.length === 0) return
      ui.busy = true
      ui.error = ''
      emit()
      try {
        const data = await postJson('/archive', { sessionIds: ids, stopActivity: true })
        const results = Array.isArray(data.results) ? data.results : []
        const okIds = results.filter((entry) => entry.ok).map((entry) => entry.sessionId)
        const ok = okIds.length
        const fail = results.length - ok
        ui.mode = false
        ui.selected.clear()
        ui.notice = fail > 0
          ? { key: 'noticePartial', params: { ok, fail } }
          : { key: 'noticeArchived', params: { count: ok } }
        if (ok > 0) {
          applyArchivedIds([...new Set([...ui.archivedIds, ...okIds])])
          ui.open = true
          await refreshList(true)
        }
        try {
          await refreshIds()
        } catch {
          // Badge refresh is best-effort; the next poll retries.
        }
      } catch (error) {
        ui.error = String((error && error.message) || error)
      } finally {
        ui.busy = false
        emit()
      }
    }

    async function restoreItem(item) {
      if (ui.busy) return
      ui.busy = true
      ui.error = ''
      emit()
      try {
        const data = await postJson('/restore', { sessionIds: [item.sessionId] })
        const result = Array.isArray(data.results) ? data.results[0] : null
        if (!result || !result.ok) throw new Error((result && result.error) || 'restore failed')
        ui.trashSelected.delete(item.sessionId)
        applyArchivedIds(ui.archivedIds.filter((id) => id !== item.sessionId))
        ui.notice = { key: 'noticeRestored', params: {} }
        await refreshList(true)
        try {
          await refreshIds()
        } catch {
          // ignore
        }
      } catch (error) {
        ui.error = String((error && error.message) || error)
      } finally {
        ui.busy = false
        emit()
      }
    }

    async function confirmPurge() {
      if (ui.busy) return
      const ids = Array.isArray(ui.confirmIds)
        ? [...ui.confirmIds]
        : (ui.confirmItem ? [ui.confirmItem.sessionId] : [])
      if (ids.length === 0) return
      const batch = ui.confirmBatch || ids.length > 1
      ui.busy = true
      ui.error = ''
      emit()
      try {
        const data = await postJson('/purge', { sessionIds: ids })
        const results = Array.isArray(data.results) ? data.results : []
        const okIds = results
          .filter((entry) => entry && entry.ok && ids.includes(entry.sessionId))
          .map((entry) => entry.sessionId)
        const fail = results.filter((entry) => entry && !entry.ok).length + Math.max(0, ids.length - results.length)
        if (okIds.length === 0 && fail > 0) {
          const first = results.find((entry) => entry && !entry.ok)
          throw new Error((first && first.error) || 'purge failed')
        }
        for (const id of okIds) ui.trashSelected.delete(id)
        if (okIds.length > 0) {
          applyArchivedIds(ui.archivedIds.filter((id) => !okIds.includes(id)))
        }
        ui.confirmItem = null
        ui.confirmIds = null
        ui.confirmBatch = false
        ui.notice = fail > 0
          ? { key: 'noticePurgedPartial', params: { ok: okIds.length, fail } }
          : (batch
            ? { key: 'noticePurgedBatch', params: { count: okIds.length } }
            : { key: 'noticePurged', params: {} })
        try {
          await getService('sessions')?.refresh?.()
        } catch {
          // The session list also refreshes from the Host's own removal event.
        }
        await refreshList(true)
        try {
          await refreshIds()
        } catch {
          // ignore
        }
      } catch (error) {
        ui.error = String((error && error.message) || error)
      } finally {
        ui.busy = false
        emit()
      }
    }

    function baseName(value) {
      if (typeof value !== 'string' || value.length === 0) return ''
      const parts = value.split(/[\\/]/).filter((part) => part.length > 0)
      return parts.length > 0 ? parts[parts.length - 1] : ''
    }

    function formatTime(value) {
      const time = Number(value)
      if (!Number.isFinite(time) || time <= 0) return ''
      const date = new Date(time)
      if (Number.isNaN(date.getTime())) return ''
      if (Date.now() - time < 86_400_000) {
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      }
      return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
    }

    function metaText(item, t) {
      const rawWhere = item.workspaceTitle || baseName(item.cwd) || t('ungrouped')
      const where = rawWhere === 'default-workspace' ? t('defaultWorkspace') : rawWhere
      const when = formatTime(item.updatedAt)
      const parts = []
      if (item.missing) parts.push(t('missingLog'))
      if (where) parts.push(where)
      if (when) parts.push(when)
      return parts.join(' · ')
    }

    function icon(children, props) {
      return h('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, props || {}), children)
    }

    function IconRecycle(props) {
      return icon([
        h('path', { key: 'lid', d: 'M4 7h16' }),
        h('path', { key: 'handle', d: 'M9 7V4.5h6V7' }),
        h('path', { key: 'body', d: 'M6.5 7l1.2 12.2h8.6L17.5 7' }),
        h('path', { key: 'line1', d: 'M10 10.5v6' }),
        h('path', { key: 'line2', d: 'M14 10.5v6' }),
      ], props)
    }

    function IconSelect(props) {
      return icon([
        h('rect', { key: 'box', x: 3.5, y: 3.5, width: 17, height: 17, rx: 4.5 }),
        h('path', { key: 'check', d: 'M8 12.2l2.6 2.6 5-5.6' }),
      ], props)
    }

    function IconCheck(props) {
      return icon([h('path', { key: 'check', d: 'M5 12.4l4.1 4.1L19 6.2' })], Object.assign({ width: 11, height: 11, strokeWidth: 2.4 }, props || {}))
    }

    function IconChevronDown(props) {
      return icon([h('path', { key: 'chevron', d: 'M6 9l6 6 6-6' })], props)
    }

    function IconRestore(props) {
      return icon([
        h('path', { key: 'arc', d: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3' }),
        h('path', { key: 'head', d: 'M4.5 4.5V10h5.5' }),
      ], props)
    }

    function SelectionCircle({ sessionId, t }) {
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      if (!ui.mode) return null
      const checked = ui.selected.has(sessionId)
      const toggle = (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleSelected(sessionId)
      }
      return h('span', {
        className: 'dsr-circle',
        role: 'checkbox',
        tabIndex: 0,
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': checked ? t('selectUncheck') : t('selectCheck'),
        title: checked ? t('selectUncheck') : t('selectCheck'),
        onClick: toggle,
        onMouseDown: (event) => event.stopPropagation(),
        onPointerDown: (event) => event.stopPropagation(),
        onKeyDown: (event) => {
          if (event.key === ' ' || event.key === 'Enter') toggle(event)
        },
      }, checked ? h(IconCheck) : null)
    }

    // The footer-action outlet is turned into a column by the injected CSS, so
    // this section stacks above the shipped Cordis action. When expanded it
    // grows downward (footer bottom-pinned) and the session list collapses.
    function SessionRecycleSection({ wide, t }) {
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

      useEffect(() => {
        applyHostChrome()
      }, [ui.open, ui.sessionsCollapsed, wide])

      useEffect(() => {
        if (!wide && ui.open) closePanel()
      }, [wide, ui.open])

      useEffect(() => () => {
        if (ui.open) {
          ui.open = false
          ui.sessionsCollapsed = ui.sessionsCollapsedBeforeBin
          emit()
        }
        restoreHostChrome()
      }, [])

      const onToggle = () => {
        if (!wide) {
          try {
            getService('layout')?.toggleSidebar()
          } catch {
            // layout service is optional; the user can expand the sidebar manually
          }
          return
        }
        togglePanel()
      }

      const selectionBar = ui.mode
        ? h('div', { className: 'dsr-selection-bar', role: 'region', 'aria-label': t('selectEnter') },
          h('div', { className: 'dsr-selectbar-main' },
            h('div', { className: 'dsr-selectbar-count' }, t('selectSelected', { count: ui.selected.size })),
            h('div', { className: 'dsr-selectbar-actions' },
              h('button', {
                type: 'button',
                className: 'dsr-btn dsr-danger',
                disabled: ui.busy || ui.selected.size === 0,
                onClick: archiveSelected,
              }, ui.busy ? t('working') : t('delete')),
              h('button', {
                type: 'button',
                className: 'dsr-btn',
                disabled: ui.busy,
                onClick: exitSelection,
              }, t('cancel')))),
          h('div', { className: 'dsr-selectbar-hint' }, t('selectHint')),
          ui.error ? h('div', { className: 'dsr-error', role: 'alert' }, ui.error) : null)
        : null

      const notice = ui.notice ? t(ui.notice.key, ui.notice.params || {}) : ''
      const trashCount = ui.trashSelected.size
      const allTrashSelected = ui.items.length > 0 && trashCount === ui.items.length
      const trashToolbar = ui.items.length > 0
        ? h('div', { className: 'dsr-trash-toolbar' },
          h('button', {
            type: 'button',
            className: 'dsr-btn',
            disabled: ui.busy,
            onClick: toggleSelectAllTrash,
          }, allTrashSelected ? t('trashClearSelection') : t('trashSelectAll')),
          h('span', { className: 'dsr-trash-selected' }, t('trashSelected', { count: trashCount })),
          h('button', {
            type: 'button',
            className: 'dsr-btn dsr-danger',
            disabled: ui.busy || trashCount === 0,
            onClick: openBatchConfirm,
          }, t('trashDeleteSelected')))
        : null

      const body = ui.open
        ? h('div', { className: 'dsr-recycle-body', role: 'region', 'aria-label': t('title') },
          ui.notice ? h('div', { className: 'dsr-notice', role: 'status' }, notice) : null,
          ui.error && !ui.mode ? h('div', { className: 'dsr-error', role: 'alert' }, ui.error) : null,
          trashToolbar,
          ui.loading && ui.items.length === 0
            ? h('div', { className: 'dsr-empty' }, t('working'))
            : ui.items.length === 0
              ? h('div', { className: 'dsr-empty' }, t('empty'))
              : h('div', { className: 'dsr-list', role: 'list' }, ui.items.map((item) => {
                const checked = ui.trashSelected.has(item.sessionId)
                return h('div', {
                  className: 'dsr-row dsr-trash-row',
                  role: 'listitem',
                  key: item.sessionId,
                },
                h('span', {
                  className: 'dsr-circle dsr-trash-check',
                  role: 'checkbox',
                  tabIndex: 0,
                  'aria-checked': checked ? 'true' : 'false',
                  'aria-label': checked ? t('selectUncheck') : t('selectCheck'),
                  title: checked ? t('selectUncheck') : t('selectCheck'),
                  onClick: (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    toggleTrashSelected(item.sessionId)
                  },
                  onMouseDown: (event) => event.stopPropagation(),
                  onPointerDown: (event) => event.stopPropagation(),
                  onKeyDown: (event) => {
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      toggleTrashSelected(item.sessionId)
                    }
                  },
                }, checked ? h(IconCheck) : null),
                h('div', { className: 'dsr-row-main' },
                  h('div', {
                    className: 'dsr-row-title',
                    title: item.title || undefined,
                  }, item.title || t('untitled')),
                  h('div', { className: 'dsr-row-meta' }, metaText(item, t))),
                h('div', { className: 'dsr-row-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsr-btn',
                    disabled: ui.busy,
                    onClick: () => restoreItem(item),
                  }, h(IconRestore, { width: 13, height: 13 }), h('span', null, t('restore'))),
                  h('button', {
                    type: 'button',
                    className: 'dsr-btn dsr-danger',
                    disabled: ui.busy,
                    onClick: () => openConfirm(item),
                  }, t('purge'))))
              })),
          h('div', { className: 'dsr-foot' }, t('footNote')))
        : null

      return h('div', {
        className: 'dsr-recycle-section',
        'data-dsr-recycle-section': '',
        'data-dsr-bin-open': ui.open ? 'true' : 'false',
      },
      selectionBar,
      h('div', {
        className: wide ? 'dsr-trigger-row dsr-trigger-row-wide' : 'dsr-trigger-row',
        'data-dsr-trigger': '',
      },
      h('button', {
        type: 'button',
        className: wide ? 'dsr-trigger' : 'dsr-icon-btn',
        'data-open': ui.open ? 'true' : 'false',
        title: t('openTrash'),
        'aria-label': t('openTrash'),
        'aria-expanded': ui.open ? 'true' : 'false',
        onClick: onToggle,
      },
      h(IconRecycle, wide ? { width: 15, height: 15 } : undefined),
      wide ? h('span', { className: 'dsr-trigger-label' }, t('title')) : null,
      wide && ui.count > 0
        ? h('span', { className: 'dsr-count' }, ui.count > 99 ? '99+' : String(ui.count))
        : null,
      wide
        ? h(IconChevronDown, { className: 'dsr-chevron', width: 13, height: 13 })
        : (ui.count > 0
          ? h('span', { className: 'dsr-badge', 'aria-hidden': true }, ui.count > 99 ? '99+' : String(ui.count))
          : null))),
      body)
    }

    function OverlayLayer({ t }) {
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

      useEffect(() => {
        let stopped = false
        let inFlight = false
        const tick = async () => {
          if (inFlight) return
          inFlight = true
          try {
            const data = await postJson('/ids', {})
            if (stopped) return
            const ids = Array.isArray(data.ids) ? data.ids : []
            const changed = ids.length !== ui.count
            ui.count = ids.length
            applyArchivedIds(ids)
            if (ui.open && changed) await refreshList(true)
            else emit()
          } catch (error) {
            if (stopped) return
            ui.error = String((error && error.message) || error)
            emit()
          } finally {
            inFlight = false
          }
        }
        tick()
        const timer = window.setInterval(tick, 4000)
        return () => {
          stopped = true
          window.clearInterval(timer)
        }
      }, [])

      useEffect(() => {
        const handler = (event) => {
          if (event.key !== 'Escape') return
          if (ui.confirmItem || (ui.confirmIds && ui.confirmIds.length > 0)) {
            closeConfirm()
            return
          }
          if (ui.open) {
            closePanel()
            return
          }
          if (ui.mode) exitSelection()
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
      }, [ui.open, ui.mode, ui.confirmItem, ui.confirmIds])

      useEffect(() => {
        if (!ui.notice) return undefined
        const timer = window.setTimeout(() => {
          ui.notice = null
          emit()
        }, 3600)
        return () => window.clearTimeout(timer)
      }, [ui.notice])

      const confirmOpen = !!ui.confirmItem || (Array.isArray(ui.confirmIds) && ui.confirmIds.length > 0)
      const confirmCount = Array.isArray(ui.confirmIds) ? ui.confirmIds.length : 0
      const confirmTitle = ui.confirmBatch
        ? t('confirmBatchTitle', { count: confirmCount })
        : t('confirmTitle')
      const confirmBody = ui.confirmBatch
        ? t('confirmBatchBody', { count: confirmCount })
        : t('confirmBody', { title: (ui.confirmItem && ui.confirmItem.title) || t('untitled') })

      return confirmOpen
        ? h('div', {
          className: 'dsr-backdrop',
          onPointerDown: (event) => {
            if (event.target === event.currentTarget && !ui.busy) closeConfirm()
          },
        },
        h('div', {
          className: 'dsr-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsr-confirm-title',
        },
        h('h2', { id: 'dsr-confirm-title', className: 'dsr-dialog-title' }, confirmTitle),
        h('p', { className: 'dsr-dialog-text' }, confirmBody),
        h('p', { className: 'dsr-dialog-warn' }, t('confirmWarn')),
        ui.error ? h('p', { className: 'dsr-dialog-warn', role: 'alert' }, ui.error) : null,
        h('div', { className: 'dsr-dialog-actions' },
          h('button', {
            type: 'button',
            className: 'dsr-btn',
            autoFocus: true,
            disabled: ui.busy,
            onClick: closeConfirm,
          }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'dsr-btn dsr-danger',
            disabled: ui.busy,
            onClick: confirmPurge,
          }, ui.busy ? t('working') : t('confirmAction')))))
        : null
    }

    const CSS = `
[data-slot='sidebar.footer.action'] {
  display: flex !important; flex-direction: column; width: 100%; min-width: 0; min-height: 0;
}
.dsr-head-btn {
  width: 24px; height: 24px; padding: 0; flex: none; display: inline-flex;
  align-items: center; justify-content: center; border: 0; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; font: inherit; pointer-events: auto; position: relative; z-index: 3;
}
.dsr-head-btn[data-dsr-head-control='select'] { margin-left: auto; }
[class*='sectionHeader']:has([data-dsr-head-control='select']) [class*='searchSlot'] { margin-left: 0; }
.dsr-head-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsr-head-btn[data-active='true'] {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsr-head-btn svg { width: 14px; height: 14px; transition: transform 150ms ease; }
.dsr-head-btn[aria-expanded='false'] svg { transform: rotate(-90deg); }
[class*='sectionHeader']:has([class*='searchExpanded']) .dsr-head-btn { display: none; }
[data-dsr-sessions-collapsed='true'] [class*='listArea'] { display: none !important; }
[data-dsr-archived-hidden='true'] { display: none !important; }
.dsr-trigger-row {
  display: flex; align-items: center; justify-content: center; gap: 2px;
  width: 100%; min-width: 36px; height: 34px; padding: 0 2px; box-sizing: border-box;
}
.dsr-trigger-row-wide { justify-content: flex-start; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsr-trigger {
  display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
  height: 30px; padding: 0 8px; border: 0; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; font: inherit; font-size: 13px;
}
.dsr-trigger:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsr-trigger[data-open='true'] { color: var(--dsw-alias-label-primary); }
.dsr-trigger-label { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsr-chevron { flex: none; transition: transform 150ms ease; }
.dsr-trigger[data-open='true'] .dsr-chevron { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) {
  .dsr-chevron { transition: none; }
}
.dsr-icon-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
  font: inherit; flex: none;
}
.dsr-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsr-icon-btn[data-active='true'] {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsr-badge {
  position: absolute; top: 1px; right: 1px; min-width: 12px; height: 12px; padding: 0 3px;
  border-radius: 6px; background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base); font-size: 9px; line-height: 12px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.dsr-recycle-section {
  display: flex; flex-direction: column; width: 100%; min-height: 0; flex: none;
}
.dsr-recycle-section[data-dsr-bin-open='true'] { flex: 1 1 auto; }
.dsr-selection-bar {
  display: flex; flex-direction: column; gap: 4px; padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill); flex: none;
}
.dsr-recycle-body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 6px 0;
  color: var(--dsw-alias-label-primary);
}
.dsr-trash-toolbar {
  position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 4px;
  padding: 4px 2px 6px; background: var(--dsw-specific-sidebar-fill);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsr-trash-selected { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10.5px; white-space: nowrap; }
.dsr-trash-check { margin-right: 2px; }
.dsr-count {
  min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 18px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.dsr-notice {
  margin: 8px 10px 0; padding: 6px 8px; border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
  color: var(--dsw-alias-state-success-primary); font-size: 11px; line-height: 1.4;
}
.dsr-error {
  margin: 8px 10px 0; padding: 6px 8px; border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
  color: var(--dsw-alias-state-error-primary); font-size: 11px; line-height: 1.4;
  overflow-wrap: anywhere;
}
.dsr-list { padding: 4px 0 6px; }
.dsr-row { display: flex; align-items: center; gap: 8px; padding: 8px 6px; border-radius: 8px; }
.dsr-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsr-row-main { flex: 1; min-width: 0; }
.dsr-row-title {
  font-size: 13px; font-weight: 500; line-height: 1.35;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsr-row-meta {
  margin-top: 2px; font-size: 11px; line-height: 1.35; color: var(--dsw-alias-label-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsr-row-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.dsr-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border: 0; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
  font: inherit; font-size: 11px; line-height: 1.3; white-space: nowrap;
}
.dsr-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsr-btn:disabled { opacity: 0.45; cursor: default; }
.dsr-danger { color: var(--dsw-alias-state-error-primary); }
.dsr-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.dsr-empty { padding: 26px 14px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.dsr-foot { flex: none; padding: 7px 12px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.45; }
.dsr-selectbar-main { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsr-selectbar-count { font-size: 12.5px; font-weight: 600; min-width: 0; }
.dsr-selectbar-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.dsr-selectbar-hint { margin-top: 6px; font-size: 10.5px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
.dsr-circle {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 16px; height: 16px; padding: 0; margin: 0; box-sizing: border-box;
  border: 1.5px solid var(--dsw-alias-border-l2); border-radius: 50%;
  background: transparent; color: transparent; cursor: pointer;
  pointer-events: auto; position: relative; z-index: 1;
}
.dsr-circle:hover { border-color: var(--dsw-alias-brand-primary); }
.dsr-circle[aria-checked='true'] {
  background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.dsr-circle svg { width: 11px; height: 11px; }
.dsr-backdrop {
  position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  padding: 20px; pointer-events: auto;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
}
.dsr-dialog {
  width: min(360px, 100%); padding: 18px; border-radius: 14px;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent, 0 18px 44px color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent));
  color: var(--dsw-alias-label-primary);
}
.dsr-dialog-title { margin: 0 0 8px; font-size: 15px; font-weight: 650; line-height: 1.4; }
.dsr-dialog-text { margin: 0; font-size: 12.5px; line-height: 1.55; overflow-wrap: anywhere; }
.dsr-dialog-warn { margin: 8px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }
.dsr-dialog-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 16px; }
`

    function apply(ctx) {
      clientContext = ctx

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-session-recycle', '')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'session-recycle:styles')

      ctx.effect(() => {
        const en = ctx.locale.register(NS, 'en', EN)
        const zh = ctx.locale.register(NS, 'zh', ZH)
        return () => {
          en()
          zh()
        }
      }, 'session-recycle:dictionaries')

      ctx.effect(() => {
        removeForeignHeaderControls()
        installHeaderObserver()
        const stopStore = subscribe(scheduleHeaderSync)
        let stopLocale = () => {}
        try {
          if (ctx.locale && typeof ctx.locale.subscribe === 'function') {
            stopLocale = ctx.locale.subscribe(scheduleHeaderSync)
          }
        } catch {
          // locale subscription is best-effort
        }
        return () => {
          stopStore()
          stopLocale()
          disposeHeaderObserver()
          restoreHostChrome()
        }
      }, 'session-recycle:header-controls')

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'session-recycle',
        order: -10,
        locale: NS,
      }, SessionRecycleSection))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'session-recycle-layer',
        order: 40,
        locale: NS,
      }, OverlayLayer))

      ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
        name: 'sidebar.session.row.leading',
        id: 'session-recycle-select',
        order: 0,
        locale: NS,
      }, SelectionCircle))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})

