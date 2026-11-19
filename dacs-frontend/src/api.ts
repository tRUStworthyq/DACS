export type ErrorKind = 'auth' | 'network' | 'server' | ''

const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const GATEWAY_ORIGIN = (import.meta.env.VITE_GATEWAY_ORIGIN || (import.meta.env.DEV ? 'http://localhost:8765' : '')).replace(/\/$/, '')
export const KEYCLOAK_LOGIN_URL = `${GATEWAY_ORIGIN}/oauth2/authorization/keycloak`

export class ApiError extends Error {
  kind: ErrorKind
  constructor(message: string, kind: ErrorKind, readonly status?: number) {
    super(message)
    this.kind = kind
  }
}

async function requestResponse(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    const headers = new Headers(init.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      redirect: 'manual',
      headers,
    })
  } catch {
    throw new ApiError('Не удалось связаться с Gateway. Проверьте, что сервис запущен, и повторите запрос.', 'network')
  }

  if (response.status === 401 || response.status === 302 || response.status === 303 || response.type === 'opaqueredirect') {
    throw new ApiError('Gateway требует авторизацию. Выполните вход через Keycloak и повторите запрос.', 'auth')
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.headers.get('Content-Type')?.includes('application/problem+json')) {
      try {
        const problem = JSON.parse(detail) as { detail?: string }
        if (problem.detail) throw new ApiError(problem.detail, 'server', response.status)
      } catch (error) {
        if (error instanceof ApiError) throw error
      }
    }
    throw new ApiError(`Core вернул HTTP ${response.status}${detail ? `: ${detail.slice(0, 220)}` : ''}`, 'server', response.status)
  }
  return response
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export async function requestVoid(path: string, init: RequestInit = {}): Promise<void> {
  await requestResponse(path, init)
}

type StreamEvent =
  | { type: 'phase' | 'delta' | 'error'; text: string }
  | { type: 'done'; chatId: string }

export async function streamChat(path: string, body: { content: string; requestId?: string },
                                 onEvent: (event: StreamEvent) => void, signal: AbortSignal): Promise<string> {
  const response = await requestResponse(path, {
    method: 'POST', body: JSON.stringify(body), signal, headers: { Accept: 'text/event-stream' },
  })
  if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
    throw new ApiError('Сервер не открыл поток ответа.', 'server')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let boundary = /\r?\n\r?\n/.exec(buffer)
      while (boundary) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n')
        if (data) {
          const event = JSON.parse(data) as StreamEvent
          if (event.type === 'done') return event.chatId
          if (event.type === 'error') throw new ApiError(event.text, 'server')
          onEvent(event)
        }
        boundary = /\r?\n\r?\n/.exec(buffer)
      }
      if (done) throw new ApiError('Ответ прервался до сохранения сообщения.', 'server')
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
