# Roteiro dos vídeos da Revisão do App (Meta)

Para pedir **Acesso avançado** às duas permissões do WhatsApp, a Meta pede **um
vídeo por permissão**, mostrando o app do Norte usando aquela permissão de
ponta a ponta. São dois vídeos:

| Vídeo | Permissão | O que precisa aparecer |
|---|---|---|
| 1 | `whatsapp_business_messaging` | Uma mensagem sai do Norte e **chega no WhatsApp** de um celular |
| 2 | `whatsapp_business_management` | Um **modelo de mensagem** é criado dentro do Norte (e aparece na conta da Meta) |

A revisão costuma levar cerca de 24 horas. Vídeo recusado quase sempre é por
um destes motivos: não mostra o login, pula um passo, não mostra o resultado
do outro lado (o celular, o WhatsApp Manager), ou está em outra língua sem
legenda. Por isso o roteiro abaixo mostra tudo, devagar.

---

## Antes de gravar

- [ ] App da Meta criado, em **modo de desenvolvimento**, com as variáveis
      `META_*` no ar e o webhook verificado (README › "WhatsApp oficial (Meta)").
- [ ] Quem vai gravar tem **papel no app** (administrador ou desenvolvedor) —
      sem isso o Cadastro incorporado não abre em modo de desenvolvimento.
- [ ] Um **número de teste** para conectar (pode ser o número de teste que a
      Meta oferece no WhatsApp Manager, ou um chip só para isso) e **outro
      celular** com WhatsApp para receber.
- [ ] Na tela **Equipe** do Norte, o telefone da pessoa que grava cadastrado
      com DDD — é para ele que vai a "mensagem de teste para mim".
- [ ] Uma empresa de demonstração no Norte (ex.: **Comércio Exemplo**), com o
      assistente criado e o módulo "Agente no WhatsApp" ligado, em plano que
      inclui campanhas.
- [ ] Navegador limpo (sem extensão de bloqueio de anúncio — ela barra o SDK
      da Meta), zoom em 110–125%, tela em 1920×1080, idioma do sistema em
      português **ou** inglês.
- [ ] Gravar com o cursor visível e **legendas em inglês** (a revisão é feita
      em inglês; a narração pode ser em português se houver legenda). Os
      textos entre aspas abaixo vêm com a sugestão de legenda.

Duração alvo: **2 a 4 minutos cada**. Sem cortes no meio de um passo
(cortar entre passos pode).

---

## Vídeo 1 — `whatsapp_business_messaging`

**Objetivo:** mostrar que o Norte manda mensagem pelo WhatsApp oficial em nome
da empresa que se conectou, e que ela chega no celular.

| # | O que mostrar | O que dizer (legenda em inglês) |
|---|---|---|
| 1 | A tela de entrada do Norte, digitando o e-mail e entrando | "Este é o Norte, um sistema de gestão para lojas. Vou entrar como dona da loja." — *"This is Norte, a retail management system. I'm logging in as the store owner."* |
| 2 | Menu › **Assistente** › cartão **Conexão**. Mostrar o bloco "WhatsApp oficial (Meta)" | "Aqui a loja conecta o próprio WhatsApp Business pela API oficial." — *"Here the store connects its own WhatsApp Business number through the official Cloud API."* |
| 3 | Digitar um PIN de 6 números e clicar **Conectar pelo WhatsApp oficial (Meta)** | "O Norte usa o Cadastro incorporado da Meta." — *"Norte uses Meta's Embedded Signup."* |
| 4 | Na janela da Meta: entrar no Facebook, escolher o portfólio, a conta do WhatsApp Business e o número, aceitar as permissões, concluir | "A loja escolhe a conta e o número, e autoriza o Norte." — *"The business selects its WhatsApp Business account and phone number and grants Norte access."* |
| 5 | De volta ao Norte: o aviso verde "Conectado pelo WhatsApp oficial: (xx) x····-xxxx" | "Conectado. O token fica cifrado no servidor; a tela só mostra o número mascarado." — *"Connected. The access token is encrypted on our server; the screen only shows the masked number."* |
| 6 | **Do outro celular**, mandar "oi" para o número conectado (mostrar a tela do celular) | "Um cliente manda uma mensagem para a loja." — *"A customer sends a message to the store."* |
| 7 | No Norte, na mesma tela, rolar até **Últimas conversas** e mostrar a mensagem que chegou | "A mensagem chega no Norte pelo webhook." — *"The message arrives in Norte through the webhook."* |
| 8 | Clicar **Enviar mensagem de teste para mim** e mostrar o aviso verde "Mensagem enviada para …" | "Agora o Norte manda uma mensagem pela API." — *"Now Norte sends a message through the API."* |
| 9 | Mostrar o **celular** da pessoa que grava recebendo a mensagem do número da loja | "E ela chega no WhatsApp." — *"And it's delivered on WhatsApp."* |
| 10 | (Opcional, reforça) Mostrar uma **campanha**: Campanhas › abrir uma com a frase "catálogo"; do celular do cliente mandar "catálogo" e mostrar a resposta automática chegando | "As campanhas respondem a quem escreveu para a loja, dentro da janela de 24 horas." — *"Campaigns reply to customers who messaged the store, inside the 24-hour customer service window."* |

Pontos que o revisor procura:
- o **login** no Norte e o **Cadastro incorporado** completos, sem corte;
- a mensagem **saindo do Norte** (o clique) e **chegando no WhatsApp** (o celular);
- que é a conta **da empresa cliente**, não uma conta nossa.

---

## Vídeo 2 — `whatsapp_business_management`

**Objetivo:** mostrar que o Norte gerencia os ativos do WhatsApp da empresa —
cria modelos de mensagem na conta dela (e os mostra com a situação da Meta).

| # | O que mostrar | O que dizer (legenda em inglês) |
|---|---|---|
| 1 | Entrar no Norte (como no vídeo 1) — a empresa já conectada | "A loja já está conectada pelo WhatsApp oficial." — *"The store is already connected through the official WhatsApp Business Platform."* |
| 2 | Assistente › Conexão: mostrar o número conectado e o botão **Recriar modelos**; clicar | "Ao conectar, o Norte cria na conta da loja dois modelos de utilidade: o relatório do dia e os avisos." — *"When connecting, Norte creates two utility templates in the business's account: the daily report and alerts."* |
| 3 | Menu › **Campanhas** › link **Modelos de mensagem (WhatsApp oficial)** | "Aqui a loja gerencia os modelos de mensagem da conta dela." — *"Here the business manages the message templates in its own WhatsApp Business account."* |
| 4 | Mostrar a lista: `norte_relatorio_dia` e `norte_aviso` com a situação (Aprovado / Em análise) | "A lista vem direto da Meta, com a situação de aprovação." — *"The list is read live from Meta, with the approval status."* |
| 5 | Em **Novo modelo**: nome `boas_vindas_demo`, categoria **Marketing**, texto `Oi, {{1}}! Chegou a coleção nova e separamos um desconto de {{2}} para você. Quer ver?`, exemplos `Ana` e `10%`, rodapé `Responda SAIR para não receber mais`, botões `Quero ver` e `Agora não` | "A loja cria um modelo, com variáveis e exemplos." — *"The business creates a template with variables and sample values."* |
| 6 | Clicar **Enviar para aprovação** e mostrar o aviso verde | "O Norte envia o modelo para a Meta aprovar." — *"Norte submits the template to Meta for review."* |
| 7 | A lista atualizada, com `boas_vindas_demo` **Em análise** (ou Aprovado) | — |
| 8 | Abrir o **WhatsApp Manager** (business.facebook.com › WhatsApp Manager › Modelos de mensagem) da conta conectada e mostrar o mesmo modelo lá | "O mesmo modelo aparece no WhatsApp Manager da empresa." — *"The same template shows up in the business's WhatsApp Manager."* |
| 9 | (Opcional) De volta ao Norte: abrir uma campanha, clicar num bloco de **Mensagem** e mostrar "Fora da janela de 24 horas, mandar o modelo" com um modelo aprovado escolhido | "Fora da janela de 24 horas, as campanhas só usam modelos aprovados." — *"Outside the 24-hour window, campaigns only send approved templates."* |
| 10 | (Opcional) Apagar o `boas_vindas_demo` com **Apagar › Apagar mesmo** | "E a loja pode apagar um modelo." — *"And the business can delete a template."* |

Pontos que o revisor procura:
- o modelo sendo **criado a partir do Norte** (não direto no WhatsApp Manager);
- o resultado **na conta da empresa** (a lista do Norte lida da Meta, e o
  WhatsApp Manager).

---

## No formulário da revisão

Para cada permissão, além do vídeo, a Meta pede um texto de "como o app usa".
Sugestão (em inglês, que é como o formulário é lido):

**whatsapp_business_messaging**
> Norte is a retail management SaaS for small stores in Brazil. Each store
> connects its own WhatsApp Business number through Embedded Signup. Norte
> uses this permission to (1) reply to customers who message the store, only
> through store-defined campaign scripts started by the customer, inside the
> 24-hour customer service window; (2) send the store owner and staff their
> own daily sales report and stock alerts, using approved utility templates
> when outside the window; (3) receive incoming messages and delivery statuses
> through webhooks. Norte never sends unsolicited bulk messages.

**whatsapp_business_management**
> Norte uses this permission to manage the connected business's WhatsApp
> assets on its behalf: subscribe our app to the WABA webhooks, register the
> phone number on the Cloud API, read the phone number's display name, and
> list, create and delete message templates from Norte's "Message templates"
> screen. Norte also creates two utility templates (daily report and alerts)
> in the business's account right after it connects.

---

## Depois da aprovação

1. Publicar o app (modo **Ao vivo**).
2. Conferir no painel se o limite de cadastro de empresas subiu (10 por
   semana antes da revisão; 200 depois).
3. Conectar a primeira loja real pelo botão da tela Conexão e mandar a
   mensagem de teste.
