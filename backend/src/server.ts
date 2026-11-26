import { createServer } from 'node:http'
import mongoose from 'mongoose'
import { Server } from 'socket.io'
import { app, log } from './app.js'
import { env, frontend, required } from './config.js'
import { Member, models } from './models.js'
import { readAccess, registerSockets } from './runtime.js'
import { startWorker } from './worker.js'
import { bootstrapAdmin } from './auth.js'
import { prepareSheetConnections, syncDueSheets } from './sheet-sources.js'

required('ACCESS_SECRET')
await mongoose.connect(required('MONGODB_URI'))
await Promise.all(models.map((model) => model.init()))
await prepareSheetConnections()
await bootstrapAdmin()
const server = createServer(app)
const io = new Server(server, {
  allowRequest: (req, done) => done(null, !req.headers.origin || req.headers.origin === frontend),
})
registerSockets(io)
io.use(async (socket, next) => {
  try {
    const match = socket.request.headers.cookie?.match(/(?:^|;\s*)access=([^;]+)/)
    const userId = await readAccess(match?.[1])
    const workspaceId = socket.handshake.auth.workspaceId
    if (
      !userId ||
      typeof workspaceId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(workspaceId) ||
      !(await Member.exists({ workspaceId, userId }))
    ) {
      next(new Error('Workspace access denied.'))
      return
    }
    socket.data.workspaceId = workspaceId
    socket.data.userId = userId
    next()
  } catch {
    next(new Error('Connection is unavailable.'))
  }
})
io.on('connection', (socket) => {
  void socket.join(socket.data.workspaceId)
  const timer = setInterval(() => {
    void Member.exists({ workspaceId: socket.data.workspaceId, userId: socket.data.userId })
      .then((member) => {
        if (!member) socket.disconnect(true)
      })
      .catch(() => socket.disconnect(true))
  }, 15000)
  socket.once('disconnect', () => clearInterval(timer))
})
const worker = env.RUN_WORKER === 'false' ? undefined : await startWorker()
server.listen(Number(env.PORT || 4000), () => log.info('Relay API listening'))
let sheetSync: Promise<void> | undefined
function pollSheets() {
  if (
    sheetSync ||
    env.SHEETS_AUTO_SYNC === 'false' ||
    !env.GOOGLE_SHEETS_CLIENT_EMAIL ||
    !env.GOOGLE_SHEETS_PRIVATE_KEY
  )
    return
  sheetSync = syncDueSheets((message) => log.warn(message))
    .catch(() => log.error('Could not scan for due Google Sheets connections.'))
    .finally(() => {
      sheetSync = undefined
    })
}
const sheetTimer = setInterval(pollSheets, 30_000)
sheetTimer.unref()
pollSheets()
async function shutdown() {
  clearInterval(sheetTimer)
  io.close()
  await worker?.()
  await sheetSync
  await mongoose.disconnect()
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
