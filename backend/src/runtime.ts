import type { Server } from 'socket.io'
import type { Request } from 'express'
import { User, Member, Lead, Activity, Automation, Execution, Session } from './models.js'
import { cookie, required } from './config.js'
import { createHmac } from 'node:crypto'
import { equal } from './security.js'

export type Role = 'owner' | 'admin' | 'client' | 'agent'
declare module 'express-serve-static-core' {
  interface Request {
    userId: string
    workspaceId: string
    role: Role
  }
}
export const failure = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status })
}
export let sockets: Server | undefined
export const registerSockets = (server: Server) => {
  sockets = server
}
export function publish(workspaceId: string) {
  sockets?.to(workspaceId).emit('workspace.changed')
}
export function accessToken(userId: string, sessionId: string) {
  const payload = [userId, sessionId, Date.now() + 900_000].join('.')
  return (
    payload + '.' + createHmac('sha256', required('ACCESS_SECRET')).update(payload).digest('hex')
  )
}
export async function readAccess(token: string | undefined) {
  if (typeof token !== 'string') return undefined
  const [id, sessionId, expiry, signature, extra] = token.split('.')
  if (
    !/^[a-f0-9]{24}$/.test(id) ||
    !/^[a-f0-9]{24}$/.test(sessionId) ||
    !signature ||
    extra ||
    !Number.isFinite(Number(expiry)) ||
    Number(expiry) <= Date.now()
  )
    return undefined
  const expected = createHmac('sha256', required('ACCESS_SECRET'))
    .update([id, sessionId, expiry].join('.'))
    .digest('hex')
  if (!equal(signature, expected)) return undefined
  return (await Session.exists({ _id: sessionId, userId: id, expiresAt: { $gt: new Date() } }))
    ? id
    : undefined
}
export async function authenticate(req: Request, _res: unknown, next: () => void) {
  const userId = await readAccess(req.cookies.access)
  if (!userId || !(await User.exists({ _id: userId, verified: true })))
    return failure(401, 'Sign in to continue.')
  req.userId = userId
  next()
}
export async function workspaced(req: Request, _res: unknown, next: () => void) {
  const workspaceId = req.header('x-workspace-id')
  if (!workspaceId || !/^[a-f0-9]{24}$/.test(workspaceId))
    return failure(400, 'Choose a workspace.')
  const membership = await Member.findOne({ workspaceId, userId: req.userId }).lean()
  if (!membership || !['owner', 'admin', 'client', 'agent'].includes(membership.role || ''))
    return failure(403, 'Workspace access denied.')
  req.workspaceId = workspaceId
  req.role = membership.role as Role
  next()
}
export function manager(req: Request) {
  if (req.role !== 'owner' && req.role !== 'admin')
    failure(403, 'Only an owner or admin can do this.')
}
export function leadFilter(req: Request) {
  return {
    workspaceId: req.workspaceId,
    archivedAt: null,
    ...(req.role === 'agent' ? { assignedTo: req.userId } : {}),
  }
}
export async function visibleLead(req: Request, leadId: string) {
  const lead = await Lead.findOne({ ...leadFilter(req), _id: leadId })
  return lead ?? failure(404, 'Lead not found.')
}
export async function record(
  workspaceId: string,
  leadId: string,
  kind: string,
  detail: string,
  actorId?: string,
) {
  return Activity.create({ workspaceId, leadId, kind, detail, actorId })
}
export async function schedule(
  workspaceId: string,
  leadId: string,
  trigger: string,
  eventKey: string,
  formId?: string,
) {
  const rules = await Automation.find({
    workspaceId,
    trigger,
    enabled: true,
    $or: [{ formId: null }, { formId }],
  }).lean()
  await Promise.all(
    rules.map((rule) =>
      Execution.updateOne(
        { workspaceId, automationId: String(rule._id), eventKey },
        {
          $setOnInsert: {
            leadId,
            dueAt: new Date(Date.now() + (rule.delay || 0) * 60_000),
            status: 'pending',
          },
        },
        { upsert: true },
      ),
    ),
  )
}
export const accessCookie = { ...cookie, maxAge: 900_000 }
