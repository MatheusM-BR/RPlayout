import { resolve } from 'node:path'

export const DB_FILE = process.env.RPLAYOUT_DB ?? resolve(process.cwd(), 'rplayout.db')
export const PORT = Number(process.env.PORT ?? 4000)
export const HOST = process.env.HOST ?? '0.0.0.0'
