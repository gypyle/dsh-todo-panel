/**
 * Host half of the Todos bundle.
 *
 * Owns durable storage: the todo list is a JSON file under the DSH home
 * directory (`<DSH_HOME>/dsh-todo-panel/items.json`), so items survive app
 * restarts on any port. The browser half reads and writes the list through
 * same-origin routes registered on the connection service, following the
 * pattern of shipped marketplace plugins.
 */
import { homedir } from 'node:os'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTES = {
  get: '/api/dsh-todo-panel/items',
  put: '/api/dsh-todo-panel/items.save',
}
const ITEMS_MAX = 1000
const TEXT_MAX = 500
const READ_RETRY_MS = 100
const READ_TRIES = 100

function dshHome() {
  const set = process.env.DSH_HOME?.trim()
  return set ? set : join(homedir(), '.dsh')
}

function dataFile() {
  return join(dshHome(), 'dsh-todo-panel', 'items.json')
}

/** IDs need only be unique strings; keep them short and char-safe. */
function cleanId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null
}

/** Coerce one stored entry into a well-formed todo; null drops it. */
function cleanTodo(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, TEXT_MAX) : ''
  if (text === '') return null
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    id: cleanId(raw.id) ?? 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    text,
    done: raw.done === true,
    createdAt: number(raw.createdAt) ?? Date.now(),
    dueAt: number(raw.dueAt),
    doneAt: number(raw.doneAt),
  }
}

/** Coerce a stored list; null means the file was unreadable or invalid. */
function readItems() {
  let raw
  try {
    raw = readFileSync(dataFile(), 'utf8')
  } catch (error) {
    // No file yet is a legitimate empty list (first use), not a failure.
    if (error?.code === 'ENOENT') return []
    return null
  }
  const parsed = JSON.parse(raw)
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null
  if (list === null) return null
  return list.slice(0, ITEMS_MAX).map(cleanTodo).filter((item) => item !== null)
}

/** Atomic write: the temp file sits beside the data file, so rename cannot
 *  cross volumes. A crash mid-write leaves the previous list intact. */
function writeItems(items) {
  const file = dataFile()
  mkdirSync(join(file, '..'), { recursive: true })
  const temp = file + '.tmp'
  writeFileSync(temp, JSON.stringify({ v: 1, items }), 'utf8')
  renameSync(temp, file)
}

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

function registerRoutes(register) {
  register({
    // The connection API allows only GET/HEAD/POST; saving is a POST with a
    // distinct endpoint path, following the shipped marketplace plugins.
    path: ROUTES.get,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const items = readItems()
      return items === null ? json({ error: 'unreadable' }, 500) : json({ items })
    },
  })
  register({
    path: ROUTES.put,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await request.json().catch(() => null)
      if (body === null || typeof body !== 'object' || !Array.isArray(body.items)) {
        return json({ error: 'not a list' }, 400)
      }
      const items = body.items.slice(0, ITEMS_MAX).map(cleanTodo).filter((item) => item !== null)
      try {
        writeItems(items)
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 500)
      }
      return json({ items })
    },
  })
}

/**
 * Register the storage routes while this profile has a connection service.
 * Re-registering after a reload can briefly conflict with the previous
 * activation, so registration retries on an "already registered" error.
 * @param ctx - host context providing `inject` and effects.
 * @returns cleanup through ctx.effect registration.
 */
export function apply(ctx) {
  ctx.inject?.(['connection'], (sub) => {
    let timer
    let gone = false
    // `fetch.register` resolves to an asynchronous disposer; keep the
    // promises and await them at teardown, so a route registered a moment
    // before disposal still comes off the shared channel.
    const disposers = new Set()
    const settle = (promise) => {
      promise.then((dispose) => { try { dispose?.() } catch { /* best effort */ } }).catch(() => {})
    }
    sub.effect?.(() => () => {
      gone = true
      clearTimeout(timer)
      for (const promise of [...disposers]) settle(promise)
      disposers.clear()
    }, 'dsh-todo-panel: storage routes')
    const attempt = (left) => {
      if (gone) return
      const rolling = []
      try {
        registerRoutes((route) => {
          const disposer = Promise.resolve(sub.connection.fetch.register(route))
          disposers.add(disposer)
          rolling.push(disposer)
          return disposer
        })
      } catch (error) {
        // Roll this attempt's partial registration back before any retry so a
        // later attempt starts from a clean route table.
        for (const promise of rolling) {
          disposers.delete(promise)
          settle(promise)
        }
        const message = String(error?.message ?? error)
        if (left > 1 && /already registered/i.test(message)) timer = setTimeout(() => attempt(left - 1), READ_RETRY_MS)
        else ctx.logger?.warn?.(`dsh-todo-panel: storage routes: ${message}`)
      }
    }
    attempt(READ_TRIES)
  })
}
