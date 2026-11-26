import mongoose from 'mongoose'
import { setTimeout } from 'node:timers/promises'
import { required } from './config.js'
import { Lead, SheetConnection } from './models.js'
import { importSheet } from './sheet-sources.js'

try {
  await mongoose.connect(required('MONGODB_URI'))
  await Promise.all([Lead.init(), SheetConnection.init()])
  for await (const row of SheetConnection.find().select('workspaceId').lean().cursor()) {
    try {
      const result = await importSheet(row.workspaceId)
      console.info('Google Sheets sync', row.workspaceId, result)
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409) continue
      process.exitCode = 1
      console.error('Google Sheets sync failed', row.workspaceId)
    } finally {
      // Stay below the per-service-account Sheets API read quota.
      await setTimeout(2500)
    }
  }
} catch {
  console.error('Could not run Google Sheets sync. Check MongoDB and backend credentials.')
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
