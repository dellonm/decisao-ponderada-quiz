// Tailored lead-qualification quiz — Decisão Ponderada
// Step 2 asks what the lead needs mapped 1:1 to the real product catalog (kits,
// batteries, inverters, EV chargers, mounting structures) — step 3 then asks a
// couple of quick, category-specific qualifying questions instead of a generic form.
// Posts to the n8n webhook, which re-derives price ranges from the real catalog
// bands server-side and writes to the Notion CRM.

const QUIZ_WEBHOOK_URL = "https://backend.automationbig8agency.com/webhook/decisao-ponderada-quiz";

// Cursor glow (kept from the main site's visual language)
const glow = document.getElementById('cursorGlow');
if (glow) {
  window.addEventListener('mousemove', (e) => {
    glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%,-50%)`;
  }, { passive: true });
}

// ---- Price estimate — mirrors the n8n "Validate + Score Lead" Code node exactly ----
// Ranges are pulled from the real catalog price bands (see products-data.js on the main site).
function computeEstimate(a) {
  if (a.interest === 'Inversor') {
    return { tier: 'Inversor', range: '877€ – 1.163€ (inversores híbridos Deye, 3kW a 5kW)' };
  }
  if (a.interest === 'Carregador EV') {
    return { tier: 'Carregador EV', range: '549€ – 1.199€ (carregadores wallbox 7.4kW a 22kW)' };
  }
  if (a.interest === 'Estrutura') {
    return { tier: 'Estrutura', range: '189€ – 219€ (estrutura de fixação, por conjunto)' };
  }
  if (a.interest === 'Bateria') {
    return { tier: 'Personalizado', range: '3.000€ – 9.900€ (consoante a capacidade e o sistema existente)' };
  }
  if (a.property_type === 'Comercial' && a.household === 'Grande negocio (20+)') {
    return { tier: 'Personalizado', range: 'Dimensionamento à medida' };
  }
  // Kit Solar Completo / Ainda não sei — estimate from appliance/household/bill signals
  let score = 0;
  const fridgesNum = a.fridges === '3+' ? 3 : (parseInt(a.fridges, 10) || 0);
  score += Math.min(fridgesNum, 2);

  const weights = a.property_type === 'Comercial'
    ? { 'Camaras Frigorificas': 2, 'Climatizacao Comercial': 2, 'Maquinaria': 2, 'Iluminacao Intensiva': 1, 'Equipamento Informatico': 1 }
    : { 'Ar Condicionado': 2, 'Termoacumulador Eletrico': 1, 'Piscina': 2, 'Carro Eletrico': 2, 'Maquina Lavar/Secar': 1, 'Arca Congeladora': 1 };
  (a.appliances || []).forEach(x => { score += weights[x] || 0; });

  const householdWeights = { '1-2 pessoas': 0, '3-4 pessoas': 1, '5+ pessoas': 2, 'Pequeno negocio (1-5)': 0, 'Medio negocio (5-20)': 2, 'Grande negocio (20+)': 4 };
  score += householdWeights[a.household] || 0;

  const billNum = parseFloat((a.current_bill || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
  if (billNum > 150) score += 2;
  else if (billNum > 100) score += 1;

  if (score <= 2) return { tier: 'Pequeno', range: '3.200€ – 3.800€ (kits ~12 kWh/dia)' };
  if (score <= 6) return { tier: 'Medio', range: '3.000€ – 5.600€ (kits ~20 kWh/dia)' };
  return { tier: 'Grande', range: '5.000€ – 9.900€ (kits ~30 kWh/dia)' };
}

const TIER_LABEL = {
  Pequeno: 'Perfil Pequeno', Medio: 'Perfil Médio', Grande: 'Perfil Grande',
  Personalizado: 'Sob Medida', Inversor: 'Inversor', 'Carregador EV': 'Carregador EV', Estrutura: 'Estrutura'
};

const INTEREST_EXPLAIN = {
  'Kit Solar Completo': 'Este é o intervalo típico de investimento para um kit completo — painéis, inversor e bateria de lítio — ajustado ao que descreveu.',
  'Ainda nao sei': 'Este é o intervalo típico para o perfil que descreveu — a nossa equipa ajuda-o a escolher a opção certa na chamada de avaliação.',
  'Bateria': 'A bateria certa depende do sistema solar que já tem instalado — este é o intervalo típico consoante a capacidade necessária.',
  'Inversor': 'Preço de catálogo para os nossos inversores híbridos Deye, consoante a potência do seu sistema.',
  'Carregador EV': 'Preço de catálogo para os nossos carregadores wallbox, consoante a velocidade de carregamento pretendida.',
  'Estrutura': 'Preço por conjunto de estrutura de fixação, consoante o tipo de cobertura.'
};

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

  if (!form) return;

  const steps = Array.from(form.querySelectorAll('.quiz-step'));
  const totalSteps = steps.length;
  let currentStep = 1;

  const answers = {
    property_type: null,
    interest: null,
    fridges: '1',
    appliances: [],
    household: null,
    battery_has_panels: null,
    battery_inverter_brand: null,
    inverter_reason: null,
    inverter_power: null,
    charger_type: null,
    charger_has_solar: null,
    structure_roof_type: null,
    structure_panel_count: null,
    address: '',
    concelho: '',
    current_bill: '',
    budget: null,
    timeline: null,
    owner: null,
    motivations: [],
    note: '',
    call_preference: null,
    wants_call: true,
    name: '',
    phone: '',
    email: '',
    campaign: '',
    ad: ''
  };

  const params = new URLSearchParams(location.search);
  answers.campaign = params.get('utm_campaign') || params.get('campaign') || '';
  answers.ad = params.get('utm_content') || params.get('ad') || params.get('fbclid') || '';

  function showStep(n) {
    steps.forEach(s => s.classList.toggle('active', parseInt(s.dataset.step, 10) === n));
    progressFill.style.width = `${(n / totalSteps) * 100}%`;
    stepLabel.textContent = `Passo ${n} de ${totalSteps}`;
    backBtn.style.visibility = n === 1 ? 'hidden' : 'visible';
    window.scrollTo({ top: form.offsetTop - 100, behavior: 'smooth' });

    if (n === 3) setupCapacityStep();
    if (n === 6) setupPriceReveal();
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

  // ---- Step 3: branch by product interest ----
  const capPanels = {
    'Kit Solar Completo': null, // resolved to residential/commercial below
    'Ainda nao sei': null,
    'Bateria': document.getElementById('capBattery'),
    'Inversor': document.getElementById('capInverter'),
    'Carregador EV': document.getElementById('capCharger'),
    'Estrutura': document.getElementById('capStructure')
  };
  const capResidential = document.getElementById('capResidential');
  const capCommercial = document.getElementById('capCommercial');
  const allCapPanels = [capPanels['Bateria'], capPanels['Inversor'], capPanels['Carregador EV'], capPanels['Estrutura'], capResidential, capCommercial];
  const capTitle = document.getElementById('capTitle');
  const capSub = document.getElementById('capSub');

  const CAP_COPY = {
    'Bateria': { title: 'Só mais duas perguntas rápidas', sub: 'Isto ajuda-nos a perceber a compatibilidade com o seu sistema atual.' },
    'Inversor': { title: 'Vamos perceber o seu sistema', sub: 'Duas perguntas rápidas sobre o inversor que precisa.' },
    'Carregador EV': { title: 'Vamos escolher o carregador certo', sub: 'Duas perguntas rápidas sobre o carregamento do seu carro.' },
    'Estrutura': { title: 'Vamos perceber a instalação', sub: 'Duas perguntas rápidas sobre a cobertura e o número de painéis.' }
  };

  function activeCapPanel() {
    if (answers.interest === 'Bateria') return capPanels['Bateria'];
    if (answers.interest === 'Inversor') return capPanels['Inversor'];
    if (answers.interest === 'Carregador EV') return capPanels['Carregador EV'];
    if (answers.interest === 'Estrutura') return capPanels['Estrutura'];
    return answers.property_type === 'Comercial' ? capCommercial : capResidential;
  }

  function setupCapacityStep() {
    allCapPanels.forEach(el => el.style.display = 'none');
    const panel = activeCapPanel();
    panel.style.display = 'block';

    const copy = CAP_COPY[answers.interest];
    if (copy) {
      capTitle.textContent = copy.title;
      capSub.textContent = copy.sub;
    } else if (answers.property_type === 'Comercial') {
      capTitle.textContent = 'O que tem no seu negócio?';
      capSub.textContent = 'Só o essencial — isto dá-nos uma ideia rápida do consumo.';
    } else {
      capTitle.textContent = 'O que tem em casa?';
      capSub.textContent = 'Só o essencial — isto dá-nos uma ideia rápida do seu consumo.';
    }
  }

  // fridge stepper
  const fridgeStepper = document.getElementById('fridgeStepper');
  const fridgeValue = document.getElementById('fridgeValue');
  let fridgeCount = 1;
  fridgeStepper.querySelectorAll('.stepper-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = parseInt(btn.dataset.dir, 10);
      fridgeCount = Math.max(0, Math.min(4, fridgeCount + dir));
      fridgeValue.textContent = fridgeCount >= 4 ? '3+' : String(fridgeCount);
    });
  });

  // selections inside step 3 (scoped to whichever panel is visible; single/multi)
  form.querySelectorAll('.quiz-step[data-step="3"] .quiz-options').forEach(group => {
    const isMulti = group.dataset.multi === 'true';
    group.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isMulti) {
          btn.classList.toggle('selected');
          return;
        }
        group.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  });

  document.getElementById('capNext').addEventListener('click', () => {
    const panel = activeCapPanel();
    const groups = panel.querySelectorAll('[data-field]');
    let missing = null;

    groups.forEach(group => {
      const field = group.dataset.field;
      const isMulti = group.dataset.multi === 'true';
      if (isMulti) {
        answers[field] = Array.from(group.querySelectorAll('.quiz-option.selected')).map(b => b.dataset.value);
      } else {
        const selected = group.querySelector('.quiz-option.selected');
        if (!selected && !missing) missing = group;
        answers[field] = selected ? selected.dataset.value : null;
      }
    });

    if (panel === capResidential) {
      answers.fridges = fridgeCount >= 4 ? '3+' : String(fridgeCount);
    } else {
      answers.fridges = '0';
    }

    if (missing) {
      missing.classList.add('shake');
      setTimeout(() => missing.classList.remove('shake'), 400);
      return;
    }
    goNext();
  });

  // ---- Step 6: price reveal ----
  function setupPriceReveal() {
    const { tier, range } = computeEstimate(answers);
    answers.shown_range = range;
    document.getElementById('priceTier').textContent = TIER_LABEL[tier] || tier;
    document.getElementById('priceRange').textContent = range;
    document.getElementById('priceExplain').textContent = INTEREST_EXPLAIN[answers.interest] || INTEREST_EXPLAIN['Ainda nao sei'];
  }

  // ---- Generic single/multi-select option buttons (steps 1, 2, 7, 8, 9, 10, 11) ----
  form.querySelectorAll('.quiz-step:not([data-step="3"]) .quiz-options').forEach(group => {
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
          return;
        }

        group.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        answers[field] = value;

        // auto-advance single-select steps, except call_preference which sits above contact fields
        if (field !== 'call_preference') {
          setTimeout(goNext, 280);
        }
      });
    });
  });

  // ---- "Continuar" buttons for text-input / multi-select / info steps ----
  form.querySelectorAll('.quiz-next').forEach(btn => {
    btn.addEventListener('click', () => {
      const stepEl = btn.closest('.quiz-step');
      const stepNum = parseInt(stepEl.dataset.step, 10);

      if (stepNum === 4) {
        const address = document.getElementById('address').value.trim();
        if (!address) {
          document.getElementById('address').focus();
          return;
        }
        answers.address = address;
        answers.concelho = document.getElementById('concelho').value.trim();
      }

      if (stepNum === 5) {
        answers.current_bill = document.getElementById('current_bill').value.trim();
      }

      if (stepNum === 10) {
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

    if (!answers.name || !answers.phone || !answers.email || !answers.call_preference) {
      if (!answers.call_preference) {
        const callGroup = form.querySelector('[data-field="call_preference"]');
        callGroup.classList.add('shake');
        setTimeout(() => callGroup.classList.remove('shake'), 400);
      }
      return;
    }

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
      console.error('Quiz submission error:', err);
    }

    const callLabels = { 'Manha': 'manhã', 'Tarde': 'tarde', 'Fim do dia': 'fim do dia', 'Qualquer altura': 'qualquer altura' };
    const successMsg = document.getElementById('successMessage');
    if (successMsg) {
      successMsg.innerHTML = `Obrigado! Um elemento da nossa equipa vai enviar-lhe uma <strong>mensagem</strong> e um <strong>email</strong> durante a ${callLabels[answers.call_preference] || 'próxima janela disponível'} para agendar a chamada de avaliação. Se decidir avançar, marcamos também a visita técnica ao local.`;
    }

    form.style.display = 'none';
    success.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
