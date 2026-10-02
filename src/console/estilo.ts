// O visual do console: uma folha só, servida de /estilo.css (a política de
// conteúdo não aceita estilo embutido). Cores do Norte — azul #1f4fd8 e a
// tinta #0d1b45 — e as fontes da marca quando estão instaladas na máquina;
// senão, a do sistema. Nada é baixado de fora.

export const ESTILO = `
:root{
  --azul:#1f4fd8;--azul-2:#e8eefc;--tinta:#0d1b45;--texto:#1b2440;--suave:#5b6683;--linha:#e3e7f0;
  --fundo:#f5f7fb;--cartao:#fff;--verde:#13795b;--verde-2:#e3f5ee;--ambar:#9a6400;--ambar-2:#fff3d6;
  --vermelho:#b42318;--vermelho-2:#fde8e6;--laranja:#b54708;--laranja-2:#fff0e0;--cinza-2:#eef0f4;
  --raio:12px;--sombra:0 1px 2px rgba(13,27,69,.06),0 1px 1px rgba(13,27,69,.04);
}
*{box-sizing:border-box}
html,body{margin:0}
body{font-family:Manrope,"Cabinet Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
  font-size:14px;line-height:1.45;color:var(--texto);background:var(--fundo);-webkit-font-smoothing:antialiased}
a{color:var(--azul);text-decoration:none}
a:hover{text-decoration:underline}
.topo{background:var(--tinta);color:#fff;position:sticky;top:0;z-index:5}
.topo .dentro{max-width:1440px;margin:0 auto;padding:0 20px;height:56px;display:flex;align-items:center;gap:22px}
.marca{font-weight:800;letter-spacing:-.02em;font-size:17px;color:#fff;display:flex;align-items:center;gap:8px}
.marca i{width:22px;height:22px;border-radius:6px;background:var(--azul);display:inline-block;position:relative}
.marca i:after{content:"";position:absolute;inset:6px;border:2px solid #fff;border-radius:50%;border-top-color:transparent;transform:rotate(45deg)}
.marca small{font-weight:600;opacity:.6;font-size:13px}
.topo nav{display:flex;gap:4px}
.topo nav a{color:#c9d3f0;padding:7px 12px;border-radius:8px;font-weight:600}
.topo nav a:hover{background:rgba(255,255,255,.08);text-decoration:none;color:#fff}
.topo nav a.ativo{background:rgba(255,255,255,.12);color:#fff}
.topo .bolha{background:#ff6b57;color:#fff;border-radius:999px;font-size:11px;padding:1px 7px;margin-left:6px;font-weight:700}
.topo .dir{margin-left:auto;display:flex;align-items:center;gap:12px;font-size:13px;color:#c9d3f0}
.ambiente{font-size:11px;font-weight:800;letter-spacing:.06em;padding:3px 8px;border-radius:6px}
.ambiente.local{background:#1c7a5a;color:#fff}
.ambiente.prod{background:#d92d20;color:#fff}
.faixa-prod{background:#d92d20;color:#fff;text-align:center;font-weight:700;font-size:12px;padding:5px;letter-spacing:.02em}
main{max-width:1440px;margin:0 auto;padding:22px 20px 60px}
h1{font-size:22px;letter-spacing:-.02em;margin:0;color:var(--tinta)}
h2{font-size:14px;margin:0 0 10px;color:var(--tinta);letter-spacing:-.01em}
.sub{color:var(--suave);font-size:13px}
.linha-titulo{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.cartoes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:18px 0}
.cartao{background:var(--cartao);border:1px solid var(--linha);border-radius:var(--raio);box-shadow:var(--sombra);padding:14px 16px}
.cartao .rot{color:var(--suave);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.cartao .num{font-size:24px;font-weight:800;color:var(--tinta);letter-spacing:-.02em;margin-top:4px}
.cartao .det{color:var(--suave);font-size:12px;margin-top:2px}
.barra{height:6px;background:var(--cinza-2);border-radius:99px;overflow:hidden;margin-top:8px}
.barra b{display:block;height:100%;background:var(--azul);border-radius:99px}
.barra b.passou{background:var(--vermelho)}
.filtros{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
input,select,textarea{font:inherit;color:inherit;border:1px solid #cfd6e4;border-radius:8px;padding:7px 10px;background:#fff;min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid rgba(31,79,216,.25);border-color:var(--azul)}
input[type=search]{width:280px}
button,.botao{font:inherit;font-weight:700;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;background:var(--azul);color:#fff;white-space:nowrap}
button:hover,.botao:hover{filter:brightness(1.08);text-decoration:none}
button.sec,.botao.sec{background:#fff;color:var(--tinta);border:1px solid #cfd6e4}
button.perigo{background:var(--vermelho)}
button.ok{background:var(--verde)}
.tabela-caixa{background:var(--cartao);border:1px solid var(--linha);border-radius:var(--raio);box-shadow:var(--sombra);overflow:auto}
table{width:100%;border-collapse:collapse}
th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--suave);text-align:left;font-weight:700;padding:10px 12px;border-bottom:1px solid var(--linha);background:#fafbfd;white-space:nowrap;position:sticky;top:0}
td{padding:10px 12px;border-bottom:1px solid var(--linha);vertical-align:top}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:#fafbff}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.nome{font-weight:700;color:var(--tinta)}
td.n .mini{white-space:nowrap}
td:first-child{min-width:170px}
.mini{font-size:12px;color:var(--suave)}
.chip{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.04em;padding:2px 8px;border-radius:999px;white-space:nowrap}
.chip.TESTE{background:var(--ambar-2);color:var(--ambar)}
.chip.ATIVA{background:var(--verde-2);color:var(--verde)}
.chip.SUSPENSA{background:var(--vermelho-2);color:var(--vermelho)}
.chip.INADIMPLENTE{background:var(--laranja-2);color:var(--laranja)}
.chip.CANCELADA{background:var(--cinza-2);color:#4a5268}
.pilula{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:6px;background:var(--azul-2);color:var(--azul);white-space:nowrap}
.pilula.cinza{background:var(--cinza-2);color:#4a5268}
.pilula.verde{background:var(--verde-2);color:var(--verde)}
.pilula.ambar{background:var(--ambar-2);color:var(--ambar)}
.pilula.vermelho{background:var(--vermelho-2);color:var(--vermelho)}
.vazio{padding:28px;text-align:center;color:var(--suave)}
.aviso{border-radius:10px;padding:12px 14px;margin:0 0 16px;font-size:14px;border:1px solid}
.aviso.ok{background:var(--verde-2);border-color:#b5e3d1;color:#0d5c44}
.aviso.erro{background:var(--vermelho-2);border-color:#f6c2bd;color:#8a1a12}
.aviso.info{background:var(--azul-2);border-color:#c8d6fa;color:#173a9e}
.aviso code,.copiar{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;background:rgba(255,255,255,.7);padding:2px 6px;border-radius:6px;word-break:break-all}
.grade{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:18px;align-items:start}
.coluna{display:flex;flex-direction:column;gap:16px;min-width:0}
.tres{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0 18px}
dl.pares{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:13px}
dl.pares dt{color:var(--suave)}
dl.pares dd{margin:0;font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
dl.pares dd.total{font-size:16px;color:var(--tinta);font-weight:800;border-top:1px solid var(--linha);padding-top:4px}
dl.pares dt.total{border-top:1px solid var(--linha);padding-top:4px;font-weight:700;color:var(--tinta)}
.acoes{background:var(--cartao);border:1px solid var(--linha);border-radius:var(--raio);box-shadow:var(--sombra);position:sticky;top:72px;max-height:calc(100vh - 90px);overflow:auto}
.acoes>h2{padding:14px 16px 0}
details.acao{border-top:1px solid var(--linha)}
details.acao:first-of-type{border-top:0}
details.acao summary{list-style:none;cursor:pointer;padding:12px 16px;font-weight:700;color:var(--tinta);display:flex;align-items:center;gap:8px}
details.acao summary::-webkit-details-marker{display:none}
details.acao summary:after{content:"›";margin-left:auto;color:var(--suave);transition:transform .15s;font-size:18px;line-height:1}
details.acao[open] summary:after{transform:rotate(90deg)}
details.acao summary .mini{font-weight:500}
details.acao .corpo{padding:0 16px 14px}
form.f{display:flex;flex-direction:column;gap:8px}
form.f .lado{display:flex;gap:8px}
form.f .lado>*{flex:1}
form.f label{font-size:12px;font-weight:700;color:var(--suave);display:flex;flex-direction:column;gap:4px}
form.f label.marcar{flex-direction:row;align-items:center;gap:8px;font-weight:600;color:var(--texto)}
form.inline{display:flex;gap:6px;align-items:center}
form.inline input[name=motivo]{width:220px}
.dica{font-size:12px;color:var(--suave);margin:0}
.secao{background:var(--cartao);border:1px solid var(--linha);border-radius:var(--raio);box-shadow:var(--sombra)}
.secao>header{display:flex;align-items:center;gap:10px;padding:14px 16px 0}
.secao>header h2{margin:0}
.secao>header .mini{margin-left:auto}
.secao .tabela-caixa{border:0;box-shadow:none;border-radius:0 0 var(--raio) var(--raio);margin-top:10px}
.secao .vazio{padding:18px}
.livro li{padding:8px 0;border-bottom:1px solid var(--linha);list-style:none}
.livro{margin:0;padding:6px 16px 10px}
.livro li:last-child{border-bottom:0}
.livro .acao{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--azul)}
.operador{background:var(--ambar-2);border:1px solid #f3d38a;border-radius:10px;padding:12px 14px;margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.operador form{display:flex;gap:8px}
.quem{display:flex;align-items:center;gap:6px}
.quem form{display:inline}
.quem button{background:transparent;color:#c9d3f0;padding:2px 6px;font-weight:600;border:1px solid rgba(255,255,255,.2)}
.erro-pagina{max-width:520px;margin:12vh auto;background:#fff;border:1px solid var(--linha);border-radius:14px;padding:28px;text-align:center;box-shadow:var(--sombra)}
.link-aviso{margin-top:10px}
.empurra{margin-left:auto}
.abaixo{margin-bottom:12px}
hr{border:0;border-top:1px dashed var(--linha);margin:12px 0}
${Array.from({ length: 21 }, (_, i) => `.barra b.p${i * 5}{width:${i * 5}%}`).join('')}
@media (max-width:1180px){.cartoes{grid-template-columns:repeat(3,minmax(0,1fr))}.grade{grid-template-columns:1fr}.acoes{position:static;max-height:none}}
@media (max-width:760px){.cartoes,.tres{grid-template-columns:1fr 1fr}input[type=search]{width:100%}}
`
