// Keep quiet recordings legible without changing audio volume. Each overview
// bar preserves the loudest sample in its time bucket rather than skipping it.
export function waveformHeights(peaks: number[], live: boolean, count = 96) {
  const samples = live ? peaks.slice(-count) : peaks;
  const reference = samples.reduce((max, value) => Math.max(max, value), 0.02);
  return Array.from({ length: count }, (_, i) => {
    let peak = 0;
    if (live) peak = samples[i - (count - samples.length)] || 0;
    else {
      const from = Math.floor((i * samples.length) / count);
      const to = Math.max(
        from + 1,
        Math.floor(((i + 1) * samples.length) / count),
      );
      for (let j = from; j < to; j++) peak = Math.max(peak, samples[j] || 0);
    }
    return 3 + Math.sqrt(Math.min(1, Math.max(0, peak) / reference)) * 32;
  });
}
