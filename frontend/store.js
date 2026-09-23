/* FitAI shared application state — localStorage-backed, same-origin across all boards. */
(function (global) {
  var KEY = 'fitai_state_v1';

  function defaults() {
    return {
      profile: { name: '', email: '', fitnessGoal: null, fitnessLevel: null, preferences: {} },
      aiCoach: { goal: null, time: null, level: null, equipment: {} },
      currentWorkout: null,
      generatedWorkout: null,
      lastCompleted: null,
      history: []
    };
  }

  function read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return defaults();
      var parsed = JSON.parse(raw);
      var d = defaults();
      return {
        profile: Object.assign({}, d.profile, parsed.profile || {}),
        aiCoach: Object.assign({}, d.aiCoach, parsed.aiCoach || {}),
        currentWorkout: parsed.currentWorkout || null,
        generatedWorkout: parsed.generatedWorkout || null,
        lastCompleted: parsed.lastCompleted || null,
        history: Array.isArray(parsed.history) ? parsed.history : []
      };
    } catch (e) {
      return defaults();
    }
  }

  function write(state) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* localStorage unavailable — state simply won't persist across page loads */
    }
    return state;
  }

  function patch(partial) {
    var current = read();
    var next = Object.assign({}, current, partial);
    return write(next);
  }

  function setProfileField(field, value) {
    var current = read();
    current.profile = Object.assign({}, current.profile, { [field]: value });
    return write(current);
  }

  function setAICoachField(field, value) {
    var current = read();
    current.aiCoach = Object.assign({}, current.aiCoach, { [field]: value });
    return write(current);
  }

  function togglePreference(id) {
    var current = read();
    var prefs = Object.assign({}, current.profile.preferences);
    prefs[id] = !prefs[id];
    current.profile = Object.assign({}, current.profile, { preferences: prefs });
    return write(current);
  }

  function toggleEquipment(id) {
    var current = read();
    var eq = Object.assign({}, current.aiCoach.equipment);
    eq[id] = !eq[id];
    current.aiCoach = Object.assign({}, current.aiCoach, { equipment: eq });
    return write(current);
  }

  /* ---- Deterministic local workout generator (stand-in for a future real AI call) ---- */

  var EXERCISE_POOL = [
    { name: 'Bench Press', equip: ['gym', 'dumbbells'], goals: ['build', 'general'] },
    { name: 'Incline Dumbbell Press', equip: ['dumbbells', 'gym'], goals: ['build', 'general'] },
    { name: 'Dumbbell Row', equip: ['dumbbells', 'gym'], goals: ['build', 'general'] },
    { name: 'Seated Cable Row', equip: ['gym'], goals: ['build'] },
    { name: 'Overhead Press', equip: ['dumbbells', 'gym'], goals: ['build', 'general'] },
    { name: 'Lateral Raise', equip: ['dumbbells', 'gym'], goals: ['build'] },
    { name: 'Push-Up', equip: ['bodyweight', 'dumbbells', 'gym', 'bands'], goals: ['build', 'general', 'lose'] },
    { name: 'Bodyweight Squat', equip: ['bodyweight', 'bands', 'dumbbells', 'gym'], goals: ['general', 'lose', 'endurance'] },
    { name: 'Goblet Squat', equip: ['dumbbells', 'gym'], goals: ['build', 'general'] },
    { name: 'Resistance Band Row', equip: ['bands'], goals: ['build', 'general'] },
    { name: 'Jumping Jacks', equip: ['bodyweight', 'bands', 'dumbbells', 'gym'], goals: ['lose', 'endurance'] },
    { name: 'Mountain Climbers', equip: ['bodyweight', 'bands', 'dumbbells', 'gym'], goals: ['lose', 'endurance'] },
    { name: 'Plank', equip: ['bodyweight', 'bands', 'dumbbells', 'gym'], goals: ['general', 'endurance'] },
    { name: 'Kettlebell/DB Swing', equip: ['dumbbells', 'gym'], goals: ['endurance', 'lose'] },
    { name: 'Tricep Pushdown', equip: ['gym', 'bands'], goals: ['build'] },
    { name: 'Bicep Curl', equip: ['dumbbells', 'gym', 'bands'], goals: ['build'] }
  ];

  var TIME_TO_COUNT = { '15': 3, '30': 4, '45': 5, '60': 6 };
  var LEVEL_SCHEME = {
    beginner: { sets: 3, reps: 10, weightMult: 0.7 },
    intermediate: { sets: 3, reps: 10, weightMult: 1 },
    advanced: { sets: 4, reps: 8, weightMult: 1.3 }
  };
  var BASE_WEIGHT = 20;

  function generateWorkout(inputs, seed) {
    seed = seed || 0;
    var goal = inputs.goal || 'general';
    var time = inputs.time || '30';
    var level = inputs.level || 'intermediate';
    var equipmentIds = Object.keys(inputs.equipment || {}).filter(function (k) { return inputs.equipment[k]; });
    if (equipmentIds.length === 0) equipmentIds = ['bodyweight'];

    var pool = EXERCISE_POOL.filter(function (ex) {
      return ex.equip.some(function (e) { return equipmentIds.indexOf(e) !== -1; });
    });
    var matched = pool.filter(function (ex) { return ex.goals.indexOf(goal) !== -1; });
    var rest = pool.filter(function (ex) { return ex.goals.indexOf(goal) === -1; });
    var ordered = matched.concat(rest);

    var rotated = ordered.slice(seed % (ordered.length || 1)).concat(ordered.slice(0, seed % (ordered.length || 1)));
    var count = TIME_TO_COUNT[time] || 4;
    var chosen = rotated.slice(0, count);
    if (chosen.length === 0) chosen = EXERCISE_POOL.slice(0, count);

    var scheme = LEVEL_SCHEME[level] || LEVEL_SCHEME.intermediate;
    var exercises = chosen.map(function (ex) {
      var isBodyweightOnly = ex.equip.indexOf('bodyweight') !== -1 && equipmentIds.length === 1 && equipmentIds[0] === 'bodyweight';
      return {
        name: ex.name,
        sets: scheme.sets,
        reps: scheme.reps,
        weight: isBodyweightOnly ? 0 : Math.round(BASE_WEIGHT * scheme.weightMult)
      };
    });

    var goalLabel = { lose: 'lose weight', build: 'build muscle', endurance: 'improve endurance', general: 'general fitness' }[goal] || 'your goal';
    var levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
    var equipLabel = equipmentIds.join(', ');

    return {
      title: time + '-Min ' + (goal === 'build' ? 'Strength' : goal === 'lose' ? 'Fat-Burn' : goal === 'endurance' ? 'Endurance' : 'Full Body') + ' Session',
      duration: time + ' min',
      difficulty: levelLabel,
      rationale: 'Built for your ' + time + '-minute ' + goalLabel + ' goal at ' + level + ' level, using ' + equipLabel + '.',
      exercises: exercises
    };
  }

  /* ---- Workout execution ---- */

  function startWorkout(workout, backendSessionId) {
    var current = read();
    current.currentWorkout = {
      id: workout.id || ('w-' + Date.now()),
      name: workout.title || workout.name,
      duration: workout.duration,
      difficulty: workout.difficulty,
      exercises: workout.exercises,
      exerciseIndex: 0,
      setIndex: 0,
      loggedSets: [],
      startedAt: Date.now(),
      backendSessionId: backendSessionId || null
    };
    return write(current);
  }

  // Phase 2.3: attaches a backend session id to the workout already
  // started locally (startWorkout() runs synchronously; the backend
  // session id only arrives once its async POST /sessions resolves).
  function setCurrentWorkoutBackendSessionId(id) {
    var current = read();
    if (current.currentWorkout) {
      current.currentWorkout.backendSessionId = id;
      write(current);
    }
    return current.currentWorkout;
  }

  function getCurrentWorkout() {
    return read().currentWorkout;
  }

  function logCurrentSet(reps, weight) {
    var current = read();
    var w = current.currentWorkout;
    if (!w) return null;
    var ex = w.exercises[w.exerciseIndex];
    w.loggedSets.push({ exerciseIndex: w.exerciseIndex, setIndex: w.setIndex, exerciseName: ex.name, reps: reps, weight: weight });
    var isFinal = w.exerciseIndex === w.exercises.length - 1 && w.setIndex === ex.sets - 1;
    if (!isFinal) {
      if (w.setIndex < ex.sets - 1) {
        w.setIndex += 1;
      } else {
        w.exerciseIndex += 1;
        w.setIndex = 0;
      }
    }
    current.currentWorkout = w;
    write(current);
    return { isFinal: isFinal, workout: w };
  }

  function completeWorkout() {
    var current = read();
    var w = current.currentWorkout;
    if (!w) return null;
    var durationMin = Math.max(1, Math.round((Date.now() - w.startedAt) / 60000));
    var record = {
      id: w.id,
      name: w.name,
      date: new Date().toISOString(),
      duration: durationMin,
      exercisesCompleted: w.exercises.length,
      setsCompleted: w.loggedSets.length
    };
    current.lastCompleted = record;
    current.history = [record].concat(current.history).slice(0, 50);
    current.currentWorkout = null;
    write(current);
    return record;
  }

  // Phase 2.3: same bookkeeping as completeWorkout(), but the record's
  // duration/exercise/set counts come from the backend's own
  // authoritative POST /sessions/:id/complete response instead of being
  // computed client-side — used whenever a backend session exists.
  function completeWorkoutFromServer(serverSession) {
    var current = read();
    var record = {
      id: serverSession.id,
      name: serverSession.name,
      date: serverSession.completed_at || new Date().toISOString(),
      duration: serverSession.duration_min,
      exercisesCompleted: serverSession.exercises_completed,
      setsCompleted: serverSession.sets_completed
    };
    current.lastCompleted = record;
    current.history = [record].concat(current.history).slice(0, 50);
    current.currentWorkout = null;
    write(current);
    return record;
  }

  function computeProgress() {
    var current = read();
    var now = Date.now();
    var weekMs = 7 * 24 * 60 * 60 * 1000;
    var workoutsThisWeek = current.history.filter(function (h) {
      return now - new Date(h.date).getTime() <= weekMs;
    }).length;
    var dayKeys = {};
    current.history.forEach(function (h) {
      dayKeys[new Date(h.date).toDateString()] = true;
    });
    var streak = 0;
    var cursor = new Date();
    while (dayKeys[cursor.toDateString()]) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    var completedSets = current.history.reduce(function (sum, h) { return sum + (h.setsCompleted || 0); }, 0);
    return { workoutsThisWeek: workoutsThisWeek, streak: streak, history: current.history, completedSets: completedSets };
  }

  global.FitAI = {
    KEY: KEY,
    defaults: defaults,
    get: read,
    patch: patch,
    setProfileField: setProfileField,
    setAICoachField: setAICoachField,
    togglePreference: togglePreference,
    toggleEquipment: toggleEquipment,
    generateWorkout: generateWorkout,
    startWorkout: startWorkout,
    setCurrentWorkoutBackendSessionId: setCurrentWorkoutBackendSessionId,
    getCurrentWorkout: getCurrentWorkout,
    logCurrentSet: logCurrentSet,
    completeWorkout: completeWorkout,
    completeWorkoutFromServer: completeWorkoutFromServer,
    computeProgress: computeProgress
  };
})(window);
