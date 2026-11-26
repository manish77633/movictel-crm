import { Router } from 'express'
import { z } from 'zod'
import { env } from './config.js'
import { Lead, SheetConnection, User } from './models.js'
import { failure, manager, publish } from './runtime.js'
import { parseSheetLink, readSheet, resolveSheet } from './google-sheets.js'

export const sheetSources = Router()
const source = 'Google Sheets'

export async function isSheetAdmin(userId: string) {
  const addresses = (env.GOOGLE_SHEETS_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return (
    addresses.length > 0 &&
    Boolean(await User.exists({ _id: userId, verified: true, email: { $in: addresses } }))
  )
}
sheetSources.use(async (req, _res, next) => {
  manager(req)
  if (!(await isSheetAdmin(req.userId)))
    return failure(403, 'Google Sheets connections are managed by the agency.')
  next()
})
sheetSources.get('/', async (req, res) => {
  const connection = await SheetConnection.findOne({ workspaceId: req.workspaceId })
    .select('-leaseUntil')
    .lean()
  res.json({ viewerEmail: env.GOOGLE_SHEETS_CLIENT_EMAIL || '', connection })
})
sheetSources.post('/', async (req, res) => {
  const { url } = z.object({ url: z.string().trim().min(1).max(1000) }).parse(req.body)
  const parsed = (() => {
    try {
      return parseSheetLink(url)
    } catch {
      return failure(400, 'Paste a valid Google Sheets link.')
    }
  })()
  if (await SheetConnection.exists({ workspaceId: req.workspaceId }))
    return failure(409, 'This workspace already has a connected sheet.')
  if (await SheetConnection.exists({ spreadsheetId: parsed.spreadsheetId }))
    return failure(409, 'This spreadsheet already has a connection.')
  const tab = await resolveSheet(parsed.spreadsheetId, parsed.sheetId)
  await readSheet(parsed.spreadsheetId, tab.title)
  const row = await SheetConnection.create({
    workspaceId: req.workspaceId,
    spreadsheetId: parsed.spreadsheetId,
    sheetId: tab.sheetId,
    tabName: tab.title,
  })
  res.status(201).json({ id: row.id })
})
sheetSources.post('/sync', async (req, res) => {
  const result = await importSheet(req.workspaceId)
  if (result.imported) publish(req.workspaceId)
  res.json(result)
})

export async function importSheet(workspaceId: string) {
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 10 * 60_000)
  const row = await SheetConnection.findOneAndUpdate(
    { workspaceId, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
    { $set: { leaseUntil } },
    { new: true },
  )
  if (!row) return failure(409, 'Connect a sheet or wait for the current sync to finish.')
  const lease = { _id: row._id, leaseUntil }
  let imported = 0
  try {
    const tab = await resolveSheet(row.spreadsheetId!, row.sheetId!)
    const { leads, skipped } = await readSheet(row.spreadsheetId!, tab.title)
    for (let offset = 0; offset < leads.length; offset += 500) {
      const result = await Lead.bulkWrite(
        leads.slice(offset, offset + 500).map((lead) => ({
          updateOne: {
            filter: { workspaceId, source, externalId: lead.externalId },
            update: {
              $setOnInsert: {
                ...lead,
                workspaceId,
                source,
                status: 'New',
                consent: 'unknown',
                createdAt: now,
                updatedAt: now,
              },
            },
            upsert: true,
            timestamps: false,
          },
        })),
        { ordered: false },
      )
      imported += result.upsertedCount
    }
    await SheetConnection.updateOne(lease, {
      $set: { lastSyncAt: new Date(), tabName: tab.title, lastImported: imported, skipped },
      $unset: { error: 1, leaseUntil: 1 },
    })
    return { imported, skipped }
  } catch (error) {
    const known = error instanceof Error && 'status' in error
    await SheetConnection.updateOne(lease, {
      $set: {
        error: known ? error.message : 'Sync failed. Retry or check the backend configuration.',
      },
      $unset: { leaseUntil: 1 },
    })
    throw error
  }
}
