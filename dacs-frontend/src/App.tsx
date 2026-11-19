import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Database,
  Eye,
  FileSearch,
  GitBranch,
  HardDrive,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  Menu,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'

type Section = 'overview' | 'sources' | 'chats' | 'policies' | 'dependencies' | 'recommendations' | 'archive'
type SourceRecord = { id: string; name: string }
type ImplState = 'NOT_RUN' | 'FIRST_RUN_DONE' | string
type ImplRecord = { id: string; name: string; config: string; state: ImplState; sourceId: string }
type ApiPage<T> = { items: T[]; totalElements: number | null; totalPages: number }
type CursorPage<T> = { items: T[]; nextCursor: string | null; hasMore: boolean }
type ChatRecord = { id: string; title: string; createdAt: string; updatedAt: string }
type MessageRecord = { id: string; chatId: string; role: 'USER' | 'AGENT' | string; content: string; edited: boolean; createdAt: string; updatedAt: string }
type DataState = {
  sources: SourceRecord[]
  implementations: ImplRecord[]
  sourcesTotal: number
  implementationsTotal: number
  loading: boolean
  error: string
  errorKind: 'auth' | 'network' | 'server' | ''
}

type ErrorKind = DataState['errorKind']

function errorKindOf(error: unknown): ErrorKind {
  return error instanceof ApiError ? error.kind : 'server'
}

const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const GATEWAY_ORIGIN = (import.meta.env.VITE_GATEWAY_ORIGIN || 'http://localhost:8765').replace(/\/$/, '')
const KEYCLOAK_LOGIN_URL = `${GATEWAY_ORIGIN}/oauth2/authorization/keycloak`

const navigation: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { id: 'sources', label: 'Источники данных', icon: Database },
  { id: 'chats', label: 'Диалоги', icon: MessageSquare },
  { id: 'policies', label: 'Политики хранения', icon: Settings2 },
  { id: 'dependencies', label: 'Граф зависимостей', icon: GitBranch },
  { id: 'recommendations', label: 'Рекомендации', icon: FileSearch },
  { id: 'archive', label: 'Архив', icon: Archive },
]

class ApiError extends Error {
  kind: ErrorKind
  constructor(message: string, kind: ErrorKind) {
    super(message)
    this.kind = kind
  }
}

async function requestResponse(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      redirect: 'manual',
      headers,
    })
  } catch {
    throw new ApiError('Не удалось связаться с Vite proxy или Gateway. Проверьте, что Gateway запущен на localhost:8765 и frontend запущен через npm run dev.', 'network')
  }

  if (response.status === 401 || response.status === 403 || response.status === 302 || response.status === 303 || response.type === 'opaqueredirect') {
    throw new ApiError('Gateway требует авторизацию. Выполните вход через Keycloak и повторите запрос.', 'auth')
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ApiError(`Core вернул HTTP ${response.status}${detail ? `: ${detail.slice(0, 220)}` : ''}`, 'server')
  }
  return response
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestResponse(path, init)
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('Content-Type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError('Вместо JSON получен другой тип ответа. Возможно, Gateway перенаправил запрос на страницу авторизации.', 'auth')
  }
  try {
    return await response.json() as T
  } catch {
    throw new ApiError('Сервер вернул некорректный JSON.', 'server')
  }
}

async function requestVoid(path: string, init: RequestInit = {}): Promise<void> {
  await requestResponse(path, init)
}

function normalizePage<T>(payload: unknown): ApiPage<T> {
  if (Array.isArray(payload)) return { items: payload as T[], totalElements: payload.length, totalPages: 1 }
  if (!payload || typeof payload !== 'object') throw new Error('Неожиданная структура ответа API.')
  const object = payload as Record<string, unknown>
  const rows = Array.isArray(object.content) ? object.content : Array.isArray(object.items) ? object.items : null
  if (!rows) throw new Error('В ответе API не найден список content/items.')
  return {
    items: rows as T[],
    totalElements: typeof object.totalElements === 'number' ? object.totalElements : rows.length,
    totalPages: typeof object.totalPages === 'number' ? object.totalPages : 1,
  }
}

async function loadAllPages<T>(path: string): Promise<ApiPage<T>> {
  const separator = path.includes('?') ? '&' : '?'
  const first = normalizePage<T>(await requestJson<unknown>(`${path}${separator}page=0`))
  if (first.totalPages <= 1) return first
  const remaining = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      requestJson<unknown>(`${path}${separator}page=${index + 1}`).then(normalizePage<T>),
    ),
  )
  const items = [...first.items, ...remaining.flatMap((page) => page.items)]
  return { items, totalElements: first.totalElements ?? items.length, totalPages: first.totalPages }
}

async function loadSourceData() {
  const [sourcesPage, implPage] = await Promise.all([
    loadAllPages<SourceRecord>('/api/sources'),
    loadAllPages<ImplRecord>('/api/impls'),
  ])
  return {
    sources: sourcesPage.items,
    implementations: implPage.items,
    sourcesTotal: sourcesPage.totalElements ?? sourcesPage.items.length,
    implementationsTotal: implPage.totalElements ?? implPage.items.length,
  }
}

function useSourceData() {
  const [state, setState] = useState<DataState>({
    sources: [], implementations: [], sourcesTotal: 0, implementationsTotal: 0, loading: true, error: '', errorKind: '',
  })

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '', errorKind: '' }))
    try {
      const data = await loadSourceData()
      setState({ ...data, loading: false, error: '', errorKind: '' })
    } catch (error) {
      const apiError = error instanceof ApiError
        ? error
        : new ApiError(error instanceof Error ? error.message : 'Не удалось прочитать ответ API.', 'server')
      setState((current) => ({ ...current, loading: false, error: apiError.message, errorKind: apiError.kind }))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  return { ...state, refresh }
}

function Brand() {
  return <Link className="brand" to="/" aria-label="DACS — главная"><span className="brand-mark"><span /></span><span className="brand-word">DACS<span className="brand-dot">.</span></span></Link>
}

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function Sidebar({ active, onChange, mobileOpen, onClose }: {
  active: Section
  onChange: (section: Section) => void
  mobileOpen: boolean
  onClose: () => void
}) {
  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-head"><Brand /><IconButton label="Закрыть меню" onClick={onClose}><X size={18} /></IconButton></div>
        <div className="workspace-identity"><span className="workspace-avatar">D</span><span className="workspace-switch-copy"><strong>Рабочее пространство</strong><small>Локальная среда DACS</small></span></div>
        <div className="sidebar-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="main-nav" aria-label="Основная навигация">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${active === id ? 'active' : ''}`} onClick={() => { onChange(id); onClose() }} type="button">
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-label">АККАУНТ</div>
        <Link className="nav-item nav-link-item" to="/login"><LogIn size={17} /><span>Войти</span><ArrowUpRight size={13} className="nav-external" /></Link>
        <Link className="nav-item nav-link-item" to="/register"><Plus size={17} /><span>Регистрация</span><ArrowUpRight size={13} className="nav-external" /></Link>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><ShieldCheck size={16} /><div><strong>Контроль данных</strong><p>Подключите источники, чтобы начать работу с системой.</p></div></div>
          <div className="sidebar-profile"><div className="user-avatar">D</div><div className="user-meta"><strong>Сессия Gateway</strong><small>Пользователь определяется после входа</small></div></div>
        </div>
      </aside>
    </>
  )
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: ReactNode; description: string; action?: ReactNode }) {
  return (
    <section className="page-heading-row">
      <div><div className="overline"><span className="overline-line" /> {eyebrow}</div><h1>{title}</h1><p className="page-lead">{description}</p></div>
      {action}
    </section>
  )
}

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Database }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon lime"><Icon size={17} /></span></div><div className="metric-value metric-value-compact">{value}</div><div className="metric-foot"><span className="metric-hint">{hint}</span></div></article>
}

function ApiNotice({ kind, message, onRetry }: { kind: ErrorKind; message: string; onRetry: () => void }) {
  return (
    <div className={`api-notice ${kind || 'server'}`} role="status">
      <AlertCircle size={19} />
      <div><strong>{kind === 'auth' ? 'Требуется авторизация' : kind === 'network' ? 'API недоступно' : 'Не удалось получить данные'}</strong><p>{message}</p>{kind === 'auth' && <a className="api-login-link" href={KEYCLOAK_LOGIN_URL} target="_blank" rel="noreferrer"><LogIn size={14} /> Открыть вход через Keycloak</a>}</div>
      <button className="button button-light" type="button" onClick={onRetry}><RefreshCw size={14} /> Повторить</button>
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, description, action }: { icon: typeof Database; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-panel"><div className="empty-icon"><Icon size={22} /></div><h3>{title}</h3><p>{description}</p>{action}</div>
}

function Overview({ data, onNavigate }: { data: ReturnType<typeof useSourceData>; onNavigate: (section: Section) => void }) {
  const pending = data.implementations.filter((item) => item.state === 'NOT_RUN').length
  return (
    <>
      <PageHeading
        eyebrow="ПАНЕЛЬ УПРАВЛЕНИЯ"
        title={<>Контроль старения <span>данных.</span></>}
        description="Рабочее пространство для контроля источников и жизненного цикла корпоративных данных."
        action={<Link className="button button-dark" to="/login"><LogIn size={16} /> Войти в систему <ArrowRight size={15} /></Link>}
      />
      {data.error && <ApiNotice kind={data.errorKind} message={data.error} onRetry={() => void data.refresh()} />}
      <section className="metrics-grid" aria-label="Доступные показатели системы">
        <StatCard label="Типы источников" value={data.loading ? '…' : data.error ? '—' : String(data.sourcesTotal)} hint="Каталог из Core API" icon={Database} />
        <StatCard label="Конфигурации подключений" value={data.loading ? '…' : data.error ? '—' : String(data.implementationsTotal)} hint="Реализации из Core API" icon={HardDrive} />
        <StatCard label="Ожидают первого запуска" value={data.loading ? '…' : data.error ? '—' : String(pending)} hint="Статус NOT_RUN" icon={Activity} />
        <StatCard label="Аналитика старения" value="—" hint="Метрики пока не предоставляются API" icon={FileSearch} />
      </section>
      <section className="overview-grid">
        <article className="panel overview-start-panel">
          <div className="panel-kicker">НАЧАЛО РАБОТЫ</div>
          <h2>Сначала подключите данные.</h2>
          <p>После настройки источников и запуска сборщиков можно перейти к работе с подключениями и сохранёнными диалогами.</p>
          <div className="setup-steps">
            <div className="setup-step"><span>01</span><div><strong>Проверьте каталог источников</strong><small>Доступные типы хранилищ из Core</small></div><Check size={16} className="step-check" /></div>
            <div className="setup-step"><span>02</span><div><strong>Создайте конфигурацию подключения</strong><small>Укажите имя, тип источника и JSON-конфигурацию</small></div><ArrowRight size={16} /></div>
            <div className="setup-step"><span>03</span><div><strong>Отправьте запрос на сбор</strong><small>Core принимает запрос и публикует событие в Kafka</small></div><ArrowRight size={16} /></div>
          </div>
          <button className="button button-dark" type="button" onClick={() => onNavigate('sources')}>Перейти к источникам <ArrowRight size={15} /></button>
        </article>
        <article className="panel overview-analytics-panel">
          <div className="panel-kicker">СОСТОЯНИЕ СИСТЕМЫ</div>
          <h2>Аналитика пока не сформирована</h2>
          <div className="empty-analytics-visual"><div className="empty-analytics-circle"><Activity size={31} /></div><span className="analytics-orbit orbit-a"/><span className="analytics-orbit orbit-b"/></div>
          <p>Текущие контроллеры Core предоставляют каталог источников, конфигурации сборщиков, команды запуска и API сохранения диалогов. Метрики объёма, старения и рекомендации пока не представлены.</p>
          <span className="data-honesty-label"><ShieldCheck size={14} /> Показаны только доступные данные</span>
        </article>
      </section>
      <section className="panel overview-sources-panel">
        <div className="panel-header"><div><div className="panel-kicker">CORE API</div><h2>Каталог источников</h2><p>Типы источников, доступные для конфигурирования.</p></div><button className="text-action" type="button" onClick={() => onNavigate('sources')}>Открыть источники <ArrowRight size={14} /></button></div>
        {data.loading ? <div className="loading-row">Загружаем каталог источников…</div> : data.sources.length ? <div className="source-chip-list">{data.sources.map((source) => <span className="source-chip" key={source.id}><Database size={14} />{source.name}</span>)}</div> : <div className="loading-row">Каталог не получен. Проверьте соединение с Core API.</div>}
      </section>
      <section className="panel connected-endpoints-panel">
        <div className="panel-kicker">ПОДКЛЮЧЁННЫЕ API</div>
        <div className="endpoint-summary-grid"><span><Check size={14} /> Источники и конфигурации</span><span><Check size={14} /> CRUD подключений</span><span><Check size={14} /> Запуск сборщика</span><span><Check size={14} /> Диалоги и сообщения</span></div>
      </section>
    </>
  )
}

function ImplDialog({ sources, existing, onClose, onSaved }: { sources: SourceRecord[]; existing?: ImplRecord; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(existing)
  const [name, setName] = useState(existing?.name ?? '')
  const [sourceId, setSourceId] = useState(existing?.sourceId ?? sources[0]?.id ?? '')
  const [config, setConfig] = useState(existing?.config ?? '{\n  \n}')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) { setError('Укажите название подключения.'); return }
    if (name.length > 255) { setError('Название не должно превышать 255 символов.'); return }
    try { JSON.parse(config) } catch { setError('Конфигурация должна быть корректным JSON.'); return }
    if (!editing && !sourceId) { setError('Выберите тип источника.'); return }
    setSaving(true)
    try {
      if (existing) {
        await requestJson<ImplRecord>(`/api/impls/${existing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: name.trim(), config, state: existing.state }),
        })
      } else {
        await requestJson<ImplRecord>('/api/impls', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), config, sourceId, state: 'NOT_RUN' }),
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить конфигурацию.')
    } finally { setSaving(false) }
  }

  const sourceLabel = sources.find((source) => source.id === sourceId)?.name ?? sourceId
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="impl-dialog-title">
        <div className="dialog-header"><div><div className="panel-kicker">{editing ? 'ИЗМЕНЕНИЕ КОНФИГУРАЦИИ' : 'НОВАЯ КОНФИГУРАЦИЯ'}</div><h2 id="impl-dialog-title">{editing ? 'Редактировать подключение' : 'Добавить подключение'}</h2></div><IconButton label="Закрыть" onClick={onClose}><X size={18} /></IconButton></div>
        <form className="impl-form" onSubmit={submit}>
          <label htmlFor="impl-name">Название</label><input id="impl-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={255} placeholder="Например, Production DB" required />
          <label htmlFor="impl-source">Тип источника</label>
          {editing ? <input id="impl-source" value={sourceLabel} readOnly disabled /> : <select id="impl-source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} required>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>}
          <label htmlFor="impl-config">Конфигурация (JSON)</label><textarea id="impl-config" value={config} onChange={(event) => setConfig(event.target.value)} rows={8} placeholder={'{\n  "host": "",\n  "port": 5432\n}'} required />
          <p className="form-help">Формат JSON зависит от сборщика. Состояние и тип источника при редактировании сохраняются текущими. Не вставляйте реальные пароли или production-секреты в локальную форму.</p>
          {error && <div className="auth-feedback error-feedback" role="alert">{error}</div>}
          <div className="dialog-actions"><button className="button button-light" type="button" onClick={onClose}>Отмена</button><button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Сохранение…' : editing ? 'Сохранить изменения' : 'Создать конфигурацию'} <ArrowRight size={15} /></button></div>
        </form>
      </section>
    </div>
  )
}

function ImplDetailsDialog({ implementation, sourceName, onClose }: { implementation: ImplRecord; sourceName: string; onClose: () => void }) {
  let prettyConfig = implementation.config
  try { prettyConfig = JSON.stringify(JSON.parse(implementation.config), null, 2) } catch { /* keep the exact returned value */ }
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="create-dialog details-dialog" role="dialog" aria-modal="true" aria-labelledby="impl-details-title">
        <div className="dialog-header"><div><div className="panel-kicker">GET /API/IMPLS/{implementation.id}</div><h2 id="impl-details-title">{implementation.name}</h2></div><IconButton label="Закрыть" onClick={onClose}><X size={18} /></IconButton></div>
        <div className="detail-meta"><div><small>Тип источника</small><strong>{sourceName}</strong></div><div><small>Состояние</small><strong>{implementation.state}</strong></div><div><small>ID</small><strong className="detail-id">{implementation.id}</strong></div></div>
        <label className="detail-config-label">Конфигурация JSON</label><pre className="detail-config">{prettyConfig}</pre>
        <div className="dialog-actions"><button className="button button-dark" type="button" onClick={onClose}>Закрыть</button></div>
      </section>
    </div>
  )
}

function SourcesPage({ data }: { data: ReturnType<typeof useSourceData> }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ImplRecord | undefined>()
  const [details, setDetails] = useState<ImplRecord | undefined>()
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [filteredImplementations, setFilteredImplementations] = useState<ImplRecord[] | null>(null)
  const [filterLoading, setFilterLoading] = useState(false)
  const [filterError, setFilterError] = useState('')
  const [actionId, setActionId] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const sourceName = useMemo(() => new Map(data.sources.map((source) => [source.id, source.name])), [data.sources])
  const notRun = data.implementations.filter((item) => item.state === 'NOT_RUN').length
  const visibleImplementations = filteredImplementations ?? data.implementations

  const refreshVisible = async () => {
    await data.refresh()
    if (selectedSourceId) {
      try {
        const page = await loadAllPages<ImplRecord>(`/api/impls/by-source/${selectedSourceId}`)
        setFilteredImplementations(page.items)
      } catch (error) {
        setFilterError(error instanceof Error ? error.message : 'Не удалось обновить список по источнику.')
      }
    }
  }

  const changeSourceFilter = async (sourceId: string) => {
    setSelectedSourceId(sourceId)
    setFilterError('')
    if (!sourceId) { setFilteredImplementations(null); return }
    setFilterLoading(true)
    try {
      const page = await loadAllPages<ImplRecord>(`/api/impls/by-source/${sourceId}`)
      setFilteredImplementations(page.items)
    } catch (error) {
      setFilterError(error instanceof Error ? error.message : 'Не удалось отфильтровать подключения.')
      setFilteredImplementations([])
    } finally { setFilterLoading(false) }
  }

  const openDetails = async (id: string) => {
    setActionId(id)
    setActionError('')
    try {
      const result = await requestJson<ImplRecord>(`/api/impls/${id}`)
      setDetails(result)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось загрузить конфигурацию.')
    } finally { setActionId('') }
  }

  const deleteImplementation = async (item: ImplRecord) => {
    if (!window.confirm(`Удалить подключение «${item.name}»? Это действие нельзя отменить.`)) return
    setActionId(item.id)
    setActionError('')
    setActionNotice('')
    try {
      await requestVoid(`/api/impls/${item.id}`, { method: 'DELETE' })
      setActionNotice(`Подключение «${item.name}» удалено.`)
      await refreshVisible()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось удалить подключение.')
    } finally { setActionId('') }
  }

  const runCollection = async (item: ImplRecord) => {
    setActionId(item.id)
    setActionError('')
    setActionNotice('')
    try {
      await requestVoid(`/api/collect/${item.id}/run`, { method: 'POST' })
      setActionNotice(`Core принял запрос на запуск «${item.name}» (HTTP 202). Фактическое выполнение зависит от доступности Kafka и Agent consumer.`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось отправить запрос на запуск.')
    } finally { setActionId('') }
  }

  return (
    <>
      <PageHeading eyebrow="ИНФРАСТРУКТУРА" title={<>Источники <span>данных.</span></>} description="Каталог поддерживаемых типов и полный набор действий для реализаций подключений." action={<button className="button button-dark" type="button" onClick={() => setDialogOpen(true)} disabled={!data.sources.length}><Plus size={16} /> Добавить подключение</button>} />
      {data.error && <ApiNotice kind={data.errorKind} message={data.error} onRetry={() => void refreshVisible()} />}
      {actionError && <div className="action-feedback error-feedback" role="alert"><AlertCircle size={15} />{actionError}<button type="button" onClick={() => setActionError('')} aria-label="Закрыть"><X size={14} /></button></div>}
      {actionNotice && <div className="action-feedback success-feedback" role="status"><Check size={15} />{actionNotice}<button type="button" onClick={() => setActionNotice('')} aria-label="Закрыть"><X size={14} /></button></div>}
      <section className="metrics-grid source-metrics-grid">
        <StatCard label="Типы источников" value={data.loading ? '…' : data.error ? '—' : String(data.sourcesTotal)} hint="GET /api/sources" icon={Database} />
        <StatCard label="Конфигурации" value={data.loading ? '…' : data.error ? '—' : String(data.implementationsTotal)} hint="GET /api/impls" icon={HardDrive} />
        <StatCard label="Ожидают запуска" value={data.loading ? '…' : data.error ? '—' : String(notRun)} hint="state: NOT_RUN" icon={Activity} />
        <StatCard label="Первый запуск выполнен" value={data.loading ? '…' : data.error ? '—' : String(data.implementations.filter((item) => item.state === 'FIRST_RUN_DONE').length)} hint="state: FIRST_RUN_DONE" icon={Check} />
      </section>
      <section className="panel source-catalog-panel">
        <div className="panel-header"><div><div className="panel-kicker">СПРАВОЧНИК CORE</div><h2>Поддерживаемые типы источников</h2><p>Каталог загружается из `GET /api/sources`.</p></div><IconButton label="Обновить каталог" onClick={() => void refreshVisible()}><RefreshCw size={16} /></IconButton></div>
        {data.loading ? <div className="loading-row">Загрузка каталога…</div> : data.sources.length ? <div className="source-type-grid">{data.sources.map((source) => <article className="source-type-card" key={source.id}><div className="source-type-icon"><Database size={19} /></div><div><strong>{source.name}</strong><small>ID: {source.id}</small></div></article>)}</div> : <EmptyPanel icon={Database} title="Каталог источников не получен" description="Проверьте авторизацию, доступность Core и ответ GET /api/sources." />}
      </section>
      <section className="panel implementations-panel">
        <div className="panel-header impl-panel-heading"><div><div className="panel-kicker">НАСТРОЕННЫЕ ПОДКЛЮЧЕНИЯ</div><h2>Реализации источников</h2><p>Просмотр, создание, изменение, удаление и запуск через существующие Core endpoints.</p></div><button className="button button-light" type="button" onClick={() => void refreshVisible()} disabled={data.loading || filterLoading}><RefreshCw size={14} /> Обновить</button></div>
        <div className="impl-toolbar"><label htmlFor="impl-source-filter">Фильтр по типу источника</label><div className="impl-filter-select"><select id="impl-source-filter" value={selectedSourceId} onChange={(event) => void changeSourceFilter(event.target.value)}><option value="">Все источники</option>{data.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select><ChevronDown size={14} /></div><span className="impl-result-count">{filterLoading ? 'Загрузка…' : `${visibleImplementations.length} записей`}</span></div>
        {filterError && <div className="action-feedback error-feedback" role="alert">{filterError}</div>}
        {data.loading || filterLoading ? <div className="loading-row">Загрузка конфигураций…</div> : visibleImplementations.length ? <div className="impl-table-wrap"><table className="impl-table"><thead><tr><th>Название</th><th>Тип</th><th>Состояние</th><th>Действия</th></tr></thead><tbody>{visibleImplementations.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td>{sourceName.get(item.sourceId) ?? 'Неизвестный sourceId'}</td><td><span className={`impl-state ${item.state === 'FIRST_RUN_DONE' ? 'done' : 'pending'}`}>{item.state === 'FIRST_RUN_DONE' ? 'Первый запуск выполнен' : item.state === 'NOT_RUN' ? 'Не запускалась' : item.state}</span></td><td><div className="impl-row-actions"><IconButton label="Открыть детали" disabled={actionId === item.id} onClick={() => void openDetails(item.id)}><Eye size={15} /></IconButton><IconButton label="Редактировать" onClick={() => { setEditing(item); setDialogOpen(true) }}><Pencil size={15} /></IconButton><IconButton label="Запустить сбор" disabled={actionId === item.id} onClick={() => void runCollection(item)}><Play size={15} /></IconButton><IconButton label="Удалить" disabled={actionId === item.id} onClick={() => void deleteImplementation(item)}><Trash2 size={15} /></IconButton></div></td></tr>)}</tbody></table></div> : <EmptyPanel icon={HardDrive} title={selectedSourceId ? 'Для этого типа подключений нет' : 'Подключения ещё не настроены'} description={selectedSourceId ? 'Выберите другой тип источника или сбросьте фильтр.' : 'Создайте конфигурацию реализации источника. После этого запись появится в списке из Core API.'} action={!selectedSourceId ? <button className="button button-dark" type="button" onClick={() => setDialogOpen(true)} disabled={!data.sources.length}><Plus size={15} /> Добавить подключение</button> : <button className="button button-light" type="button" onClick={() => void changeSourceFilter('')}>Сбросить фильтр</button>} />}
      </section>
      {dialogOpen && <ImplDialog sources={data.sources} existing={editing} onClose={() => { setDialogOpen(false); setEditing(undefined) }} onSaved={() => { void refreshVisible(); setEditing(undefined) }} />}
      {details && <ImplDetailsDialog implementation={details} sourceName={sourceName.get(details.sourceId) ?? details.sourceId} onClose={() => setDetails(undefined)} />}
    </>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function ChatsPage() {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [chatCursor, setChatCursor] = useState<string | null>(null)
  const [hasMoreChats, setHasMoreChats] = useState(false)
  const [chatListLoading, setChatListLoading] = useState(true)
  const [selectedChat, setSelectedChat] = useState<ChatRecord | null>(null)
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState<ErrorKind>('')
  const [notice, setNotice] = useState('')

  const loadChats = useCallback(async (cursor?: string | null, append = false) => {
    setChatListLoading(true)
    setError('')
    setErrorKind('')
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('cursor', cursor)
      const page = await requestJson<CursorPage<ChatRecord>>(`/api/chats?${params.toString()}`)
      setChats((current) => append ? [...current, ...page.items] : page.items)
      setChatCursor(page.nextCursor)
      setHasMoreChats(page.hasMore)
    } catch (err) {
      setErrorKind(errorKindOf(err))
      setError(err instanceof Error ? err.message : 'Не удалось загрузить диалоги.')
    } finally { setChatListLoading(false) }
  }, [])

  const loadMessages = useCallback(async (chatId: string, cursor?: string | null, append = false) => {
    setMessagesLoading(true)
    setError('')
    setErrorKind('')
    try {
      const params = new URLSearchParams({ limit: '40' })
      if (cursor) params.set('cursor', cursor)
      const page = await requestJson<CursorPage<MessageRecord>>(`/api/chats/${chatId}/messages?${params.toString()}`)
      setMessages((current) => append ? [...current, ...page.items] : page.items)
      setMessageCursor(page.nextCursor)
      setHasMoreMessages(page.hasMore)
    } catch (err) {
      setErrorKind(errorKindOf(err))
      setError(err instanceof Error ? err.message : 'Не удалось загрузить сообщения.')
    } finally { setMessagesLoading(false) }
  }, [])

  useEffect(() => { void loadChats() }, [loadChats])

  const openChat = async (chat: ChatRecord) => {
    setSelectedChat(chat)
    setMessages([])
    setEditingId(null)
    try {
      const detail = await requestJson<ChatRecord>(`/api/chats/${chat.id}`)
      setSelectedChat(detail)
    } catch (err) {
      setErrorKind(errorKindOf(err))
      setError(err instanceof Error ? err.message : 'Не удалось открыть диалог.')
      return
    }
    await loadMessages(chat.id)
  }

  const startNewChat = () => {
    setSelectedChat(null)
    setMessages([])
    setMessageCursor(null)
    setHasMoreMessages(false)
    setEditingId(null)
    setComposer('')
    setError('')
    setNotice('Новый диалог будет создан после отправки первого сообщения.')
  }

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = composer.trim()
    if (!content) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      if (!selectedChat) {
        // POST /api/chats creates a chat and stores the first USER message atomically.
        const created = await requestJson<ChatRecord>('/api/chats', { method: 'POST', body: JSON.stringify({ content }) })
        setComposer('')
        setSelectedChat(created)
        setMessages([])
        await Promise.all([loadChats(), loadMessages(created.id)])
        setNotice('Диалог создан и первое сообщение сохранено в Core API. Автоматический ответ агента этим endpoint не выполняется.')
      } else {
        await requestJson<MessageRecord>(`/api/chats/${selectedChat.id}/messages`, { method: 'POST', body: JSON.stringify({ content }) })
        setComposer('')
        await Promise.all([loadMessages(selectedChat.id), loadChats()])
        setNotice('Сообщение сохранено. Core API сохраняет историю; генерация ответа агента не входит в этот endpoint.')
      }
    } catch (err) {
      setErrorKind(errorKindOf(err))
      setError(err instanceof Error ? err.message : 'Не удалось отправить сообщение.')
    } finally { setSending(false) }
  }

  const deleteChat = async (chat: ChatRecord) => {
    if (!window.confirm(`Удалить диалог «${chat.title}» и все его сообщения?`)) return
    setError('')
    try {
      await requestVoid(`/api/chats/${chat.id}`, { method: 'DELETE' })
      if (selectedChat?.id === chat.id) startNewChat()
      await loadChats()
      setNotice('Диалог удалён.')
    } catch (err) {
      setErrorKind(errorKindOf(err))
      setError(err instanceof Error ? err.message : 'Не удалось удалить диалог.')
    }
  }

  const beginEdit = (message: MessageRecord) => {
    setEditingId(message.id)
    setEditContent(message.content)
    setError('')
  }

  const saveEdit = async (message: MessageRecord, index: number) => {
    const content = editContent.trim()
    if (!content || !selectedChat) return
    if ((index < messages.length - 1 || hasMoreMessages) && !window.confirm('Backend удаляет все сообщения, созданные после редактируемого. Продолжить?')) return
    setEditSaving(true)
    setError('')
    try {
      await requestJson<MessageRecord>(`/api/chats/${selectedChat.id}/messages/${message.id}`, {
        method: 'PATCH', body: JSON.stringify({ content }),
      })
      setEditingId(null)
      await loadMessages(selectedChat.id)
      setNotice('Сообщение обновлено. Более поздние сообщения удаляются backend согласно его текущей логике редактирования.')
    } catch (err) {
      setErrorKind(errorKindOf(err))
      setError(err instanceof Error ? err.message : 'Не удалось изменить сообщение.')
    } finally { setEditSaving(false) }
  }

  const deleteMessage = async (message: MessageRecord) => {
    if (!selectedChat) return
    if (!window.confirm('Удалить это сообщение?')) return
    setError('')
    try {
      await requestVoid(`/api/chats/${selectedChat.id}/messages/${message.id}`, { method: 'DELETE' })
      await loadMessages(selectedChat.id)
      setNotice('Сообщение удалено из истории.')
    } catch (err) {
      setErrorKind(errorKindOf(err))
      setError(err instanceof Error ? err.message : 'Не удалось удалить сообщение.')
    }
  }

  return (
    <>
      <PageHeading eyebrow="СООБЩЕНИЯ CORE API" title={<>Диалоги <span>и история.</span></>} description="Список диалогов и сохранение сообщений через существующие endpoints Core. Это хранилище переписки, не AI-чат: автоматический ответ агента API пока не реализует." action={<button className="button button-dark" type="button" onClick={startNewChat}><Plus size={16} /> Новый диалог</button>} />
      {error && <ApiNotice kind={errorKind} message={error} onRetry={() => selectedChat ? void loadMessages(selectedChat.id) : void loadChats()} />}
      {notice && <div className="action-feedback success-feedback" role="status"><Check size={15} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Закрыть"><X size={14} /></button></div>}
      <section className="chats-layout">
        <aside className="panel chats-list-panel">
          <div className="panel-header"><div><div className="panel-kicker">GET /API/CHATS</div><h2>Ваши диалоги</h2><p>Список ограничен курсорной пагинацией.</p></div><IconButton label="Обновить диалоги" onClick={() => void loadChats()}><RefreshCw size={15} /></IconButton></div>
          {chatListLoading && chats.length === 0 ? <div className="loading-row">Загрузка диалогов…</div> : chats.length ? <div className="chat-list">{chats.map((chat) => <div className={`chat-list-item ${selectedChat?.id === chat.id ? 'selected' : ''}`} key={chat.id}><button type="button" className="chat-list-select" onClick={() => void openChat(chat)}><MessageSquare size={15} /><span><strong>{chat.title || 'Новый диалог'}</strong><small>{formatDate(chat.updatedAt)}</small></span></button><IconButton label="Удалить диалог" onClick={() => void deleteChat(chat)}><Trash2 size={14} /></IconButton></div>)}</div> : <EmptyPanel icon={MessageSquare} title="Диалогов пока нет" description="Отправьте первое сообщение, чтобы создать диалог в Core." />}
          {hasMoreChats && <button className="button button-light load-more-button" type="button" disabled={chatListLoading} onClick={() => void loadChats(chatCursor, true)}>{chatListLoading ? 'Загрузка…' : 'Загрузить ещё диалоги'}</button>}
        </aside>
        <section className="panel chat-thread-panel">
          <div className="panel-header chat-thread-heading"><div><div className="panel-kicker">{selectedChat ? `ДИАЛОГ ${selectedChat.id.slice(0, 8)}` : 'НОВОЕ ОБРАЩЕНИЕ'}</div><h2>{selectedChat?.title ?? 'Начать диалог'}</h2><p>{selectedChat ? `Создан ${formatDate(selectedChat.createdAt)}` : 'Первое отправленное сообщение создаст новый диалог.'}</p></div>{selectedChat && <span className="chat-id-label">{selectedChat.id}</span>}</div>
          <div className="chat-message-list">
            {messagesLoading && messages.length === 0 ? <div className="loading-row">Загрузка сообщений…</div> : messages.length ? <>
              {hasMoreMessages && <button className="button button-light load-more-button" type="button" disabled={messagesLoading} onClick={() => selectedChat && void loadMessages(selectedChat.id, messageCursor, true)}>{messagesLoading ? 'Загрузка…' : 'Загрузить ещё сообщения'}</button>}
              {messages.map((message, index) => <article className={`stored-message ${message.role === 'AGENT' ? 'agent-message' : 'user-message'}`} key={message.id}>
                <div className="stored-message-top"><span>{message.role === 'AGENT' ? 'DACS Agent' : 'Вы'}{message.edited ? ' · изменено' : ''}</span><time>{formatDate(message.createdAt)}</time></div>
                {editingId === message.id ? <div className="message-edit-form"><textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={3} /><div><button className="button button-light" type="button" onClick={() => setEditingId(null)}>Отмена</button><button className="button button-dark" type="button" disabled={editSaving || !editContent.trim()} onClick={() => void saveEdit(message, index)}>{editSaving ? 'Сохранение…' : 'Сохранить'}</button></div><small>По текущей логике Core сообщения после редактируемого будут удалены.</small></div> : <p>{message.content}</p>}
                {message.role === 'USER' && editingId !== message.id && <div className="stored-message-actions"><button type="button" onClick={() => beginEdit(message)}><Pencil size={12} /> Изменить</button><button type="button" onClick={() => void deleteMessage(message)}><Trash2 size={12} /> Удалить</button></div>}
              </article>)}
            </> : <div className="chat-empty-state"><div className="empty-icon"><MessageSquare size={22} /></div><h3>{selectedChat ? 'Сообщений пока нет' : 'История появится здесь'}</h3><p>{selectedChat ? 'Отправьте сообщение, чтобы добавить его в этот диалог.' : 'Core создаёт новый диалог вместе с первым сообщением.'}</p></div>}
          </div>
          <form className="chat-composer" onSubmit={submitMessage}><textarea value={composer} onChange={(event) => setComposer(event.target.value)} rows={3} placeholder={selectedChat ? 'Напишите сообщение…' : 'Введите первое сообщение для нового диалога…'} /><div className="chat-composer-footer"><span>{selectedChat ? 'POST /api/chats/{id}/messages' : 'POST /api/chats — создаёт диалог и первое сообщение'}</span><button className="button button-dark" type="submit" disabled={sending || !composer.trim()}>{sending ? 'Отправка…' : selectedChat ? 'Отправить' : 'Создать диалог'} <Send size={14} /></button></div></form>
          <div className="chat-api-note"><AlertCircle size={14} /> Core сохраняет USER-сообщения и поддерживает редактирование/удаление. Генерация ответа AI/Agent на текущем backend не реализована.</div>
        </section>
      </section>
    </>
  )
}

const unavailableSections: Record<Exclude<Section, 'overview' | 'sources' | 'chats'>, { eyebrow: string; title: string; description: string; icon: typeof Settings2; status: string; detail: string }> = {
  policies: { eyebrow: 'УПРАВЛЕНИЕ', title: 'Политики хранения.', description: 'Правила актуальности, архивирования и удаления данных.', icon: Settings2, status: 'API не обнаружено в текущем Core', detail: 'В текущем наборе контроллеров Core нет endpoint-ов для чтения и настройки политик хранения.' },
  dependencies: { eyebrow: 'КАРТА ДАННЫХ', title: 'Граф зависимостей.', description: 'Связи между источниками, наборами данных и процессами.', icon: GitBranch, status: 'API не обнаружено в текущем Core', detail: 'Для построения графа нужен API, который возвращает узлы и связи. В текущем наборе контроллеров Core такой endpoint отсутствует.' },
  recommendations: { eyebrow: 'АНАЛИТИКА', title: 'Рекомендации.', description: 'Обоснованные действия по управлению жизненным циклом данных.', icon: FileSearch, status: 'API не обнаружено в текущем Core', detail: 'Core пока не предоставляет API рекомендаций. Мы не показываем фиктивные рекомендации или приоритеты.' },
  archive: { eyebrow: 'ЖИЗНЕННЫЙ ЦИКЛ', title: 'Архив.', description: 'Управление данными, подготовленными к архивированию.', icon: Archive, status: 'API не обнаружено в текущем Core', detail: 'В текущем наборе контроллеров нет endpoint-ов для просмотра архива и управления архивными объектами.' },
}

function UnavailablePage({ section }: { section: Exclude<Section, 'overview' | 'sources' | 'chats'> }) {
  const config = unavailableSections[section]
  const Icon = config.icon
  return (
    <>
      <PageHeading eyebrow={config.eyebrow} title={<>{config.title.replace('.', '')} <span>.</span></>} description={config.description} />
      <section className="panel unavailable-panel"><div className="unavailable-icon"><Icon size={25} /></div><span className="unavailable-status">{config.status}</span><h2>Раздел пока не подключён.</h2><p>{config.detail}</p><div className="unavailable-foot"><ShieldCheck size={15} /> Здесь появятся реальные данные после реализации соответствующего API.</div></section>
    </>
  )
}

function AssistantPanel({ onOpenChats }: { onOpenChats: () => void }) {
  const [recentChats, setRecentChats] = useState<ChatRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const refreshRecentChats = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const page = await requestJson<CursorPage<ChatRecord>>('/api/chats?limit=4')
      setRecentChats(page.items ?? [])
    } catch (error) {
      setRecentChats([])
      setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить диалоги.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshRecentChats()
    const refreshOnFocus = () => { void refreshRecentChats() }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [refreshRecentChats])

  return (
    <aside className="assistant-card assistant-compact">
      <div className="assistant-header">
        <div className="assistant-avatar"><MessageSquare size={17} /></div>
        <div><strong>История Core</strong><span><i className="status-dot-muted" /> Хранение сообщений</span></div>
        <IconButton label="Обновить последние диалоги" onClick={() => void refreshRecentChats()} disabled={loading}><RefreshCw size={14} /></IconButton>
      </div>
      <div className="assistant-compact-intro">
        <span className="assistant-hello">CHAT API</span>
        <h3>Последние диалоги</h3>
        <p>Сохранённая история переписки из Core API.</p>
      </div>
      <div className="assistant-recent-list">
        {loading ? <div className="assistant-compact-state">Загружаем диалоги…</div> : loadError ? (
          <div className="assistant-compact-state assistant-compact-error">
            <span>{loadError}</span>
            <a href={KEYCLOAK_LOGIN_URL} target="_blank" rel="noreferrer">Войти через Keycloak</a>
          </div>
        ) : recentChats.length ? recentChats.map((chat) => (
          <button className="assistant-recent-item" type="button" key={chat.id} onClick={onOpenChats}>
            <span className="assistant-recent-icon"><MessageSquare size={14} /></span>
            <span className="assistant-recent-copy"><strong>{chat.title && chat.title !== 'New chat' ? chat.title : `Диалог ${chat.id.slice(0, 8)}`}</strong><small>{formatDate(chat.updatedAt)}</small></span>
            <ArrowRight size={14} />
          </button>
        )) : (
          <div className="assistant-compact-state">Сохранённых диалогов пока нет.</div>
        )}
      </div>
      <div className="assistant-compact-footer">
        <span><AlertCircle size={13} /> Core хранит сообщения, но пока не генерирует AI-ответы.</span>
        <button className="button button-dark" type="button" onClick={onOpenChats}>Все диалоги <ArrowRight size={13} /></button>
      </div>
    </aside>
  )
}

function HomePage() {
  const [active, setActive] = useState<Section>('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showAssistant, setShowAssistant] = useState(true)
  const data = useSourceData()
  const activeLabel = navigation.find((item) => item.id === active)?.label ?? 'Обзор'
  const selectSection = (section: Section) => setActive(section)
  return (
    <div className="app-shell">
      <Sidebar active={active} onChange={selectSection} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <main className="workspace">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Открыть меню"><Menu size={19} /></button><span className="breadcrumb">DACS</span><span className="breadcrumb-separator">/</span><strong>{activeLabel}</strong></div><div className="topbar-actions"><span className={`system-status ${data.error ? 'api-offline' : ''}`}><i />{data.loading ? 'Проверка API' : data.error ? 'Нет соединения с API' : 'Gateway API'}</span><Link className="topbar-login" to="/login">Войти <ArrowUpRight size={13} /></Link><button className="topbar-user" type="button" onClick={() => setShowAssistant((value) => !value)} aria-label="Показать или скрыть панель диалогов"><MessageSquare size={17} /></button></div></header>
        <div className={`workspace-content ${showAssistant && active !== 'chats' ? '' : 'workspace-content-wide'}`}>
          <div className="main-column">
            {active === 'overview' ? <Overview data={data} onNavigate={selectSection} /> : active === 'sources' ? <SourcesPage data={data} /> : active === 'chats' ? <ChatsPage /> : <UnavailablePage section={active} />}
            <footer className="workspace-footer"><span>© DACS · Контроль старения данных</span><span>Данные из Core API либо честное пустое состояние</span></footer>
          </div>
          {showAssistant && active !== 'chats' && <AssistantPanel onOpenChats={() => selectSection('chats')} />}
        </div>
      </main>
    </div>
  )
}

function AuthArtwork({ mode }: { mode: 'login' | 'register' }) {
  return (
    <section className="auth-artwork">
      <div className="art-topline"><span className="art-index">DACS / DATA INTELLIGENCE</span><span className="art-coordinate">DATA LIFECYCLE MANAGEMENT</span></div>
      <div className="art-content"><div className="art-tag"><span /> КОНТРОЛЬ ЖИЗНЕННОГО ЦИКЛА ДАННЫХ</div><h1>{mode === 'login' ? <>Данные под<br /><em>контролем.</em></> : <>Начните<br />с <em>порядка.</em></>}</h1><p>Единое пространство для управления корпоративными источниками и жизненным циклом данных.</p>
        <div className="art-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="orbit-core"><Database size={34} strokeWidth={1.25} /></div><span className="orbit-node node-a"><HardDrive size={16} /></span><span className="orbit-node node-b"><GitBranch size={16} /></span><span className="orbit-node node-c"><ShieldCheck size={16} /></span><span className="orbit-node node-d"><Archive size={16} /></span></div>
      </div>
      <div className="art-bottom"><span>INTELLIGENCE FOR DATA GOVERNANCE</span><span>01 — 03</span></div>
    </section>
  )
}

function AuthLayout({ children, mode }: { children: ReactNode; mode: 'login' | 'register' }) {
  return (
    <main className="auth-page"><AuthArtwork mode={mode} /><section className="auth-side"><header className="auth-header"><Brand /><Link to="/" className="auth-back"><ArrowUpRight size={15} /> На главную</Link></header><div className="auth-card-wrap"><div className="auth-eyebrow"><span /> SECURE ACCESS / DACS</div><h2>{mode === 'login' ? 'Вход в систему' : 'Создать аккаунт'}<span>.</span></h2><p className="auth-subtitle">{mode === 'login' ? 'Доступ к рабочему пространству DACS.' : 'Создание учётной записи через защищённую страницу Keycloak.'}</p>{children}<div className="auth-security"><LockKeyhole size={13} /> Авторизация выполняется на Gateway через Keycloak</div></div><footer className="auth-footer"><span>© DACS</span><span>Корпоративная система управления данными</span></footer></section></main>
  )
}

function LoginPage() {
  return (
    <AuthLayout mode="login">
      <div className="auth-form">
        <p className="auth-instructions">Вход выполняется через корпоративный провайдер DACS. Авторизация откроется в отдельной вкладке, а текущая страница приложения останется открытой.</p>
        <a className="auth-submit auth-submit-link" href={KEYCLOAK_LOGIN_URL} target="_blank" rel="noreferrer">Войти через Keycloak <ArrowRight size={16} /></a>
        <div className="auth-switch">Ещё нет аккаунта? <Link to="/register">Создать аккаунт</Link></div>
        <div className="auth-feedback" role="note">После входа в Keycloak вернитесь в эту вкладку и обновите данные. Сессия Gateway будет доступна frontend через localhost.</div>
      </div>
    </AuthLayout>
  )
}

function RegisterPage() {
  return (
    <AuthLayout mode="register">
      <div className="auth-form">
        <p className="auth-instructions">Регистрация учётной записи выполняется на стороне Keycloak. Откройте страницу входа — на ней будет доступна ссылка «Регистрация», если администратор включил самостоятельное создание аккаунтов для realm DACS.</p>
        <a className="auth-submit auth-submit-link" href={KEYCLOAK_LOGIN_URL} target="_blank" rel="noreferrer">Открыть страницу регистрации <ArrowRight size={16} /></a>
        <div className="auth-feedback" role="note">На странице Keycloak выберите «Регистрация», заполните данные и завершите создание аккаунта. После этого можно войти в DACS.</div>
        <div className="auth-switch">Уже есть аккаунт? <Link to="/login">Войти</Link></div>
      </div>
    </AuthLayout>
  )
}

export default function App() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/login" element={<LoginPage />} /><Route path="/register" element={<RegisterPage />} /><Route path="*" element={<HomePage />} /></Routes>
}
