# O conector do WhatsApp do Norte. Ver a seção "Conector do WhatsApp" no
# README.md da raiz.
#
#   docker build -t norte-conector .
#   docker run -d --name norte-conector --restart unless-stopped \
#     --env-file .env -p 127.0.0.1:3200:3200 -v norte-conector-dados:/app/dados \
#     norte-conector
#
# Sem credencial nenhuma no volume: /app/dados guarda só a LISTA de empresas
# conectadas (ids). A sessão de cada uma mora cifrada no banco do Norte.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3200 \
    PASTA_DADOS=/app/dados

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

# Não roda como root: o usuário "node" já vem na imagem oficial.
RUN mkdir -p /app/dados && chown -R node:node /app/dados
USER node

EXPOSE 3200
# A saúde também exige o segredo (o conector não conversa com estranho).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/saude',{headers:{authorization:'Bearer '+process.env.CONECTOR_SEGREDO}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx roda o TypeScript direto — sem etapa de build para dar errado.
CMD ["node", "--import", "tsx", "src/servidor.ts"]
