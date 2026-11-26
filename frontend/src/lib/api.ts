let refreshing: Promise<Response> | undefined
export async function api<T>(
  path: string,
  workspace?: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: {
      ...(workspace && { 'x-workspace-id': workspace }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }
  let response = await fetch('/api/v1' + path, options)
  if (response.status === 401 && !path.startsWith('/auth/')) {
    refreshing ??= fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    }).finally(() => {
      refreshing = undefined
    })
    if ((await refreshing).ok) response = await fetch('/api/v1' + path, options)
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(
      error?.error || 'The request could not be completed. Check the API connection and try again.',
    )
  }
  return response.json()
}
