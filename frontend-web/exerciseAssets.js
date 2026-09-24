/*
 * FitAI — exercise name -> local visual asset mapping.
 *
 * Every exercise name that appears anywhere in FitAI (catalog seed data,
 * the local offline builder's pool, and whatever a real AI provider
 * might return) is looked up here, case/whitespace-insensitively.
 * Anything not explicitly mapped falls back to a generic icon rather
 * than a broken image or empty placeholder — the mapping is defensive
 * by design, not an exhaustive list that breaks on a new exercise name.
 *
 * All assets are local SVGs under assets/exercises/ — no remote URLs,
 * no licensing risk (hand-authored line-art), nothing to fetch.
 */
(function (global) {
  var BASE = 'assets/exercises/';
  var DEFAULT_ASSET = BASE + 'default.svg';

  var MAP = {
    'bench press': 'bench-press.svg',
    'incline dumbbell press': 'bench-press.svg',
    'dumbbell row': 'dumbbell-row.svg',
    'seated cable row': 'dumbbell-row.svg',
    'resistance band row': 'dumbbell-row.svg',
    'overhead press': 'overhead-press.svg',
    'push-up': 'push-up.svg',
    'push up': 'push-up.svg',
    'bodyweight squat': 'bodyweight-squat.svg',
    'goblet squat': 'bodyweight-squat.svg',
    'jumping jacks': 'jumping-jacks.svg',
    'mountain climbers': 'jumping-jacks.svg',
    'plank': 'push-up.svg',
    'kettlebell/db swing': 'overhead-press.svg',
    'tricep pushdown': 'dumbbell-row.svg',
    'bicep curl': 'dumbbell-row.svg',
    'lateral raise': 'overhead-press.svg'
  };

  function getExerciseAsset(name) {
    var key = String(name || '').trim().toLowerCase();
    var file = MAP[key];
    return file ? (BASE + file) : DEFAULT_ASSET;
  }

  global.FitAIAssets = {
    getExerciseAsset: getExerciseAsset,
    workoutCardDefault: 'assets/workout-card-default.svg'
  };
})(window);
