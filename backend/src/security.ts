import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'
import { required } from './config.js'
export const randomToken = () => randomBytes(32).toString('base64url')
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export function equal(a: string, b: string) {
  const first = Buffer.from(a)
  const second = Buffer.from(b)
  return first.length === second.length && timingSafeEqual(first, second)
}
export function passwordHash(password: string, salt = randomToken()) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex')
}
export function validPassword(password: string, stored: string) {
  return equal(stored, passwordHash(password, stored.split(':')[0]))
}
function key() {
  const bytes = Buffer.from(required('CREDENTIAL_KEY'), 'base64')
  if (bytes.length !== 32) throw new Error('CREDENTIAL_KEY must decode to 32 bytes.')
  return bytes
}
export function seal(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}
export function unseal(value: string) {
  const bytes = Buffer.from(value, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
}
export function validSignature(raw: Buffer, signature: string, secret: string) {
  return equal(signature, 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'))
}
export function messagingError(
  consent: string | undefined,
  lastInbound: Date | undefined,
  approvedTemplate: boolean,
  now = Date.now(),
) {
  if (consent === 'opted_out') return 'This customer has opted out.'
  if (approvedTemplate)
    return consent === 'granted' ? undefined : 'An approved template requires recorded consent.'
  if (!lastInbound || now - lastInbound.getTime() >= 86_400_000)
    return 'Use an approved template outside the 24-hour reply window.'
}
