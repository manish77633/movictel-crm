import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { ZodError } from 'zod'
import mongoose from 'mongoose'
import pino from 'pino'
import { auth, workspaces } from './auth.js'
import { crm } from './crm.js'
import { conversations, rules } from './messaging.js'
import { webhooks } from './webhooks.js'
import { integrations, metaCallback } from './integrations.js'
import { authenticate, workspaced } from './runtime.js'
import { sheetCampaigns, sheetSources } from './sheet-sources.js'
import { env, frontend, production } from './config.js'

export const log = pino({ level: env.LOG_LEVEL || 'info' })
export const app = express()
app.disable('x-powered-by')
if (env.TRUST_PROXY === '1') app.set('trust proxy', 1)
app.use(helmet(), rateLimit({ windowMs: 60000, limit: 300 }))
app.get('/api/v1/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' })
})
if (!production)
  app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '512kb' }), webhooks)
app.use(express.json({ limit: '64kb' }), cookieParser())
app.use((req, res, next) => {
  const origin = req.header('origin')
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    ((origin && origin !== frontend) || req.header('sec-fetch-site') === 'cross-site')
  ) {
    res.status(403).json({ error: 'Request origin is not allowed.' })
    return
  }
  if (req.path.startsWith('/api/v1')) res.set('Cache-Control', 'no-store')
  next()
})
app.use('/api/v1/auth', auth)
app.use('/api/v1/workspaces', workspaces)
app.use('/api/v1/integrations/google-sheets', authenticate, workspaced, sheetSources)
app.use('/api/v1/campaign-sheets', authenticate, workspaced, sheetCampaigns)
if (!production) {
  app.use('/api/v1/meta', metaCallback)
  app.use('/api/v1/integrations', authenticate, workspaced, integrations)
  app.use('/api/v1/conversations', authenticate, workspaced, conversations)
  app.use('/api/v1', authenticate, workspaced, rules)
}
app.use('/api/v1', authenticate, workspaced, crm)
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' })
})
const handle: express.ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Check ' + (error.issues[0]?.path.join('.') || 'the fields') + ' and try again.',
    })
    return
  }
  if (error.code === 11000) {
    res.status(409).json({ error: 'This record already exists or the connected asset is in use.' })
    return
  }
  const status =
    Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 500
  if (status >= 500)
    log.error({ status, method: req.method, errorType: error.name }, 'Request failed')
  res.status(status).json({
    error:
      status === 500
        ? 'The server could not complete the request.'
        : error.type === 'entity.parse.failed'
          ? 'Invalid JSON.'
          : error.message,
  })
}
app.use(handle)
