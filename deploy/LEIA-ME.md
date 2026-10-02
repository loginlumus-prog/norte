# Norte no ar: guia da VPS (do zero ao site funcionando)

Este guia põe o Norte inteiro numa VPS da Hostinger: o **site**, o **conector do
WhatsApp** e o **HTTPS automático** (Caddy), tudo em Docker. O banco continua no
**Supabase** — a VPS não guarda dado de cliente.

- VPS: KVM 2 (Ubuntu 24.04), IP `179.236.236.190`
- Domínio: `gestornorte.com` (comprado na Hostinger; o DNS também fica lá)
- Repositório (privado): `github.com/loginlumus-prog/norte`

**Como usar:** faça um passo de cada vez, na ordem. Depois de cada comando
há um "**Deve aparecer**": se não apareceu, **pare** e olhe a tabela de
problemas (passo 10) antes de seguir.

Blocos marcados **(laptop)** rodam no seu computador (PowerShell, dentro da
pasta `C:\dev\gestor`). Blocos marcados **(VPS)** rodam no terminal da VPS.

> **Regra de ouro:** segredo nunca vai por chat, e-mail ou GitHub. O passo 5
> leva os segredos do laptop para a VPS direto, por uma conexão cifrada (scp),
> sem passar por mais ninguém.

---

## 0. Antes de tudo: o código com a pasta `deploy/` precisa estar no GitHub

A VPS baixa o código do GitHub. Estes arquivos novos (a pasta `deploy/`, o
`.gitattributes` e a troca de domínio) precisam ter sido commitados e enviados
(`git push`) — **quem commita é você ou o assistente que está te ajudando**.
Confira em github.com/loginlumus-prog/norte que existe a pasta `deploy/`.

## 1. DNS na Hostinger (aponta o domínio para a VPS)

1. Entre no **hPanel** (hostinger.com.br) › **Domínios** › `gestornorte.com` ›
   **DNS / Servidores de nomes** › **Zona DNS** (o nome do menu pode variar um
   pouco; é a tela com a lista de registros A, CNAME, MX, TXT...).
2. **Apague** o que aponta para a página padrão ("parking") da Hostinger:
   - todo registro **A** com nome `@` que não seja o do passo 3;
   - todo registro **AAAA** com nome `@` ou `www` (IPv6 antigo. **Importante:**
     se sobrar um AAAA, parte dos visitantes — e o certificado — vão para o
     lugar errado);
   - qualquer **CNAME** com nome `www` (a Hostinger costuma criar um).
   - **NÃO apague** registros **MX** e **TXT** (são do e-mail; ver passo 9).
3. **Crie** dois registros:

   | Tipo | Nome | Aponta para | TTL |
   |------|------|-------------|-----|
   | A | `@` | `179.236.236.190` | 600 |
   | A | `www` | `179.236.236.190` | 600 |

4. Salve. Confira (laptop, PowerShell) — pode levar de 5 minutos a algumas
   horas; repita até aparecer o IP certo:

   ```powershell
   nslookup gestornorte.com 8.8.8.8
   nslookup www.gestornorte.com 8.8.8.8
   ```

   **Deve aparecer:** `Address: 179.236.236.190` nos dois (o 8.8.8.8 é o DNS do
   Google; se ele já mostra o IP, o mundo todo vai enxergar logo).

> **Não suba o Caddy antes do DNS estar certo** (passo 6): ele pede o
> certificado na hora, e a Let's Encrypt bloqueia por uma hora depois de
> poucas tentativas falhas.

## 2. Primeiro acesso à VPS (e, opcional, trancar a senha)

### 2a. Entrar

No hPanel › **VPS** › sua VPS você vê o IP e a senha do `root` (ou define
uma). No laptop:

```powershell
ssh root@179.236.236.190
```

Na primeira vez ele pergunta `Are you sure you want to continue connecting`:
digite `yes`. Depois a senha.

**Deve aparecer:** algo como `Welcome to Ubuntu 24.04` e o prompt
`root@...:~#`.

(Se o `ssh` não abrir, o hPanel tem um **Terminal do navegador** na página da
VPS — serve igual.)

### 2b. Trocar a senha por uma chave (recomendado, mas pode pular)

Senha de root exposta à internet é alvo de tentativa o dia inteiro. Uma chave
SSH resolve. **A ordem importa — senão você se tranca para fora:**

1. **(laptop)** crie a chave (Enter em todas as perguntas; se já existir
   `id_ed25519`, pule esta linha):

   ```powershell
   ssh-keygen -t ed25519
   ```

2. **(laptop)** mande a parte pública para a VPS (pede a senha uma vez):

   ```powershell
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@179.236.236.190 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
   ```

3. **Teste num SEGUNDO terminal, sem fechar o primeiro:**

   ```powershell
   ssh root@179.236.236.190
   ```

   **Deve aparecer:** entrou **sem pedir senha**. Se pediu, **não continue**
   (deixe a senha funcionando e pule para o passo 3).

4. **(VPS, no terminal que já estava aberto)** só agora desligue a senha:

   ```bash
   printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/00-norte.conf
   sshd -t && systemctl reload ssh
   ```

   **Deve aparecer:** nada (nenhuma mensagem = deu certo).

5. Abra um **terceiro** terminal e entre de novo (`ssh root@179.236.236.190`)
   para confirmar que ainda funciona. Só então feche os outros.

Se algo der errado, o **Terminal do navegador** do hPanel entra sem SSH e
você apaga `/etc/ssh/sshd_config.d/00-norte.conf` e roda
`systemctl reload ssh`.

## 3. Preparar a VPS (instalar.sh)

O `instalar.sh` atualiza o sistema, cria swap de 2 GB, instala Docker,
firewall (só portas 22/80/443), fail2ban, atualizações automáticas, e cria a
chave de leitura do GitHub. Ele não pede nem guarda segredo.

1. **(laptop)** mande o script para a VPS:

   ```powershell
   scp deploy\instalar.sh root@179.236.236.190:/root/instalar.sh
   ```

2. **(VPS)** rode:

   ```bash
   bash /root/instalar.sh
   ```

   Leva uns 3 a 8 minutos. **Deve aparecer:** várias linhas `== N/5 ...` e
   `OK: ...`. No fim, como o GitHub ainda não conhece a chave, ele mostra
   **"O clone falhou — é o esperado"** e uma linha `ssh-ed25519 AAAA...`.
   Isso é normal: siga para o passo 4.

## 4. Deixar a VPS ler o GitHub (chave de deploy, somente leitura)

1. Copie a linha inteira que o `instalar.sh` mostrou (começa com
   `ssh-ed25519`). Se perdeu, mostre de novo **(VPS)**:

   ```bash
   cat /root/.ssh/norte_deploy.pub
   ```

2. No GitHub: repositório **norte** › **Settings** › **Deploy keys** › **Add
   deploy key**. Title: `vps`. Cole a chave. **Deixe DESMARCADO** "Allow write
   access" (assim a VPS só consegue ler). **Add key**.

3. **(VPS)** rode o instalador de novo (é seguro repetir):

   ```bash
   bash /root/instalar.sh
   ```

   **Deve aparecer:** `OK: repositório clonado` e, no fim, o quadro "Pronto".
   Confira:

   ```bash
   ls /opt/norte/deploy
   ```

   **Deve aparecer:** `Caddyfile  Dockerfile ... docker-compose.yml ...`.

(Para a VPS a chave é só esta; ela não consegue alterar o repositório.)

## 5. O arquivo de segredos (`deploy/.env`)

Os segredos já existem no seu laptop: `.env.producao` (banco e sessão) e
`.video/demo.env` (cifra do WhatsApp, rotinas, webhook, IA). Um programa
junta só o que o servidor precisa — numa **lista fechada** — e você envia por
scp.

| Variável | Vem de | Observação |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_PORTARIA`, `SEGREDO_SESSAO` | `.env.producao` | os mesmos de hoje |
| `NORTE_CIFRA` | `.video/demo.env` | **tem de ser o MESMO valor**: cifra as sessões de WhatsApp no banco |
| `NORTE_CODIGO_SEGREDO`, `WEBHOOK_SEGREDO`, `ROTINAS_SEGREDO` | `.video/demo.env` | os mesmos de hoje |
| `ANTHROPIC_API_KEY` | `.video/demo.env` | a chave da IA |
| `CONECTOR_TOKEN`, `CONECTOR_ASSINATURA` | **gerados agora** | novos e diferentes entre si (a demonstração usava um só, `CONECTOR_SEGREDO`) |
| `NORTE_URL` | fixa | `https://gestornorte.com` |
| `RESEND_API_KEY`, `EMAIL_REMETENTE` | você (passo 9) | opcionais agora |
| **`DATABASE_URL_ADMIN`** | **NUNCA** | dona das tabelas, ignora a segurança por empresa. Fica só no laptop |

1. **(laptop)** simule primeiro (não escreve nada; só mostra nomes e `ok`/`FALTA`):

   ```powershell
   node deploy/montar-env.mjs --simular
   ```

   **Deve aparecer:** `ok` em `DATABASE_URL`, `DATABASE_URL_PORTARIA`,
   `SEGREDO_SESSAO`, `NORTE_CIFRA`, `NORTE_CODIGO_SEGREDO`, `WEBHOOK_SEGREDO`,
   `ROTINAS_SEGREDO`, `ANTHROPIC_API_KEY`, `CONECTOR_TOKEN`,
   `CONECTOR_ASSINATURA`; a linha `ignoradas  DATABASE_URL_ADMIN ...` e
   `Simulação ok`. Se aparecer `FALTA`, o programa **não** inventa valor:
   ache o valor certo (no cofre/arquivo) e ponha no arquivo de origem.
   Nunca "gere um novo" para `NORTE_CIFRA` — isso desconectaria o WhatsApp de
   todas as lojas.

2. **(laptop)** se já tiver as chaves do e-mail ou da transcrição, crie
   `deploy/.env.extras` (fica fora do git) com linhas `NOME=valor`, ex.:
   `RESEND_API_KEY=...` e `EMAIL_REMETENTE=Norte <nao-responda@gestornorte.com>`.
   Dá para pular e adicionar depois (passo 9).

3. **(laptop)** gere o arquivo:

   ```powershell
   node deploy/montar-env.mjs
   ```

   **Deve aparecer:** `Escrito deploy/.env.servidor com N variáveis.`

4. **(laptop)** envie e tranque:

   ```powershell
   scp deploy\.env.servidor root@179.236.236.190:/opt/norte/deploy/.env
   ssh root@179.236.236.190 "chmod 600 /opt/norte/deploy/.env"
   ```

5. **(laptop)** **apague a cópia local** (ela só serve para esse envio; o
   original continua em `.env.producao` e `demo.env`):

   ```powershell
   Remove-Item deploy\.env.servidor
   ```

   O `deploy/.env`, `deploy/.env.servidor` e `deploy/.env.extras` estão no
   `.gitignore`, então não vão para o GitHub nem por engano.

6. **(VPS)** confira o arquivo (só mostra nomes, nunca valores):

   ```bash
   cd /opt/norte && bash deploy/conferir-env.sh
   ```

   **Deve aparecer:** `ok` nas obrigatórias e `deploy/.env conferido.` O
   programa **recusa** se achar `DATABASE_URL_ADMIN`, `NORTE_ORIGENS` ou
   `NORTE_ASSINATURA_LIVRE` (não podem existir em produção).

## 6. Construir e subir o site (ainda sem o conector)

Antes: o DNS do passo 1 tem de estar respondendo o IP certo.

**(VPS)**

```bash
cd /opt/norte
docker compose -f deploy/docker-compose.yml build
```

O primeiro build leva de 5 a 15 minutos (baixa e compila tudo). **Deve
aparecer:** muitas linhas e, no fim, `Built` / `naming to ...`. (Se ele morrer
com `Killed` ou `exit code 137`, é falta de memória: ver a tabela, passo 10.)

Suba **só o site e o Caddy** por enquanto:

```bash
docker compose -f deploy/docker-compose.yml up -d norte caddy
docker compose -f deploy/docker-compose.yml ps
```

**Deve aparecer:** `norte` com `Up ... (healthy)` (pode levar uns 40 s) e
`caddy` com `Up`.

Testes:

```bash
curl -s http://127.0.0.1:3000/saude
curl -I https://gestornorte.com
curl -I https://www.gestornorte.com
```

**Deve aparecer:**

- o primeiro: um JSON com `"ok":true` e o banco respondendo;
- o segundo: `HTTP/2 200` (ou `307/308` para a tela inicial) e uma linha
  `strict-transport-security`;
- o terceiro: `HTTP/2 301` e `location: https://gestornorte.com/`.

Abra `https://gestornorte.com` no navegador: o cadeado deve estar fechado e a
página inicial do Norte, no ar. Faça login numa conta de teste.

Se o certificado demorar, veja o log do Caddy:
`docker compose -f deploy/docker-compose.yml logs caddy`.

## 7. A troca do WhatsApp: demonstração do laptop → VPS

Hoje a demonstração roda no laptop (`.video/demo.mjs`: Next + conector +
túnel). A VPS tem o **conector** que vai assumir. **Os dois nunca podem ficar
ligados juntos**: a sessão de WhatsApp de cada loja é uma só (vive no banco),
e dois conectores brigam por ela — o WhatsApp derruba um, o outro reconecta, e
as mensagens ficam instáveis (ou a loja é deslogada).

Ordem exata:

1. **Primeiro** o site novo precisa estar funcionando (passo 6 completo, login
   testado). Enquanto isso, a demonstração antiga segue no ar como está.
2. **(laptop)** veja se existe a lista de lojas conectadas da demonstração:

   ```powershell
   dir .video\conector-dados\empresas.json
   ```

   - **Não existe** (era assim quando este guia foi escrito: nenhuma loja
     conectada pela demonstração): não há nada para levar. Cada loja lê o QR
     de novo na tela **Assistente › Conexão** do site novo. Vá ao item 3.
   - **Existe:** é a lista (só ids, sem credencial) das lojas para religar sozinhas.
     Leve para a VPS: **(laptop)** `scp .video\conector-dados\empresas.json root@179.236.236.190:/root/empresas.json`
     e **(VPS)** (o volume só passa a existir depois do `up` do item 4; então
     rode isto logo **depois** do item 4 e reinicie o conector):

     ```bash
     docker run --rm -v norte_conector-dados:/dados -v /root:/origem alpine sh -c "cp /origem/empresas.json /dados/ && chown 1000:1000 /dados/empresas.json"
     docker compose -f deploy/docker-compose.yml restart conector
     ```

3. **(laptop) PARE a demonstração:** no terminal onde o `demo.mjs` roda,
   `Ctrl+C`. Isso derruba juntos o Next local, o conector local e o túnel
   (o endereço `trycloudflare` deixa de funcionar — avise quem estava usando).
   Confirme que nada ficou rodando (`Get-Process node` não deve mostrar o
   conector; se dúvida, feche o terminal inteiro).
4. **(VPS)** só agora suba o conector:

   ```bash
   cd /opt/norte
   docker compose -f deploy/docker-compose.yml up -d conector
   docker compose -f deploy/docker-compose.yml logs --tail 30 conector
   ```

   **Deve aparecer:** `conector.no_ar` e `relogio.ligado` (o conector também é
   o relógio das campanhas e das rotinas). `docker compose ... ps` mostra
   `conector` como `healthy`.
5. Teste: na tela **Assistente › Conexão** de uma loja, gere o QR e leia com o
   WhatsApp; mande uma mensagem para o número e veja a resposta.

**Voltar atrás** (se o site novo tiver problema grave): `docker compose -f
deploy/docker-compose.yml stop conector` na VPS **e depois** suba a
demonstração no laptop de novo. Sempre um de cada vez.

## 8. Dia a dia: atualizar, ver log, reiniciar

**Atualizar o site** (depois que o código novo estiver no GitHub):

```bash
cd /opt/norte && bash deploy/atualizar.sh
```

Ele confere o `.env`, baixa o código, reconstrói, troca os containers, reinicia
o conector, limpa imagens velhas e mostra a saúde. **Deve aparecer** no fim o
`/saude` com `"ok":true` e tudo `healthy`.

> Mudou o **banco** (migração)? Isso é do laptop e vem **antes** do deploy:
> `npm run migrar -- --producao`. A VPS não faz migração.

| O que quero | Comando (na VPS, em `/opt/norte`) |
|---|---|
| Ver se está tudo de pé | `docker compose -f deploy/docker-compose.yml ps` |
| Log do site, ao vivo | `docker compose -f deploy/docker-compose.yml logs -f norte` |
| Log do conector (WhatsApp) | `docker compose -f deploy/docker-compose.yml logs -f conector` |
| Log do HTTPS (Caddy) | `docker compose -f deploy/docker-compose.yml logs -f caddy` |
| Reiniciar só o site | `docker compose -f deploy/docker-compose.yml restart norte conector` |
| Reiniciar tudo | `docker compose -f deploy/docker-compose.yml restart` |
| Parar tudo | `docker compose -f deploy/docker-compose.yml stop` |
| Memória / disco | `free -h` e `df -h` |

(`Ctrl+C` sai do log ao vivo; o site continua rodando.)

**Os containers voltam sozinhos** se caírem ou se a VPS reiniciar
(`restart: unless-stopped`).

**Nunca use `docker compose down -v`**: o `-v` apaga o certificado HTTPS e a
lista de lojas do conector.

### O que mora onde (backup)

| Dado | Onde | Backup |
|---|---|---|
| Clientes, vendas, produtos, sessões do WhatsApp (cifradas) | **Supabase** (São Paulo) | backup diário do próprio Supabase (confira em Supabase › Database › Backups o plano que você tem) |
| Código | GitHub | o próprio repositório |
| Segredos | seu laptop (`.env.producao`, `.video/demo.env`) e `/opt/norte/deploy/.env` | **guarde uma cópia no cofre de senhas, principalmente `NORTE_CIFRA`**: sem ela as sessões de WhatsApp guardadas no banco ficam ilegíveis |
| Certificado HTTPS, lista de lojas do conector | volumes do Docker na VPS | se perder, o certificado é refeito sozinho e as lojas religam pelo QR; sem drama |

A VPS em si é **descartável**: se der problema grave, reinstale a partir do
passo 3 e o Norte volta com os mesmos segredos.

### Monitoramento simples

Crie uma conta grátis em **UptimeRobot** (ou similar) e um monitor HTTP em
`https://gestornorte.com/saude?estrito=1` a cada 5 minutos, com alerta por
e-mail. Esse endereço responde `200` quando o site **e o banco** estão bem e
`503` quando o banco não responde. (`/saude` sem o `?estrito=1` só diz que o
processo está vivo.)

## 9. E-mail do domínio: encaminhamento e envio (Resend)

Não existe caixa de e-mail em `gestornorte.com`. São dois assuntos separados.

### 9a. Receber: `contato@` e `privacidade@` caem no seu Gmail

Esses dois endereços aparecem nos Termos, na Privacidade e na página de venda.
No hPanel › **E-mail** (do domínio `gestornorte.com`) procure
**Encaminhamentos** (ou "Email forwarders"): crie `contato@gestornorte.com` →
seu Gmail e `privacidade@gestornorte.com` → seu Gmail. A Hostinger pode pedir
para ativar o e-mail do domínio (registros MX) — aceite; esses MX são o que
faz o encaminhamento funcionar, **não apague**. Teste mandando um e-mail de
outro endereço para `contato@gestornorte.com`.

### 9b. Enviar: e-mails do Norte (convite, "esqueci a senha")

O Norte envia pelo **Resend**. Sem isso, o botão de e-mail diz que não está
configurado, mas nada quebra.

1. Em resend.com crie a conta, **Domains › Add Domain** › `gestornorte.com`
   (região: São Paulo, se oferecida).
2. O Resend mostra uma lista de registros DNS (um **SPF** do tipo TXT, um
   **DKIM** do tipo TXT chamado `resend._domainkey`, e geralmente um MX para
   um subdomínio `send`). Copie **exatamente** o que ele mostra para a mesma
   **Zona DNS** da Hostinger (passo 1). Eles não conflitam com os de
   encaminhamento, porque o Resend usa um subdomínio.
3. Volte ao Resend e clique **Verify**. Pode demorar alguns minutos.
4. Em **API Keys** crie uma chave (permissão de envio). **Não cole a chave em
   chat.** Ponha no `.env` da VPS direto:

   ```bash
   nano /opt/norte/deploy/.env
   ```

   e acrescente duas linhas (aspas simples):

   ```
   RESEND_API_KEY='re_...'
   EMAIL_REMETENTE='Norte <nao-responda@gestornorte.com>'
   ```

   Salve (`Ctrl+O`, Enter, `Ctrl+X`) e aplique:

   ```bash
   cd /opt/norte && bash deploy/conferir-env.sh && docker compose -f deploy/docker-compose.yml up -d norte
   ```

   Teste com "Esqueci a senha" numa conta de teste. (Quem prefere pode pôr
   essas duas linhas em `deploy/.env.extras` no laptop e refazer o passo 5.)

## 10. Quando algo dá errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `nslookup` mostra outro IP (ou o IP antigo) | DNS ainda não propagou, ou sobrou registro antigo | Espere até 1 h; confira na Zona DNS que só há **A @** e **A www** com o IP da VPS e **nenhum AAAA**/CNAME de `www`. |
| Navegador: "site não pode ser acessado" / timeout | firewall ou Caddy parado | `ufw status` (deve ter 80, 443); `docker compose -f deploy/docker-compose.yml ps` (caddy `Up`). |
| Certificado não sai / aviso de "não seguro" | DNS errado na hora do pedido, ou 80/443 fechadas | `docker compose -f deploy/docker-compose.yml logs caddy`. Se disser `challenge failed`/`timeout`, corrija o DNS e `docker compose -f deploy/docker-compose.yml restart caddy` (espere ~10 min se foram muitas falhas). |
| `502 Bad Gateway` | o site (`norte`) caiu ou ainda está subindo | `ps` e `logs --tail 80 norte`. Costuma ser variável faltando no `.env` ou o banco inalcançável. Rode `bash deploy/conferir-env.sh`. |
| `/saude` mostra o banco fora | `DATABASE_URL`/`_PORTARIA` errada, senha trocada, ou o Supabase pausado | Confira no painel do Supabase que o projeto está ativo. Se o Supabase usa restrição de rede (Network Restrictions), libere `179.236.236.190`. |
| Build termina com `Killed` / `exit code 137` | falta de memória | `free -h` (a linha `Swap` deve mostrar 2.0G; se mostrar 0, rode `bash /root/instalar.sh` de novo). Rode o build outra vez: `docker compose -f deploy/docker-compose.yml build norte`. Se persistir, feche tudo que ocupe memória (`docker compose ... stop`) e tente de novo. |
| `docker: command not found` | o instalador não terminou | `bash /root/instalar.sh` de novo. |
| `git pull` falha com `Permission denied (publickey)` | chave de deploy não está no GitHub | Passo 4. |
| `conferir-env.sh` reclama de `PROIBIDA` | sobrou variável que não pode ir para o servidor | `nano /opt/norte/deploy/.env` e apague a linha. |
| Conector não conecta / QR não aparece | conector parado, `NORTE_CIFRA` errada, ou os dois conectores ligados | `logs --tail 80 conector`; veja que a demonstração do laptop está **parada** (passo 7). Se mostrar `401`, `CONECTOR_TOKEN`/`ASSINATURA` do `.env` mudaram sem reiniciar: `restart norte conector`. |
| Loja conectada antes não responde mais | `NORTE_CIFRA` diferente da usada para gravar a sessão | Ponha o valor original (de `.video/demo.env`) e reinicie. Se perdeu, a loja precisa ler o QR de novo. |
| E-mails não saem | falta `RESEND_API_KEY`/`EMAIL_REMETENTE`, ou domínio não verificado no Resend | Passo 9b; veja `logs norte` procurando `email`; no Resend, o domínio tem de estar `Verified`. |
| Clicar em botões não faz nada / "Invalid Server Actions request" | acesso por endereço diferente (ex.: `www`, IP, ou outro domínio) | Entre por `https://gestornorte.com`. O `www` redireciona sozinho. Não se usa `NORTE_ORIGENS` em produção. |
| Campanhas e relatórios das 8h/20h não saem | o conector (que é o relógio) está parado | `ps`; `logs conector` deve mostrar `relogio.ligado` e nenhum `relogio.falhou`. |
| Disco enchendo | imagens antigas | `docker system prune -f` (não apaga volumes). |

## 11. Checklist final antes da demonstração

- [ ] `https://gestornorte.com` abre com cadeado, e `www.` redireciona para ele
- [ ] `curl -I https://gestornorte.com` mostra **um só** `strict-transport-security` (o do Norte)
- [ ] `https://gestornorte.com/saude?estrito=1` responde `ok` (site e banco)
- [ ] `docker compose -f deploy/docker-compose.yml ps`: `norte`, `conector` `healthy`; `caddy` `Up`
- [ ] Login e uma venda de teste funcionando
- [ ] A página de venda e as de Termos/Privacidade mostram `contato@gestornorte.com` / `privacidade@gestornorte.com`, e um e-mail enviado a eles chega no Gmail
- [ ] "Esqueci a senha" manda o e-mail e o link aponta para `gestornorte.com`
- [ ] QR do WhatsApp lido, mensagem recebida e respondida pelo assistente
- [ ] Demonstração do laptop **parada** (só o conector da VPS está ligado)
- [ ] `deploy/.env.servidor` apagado do laptop; cópia dos segredos (principalmente `NORTE_CIFRA`) no cofre
- [ ] Monitor do UptimeRobot criado
- [ ] Teste de reinício: `reboot` na VPS, espere 2 minutos, e o site volta sozinho
- [ ] (opcional) senha do SSH desligada (passo 2b)

---

### Para quem mantém o código (notas técnicas)

- **Trocar de domínio:** o domínio aparece em `deploy/Caddyfile` (2 linhas), em
  `NORTE_URL` no `.env`, e nos textos do código (`src/servidor/legal.ts`,
  `src/ui/venda/mapa.ts`, os padrões de `src/app/cadastro/page.tsx` e
  `src/app/entrar/page.tsx`). `grep -rn gestornorte.com src` lista tudo.
- **IP do cliente:** `src/servidor/requisicao.ts` usa o **último** item do
  `X-Forwarded-For`. O Caddy, sem `trusted_proxies`, descarta o cabeçalho que o
  cliente mandou e escreve só o IP da conexão, então o último é o real. Não
  ponha outro proxy (Cloudflare etc.) na frente sem rever isso.
- **Conector e Norte dividem a rede** (`network_mode: service:norte`) porque o
  Norte só fala com o conector em `https://` ou `localhost`. Recriar o `norte`
  exige recriar o `conector` (o `atualizar.sh` já reinicia os dois).
- **O build não precisa de variável nenhuma** (testado com `next build` sem
  `.env`). Segredo só entra em tempo de execução, via `env_file`.
