// Prisma 7 tirou a connection string do schema.prisma.
// Aqui fica a URL usada pelos comandos de MIGRACAO (prisma migrate / db push).
// As consultas da aplicacao usam adapter no PrismaClient — nunca esta URL.
//
// Usamos process.env direto em vez do helper env() de proposito: env() explode
// quando a variavel nao existe, e comandos que NAO precisam de banco
// (migrate diff --from-empty) passariam a falhar sem motivo.
// A escolha do arquivo segue a MESMA regra dos scripts (scripts/ambiente.ts):
// `.env` e o laptop, sempre; producao mora em `.env.producao` e so e lida
// quando alguem pede na mao. Como o CLI do Prisma nao conhece a bandeira
// `--producao`, quem traduz e o `npm run migrar`, que poe NORTE_AMBIENTE no
// ambiente do processo filho.
import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

config({ path: process.env.NORTE_AMBIENTE === 'producao' ? '.env.producao' : '.env' })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Migracao usa o usuario ADMIN (dono das tabelas).
    // A aplicacao usa um usuario sem privilegio, senao o RLS e ignorado.
    url: process.env.DATABASE_URL_ADMIN,
  },
})
