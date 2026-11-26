import { z } from 'zod'
import { required } from './config.js'
import { failure } from './runtime.js'
type GraphList<T> = { data: T[]; paging?: { cursors?: { after?: string }; next?: string } }
export async function graph<T>(
  path: string,
  token?: string,
  query: Record<string, string> = {},
  body?: object,
) {
  const version = z
    .string()
    .regex(/^v\d+\.\d+$/)
    .parse(required('META_GRAPH_VERSION'))
  const url = new URL('https://graph.facebook.com/' + version + '/' + path)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token && { Authorization: 'Bearer ' + token }),
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok)
    throw Object.assign(new Error('Meta could not complete this operation.'), {
      status: 502,
      providerStatus: response.status,
    })
  return response.json() as Promise<T>
}
export async function graphList<T>(path: string, token: string, fields: string) {
  const result: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const list: GraphList<T> = await graph(path, token, {
      fields,
      limit: '100',
      ...(cursor && { after: cursor }),
    })
    result.push(...list.data)
    cursor = list.paging?.next ? list.paging.cursors?.after : undefined
    if (!cursor) return result
  }
  return failure(502, 'Too many Meta results to synchronize in one pass.')
}
export const tokenResult = z.object({ access_token: z.string(), expires_in: z.number().optional() })
