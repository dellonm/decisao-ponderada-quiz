// Tailored lead-qualification quiz — Luminova Energia
// Step 2 asks what the lead needs mapped 1:1 to the real product catalog. Step 3
// asks a couple of professional, strategic qualifying questions per category —
// consumption pattern and critical-load autonomy needs, not appliance counts.
// Posts to the n8n webhook, which re-derives price ranges from the real catalog
// bands server-side and writes to the Notion CRM.

const QUIZ_WEBHOOK_URL = "https://backend.automationbig8agency.com/webhook/decisao-ponderada-quiz";
const AVAILABILITY_URL = "https://backend.automationbig8agency.com/webhook/luminova-availability";

// Cursor glow (kept from the main site's visual language)
const glow = document.getElementById('cursorGlow');
if (glow) {
  window.addEventListener('mousemove', (e) => {
    glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%,-50%)`;
  }, { passive: true });
}

// ---- Price estimate — mirrors the n8n "Validate + Score Lead" Code node exactly ----
function computeEstimate(a) {
  const noRoofAccess = a.property_type === 'Apartamento' && a.roof_access === 'Sem acesso';

  if (a.interest === 'Inversor') {
    return { tier: 'Inversor', range: '877€ – 1.163€ (inversores híbridos Deye, 3kW a 5kW)' };
  }
  if (a.interest === 'Carregador EV') {
    return { tier: 'Carregador EV', range: '549€ – 1.199€ (carregadores wallbox 7.4kW a 22kW)' };
  }
  if (a.interest === 'Estrutura' && !noRoofAccess) {
    return { tier: 'Estrutura', range: '189€ – 219€ (estrutura de fixação, por conjunto)' };
  }
  if (a.interest === 'Bateria') {
    return { tier: 'Personalizado', range: '3.000€ – 9.900€ (consoante a capacidade e o sistema existente)' };
  }
  if (noRoofAccess) {
    return { tier: 'Personalizado', range: 'Sem telhado/terraço próprio — avaliamos alternativas (bateria, carregador EV) após contacto' };
  }
  if (a.property_type === 'Comercial' && a.household === 'Grande negocio (20+)') {
    return { tier: 'Personalizado', range: 'Dimensionamento à medida' };
  }

  // Kit Solar Completo / Ainda não sei — estimate from consumption pattern + autonomy + household + bill
  let score = 0;
  const autonomyCount = (a.autonomy_needs || []).filter(x => x !== 'Nao precisa de autonomia').length;
  score += Math.min(autonomyCount, 3);

  if (a.consumption_pattern === 'Ao fim do dia e noite') score += 2;
  else if (a.consumption_pattern === 'Distribuido ao longo do dia') score += 1;

  const householdWeights = { '1-2 pessoas': 0, '3-4 pessoas': 1, '5+ pessoas': 2, 'Pequeno negocio (1-5)': 0, 'Medio negocio (5-20)': 2, 'Grande negocio (20+)': 4 };
  score += householdWeights[a.household] || 0;

  if (a.property_type === 'Comercial') {
    const weights = { 'Camaras Frigorificas': 2, 'Climatizacao Comercial': 2, 'Maquinaria': 2, 'Iluminacao Intensiva': 1, 'Equipamento Informatico': 1 };
    (a.appliances || []).forEach(x => { score += weights[x] || 0; });
  }

  if (a.ev_interest === 'Ja tenho' || a.ev_interest === 'Vou comprar em breve') score += 2;

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
    roof_access: null,
    interest: null,
    appliances: [],
    household: null,
    consumption_pattern: null,
    autonomy_needs: [],
    ev_interest: null,
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
    scheduled_slot: null,
    scheduled_slot_label: '',
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

    if (n === 2) setupInterestStep();
    if (n === 3) setupCapacityStep();
    if (n === 6) setupPriceReveal();
    if (n === 11) loadSlots();
  }

  // Single-select steps auto-advance after a short delay so the user sees their
  // choice highlight before moving on. That delay is cancellable — if "Voltar" is
  // tapped in that window, the pending auto-advance must not fire afterwards and
  // silently undo the back navigation.
  let advanceTimer = null;
  function scheduleAdvance(delay = 280) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(goNext, delay);
  }

  function goNext() {
    clearTimeout(advanceTimer);
    if (currentStep < totalSteps) {
      currentStep++;
      showStep(currentStep);
    }
  }

  function goBack() {
    clearTimeout(advanceTimer);
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

  // ---- Step 1: property type + conditional roof-access follow-up for apartments ----
  const roofAccessField = document.getElementById('roofAccessField');
  const step1Group = form.querySelector('.quiz-step[data-step="1"] [data-field="property_type"]');
  step1Group.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => {
      step1Group.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      answers.property_type = btn.dataset.value;

      if (btn.dataset.value === 'Apartamento') {
        roofAccessField.style.display = 'block';
        roofAccessField.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        roofAccessField.style.display = 'none';
        answers.roof_access = null;
        scheduleAdvance();
      }
    });
  });
  roofAccessField.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => {
      roofAccessField.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      answers.roof_access = btn.dataset.value;
      scheduleAdvance();
    });
  });

  // ---- Step 2: gray out options that don't fit an apartment with no roof access ----
  const interestGroup = form.querySelector('.quiz-step[data-step="2"] [data-field="interest"]');
  const interestNote = document.createElement('p');
  interestNote.className = 'quiz-step-sub';
  interestNote.style.marginTop = '14px';
  interestNote.style.display = 'none';
  interestGroup.insertAdjacentElement('afterend', interestNote);

  function setupInterestStep() {
    const noRoofAccess = answers.property_type === 'Apartamento' && answers.roof_access === 'Sem acesso';
    const restricted = ['Kit Solar Completo', 'Estrutura'];
    interestGroup.querySelectorAll('.quiz-option').forEach(btn => {
      const isRestricted = noRoofAccess && restricted.includes(btn.dataset.value);
      btn.disabled = isRestricted;
      btn.classList.toggle('quiz-option-disabled', isRestricted);
    });
    interestNote.style.display = noRoofAccess ? 'block' : 'none';
    interestNote.textContent = noRoofAccess
      ? 'Como não tem telhado ou terraço próprio, um kit completo ou estrutura de fixação exigem autorização do condomínio — mas pode avançar com uma bateria, um carregador ou pedir-nos uma recomendação.'
      : '';
  }

  // ---- Step 3: branch by product interest ----
  const capPanels = {
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
    'Bateria': { title: 'Só mais três perguntas rápidas', sub: 'Isto ajuda-nos a perceber a compatibilidade com o seu sistema atual.' },
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
      capTitle.textContent = 'Vamos perceber o seu negócio';
      capSub.textContent = 'Perguntas estratégicas para dimensionar o sistema certo.';
    } else {
      capTitle.textContent = 'Vamos perceber o seu consumo';
      capSub.textContent = 'Perguntas estratégicas para dimensionar o sistema certo — nada de contagens.';
    }
  }

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

  // ---- Generic single/multi-select option buttons (steps 2, 7, 8, 9, 10, 11) ----
  form.querySelectorAll('.quiz-step:not([data-step="1"]):not([data-step="3"]) .quiz-options').forEach(group => {
    const field = group.dataset.field;
    const isMulti = group.dataset.multi === 'true';

    group.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
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
          scheduleAdvance();
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

  // ---- Step 11: Calendly-style rolling slot picker ----
  const slotLoading = document.getElementById('slotLoading');
  const slotError = document.getElementById('slotError');
  const slotDayTabs = document.getElementById('slotDayTabs');
  const slotGrid = document.getElementById('slotGrid');
  const slotSelectedLabel = document.getElementById('slotSelectedLabel');
  const slotPicker = document.getElementById('slotPicker');
  let availability = null;
  let activeDayIndex = 0;

  async function loadSlots() {
    slotLoading.style.display = 'block';
    slotError.style.display = 'none';
    slotDayTabs.style.display = 'none';
    slotGrid.innerHTML = '';
    slotSelectedLabel.style.display = 'none';
    try {
      const res = await fetch(AVAILABILITY_URL);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      availability = (data && Array.isArray(data.days)) ? data.days : [];
      slotLoading.style.display = 'none';
      if (availability.length === 0) {
        slotGrid.innerHTML = '<p class="slot-none">Sem horários disponíveis de momento. Ligue-nos diretamente.</p>';
        return;
      }
      activeDayIndex = 0;
      renderDayTabs();
      renderSlotGrid();
    } catch (err) {
      console.error('Availability load error:', err);
      slotLoading.style.display = 'none';
      slotError.style.display = 'block';
    }
  }

  function renderDayTabs() {
    slotDayTabs.style.display = 'flex';
    slotDayTabs.innerHTML = '';
    availability.forEach((day, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'slot-day-tab' + (i === activeDayIndex ? ' active' : '');
      tab.innerHTML = `<span class="slot-day-name">${day.dayLabel}</span><span class="slot-day-date">${day.dateLabel}</span>`;
      tab.addEventListener('click', () => {
        activeDayIndex = i;
        renderDayTabs();
        renderSlotGrid();
      });
      slotDayTabs.appendChild(tab);
    });
  }

  function renderSlotGrid() {
    slotGrid.innerHTML = '';
    const day = availability[activeDayIndex];
    if (!day || day.slots.length === 0) {
      slotGrid.innerHTML = '<p class="slot-none">Sem horários neste dia.</p>';
      return;
    }
    day.slots.forEach(slot => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn' + (answers.scheduled_slot === slot.start ? ' selected' : '');
      btn.textContent = slot.label;
      btn.addEventListener('click', () => {
        answers.scheduled_slot = slot.start;
        answers.scheduled_slot_label = `${day.dayLabel}, ${day.dateLabel} às ${slot.label}`;
        renderSlotGrid();
        slotSelectedLabel.style.display = 'block';
        slotSelectedLabel.textContent = `Selecionado: ${answers.scheduled_slot_label}`;
        slotError.style.display = 'none';
      });
      slotGrid.appendChild(btn);
    });
  }

  document.getElementById('slotRetry').addEventListener('click', loadSlots);

  // The booking webhook (email, calendar invite, CRM write, Slack ping) is
  // deliberately NOT called here. We hand the answers to obrigado.html via
  // sessionStorage and navigate there immediately, so the visitor sees the
  // confirmation + "what happens next" instructions right away. obrigado.js
  // fires the actual booking call once that page has loaded.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    answers.name = document.getElementById('qname').value.trim();
    answers.phone = document.getElementById('qphone').value.trim();
    answers.email = document.getElementById('qemail').value.trim();

    if (!answers.scheduled_slot) {
      slotPicker.classList.add('shake');
      setTimeout(() => slotPicker.classList.remove('shake'), 400);
      slotError.style.display = 'block';
      slotError.innerHTML = '⬆️ Por favor selecione um horário acima antes de agendar a sua chamada.';
      slotPicker.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (!answers.name || !answers.phone || !answers.email) {
      return;
    }

    const submitBtn = document.getElementById('submitQuiz');
    submitBtn.disabled = true;
    submitBtn.textContent = 'A agendar...';

    sessionStorage.setItem('luminova_booking_answers', JSON.stringify(answers));
    window.location.href = 'obrigado.html';
  });
});
