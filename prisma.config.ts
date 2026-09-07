// Prisma 7 tirou a connection string do schema.prisma.
// Aqui fica a URL usada pelos comandos de MIGRACAO (prisma migrate / db push).
// As consultas da aplicacao usam adapter no PrismaClient — nunca esta URL.
//
// Usamos process.env direto em vez do helper env() de proposito: env() explode
// quando a variavel nao existe, e comandos que NAO precisam de banco
// (migrate diff --from-empty) passariam a falhar sem motivo.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Migracao usa o usuario ADMIN (dono das tabelas).
    // A aplicacao usa um usuario sem privilegio, senao o RLS e ignorado.
    url: process.env.DATABASE_URL_ADMIN,
  },
})
