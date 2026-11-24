// dsh-todo-panel: browser half — the sidebar Todos panel.
//
// Registers the panel icon into `sidebar.panellist` (id `todos`) and the page
// into the keyed `main` slot under the same id, plus one zh/en dictionary and
// a package-owned stylesheet. Items live in a Host-owned JSON file; time hints
// re-render from a shared 30s clock.
//
// The load id must equal the composed entry id: the package name, scope
// included.
window.__ModuleLoader__.load({
  id: '@guoyle/dsh-todo-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const PLUGIN = 'dsh-todo-panel'
    const NS = 'dsh-todo-panel'
    const PANEL_ID = 'todos'
    const TEXT_LIMIT = 500

    // ---------------------------------------------------------------- locales

    const zh = {
      'panel': '待办',
      'title': '待办事项',
      'composer.aria': '新待办内容',
      'composer.placeholder': '添加一条待办…',
      'composer.dueLabel': '截止时间（可选）',
      'composer.clearDue': '清除截止时间',
      'composer.clear': '清除时间',
      'composer.add': '添加',
      'filter.group': '筛选',
      'filter.all': '全部',
      'filter.active': '未办',
      'filter.done': '已办',
      'item.markDone': '把“{text}”标为已办',
      'item.markActive': '把“{text}”恢复为未办',
      'item.delete': '删除“{text}”',
      'empty.title': '没有待办事项',
      'empty.body': '在上方输入内容，回车或点击“添加”。',
      'empty.active': '没有未办的待办事项。',
      'empty.done': '没有已办的待办事项。',
      'summary': '未办 {active} · 已办 {done}',
      'due.overdue': '已逾期 {duration}',
      'due.soon': '{duration}后到期',
      'due.today': '今天 {clock}',
      'due.tomorrow': '明天 {clock}',
      'due.later': '{date} {clock}',
      'due.invalid': '截止时间无法识别，请重新选择。',
      'duration.minute': '{n} 分钟',
      'duration.hour': '{n} 小时',
      'duration.day': '{n} 天',
      'storage.readError': '待办数据读取失败：列表暂按空显示，数据文件中的内容可能仍在。',
      'storage.writeError': '待办保存失败：数据文件不可用或请求未成功。',
      'menu.execute': '在工作空间中执行',
      'menu.defaultWorkspace': '默认工作区',
      'prompt.due': '（截止时间：{time}）',
    }

    const en = {
      'panel': 'Todos',
      'title': 'Todos',
      'composer.aria': 'New todo text',
      'composer.placeholder': 'Add a todo…',
      'composer.dueLabel': 'Due time (optional)',
      'composer.clearDue': 'Clear the due time',
      'composer.clear': 'Clear time',
      'composer.add': 'Add',
      'filter.group': 'Filter',
      'filter.all': 'All',
      'filter.active': 'Active',
      'filter.done': 'Done',
      'item.markDone': 'Mark "{text}" as done',
      'item.markActive': 'Restore "{text}" to active',
      'item.delete': 'Delete "{text}"',
      'empty.title': 'No todos yet',
      'empty.body': 'Type above and press Enter or Add.',
      'empty.active': 'No active todos.',
      'empty.done': 'No completed todos.',
      'summary': '{active} active · {done} done',
      'due.overdue': 'Overdue by {duration}',
      'due.soon': 'Due in {duration}',
      'due.today': 'Today {clock}',
      'due.tomorrow': 'Tomorrow {clock}',
      'due.later': '{date} {clock}',
      'due.invalid': 'The due time could not be read; pick it again.',
      'duration.minute': '{n} min',
      'duration.hour': '{n} h',
      'duration.day': '{n} d',
      'storage.readError': 'Stored todos could not be read; the list shows empty, but the data file may still hold your items.',
      'storage.writeError': 'Cannot save todos: the data file is unavailable or the request failed.',
      'menu.execute': 'Execute in workspace',
      'menu.defaultWorkspace': 'Default workspace',
      'prompt.due': '(due {time})',
    }

    // ---------------------------------------------------------------- storage

    // Same-origin API served by this package's Host half; relative paths keep
    // working across the app's changing local ports, and the browser session
    // cookie authorizes the calls. Saving is a POST because the connection
    // API owns only GET/HEAD/POST on its exact routes.
    const API = {
      get: 'api/dsh-todo-panel/items',
      save: 'api/dsh-todo-panel/items.save',
    }

    let idCounter = 0
    function createId() {
      idCounter += 1
      return 't' + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 8)
    }

    function sanitizeItems(value) {
      if (!Array.isArray(value)) return null
      const items = []
      for (const raw of value.slice(0, 1000)) {
        if (raw === null || typeof raw !== 'object') continue
        const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, TEXT_LIMIT) : ''
        if (text === '') continue
        items.push({
          id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : createId(),
          text,
          done: raw.done === true,
          createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
          dueAt: typeof raw.dueAt === 'number' && Number.isFinite(raw.dueAt) ? raw.dueAt : null,
          doneAt: typeof raw.doneAt === 'number' && Number.isFinite(raw.doneAt) ? raw.doneAt : null,
        })
      }
      return items
    }

    /** Fetch the stored list; throws for any transport or server failure. */
    async function fetchItems() {
      const response = await fetch(`/${API.get}`, { headers: { 'cache-control': 'no-store' } })
      if (!response.ok) throw new Error(`GET items: HTTP ${response.status}`)
      const sanitized = sanitizeItems((await response.json()).items)
      if (sanitized === null) throw new Error('GET items: invalid payload')
      return sanitized
    }

    /** Persist the whole list; throws for any transport or server failure. */
    async function putItems(items) {
      const response = await fetch(`/${API.save}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!response.ok) throw new Error(`save items: HTTP ${response.status}`)
    }

    /**
     * Serialize saves into one chain: each change writes the newest list once
     * the previous write settles, so a slow earlier request can never
     * overwrite a newer list. The boolean tells whether the newest write
     * settled successfully.
     */
    function createSaver() {
      let chain = Promise.resolve()
      return (items) => {
        const settled = chain.then(() => putItems(items))
        // Swallow failures here: they are reported through the returned state
        // and must not break the chain for later writes.
        chain = settled.catch(() => {})
        return settled.then(() => true, () => false)
      }
    }

    // ------------------------------------------------------------------ time

    const MINUTE = 60 * 1000
    const HOUR = 60 * MINUTE
    const DAY = 24 * HOUR

    /**
     * Date/time formatters cached per locale, read through `getLocale` at call
     * time so clock and date text follow the active UI language (the same
     * source the dictionaries use) instead of the browser locale.
     */
    function createTimeFormatters(getLocale) {
      const cache = new Map()
      const of = () => {
        const locale = getLocale()
        if (!cache.has(locale)) {
          cache.set(locale, {
            clock: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
            day: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
            dayYear: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
            full: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
          })
        }
        return cache.get(locale)
      }
      return {
        clock: (time) => of().clock.format(time),
        day: (time) => of().day.format(time),
        dayYear: (time) => of().dayYear.format(time),
        full: (time) => of().full.format(time),
      }
    }
    function sameLocalDay(a, b) {
      const da = new Date(a)
      const db = new Date(b)
      return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
    }
    function humanizeDuration(ms, t) {
      const minutes = Math.max(1, Math.round(ms / MINUTE))
      if (minutes < 60) return t('duration.minute', { n: minutes })
      const hours = Math.round(minutes / 60)
      if (hours < 48) return t('duration.hour', { n: hours })
      return t('duration.day', { n: Math.round(hours / 24) })
    }

    /**
     * Localized due-time hint for one moment. The warn tone escalates through
     * the last day: within the last hour the text counts the remainder, and a
     * same-day or nearly-tomorrow deadline keeps its clock text in warn.
     * @returns tone `overdue` | `soon` | `normal` | `muted` with the display text.
     */
    function dueInfo(dueAt, now, t, time) {
      if (dueAt <= now) return { tone: 'overdue', text: t('due.overdue', { duration: humanizeDuration(now - dueAt, t) }) }
      const until = dueAt - now
      if (until <= HOUR) return { tone: 'soon', text: t('due.soon', { duration: humanizeDuration(until, t) }) }
      const clock = time.clock(dueAt)
      if (sameLocalDay(dueAt, now)) return { tone: 'soon', text: t('due.today', { clock }) }
      if (sameLocalDay(dueAt, now + DAY)) return { tone: until <= DAY ? 'soon' : 'normal', text: t('due.tomorrow', { clock }) }
      const date = new Date(dueAt).getFullYear() === new Date(now).getFullYear()
        ? time.day(dueAt)
        : time.dayYear(dueAt)
      return { tone: 'muted', text: t('due.later', { date, clock }) }
    }

    function compareTodos(a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (a.done) return (b.doneAt ?? 0) - (a.doneAt ?? 0)
      const ad = a.dueAt ?? Number.POSITIVE_INFINITY
      const bd = b.dueAt ?? Number.POSITIVE_INFINITY
      if (ad !== bd) return ad - bd
      return (b.createdAt ?? 0) - (a.createdAt ?? 0)
    }

    // ----------------------------------------------------------------- glyphs

    function ClockGlyph({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 8, cy: 8, r: 6.2, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M8 4.6V8l2.5 1.7', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function CloseGlyph() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3.6 3.6l6.8 6.8M10.4 3.6l-6.8 6.8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    /** Sidebar row icon: clipboard with a check, in currentColor. */
    function PanelIcon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('path', {
          fill: 'currentColor', fillRule: 'evenodd',
          d: 'M7 5h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z'
            + 'm1.25 3.5h7.5a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5v-7a1.5 1.5 0 0 1 1.5-1.5Z',
        }),
        h('path', {
          fill: 'currentColor',
          d: 'M10.2 2.5h3.6a1.2 1.2 0 0 1 1.2 1.2v1.65a1.2 1.2 0 0 1-1.2 1.2h-3.6A1.2 1.2 0 0 1 9 5.35V3.7a1.2 1.2 0 0 1 1.2-1.2Z',
        }),
        h('path', {
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
          d: 'm8.7 13.7 2.2 2.2 4.3-4.8',
        }))
    }

    // ------------------------------------------------------------- components

    function DueLabel({ todo, now, t, time }) {
      if (todo.dueAt == null) return null
      const info = dueInfo(todo.dueAt, now, t, time)
      return h('span', {
        className: 'dtp-due',
        'data-tone': todo.done ? 'muted' : info.tone,
        title: time.full(todo.dueAt),
      }, h(ClockGlyph, { size: 12 }), info.text)
    }

    function TodoRow({ todo, now, t, time, menu, onToggle, onRemove }) {
      // Framework menu gestures for this row (right-click, ContextMenu key,
      // Shift+F10). The target is a lazy thunk so the captured todo is fresh
      // at gesture time.
      const trigger = menu == null ? {} : menu.getTriggerProps(() => ({
        kind: 'todo',
        value: { id: todo.id, text: todo.text, dueAt: todo.dueAt },
      }))
      return h('li', {
        ...trigger,
        className: todo.done ? 'dtp-row dtp-row-done' : 'dtp-row',
        'aria-haspopup': 'menu',
      },
        h('input', {
          type: 'checkbox',
          className: 'dtp-check',
          checked: todo.done,
          onChange: () => { onToggle(todo.id) },
          'aria-label': t(todo.done ? 'item.markActive' : 'item.markDone', { text: todo.text }),
        }),
        h('div', { className: 'dtp-row-main' },
          h('div', { className: 'dtp-row-text' }, todo.text),
          todo.dueAt == null ? null : h(DueLabel, { todo, now, t, time })),
        h('button', {
          type: 'button',
          className: 'dtp-remove',
          onClick: () => { onRemove(todo.id) },
          'aria-label': t('item.delete', { text: todo.text }),
        }, h(CloseGlyph)))
    }

    function EmptyState({ t, kind }) {
      return h('div', { className: 'dtp-empty' },
        h('svg', { width: 48, height: 48, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
          h('path', { d: 'M7 5h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }),
          h('path', { d: 'M9 5.35V3.7a1.2 1.2 0 0 1 1.2-1.2h3.6A1.2 1.2 0 0 1 15 3.7v1.65', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }),
          h('path', { d: 'm8.7 13.7 2.2 2.2 4.3-4.8', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', strokeLinejoin: 'round' })),
        h('div', { className: 'dtp-empty-title' },
          kind === 'active' ? t('empty.active') : kind === 'done' ? t('empty.done') : t('empty.title')),
        kind === 'all' ? h('div', { className: 'dtp-empty-body' }, t('empty.body')) : null)
    }

    /** The Todos page registered under the panel id in the keyed `main` slot. */
    function TodosPage(props) {
      const t = props.t
      const time = props.time
      // Framework context-menu bindings for this panel (undefined when the
      // context-menu plugin is absent; the panel degrades to right-click-free).
      const menu = typeof props.useContextMenu === 'function' ? props.useContextMenu() : null
      // The stored list arrives from the Host API; until the first read settles
      // the page shows its shell with an empty list area instead of flashing
      // wrong empty-state copy.
      const [items, setItems] = useState([])
      const [loading, setLoading] = useState(true)
      const [filter, setFilter] = useState('active')
      const [draft, setDraft] = useState('')
      const [draftDue, setDraftDue] = useState('')
      // 'read' marks an unreadable stored list; 'write' a failed save.
      const [storageNotice, setStorageNotice] = useState(null)
      const [now, setNow] = useState(() => Date.now())
      const textInput = useRef(null)
      const dueInvalid = draftDue !== '' && Number.isNaN(new Date(draftDue).getTime())

      // Load the authoritative list once per mount; a disposed page ignores
      // the late answer.
      useEffect(() => {
        let alive = true
        fetchItems()
          .then((stored) => { if (alive) { setItems(stored); setLoading(false) } })
          .catch(() => { if (alive) { setLoading(false); setStorageNotice('read') } })
        return () => { alive = false }
      }, [])

      // One shared clock so due hints stay current while the page is open.
      useEffect(() => {
        const timer = setInterval(() => { setNow(Date.now()) }, 30 * 1000)
        return () => { clearInterval(timer) }
      }, [])

      // Saves run through one chained queue: each write carries the newest
      // list, settles after earlier writes, and its outcome refreshes the
      // notice. A failed write never breaks the queue for later changes.
      const saver = useMemo(() => createSaver(), [])
      const persist = useCallback((next) => {
        setItems(next)
        saver(next).then((saved) => { setStorageNotice(saved ? null : 'write') })
      }, [saver])

      const add = useCallback((event) => {
        if (event) event.preventDefault()
        if (loading) return
        const text = draft.trim()
        if (text === '') return
        let dueAt = null
        if (draftDue !== '') {
          const parsed = new Date(draftDue).getTime()
          // Keep the whole draft so the inline notice can name the field to fix.
          if (Number.isNaN(parsed)) return
          dueAt = parsed
        }
        persist([{ id: createId(), text, done: false, createdAt: Date.now(), dueAt, doneAt: null }, ...items])
        setDraft('')
        setDraftDue('')
        if (textInput.current != null) textInput.current.focus()
      }, [loading, draft, draftDue, items, persist])

      const toggle = useCallback((id) => {
        persist(items.map((item) => item.id === id
          ? { ...item, done: !item.done, doneAt: item.done ? null : Date.now() }
          : item))
      }, [items, persist])

      const remove = useCallback((id) => {
        persist(items.filter((item) => item.id !== id))
      }, [items, persist])

      const counts = useMemo(() => {
        let active = 0
        let done = 0
        for (const item of items) {
          if (item.done) done += 1
          else active += 1
        }
        return { active, done }
      }, [items])

      const visible = useMemo(() => items
        .filter((item) => filter === 'all' ? true : filter === 'done' ? item.done : !item.done)
        .sort(compareTodos), [items, filter])

      const filters = [
        { id: 'all', label: t('filter.all'), count: counts.active + counts.done },
        { id: 'active', label: t('filter.active'), count: counts.active },
        { id: 'done', label: t('filter.done'), count: counts.done },
      ]

      return h('div', { className: 'dtp-page' },
        h('div', { className: 'dtp-scroll' },
          h('div', { className: 'dtp-content' },
            h('header', { className: 'dtp-heading' },
              h('h1', null, t('title')),
              h('div', { className: 'dtp-summary' }, t('summary', { active: counts.active, done: counts.done }))),
            h('form', { className: 'dtp-composer', onSubmit: add },
              h('input', {
                ref: textInput,
                type: 'text',
                className: 'dtp-input dtp-text',
                value: draft,
                maxLength: TEXT_LIMIT,
                autoComplete: 'off',
                placeholder: t('composer.placeholder'),
                'aria-label': t('composer.aria'),
                onChange: (event) => { setDraft(event.target.value) },
              }),
              h('div', { className: 'dtp-due-field', title: t('composer.dueLabel') },
                h('input', {
                  type: 'datetime-local',
                  className: 'dtp-input dtp-due',
                  value: draftDue,
                  'aria-label': t('composer.dueLabel'),
                  onChange: (event) => { setDraftDue(event.target.value) },
                }),
                draftDue === '' ? null : h('button', {
                  type: 'button',
                  className: 'dtp-clear',
                  onClick: () => { setDraftDue('') },
                  'aria-label': t('composer.clearDue'),
                }, h(CloseGlyph))),
              h('button', { type: 'submit', className: 'dtp-add', disabled: loading || draft.trim() === '' || dueInvalid }, t('composer.add'))),
            dueInvalid
              ? h('p', { className: 'dtp-input-error', role: 'alert' }, t('due.invalid'))
              : storageNotice === null ? null
                : h('p', { className: 'dtp-storage-error', role: 'alert' },
                  t(storageNotice === 'read' ? 'storage.readError' : 'storage.writeError')),
            h('div', { className: 'dtp-filters', role: 'group', 'aria-label': t('filter.group') },
              filters.map((entry) => h('button', {
                key: entry.id,
                type: 'button',
                className: 'dtp-filter',
                'aria-pressed': filter === entry.id ? 'true' : 'false',
                onClick: () => { setFilter(entry.id) },
              }, entry.label, h('span', { className: 'dtp-count' }, String(entry.count))))),
            // While the stored list loads, keep the shell without list
            // content or empty-state copy, which would flash wrong text.
            visible.length === 0
              ? (loading ? null : h(EmptyState, { t, kind: items.length === 0 ? 'all' : filter }))
              : h('ul', { className: 'dtp-list' },
                visible.map((todo) => h(TodoRow, { key: todo.id, todo, now, t, time, menu, onToggle: toggle, onRemove: remove }))))))
    }

    // ------------------------------------------------------------------ apply

    /**
     * Register the dictionary, the stylesheet, the sidebar panel icon, and the
     * panel page. All registrations live on this plugin's context and are
     * removed with it; `slots.inject` re-runs them whenever the owning
     * declaration is re-mounted.
     * @param ctx - client context providing `slots` and `locale`.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-todo-panel: dictionaries')
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const id = PLUGIN + '/panel.css'
        if (document.querySelector('style[data-plugin-css="' + id + '"]') != null) return () => {}
        const tag = document.createElement('style')
        tag.dataset.pluginCss = id
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, 'dsh-todo-panel: styles')

      const t = ctx.locale.bind(NS)
      // Formatters follow the active UI locale, read at call time so a locale
      // switch re-renders fresh clock and date text together with the new `t`.
      const time = createTimeFormatters(() => ctx.locale.getSnapshot().active)
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        // After plugins (0), Automation tasks (10), and Artifacts (20).
        order: 30,
        locale: NS,
        label: () => t('panel'),
      }, PanelIcon))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ time }),
      }, TodosPage))

      // Right-click "execute in workspace": one menu contribution for the
      // `todo` target family. It registers only while the framework context
      // menu, the workspace list, and the session-start API are all present,
      // and unregisters with any of them or with this plugin. Each workspace
      // listed in the submenu starts a new conversation in that workspace with
      // the captured todo as the ready-to-send prompt.
      if (typeof ctx.inject === 'function') {
        ctx.inject(['contextMenus', 'uiWorkspace', 'workspaces'], (sub) => {
          const { contextMenus, uiWorkspace, workspaces } = sub
          // Automatic first-use title in every language; mirrors the pure
          // `workspaceDisplayTitle` fold the host sidebar applies to its rows.
          const DEFAULT_WORKSPACE_DIRECTORY = 'default-workspace'
          /** Sidebar-consistent label for one workspace row. */
          const labelOf = (workspace) => workspace.title === DEFAULT_WORKSPACE_DIRECTORY
            ? t('menu.defaultWorkspace')
            : workspace.title
          /** Ready-to-send prompt for one captured todo, with its deadline. */
          const promptOf = (todo) => todo.dueAt == null || typeof todo.dueAt !== 'number'
            ? todo.text
            : `${todo.text}\n${t('prompt.due', { time: time.full(todo.dueAt) })}`
          sub.effect(() => contextMenus.register({
            id: 'execute', target: 'todo', order: 100,
            // Re-resolve while the menu is open so workspace changes surface.
            observe: () => [workspaces.list],
            resolve: (todo) => {
              const prompt = promptOf(todo)
              return [{
                id: 'execute',
                label: t('menu.execute'),
                children: workspaces.list.getSnapshot().items.map((workspace) => ({
                  id: `ws/${encodeURIComponent(workspace.workspaceId)}`,
                  label: labelOf(workspace),
                  run: () => {
                    uiWorkspace.startSession(workspace.workspaceId, { prompt, whenDraftExists: 'append' })
                  },
                })),
              }]
            },
          }), 'dsh-todo-panel: execute-in-workspace menu')
        })
      }
    }

    // ------------------------------------------------------------------ style

    const CSS = `
.dtp-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-size: 14px;
  line-height: 1.6;
}

.dtp-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  --dsh-scrollbar-width: 9px;
  --dsh-scrollbar-thumb-border: 2px;
}

.dtp-content {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 clamp(24px, 4vw, 48px) 48px;
}

@media (max-width: 767px) {
  .dtp-content { padding-inline: 20px; }
}

@media (pointer: coarse) {
  .dtp-input { font-size: 16px; }
}

.dtp-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
  padding-top: 28px;
  margin-bottom: 20px;
}

[data-platform='darwin'] .dtp-heading {
  padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px));
}

.dtp-heading h1 {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
}

.dtp-summary {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 20px;
}

.dtp-composer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.dtp-input {
  height: 32px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  padding: 0 12px;
}

.dtp-input::placeholder { color: var(--dsw-alias-label-tertiary); }

.dtp-text { flex: 1 1 140px; min-width: 0; }

.dtp-due-field {
  position: relative;
  flex: 0 1 160px;
  min-width: 150px;
  display: flex;
}

.dtp-due { width: 100%; color-scheme: light dark; padding-right: 26px; }

.dtp-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dtp-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dtp-add {
  height: 32px;
  flex: none;
  border: 0;
  border-radius: 16px;
  padding: 0 16px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.dtp-add:disabled { opacity: 0.5; cursor: default; }
.dtp-add:not(:disabled):hover { filter: brightness(1.06); }

.dtp-filters {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  margin-bottom: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
}

.dtp-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 999px;
  padding: 3px 12px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
}

.dtp-filter:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dtp-filter[aria-pressed='true'] {
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
}

.dtp-count { color: var(--dsw-alias-label-caption); font-size: 12px; }

.dtp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dtp-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-lg);
  /* Framework context-menu gestures (right-click) are bound to the row. */
  cursor: context-menu;
}

.dtp-row:hover { background: var(--dsw-alias-interactive-bg-hover); }

.dtp-check {
  appearance: none;
  -webkit-appearance: none;
  flex: none;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  border: 1.5px solid var(--dsw-alias-label-tertiary);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-content: center;
}

.dtp-check:hover { border-color: var(--dsw-alias-label-secondary); }

.dtp-check:checked {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
}

.dtp-check:checked::after {
  content: '';
  width: 9px;
  height: 5px;
  border-left: 2px solid var(--dsw-alias-label-primary-foreground);
  border-bottom: 2px solid var(--dsw-alias-label-primary-foreground);
  transform: translateY(-1px) rotate(-45deg);
}

.dtp-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dtp-row-text { word-break: break-word; white-space: pre-wrap; }

.dtp-row-done .dtp-row-text {
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
}

.dtp-due {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 1px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}

.dtp-due svg { flex: none; }

.dtp-due[data-tone='overdue'] { color: var(--dsw-alias-state-error-primary); }
.dtp-due[data-tone='soon'] { color: var(--dsw-alias-state-warn-primary); }
.dtp-due[data-tone='muted'] { color: var(--dsw-alias-label-caption); }

.dtp-row-done .dtp-due,
.dtp-row-done .dtp-due[data-tone='overdue'],
.dtp-row-done .dtp-due[data-tone='soon'],
.dtp-row-done .dtp-due[data-tone='muted'] {
  color: var(--dsw-alias-label-caption);
}

.dtp-remove {
  flex: none;
  width: 28px;
  height: 28px;
  margin: -2px -4px -2px 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  opacity: 0;
}

.dtp-row:hover .dtp-remove,
.dtp-row:focus-within .dtp-remove { opacity: 1; }

@media (hover: none) {
  .dtp-remove { opacity: 1; }
}

.dtp-remove:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dtp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 24px;
  text-align: center;
}

.dtp-empty svg { color: var(--dsw-alias-label-tertiary); }

.dtp-empty-title {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.dtp-empty-body {
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dtp-input-error,
.dtp-storage-error {
  margin: -8px 0 12px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-state-warn-primary);
}

.dtp-input:focus-visible,
.dtp-filter:focus-visible,
.dtp-clear:focus-visible,
.dtp-add:focus-visible,
.dtp-remove:focus-visible,
.dtp-check:focus-visible,
.dtp-row:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color);
  outline-offset: 2px;
}
`

    return { inject: ['slots', 'locale'], apply }
  },
})
