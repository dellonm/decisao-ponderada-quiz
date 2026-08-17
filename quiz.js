// Standalone lead-qualification quiz — Decisão Ponderada
// Self-contained: no shared nav/partials, this page has one job.
// Posts to the n8n webhook, which validates, scores urgency and writes to the Notion CRM.

const QUIZ_WEBHOOK_URL = "https://backend.automationbig8agency.com/webhook/decisao-ponderada-quiz";

// Cursor glow (kept from the main site's visual language)
const glow = document.getElementById('cursorGlow');
if (glow) {
  window.addEventListener('mousemove', (e) => {
    glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%,-50%)`;
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const intro = document.getElementById('quizIntro');
  const form = document.getElementById('quizForm');
  const success = document.getElementById('quizSuccess');
  const startBtn = document.getElementById('startQuiz');
  const backBtn = document.getElementById('quizBack');
  const progressFill = document.getElementById('progressFill');
  const stepLabel = document.getElementById('stepLabel');
  const urgencyRecap = document.getElementById('urgencyRecap');

  if (!form) return;

  const steps = Array.from(form.querySelectorAll('.quiz-step'));
  const totalSteps = steps.length;
  let currentStep = 1;

  const answers = {
    property_type: null,
    budget: null,
    address: '',
    concelho: '',
    current_bill: '',
    timeline: null,
    owner: null,
    motivations: [],
    note: '',
    name: '',
    phone: '',
    email: '',
    campaign: '',
    ad: ''
  };

  // Capture ad tracking params so the CRM can attribute the lead to a campaign.
  const params = new URLSearchParams(location.search);
  answers.campaign = params.get('utm_campaign') || params.get('campaign') || '';
  answers.ad = params.get('utm_content') || params.get('ad') || params.get('fbclid') || '';

  function showStep(n) {
    steps.forEach(s => s.classList.toggle('active', parseInt(s.dataset.step, 10) === n));
    progressFill.style.width = `${(n / totalSteps) * 100}%`;
    stepLabel.textContent = `Passo ${n} de ${totalSteps}`;
    backBtn.style.visibility = n === 1 ? 'hidden' : 'visible';
    window.scrollTo({ top: form.offsetTop - 100, behavior: 'smooth' });
  }

  function goNext() {
    if (currentStep < totalSteps) {
      currentStep++;
      showStep(currentStep);
    }
  }

  function goBack() {
    if (currentStep > 1) {
      currentStep--;
      showStep(currentStep);
    }
  }

  startBtn.addEventListener('click', () => {
    intro.style.display = 'none';
    form.style.display = 'block';
    showStep(1);
  });

  backBtn.addEventListener('click', goBack);

  // Single/multi-select option buttons
  form.querySelectorAll('.quiz-options').forEach(group => {
    const field = group.dataset.field;
    const isMulti = group.dataset.multi === 'true';

    group.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value;

        if (isMulti) {
          btn.classList.toggle('selected');
          const idx = answers.motivations.indexOf(value);
          if (btn.classList.contains('selected') && idx === -1) {
            answers.motivations.push(value);
          } else if (!btn.classList.contains('selected') && idx > -1) {
            answers.motivations.splice(idx, 1);
          }
          return; // multi-select steps advance via their own "Continuar" button
        }

        group.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        answers[field] = value;

        if (field === 'timeline' && urgencyRecap) {
          const messages = {
            'Imediato (0-1 mes)': 'Vimos que quer avançar já — vamos tratar o seu pedido com prioridade máxima.',
            '1-3 meses': 'A nossa equipa vai reservar uma janela de instalação dentro do seu prazo.',
            '3-6 meses': 'Vamos preparar a proposta com antecedência para garantir a sua vaga.',
            'So a pesquisar': 'Sem problema — enviamos toda a informação para decidir com calma.'
          };
          urgencyRecap.textContent = messages[value] || urgencyRecap.textContent;
        }

        // auto-advance single-select steps after a short delay for visual feedback
        setTimeout(goNext, 280);
      });
    });
  });

  // "Continuar" buttons for text-input / multi-select steps
  form.querySelectorAll('.quiz-next').forEach(btn => {
    btn.addEventListener('click', () => {
      const stepEl = btn.closest('.quiz-step');
      const stepNum = parseInt(stepEl.dataset.step, 10);

      if (stepNum === 3) {
        const address = document.getElementById('address').value.trim();
        if (!address) {
          document.getElementById('address').focus();
          return;
        }
        answers.address = address;
        answers.concelho = document.getElementById('concelho').value.trim();
      }

      if (stepNum === 4) {
        answers.current_bill = document.getElementById('current_bill').value.trim();
      }

      if (stepNum === 7) {
        if (answers.motivations.length === 0) {
          stepEl.querySelector('.quiz-options').classList.add('shake');
          setTimeout(() => stepEl.querySelector('.quiz-options').classList.remove('shake'), 400);
          return;
        }
        const noteEl = document.getElementById('quiz_note');
        answers.note = noteEl ? noteEl.value.trim() : '';
      }

      goNext();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    answers.name = document.getElementById('qname').value.trim();
    answers.phone = document.getElementById('qphone').value.trim();
    answers.email = document.getElementById('qemail').value.trim();

    if (!answers.name || !answers.phone || !answers.email) return;

    const submitBtn = document.getElementById('submitQuiz');
    submitBtn.disabled = true;
    submitBtn.textContent = 'A enviar...';

    try {
      await fetch(QUIZ_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers)
      });
    } catch (err) {
      // Network hiccup shouldn't block the user from seeing a confirmation —
      // the phone/email are still valid ways for the team to follow up manually if needed.
      console.error('Quiz submission error:', err);
    }

    form.style.display = 'none';
    success.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
