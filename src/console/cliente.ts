// O único script da página, servido de /console.js (a política de conteúdo
// não aceita script embutido nem `onsubmit=`). Faz uma coisa: pergunta
// "tem certeza?" antes de qualquer formulário que muda dado, com o resumo
// escrito no próprio formulário (`data-confirmar`).

export const SCRIPT = `
document.addEventListener('submit', function (e) {
  var f = e.target;
  if (!(f instanceof HTMLFormElement)) return;
  var texto = f.getAttribute('data-confirmar');
  if (!texto) return;
  var motivo = f.querySelector('[name=motivo]');
  var msg = texto + (motivo && motivo.value ? '\\n\\nMotivo: ' + motivo.value : '');
  if (!window.confirm(msg)) { e.preventDefault(); return; }
  var b = f.querySelector('button[type=submit],button:not([type])');
  if (b) { setTimeout(function () { b.disabled = true; b.textContent = 'Aplicando...'; }, 0); }
});
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!(t instanceof HTMLElement) || !t.hasAttribute('data-copiar')) return;
  var alvo = document.getElementById(t.getAttribute('data-copiar'));
  if (!alvo || !navigator.clipboard) return;
  navigator.clipboard.writeText(alvo.textContent || '').then(function () { t.textContent = 'Copiado'; });
});
`
