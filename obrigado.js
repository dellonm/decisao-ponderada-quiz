// Confirmation page — this is where the booking actually happens.
// quiz.js hands off the answers via sessionStorage and navigates here
// immediately on submit, so the visitor sees the confirmation + "what
// happens next" instructions right away. Only once THIS page has loaded
// do we call the n8n webhook, which sends the email, creates the calendar
// invite, starts the reminder sequence, writes the CRM row, and pings Slack.

const QUIZ_WEBHOOK_URL = "https://backend.automationbig8agency.com/webhook/decisao-ponderada-quiz";

document.getElementById('year').textContent = new Date().getFullYear();

const glow = document.getElementById('cursorGlow');
if (glow) {
  window.addEventListener('mousemove', (e) => {
    glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%,-50%)`;
  }, { passive: true });
}

function toUtcCompact(dateObj) {
  return dateObj.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildCalendarButtonsHtml(scheduledSlotIso, meetLink) {
  const start = new Date(scheduledSlotIso);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const title = 'Chamada de Avaliação — Luminova Energia';
  const details = meetLink
    ? `Chamada de avaliação solar com a Luminova Energia.\\n\\nEntrar na chamada: ${meetLink}`
    : 'Chamada de avaliação solar com a Luminova Energia.';
  const location = meetLink || '';

  const googleUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + encodeURIComponent(title)
    + '&dates=' + toUtcCompact(start) + '/' + toUtcCompact(end)
    + '&details=' + encodeURIComponent(details)
    + '&location=' + encodeURIComponent(location);

  const icsBody = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Luminova Energia//Quiz//PT', 'BEGIN:VEVENT',
    'UID:' + Date.now() + '@luminovaenergia',
    'DTSTAMP:' + toUtcCompact(new Date()),
    'DTSTART:' + toUtcCompact(start),
    'DTEND:' + toUtcCompact(end),
    'SUMMARY:' + title,
    'DESCRIPTION:' + details.replace(/\n/g, '\\n'),
    'LOCATION:' + location,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const icsUrl = 'data:text/calendar;charset=utf8,' + encodeURIComponent(icsBody);

  return `
    <a href="${googleUrl}" target="_blank" rel="noopener" class="btn btn-ghost">📅 Adicionar ao Google Calendar</a>
    <a href="${icsUrl}" download="chamada-luminova-energia.ics" class="btn btn-ghost">⬇️ Descarregar .ics (Outlook / Apple)</a>
  `;
}

const successMsg = document.getElementById('successMessage');
const nextSteps = document.getElementById('nextSteps');

const stored = sessionStorage.getItem('luminova_booking_answers');
sessionStorage.removeItem('luminova_booking_answers');

let answers = null;
try { answers = stored ? JSON.parse(stored) : null; } catch (err) { answers = null; }

if (!answers) {
  // Someone landed here directly without a booking — don't show a broken/empty state.
  successMsg.innerHTML = 'Não encontrámos os detalhes da sua chamada nesta página. Se já agendou, verifique o seu email — se ainda não agendou, <a href="index.html">volte ao início</a> para marcar.';
  nextSteps.style.display = 'none';
} else {
  // successMessage already shows "A confirmar os detalhes..." as its default HTML.
  fetch(QUIZ_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answers)
  })
    .then(async (res) => {
      const result = await res.json().catch(() => ({}));

      if (!res.ok || result.status === 'conflict') {
        successMsg.innerHTML = 'Esse horário acabou de ficar indisponível ou não foi possível confirmar. <a href="index.html">Escolha outro horário</a> ou ligue-nos diretamente.';
        nextSteps.style.display = 'none';
        return;
      }

      const slot = result.scheduledSlot || answers.scheduled_slot;
      const meet = result.meetLink || '';
      const label = answers.scheduled_slot_label || '';
      const email = answers.email || '';

      if (meet) {
        successMsg.innerHTML = `A sua chamada está confirmada para <strong>${label}</strong>. Enviámos o convite (com o link do Google Meet) para <strong>${email}</strong>.`;
      } else {
        successMsg.innerHTML = `Obrigado! A sua chamada ficou registada para <strong>${label}</strong>. Um elemento da nossa equipa confirma consigo em breve.`;
      }

      if (slot) {
        document.getElementById('spamNote').style.display = 'block';
        const calActions = document.getElementById('calActions');
        calActions.style.display = 'flex';
        calActions.innerHTML = buildCalendarButtonsHtml(slot, meet);
      }
    })
    .catch((err) => {
      console.error('Booking confirmation error:', err);
      successMsg.innerHTML = 'Não foi possível confirmar a sua chamada agora. Contacte-nos por telefone (918 675 150) e confirmamos consigo diretamente.';
      nextSteps.style.display = 'none';
    });
}
