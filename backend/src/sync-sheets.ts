import mongoose from 'mongoose'
import { required } from './config.js'
import { Lead } from './models.js'
import { prepareSheetConnections, syncDueSheets } from './sheet-sources.js'

try {
  await mongoose.connect(required('MONGODB_URI'))
  await Lead.init()
  await prepareSheetConnections()
  await syncDueSheets((message) => {
    console.error(message)
    process.exitCode = 1
  }, new Date())
} catch {
  console.error('Could not run Google Sheets sync. Check MongoDB and backend credentials.')
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
