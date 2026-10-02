#!/usr/bin/env bash
# Confere o deploy/.env ANTES de subir: o que tem de existir, o que NÃO pode
# existir, e se o arquivo está trancado. Imprime só NOMES — nunca valores.
#
#   bash deploy/conferir-env.sh
#
# Sai com erro (1) se algo estiver errado; o atualizar.sh só segue se passar.

ARQ="$(cd "$(dirname "$0")" && pwd)/.env"
erros=0

if [ ! -f "$ARQ" ]; then
  echo "ERRO: não achei $ARQ (LEIA-ME.md, passo 5)." >&2
  exit 1
fi

tem() { grep -Eq "^$1=.+" "$ARQ"; }

# ── obrigatórias ─────────────────────────────────────────────
for v in DATABASE_URL DATABASE_URL_PORTARIA NORTE_URL SEGREDO_SESSAO NORTE_CIFRA \
         NORTE_CODIGO_SEGREDO WEBHOOK_SEGREDO ROTINAS_SEGREDO CONECTOR_TOKEN \
         CONECTOR_ASSINATURA; do
  if tem "$v"; then echo "  ok        $v"; else echo "  FALTA     $v"; erros=$((erros+1)); fi
done

# ── recomendadas (não derrubam o deploy) ─────────────────────
for v in ANTHROPIC_API_KEY RESEND_API_KEY EMAIL_REMETENTE; do
  if tem "$v"; then echo "  ok        $v"; else echo "  aviso     $v ausente (a função correspondente fica desligada)"; fi
done

# ── proibidas ────────────────────────────────────────────────
for v in DATABASE_URL_ADMIN NORTE_ASSINATURA_LIVRE NORTE_ORIGENS CONECTOR_SEGREDO; do
  if grep -Eq "^$v=" "$ARQ"; then
    echo "  PROIBIDA  $v não pode estar no servidor — apague a linha."
    erros=$((erros+1))
  fi
done

# ── NORTE_URL certa ──────────────────────────────────────────
if ! grep -Eq "^NORTE_URL='?https://[^/' ]+'?$" "$ARQ"; then
  echo "  ERRO      NORTE_URL deve ser https://dominio, sem barra no fim."
  erros=$((erros+1))
fi

# ── tamanho mínimo dos segredos (32), sem mostrar o valor ────
for v in SEGREDO_SESSAO WEBHOOK_SEGREDO ROTINAS_SEGREDO CONECTOR_TOKEN CONECTOR_ASSINATURA; do
  valor="$(grep -E "^$v=" "$ARQ" | head -n1 | cut -d= -f2- | tr -d "'\"")"
  if [ -n "$valor" ] && [ "${#valor}" -lt 32 ]; then
    echo "  CURTO     $v tem menos de 32 caracteres."
    erros=$((erros+1))
  fi
done
t1="$(grep -E "^CONECTOR_TOKEN=" "$ARQ" | head -n1 | cut -d= -f2-)"
t2="$(grep -E "^CONECTOR_ASSINATURA=" "$ARQ" | head -n1 | cut -d= -f2-)"
if [ -n "$t1" ] && [ "$t1" = "$t2" ]; then
  echo "  IGUAIS    CONECTOR_TOKEN e CONECTOR_ASSINATURA precisam ser diferentes."
  erros=$((erros+1))
fi

# ── permissão ────────────────────────────────────────────────
perm="$(stat -c %a "$ARQ")"
if [ "$perm" != "600" ]; then
  chmod 600 "$ARQ"
  echo "  ajustado  permissão do .env era $perm, agora 600"
fi

if [ "$erros" -gt 0 ]; then
  echo
  echo "$erros problema(s) no .env. Corrija e rode de novo."
  exit 1
fi
echo
echo "deploy/.env conferido."
