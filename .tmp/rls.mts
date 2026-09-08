import 'dotenv/config'
import { Client } from 'pg'
const c = new Client({ connectionString: process.env.DATABASE_URL_ADMIN })
await c.connect()
const { rows } = await c.query(
  `select relname, relrowsecurity from pg_class where relname in ('movimentos_pontos','clientes','vendas')`)
console.table(rows)
await c.end()
