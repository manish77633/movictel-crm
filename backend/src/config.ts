import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
dotenv.config({ path: existsSync('.env') ? '.env' : '../.env' })
export const env = process.env
export const production = env.NODE_ENV === 'production'
export const frontend = env.FRONTEND_ORIGIN || 'http://localhost:3000'
export const cookie = { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/' }
export function required(name: string) {
  const value = env[name]
  if (!value) throw Object.assign(new Error('Required configuration is missing.'), { status: 503 })
  return value
}
