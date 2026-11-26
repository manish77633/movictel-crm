import { Router } from 'express'
import { z } from 'zod'
import { cookie, env, frontend, required } from './config.js'
import { graph, graphList, tokenResult } from './graph.js'
import { FacebookPage, FacebookForm, Integration, Member } from './models.js'
import { authenticate, failure, manager, publish } from './runtime.js'
import { equal, randomToken, seal, unseal } from './security.js'

export const facebookConnect = Router()
export const metaCallback = Router()
export const facebookReady = () =>
  Boolean(env.META_APP_ID && env.META_FACEBOOK_CONFIG_ID && env.PUBLIC_API_ORIGIN)
const callback = () => required('PUBLIC_API_ORIGIN') + '/api/v1/meta/facebook/callback'
const key = 'meta_state'

facebookConnect.post('/connect', (req, res) => {
  manager(req)
  const state = randomToken()
  const maxAge = 10 * 60_000
  const url = new URL(
    'https://www.facebook.com/' + required('META_GRAPH_VERSION') + '/dialog/oauth',
  )
  url.search = new URLSearchParams({
    client_id: required('META_APP_ID'),
    config_id: required('META_FACEBOOK_CONFIG_ID'),
    redirect_uri: callback(),
    response_type: 'code',
    state,
  }).toString()
  res
    .cookie(
      key,
      seal(
        JSON.stringify({
          state,
          userId: req.userId,
          workspaceId: req.workspaceId,
          expiresAt: Date.now() + maxAge,
        }),
      ),
      { ...cookie, maxAge },
    )
    .json({ url: url.href })
})

metaCallback.get('/facebook/callback', authenticate, async (req, res) => {
  if (typeof req.cookies[key] !== 'string')
    return failure(400, 'Facebook sign-in expired. Start again.')
  const state = z
    .object({
      state: z.string(),
      userId: z.string(),
      workspaceId: z.string(),
      expiresAt: z.number(),
    })
    .parse(JSON.parse(unseal(req.cookies[key])))
  res.clearCookie(key, cookie)
  if (
    typeof req.query.state !== 'string' ||
    !equal(state.state, req.query.state) ||
    state.expiresAt < Date.now() ||
    state.userId !== req.userId ||
    !(await Member.exists({
      workspaceId: state.workspaceId,
      userId: req.userId,
      role: { $in: ['owner', 'admin'] },
    }))
  )
    return failure(403, 'Facebook authorization could not be verified.')
  const redirect = frontend + '/workspace?view=Integrations'
  if (req.query.error) {
    res.redirect(redirect)
    return
  }
  const code = z.string().min(1).max(4000).parse(req.query.code)
  const app = { client_id: required('META_APP_ID'), client_secret: required('META_APP_SECRET') }
  const initial = tokenResult.parse(
    await graph('oauth/access_token', undefined, { ...app, redirect_uri: callback(), code }),
  )
  const token = tokenResult.parse(
    await graph('oauth/access_token', undefined, {
      ...app,
      grant_type: 'fb_exchange_token',
      fb_exchange_token: initial.access_token,
    }),
  )
  const pages = await graphList<{ id: string; name: string; access_token: string }>(
    'me/accounts',
    token.access_token,
    'id,name,access_token',
  )
  if (!pages.length) return failure(400, 'No authorized Facebook Pages were returned.')
  const scope = { workspaceId: state.workspaceId }
  const active = pages.map((page) => page.id)
  await FacebookForm.updateMany({ ...scope, pageId: { $nin: active } }, { selected: false })
  await FacebookPage.deleteMany({ ...scope, externalId: { $nin: active } })
  for (const page of pages)
    await FacebookPage.updateOne(
      { ...scope, externalId: page.id },
      { name: page.name, credential: seal(page.access_token) },
      { upsert: true },
    )
  await Integration.updateOne(
    { ...scope, provider: 'facebook' },
    {
      label: 'Facebook Lead Ads',
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    },
    { upsert: true },
  )
  publish(state.workspaceId)
  res.redirect(redirect)
})
