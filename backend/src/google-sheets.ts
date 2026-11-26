import { createSign } from 'node:crypto'
import { env } from './config.js'
import { failure } from './runtime.js'

export function parseSheetLink(input: string) {
  const url = new URL(input)
  const match = /^\/spreadsheets\/d\/([\w-]{1,200})(?:\/edit)?\/?$/.exec(url.pathname)
  const gid = new URLSearchParams(url.hash.slice(1)).get('gid') ?? url.searchParams.get('gid')
  if (
    url.origin !== 'https://docs.google.com' ||
    url.username ||
    url.password ||
    !match ||
    (gid !== null && !/^\d{1,10}$/.test(gid))
  )
    throw new Error('Paste a Google Sheets link.')
  return { spreadsheetId: match[1], sheetId: gid === null ? undefined : Number(gid) }
}

const aliases = {
  externalId: ['lead_id', 'leadgen_id', 'leadgenid', 'meta_lead_id', 'id'],
  name: ['full_name', 'name', 'your_name'],
  firstName: ['first_name'],
  lastName: ['last_name'],
  phone: ['phone_number', 'phone', 'mobile_number', 'mobile'],
  email: ['email', 'email_address'],
  company: ['company_name', 'company', 'business_name'],
  campaign: ['campaign_name', 'campaign'],
}
export function parseSheetRows(values: string[][]) {
  const [header = [], ...rows] = values
  const headers = header.map((cell) =>
    String(cell)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_'),
  )
  const columns = Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => [
      field,
      names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1,
    ]),
  )
  if (
    columns.externalId < 0 ||
    [columns.name, columns.firstName, columns.lastName, columns.email, columns.phone].every(
      (index) => index < 0,
    )
  )
    return failure(422, 'The first row needs a Lead ID column and a name, phone, or email column.')

  let skipped = 0
  const leads = new Map<
    string,
    {
      externalId: string
      name: string
      phone: string
      email: string
      company: string
      campaign: string
      sheetFields: { label: string; value: string }[]
    }
  >()
  for (const row of rows) {
    if (!row.some((cell) => String(cell ?? '').trim())) continue
    const read = (field: keyof typeof aliases) => String(row[columns[field]] ?? '').trim()
    const externalId = read('externalId').replace(/^l:(?=\d+$)/i, '')
    if (!externalId || externalId.length > 200 || /^[\d.]+e[+-]?\d+$/i.test(externalId)) {
      skipped++
      continue
    }
    const phone = read('phone')
      .replace(/^p:/i, '')
      .replace(/[\s().-]/g, '')
      .slice(0, 40)
    const email = read('email').toLowerCase().slice(0, 254)
    const name =
      read('name') ||
      [read('firstName'), read('lastName')].filter(Boolean).join(' ') ||
      email ||
      phone ||
      'Unnamed lead'
    if (!leads.has(externalId))
      leads.set(externalId, {
        externalId,
        name: name.slice(0, 160),
        phone,
        email,
        company: read('company').slice(0, 160),
        campaign: read('campaign').slice(0, 160),
        sheetFields: header.flatMap((label, index) => {
          const value = String(row[index] ?? '').trim()
          return label && value ? [{ label: String(label), value }] : []
        }),
      })
  }
  return { leads: [...leads.values()], skipped }
}

let cachedToken: { value: string; expires: number } | undefined
async function googleToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value
  const email = env.GOOGLE_SHEETS_CLIENT_EMAIL
  const key = env.GOOGLE_SHEETS_PRIVATE_KEY
  if (!email || !key) return failure(503, 'Google Sheets credentials are missing.')
  const now = Math.floor(Date.now() / 1000)
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url')
  const audience = 'https://oauth2.googleapis.com/token'
  const input =
    encode({ alg: 'RS256', typ: 'JWT' }) +
    '.' +
    encode({
      iss: email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: audience,
      iat: now,
      exp: now + 3600,
    })
  const assertion =
    input +
    '.' +
    createSign('RSA-SHA256').update(input).sign(key.replace(/\\n/g, '\n'), 'base64url')
  const response = await fetch(audience, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return failure(502, 'Google rejected the Sheets credentials.')
  const result = (await response.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: result.access_token, expires: Date.now() + result.expires_in * 1000 }
  return cachedToken.value
}
async function googleRead<T>(path: string): Promise<T> {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + path, {
    headers: {
      Authorization: 'Bearer ' + (await googleToken()),
    },
    signal: AbortSignal.timeout(30_000),
  })
  if ([403, 404].includes(response.status))
    return failure(
      422,
      'Cannot read the sheet. Check the link and share it with the service account as Viewer.',
    )
  if (response.status === 429)
    return failure(503, 'Google Sheets rate limit reached. Retry on the next sync.')
  if (!response.ok)
    return failure(502, 'Google Sheets could not read this tab. Check that it still exists.')
  return response.json() as Promise<T>
}
export async function resolveSheet(spreadsheetId: string, sheetId?: number) {
  type Tab = { properties: { sheetId: number; title: string; index: number } }
  const { sheets } = await googleRead<{ sheets: Tab[] }>(
    spreadsheetId + '?fields=sheets(properties(sheetId,title,index))',
  )
  const tab = sheets.find(({ properties }) =>
    sheetId === undefined ? properties.index === 0 : properties.sheetId === sheetId,
  )
  return tab?.properties ?? failure(422, 'The linked tab does not exist.')
}
export async function readSheet(spreadsheetId: string, tabName: string) {
  const range = "'" + tabName.replaceAll("'", "''") + "'"
  const result = await googleRead<{ values?: string[][] }>(
    spreadsheetId + '/values/' + encodeURIComponent(range) + '?valueRenderOption=FORMATTED_VALUE',
  )
  return parseSheetRows(result.values ?? [])
}
