import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
dotenv.config({ path: existsSync('.env') ? '.env' : 'backend/.env' })
export const env = process.env
