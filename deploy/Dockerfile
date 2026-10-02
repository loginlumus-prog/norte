# O Norte (o site) numa imagem. Construída pelo docker-compose.yml desta pasta:
#
#   docker compose -f deploy/docker-compose.yml build norte
#
# ── três armadilhas que o render.yaml já ensinou ──────────────
# 1. `npm ci --include=dev`: typescript, tailwind e o CLI do prisma moram nas
#    devDependencies e o build precisa deles.
# 2. `npx prisma generate` ANTES do build: o Prisma 7 não gera o cliente
#    sozinho. Sem isto o site sobe e toda consulta morre em "@prisma/client
#    did not initialize yet".
# 3. O build NÃO precisa de nenhuma variável de ambiente: conferido com um
#    `next build` sem .env nenhum. Por isso não há ARG de segredo aqui — e
#    não deve haver: tudo que é segredo entra só na hora de rodar (env_file).
#
# O que vai para a imagem final: dependências de PRODUÇÃO, o cliente Prisma já
# gerado, .next e public. Sem código-fonte, sem devDependencies.

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# O Prisma procura o openssl; a imagem slim não traz.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── 1. tudo instalado (com dev), para construir ──────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# ── 2. o build ───────────────────────────────────────────────
FROM deps AS build
COPY . .
# O build do Next gosta de memória; teto abaixo dos 8 GB da máquina (o swap
# cobre o resto). Se mesmo assim cair, ver o LEIA-ME, "build sem memória".
ENV NODE_OPTIONS=--max-old-space-size=3072
RUN npx prisma generate && npm run build

# ── 3. só o que roda em produção ─────────────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── 4. a imagem final ────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    POOL_MAX=5

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# O cliente gerado mora em node_modules/.prisma (o prisma CLI, que o gera, é
# devDependency e não vem junto).
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./

# A versão que /saude mostra ("a correção já subiu?"). Fica por último para
# não invalidar o cache das camadas de cima a cada commit.
ARG NORTE_COMMIT=
ENV NORTE_COMMIT=${NORTE_COMMIT}

# Não roda como root: o usuário "node" já vem na imagem oficial.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
