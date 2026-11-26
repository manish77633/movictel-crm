import { Router, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import mongoose from 'mongoose'
import { AccountToken, Invitation, Member, Session, User, Workspace } from './models.js'
import { cookie, env, frontend, required } from './config.js'
import { digest, passwordHash, randomToken, validPassword } from './security.js'
import { accessCookie, accessToken, authenticate, failure, manager, workspaced } from './runtime.js'
import { email, line, password } from './validation.js'

export const auth = Router()
export const workspaces = Router()
const cookieAge = 30 * 86400_000
auth.use(rateLimit({ windowMs: 15 * 60_000, limit: 60 }))
async function setSession(res: Response, userId: string) {
  const refresh = randomToken()
  const session = await Session.create({
    userId,
    digest: digest(refresh),
    expiresAt: new Date(Date.now() + cookieAge),
  })
  const access = accessToken(userId, String(session._id))
  res
    .cookie('access', access, accessCookie)
    .cookie('refresh', refresh, { ...cookie, maxAge: cookieAge })
}
export async function sendEmail(to: string, subject: string, body: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + required('RESEND_API_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: required('EMAIL_FROM'), to: [to], subject, text: body }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) failure(502, 'Email delivery is temporarily unavailable.')
}
async function sendAccountLink(userId: string, address: string, purpose: string) {
  const token = randomToken()
  await AccountToken.create({
    userId,
    purpose,
    digest: digest(token),
    expiresAt: new Date(Date.now() + 3600_000),
  })
  await sendEmail(
    address,
    purpose === 'verify' ? 'Verify your Relay email' : 'Reset your Relay password',
    frontend + '/account?mode=' + purpose + '&token=' + token,
  )
}
auth.post('/register', async (req, res) => {
  const input = z.object({ name: line, business: line, email, password }).parse(req.body)
  const verify = env.NODE_ENV === 'production' || env.LOCAL_SKIP_EMAIL !== 'true'
  if (verify) {
    required('RESEND_API_KEY')
    required('EMAIL_FROM')
  }
  const existing = await User.findOne({ email: input.email })
  if (existing) {
    if (
      verify &&
      !existing.verified &&
      existing.password &&
      validPassword(input.password, existing.password)
    ) {
      await sendAccountLink(String(existing._id), input.email, 'verify')
      res.status(202).json({ verify: true })
      return
    }
    return failure(409, 'An account already uses this email.')
  }
  const hashed = passwordHash(input.password)
  const userId = await mongoose.connection.transaction(async (session) => {
    const [user] = await User.create(
      [{ name: input.name, email: input.email, password: hashed, verified: !verify }],
      { session },
    )
    const [workspace] = await Workspace.create([{ name: input.business, timezone: 'UTC' }], {
      session,
    })
    await Member.create(
      [{ workspaceId: String(workspace._id), userId: String(user._id), role: 'owner' }],
      { session },
    )
    return String(user._id)
  })
  if (verify) await sendAccountLink(userId, input.email, 'verify')
  else await setSession(res, userId)
  res.status(201).json({ verify })
})
auth.post('/login', async (req, res) => {
  const input = z.object({ email, password }).parse(req.body)
  const user = await User.findOne({ email: input.email, verified: true })
  if (!validPassword(input.password, user?.password || 'invalid:invalid') || !user)
    return failure(401, 'Email or password is incorrect.')
  await setSession(res, String(user._id))
  res.json({ ok: true })
})
auth.post('/refresh', async (req, res) => {
  if (typeof req.cookies.refresh !== 'string') return failure(401, 'Sign in to continue.')
  const session = await Session.findOneAndDelete({
    digest: digest(req.cookies.refresh),
    expiresAt: { $gt: new Date() },
  })
  if (!session?.userId) return failure(401, 'Sign in to continue.')
  await setSession(res, session.userId)
  res.json({ ok: true })
})
auth.post('/logout', async (req, res) => {
  if (typeof req.cookies.refresh === 'string')
    await Session.deleteOne({ digest: digest(req.cookies.refresh) })
  res.clearCookie('access', cookie).clearCookie('refresh', cookie).json({ ok: true })
})
auth.post('/forgot-password', async (req, res) => {
  const address = email.parse(req.body.email)
  const user = await User.findOne({ email: address, verified: true })
  if (user) await sendAccountLink(String(user._id), address, 'reset')
  res.json({ ok: true })
})
auth.post('/verify', async (req, res) => {
  const token = z.string().length(43).parse(req.body.token)
  const account = await AccountToken.findOneAndDelete({
    digest: digest(token),
    purpose: 'verify',
    expiresAt: { $gt: new Date() },
  })
  if (!account?.userId) return failure(400, 'This verification link has expired.')
  await User.updateOne({ _id: account.userId }, { verified: true })
  await setSession(res, account.userId)
  res.json({ ok: true })
})
auth.post('/reset-password', async (req, res) => {
  const input = z.object({ token: z.string().length(43), password }).parse(req.body)
  const hashed = passwordHash(input.password)
  await mongoose.connection.transaction(async (session) => {
    const account = await AccountToken.findOneAndDelete(
      { digest: digest(input.token), purpose: 'reset', expiresAt: { $gt: new Date() } },
      { session },
    )
    if (!account?.userId) return failure(400, 'This reset link has expired.')
    await User.updateOne({ _id: account.userId }, { password: hashed }, { session })
    await Session.deleteMany({ userId: account.userId }, { session })
    await AccountToken.deleteMany({ userId: account.userId, purpose: 'reset' }, { session })
  })
  res.json({ ok: true })
})
auth.post('/accept-invite', async (req, res) => {
  const input = z.object({ token: z.string().length(43), name: line, password }).parse(req.body)
  const matched = { digest: digest(input.token), expiresAt: { $gt: new Date() } }
  const invitation = await Invitation.findOne(matched)
  if (!invitation?.email || !invitation.role) return failure(400, 'This invitation has expired.')
  const existing = await User.findOne({ email: invitation.email })
  if (existing && (!existing.password || !validPassword(input.password, existing.password)))
    return failure(403, 'Use the password for your existing account.')
  const userId = await mongoose.connection.transaction(async (session) => {
    const consumed = await Invitation.findOneAndDelete(
      { ...matched, _id: invitation._id },
      { session },
    )
    if (!consumed) return failure(400, 'This invitation has expired.')
    const user =
      existing ||
      (
        await User.create(
          [
            {
              name: input.name,
              email: invitation.email,
              password: passwordHash(input.password),
              verified: true,
            },
          ],
          { session },
        )
      )[0]
    if (existing && !existing.verified)
      await User.updateOne({ _id: user._id }, { verified: true }, { session })
    await Member.updateOne(
      { workspaceId: invitation.workspaceId, userId: String(user._id) },
      { $setOnInsert: { role: invitation.role } },
      { upsert: true, session },
    )
    return String(user._id)
  })
  await setSession(res, userId)
  res.json({ ok: true })
})
workspaces.get('/', authenticate, async (req, res) => {
  const memberships = await Member.find({ userId: req.userId }).lean()
  const rows = await Workspace.find({
    _id: { $in: memberships.map((row) => row.workspaceId) },
  }).lean()
  const user = await User.findById(req.userId).select('name email').lean()
  res.json({
    user,
    rows: rows.map((row) => ({
      ...row,
      role: memberships.find((member) => member.workspaceId === String(row._id))?.role,
    })),
  })
})
workspaces.post('/', authenticate, async (req, res) => {
  const name = line.parse(req.body.name)
  const workspace = await mongoose.connection.transaction(async (session) => {
    const [row] = await Workspace.create([{ name, timezone: 'UTC' }], { session })
    await Member.create([{ userId: req.userId, workspaceId: String(row._id), role: 'owner' }], {
      session,
    })
    return row
  })
  res.status(201).json(workspace)
})
workspaces.get('/:id', authenticate, workspaced, async (req, res) => {
  if (req.params.id !== req.workspaceId) return failure(404, 'Workspace not found.')
  res.json(await Workspace.findById(req.workspaceId))
})
workspaces.patch('/:id', authenticate, workspaced, async (req, res) => {
  manager(req)
  if (req.params.id !== req.workspaceId) return failure(404, 'Workspace not found.')
  const input = z
    .object({
      name: line.optional(),
      timezone: z
        .string()
        .refine((value) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: value })
            return true
          } catch {
            return false
          }
        })
        .optional(),
    })
    .parse(req.body)
  res.json(await Workspace.findByIdAndUpdate(req.workspaceId, input, { new: true }))
})
