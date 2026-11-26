import { Router } from 'express'
import mongoose from 'mongoose'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import { env } from './config.js'
import { Lead, SheetConnection, User } from './models.js'
import { failure, manager, publish } from './runtime.js'
import { parseSheetLink, readSheet, resolveSheet } from './google-sheets.js'

export const sheetSources = Router()
export const sheetCampaigns = Router()
export const sheetSyncInterval = 5 * 60_000
const source = 'Google Sheets'

export function sheetAdminEmails() {
  return (env.GOOGLE_SHEETS_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export async function isSheetAdmin(userId: string) {
  const addresses = sheetAdminEmails()
  return (
    addresses.length > 0 &&
    Boolean(await User.exists({ _id: userId, verified: true, email: { $in: addresses } }))
  )
}
export async function prepareSheetConnections() {
  // Older deployments enforced a single connection using this unique index.
  const indexes = await SheetConnection.collection.indexes().catch((error) => {
    if (error.code === 26) return []
    throw error
  })
  const legacyIndex = indexes.find(
    (index) => index.unique && index.key.workspaceId === 1 && Object.keys(index.key).length === 1,
  )
  if (legacyIndex?.name) {
    await SheetConnection.collection.dropIndex(legacyIndex.name).catch((error) => {
      if (error.code !== 27) throw error
    })
  }
  await SheetConnection.createIndexes()
  for await (const row of SheetConnection.find({ campaignName: { $exists: false } }).cursor()) {
    const campaignName = row.tabName || 'Google Sheets'
    await Lead.updateMany(
      { workspaceId: row.workspaceId, source, campaignSheetId: null },
      { $set: { campaignSheetId: row.id, campaignSheetName: campaignName } },
      { timestamps: false },
    )
    await SheetConnection.updateOne({ _id: row._id }, { $set: { campaignName, legacyIds: true } })
  }
}

sheetCampaigns.get('/', async (req, res) => {
  const rows = await SheetConnection.find({ workspaceId: req.workspaceId })
    .select('campaignName tabName lastSyncAt')
    .sort('createdAt')
    .lean()
  res.json(rows)
})

sheetSources.post('/sync', async (req, res) => {
  if (req.role !== 'client') {
    manager(req)
    if (!(await isSheetAdmin(req.userId)))
      return failure(403, 'Google Sheets connections are managed by the agency.')
  }
  const { campaignSheetId } = z
    .object({
      campaignSheetId: z
        .string()
        .regex(/^[a-f0-9]{24}$/)
        .optional(),
    })
    .parse(req.body ?? {})
  const rows = await SheetConnection.find({
    workspaceId: req.workspaceId,
    ...(campaignSheetId && { _id: campaignSheetId }),
  })
    .select('_id campaignName')
    .lean()
  if (!rows.length) return failure(404, 'No campaign sheet is connected here.')
  const sync = await syncSheetRows(rows, req.workspaceId)
  res.json(sync)
})

sheetSources.use(async (req, _res, next) => {
  manager(req)
  if (!(await isSheetAdmin(req.userId)))
    return failure(403, 'Google Sheets connections are managed by the agency.')
  next()
})
sheetSources.get('/', async (req, res) => {
  const connections = await SheetConnection.find({ workspaceId: req.workspaceId })
    .select('-leaseUntil -legacyIds')
    .sort('createdAt')
    .lean()
  res.json({ viewerEmail: env.GOOGLE_SHEETS_CLIENT_EMAIL || '', connections })
})
sheetSources.post('/', async (req, res) => {
  const { url, campaignName } = z
    .object({
      url: z.string().trim().min(1).max(1000),
      campaignName: z.string().trim().min(1).max(160).optional(),
    })
    .parse(req.body)
  const parsed = (() => {
    try {
      return parseSheetLink(url)
    } catch {
      return failure(400, 'Paste a valid Google Sheets link.')
    }
  })()
  if (await SheetConnection.exists({ spreadsheetId: parsed.spreadsheetId }))
    return failure(409, 'This spreadsheet already has a connection.')
  const tab = await resolveSheet(parsed.spreadsheetId, parsed.sheetId)
  await readSheet(parsed.spreadsheetId, tab.title)
  const row = await SheetConnection.create({
    workspaceId: req.workspaceId,
    spreadsheetId: parsed.spreadsheetId,
    sheetId: tab.sheetId,
    tabName: tab.title,
    campaignName: campaignName || tab.title,
  })
  res.status(201).json({ id: row.id })
})
async function syncSheetRows(
  rows: { _id: mongoose.Types.ObjectId; campaignName?: string }[],
  workspaceId: string,
) {
  let imported = 0,
    skipped = 0
  const issues: string[] = []
  for (const row of rows) {
    try {
      const result = await importSheet(workspaceId, String(row._id))
      imported += result.imported
      skipped += result.skipped
    } catch (error) {
      const campaign = row.campaignName || 'Google Sheets'
      if (error instanceof Error && 'status' in error && error.status === 409) {
        issues.push(campaign + ' is already syncing.')
      } else {
        issues.push(campaign + ' could not sync. Check its connection in the Admin panel.')
      }
    }
  }
  return { imported, skipped, ...(issues.length && { issues }) }
}

export async function syncDueSheets(
  onError: (message: string) => void,
  due = new Date(Date.now() - sheetSyncInterval),
) {
  for await (const row of SheetConnection.find({
    $or: [{ lastAttemptAt: null }, { lastAttemptAt: { $lte: due } }],
  })
    .select('workspaceId')
    .sort('lastAttemptAt')
    .cursor()) {
    try {
      await importSheet(row.workspaceId, row.id, due)
    } catch (error) {
      if (!(error instanceof Error && 'status' in error && error.status === 409))
        onError('Google Sheets sync failed for connection ' + row.id)
    }
    await setTimeout(2500)
  }
}

export async function importSheet(workspaceId: string, campaignSheetId: string, due?: Date) {
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 10 * 60_000)
  const row = await SheetConnection.findOneAndUpdate(
    {
      _id: campaignSheetId,
      workspaceId,
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
      ...(due && { $and: [{ $or: [{ lastAttemptAt: null }, { lastAttemptAt: { $lte: due } }] }] }),
    },
    { $set: { leaseUntil, lastAttemptAt: now } },
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
            filter: {
              workspaceId,
              source,
              campaignSheetId: row.id,
              externalId: row.legacyIds ? lead.externalId : row.id + ':' + lead.externalId,
            },
            update: {
              $set: { sheetFields: lead.sheetFields },
              $setOnInsert: {
                name: lead.name,
                phone: lead.phone,
                email: lead.email,
                company: lead.company,
                campaign: lead.campaign,
                externalId: row.legacyIds ? lead.externalId : row.id + ':' + lead.externalId,
                campaignSheetId: row.id,
                campaignSheetName: row.campaignName || tab.title,
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
    publish(workspaceId)
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
