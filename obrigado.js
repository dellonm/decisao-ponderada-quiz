// Standalone "thank you" page — receives the booking result via query params
// from quiz.js so this page never has to call the backend itself.

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

const params = new URLSearchParams(window.location.search);
const slot = params.get('slot');
const meet = params.get('meet') || '';
const label = params.get('label') || '';
const email = params.get('email') || '';

const successMsg = document.getElementById('successMessage');
if (!slot) {
  // Someone landed here directly without a booking — don't show a broken/empty state.
  successMsg.innerHTML = 'Não encontrámos os detalhes da sua chamada nesta página. Se já agendou, verifique o seu email — se ainda não agendou, <a href="index.html">volte ao início</a> para marcar.';
  document.getElementById('nextSteps').style.display = 'none';
} else if (meet) {
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
