// Confirmation page — this is where the lead is actually created.
// quiz.js hands off the answers via sessionStorage and navigates here
// immediately on submit, so the visitor sees the confirmation right away.
// Only once THIS page has loaded do we call the n8n webhook, which writes
// the CRM row and pings Slack. No calendar event or meeting link is created
// here anymore — Marta (the AI voice agent) calls the lead a couple of
// minutes later and books the actual evaluation call herself.

const QUIZ_WEBHOOK_URL = "https://backend.automationbig8agency.com/webhook/decisao-ponderada-quiz";

document.getElementById('year').textContent = new Date().getFullYear();

const glow = document.getElementById('cursorGlow');
if (glow) {
  window.addEventListener('mousemove', (e) => {
    glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%,-50%)`;
  }, { passive: true });
}

const successMsg = document.getElementById('successMessage');
const nextSteps = document.getElementById('nextSteps');

const stored = sessionStorage.getItem('luminova_booking_answers');
sessionStorage.removeItem('luminova_booking_answers');

let answers = null;
try { answers = stored ? JSON.parse(stored) : null; } catch (err) { answers = null; }

if (!answers) {
  // Someone landed here directly without submitting the quiz.
  successMsg.innerHTML = 'Não encontrámos os detalhes do seu pedido nesta página. <a href="index.html">Volte ao início</a> para preencher o formulário.';
  nextSteps.style.display = 'none';
} else {
  // successMessage already shows "A confirmar os detalhes..." as its default HTML.
  fetch(QUIZ_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answers)
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('bad status');
      successMsg.innerHTML = `Obrigado, <strong>${answers.name || ''}</strong>! A Marta vai ligar-lhe dentro de cerca de 2 minutos para o número que indicou.`;
    })
    .catch((err) => {
      console.error('Lead submission error:', err);
      successMsg.innerHTML = 'Não foi possível registar o seu pedido agora. Contacte-nos por telefone (918 675 150) e falamos consigo diretamente.';
      nextSteps.style.display = 'none';
    });
}
