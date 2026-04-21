'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  currentTab: 'dashboard',
  workouts:   [],
  weightLogs: [],
  goals:      { id: 'daily', dailyDistance: 3, dailyTime: 45 },
  editingWorkout: null,
  editingWeight:  null,
  charts: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  showLoading(true);
  await initDB();
  await loadAll();

  setupNav();
  setupFAB();
  setupModals();
  setupForms();
  setupExportImport();
  setupHistoryTabs();
  setupHistoryDelegation(); // SEC: event delegation replaces inline onclick
  setupStaticHandlers();    // SEC: replaces remaining inline onclick attributes

  renderDashboard();
  showLoading(false);

  // Handle Android PWA shortcut URL fragments (#workout, #weight)
  const fragment = window.location.hash;
  if (fragment === '#workout') { openWorkoutModal(); window.history.replaceState(null, '', './index.html'); }
  if (fragment === '#weight')  { openWeightModal();  window.history.replaceState(null, '', './index.html'); }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(err => console.warn('SW:', err));
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window._installPrompt = e;
    document.getElementById('install-banner')?.classList.remove('hidden');
  });

  document.getElementById('btn-install')?.addEventListener('click', async () => {
    if (window._installPrompt) {
      window._installPrompt.prompt();
      const { outcome } = await window._installPrompt.userChoice;
      if (outcome === 'accepted') document.getElementById('install-banner')?.classList.add('hidden');
    }
  });
});

async function loadAll() {
  [state.workouts, state.weightLogs, state.goals] = await Promise.all([
    getAllWorkouts(),
    getAllWeightLogs(),
    getGoals(),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.tab));
  });
}

function navigateTo(tab) {
  // Whitelist allowed tabs to prevent DOM clobbering via data-tab manipulation
  const ALLOWED_TABS = ['dashboard', 'history', 'charts', 'settings'];
  if (!ALLOWED_TABS.includes(tab)) return;

  state.currentTab = tab;

  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(el =>
    el.classList.toggle('active', el.id === `tab-${tab}`));

  switch (tab) {
    case 'dashboard': renderDashboard(); break;
    case 'history':   renderHistory();   break;
    case 'charts':    requestAnimationFrame(renderCharts); break;
    case 'settings':  renderSettings();  break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FAB
// ─────────────────────────────────────────────────────────────────────────────
function setupFAB() {
  const fab     = document.getElementById('fab');
  const fabMenu = document.getElementById('fab-menu');

  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = fabMenu.classList.toggle('open');
    fab.classList.toggle('open', open);
  });

  document.getElementById('fab-workout').addEventListener('click', () => {
    closeFAB(); openWorkoutModal();
  });
  document.getElementById('fab-weight').addEventListener('click', () => {
    closeFAB(); openWeightModal();
  });

  document.addEventListener('click', () => closeFAB());
}

function closeFAB() {
  document.getElementById('fab-menu').classList.remove('open');
  document.getElementById('fab').classList.remove('open');
}

// SEC: replaces all inline onclick="..." in index.html — no global function exposure needed
function setupStaticHandlers() {
  // Dashboard: Edit goals + See all
  document.getElementById('btn-edit-goals')?.addEventListener('click', openGoalsModal);
  document.getElementById('btn-see-all')?.addEventListener('click', () => navigateTo('history'));

  // Settings: rows that open goals modal (event delegation)
  document.getElementById('tab-settings')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="open-goals"]')) openGoalsModal();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────────────────────────────
function setupModals() {
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeAllModals();
    });
  });
  document.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', closeAllModals));
}

function openWorkoutModal(workout = null) {
  state.editingWorkout = workout;
  const form  = document.getElementById('workout-form');
  const title = document.getElementById('workout-modal-title');

  title.textContent = workout ? 'Edit Workout' : 'Log Workout';

  if (workout) {
    // SEC: set via .value (DOM property), never via innerHTML
    form.date.value     = sanitizeDateStr(workout.date);
    form.type.value     = ALLOWED_TYPES.includes(workout.type) ? workout.type : 'walking';
    form.distance.value = toFinitePositive(workout.distance);
    form.time.value     = toFinitePositive(workout.time);
    form.incline.value  = workout.incline != null ? toFinite(workout.incline) : '';
    form.notes.value    = String(workout.notes ?? '').slice(0, 500);
  } else {
    form.reset();
    form.date.value = todayISO();
  }

  updateSpeedPreview();
  document.getElementById('workout-modal').classList.add('open');
}

function openWeightModal(log = null) {
  state.editingWeight = log;
  const form  = document.getElementById('weight-form');
  const title = document.getElementById('weight-modal-title');

  title.textContent = log ? 'Edit Weight' : 'Log Weight';

  if (log) {
    form.date.value     = sanitizeDateStr(log.date);
    form.weightKg.value = toFinitePositive(log.weightKg);
  } else {
    form.reset();
    form.date.value = todayISO();
  }

  document.getElementById('weight-modal').classList.add('open');
}

function openGoalsModal() {
  const form = document.getElementById('goals-form');
  form.dailyDistance.value = toFinitePositive(state.goals.dailyDistance);
  form.dailyTime.value     = toFinitePositive(state.goals.dailyTime);
  document.getElementById('goals-modal').classList.add('open');
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  state.editingWorkout = null;
  state.editingWeight  = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMS
// ─────────────────────────────────────────────────────────────────────────────
function setupForms() {
  const wf = document.getElementById('workout-form');
  wf.addEventListener('input', updateSpeedPreview);
  wf.addEventListener('submit', async (e) => { e.preventDefault(); await saveWorkout(wf); });

  document.getElementById('weight-form').addEventListener('submit', async (e) => {
    e.preventDefault(); await saveWeight(e.target);
  });

  document.getElementById('goals-form').addEventListener('submit', async (e) => {
    e.preventDefault(); await saveGoals(e.target);
  });
}

function updateSpeedPreview() {
  const form = document.getElementById('workout-form');
  const d    = parseFloat(form.distance.value);
  const t    = parseFloat(form.time.value);
  const el   = document.getElementById('speed-preview');
  // SEC: use .textContent, never innerHTML; guard division-by-zero
  el.textContent = (isFinite(d) && d > 0 && isFinite(t) && t > 0)
    ? `Auto speed: ${calcSpeed(d, t)} mph`
    : '';
}

async function saveWorkout(form) {
  const d = parseFloat(form.distance.value);
  const t = parseFloat(form.time.value);

  // SEC: validate numeric inputs — reject NaN / Infinity / non-positive
  if (!isFinite(d) || d <= 0 || !isFinite(t) || t <= 0) {
    showToast('Distance and time must be positive numbers', true);
    return;
  }

  // SEC: validate date format strictly
  const date = form.date.value;
  if (!isValidDate(date)) { showToast('Invalid date', true); return; }

  // SEC: whitelist workout type
  const type = ALLOWED_TYPES.includes(form.type.value) ? form.type.value : 'walking';

  const inclineRaw = parseFloat(form.incline.value);
  const notesRaw   = form.notes.value.trim();

  const workout = {
    date,
    type,
    distance: d,
    time:     t,
    speed:    calcSpeed(d, t),
    ...(isFinite(inclineRaw) && inclineRaw >= 0 ? { incline: inclineRaw } : {}),
    ...(notesRaw ? { notes: notesRaw.slice(0, 500) } : {}),
  };

  if (state.editingWorkout) {
    await updateWorkout(state.editingWorkout.id, workout);
    showToast('Workout updated');
  } else {
    await addWorkout(workout);
    showToast('Workout logged!');
  }

  await loadAll();
  closeAllModals();
  renderDashboard();
  if (state.currentTab === 'history') renderHistory();
}

async function saveWeight(form) {
  const kg   = parseFloat(form.weightKg.value);
  const date = form.date.value;

  if (!isValidDate(date)) { showToast('Invalid date', true); return; }
  if (!isFinite(kg) || kg <= 0) { showToast('Weight must be a positive number', true); return; }

  const log = { date, weightKg: kg };

  if (state.editingWeight) {
    await updateWeightLog(state.editingWeight.id, log);
    showToast('Weight updated');
  } else {
    await addWeightLog(log);
    showToast('Weight logged!');
  }

  await loadAll();
  closeAllModals();
  renderDashboard();
  if (state.currentTab === 'history') renderHistory();
}

async function saveGoals(form) {
  const dist = parseFloat(form.dailyDistance.value);
  const time = parseFloat(form.dailyTime.value);

  if (!isFinite(dist) || dist < 0) { showToast('Invalid distance goal', true); return; }
  if (!isFinite(time) || time < 0) { showToast('Invalid time goal', true); return; }

  const goals = { id: 'daily', dailyDistance: dist, dailyTime: time };
  await updateGoals(goals);
  state.goals = goals;
  closeAllModals();
  renderDashboard();
  if (state.currentTab === 'settings') renderSettings();
  showToast('Goals saved!');
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function renderDashboard() {
  const today        = todayISO();
  const todayW       = state.workouts.filter(w => w.date === today);
  const todayDist    = todayW.reduce((s, w) => s + (Number(w.distance) || 0), 0);
  const todayTime    = todayW.reduce((s, w) => s + (Number(w.time) || 0), 0);
  const latestWeight = state.weightLogs[0];

  // SEC: all written via .textContent through setText(), never innerHTML
  setText('stat-distance', todayDist.toFixed(2));
  setText('stat-time', todayTime);
  setText('stat-weight', latestWeight ? `${Number(latestWeight.weightKg).toFixed(1)} kg` : '—');
  setText('stat-workouts', todayW.length);


  const goalDist = Number(state.goals.dailyDistance) || 1;
  const goalTime = Number(state.goals.dailyTime) || 1;
  const distPct  = Math.min((todayDist / goalDist) * 100, 100);
  const timePct  = Math.min((todayTime  / goalTime) * 100, 100);

  setStyle('progress-distance', 'width', `${distPct}%`);
  setStyle('progress-time',     'width', `${timePct}%`);
  setText('goal-distance-text', `${todayDist.toFixed(2)} / ${goalDist} mi`);
  setText('goal-time-text',     `${todayTime} / ${goalTime} min`);

  const wDelta = document.getElementById('weight-delta');
  if (state.weightLogs.length >= 2) {
    const a    = Number(state.weightLogs[0].weightKg);
    const b    = Number(state.weightLogs[1].weightKg);
    const diff = isFinite(a) && isFinite(b) ? (a - b).toFixed(1) : null;
    if (diff !== null) {
      wDelta.textContent = `${diff > 0 ? '+' : ''}${diff} kg vs prev`;
      wDelta.className   = `weight-delta ${diff <= 0 ? 'down' : 'up'}`;
    } else { wDelta.textContent = ''; }
  } else { wDelta.textContent = ''; }

  const streak = calcStreak();
  setText('streak-count', streak);

  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  setText('greeting', greeting);

  renderRecentWorkouts();
}

function renderRecentWorkouts() {
  const container = document.getElementById('recent-workouts');
  const recent    = state.workouts.slice(0, 5);

  if (!recent.length) {
    // SEC: static string — no user data — safe to use innerHTML
    container.innerHTML = '<p class="empty-state">No workouts yet — tap <strong>+</strong> to add one!</p>';
    return;
  }

  // SEC: all user data sanitized before interpolation into innerHTML
  container.innerHTML = recent.map(w => {
    const safeType = ALLOWED_TYPES.includes(w.type) ? w.type : 'walking';
    const dist     = safeNum(w.distance, 2);
    const time     = safeNum(w.time, 0);
    const speed    = safeNum(w.speed, 2);
    return `
      <div class="workout-row">
        <span class="badge ${safeType}">${escHtml(safeType)}</span>
        <span class="workout-row-date">${escHtml(fmtDate(sanitizeDateStr(w.date)))}</span>
        <span class="workout-row-stats">${dist} mi · ${time} min · ${speed} mph</span>
      </div>`;
  }).join('');
}

function calcStreak() {
  const dates = [...new Set(state.workouts.map(w => w.date))].sort().reverse();
  if (!dates.length) return 0;
  let streak = 0;
  const cur = new Date();
  cur.setHours(12, 0, 0, 0);
  for (const d of dates) {
    if (!isValidDate(d)) continue;
    const diff = Math.round((cur - new Date(d + 'T12:00:00')) / 86400000);
    if (diff === streak) streak++;
    else break;
  }
  return streak;
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────────────
function setupHistoryTabs() {
  document.querySelectorAll('.htab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchHistoryTab(btn.dataset.htab));
  });
}

// SEC: delegate all edit/delete actions — no inline onclick with user-controlled IDs
function setupHistoryDelegation() {
  document.getElementById('workout-history').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (typeof id !== 'string' || !id) return;
    if (btn.dataset.action === 'edit-workout')   editWorkout(id);
    if (btn.dataset.action === 'delete-workout') confirmDeleteWorkout(id);
  });

  document.getElementById('weight-history').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (typeof id !== 'string' || !id) return;
    if (btn.dataset.action === 'edit-weight')   editWeight(id);
    if (btn.dataset.action === 'delete-weight') confirmDeleteWeight(id);
  });
}

function switchHistoryTab(tab) {
  document.querySelectorAll('.htab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.htab === tab));
  document.querySelectorAll('.htab-panel').forEach(p =>
    p.classList.toggle('active', p.dataset.hpanel === tab));
}

function renderHistory() {
  renderWorkoutHistory();
  renderWeightHistory();
}

function renderWorkoutHistory() {
  const el = document.getElementById('workout-history');
  if (!state.workouts.length) {
    el.innerHTML = '<p class="empty-state">No workouts logged yet.</p>';
    return;
  }

  el.innerHTML = state.workouts.map(w => {
    // SEC: sanitize every field before interpolation
    const safeType = ALLOWED_TYPES.includes(w.type) ? w.type : 'walking';
    const safeId   = escAttr(String(w.id ?? ''));        // for data-id attribute
    const dateStr  = escHtml(fmtDate(sanitizeDateStr(w.date)));
    const dist     = safeNum(w.distance, 2);
    const time     = safeNum(w.time, 0);
    const speed    = safeNum(w.speed, 2);
    const incl     = w.incline != null ? safeNum(w.incline, 1) : null;
    const notes    = w.notes ? escHtml(String(w.notes).slice(0, 500)) : null;

    return `
      <div class="history-item">
        <div class="hi-main">
          <div class="hi-top">
            <span class="badge ${safeType}">${escHtml(safeType)}</span>
            <span class="hi-date">${dateStr}</span>
          </div>
          <div class="hi-stats">
            <span>${dist} mi</span>
            <span class="hi-sep">·</span>
            <span>${time} min</span>
            <span class="hi-sep">·</span>
            <span>${speed} mph</span>
            ${incl !== null ? `<span class="hi-sep">·</span><span>${incl}% incline</span>` : ''}
          </div>
          ${notes ? `<p class="hi-notes">${notes}</p>` : ''}
        </div>
        <div class="hi-actions">
          <button class="icon-btn" aria-label="Edit"
            data-action="edit-workout" data-id="${safeId}">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
          </button>
          <button class="icon-btn danger" aria-label="Delete"
            data-action="delete-workout" data-id="${safeId}">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function renderWeightHistory() {
  const el = document.getElementById('weight-history');
  if (!state.weightLogs.length) {
    el.innerHTML = '<p class="empty-state">No weight logs yet.</p>';
    return;
  }

  el.innerHTML = state.weightLogs.map((l, i) => {
    // SEC: sanitize all fields
    const safeId  = escAttr(String(l.id ?? ''));
    const dateStr = escHtml(fmtDate(sanitizeDateStr(l.date)));
    const kg      = safeNum(l.weightKg, 1);

    const prev  = state.weightLogs[i + 1];
    const delta = prev && isFinite(Number(prev.weightKg))
      ? (Number(l.weightKg) - Number(prev.weightKg)).toFixed(1)
      : null;
    const deltaHtml = delta !== null
      ? `<span class="weight-delta ${delta <= 0 ? 'down' : 'up'}">${delta > 0 ? '+' : ''}${delta}</span>`
      : '';

    return `
      <div class="history-item">
        <div class="hi-main">
          <div class="hi-top">
            <span class="hi-weight">${kg} <small>kg</small> ${deltaHtml}</span>
            <span class="hi-date">${dateStr}</span>
          </div>
        </div>
        <div class="hi-actions">
          <button class="icon-btn" aria-label="Edit"
            data-action="edit-weight" data-id="${safeId}">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
          </button>
          <button class="icon-btn danger" aria-label="Delete"
            data-action="delete-weight" data-id="${safeId}">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function editWorkout(id) {
  const w = state.workouts.find(w => String(w.id) === String(id));
  if (w) openWorkoutModal(w);
}

function editWeight(id) {
  const l = state.weightLogs.find(l => String(l.id) === String(id));
  if (l) openWeightModal(l);
}

async function confirmDeleteWorkout(id) {
  if (!confirm('Delete this workout?')) return;
  await deleteWorkout(id);
  await loadAll();
  renderHistory();
  renderDashboard();
  showToast('Workout deleted');
}

async function confirmDeleteWeight(id) {
  if (!confirm('Delete this weight log?')) return;
  await deleteWeightLog(id);
  await loadAll();
  renderHistory();
  renderDashboard();
  showToast('Weight log deleted');
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARTS
// ─────────────────────────────────────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 500 },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1E1E1E',
      titleColor: '#F4F4F5',
      bodyColor: '#A1A1AA',
      borderColor: '#2A2A2A',
      borderWidth: 1,
      padding: 10,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      grid:   { color: 'rgba(255,255,255,0.04)' },
      ticks:  { color: '#71717A', font: { size: 11 }, maxRotation: 45 },
      border: { color: 'transparent' },
    },
    y: {
      grid:   { color: 'rgba(255,255,255,0.04)' },
      ticks:  { color: '#71717A', font: { size: 11 } },
      border: { color: 'transparent' },
    },
  },
};

function renderCharts() {
  renderDistanceChart();
  renderWeightChart();
  renderWeeklyChart();
}

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function renderDistanceChart() {
  destroyChart('distance');
  const data = [...state.workouts].reverse().slice(-30);
  const ctx  = document.getElementById('chart-distance').getContext('2d');

  if (!data.length) { showChartEmpty('chart-distance-empty'); return; }
  hideChartEmpty('chart-distance-empty');

  state.charts.distance = new Chart(ctx, {
    type: 'line',
    data: {
      labels:   data.map(w => escHtml(fmtShort(sanitizeDateStr(w.date)))),
      datasets: [{
        data:                data.map(w => Number(w.distance) || 0),
        borderColor:         '#A3E635',
        backgroundColor:     'rgba(163,230,53,0.08)',
        fill:                true,
        tension:             0.4,
        pointBackgroundColor:'#A3E635',
        pointBorderColor:    '#0B0B0B',
        pointBorderWidth:    2,
        pointRadius:         4,
        pointHoverRadius:    6,
      }],
    },
    options: { ...CHART_DEFAULTS },
  });
}

function renderWeightChart() {
  destroyChart('weight');
  const data = [...state.weightLogs].reverse().slice(-30);
  const ctx  = document.getElementById('chart-weight').getContext('2d');

  if (!data.length) { showChartEmpty('chart-weight-empty'); return; }
  hideChartEmpty('chart-weight-empty');

  state.charts.weight = new Chart(ctx, {
    type: 'line',
    data: {
      labels:   data.map(l => escHtml(fmtShort(sanitizeDateStr(l.date)))),
      datasets: [{
        data:                data.map(l => Number(l.weightKg) || 0),
        borderColor:         '#60A5FA',
        backgroundColor:     'rgba(96,165,250,0.08)',
        fill:                true,
        tension:             0.4,
        pointBackgroundColor:'#60A5FA',
        pointBorderColor:    '#0B0B0B',
        pointBorderWidth:    2,
        pointRadius:         4,
        pointHoverRadius:    6,
      }],
    },
    options: { ...CHART_DEFAULTS },
  });
}

function renderWeeklyChart() {
  destroyChart('weekly');
  const weeks = getWeeklyData();
  const ctx   = document.getElementById('chart-weekly').getContext('2d');

  if (!weeks.length) { showChartEmpty('chart-weekly-empty'); return; }
  hideChartEmpty('chart-weekly-empty');

  state.charts.weekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels:   weeks.map(w => w.label),
      datasets: [
        {
          label:           'Distance (mi)',
          data:            weeks.map(w => w.distance),
          backgroundColor: 'rgba(163,230,53,0.7)',
          borderColor:     '#A3E635',
          borderRadius:    6,
          borderSkipped:   false,
        },
        {
          label:           'Workouts',
          data:            weeks.map(w => w.count),
          backgroundColor: 'rgba(96,165,250,0.5)',
          borderColor:     '#60A5FA',
          borderRadius:    6,
          borderSkipped:   false,
          yAxisID:         'y2',
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {
          display: true,
          labels: { color: '#A1A1AA', font: { size: 11 }, boxWidth: 12, boxHeight: 12 },
        },
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#71717A', font: { size: 11 }, precision: 0 },
          border: { color: 'transparent' },
        },
      },
    },
  });
}

function getWeeklyData() {
  if (!state.workouts.length) return [];
  const weekMap = new Map();

  state.workouts.forEach(w => {
    if (!isValidDate(w.date)) return;
    const d = new Date(w.date + 'T12:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // → Monday
    const key   = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!weekMap.has(key)) weekMap.set(key, { key, label, distance: 0, count: 0 });
    const e = weekMap.get(key);
    e.distance += Number(w.distance) || 0;
    e.count++;
  });

  return [...weekMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-8)
    .map(w => ({ ...w, distance: parseFloat(w.distance.toFixed(2)) }));
}

function showChartEmpty(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideChartEmpty(id) { document.getElementById(id)?.classList.add('hidden'); }

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
function renderSettings() {
  setText('settings-dist', state.goals.dailyDistance);
  setText('settings-time', state.goals.dailyTime);
  setText('settings-workout-count', state.workouts.length);
  setText('settings-weight-count',  state.weightLogs.length);

  const first = [...state.workouts].sort((a, b) => a.date.localeCompare(b.date))[0];
  setText('settings-since', first ? fmtDate(sanitizeDateStr(first.date)) : '—');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT / IMPORT
// ─────────────────────────────────────────────────────────────────────────────
function setupExportImport() {
  document.getElementById('btn-export').addEventListener('click', doExport);
  document.getElementById('btn-import').addEventListener('click', () =>
    document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', doImport);
}

async function doExport() {
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href:     url,
    download: `stridevault-backup-${todayISO()}.json`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Backup downloaded!');
}

async function doImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  // SEC: reject files larger than 5 MB
  const MAX_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    showToast('File too large (max 5 MB)', true);
    e.target.value = '';
    return;
  }

  // SEC: only accept .json files
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
    showToast('Only .json files are accepted', true);
    e.target.value = '';
    return;
  }

  try {
    const raw  = await file.text();
    const data = JSON.parse(raw);               // may throw SyntaxError
    const safe = validateAndSanitizeImport(data); // throws on bad schema

    await importAllData(safe);
    await loadAll();
    renderDashboard();
    if (state.currentTab === 'history') renderHistory();
    if (state.currentTab === 'settings') renderSettings();
    showToast(`Imported ${safe.workouts.length} workouts, ${safe.weightLogs.length} weight logs`);
  } catch (err) {
    showToast(`Import failed: ${err.message || 'invalid file'}`, true);
  }
  e.target.value = '';
}

// SEC: full sanitization of imported JSON — prevents XSS via stored data,
// prototype pollution, and out-of-range values from reaching the UI.
function validateAndSanitizeImport(data) {
  // Guard against null, arrays, and primitive values
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Expected a JSON object');

  if (!Array.isArray(data.workouts) || !Array.isArray(data.weightLogs))
    throw new Error('Missing workouts or weightLogs arrays');

  // Hard size cap to prevent memory exhaustion
  if (data.workouts.length > 10_000 || data.weightLogs.length > 10_000)
    throw new Error('Data too large (max 10 000 entries per type)');

  // Reconstruct each entry from scratch — prevents prototype-pollution payloads
  // and ensures only the fields we expect are stored.
  const workouts = data.workouts
    .filter(w => w && typeof w === 'object' && !Array.isArray(w))
    .map(w => {
      const rawId    = String(w.id ?? '').slice(0, 64).replace(/[^\w\-]/g, '');
      const id       = rawId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
      const date     = sanitizeDateStr(String(w.date ?? ''));
      const type     = ALLOWED_TYPES.includes(w.type) ? w.type : 'walking';
      const distance = clampNum(w.distance, 0.01, 500, 2);
      const time     = clampNum(w.time,     0.1,  9999, 1);
      const speed    = isFinite(Number(w.speed)) ? clampNum(w.speed, 0, 999, 2) : calcSpeed(distance, time);
      const entry    = { id, date, type, distance, time, speed };

      if (w.incline != null) {
        const inc = clampNum(w.incline, 0, 30, 1);
        if (inc >= 0) entry.incline = inc;
      }
      if (w.notes) {
        entry.notes = String(w.notes).slice(0, 500);
      }
      return entry;
    })
    .filter(w => w.date && w.distance > 0 && w.time > 0);

  const weightLogs = data.weightLogs
    .filter(l => l && typeof l === 'object' && !Array.isArray(l))
    .map(l => {
      const rawId = String(l.id ?? '').slice(0, 64).replace(/[^\w\-]/g, '');
      const id    = rawId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
      const date  = sanitizeDateStr(String(l.date ?? ''));
      const kg    = clampNum(l.weightKg, 1, 999, 1);
      return { id, date, weightKg: kg };
    })
    .filter(l => l.date && l.weightKg > 0);

  let goals = { id: 'daily', dailyDistance: 3, dailyTime: 45 };
  if (data.goals && typeof data.goals === 'object' && !Array.isArray(data.goals)) {
    goals = {
      id:            'daily',
      dailyDistance: clampNum(data.goals.dailyDistance, 0, 999, 1),
      dailyTime:     clampNum(data.goals.dailyTime,     0, 999, 0),
    };
  }

  return { workouts, weightLogs, goals };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS — safe HTML escaping, numeric helpers, date validation
// ─────────────────────────────────────────────────────────────────────────────

// Allowed workout types — whitelist enforced everywhere
const ALLOWED_TYPES = ['walking', 'running'];

// SEC: escape for HTML text content context
function escHtml(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;');
}

// SEC: escape for HTML attribute value context (e.g. data-id="...")
function escAttr(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}

// Clamp a value to a numeric range and round to given decimals
function clampNum(val, min, max, decimals = 2) {
  const n = Number(val);
  if (!isFinite(n)) return min;
  return parseFloat(Math.min(max, Math.max(min, n)).toFixed(decimals));
}

// Format a number safely for display (no NaN/Infinity in output)
function safeNum(val, decimals = 2) {
  const n = Number(val);
  return isFinite(n) ? n.toFixed(decimals) : '0';
}

// Ensure value is a finite positive number (for form pre-fill)
function toFinitePositive(val) {
  const n = Number(val);
  return isFinite(n) && n > 0 ? n : '';
}

function toFinite(val) {
  const n = Number(val);
  return isFinite(n) ? n : '';
}

// Speed: mph (distance in miles / time in minutes → miles per hour), guards division-by-zero
function calcSpeed(distMi, timeMin) {
  const distKm = distMi; // stored value is in miles; variable name kept for formula clarity
  if (!isFinite(distKm) || !isFinite(timeMin) || timeMin <= 0) return 0;
  return parseFloat(((distKm / timeMin) * 60).toFixed(2));
}

// Validate ISO date string (YYYY-MM-DD)
const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T12:00:00');
  return !isNaN(d.getTime());
}

// Return the input if it's a valid date, otherwise today
function sanitizeDateStr(s) {
  return isValidDate(s) ? s : todayISO();
}

function todayISO() { return new Date().toISOString().split('T')[0]; }

function fmtDate(s) {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShort(s) {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric' });
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;   // SEC: always textContent, never innerHTML
}

function setStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

let toastTimer;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.textContent = String(msg).slice(0, 200); // SEC: textContent + length cap
  el.className   = `toast ${isError ? 'error' : ''} show`;
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
