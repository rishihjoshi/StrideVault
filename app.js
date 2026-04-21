'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  currentTab: 'dashboard',
  workouts:   [],
  weightLogs: [],
  goals:      { id: 'daily', dailyDistance: 5, dailyTime: 45 },
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

  renderDashboard();
  showLoading(false);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(err => console.warn('SW:', err));
  }

  // Install prompt – store for later use
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
    form.date.value     = workout.date;
    form.type.value     = workout.type;
    form.distance.value = workout.distance;
    form.time.value     = workout.time;
    form.incline.value  = workout.incline ?? '';
    form.notes.value    = workout.notes ?? '';
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
    form.date.value     = log.date;
    form.weightKg.value = log.weightKg;
  } else {
    form.reset();
    form.date.value = todayISO();
  }

  document.getElementById('weight-modal').classList.add('open');
}

function openGoalsModal() {
  const form = document.getElementById('goals-form');
  form.dailyDistance.value = state.goals.dailyDistance;
  form.dailyTime.value     = state.goals.dailyTime;
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
  const d    = parseFloat(form.distance.value) || 0;
  const t    = parseFloat(form.time.value) || 0;
  const el   = document.getElementById('speed-preview');
  el.textContent = (d > 0 && t > 0) ? `Auto speed: ${((d / t) * 60).toFixed(2)} km/h` : '';
}

async function saveWorkout(form) {
  const d = parseFloat(form.distance.value);
  const t = parseFloat(form.time.value);
  const workout = {
    date:     form.date.value,
    type:     form.type.value,
    distance: d,
    time:     t,
    speed:    parseFloat(((d / t) * 60).toFixed(2)),
    ...(form.incline.value ? { incline: parseFloat(form.incline.value) } : {}),
    ...(form.notes.value   ? { notes: form.notes.value.trim() } : {}),
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
  const log = { date: form.date.value, weightKg: parseFloat(form.weightKg.value) };

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
  const goals = {
    id:            'daily',
    dailyDistance: parseFloat(form.dailyDistance.value),
    dailyTime:     parseFloat(form.dailyTime.value),
  };
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
  const today         = todayISO();
  const todayW        = state.workouts.filter(w => w.date === today);
  const todayDist     = todayW.reduce((s, w) => s + w.distance, 0);
  const todayTime     = todayW.reduce((s, w) => s + w.time, 0);
  const latestWeight  = state.weightLogs[0];

  setText('stat-distance', todayDist.toFixed(2));
  setText('stat-time', todayTime);
  setText('stat-weight', latestWeight ? `${latestWeight.weightKg} kg` : '—');
  setText('stat-workouts', todayW.length);

  // Progress bars
  const distPct = Math.min((todayDist / state.goals.dailyDistance) * 100, 100);
  const timePct = Math.min((todayTime  / state.goals.dailyTime)    * 100, 100);

  setStyle('progress-distance', 'width', `${distPct}%`);
  setStyle('progress-time',     'width', `${timePct}%`);
  setText('goal-distance-text', `${todayDist.toFixed(1)} / ${state.goals.dailyDistance} km`);
  setText('goal-time-text',     `${todayTime} / ${state.goals.dailyTime} min`);

  // Weight delta
  const wDelta = document.getElementById('weight-delta');
  if (state.weightLogs.length >= 2) {
    const diff = (state.weightLogs[0].weightKg - state.weightLogs[1].weightKg).toFixed(1);
    const sign = diff > 0 ? '+' : '';
    wDelta.textContent = `${sign}${diff} kg vs prev`;
    wDelta.className = `weight-delta ${diff <= 0 ? 'down' : 'up'}`;
  } else {
    wDelta.textContent = '';
  }

  // Streak
  const streak = calcStreak();
  setText('streak-count', streak);
  setText('streak-label', streak === 1 ? 'day streak' : 'day streak');

  // Greeting
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  setText('greeting', greeting);

  renderRecentWorkouts();
}

function renderRecentWorkouts() {
  const container = document.getElementById('recent-workouts');
  const recent    = state.workouts.slice(0, 5);

  if (!recent.length) {
    container.innerHTML = `<p class="empty-state">No workouts yet — tap <strong>+</strong> to add one!</p>`;
    return;
  }

  container.innerHTML = recent.map(w => `
    <div class="workout-row">
      <span class="badge ${w.type}">${w.type}</span>
      <span class="workout-row-date">${fmtDate(w.date)}</span>
      <span class="workout-row-stats">${w.distance} km · ${w.time} min · ${w.speed} km/h</span>
    </div>
  `).join('');
}

function calcStreak() {
  const dates = [...new Set(state.workouts.map(w => w.date))].sort().reverse();
  if (!dates.length) return 0;
  let streak = 0;
  const cur = new Date();
  cur.setHours(12, 0, 0, 0);
  for (const d of dates) {
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
  el.innerHTML = state.workouts.map(w => `
    <div class="history-item">
      <div class="hi-main">
        <div class="hi-top">
          <span class="badge ${w.type}">${w.type}</span>
          <span class="hi-date">${fmtDate(w.date)}</span>
        </div>
        <div class="hi-stats">
          <span>${w.distance} km</span>
          <span class="hi-sep">·</span>
          <span>${w.time} min</span>
          <span class="hi-sep">·</span>
          <span>${w.speed} km/h</span>
          ${w.incline ? `<span class="hi-sep">·</span><span>${w.incline}% incline</span>` : ''}
        </div>
        ${w.notes ? `<p class="hi-notes">${escHtml(w.notes)}</p>` : ''}
      </div>
      <div class="hi-actions">
        <button class="icon-btn" aria-label="Edit" onclick="editWorkout('${w.id}')">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
        </button>
        <button class="icon-btn danger" aria-label="Delete" onclick="confirmDeleteWorkout('${w.id}')">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function renderWeightHistory() {
  const el = document.getElementById('weight-history');
  if (!state.weightLogs.length) {
    el.innerHTML = '<p class="empty-state">No weight logs yet.</p>';
    return;
  }
  el.innerHTML = state.weightLogs.map((l, i) => {
    const prev = state.weightLogs[i + 1];
    const delta = prev ? (l.weightKg - prev.weightKg).toFixed(1) : null;
    const deltaHtml = delta !== null
      ? `<span class="weight-delta ${delta <= 0 ? 'down' : 'up'}">${delta > 0 ? '+' : ''}${delta}</span>`
      : '';
    return `
      <div class="history-item">
        <div class="hi-main">
          <div class="hi-top">
            <span class="hi-weight">${l.weightKg} <small>kg</small> ${deltaHtml}</span>
            <span class="hi-date">${fmtDate(l.date)}</span>
          </div>
        </div>
        <div class="hi-actions">
          <button class="icon-btn" aria-label="Edit" onclick="editWeight('${l.id}')">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
          </button>
          <button class="icon-btn danger" aria-label="Delete" onclick="confirmDeleteWeight('${l.id}')">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function editWorkout(id) {
  const w = state.workouts.find(w => w.id === id);
  if (w) openWorkoutModal(w);
}

function editWeight(id) {
  const l = state.weightLogs.find(l => l.id === id);
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
      grid:  { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#71717A', font: { size: 11 }, maxRotation: 45 },
      border: { color: 'transparent' },
    },
    y: {
      grid:  { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#71717A', font: { size: 11 } },
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
      labels: data.map(w => fmtShort(w.date)),
      datasets: [{
        data: data.map(w => w.distance),
        borderColor: '#A3E635',
        backgroundColor: 'rgba(163,230,53,0.08)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#A3E635',
        pointBorderColor: '#0B0B0B',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
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
      labels: data.map(l => fmtShort(l.date)),
      datasets: [{
        data: data.map(l => l.weightKg),
        borderColor: '#60A5FA',
        backgroundColor: 'rgba(96,165,250,0.08)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#60A5FA',
        pointBorderColor: '#0B0B0B',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
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
      labels: weeks.map(w => w.label),
      datasets: [
        {
          label: 'Distance (km)',
          data: weeks.map(w => w.distance),
          backgroundColor: 'rgba(163,230,53,0.7)',
          borderColor: '#A3E635',
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Workouts',
          data: weeks.map(w => w.count),
          backgroundColor: 'rgba(96,165,250,0.5)',
          borderColor: '#60A5FA',
          borderRadius: 6,
          borderSkipped: false,
          yAxisID: 'y2',
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
        y:  { ...CHART_DEFAULTS.scales.y, title: { display: false } },
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
    const d = new Date(w.date + 'T12:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    const key   = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!weekMap.has(key)) weekMap.set(key, { key, label, distance: 0, count: 0 });
    const e = weekMap.get(key);
    e.distance += w.distance;
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
  setText('settings-since', first ? fmtDate(first.date) : '—');
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
    href: url,
    download: `stridevault-backup-${todayISO()}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded!');
}

async function doImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    await importAllData(data);
    await loadAll();
    renderDashboard();
    if (state.currentTab === 'history') renderHistory();
    if (state.currentTab === 'settings') renderSettings();
    showToast(`Imported ${data.workouts.length} workouts, ${data.weightLogs.length} weight logs`);
  } catch {
    showToast('Import failed — invalid file', true);
  }
  e.target.value = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
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
  if (el) el.textContent = val;
}

function setStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

let toastTimer;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.className   = `toast ${isError ? 'error' : ''} show`;
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
