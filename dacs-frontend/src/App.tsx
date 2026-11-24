import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { ApiError, KEYCLOAK_LOGIN_URL, requestJson, requestVoid, streamChat } from './api'
import { ArchivePage, ConnectionPicker, GraphPage, ResultsPage, RunPicker, TemplatesPage, FILE_STORAGE_SOURCE, S3_SOURCE, supportsCollection } from './ResultsPages'
import type { Connection, RunStatus } from './ResultsPages'
import {
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowUpRight,
  Check,
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
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'

type Section = 'overview' | 'sources' | 'chats' | 'pii' | 'templates' | 'dependencies' | 'recommendations' | 'archive'
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

const navigation: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { id: 'sources', label: 'Источники данных', icon: Database },
  { id: 'chats', label: 'Диалоги', icon: MessageSquare },
  { id: 'pii', label: 'Персональные данные', icon: ShieldCheck },
  { id: 'templates', label: 'Шаблоны документов', icon: FileSearch },
  { id: 'dependencies', label: 'Граф зависимостей', icon: GitBranch },
  { id: 'recommendations', label: 'Рекомендации', icon: FileSearch },
  { id: 'archive', label: 'Архив', icon: Archive },
]

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

function Sidebar({ active, onChange, mobileOpen, onClose, signedIn }: {
  active: Section
  onChange: (section: Section) => void
  mobileOpen: boolean
  onClose: () => void
  signedIn: boolean
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
        {!signedIn && <div className="sidebar-bottom">
          <Link className="nav-item" to="/login"><LogIn size={17} /><span>Войти</span></Link>
        </div>}
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
      <div><strong>{kind === 'auth' ? 'Требуется авторизация' : kind === 'network' ? 'API недоступно' : 'Не удалось получить данные'}</strong><p>{message}</p>{kind === 'auth' && <a className="api-login-link" href={KEYCLOAK_LOGIN_URL}><LogIn size={14} /> Открыть вход через Keycloak</a>}</div>
      <button className="button button-light" type="button" onClick={onRetry}><RefreshCw size={14} /> Повторить</button>
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, description, action }: { icon: typeof Database; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-panel"><div className="empty-icon"><Icon size={22} /></div><h3>{title}</h3><p>{description}</p>{action}</div>
}

function Overview({ data, onNavigate }: { data: ReturnType<typeof useSourceData>; onNavigate: (section: Section) => void }) {
  const connections = data.implementations.filter(item => supportsCollection(item.sourceId))
  return <>
    <PageHeading eyebrow="РАБОЧЕЕ ПРОСТРАНСТВО" title={<>Контроль старения <span>данных.</span></>}
      description="Сбор и проверка файлов из S3 и файловой системы."
      action={<button className="button button-dark" type="button" onClick={() => onNavigate('sources')}>Открыть источники <ArrowRight size={15} /></button>} />
    {data.error && <ApiNotice kind={data.errorKind} message={data.error} onRetry={() => void data.refresh()} />}
    {!data.error && <section className="metrics-grid" aria-label="Подключения">
      <StatCard label="Подключения" value={data.loading ? '…' : String(connections.length)} hint="Источники данных" icon={Database} />
    </section>}
    <section className="panel overview-sources-panel">
      <div className="panel-header"><h2>Подключённые источники</h2>
        <IconButton label="Обновить источники" onClick={() => void data.refresh()}><RefreshCw size={16} /></IconButton>
      </div>
      {data.loading ? <p className="loading-row">Загрузка…</p> : connections.length > 0
        ? <div className="source-chip-list">{connections.map(item => <span className="source-chip" key={item.id}><Database size={14} />{item.name}</span>)}</div>
        : !data.error && <p className="empty-note">Добавьте подключение, чтобы начать сбор.</p>}
    </section>
  </>
}

type S3Fields = {
  endpoint: string; bucket: string; accessKey: string; secretKey: string; region: string;
  prefix: string; sessionToken: string; archiveBucket: string; auditBucket: string; auditKey: string;
  coverageStart: string; coverageEnd: string;
}

function configObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readConfig(value?: string): Record<string, unknown> {
  try { return configObject(JSON.parse(value ?? '{}')) } catch { return {} }
}

function configText(config: Record<string, unknown>, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value : ''
}

function localDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23)
}

function s3Fields(config: Record<string, unknown>): S3Fields {
  const audit = configObject(config.auditLog)
  return {
    endpoint: configText(config, 'endpoint'), bucket: configText(config, 'bucket'),
    accessKey: configText(config, 'accessKey'), secretKey: configText(config, 'secretKey'),
    region: configText(config, 'region'), prefix: configText(config, 'prefix'),
    sessionToken: configText(config, 'sessionToken'), archiveBucket: configText(config, 'archiveBucket'),
    auditBucket: configText(audit, 'bucket'), auditKey: configText(audit, 'key'),
    coverageStart: localDateTime(configText(audit, 'coverageStart')),
    coverageEnd: localDateTime(configText(audit, 'coverageEnd')),
  }
}

function serializeS3(fields: S3Fields, existing: Record<string, unknown>): string {
  let endpoint: URL
  try { endpoint = new URL(fields.endpoint.trim()) }
  catch { throw new Error('Укажите полный адрес S3, включая http:// или https://.') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
      || endpoint.search || endpoint.hash) {
    throw new Error('Укажите адрес S3 по HTTP(S) без учётных данных и параметров.')
  }
  const { bucket, accessKey, secretKey, archiveBucket, auditBucket, auditKey, coverageStart, coverageEnd } = fields
  if (!bucket.trim() || !accessKey.trim() || !secretKey.trim()) {
    throw new Error('Заполните бакет, ключ доступа и секретный ключ.')
  }
  if (archiveBucket.trim() && archiveBucket.trim() === bucket.trim()) {
    throw new Error('Выберите отдельный бакет для архивных копий.')
  }
  const config: Record<string, unknown> = {
    ...existing, endpoint: fields.endpoint.trim(), bucket: bucket.trim(), accessKey, secretKey,
  }
  for (const key of ['region', 'prefix', 'sessionToken', 'archiveBucket'] as const) {
    const value = key === 'prefix' ? fields[key] : fields[key].trim()
    if (value) config[key] = value
    else delete config[key]
  }
  if (auditBucket || auditKey || coverageStart || coverageEnd) {
    if (!auditBucket.trim() || !auditKey.trim()) throw new Error('Укажите бакет и ключ файла журнала.')
    if (Boolean(coverageStart) !== Boolean(coverageEnd)) throw new Error('Укажите обе даты покрытия журнала.')
    if (coverageStart && new Date(coverageStart) >= new Date(coverageEnd)) {
      throw new Error('Начало покрытия журнала должно быть раньше окончания.')
    }
    const audit = { ...configObject(existing.auditLog), bucket: auditBucket.trim(), key: auditKey } as Record<string, unknown>
    for (const key of ['coverageStart', 'coverageEnd'] as const) {
      if (fields[key]) {
        const previous = configText(audit, key)
        audit[key] = localDateTime(previous) === fields[key] ? previous : new Date(fields[key]).toISOString()
      } else delete audit[key]
    }
    config.auditLog = audit
  } else delete config.auditLog
  return JSON.stringify(config)
}

function ImplDialog({ sources, existing, onClose, onSaved }: { sources: SourceRecord[]; existing?: ImplRecord; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(existing)
  const [name, setName] = useState(existing?.name ?? '')
  const [sourceId, setSourceId] = useState(existing?.sourceId ?? '')
  const [original] = useState(() => readConfig(existing?.config))
  const [fields, setFields] = useState(() => s3Fields(original))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isS3 = sourceId === S3_SOURCE
  const isFileStorage = sourceId === FILE_STORAGE_SOURCE
  const [directory, setDirectory] = useState(typeof original.directory === 'string' ? original.directory : '.')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setError('')
    if (!name.trim()) { setError('Укажите название подключения.'); return }
    if (!editing && !supportsCollection(sourceId)) { setError('Выберите источник с поддерживаемым подключением.'); return }
    setSaving(true)
    try {
      if (isFileStorage && !directory.trim()) throw new Error('Укажите каталог.')
      const config = isS3 ? serializeS3(fields, original)
        : isFileStorage ? JSON.stringify({ directory: directory.trim() }) : existing?.config
      if (existing) {
        await requestJson<ImplRecord>('/api/impls/' + existing.id, {
          method: 'PUT', body: JSON.stringify({ name: name.trim(), config, state: existing.state }),
        })
      } else {
        await requestJson<ImplRecord>('/api/impls', {
          method: 'POST', body: JSON.stringify({ name: name.trim(), config, sourceId, state: 'NOT_RUN' }),
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409
        ? 'Подключение с таким названием уже существует. Укажите другое название.'
        : err instanceof Error ? err.message : 'Не удалось сохранить подключение.')
    } finally { setSaving(false) }
  }

  function field(key: keyof S3Fields, label: string, options: { type?: string; placeholder?: string; required?: boolean } = {}) {
    return <label className="impl-field">
      <span>{label}</span>
      <input name={key} type={options.type ?? 'text'} value={fields[key]} placeholder={options.placeholder}
        required={options.required} step={options.type === 'datetime-local' ? '0.001' : undefined}
        autoComplete={options.type === 'password' ? 'new-password' : 'off'}
        onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} />
    </label>
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="impl-dialog-title">
        <div className="dialog-header">
          <h2 id="impl-dialog-title">{editing ? 'Редактировать подключение' : 'Добавить подключение'}</h2>
          <IconButton label="Закрыть" onClick={onClose} disabled={saving}><X size={18} /></IconButton>
        </div>
        <form className="impl-form" onSubmit={submit}>
          <label className="impl-field">Название
            <input value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Например, Документы S3" required />
          </label>
          <label className="impl-field">Тип источника
            <select value={sourceId} onChange={event => setSourceId(event.target.value)} disabled={editing || saving} required>
              <option value="">Выберите тип источника</option>
              {editing && !sources.some(source => source.id === sourceId) && <option value={sourceId}>Неизвестный тип</option>}
              {sources.map(source => <option key={source.id} value={source.id} disabled={!editing && !supportsCollection(source.id)}>
                {source.id === FILE_STORAGE_SOURCE ? 'Файловая система' : source.name}{!editing && !supportsCollection(source.id) ? ' — пока недоступен' : ''}
              </option>)}
            </select>
          </label>
          {isS3 && <>
            <div className="impl-field-grid">
              {field('endpoint', 'Адрес S3', { type: 'url', placeholder: 'http://minio:9000', required: true })}
              {field('bucket', 'Имя бакета', { placeholder: 'documents', required: true })}
              {field('accessKey', 'Ключ доступа', { required: true })}
              {field('secretKey', 'Секретный ключ', { type: 'password', required: true })}
            </div>
            <details className="impl-options">
              <summary>Дополнительные параметры</summary>
              <div className="impl-field-grid">
                {field('region', 'Регион', { placeholder: 'us-east-1' })}
                {field('prefix', 'Префикс объектов', { placeholder: 'reports/' })}
                {field('archiveBucket', 'Архивный бакет')}
                {field('sessionToken', 'Токен временной сессии', { type: 'password' })}
              </div>
            </details>
            <details className="impl-options">
              <summary>Журнал обращений</summary>
              <div className="impl-field-grid">
                {field('auditBucket', 'Бакет журнала')}
                {field('auditKey', 'Ключ файла журнала', { placeholder: 'audit/minio.jsonl' })}
                {field('coverageStart', 'Начало покрытия', { type: 'datetime-local' })}
                {field('coverageEnd', 'Конец покрытия', { type: 'datetime-local' })}
              </div>
              <p className="form-help">Даты указываются в местном времени. Заполняйте их, если журнал покрывает весь интервал.</p>
            </details>
          </>}
          {isFileStorage && <label className="impl-field">Каталог
            <input value={directory} onChange={event => setDirectory(event.target.value)} placeholder="reports/2026" required />
            <span className="form-help">Путь относительно каталога агента. Точка означает весь каталог.</span>
          </label>}
          {editing && !supportsCollection(sourceId) && <p className="form-help">Для этого типа подключения можно изменить название.</p>}
          {error && <div className="auth-feedback error-feedback" role="alert">{error}</div>}
          <div className="dialog-actions">
            <button className="button button-light" type="button" onClick={onClose} disabled={saving}>Отмена</button>
            <button className="button button-dark" type="submit" disabled={saving || (!editing && !supportsCollection(sourceId))}>
              {saving ? 'Сохранение…' : editing ? 'Сохранить изменения' : 'Создать подключение'} <ArrowRight size={15} />
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ImplDetailsDialog({ implementation, sourceName, onClose }: { implementation: ImplRecord; sourceName: string; onClose: () => void }) {
  let prettyConfig = implementation.config
  try { prettyConfig = JSON.stringify(JSON.parse(implementation.config), (key, value) => /secret|password|sessionToken|accessKey/i.test(key) ? '••••••' : value, 2) } catch { /* keep the exact returned value */ }
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="create-dialog details-dialog" role="dialog" aria-modal="true" aria-labelledby="impl-details-title">
        <div className="dialog-header"><div><h2 id="impl-details-title">{implementation.name}</h2></div><IconButton label="Закрыть" onClick={onClose}><X size={18} /></IconButton></div>
        <div className="detail-meta"><div><small>Тип источника</small><strong>{sourceName}</strong></div><div><small>Состояние</small><strong>{implementation.state}</strong></div><div><small>ID</small><strong className="detail-id">{implementation.id}</strong></div></div>
        <label className="detail-config-label">Конфигурация JSON</label><pre className="detail-config">{prettyConfig}</pre>
        <div className="dialog-actions"><button className="button button-dark" type="button" onClick={onClose}>Закрыть</button></div>
      </section>
    </div>
  )
}

function SourcesPage({ data, onStarted }: {
  data: ReturnType<typeof useSourceData>; onStarted: (implId: string, runId: string) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ImplRecord>()
  const [details, setDetails] = useState<ImplRecord>()
  const [actionId, setActionId] = useState('')
  const [actionError, setActionError] = useState('')
  const sources = data.sources.filter(source => supportsCollection(source.id))
  const sourceName = new Map(data.sources.map(source => [source.id, source.id === FILE_STORAGE_SOURCE ? 'Файловая система' : source.name]))

  async function perform(item: ImplRecord, action: () => Promise<void>) {
    setActionId(item.id)
    setActionError('')
    try { await action() }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Не удалось выполнить действие.') }
    finally { setActionId('') }
  }

  return <>
    <PageHeading eyebrow="ХРАНИЛИЩА" title={<>Источники <span>данных.</span></>}
      description="Подключите бакет S3 или каталог файловой системы и запустите сбор метаданных."
      action={<button className="button button-dark" type="button" onClick={() => setDialogOpen(true)} disabled={!sources.length}>
        <Plus size={16} /> Добавить подключение
      </button>} />
    {data.error && <ApiNotice kind={data.errorKind} message={data.error} onRetry={() => void data.refresh()} />}
    {actionError && <p className="action-feedback error-feedback" role="alert">{actionError}</p>}
    <section className="panel implementations-panel">
      <div className="panel-header"><h2>Подключения</h2><IconButton label="Обновить подключения" onClick={() => void data.refresh()}><RefreshCw size={16} /></IconButton></div>
      {data.loading ? <div className="loading-row">Загрузка…</div> : data.implementations.length ? <div className="impl-table-wrap">
        <table className="impl-table">
          <thead><tr><th>Название</th><th>Тип</th><th>Действия</th></tr></thead>
          <tbody>{data.implementations.map(item => <tr key={item.id}>
            <td><strong>{item.name}</strong></td><td>{sourceName.get(item.sourceId) ?? '—'}</td>
            <td><div className="impl-row-actions">
              <IconButton label="Открыть детали" onClick={() => setDetails(item)}><Eye size={15} /></IconButton>
              <IconButton label="Редактировать" onClick={() => { setEditing(item); setDialogOpen(true) }}><Pencil size={15} /></IconButton>
              {supportsCollection(item.sourceId) && <IconButton label="Запустить сбор" disabled={Boolean(actionId)} onClick={() => void perform(item, async () => {
                const run = await requestJson<RunStatus>('/api/collect/' + item.id + '/run', { method: 'POST' })
                onStarted(item.id, run.requestId)
              })}><Play size={15} /></IconButton>}
              <IconButton label="Удалить подключение" disabled={Boolean(actionId)} onClick={() => {
                if (window.confirm('Удалить подключение «' + item.name + '»?')) void perform(item, async () => {
                  await requestVoid('/api/impls/' + item.id, { method: 'DELETE' })
                  await data.refresh()
                })
              }}><Trash2 size={15} /></IconButton>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div> : !data.error && <EmptyPanel icon={HardDrive} title="Подключений пока нет" description="Добавьте подключение к бакету или каталогу." />}
    </section>
    {dialogOpen && <ImplDialog sources={data.sources} existing={editing}
      onClose={() => { setDialogOpen(false); setEditing(undefined) }} onSaved={() => void data.refresh()} />}
    {details && <ImplDetailsDialog implementation={details} sourceName={sourceName.get(details.sourceId) ?? '—'} onClose={() => setDetails(undefined)} />}
  </>
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function ChatsPage({ items }: { items: Connection[] }) {
  const [attachmentImpl, setAttachmentImpl] = useState('')
  const [attachmentRun, setAttachmentRun] = useState('')
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
  const [draft, setDraft] = useState<{ prompt: string; reply: string; phase: string } | null>(null)
  const activeStream = useRef<AbortController | null>(null)
  const [historyOpen, setHistoryOpen] = useState(() => window.matchMedia('(min-width: 761px)').matches)
  const transcript = useRef<HTMLDivElement>(null)
  useEffect(() => () => activeStream.current?.abort(), [])
  useEffect(() => {
    const panel = transcript.current
    if (draft && panel) panel.scrollTop = panel.scrollHeight
  }, [draft])
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
    if (!content || sending) return
    const controller = new AbortController()
    activeStream.current = controller
    setSending(true)
    setDraft({ prompt: content, reply: '', phase: attachmentRun ? 'ANALYZING' : 'GENERATING' })
    setError('')
    setNotice('')
    try {
      const endpoint = selectedChat ? `/api/chats/${selectedChat.id}/messages/stream` : '/api/chats/stream'
      const chatId = await streamChat(endpoint, { content, requestId: attachmentRun || undefined }, (update) => {
        setDraft(current => {
          if (!current) return current
          if (update.type === 'phase') return { ...current, phase: update.text }
          if (update.type === 'delta') return { ...current, reply: current.reply + update.text }
          return current
        })
      }, controller.signal)
      setComposer('')
      const chat = await requestJson<ChatRecord>(`/api/chats/${chatId}`, { signal: controller.signal })
      setSelectedChat(chat)
      await Promise.all([loadMessages(chatId), loadChats()])
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorKind(errorKindOf(err))
        setError(err instanceof Error ? err.message : 'Не удалось отправить сообщение.')
      }
    } finally {
      if (!controller.signal.aborted) {
        activeStream.current = null
        setSending(false)
        setDraft(null)
      }
    }
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
      <div className="chat-workspace-toolbar">
        <button className="button button-light" type="button" aria-controls="chat-history" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}><MessageSquare size={16} /> История</button>
        <button className="button button-dark" type="button" onClick={startNewChat} disabled={sending}><Plus size={16} /> Новый диалог</button>
      </div>
      {error && <ApiNotice kind={errorKind} message={error} onRetry={() => selectedChat ? void loadMessages(selectedChat.id) : void loadChats()} />}
      {notice && <div className="action-feedback success-feedback" role="status"><Check size={15} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Закрыть"><X size={14} /></button></div>}
      <section className={'chats-layout' + (historyOpen ? '' : ' chat-history-hidden')}>
        <aside className="panel chats-list-panel" id="chat-history" hidden={!historyOpen}>
          <div className="panel-header"><div><h2>Ваши диалоги</h2></div><IconButton label="Обновить диалоги" onClick={() => void loadChats()}><RefreshCw size={15} /></IconButton></div>
          {chatListLoading && chats.length === 0 ? <div className="loading-row">Загрузка диалогов…</div> : chats.length ? <div className="chat-list">{chats.map((chat) => <div className={`chat-list-item ${selectedChat?.id === chat.id ? 'selected' : ''}`} key={chat.id}><button type="button" className="chat-list-select" disabled={sending} onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) setHistoryOpen(false); void openChat(chat) }}><MessageSquare size={15} /><span><strong>{chat.title || 'Новый диалог'}</strong><small>{formatDate(chat.updatedAt)}</small></span></button><IconButton label="Удалить диалог" disabled={sending} onClick={() => void deleteChat(chat)}><Trash2 size={14} /></IconButton></div>)}</div> : <EmptyPanel icon={MessageSquare} title="Диалогов пока нет" description="Начните новый диалог, чтобы он появился в истории." />}
          {hasMoreChats && <button className="button button-light load-more-button" type="button" disabled={chatListLoading} onClick={() => void loadChats(chatCursor, true)}>{chatListLoading ? 'Загрузка…' : 'Загрузить ещё диалоги'}</button>}
        </aside>
        <section className="panel chat-thread-panel">
          {selectedChat && <div className="panel-header chat-thread-heading"><h2>{selectedChat.title || 'Диалог'}</h2></div>}
          <div className="chat-message-list" ref={transcript}>
            {messagesLoading && messages.length === 0 ? <div className="loading-row">Загрузка сообщений…</div> : messages.length || draft ? <>
              {hasMoreMessages && <button className="button button-light load-more-button" type="button" disabled={messagesLoading} onClick={() => selectedChat && void loadMessages(selectedChat.id, messageCursor, true)}>{messagesLoading ? 'Загрузка…' : 'Загрузить ещё сообщения'}</button>}
              {messages.map((message, index) => <article className={`stored-message ${message.role === 'AGENT' ? 'agent-message' : 'user-message'}`} key={message.id}>
                <div className="stored-message-top"><span>{message.role === 'AGENT' ? 'DACS Agent' : 'Вы'}{message.edited ? ' · изменено' : ''}</span><time>{formatDate(message.createdAt)}</time></div>
                {editingId === message.id ? <div className="message-edit-form"><textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={3} /><div><button className="button button-light" type="button" onClick={() => setEditingId(null)}>Отмена</button><button className="button button-dark" type="button" disabled={editSaving || !editContent.trim() || sending} onClick={() => void saveEdit(message, index)}>{editSaving ? 'Сохранение…' : 'Сохранить'}</button></div><small>По текущей логике Core сообщения после редактируемого будут удалены.</small></div> : <p>{message.content}</p>}
                {message.role === 'USER' && !sending && editingId !== message.id && <div className="stored-message-actions"><button type="button" onClick={() => beginEdit(message)}><Pencil size={12} /> Изменить</button><button type="button" onClick={() => void deleteMessage(message)}><Trash2 size={12} /> Удалить</button></div>}
              </article>)}
            </> : <div className="chat-empty-state"><div className="empty-icon"><MessageSquare size={22} /></div><h3>{selectedChat ? 'Сообщений пока нет' : 'Чем помочь?'}</h3><p>Задайте вопрос или прикрепите результаты сбора.</p></div>}
            {draft && <>
              <article className="stored-message user-message">
                <div className="stored-message-top"><span>Вы</span></div><p>{draft.prompt}</p>
              </article>
              <article className="stored-message agent-message">
                <div className="stored-message-top"><span>DACS Agent</span></div>
                {draft.reply ? <p>{draft.reply}</p> : <p role="status">{draft.phase === 'ANALYZING' ? 'Агент анализирует выбранный сбор…' : 'Агент готовит ответ…'}</p>}
              </article>
            </>}
          </div>
          <form className="chat-composer" onSubmit={submitMessage}>
            <textarea aria-label="Сообщение" value={composer} onChange={event => setComposer(event.target.value)} rows={2} disabled={sending}
              placeholder="Напишите сообщение…" onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  if (!sending && composer.trim()) event.currentTarget.form?.requestSubmit()
                }
              }} />
            <div className="chat-composer-footer">
              <details className="chat-attachment">
            <summary>{attachmentRun ? 'Сбор прикреплён' : 'Прикрепить сбор'}</summary>
            <div className="results-toolbar">
              <ConnectionPicker items={items} value={attachmentImpl} onChange={id => { setAttachmentImpl(id); setAttachmentRun('') }} />
              <RunPicker key={attachmentImpl} implId={attachmentImpl} value={attachmentRun} onChange={setAttachmentRun} completedOnly />
            </div>
            {attachmentRun && <button className="text-action" type="button" onClick={() => setAttachmentRun('')}>Убрать вложение</button>}
              </details>
              <button className="button button-dark chat-send" type="submit" aria-label="Отправить сообщение" disabled={sending || !composer.trim()}><Send size={17} /></button>
            </div>
          </form>
        </section>
      </section>
    </>
  )
}

function HomePage() {
  const [active, setActive] = useState<Section>('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [implId, setImplId] = useState('')
  const [runId, setRunId] = useState('')
  const [graphTarget, setGraphTarget] = useState('')
  const data = useSourceData()
  const activeLabel = navigation.find(item => item.id === active)?.label

  function selectImpl(id: string) { setImplId(id); setRunId(''); setGraphTarget('') }
  function openGraph(path: string) {
    setGraphTarget(path)
    setActive('dependencies')
  }
  function openRun(id: string, requestId: string) {
    selectImpl(id)
    setRunId(requestId)
    setActive('recommendations')
  }

  return <div className="app-shell">
    <Sidebar active={active} onChange={setActive} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} signedIn={!data.loading && !data.error} />
    <main className="workspace">
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Открыть меню"><Menu size={19} /></button>
          <span className="breadcrumb">DACS</span><span className="breadcrumb-separator">/</span><strong>{activeLabel}</strong></div>
        {data.errorKind === 'auth' && <Link className="topbar-login" to="/login">Войти <ArrowUpRight size={13} /></Link>}
      </header>
      <div className="workspace-content workspace-content-wide"><div className="main-column">
        {['pii', 'recommendations', 'dependencies', 'archive'].includes(active) && data.error &&
          <ApiNotice kind={data.errorKind} message={data.error} onRetry={() => void data.refresh()} />}
        {active === 'overview' && <Overview data={data} onNavigate={setActive} />}
        {active === 'sources' && <SourcesPage data={data} onStarted={openRun} />}
        {active === 'chats' && <ChatsPage items={data.implementations} />}
        {active === 'templates' && <TemplatesPage />}
        {(active === 'pii' || active === 'recommendations') && <ResultsPage mode={active} items={data.implementations}
          implId={implId} runId={runId} onImpl={selectImpl} onRun={setRunId} onGraph={openGraph} onTemplates={() => setActive('templates')} />}
        {active === 'dependencies' && <GraphPage items={data.implementations} implId={implId} runId={runId} target={graphTarget} onImpl={selectImpl} onRun={id => { setRunId(id); setGraphTarget('') }} />}
        {active === 'archive' && <ArchivePage items={data.implementations} implId={implId} onImpl={selectImpl} onGraph={() => { setGraphTarget(''); setActive('dependencies') }} />}
        <footer className="workspace-footer"><span>© DACS</span></footer>
      </div></div>
    </main>
  </div>
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
        <p className="auth-instructions">После входа через Keycloak откроется главная страница DACS.</p>
        <a className="auth-submit auth-submit-link" href={KEYCLOAK_LOGIN_URL}>Войти через Keycloak <ArrowRight size={16} /></a>
        <div className="auth-switch">Ещё нет аккаунта? <Link to="/register">Создать аккаунт</Link></div>
      </div>
    </AuthLayout>
  )
}

function RegisterPage() {
  return (
    <AuthLayout mode="register">
      <div className="auth-form">
        <p className="auth-instructions">Регистрация учётной записи выполняется на стороне Keycloak. Откройте страницу входа — на ней будет доступна ссылка «Регистрация», если администратор включил самостоятельное создание аккаунтов для realm DACS.</p>
        <a className="auth-submit auth-submit-link" href={KEYCLOAK_LOGIN_URL}>Открыть страницу регистрации <ArrowRight size={16} /></a>
        <div className="auth-feedback" role="note">На странице Keycloak выберите «Регистрация», заполните данные и завершите создание аккаунта. После этого можно войти в DACS.</div>
        <div className="auth-switch">Уже есть аккаунт? <Link to="/login">Войти</Link></div>
      </div>
    </AuthLayout>
  )
}

export default function App() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/login" element={<LoginPage />} /><Route path="/register" element={<RegisterPage />} /><Route path="*" element={<HomePage />} /></Routes>
}
