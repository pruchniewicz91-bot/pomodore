/**
 * Blokada wygaszania ekranu na czas sesji.
 * Przy czytaniu z ekranu gasniecie co 30 sekund niszczy skupienie.
 * API bywa niedostepne - kazdy blad jest cichy, bo to funkcja dodatkowa.
 */
let sentinel: WakeLockSentinel | null = null

export async function acquire() {
  try {
    if (!('wakeLock' in navigator) || sentinel) return
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => { sentinel = null })
  } catch { /* brak wsparcia albo odmowa - trudno */ }
}

export async function release() {
  try { await sentinel?.release() } catch { /* ignorujemy */ }
  sentinel = null
}

/** Po powrocie z tla blokada przepada i trzeba ja odnowic. */
export function reacquireOnVisible(active: () => boolean) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && active()) void acquire()
  })
}
