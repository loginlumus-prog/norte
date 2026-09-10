# As artes de origem

Os PNGs daqui são **os mestres**. Eles não são servidos: a página usa os vídeos
de `public/video/`, gerados a partir destes arquivos.

Ficam fora de `public/` de propósito — 1 MB que ninguém baixa não precisa viajar
em todo deploy.

## Como um vídeo nasce

1. **Fundo de recorte.** A arte é composta sobre magenta puro (`#FF00FF`), uma
   cor que não existe na paleta:

   ```js
   sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
     .composite([{ input: 'arte/cena-moda.png' }])
   ```

2. **Geração.** Kling 2.5, 1080p, 5s — e o detalhe que faz o laço fechar:
   **o quadro inicial e o final são o MESMO arquivo**. O modelo é obrigado a
   voltar para onde começou, então o `loop` do HTML não tem emenda. Medido: a
   diferença entre o primeiro e o último quadro fica abaixo de 1 em 255.

   O prompt precisa ser rígido em quatro pontos, ou a cena escapa:
   câmera travada, fundo magenta perfeitamente uniforme, movimento pequeno e
   cíclico, e uma lista explícita do que é proibido (mudar estilo, virar 3D,
   aparecer texto, deformar rosto e mão). Os prompts usados estão no histórico
   do commit que trouxe os vídeos.

3. **Recorte e conversão.** O MP4 vai para `.video/bruto/` e:

   ```
   npm run video
   ```

   O resto está documentado em `scripts/recortar-video.mjs`.

## Se for trocar uma arte

Troque o PNG aqui, refaça os passos 1 a 3, e só. A página não muda: ela pede
`cena-<nome>` e recebe vídeo e pôster com esse nome.
