#!/usr/bin/env bash
# Sobe (ou atualiza) o Norte na VPS. Serve para o PRIMEIRO deploy e para todo
# deploy depois:
#
#   cd /opt/norte && bash deploy/atualizar.sh
#
# O que faz: confere o .env, baixa o código novo, reconstrói as imagens, troca
# os containers, reinicia o conector, limpa imagens velhas e mostra a saúde.
# O banco não é tocado: migração é feita do laptop, antes.

set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
COMPOSE="docker compose -f deploy/docker-compose.yml"

echo "== 1/6  Conferindo deploy/.env"
bash deploy/conferir-env.sh

echo
echo "== 2/6  Baixando o código (git pull)"
git pull --ff-only
export NORTE_COMMIT="$(git rev-parse --short HEAD)"
echo "   versão: $NORTE_COMMIT"

echo
echo "== 3/6  Construindo e subindo (o primeiro build leva uns 5 a 10 minutos)"
$COMPOSE up -d --build --remove-orphans

echo
echo "== 4/6  Reiniciando o conector (ele divide a rede do Norte; religa as sessões sozinho)"
$COMPOSE restart conector || true

echo
echo "== 5/6  Limpando imagens antigas"
docker image prune -f >/dev/null
docker builder prune -f --filter "until=168h" >/dev/null || true

echo
echo "== 6/6  Saúde (aguardando até 90 s)"
for i in $(seq 1 18); do
  if curl -fsS -m 5 http://127.0.0.1:3000/saude >/dev/null 2>&1; then
    echo "   Norte respondeu:"
    curl -fsS -m 5 "http://127.0.0.1:3000/saude?estrito=1" || true
    echo
    break
  fi
  sleep 5
done
echo
$COMPOSE ps
echo
echo "Últimas linhas do log (para acompanhar ao vivo: docker compose -f deploy/docker-compose.yml logs -f norte conector):"
$COMPOSE logs --tail 15 norte conector
