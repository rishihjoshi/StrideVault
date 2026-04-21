'use strict';

let db;
let useLocalStorage = false;

async function initDB() {
  try {
    db = new Dexie('fitnessTrackerDB');
    db.version(1).stores({
      workouts:   'id, date, type',
      weightLogs: 'id, date',
      goals:      'id',
    });
    await db.open();

    const existing = await db.goals.get('daily');
    if (!existing) {
      await db.goals.put({ id: 'daily', dailyDistance: 5, dailyTime: 45 });
    }
    return true;
  } catch (err) {
    console.warn('IndexedDB unavailable, using localStorage:', err);
    useLocalStorage = true;
    _lsInit();
    return false;
  }
}

function _lsInit() {
  if (!localStorage.getItem('sv_workouts'))   localStorage.setItem('sv_workouts', '[]');
  if (!localStorage.getItem('sv_weightLogs')) localStorage.setItem('sv_weightLogs', '[]');
  if (!localStorage.getItem('sv_goals'))
    localStorage.setItem('sv_goals', JSON.stringify({ id: 'daily', dailyDistance: 5, dailyTime: 45 }));
}

function _lsGet(key)       { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function _lsGetObj(key)    { try { return JSON.parse(localStorage.getItem(key)); }        catch { return null; } }
function _lsSet(key, val)  { localStorage.setItem(key, JSON.stringify(val)); }
function _genId()          { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── Workouts ──────────────────────────────────────────────────────────────────

async function addWorkout(workout) {
  workout.id = _genId();
  if (useLocalStorage) {
    const list = _lsGet('sv_workouts');
    list.push(workout);
    _lsSet('sv_workouts', list);
    return workout;
  }
  await db.workouts.add(workout);
  return workout;
}

async function getAllWorkouts() {
  if (useLocalStorage)
    return _lsGet('sv_workouts').sort((a, b) => b.date.localeCompare(a.date));
  return db.workouts.orderBy('date').reverse().toArray();
}

async function updateWorkout(id, data) {
  if (useLocalStorage) {
    const list = _lsGet('sv_workouts');
    const i = list.findIndex(w => w.id === id);
    if (i !== -1) list[i] = { ...list[i], ...data };
    _lsSet('sv_workouts', list);
    return;
  }
  await db.workouts.update(id, data);
}

async function deleteWorkout(id) {
  if (useLocalStorage) {
    _lsSet('sv_workouts', _lsGet('sv_workouts').filter(w => w.id !== id));
    return;
  }
  await db.workouts.delete(id);
}

// ── Weight Logs ───────────────────────────────────────────────────────────────

async function addWeightLog(log) {
  log.id = _genId();
  if (useLocalStorage) {
    const list = _lsGet('sv_weightLogs');
    list.push(log);
    _lsSet('sv_weightLogs', list);
    return log;
  }
  await db.weightLogs.add(log);
  return log;
}

async function getAllWeightLogs() {
  if (useLocalStorage)
    return _lsGet('sv_weightLogs').sort((a, b) => b.date.localeCompare(a.date));
  return db.weightLogs.orderBy('date').reverse().toArray();
}

async function updateWeightLog(id, data) {
  if (useLocalStorage) {
    const list = _lsGet('sv_weightLogs');
    const i = list.findIndex(l => l.id === id);
    if (i !== -1) list[i] = { ...list[i], ...data };
    _lsSet('sv_weightLogs', list);
    return;
  }
  await db.weightLogs.update(id, data);
}

async function deleteWeightLog(id) {
  if (useLocalStorage) {
    _lsSet('sv_weightLogs', _lsGet('sv_weightLogs').filter(l => l.id !== id));
    return;
  }
  await db.weightLogs.delete(id);
}

// ── Goals ─────────────────────────────────────────────────────────────────────

async function getGoals() {
  if (useLocalStorage)
    return _lsGetObj('sv_goals') || { id: 'daily', dailyDistance: 5, dailyTime: 45 };
  return (await db.goals.get('daily')) || { id: 'daily', dailyDistance: 5, dailyTime: 45 };
}

async function updateGoals(goals) {
  if (useLocalStorage) { _lsSet('sv_goals', goals); return; }
  await db.goals.put(goals);
}

// ── Export / Import ───────────────────────────────────────────────────────────

async function exportAllData() {
  const [workouts, weightLogs, goals] = await Promise.all([
    getAllWorkouts(),
    getAllWeightLogs(),
    getGoals(),
  ]);
  return { workouts, weightLogs, goals, exportedAt: new Date().toISOString(), version: 1 };
}

async function importAllData(data) {
  if (!Array.isArray(data.workouts) || !Array.isArray(data.weightLogs))
    throw new Error('Invalid backup format');

  if (useLocalStorage) {
    _lsSet('sv_workouts', data.workouts);
    _lsSet('sv_weightLogs', data.weightLogs);
    if (data.goals) _lsSet('sv_goals', data.goals);
    return;
  }

  await db.transaction('rw', db.workouts, db.weightLogs, db.goals, async () => {
    await db.workouts.clear();
    await db.weightLogs.clear();
    if (data.workouts.length)   await db.workouts.bulkAdd(data.workouts);
    if (data.weightLogs.length) await db.weightLogs.bulkAdd(data.weightLogs);
    if (data.goals)             await db.goals.put(data.goals);
  });
}
