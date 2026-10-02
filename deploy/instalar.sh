#!/usr/bin/env bash
# Prepara uma VPS NOVA (Ubuntu 24.04) para rodar o Norte. Rode como root:
#
#   bash instalar.sh
#
# Pode rodar de novo quantas vezes quiser: cada passo confere se já foi feito.
# NENHUM segredo é pedido nem gravado aqui.
#
# O que faz:
#   1. atualiza o sistema
#   2. cria 2 GB de swap (o build do Next usa muita memória)
#   3. instala Docker, git, firewall (ufw), fail2ban e atualização automática
#   4. cria a chave de deploy (SOMENTE LEITURA no GitHub) e mostra a parte pública
#   5. clona o repositório em /opt/norte (se a chave já estiver no GitHub)

set -euo pipefail

REPO_SSH="git@github.com:loginlumus-prog/norte.git"
PASTA="/opt/norte"
CHAVE="/root/.ssh/norte_deploy"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

passo() { printf '\n== %s\n' "$*"; }
ok()    { printf '   OK: %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root (você já entra como root na VPS)." >&2
  exit 1
fi

# ── 1. sistema ───────────────────────────────────────────────
passo "1/5  Atualizando o sistema (pode levar uns minutos)"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git openssl ufw fail2ban unattended-upgrades
ok "sistema atualizado"

# ── 2. swap ──────────────────────────────────────────────────
passo "2/5  Swap de 2 GB"
if swapon --show | grep -q '/swapfile'; then
  ok "swap já existe"
else
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "swap ligado"
fi
# Usa o swap só quando a memória aperta de verdade.
echo 'vm.swappiness=10' > /etc/sysctl.d/99-norte-swap.conf
sysctl -q -p /etc/sysctl.d/99-norte-swap.conf || true

# ── 3. docker, firewall, fail2ban, atualização automática ───
passo "3/5  Docker"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "docker já instalado: $(docker --version)"
else
  # Script oficial da Docker (get.docker.com): instala o repositório deles e
  # o plugin "docker compose".
  curl -fsSL https://get.docker.com | sh
  ok "docker instalado: $(docker --version)"
fi
systemctl enable --now docker

passo "3/5  Firewall (só 22, 80 e 443)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ok "ufw ativo"
# O Docker mexe no iptables por conta própria e passa por cima do ufw nas
# portas que ele publica. Por isso o compose publica a porta 3000 só em
# 127.0.0.1: o mundo só chega pelo Caddy (80/443).

passo "3/5  fail2ban (barra quem erra a senha do SSH em sequência)"
systemctl enable --now fail2ban
ok "fail2ban ativo"

passo "3/5  Atualizações de segurança automáticas"
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades
ok "unattended-upgrades ligado"

# ── 4. chave de deploy ───────────────────────────────────────
passo "4/5  Chave de deploy (acesso SOMENTE LEITURA ao repositório)"
mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [ ! -f "$CHAVE" ]; then
  ssh-keygen -t ed25519 -f "$CHAVE" -N "" -C "norte-vps-deploy"
  ok "chave criada"
else
  ok "chave já existe"
fi
touch /root/.ssh/known_hosts
ssh-keygen -F github.com >/dev/null 2>&1 || ssh-keyscan -t ed25519,rsa github.com >> /root/.ssh/known_hosts 2>/dev/null
chmod 644 /root/.ssh/known_hosts

if ! grep -q 'norte_deploy' /root/.ssh/config 2>/dev/null; then
  cat >> /root/.ssh/config <<EOF

Host github.com
  HostName github.com
  User git
  IdentityFile $CHAVE
  IdentitiesOnly yes
EOF
fi
chmod 600 /root/.ssh/config

# ── 5. o código ──────────────────────────────────────────────
passo "5/5  Código em $PASTA"
if [ -d "$PASTA/.git" ]; then
  ok "repositório já clonado em $PASTA"
elif git clone "$REPO_SSH" "$PASTA"; then
  ok "repositório clonado"
else
  cat <<EOF

────────────────────────────────────────────────────────────
O clone falhou — é o esperado se a chave ainda não está no GitHub.
Copie a linha abaixo (começa com ssh-ed25519) e cole em:

  GitHub › repositório norte › Settings › Deploy keys › Add deploy key
  Title: vps   |   NÃO marque "Allow write access"   |   Add key

Chave pública:
────────────────────────────────────────────────────────────
EOF
  cat "$CHAVE.pub"
  cat <<EOF

Depois de adicionar no GitHub, rode de novo:   bash instalar.sh
EOF
  exit 0
fi

mkdir -p "$PASTA/deploy"
chmod +x "$PASTA"/deploy/*.sh 2>/dev/null || true

cat <<EOF

════════════════════════════════════════════════════════════
 Pronto. A VPS está preparada e o código está em $PASTA.
 Próximo passo: criar o arquivo $PASTA/deploy/.env
 (LEIA-ME.md, passo 5) e depois subir tudo com:
   cd $PASTA && bash deploy/atualizar.sh
════════════════════════════════════════════════════════════
EOF
