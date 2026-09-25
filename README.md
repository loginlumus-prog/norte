# Norte

Sistema de gestão empresarial operado por um agente de IA no WhatsApp.
Atende do balcão de bairro à rede com dezenas de unidades.

## Documentos

| Arquivo | O que é |
|---|---|
| `ESCOPO.md` | O que o produto é e o que não é |
| `DECISOES.md` | Toda decisão fechada, com motivo e alternativas descartadas |
| `docs/plano-completo.html` | Os 13 módulos e as 6 fases de construção |
| `docs/decisoes.html` | As decisões em página navegável |
| `docs/clickup-traduzido.html` | Pesquisa do ClickUp traduzida para o nosso produto |
| `docs/meta/roteiro-videos-revisao.md` | Roteiro dos dois vídeos da revisão do app na Meta (WhatsApp oficial) |

## Começar a trabalhar

Não precisa de Docker, de banco na nuvem, nem de conta em lugar nenhum.

```bash
npm install
npm run banco      # sobe o Postgres local — deixe esta janela aberta
npm run preparar   # tabelas, travas, duas empresas e gente para entrar
npm run dev        # o sistema, em http://localhost:3000/exemplo
npm run conferir   # prova isolamento e login no banco de verdade
npm test           # checa tipos + 99 testes
```

Contas de exemplo (só no banco local), senha `exemplo-2026`:

| E-mail | Papel |
|---|---|
| `ana@exemplo.com` | Dona — tudo, em todas as unidades |
| `carlos@exemplo.com` | Balcão — vende, presa a uma unidade |
| `contador@exemplo.com` | Contador — só olha o financeiro |
| `antiga@exemplo.com` | Desativada, para testar recusa |

O `npm run banco` sobe um Postgres de verdade (PGlite, compilado para WASM)
falando o protocolo do Postgres na porta 5433. A aplicação conecta com uma
connection string normal, então **não existe uma linha de código diferente
entre desenvolvimento e produção**.

Os dados ficam em `.banco/`. Apagar a pasta = banco novo.

## Subir para o ar

O banco fica no Supabase e a aplicação na Vercel, **os dois em São Paulo**. A
razão não é preferência: a latência que pesa é entre a aplicação e o banco, não
entre a pessoa e o banco. Com os dois juntos, cada consulta leva ~1ms; com um
oceano no meio, ~110ms — e uma tela que faz cinco consultas passa de 5ms para
550ms de banco.

O `vercel.json` fixa `gru1` para não depender de ninguém lembrar de marcar no
painel. Não há região de reserva de propósito: cair para outra região poria a
aplicação longe do banco, que é justamente o que este arranjo evita.

> Escolher região de função é recurso de plano pago na Vercel. No plano
> gratuito o `regions` é ignorado e tudo roda na região padrão (Estados
> Unidos) — o que, com o banco em São Paulo, é a pior combinação possível.
> Confira depois do primeiro deploy: `VERCEL_REGION` diz onde a função rodou.

### O banco hospedado

```bash
npm run preparar -- --producao   # tabelas, papel da aplicação e RLS
npm run conexao  -- --producao   # confere que a aplicação chega lá — só leitura
```

As credenciais moram em `.env.producao`, nunca no `.env`. Ver
`.env.producao.example`, que explica por que o caminho é o **pooler** e não o
host direto (que só tem endereço IPv6, e nem a Vercel nem a maioria das redes
falam IPv6).

A conferência completa (`npm run conferir`) **se recusa** a rodar fora do
laptop: ela apaga e recria as empresas de exemplo, e num banco de produção
ainda vazio isso deixaria `ana@exemplo.com`, com senha escrita neste
repositório, no ar.

### As três variáveis na Vercel

| | |
|---|---|
| `DATABASE_URL` | papel `app_norte`, porta **6543** (modo transação) |
| `DATABASE_URL_ADMIN` | papel `postgres`, porta **6543** |
| `SEGREDO_SESSAO` | 48 bytes aleatórios, **diferente** do local |

A porta muda conforme o uso: **5432** é sessão, e é o que DDL e migração
precisam; **6543** é transação, e é o que serverless precisa, porque a conexão
é emprestada por transação em vez de ficar presa a um processo.

O `comoOrg` faz tudo dentro de uma transação só (`set local role` e
`set_config(..., true)`), então o carimbo da empresa não vaza quando o pooler
troca a conexão por baixo. Se alguém um dia trocar por `SET` de sessão, o
`npm run conexao` acusa antes de virar vazamento.

`POOL_MAX` não vai: o padrão (10) é o certo fora do PGlite.

## Conector do WhatsApp (QR Code)

A loja conecta o WhatsApp dela lendo um QR Code na tela **Assistente ›
Conexão** — como no WhatsApp Web — sem pagar Z-API. Quem segura essa conexão
é o **conector** (pasta `conector/`): um serviço Node à parte, usando a
biblioteca aberta [Baileys](https://github.com/WhiskeySockets/Baileys) (MIT),
com uma conexão por empresa.

Ele é separado do Norte porque o WhatsApp Web é uma conexão **aberta o tempo
todo**. O Norte pode dormir (Render grátis), reiniciar a cada deploy, rodar em
várias cópias (Vercel); o conector precisa de **uma máquina pequena, sempre
ligada**. Não serve Render grátis (dorme depois de 15 min sem visita) nem
Vercel (não segura conexão).

```
 celular da loja ──WhatsApp──► CONECTOR (VPS) ──HMAC──► Norte /api/whatsapp-proprio/{empresa}
                                   ▲                        │
                                   └──── Bearer ◄───────────┘  (gerar QR, mandar mensagem)
```

- **A sessão não fica no disco do conector.** As credenciais de cada WhatsApp
  vão, comprimidas, para o Norte, que cifra com `NORTE_CIFRA` (presas à
  empresa) e guarda na tabela `sessoes_whatsapp`. No disco do conector fica só
  `dados/empresas.json`: a lista de ids para religar tudo depois de reiniciar.
- **Norte → conector:** `Authorization: Bearer <CONECTOR_SEGREDO>`.
  **Conector → Norte:** assinatura HMAC-SHA256 do pedido inteiro, com o mesmo
  segredo e carimbo de até 5 minutos.
- **Ritmo de gente, não de robô:** fila por número, 3 a 8 s sorteados entre
  envios, "digitando…" antes de cada mensagem, teto por minuto (12), por dia
  (500) e por contato (6/min). **Não existe envio em massa** — a API só aceita
  um destino por pedido. Ajustável por variável (ver `conector/.env.exemplo`).
- **Log sem conteúdo:** nem texto de mensagem, nem número inteiro, nem segredo.
- **Ele também é o relógio.** Com `ROTINAS_SEGREDO` (o mesmo do Norte) no
  `.env` do conector, ele acorda as campanhas a cada minuto
  (`/api/campanhas/tick`) e roda as rotinas do assistente a cada hora
  (`/api/rotinas`). Assim o cron pago do Render não é necessário.

> **Risco que a loja aceita.** Conectar por QR é o mesmo mecanismo do
> WhatsApp Web, mas não é a API oficial; os Termos do WhatsApp não preveem
> automação por ele e o número **pode ser bloqueado**. O que reduz o risco
> está no comportamento: o assistente só responde a quem chamou, as campanhas
> só seguem conversas que o cliente começou, e o ritmo acima. Use um número da
> loja, não o pessoal.

### As variáveis

| Onde | Variável | O quê |
|---|---|---|
| Norte | `CONECTOR_URL` | onde o conector escuta, ex.: `https://conector.suaempresa.com.br` |
| Norte | `CONECTOR_SEGREDO` | 32+ caracteres aleatórios — o **mesmo** nos dois lados |
| Norte | `NORTE_CIFRA` | já existente; sem ela a sessão não é guardada |
| conector | `CONECTOR_SEGREDO` | o mesmo do Norte |
| conector | `NORTE_URL` | o endereço do Norte, ex.: `https://norte.app` (https; http só localhost) |
| conector | `PORT` | padrão `3200` |

Gerar o segredo: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

Sem `CONECTOR_URL`/`CONECTOR_SEGREDO` no Norte, a tela diz "A conexão por QR
Code ainda não está ligada neste servidor" e o resto funciona igual.

### Rodar no laptop

```bash
cd conector
npm install
cp .env.exemplo .env      # CONECTOR_SEGREDO=<o mesmo do .env.development.local>, NORTE_URL=http://localhost:3000
npm start                 # escuta em http://localhost:3200
```

E no `.env.development.local` do Norte: `CONECTOR_URL=http://localhost:3200` e
o mesmo `CONECTOR_SEGREDO`.

### Pôr no ar numa VPS (passo a passo)

Serve qualquer servidor Linux pequeno e **sempre ligado**: 1 GB de memória
atende dezenas de lojas. Opções: Hetzner (CX22, ~4 €/mês), Contabo (VPS S),
ou Oracle Cloud "Always Free" (grátis, mais chato de criar). Escolha Ubuntu
24.04. Quem cria a conta e a máquina é o dono do Norte; o resto é copiar e
colar.

**1. Entrar na máquina.** O provedor mostra o IP e a senha (ou pede sua chave
SSH). No computador: `ssh root@IP-DA-MAQUINA`.

**2. Instalar o Docker e o Caddy** (o Caddy põe HTTPS sozinho):

```bash
curl -fsSL https://get.docker.com | sh
apt install -y caddy git
```

**3. Apontar um endereço para a máquina.** No painel do domínio, crie um
registro `A`: `conector.suaempresa.com.br` → IP da máquina. (Sem domínio
próprio, `IP-DA-MAQUINA.sslip.io` também funciona, ex.: `203-0-113-7.sslip.io`.)

**4. Baixar o conector e configurar:**

```bash
git clone <endereço do repositório do Norte> /opt/norte
cd /opt/norte/conector
cp .env.exemplo .env
nano .env        # CONECTOR_SEGREDO=<o segredo>  NORTE_URL=https://<endereço do Norte>
chmod 600 .env
```

**5. Subir o conector** (reinicia sozinho se cair ou se a máquina reiniciar):

```bash
docker build -t norte-conector .
docker run -d --name norte-conector --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3200:3200 -v norte-conector-dados:/app/dados \
  norte-conector
docker logs -f norte-conector      # deve aparecer "conector.no_ar"; Ctrl+C sai do log
```

A porta fica presa ao `127.0.0.1`: da internet, só se chega pelo Caddy.

**6. HTTPS na frente.** Troque todo o conteúdo de `/etc/caddy/Caddyfile` por:

```
conector.suaempresa.com.br {
    reverse_proxy 127.0.0.1:3200
}
```

e rode `systemctl reload caddy`. Conferir de fora:
`curl -H "Authorization: Bearer <o segredo>" https://conector.suaempresa.com.br/saude`
→ `{"ok":true,...}`.

**7. Fechar o resto.** `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable`.

**8. Ligar no Norte.** Na hospedagem do Norte (Render/Vercel), adicionar
`CONECTOR_URL=https://conector.suaempresa.com.br` e `CONECTOR_SEGREDO` (o
mesmo). Redeploy. Na tela **Assistente › Conexão**, "Conectar pelo QR Code".

**Atualizar depois:** `cd /opt/norte && git pull && cd conector && docker build -t norte-conector . && docker rm -f norte-conector` e o `docker run` do passo 5 de novo. As lojas
continuam conectadas: o conector grava a sessão no Norte antes de desligar e
religa sem QR.

**Sem Docker (systemd):** instale o Node 22 (`curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs`),
rode `npm ci --omit=dev` em `/opt/norte/conector`, crie um usuário
`useradd -r -s /usr/sbin/nologin norte` (`chown -R norte /opt/norte/conector`) e o arquivo
`/etc/systemd/system/norte-conector.service`:

```ini
[Unit]
Description=Norte - conector do WhatsApp
After=network-online.target

[Service]
User=norte
WorkingDirectory=/opt/norte/conector
EnvironmentFile=/opt/norte/conector/.env
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node --import tsx src/servidor.ts
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

`systemctl daemon-reload && systemctl enable --now norte-conector`, e o log com
`journalctl -u norte-conector -f`. O Caddy do passo 6 vale igual.


## WhatsApp oficial (Meta)

O terceiro jeito de a loja ligar o WhatsApp, e o único sem risco de bloqueio
por "aparelho não oficial": a **API oficial da Meta (WhatsApp Cloud API)**, com
o Norte como **Tech Provider**. Cada loja conecta o **próprio** número pela tela
**Assistente › Conexão**, num botão que abre o *Cadastro incorporado* da Meta
(Embedded Signup v4): ela entra com o Facebook da loja, escolhe (ou cria) a
conta do WhatsApp Business e o número, e volta conectada. A cobrança das
mensagens é da Meta, direto na conta da loja.

Tudo está pronto do lado do Norte e **desligado por variável**: sem as quatro
primeiras abaixo, a tela diz *"A conexão oficial ainda não está ligada neste
servidor"*, o webhook responde 404 e nada mais muda (QR Code e Z-API seguem
como estão). Com elas, o botão da Meta vira o caminho principal e QR/Z-API vão
para "Outras formas de conectar".

```
 loja ─► tela Conexão ─► janela da Meta (FB.login + config_id) ─► código + ids
                                                                   │
 Norte (servidor): troca o código pelo token ─► inscreve o app na conta (subscribed_apps)
                   ─► registra o número (PIN) ─► cria os modelos norte_* ─► canal = META
 Meta ──X-Hub-Signature-256──► /api/whatsapp-meta ─► o mesmo processarMensagem de sempre
```

**Onde está o código.** `src/servidor/assistente/meta-regras.ts` (regras puras:
assinatura, leitura do webhook, janela, erros, modelos), `meta.ts` (cliente da
Graph API e o `CanalMeta`), `meta-webhook.ts` (a porta), `meta-conexao.ts`
(conectar, desconectar, modelos da loja), `meta-cadastro.ts` (o recado do
cadastro, lido no navegador). Tela: `src/app/[empresa]/agente/ConexaoMeta.tsx`
e `src/app/[empresa]/campanhas/modelos/`. Testes: `tests/whatsapp-meta*.test.ts`.

**O que muda para a loja no oficial:**

- **Janela de 24 horas.** Texto livre só sai para quem escreveu à loja nas
  últimas 24 h (a janela é calculada das mensagens gravadas). Fora dela, só
  **modelo aprovado**. O canal oficial recusa o texto antes de chamar a Meta.
- **Rotinas (relatório 8h/20h, avisos):** quando a dona está fora da janela
  — o caso comum —, saem pelos modelos de utilidade `norte_relatorio_dia` e
  `norte_aviso`, que o Norte cria na conta da loja ao conectar (e no botão
  "Recriar modelos").
- **Campanhas:** o bloco de mensagem ganhou "Fora da janela de 24 horas,
  mandar o modelo". Sem modelo, a pessoa sai da campanha naquele bloco
  (motivo `janela_fechada`, contado na lista de campanhas).
- **Modelos da loja:** Campanhas › Modelos — criar (marketing ou utilidade,
  pt_BR, variáveis `{{1}}` com exemplo, título de texto ou imagem, até 3
  botões de resposta rápida), ver a situação (aprovado, em análise, recusado
  e o motivo) e apagar.
- **Coexistência:** quem já usa o número no app WhatsApp Business marca a
  caixa antes de conectar; a equipe segue respondendo pelo celular, e o que
  ela manda de lá chega como eco (`smb_message_echoes`) e cala o automático
  por 24 h, como no QR Code.

**A empresa de cada mensagem.** O webhook é um endereço só para todas as lojas;
quem diz de quem é a mensagem é o `phone_number_id`. A busca atravessa empresas
e por isso passa pela portaria, numa função `SECURITY DEFINER`
(`org_do_numero_meta`, em `prisma/sql/rls.sql`) que só aceita o id exato e só o
papel `app_portaria` pode chamar — o `app_norte` continua sem leitura nenhuma
entre empresas. **Depois de migrar, rode `npm run preparar -- --producao`**
(ou reaplique o `rls.sql`) para a função existir em produção.

### As variáveis

| Variável | O quê |
|---|---|
| `META_APP_ID` | Id do app (painel da Meta › Configurações do app › Básico) |
| `META_APP_SECRET` | Chave secreta do app. Assina o webhook e troca o código — só no servidor |
| `META_CONFIG_ID` | Id da configuração do Cadastro incorporado (Facebook Login for Business › Configurações) |
| `META_WEBHOOK_VERIFY_TOKEN` | Texto aleatório (16+ caracteres), o mesmo colado no painel do webhook |
| `META_GRAPH_VERSION` | Opcional; padrão `v25.0` (a dos exemplos atuais da Meta; a `v26.0` também serve) |
| `NORTE_CIFRA` | Já existente — obrigatória: cifra o token de cada loja |
| `NORTE_URL` | Já existente — as fotos das campanhas vão por link assinado |

A política de segurança (`src/proxy.ts`) abre os domínios da Meta
(`connect.facebook.net`, `*.facebook.com`, `graph.facebook.com`) **só na tela
`/<empresa>/agente`**, e só lá troca `Cross-Origin-Opener-Policy` para
`same-origin-allow-popups` (sem isso a janela do cadastro não consegue devolver
os ids). O resto do sistema continua sem script de fora.

### O que fazer no painel da Meta, depois da verificação da empresa

1. **Criar o app** em developers.facebook.com › Meus apps › Criar app ›
   tipo **Empresa (Business)**, caso de uso **WhatsApp**, ligado ao portfólio
   empresarial do Norte (o que foi verificado).
2. **Configurações do app › Básico:** nome, ícone, e-mail, categoria, e os
   links da **Política de privacidade** (`https://<domínio>/privacidade`),
   **Termos** (`https://<domínio>/termos`) e **Exclusão de dados**
   (`https://<domínio>/exclusao-de-dados`). Copie o **ID do app** →
   `META_APP_ID` e a **Chave secreta** → `META_APP_SECRET`.
3. **WhatsApp › Configuração › Webhook:** URL de retorno
   `https://<domínio>/api/whatsapp-meta` e o token de verificação
   (`META_WEBHOOK_VERIFY_TOKEN`) — **com as variáveis já no ar**, porque a Meta
   confere na hora (GET com o desafio). Em "Campos do webhook", assinar:
   `messages`, `message_template_status_update`, `account_update`,
   `smb_message_echoes`, `smb_app_state_sync`, `history` (os dois últimos são
   exigidos na coexistência; o Norte recebe e descarta), e se quiser
   `template_category_update` e `phone_number_quality_update` (só vão para o log).
4. **Facebook Login for Business › Configurações › Criar configuração:**
   escolha o modelo **"WhatsApp Embedded Signup"** (variação de login do
   cadastro incorporado), produtos **WhatsApp Cloud API** (e, para quem usa o
   app no mesmo número, a opção de **WhatsApp Business app / coexistência**).
   Copie o **ID da configuração** → `META_CONFIG_ID`.
5. **Facebook Login for Business › Configurações (do produto):** ligar
   *Login OAuth do cliente*, *Login OAuth da Web*, *Forçar HTTPS*, *Login
   OAuth do navegador incorporado*, *Modo estrito para URIs de redirecionamento*
   e **Login com o SDK do JavaScript**; em **Domínios permitidos para o SDK do
   JavaScript** e em **URIs de redirecionamento do OAuth válidos**, pôr
   `https://<domínio>/`.
6. **Pôr as variáveis no Render** (render.yaml já lista, `sync: false`),
   fazer o deploy, e só então salvar o webhook do passo 3.
7. **Testar em modo de desenvolvimento:** com o app ainda não publicado, só
   quem tem papel no app (administrador/desenvolvedor/testador) consegue fazer
   o cadastro. Conecte um número de teste, mande "oi" do seu celular, clique em
   "Enviar mensagem de teste para mim", crie um modelo em Campanhas › Modelos.
8. **Revisão do app (App Review):** pedir **Acesso avançado** a
   `whatsapp_business_messaging` e `whatsapp_business_management`, cada uma
   com um vídeo — o roteiro está em `docs/meta/roteiro-videos-revisao.md`.
9. Aprovado: **publicar o app** (modo Ao vivo). Por padrão a Meta deixa um
   Tech Provider cadastrar 10 empresas novas por semana; depois da revisão, 200.

**O que só dá para conferir com o app de verdade** (os testes cobrem a lógica
com a Meta de mentira): a janela do cadastro abrindo e devolvendo código e ids
no domínio real; a troca do código; a inscrição do app e o registro do número;
a aprovação dos modelos `norte_*` pela Meta; a entrega real (texto, foto por
link assinado, modelo) e os status no webhook; a coexistência com o app
WhatsApp Business; o upload da imagem de título de modelo.

## Estado

**Cadastro inicial e módulos.** A empresa responde o que usa e o sistema
esconde o resto: quem não vende fiado não vê Crediário em lugar nenhum.
Ligar de volta é em Configurações.

**Fase 2 — quase lá.** Catálogo (a empresa nomeia os eixos de variação),
estoque com movimento atômico, venda numa transação só (estoque + venda +
pagamento) e caixa que fecha conferindo a gaveta. Dinheiro em **centavos
inteiros** — ver `src/servidor/dinheiro.ts` e o bug que originou o arquivo.

Agora com as telas: cadastrar produto com grade, dar entrada de mercadoria
(saldo + custo + conta do fornecedor numa transação só), corrigir estoque por
contagem, e a equipe com convite por link.

E clientes, com o histórico de compra de cada um — que é o que transforma a
lista numa ferramenta de venda, e de onde sai o "cliente sumido" que o
assistente vai buscar.

O critério da fase era "passar um dia inteiro de vendas reais sem abrir o
sistema antigo". Falta para cumprir: etiqueta, troca, parcela com juro e o
modo sem internet.

(Escolher o cliente na venda saiu desta lista em 08/09: o balcão manda o
cliente na venda e o programa de pontos está ligado.)

**Fase 3 — o DRE fecha, o resto não.** Contas a pagar com aviso de vencida,
lançamento de despesa, 18 categorias já amarradas à linha do DRE, e o
demonstrativo mensal conferido linha a linha. Faltam recorrentes (a tabela
existe, o motor não), contas a receber, DRE em PDF e conciliação de maquininha.

> Chamar fase de "fechada" quando o critério dela não foi cumprido esconde
> exatamente o trabalho que separa a demonstração do primeiro cliente pagando.
> O estado por item está em `docs/` e no relatório de situação.

**Marca e porta de entrada.** O símbolo (`src/ui/Marca.tsx`), a paleta sem
viés de cor, a barra lateral azul-noite e a página de venda em `/` — com os
quatro planos, a seção de segurança e as perguntas que travam assinatura.

**Auditoria de segurança.** Cinco furos fechados: preço vindo do navegador,
Server Action sem capacidade, login sem freio, sessão que sobrevivia à
demissão e ausência total de cabeçalho de segurança. Detalhe em
`DECISOES.md` §11.

**Fase 4 — o assistente, primeira metade.** Ele existe, tem nome, poderes com
teto e a mecânica de propor/confirmar funcionando de ponta a ponta: ele monta
a proposta, quem não tem a capacidade não confirma, quem tem confirma e a
ação acontece de verdade — pelo mesmo serviço que a tela usa.

Falta o que o liga ao mundo: o canal de WhatsApp, o motor de conversa e os
gatilhos que fazem ele agir sozinho.

## As regras que não se quebram

1. **Toda tabela de dado de cliente carrega `org_id`.** Sem exceção.
2. **Ninguém fala com o banco direto.** Tudo passa por `comoOrg()` em
   `src/servidor/banco.ts`. Se você escreveu `prisma.` fora daquele arquivo,
   está errado.
3. **O código pergunta pela capacidade, nunca pelo papel.** `pode(sessao,
   'caixa.operar', unidadeId)` — nunca `if (papel === 'GERENTE')`. Assim criar
   um papel novo não obriga a caçar condição espalhada pelo sistema.
4. **Ninguém concede papel que não tem.** Gerente contrata balconista; só dono
   cria dono. Sem isso, "gerir equipe" viraria caminho para virar dono.
5. **Isolamento tem duas paredes:** a aplicação (`comoOrg`) e o RLS do Postgres
   (`prisma/sql/rls.sql`). A segunda existe para quando a primeira falhar.
6. **`npm test` verde é condição para subir.** Vazamento entre empresas mata o
   negócio no primeiro dia.
7. **Dinheiro se conta em centavos inteiros**, nunca com número quebrado.
   `44,90 × 0,750` dá 33,68 — a conta ingênua dá 33,67, e o centavo some
   toda vez que cai na metade. Reais quebrados só nas beiradas: tela e banco.
8. **Estoque se mexe só por `mexerEstoque()`.** A conta (`quantidade + delta`)
   acontece dentro do banco, nunca na memória — senão duas vendas ao mesmo
   tempo perdem uma baixa. E o histórico é a verdade: `conferirSaldos()`
   acusa se o saldo divergir da soma.
9. **Cor sempre com palavra ou sinal junto.** Etiqueta tem bolinha E texto;
   comparação tem seta E percentual. Quem não distingue verde de vermelho
   (8% dos homens) precisa ler exatamente a mesma coisa.
10. **Situação (verde/âmbar/vermelho) nunca vira cor de marca.** Se a marca
   fosse verde, "no prazo" e "logo da empresa" competiriam pelo olho.
11. **O livro de auditoria só recebe.** Sem UPDATE, sem DELETE, e a tentativa
   levanta erro em vez de falhar em silêncio.
12. **Server Action é endereço público.** Não é "a função que o meu botão
   chama": é um POST que qualquer pessoa autenticada monta na mão, com os
   argumentos que quiser. Toda uma delas começa por `exigirSessao()` e repete
   a checagem de capacidade E de unidade, mesmo quando a tela já escondeu o
   botão. Esconder o botão é conforto; a trava é no servidor.
13. **Preço e valor nunca vêm do navegador.** O que chega do cliente é PEDIDO.
   O preço de tabela sai do banco, e a diferença entre os dois é desconto —
   que tem teto por empresa e capacidade própria (`venda.desconto`).
14. **O agente propõe, uma pessoa confirma.** Nada que mexa em dinheiro, preço
   ou estoque acontece direto. E ele nunca pode mais do que quem confirma:
   cada poder declara a capacidade humana equivalente, conferida na hora do
   sim. Sem isso, confirmar viraria o caminho para o balconista fazer, pelo
   agente, o que ele não faz pela tela.
15. **Instrução não é permissão.** A personalidade do agente é texto e decide
   só COMO ele fala. O que ele pode é lista fechada mais números no banco,
   conferidos no servidor DEPOIS de o modelo responder. Quem manda mensagem
   no WhatsApp consegue tentar sobrescrever texto — número, não.
16. **`lerSessao()` só é chamado dentro de `pagina.ts`.** O resto do sistema
   usa `exigirEntrada()` ou `exigirSessao()`, que confrontam o cookie com o
   banco. Ler o cookie direto pula a checagem de conta desativada.

### Onde ficam as coisas

| Arquivo | Responsabilidade |
|---|---|
| `src/servidor/banco.ts` | A parede 1: `comoOrg()`. Único lugar que fala com o banco |
| `src/servidor/permissao.ts` | Quem pode o quê. Puro, sem I/O |
| `src/servidor/senha.ts` | Guardar e conferir senha (scrypt) |
| `src/servidor/autenticacao.ts` | Entrar no sistema |
| `src/servidor/convite.ts` | Convidar gente para a equipe |
| `src/servidor/sessao.ts` | Cookie de sessão, com escopo por empresa |
| `src/servidor/pagina.ts` | `exigirEntrada()` — toda tela de dentro começa por ela |
| `src/servidor/estoque.ts` | Movimento de estoque, atômico. A conta acontece no banco |
| `src/servidor/modulos.ts` | O que cada empresa usa, e o que cada ramo já deixa pronto |
| `src/servidor/dinheiro.ts` | Centavos inteiros. Nenhuma conta de dinheiro sai daqui |
| `src/servidor/venda.ts` | Registrar venda: estoque + venda + pagamento, ou nada |
| `src/servidor/caixa.ts` | Abrir, movimentar e fechar o caixa do turno |
| `src/servidor/financeiro.ts` | Contas a pagar, lançamentos e o DRE |
| `src/servidor/unidade.ts` | Qual loja a pessoa está olhando, e quais ela alcança |
| `src/servidor/painel.ts` | Os números do painel, uma consulta por assunto |
| `src/servidor/planos.ts` | Cotas por plano e o que custa a loja extra |
| `src/servidor/limite.ts` | O freio do login: quantas tentativas, por e-mail e por IP |
| `src/servidor/produto.ts` | Cadastrar produto e mexer na grade sem apagar história |
| `src/servidor/entrada.ts` | Entrada de mercadoria: saldo, custo e conta do fornecedor |
| `src/servidor/equipe.ts` | Papel, acesso e as três travas que impedem a empresa de ficar sem dono |
| `src/servidor/cliente.ts` | Cliente, com telefone como chave e CPF conferido de verdade |
| `src/servidor/poderes.ts` | O catálogo de poderes do agente e as travas. **Puro** |
| `src/servidor/agente.ts` | Configuração, propor/confirmar, recibo e consumo |
| `src/servidor/custo-ia.ts` | Quanto custa cada conversa. **Puro** |
| `src/servidor/assistente/canal.ts` | Por onde a mensagem sai: QR Code > Z-API da empresa > Z-API global > de mentira |
| `src/servidor/assistente/conector.ts` | O Norte falando com o conector: Bearer para lá, HMAC para cá |
| `src/servidor/assistente/proprio.ts` | O que o conector entrega (mensagens) e guarda (a sessão cifrada) |
| `conector/` | O serviço à parte que segura o WhatsApp por QR Code (Baileys). Fora do build do Next |
| `src/proxy.ts` | Os cabeçalhos de segurança de toda página (CSP com nonce, HSTS…) |
| `src/ui/Marca.tsx` | O símbolo e o nome. `src/app/icon.svg` é o mesmo desenho |
| `src/app/page.tsx` | A página de venda (a raiz do site) |
| `src/ui/` | Componentes: Botão, Campo, Aviso, Situação, Cartão, Tabela, Estrutura |
| `src/app/globals.css` | As fichas de cor e os dois temas |
| `src/ui/painel.tsx` | Número, gráfico, ranque e a tira de contagens coloridas |

### Ao criar tabela nova

Ela precisa de `org_id`, e o `rls.sql` precisa rodar de novo — ele liga a
proteção por varredura, então tabela nova entra sozinha. O terceiro teste
(`RLS está ligado e forçado em toda tabela com org_id`) reprova se esquecerem.

## Limitações conhecidas do banco local

O PGlite é um Postgres de **um backend só**. Duas consequências, ambas só no
desenvolvimento:

- **Sem concorrência real.** Várias conexões são multiplexadas por cima de um
  backend, então transações simultâneas não se comportam como num Postgres de
  verdade. Por isso `POOL_MAX=1` no `.env`. Qualquer coisa sensível a
  concorrência precisa ser validada no banco hospedado.
- **`npm run conferir` quer banco novo.** Ele cria convite, venda e gente; na
  segunda rodada seguida sobra estado do anterior. E o freio de login deixa
  contas bloqueadas por 15 minutos de propósito — a segunda rodada reprova
  justamente porque a defesa funcionou. Rode `npm run banco` de novo (a pasta
  `.banco/` some) antes de conferir outra vez.
- **Conexão não sobrevive a transação abortada.** Postgres de verdade recupera;
  este não. Por isso o `npm run conferir` só faz leitura — checagem do tipo
  "esta escrita tem que dar erro" envenenaria a conexão e as seguintes
  passariam pelo motivo errado. Essas ficam no `npm test`, que fala com o
  PGlite direto e não sofre disso.
- **O usuário da URL é ignorado.** Medido: conectando com
  `app_portaria:portaria_dev` o banco responde `current_user = postgres`, com
  `rolsuper = true`. Ou seja, **toda** conexão local é superusuário, inclusive a
  da aplicação — e permissão por papel ou por coluna simplesmente não existe
  aqui. O isolamento continua valendo no laptop porque o `comoOrg` faz
  `set local role` explícito dentro da transação, e não porque a conexão seja
  limitada.

  A consequência prática: qualquer coisa que dependa de **quem** a conexão é —
  o papel sem privilégio, a portaria que só lê nove colunas — passa
  automaticamente no local, sem provar nada. Isso se confere com
  `npm run conexao -- --producao`, contra um Postgres que autentica de verdade.

Quando houver banco hospedado (Neon é o plano — ver `DECISOES.md`), as
checagens de escrita voltam para o `conferir`.

## Pilha

Next.js · TypeScript · PostgreSQL · Prisma 7 · Vitest · PGlite (dev e testes)

> Prisma 7 tirou a `url` do `schema.prisma`. Ela vive em `prisma.config.ts`
> para migração, e o cliente da aplicação usa adapter.
