// All sounds are synthesised with the Web Audio API, so there are no audio files.
// Browsers only allow sound after a click or key press: call unlock() from one.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  let engines = new Map(); // kart id -> { osc, gain }

  function unlock() {
    try {
      if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ctx.destination);
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch {
      ctx = null; // no audio available: everything below becomes a no-op
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.03);
    return muted;
  }

  // one beep: optional pitch slide, quick fade out
  function tone(freq, duration, { type = "square", volume = 0.18, slideTo = null, delay = 0 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function noise(duration, volume, cutoff) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // race events from Race.events
  function handle(event) {
    switch (event.type) {
      case "count":
        tone(440, 0.18);
        break;
      case "go":
        tone(880, 0.7, { type: "square", volume: 0.2 });
        break;
      case "lap":
        tone(660, 0.1, { type: "triangle", volume: 0.25 });
        tone(990, 0.2, { type: "triangle", volume: 0.25, delay: 0.1 });
        break;
      case "finish":
        [523, 659, 784, 1047].forEach((f, i) =>
          tone(f, 0.25, { type: "triangle", volume: 0.25, delay: i * 0.11 }),
        );
        break;
      case "pickup":
        tone(700, 0.07, { type: "triangle", volume: 0.2 });
        tone(1050, 0.12, { type: "triangle", volume: 0.2, delay: 0.07 });
        break;
      case "use":
        if (event.item === "boost") {
          noise(0.6, 0.35, 3000);
          tone(200, 0.6, { type: "sawtooth", volume: 0.12, slideTo: 700 });
        } else if (event.item === "banana") {
          tone(300, 0.12, { type: "sine", volume: 0.25, slideTo: 120 });
        } else {
          noise(0.5, 0.3, 2000);
          tone(400, 0.5, { type: "sawtooth", volume: 0.12, slideTo: 120 });
        }
        break;
      case "hit":
        noise(0.5, 0.5, 1200);
        tone(300, 0.6, { type: "sawtooth", volume: 0.25, slideTo: 60 });
        break;
      case "drift":
        noise(0.25, 0.14, 3500);
        break;
      case "driftboost":
        noise(0.4, 0.25 + event.level * 0.1, 3000);
        tone(300, 0.4, { type: "square", volume: 0.1, slideTo: 600 * event.level });
        break;
      case "swing":
        noise(0.12, 0.12, 4000);
        tone(event.kind === "kick" ? 260 : 340, 0.1, { type: "triangle", volume: 0.08, slideTo: 140 });
        break;
      case "hurt":
        noise(0.18, 0.5, 1800);
        tone(180, 0.2, { type: "square", volume: 0.25, slideTo: 60 });
        break;
      case "block":
        tone(900, 0.06, { type: "square", volume: 0.15, slideTo: 600 });
        break;
      case "jump":
        tone(300, 0.15, { type: "square", volume: 0.1, slideTo: 600 });
        break;
      case "ko":
        noise(0.7, 0.5, 900);
        tone(260, 0.8, { type: "sawtooth", volume: 0.25, slideTo: 40 });
        break;
      case "round":
        tone(330, 0.12, { type: "triangle", volume: 0.2 });
        tone(440, 0.12, { type: "triangle", volume: 0.2, delay: 0.14 });
        break;
      case "roundend":
        [523, 659, 784].forEach((f, i) => tone(f, 0.22, { type: "triangle", volume: 0.22, delay: i * 0.1 }));
        break;
      case "bump": {
        const strength = Math.min(event.strength / 15, 1);
        noise(0.15 + strength * 0.15, 0.15 + strength * 0.45, 500 + strength * 1500);
        tone(120, 0.15, { type: "sine", volume: 0.2 + strength * 0.3, slideTo: 50 });
        break;
      }
    }
  }

  // --- engines: one low saw tone per kart, pitch follows speed ---
  function startEngines(karts) {
    stopEngines();
    if (!ctx) return;
    karts.forEach((k, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(master);
      osc.start();
      engines.set(k.id, { osc, gain, detune: i * 7 });
    });
  }

  function stopEngines() {
    for (const e of engines.values()) {
      e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      e.osc.stop(ctx.currentTime + 0.3);
    }
    engines = new Map();
  }

  function updateEngines(karts, phase) {
    if (!ctx) return;
    const on = phase === "countdown" || phase === "race";
    for (const k of karts) {
      const e = engines.get(k.id);
      if (!e) continue;
      const speed = Math.min(Math.abs(k.speed), 30);
      e.osc.frequency.setTargetAtTime(48 + e.detune + speed * 4.2, ctx.currentTime, 0.05);
      const volume = on && !k.finished ? 0.035 + (speed / 30) * 0.03 : 0;
      e.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
    }
  }

  return { unlock, toggleMute, handle, startEngines, stopEngines, updateEngines };
}
