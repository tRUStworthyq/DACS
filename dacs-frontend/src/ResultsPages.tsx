import { useCallback, useEffect, useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Archive, ArrowLeft, ArrowRight, File, RefreshCw } from 'lucide-react'
import { ApiError, KEYCLOAK_LOGIN_URL, requestJson, requestVoid } from './api'

export const S3_SOURCE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'
export const FILE_STORAGE_SOURCE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15'

export function supportsCollection(sourceId: string) {
  return sourceId === S3_SOURCE || sourceId === FILE_STORAGE_SOURCE
}
const PAGE_SIZE = 25

export type Connection = { id: string; name: string; sourceId: string }
export type RunStatus = { requestId: string; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'; processed: number; error: string | null }
type RunEntry = RunStatus & { createdAt: string }
type Page<T> = { items: T[]; nextOffset: number | null }
type Location = { bucket: string; key: string }
type DocumentTemplate = { id: string; name: string; pathContains: string; nameContains: string; contentContains: string; retentionDays: number | null; retentionYears: number | null }
type RelatedDocument = { path: string; kind: 'IDENTICAL_CONTENT' | 'SHARED_FRAGMENTS' | 'SHARED_IDENTIFIERS'; sharedFragments: number }
type DocumentItem = { path: string; templates: { id: string; name: string; retainUntil: string | null; active: boolean }[]; needsScan: boolean; deleteBlocked: boolean; references: string[]; referencedBy: string[]; related: RelatedDocument[] }
type DocumentPage = Page<DocumentItem> & { complete: boolean }
type Assessment = {
  path: string; u: number | null; b: number; s: number | null; status: string; usageReason: string;
  signals: { rule: string; weight: number }[]; preferredPath: string | null; recommendation: string; responseState: string
}
type ArchiveEntry = { id: string; state: string; createdAt: string; details: { source: Location; destination: Location; sizeBytes: number } }
type ArchivePreview = { source: Location; destination: Location; sizeBytes: number }

const runLabels = { QUEUED: 'В очереди', RUNNING: 'Выполняется', COMPLETED: 'Завершён', FAILED: 'Ошибка' }
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
  return <label className="results-field">Источник данных
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Выберите подключение</option>
      {items.filter(item => supportsCollection(item.sourceId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </label>
}

export function RunPicker({ implId, value, onChange, completedOnly = false, latestByDefault = false }: {
  implId: string; value: string; onChange: (id: string) => void; completedOnly?: boolean; latestByDefault?: boolean
}) {
  const [offset, setOffset] = useState(0)
  const history = useQuery<Page<RunEntry>>(implId ? url('/api/collect/' + encodeURIComponent(implId) + '/runs', { offset, limit: PAGE_SIZE }) : '')
  const entries = (history.data?.items ?? []).filter(run => !completedOnly || run.status === 'COMPLETED')
  return <div className="results-run-picker">
    <label className="results-field">Сбор
      <select value={value} disabled={!implId} onChange={event => onChange(event.target.value)}>
        <option value="">{latestByDefault ? 'Последний завершённый сбор' : 'Выберите запуск'}</option>
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

export function ResultsPage({ mode, items, implId, runId, onImpl, onRun, onGraph, onTemplates }: {
  mode: 'pii' | 'recommendations'; items: Connection[]; implId: string; runId: string;
  onImpl: (id: string) => void; onRun: (id: string) => void; onGraph: (path: string) => void; onTemplates: () => void
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
    {mode === 'pii' && <button className="button button-light" type="button" onClick={onTemplates}>Управлять шаблонами <ArrowRight size={14} /></button>}
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
      ? <DocumentBrowser key={runId} implId={implId} runId={runId} onGraph={onGraph} />
      : <Assessments key={runId} runId={runId} implId={implId} />)}
  </>
}

const templatesPath = '/api/documents/templates'
const emptyTemplate = { id: '', name: '', pathContains: '', nameContains: '', contentContains: '', retentionDays: 365, retentionYears: null }

export function TemplatesPage() {
  return <><Heading title="Шаблоны" tail="документов." /><TemplateEditor /></>
}

function TemplateEditor() {
  const templates = useQuery<DocumentTemplate[]>(templatesPath)
  const [draft, setDraft] = useState<DocumentTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const inYears = draft?.retentionYears != null

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || busy) return
    setBusy(true); setError(undefined)
    try {
      await requestJson(draft.id ? templatesPath + '/' + draft.id : templatesPath,
        { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(draft) })
      setDraft(null); templates.refresh()
    } catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }

  async function remove(template: DocumentTemplate) {
    if (!window.confirm(`Удалить шаблон «${template.name}»? Его срок хранения перестанет применяться.`)) return
    setBusy(true); setError(undefined)
    try {
      await requestVoid(templatesPath + '/' + template.id, { method: 'DELETE' })
      if (draft?.id === template.id) setDraft(null)
      templates.refresh()
    } catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }

  return <section className="panel results-panel">
    <div className="panel-header"><h2>Шаблоны документов</h2>
      <button className="button button-light" type="button" disabled={busy} onClick={() => { setError(undefined); setDraft(emptyTemplate) }}>Добавить шаблон</button>
    </div>
    <Status {...templates} empty={templates.data?.length === 0 ? 'Создайте шаблон, чтобы применять срок хранения к подходящим документам.' : undefined} />
    <div className="result-list">{templates.data?.map(template => <div className="document-template-row" key={template.id}>
      <span><strong>{template.name}</strong><small>{template.retentionYears != null ? template.retentionYears + ' г.' : template.retentionDays + ' дн.'} с последнего изменения</small></span>
      <button className="button button-light" type="button" disabled={busy} onClick={() => { setError(undefined); setDraft(template) }}>Изменить</button>
      <button className="button button-light" type="button" disabled={busy} onClick={() => void remove(template)}>Удалить</button>
    </div>)}</div>
    {draft && <form className="document-template-form" onSubmit={save}>
      <div className="impl-field-grid">
        <label className="results-field">Название<input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <div className="template-duration">
          <label className="results-field">Срок хранения<input required type="number" min={1} max={inYears ? 100 : 36500}
            value={(inYears ? draft.retentionYears : draft.retentionDays) || ''}
            onChange={event => setDraft({ ...draft, [inYears ? 'retentionYears' : 'retentionDays']: Number(event.target.value) })} /></label>
          <label className="results-field">Единица<select value={inYears ? 'years' : 'days'} onChange={event => {
            const useYears = event.target.value === 'years'
            setDraft({ ...draft, retentionDays: useYears ? null : 0, retentionYears: useYears ? 0 : null })
          }}><option value="days">Дни</option><option value="years">Годы</option></select></label>
        </div>
        {([['pathContains', 'Фрагмент пути'], ['nameContains', 'Фрагмент имени'], ['contentContains', 'Фрагмент содержимого']] as const).map(([key, title]) =>
          <label className="results-field" key={key}>{title}<input maxLength={512} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
      </div>
      <p className="page-lead">Заполните хотя бы одно условие. Все заполненные условия должны совпасть. После изменения условия по содержимому запустите сбор заново.</p>
      <div className="results-toolbar">
        <button className="button button-dark" disabled={busy || ![draft.pathContains, draft.nameContains, draft.contentContains].some(value => value.trim())}>Сохранить шаблон</button>
        <button className="button button-light" type="button" disabled={busy} onClick={() => { setError(undefined); setDraft(null) }}>Отмена</button>
      </div>
    </form>}
    <Status loading={false} error={error} />
  </section>
}

function DocumentBrowser({ implId, runId, graph = false, target, onGraph }: {
  implId: string; runId: string; graph?: boolean; target?: string; onGraph?: (path: string) => void
}) {
  const [search, setSearch] = useState(target ?? '')
  const [mode, setMode] = useState(graph ? 'graph' : 'matched')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(target ?? '')
  const data = useQuery<DocumentPage>(url('/api/documents/' + encodeURIComponent(implId), { run: runId || null, search, mode, offset, limit: PAGE_SIZE }))
  const focus = data.data?.items.find(item => item.path === selected) ?? data.data?.items[0]
  function open(path: string) { setMode('graph'); setSearch(path); setSelected(path); setOffset(0) }
  return <section className="panel results-panel">
    <h2>{graph ? 'Связи документов' : 'Сопоставление с шаблонами'}</h2>
    <div className="results-toolbar">
      <label className="results-field">Поиск по пути<input type="search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} /></label>
      <label className="results-field">Показать<select value={mode} onChange={event => { setMode(event.target.value); setOffset(0) }}>
        <option value={graph ? 'linked' : 'matched'}>{graph ? 'Документы с прямыми ссылками' : 'Совпадения и ожидающие сбора'}</option>
        <option value={graph ? 'graph' : 'all'}>Все документы</option>
      </select></label>
    </div>
    <Status {...data} empty={data.data?.items.length === 0 ? 'Документы по выбранным условиям не найдены.' : undefined} />
    {graph && data.data && !data.data.complete && <p className="empty-note">Сведения о ссылках неполные. Удаление по этому сбору недоступно.</p>}
    {graph && focus && <>
      <label className="results-field">Документ<select value={focus.path} onChange={event => setSelected(event.target.value)}>
        {data.data?.items.map(item => <option key={item.path}>{item.path}</option>)}
      </select></label>
      <ReferenceGraph key={focus.path} focus={focus} onOpen={open} />
      {!focus.needsScan && !focus.templates.some(template => template.active) &&
        <ArchiveButton key={focus.path} implId={implId} path={focus.path} />}
    </>}
    {!graph && <div className="result-list">{data.data?.items.map(item => <details className="result-row" key={item.path}>
      <summary><span><strong>{item.path.slice(item.path.lastIndexOf('/') + 1)}</strong><small>{item.path}</small></span>
        <span className={'result-badge' + (item.deleteBlocked ? ' attention' : '')}>{item.needsScan ? 'Требуется новый сбор' : item.deleteBlocked ? 'Удаление заблокировано' : item.templates.length ? 'Срок хранения истёк' : 'Без шаблона'}</span>
      </summary>
      {item.templates.map(template => <p key={template.id}>{template.name} · {template.retainUntil ? `хранить до ${date(template.retainUntil)}` : 'дата изменения неизвестна'}</p>)}
      {onGraph && <button className="button button-light" type="button" onClick={() => onGraph(item.path)}>Открыть связи <ArrowRight size={14} /></button>}
    </details>)}</div>}
    <Paging index={offset / PAGE_SIZE} busy={data.loading} hasNext={data.data?.nextOffset != null}
      onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(data.data?.nextOffset ?? offset)} />
  </section>
}

function ReferenceGraph({ focus, onOpen }: { focus: DocumentItem; onOpen: (path: string) => void }) {
  const marker = useId()
  const [offset, setOffset] = useState(0)
  const limit = 8
  const incoming = focus.referencedBy.slice(offset, offset + limit)
  const outgoing = focus.references.slice(offset, offset + limit)
  const count = Math.max(focus.referencedBy.length, focus.references.length)
  const related = focus.related ?? []
  const y = (index: number, total: number) => 100 * (index + .5) / total
  const filename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
  const neighbors = (paths: string[], side: 'incoming' | 'outgoing') => paths.map((path, index) =>
    <button key={path} type="button" title={path} style={{ top: y(index, paths.length) + '%' }}
      className={'document-node document-node-' + side} onClick={() => onOpen(path)}>
      <File size={15} /><span>{filename(path)}</span>
    </button>)
  return <figure className="reference-graph">
    <figcaption><span>Входящие ссылки · {focus.referencedBy.length}</span><span>Выбранный документ</span><span>Исходящие ссылки · {focus.references.length}</span></figcaption>
    <div className="reference-graph-canvas" style={{ height: Math.max(190, 60 * Math.max(incoming.length, outgoing.length)) }}>
      <svg className="reference-graph-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={marker} markerWidth="3" markerHeight="3" refX="2" refY="1.5" orient="auto">
          <path d="M 0 0 L 2 1.5 L 0 3" fill="none" stroke="currentColor" />
        </marker></defs>
        {incoming.map((path, index) => <path key={path}
          d={`M 28 ${y(index, incoming.length)} C 33 ${y(index, incoming.length)}, 33 50, 37 50`} markerEnd={`url(#${marker})`} />)}
        {outgoing.map((path, index) => <path key={path}
          d={`M 63 50 C 67 50, 67 ${y(index, outgoing.length)}, 72 ${y(index, outgoing.length)}`} markerEnd={`url(#${marker})`} />)}
      </svg>
      {neighbors(incoming, 'incoming')}
      <div className="document-node document-node-focus" title={focus.path}>
        <File size={18} /><strong>{filename(focus.path)}</strong>
        {focus.deleteBlocked && <span className="result-badge attention">Защищён</span>}
      </div>
      {neighbors(outgoing, 'outgoing')}
    </div>
    <p className="reference-graph-path">{focus.path}</p>
    {!count && <p className="empty-note">В выбранном сборе прямых ссылок для этого документа не найдено.</p>}
    {count > limit && <Paging busy={false} index={offset / limit} hasNext={offset + limit < count}
      onBack={() => setOffset(offset - limit)} onNext={() => setOffset(offset + limit)} />}
    <section className="related-documents">
      <h3>Косвенные связи</h3>
      {related.length === 0 && <small>Совпадений по содержимому не найдено.</small>}
      {related.map(link => <button type="button" className="related-document" key={link.path} onClick={() => onOpen(link.path)}>
        <File size={15} /><span><strong>{filename(link.path)}</strong><small>{link.path}</small></span>
        <span className="result-badge">{link.kind === 'IDENTICAL_CONTENT' ? 'Точная копия'
          : (link.kind === 'SHARED_IDENTIFIERS' ? 'Общих идентификаторов' : 'Общих фрагментов') + ' · ' + link.sharedFragments}</span>
      </button>)}
    </section>
  </figure>
}

export function GraphPage({ items, implId, runId, target, onImpl, onRun }: {
  items: Connection[]; implId: string; runId: string; target: string; onImpl: (id: string) => void; onRun: (id: string) => void
}) {
  return <><Heading title="Граф" tail="зависимостей." />
    <section className="panel results-panel"><div className="results-toolbar">
      <ConnectionPicker items={items} value={implId} onChange={onImpl} />
      <RunPicker key={implId} implId={implId} value={runId} onChange={onRun} completedOnly latestByDefault />
    </div></section>
    {implId && <DocumentBrowser key={JSON.stringify([implId, runId, target])} implId={implId} runId={runId} graph target={target} />}
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
    <Status {...scores} empty={scores.data?.length === 0 ? 'В этом сборе нет файлов с достаточными данными для рекомендаций.' : undefined} />
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
        {implId && score.responseState === 'ARCHIVE_CONFIRMATION_REQUIRED' && <ArchiveButton implId={implId} path={score.path} />}
      </details>
    })}</div>
    <Paging index={offset / PAGE_SIZE} busy={scores.loading} hasNext={(scores.data?.length ?? 0) > PAGE_SIZE}
      onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(offset + PAGE_SIZE)} />
  </section>
}

const filesystemArchivePath = (implId: string) => '/api/documents/' + encodeURIComponent(implId) + '/archive'

function ArchiveButton({ implId, path }: { implId: string; path: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [done, setDone] = useState(false)
  async function archiveFile() {
    setBusy(true)
    setError(undefined)
    try {
      if (path.startsWith('file:///')) {
        if (window.confirm('Создать архивную копию?\\n' + path)) {
          await requestJson(filesystemArchivePath(implId), { method: 'POST', body: JSON.stringify({ path }) })
          setDone(true)
        }
        return
      }
      const source = parseLocation(path)
      if (!source) throw new Error('Неизвестный формат пути документа.')
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

export function ArchivePage({ items, implId, onImpl, onGraph }: { items: Connection[]; implId: string; onImpl: (id: string) => void; onGraph: () => void }) {
  const source = items.find(item => item.id === implId)?.sourceId
  return <><Heading title="Архив" tail="файлов." />
    <section className="panel results-panel"><ConnectionPicker items={items} value={implId} onChange={onImpl} /></section>
    {source === S3_SOURCE && <ArchiveEntries key={implId} implId={implId} />}
    {source === FILE_STORAGE_SOURCE && <FilesystemArchiveEntries key={implId} implId={implId} onGraph={onGraph} />}
  </>
}

type FilesystemCopy = { id: string; path: string; sizeBytes: number; createdAt: string }

function FilesystemArchiveEntries({ implId, onGraph }: { implId: string; onGraph: () => void }) {
  const [offset, setOffset] = useState(0)
  const base = filesystemArchivePath(implId)
  const entries = useQuery<Page<FilesystemCopy>>(url(base, { offset, limit: PAGE_SIZE }))
  return <section className="panel results-panel">
    <div className="panel-header"><h2>Архивные копии</h2>
      <button className="button button-light" type="button" onClick={onGraph}>Выбрать документ <ArrowRight size={14} /></button>
    </div>
    <Status {...entries} empty={entries.data?.items.length === 0 ? 'Архивных копий пока нет.' : undefined} />
    <div className="result-list">{entries.data?.items.map(item => <div className="document-template-row" key={item.id}>
      <span><strong>{item.path.slice(item.path.lastIndexOf('/') + 1)}</strong><small>{item.path} · {date(item.createdAt)} · {size(item.sizeBytes)}</small></span>
      <a className="button button-light" href={base + '/' + encodeURIComponent(item.id) + '/download'}>Скачать</a>
    </div>)}</div>
    <Paging index={offset / PAGE_SIZE} busy={entries.loading} hasNext={entries.data?.nextOffset != null}
      onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(entries.data?.nextOffset ?? offset)} />
  </section>
}

function ArchiveEntries({ implId }: { implId: string }) {
  const [state, setState] = useState('ARCHIVED')
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>()
  const [notice, setNotice] = useState('')
  const base = implPath(implId) + '/archive'
  const entries = useQuery<Page<ArchiveEntry>>(url(base, { state, offset, limit: PAGE_SIZE }))
  async function change(item: ArchiveEntry, action: 'restore' | 'undo-restore' | 'delete', cascade = false) {
    setBusy(item.id); setError(undefined); setNotice('')
    try {
      const entry = base + '/' + encodeURIComponent(item.id)
      if (action === 'delete') {
        const plan = await requestJson<{ ids: string[]; paths: string[] }>(url(entry + '/delete-plan', { cascade: String(cascade) }))
        const question = cascade ? 'Удалить перечисленные файлы и их архивные копии?' : 'Удалить только этот документ и его архивную копию?'
        if (!window.confirm(question + '\n' + plan.paths.join('\n'))) return
        await requestJson(url(entry, { cascade: String(cascade) }),
          { method: 'DELETE', body: JSON.stringify({ ids: plan.ids }) })
      } else {
        await requestJson(entry + '/' + action, { method: 'POST' })
      }
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
        {['ARCHIVED', 'RESTORED'].includes(item.state) && <>
          <ArchiveAction disabled={Boolean(busy)} onClick={() => void change(item, 'delete')}>Удалить только этот файл</ArchiveAction>
          <ArchiveAction disabled={Boolean(busy)} onClick={() => void change(item, 'delete', true)}>Удалить каскадно</ArchiveAction>
        </>}
      </div>
    </details>)}</div>
    <Paging index={offset / PAGE_SIZE} busy={entries.loading} hasNext={entries.data?.nextOffset != null}
      onBack={() => setOffset(offset - PAGE_SIZE)} onNext={() => setOffset(entries.data?.nextOffset ?? offset)} />
  </section>
}

function ArchiveAction({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return <button type="button" className="button button-light" disabled={disabled} onClick={onClick}>{children}</button>
}
