import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Archive, ArrowLeft, ArrowRight, File, Folder, RefreshCw } from 'lucide-react'
import { ApiError, KEYCLOAK_LOGIN_URL, requestJson } from './api'

export const S3_SOURCE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'
const PAGE_SIZE = 25

export type Connection = { id: string; name: string; sourceId: string }
export type RunStatus = { requestId: string; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'; processed: number; error: string | null }
type RunEntry = RunStatus & { createdAt: string }
type Page<T> = { items: T[]; nextOffset: number | null }
type Location = { bucket: string; key: string }
export type GraphLocation = Location & { implId: string; prefix: string }
type PiiFile = {
  name: string | null; path: string | null; status: string; categories: string[]; detectors: string[];
  scanComplete: boolean | null; scannerVersion: string | null; retentionStatus: string; graph: GraphLocation | null
}
type PiiSummary = { total: number; partiallyScanned: number; notChecked: number; byStatus: Record<string, number> }
type Assessment = {
  path: string; u: number | null; b: number; s: number | null; status: string; usageReason: string;
  signals: { rule: string; weight: number }[]; preferredPath: string | null; recommendation: string; responseState: string
}
type Bucket = { name: string; rootPrefix: string }
type BucketPage = { buckets: Bucket[]; nextToken: string | null }
type GraphChildren = {
  folders: { name: string; prefix: string }[];
  files: { name: string; key: string; sizeBytes: number | null; modifiedAt: string | null }[];
  nextToken: string | null
}
type ArchiveEntry = { id: string; state: string; createdAt: string; details: { source: Location; destination: Location; sizeBytes: number } }
type ArchivePreview = { source: Location; destination: Location; sizeBytes: number }

const runLabels = { QUEUED: 'В очереди', RUNNING: 'Выполняется', COMPLETED: 'Завершён', FAILED: 'Ошибка' }
const piiLabels: Record<string, string> = {
  DETECTED: 'Обнаружены признаки', REVIEW_REQUIRED: 'Требуется проверка',
  NOT_DETECTED: 'Признаки не обнаружены', PARTIAL: 'Частичная проверка',
  UNSUPPORTED: 'Формат не поддерживается', ERROR: 'Ошибка проверки', NOT_SCANNED: 'Проверка не выполнялась',
}
const categories: Record<string, string> = {
  EMAIL: 'Электронная почта', PHONE_RU: 'Телефон РФ', SNILS: 'СНИЛС', INN_12: 'ИНН физлица', PASSPORT_RU: 'Паспорт РФ',
}
const states: Record<string, string> = { KEEP: 'Сохранить', WARNING: 'Проверить', ARCHIVE_CONFIRMATION_REQUIRED: 'Предложено архивирование' }
const reasons: Record<string, string> = {
  RECENT_READ: 'Есть недавние обращения', AUDIT_COVERAGE_UNVERIFIED: 'Покрытие журнала не подтверждено',
  NO_READS_OVER_UNUSED_WINDOW: 'Длительное отсутствие обращений', NO_READS_OVER_COOLING_WINDOW: 'Обращений давно не было',
  NO_APPLICABLE_USAGE_RULE: 'Недостаточно данных для оценки использования',
  NEWER_EXACT_DUPLICATE: 'Более свежий точный дубль', NAME_MARKER: 'Маркер в имени', FOLDER_MARKER: 'Маркер папки',
  INACTIVE_OWNER: 'Неактивный владелец', OLD_MODIFICATION: 'Давнее изменение', SMALL_FILE: 'Малый размер',
}
const archiveLabels: Record<string, string> = { ARCHIVED: 'В архиве', RESTORED: 'Восстановлены', PENDING: 'Ожидают завершения', DELETED: 'Удалены' }

const url = (path: string, params: Record<string, string | number | null> = {}) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, String(value))
  return query.size ? path + '?' + query : path
}
const implPath = (id: string) => '/api/impls/' + encodeURIComponent(id) + '/s3'
const collected = (id: string) => '/api/collect/runs/' + encodeURIComponent(id)
const date = (value: string) => new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const location = (value: Location) => 's3://' + value.bucket + '/' + value.key
const size = (bytes: number | null) => bytes === null ? '—' : new Intl.NumberFormat('ru').format(bytes) + ' Б'
const number = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('ru', { maximumFractionDigits: 2 }).format(value)

function useQuery<T>(path: string) {
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const [result, setResult] = useState<{ path: string; revision: number; data?: T; error?: unknown }>()
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    requestJson<T>(path, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setResult({ path, revision, data }) },
      error => { if (!controller.signal.aborted) setResult({ path, revision, error }) },
    )
    return () => controller.abort()
  }, [path, revision])
  const current = result?.path === path ? result : undefined
  return {
    data: current?.data, error: current?.revision === revision ? current.error : undefined,
    loading: Boolean(path && (!current || current.revision !== revision)),
    refresh,
  }
}

function Status({ loading, error, empty, refresh }: {
  loading: boolean; error?: unknown; empty?: string; refresh?: () => void
}) {
  if (error) return <div className="action-feedback error-feedback" role="alert">
    <span>{error instanceof Error ? error.message : 'Не удалось выполнить запрос.'}</span>
    {error instanceof ApiError && error.kind === 'auth'
      ? <a href={KEYCLOAK_LOGIN_URL}>Войти</a>
      : refresh && <button className="text-action" type="button" onClick={refresh}>Повторить</button>}
  </div>
  if (loading) return <p className="loading-row" role="status">Загрузка…</p>
  return empty ? <p className="empty-note">{empty}</p> : null
}

function Heading({ title, tail }: { title: string; tail: string }) {
  return <div className="page-heading-row"><div><h1>{title} <span>{tail}</span></h1></div></div>
}

function Paging({ index, busy, hasNext, onBack, onNext }: {
  index: number; busy: boolean; hasNext: boolean; onBack: () => void; onNext: () => void
}) {
  if (!index && !hasNext) return null
  return <div className="results-pagination">
    <button className="button button-light" type="button" onClick={onBack} disabled={busy || !index}><ArrowLeft size={14} /> Назад</button>
    <span>Страница {index + 1}</span>
    <button className="button button-light" type="button" onClick={onNext} disabled={busy || !hasNext}>Далее <ArrowRight size={14} /></button>
  </div>
}

export function ConnectionPicker({ items, value, onChange }: { items: Connection[]; value: string; onChange: (id: string) => void }) {
  return <label className="results-field">Источник S3
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Выберите подключение</option>
      {items.filter(item => item.sourceId === S3_SOURCE).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </label>
}

export function RunPicker({ implId, value, onChange, completedOnly = false }: {
  implId: string; value: string; onChange: (id: string) => void; completedOnly?: boolean
}) {
  const [offset, setOffset] = useState(0)
  const history = useQuery<Page<RunEntry>>(implId ? url('/api/collect/' + encodeURIComponent(implId) + '/runs', { offset, limit: PAGE_SIZE }) : '')
  const entries = (history.data?.items ?? []).filter(run => !completedOnly || run.status === 'COMPLETED')
  return <div className="results-run-picker">
    <label className="results-field">Сбор
      <select value={value} disabled={!implId} onChange={event => onChange(event.target.value)}>
        <option value="">Выберите запуск</option>
        {value && !entries.some(run => run.requestId === value) && <option value={value}>{value.slice(0, 8)}</option>}
        {entries.map(run => <option key={run.requestId} value={run.requestId}>{date(run.createdAt)} · {runLabels[run.status]} · {run.processed} файлов</option>)}
      </select>
    </label>
    <Status {...history} empty={implId && history.data && !entries.length ? 'На этой странице нет подходящих запусков.' : undefined} />
    <Paging index={offset / PAGE_SIZE} busy={history.loading} hasNext={history.data?.nextOffset != null}
      onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(history.data?.nextOffset ?? offset)} />
    {implId && <button type="button" className="text-action" onClick={history.refresh}><RefreshCw size={14} /> Обновить запуски</button>}
  </div>
}

export function ResultsPage({ mode, items, implId, runId, onImpl, onRun, onGraph }: {
  mode: 'pii' | 'recommendations'; items: Connection[]; implId: string; runId: string;
  onImpl: (id: string) => void; onRun: (id: string) => void; onGraph: (target: GraphLocation) => void
}) {
  const run = useQuery<RunStatus>(runId ? collected(runId) : '')
  const pending = run.data?.status === 'QUEUED' || run.data?.status === 'RUNNING'
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(run.refresh, 3000)
    return () => window.clearInterval(timer)
  }, [pending, run.refresh])

  return <>
    {mode === 'pii' ? <Heading title="Персональные" tail="данные." /> : <Heading title="Оценка" tail="файлов." />}
    <section className="panel results-panel">
      <div className="results-toolbar">
        <ConnectionPicker items={items} value={implId} onChange={onImpl} />
        <RunPicker key={implId} implId={implId} value={runId} onChange={onRun} />
      </div>
      <Status {...run} />
      {run.data && <p className="results-run-state" role="status">{runLabels[run.data.status]} · {run.data.processed} файлов{run.data.error ? ' · ' + run.data.error : ''}</p>}
      {!runId && <p className="empty-note">Выберите подключение и запуск, чтобы открыть отчёт.</p>}
    </section>
    {run.data?.status === 'COMPLETED' && (mode === 'pii'
      ? <PiiResults key={runId} runId={runId} onGraph={onGraph} />
      : <Assessments key={runId} runId={runId} implId={implId} />)}
  </>
}

function PiiResults({ runId, onGraph }: { runId: string; onGraph: (target: GraphLocation) => void }) {
  const [status, setStatus] = useState('FINDINGS')
  const [category, setCategory] = useState('')
  const [offset, setOffset] = useState(0)
  const summary = useQuery<PiiSummary>(collected(runId) + '/pii/summary')
  const files = useQuery<Page<PiiFile>>(url(collected(runId) + '/pii/files', { status, category: category || null, offset, limit: PAGE_SIZE }))
  const counts = summary.data
  return <>
    <Status {...summary} />
    {counts && <section className="metrics-grid results-metrics" aria-label="Сводка проверки">
      {Object.entries({
        'Всего файлов': counts.total,
        'Обнаружены признаки': counts.byStatus.DETECTED ?? 0,
        'Требуют проверки': counts.byStatus.REVIEW_REQUIRED ?? 0,
        'Частично проверены': counts.partiallyScanned,
        'Не удалось проверить': counts.notChecked,
      }).map(([label, value]) => <article className="panel result-stat" key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>}
    <section className="panel results-panel">
      <h2>Результаты проверки</h2>
      <div className="results-toolbar">
        <label className="results-field">Статус<select value={status} onChange={event => { setStatus(event.target.value); setOffset(0) }}>
          <option value="FINDINGS">Обнаружения и ручная проверка</option><option value="ALL">Все файлы</option>
          {Object.entries(piiLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="results-field">Категория<select value={category} onChange={event => { setCategory(event.target.value); setOffset(0) }}>
          <option value="">Все категории</option>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </div>
      <Status {...files} empty={files.data?.items.length === 0 ? 'По выбранным фильтрам файлов нет.' : undefined} />
      <div className="result-list">{files.data?.items.map((file, index) => <details className="result-row" key={file.path ?? index}>
        <summary><span><strong>{file.name ?? 'Файл без имени'}</strong><small>{file.path}</small></span>
          <span className={'result-badge ' + (file.status === 'DETECTED' || file.status === 'REVIEW_REQUIRED' ? 'attention' : '')}>{piiLabels[file.status] ?? file.status}</span>
        </summary>
        <dl className="result-details">
          <div><dt>Категории</dt><dd>{file.categories.map(value => categories[value] ?? value).join(', ') || '—'}</dd></div>
          <div><dt>Полнота проверки</dt><dd>{file.scanComplete === null ? 'Неизвестна' : file.scanComplete ? 'Полная' : 'Неполная'}</dd></div>
          <div><dt>Версия детектора</dt><dd>{file.scannerVersion ?? '—'}</dd></div>
          <div><dt>Методы</dt><dd>{file.detectors.join(', ') || '—'}</dd></div>
          <div><dt>Срок хранения</dt><dd>{file.retentionStatus === 'NEEDS_DETERMINATION' ? 'Требуется определить' : '—'}</dd></div>
        </dl>
        {file.graph && <button type="button" className="button button-light" onClick={() => file.graph && onGraph(file.graph)}>Открыть в графе <ArrowRight size={14} /></button>}
      </details>)}</div>
      <Paging index={offset / PAGE_SIZE} busy={files.loading} hasNext={files.data?.nextOffset != null}
        onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(files.data?.nextOffset ?? offset)} />
    </section>
  </>
}

function parseLocation(path: string): Location | null {
  const match = /^s3:\/\/([^/]+)\/(.+)$/s.exec(path)
  return match ? { bucket: match[1], key: match[2] } : null
}

function Assessments({ implId, runId }: { implId: string; runId: string }) {
  const [offset, setOffset] = useState(0)
  const scores = useQuery<Assessment[]>(url(collected(runId) + '/aging', { offset, limit: PAGE_SIZE + 1 }))
  const rows = scores.data?.slice(0, PAGE_SIZE) ?? []
  return <section className="panel results-panel">
    <h2>Рекомендации по файлам</h2>
    <Status {...scores} empty={scores.data?.length === 0 ? 'В завершённом сборе нет файлов.' : undefined} />
    <div className="result-list">{rows.map(score => {
      const source = parseLocation(score.path)
      const label = states[score.responseState] ?? score.responseState
      return <details className="result-row" key={score.path}>
        <summary><span><strong>{source?.key.slice(source.key.lastIndexOf('/') + 1) ?? score.path}</strong><small>{score.path}</small></span>
          <span className={'result-badge ' + (score.responseState === 'KEEP' ? '' : 'attention')}>{label}</span>
          <span className="score-value">{number(score.s)}</span>
        </summary>
        <dl className="result-details">
          <div><dt>Использование U</dt><dd>{number(score.u)}</dd></div><div><dt>ROT B</dt><dd>{number(score.b)}</dd></div>
          <div><dt>Состояние</dt><dd>{({ ACTIVE: 'Активен', COOLING: 'Остывает', OBSOLETE: 'Устарел', INSUFFICIENT_DATA: 'Недостаточно данных' } as Record<string, string>)[score.status] ?? score.status}</dd></div>
          <div><dt>История использования</dt><dd>{reasons[score.usageReason] ?? score.usageReason}</dd></div>
          {score.preferredPath && <div><dt>Предпочтительный экземпляр</dt><dd>{score.preferredPath}</dd></div>}
        </dl>
        {!!score.signals.length && <ul className="result-signals">{score.signals.map(signal => <li key={signal.rule}>{reasons[signal.rule] ?? signal.rule}: +{number(signal.weight)}</li>)}</ul>}
        {implId && source && score.responseState === 'ARCHIVE_CONFIRMATION_REQUIRED' && <ArchiveButton implId={implId} source={source} />}
      </details>
    })}</div>
    <Paging index={offset / PAGE_SIZE} busy={scores.loading} hasNext={(scores.data?.length ?? 0) > PAGE_SIZE}
      onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(offset + PAGE_SIZE)} />
  </section>
}

function ArchiveButton({ implId, source }: { implId: string; source: Location }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [done, setDone] = useState(false)
  async function archiveFile() {
    setBusy(true)
    setError(undefined)
    try {
      const base = implPath(implId) + '/archive'
      const preview = await requestJson<ArchivePreview>(base + '/preview', { method: 'POST', body: JSON.stringify(source) })
      if (window.confirm('Создать архивную копию?\n' + location(preview.source) + '\n→ ' + location(preview.destination))) {
        await requestJson(base + '/confirm', { method: 'POST', body: JSON.stringify({ confirmed: true, preview }) })
        setDone(true)
      }
    } catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }
  return <div><button type="button" className="button button-light" disabled={busy || done} onClick={() => void archiveFile()}>
    <Archive size={14} /> {done ? 'Копия в архиве' : busy ? 'Обработка…' : 'Архивировать'}
  </button><Status loading={false} error={error} /></div>
}

function TokenPaging({ tokens, nextToken, busy, setTokens }: {
  tokens: (string | null)[]; nextToken?: string | null; busy: boolean; setTokens: (tokens: (string | null)[]) => void
}) {
  return <Paging index={tokens.length - 1} busy={busy} hasNext={Boolean(nextToken)}
    onBack={() => setTokens(tokens.slice(0, -1))} onNext={() => nextToken && setTokens([...tokens, nextToken])} />
}

export function GraphPage({ items, implId, target, onImpl }: {
  items: Connection[]; implId: string; target: GraphLocation | null; onImpl: (id: string) => void
}) {
  return <><Heading title="Граф" tail="зависимостей." />
    <section className="panel results-panel"><ConnectionPicker items={items} value={implId} onChange={onImpl} /></section>
    {implId && <BucketTree key={JSON.stringify([implId, target])} implId={implId} target={target} />}
  </>
}

function BucketTree({ implId, target }: { implId: string; target: GraphLocation | null }) {
  const [bucket, setBucket] = useState(target?.bucket ?? '')
  const [prefix, setPrefix] = useState(target?.prefix ?? '')
  const [bucketTokens, setBucketTokens] = useState<(string | null)[]>([null])
  const [tokens, setTokens] = useState<(string | null)[]>([null])
  const root = implPath(implId) + '/buckets'
  const buckets = useQuery<BucketPage>(bucket ? '' : url(root, { continuationToken: bucketTokens[bucketTokens.length - 1], limit: PAGE_SIZE }))
  const children = useQuery<GraphChildren>(bucket ? url(root + '/' + encodeURIComponent(bucket) + '/children', {
    prefix, continuationToken: tokens[tokens.length - 1], limit: PAGE_SIZE,
  }) : '')
  function openPrefix(next: string) { setPrefix(next); setTokens([null]) }
  const branch = Array.from(prefix.matchAll(/[^/]*\//g)).map(match => ({ name: match[0], prefix: prefix.slice(0, match.index! + match[0].length) }))
  return <section className="panel results-panel">
    <div className="graph-crumbs" aria-label="Путь в бакете">
      <button className="text-action" type="button" onClick={() => { setBucket(''); openPrefix('') }}>Бакеты</button>
      {bucket && <button className="text-action" type="button" onClick={() => openPrefix('')}>{bucket}</button>}
      {branch.map(node => <button className="text-action" key={node.prefix} type="button" onClick={() => openPrefix(node.prefix)}>{node.name}</button>)}
    </div>
    {target?.bucket === bucket && target.prefix === prefix && <p className="page-lead">Файл из отчёта: {target.key}</p>}
    {!bucket ? <>
      <Status {...buckets} empty={buckets.data?.buckets.length === 0 ? 'В последнем завершённом сборе нет бакетов с файлами.' : undefined} />
      <div className="result-list">{buckets.data?.buckets.map(item => <button type="button" className="tree-row" key={item.name}
        onClick={() => { setBucket(item.name); openPrefix(item.rootPrefix) }}><Folder size={16} />{item.name}<ArrowRight size={14} /></button>)}</div>
      <TokenPaging tokens={bucketTokens} nextToken={buckets.data?.nextToken} busy={buckets.loading} setTokens={setBucketTokens} />
    </> : <>
      <Status {...children} empty={children.data && !children.data.folders.length && !children.data.files.length ? 'На этом уровне нет файлов или папок.' : undefined} />
      <div className="result-list">
        {children.data?.folders.map(folder => <button type="button" className="tree-row" key={folder.prefix} onClick={() => openPrefix(folder.prefix)}>
          <Folder size={16} />{folder.name}<ArrowRight size={14} />
        </button>)}
        {children.data?.files.map(file => <details className="result-row" key={file.key}>
          <summary className={'tree-row tree-file' + (file.key === target?.key ? ' selected' : '')}>
            <File size={16} /><span>{file.name}<small>{file.modifiedAt ? date(file.modifiedAt) : '—'} · {size(file.sizeBytes)}</small></span>
          </summary>
          <ArchiveButton implId={implId} source={{ bucket, key: file.key }} />
        </details>)}
      </div>
      <TokenPaging tokens={tokens} nextToken={children.data?.nextToken} busy={children.loading} setTokens={setTokens} />
    </>}
  </section>
}

export function ArchivePage({ items, implId, onImpl }: { items: Connection[]; implId: string; onImpl: (id: string) => void }) {
  return <><Heading title="Архив" tail="файлов." />
    <section className="panel results-panel"><ConnectionPicker items={items} value={implId} onChange={onImpl} /></section>
    {implId && <ArchiveEntries key={implId} implId={implId} />}
  </>
}

function ArchiveEntries({ implId }: { implId: string }) {
  const [state, setState] = useState('ARCHIVED')
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>()
  const [notice, setNotice] = useState('')
  const base = implPath(implId) + '/archive'
  const entries = useQuery<Page<ArchiveEntry>>(url(base, { state, offset, limit: PAGE_SIZE }))
  async function change(item: ArchiveEntry, action: 'restore' | 'undo-restore' | 'delete') {
    if (action === 'delete' && !window.confirm('Удалить исходный файл и архивную копию?\n' + location(item.details.source))) return
    setBusy(item.id); setError(undefined); setNotice('')
    try {
      await requestJson(base + '/' + encodeURIComponent(item.id) + (action === 'delete' ? '' : '/' + action),
        { method: action === 'delete' ? 'DELETE' : 'POST' })
      setNotice(action === 'delete' ? 'Файл и архивная копия удалены.' : action === 'restore' ? 'Файл восстановлен.' : 'Восстановление отменено.')
      if (entries.data?.items.length === 1 && offset > 0) setOffset(offset - PAGE_SIZE)
      else entries.refresh()
    } catch (failure) { setError(failure) }
    finally { setBusy('') }
  }
  return <section className="panel results-panel">
    <label className="results-field">Состояние
      <select value={state} onChange={event => { setState(event.target.value); setOffset(0); setNotice(''); setError(undefined) }}>
        {Object.entries(archiveLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <Status {...entries} empty={entries.data?.items.length === 0 ? 'В этом состоянии файлов нет.' : undefined} />
    <Status loading={false} error={error} />
    {notice && <p className="action-feedback success-feedback" role="status">{notice}</p>}
    <div className="result-list">{entries.data?.items.map(item => <details className="result-row" key={item.id}>
      <summary><span><strong>{location(item.details.source)}</strong><small>{date(item.createdAt)} · {size(item.details.sizeBytes)}</small></span></summary>
      <dl className="result-details"><div><dt>Архивная копия</dt><dd>{location(item.details.destination)}</dd></div></dl>
      <div className="result-actions">
        {item.state === 'ARCHIVED' && <ArchiveAction disabled={Boolean(busy)} onClick={() => void change(item, 'restore')}>Восстановить</ArchiveAction>}
        {item.state === 'RESTORED' && <ArchiveAction disabled={Boolean(busy)} onClick={() => void change(item, 'undo-restore')}>Отменить восстановление</ArchiveAction>}
        {['ARCHIVED', 'RESTORED'].includes(item.state) && <ArchiveAction disabled={Boolean(busy)} onClick={() => void change(item, 'delete')}>Удалить файл и копию</ArchiveAction>}
      </div>
    </details>)}</div>
    <Paging index={offset / PAGE_SIZE} busy={entries.loading} hasNext={entries.data?.nextOffset != null}
      onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(entries.data?.nextOffset ?? offset)} />
  </section>
}

function ArchiveAction({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return <button type="button" className="button button-light" disabled={disabled} onClick={onClick}>{children}</button>
}
