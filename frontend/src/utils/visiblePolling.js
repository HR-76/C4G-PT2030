// Schedules one poll. A hidden tab does not poll: the work is held until the
// tab is visible again and then runs once. Returns a cancel function.
export function scheduleWhenVisible(work, delay) {
  let timer = null, waiting = false
  const resume = () => {
    if (document.visibilityState === 'hidden') return
    document.removeEventListener('visibilitychange', resume); waiting = false
    work()
  }
  timer = setTimeout(() => {
    timer = null
    if (document.visibilityState !== 'hidden') { work(); return }
    waiting = true; document.addEventListener('visibilitychange', resume)
  }, delay)
  return () => {
    if (timer !== null) clearTimeout(timer)
    if (waiting) document.removeEventListener('visibilitychange', resume)
    timer = null; waiting = false
  }
}
