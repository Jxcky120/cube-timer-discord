export function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor(ms / 1000) % 60;
  const milli = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export const best = (times) => Math.min(...times);
export const mean = (times) => times.reduce((a, b) => a + b, 0) / times.length;

export function ao5(times) {
  if (times.length < 5) return null;
  const [, a, b, c] = [...times.slice(-5)].sort((x, y) => x - y);
  return (a + b + c) / 3;
}
