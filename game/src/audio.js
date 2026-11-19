// audio.js — SOLMAR HEAT synthesized audio.
//
// Every sound is generated with the Web Audio API: oscillators, filtered
// noise and gain envelopes. No audio files, no network requests. All
// public methods are safe to call before the context exists or while it
// is suspended — they simply do nothing instead of throwing.
//
// The AudioContext is created lazily inside resume(), which main.js calls
// from the Start click (a user gesture), so playback is allowed. The
// looping voices (engine, siren) are created once and reused; one-shots
// build short-lived nodes and stop them when they finish. A quiet bass
// line + hats music bed loops from the first resume() and can be toggled
// with setMusic() (default on).

const MASTER_VOLUME = 0.9;
const MUSIC_VOLUME = 0.13;
const ENGINE_BASE_FREQ = 55;
const ENGINE_FREQ_RANGE = 140;

// One bar of bass: A1, A1, C2, G1 — eighth notes at 120 BPM.
const BASS_NOTES = [55.0, 55.0, 65.41, 49.0];
const MUSIC_STEP_MS = 250;
const MUSIC_STEPS_PER_BAR = 8;

function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function createAudio() {
  let ctx = null;
  let master = null; // master gain (mute lives here)
  let sfxBus = null;
  let musicBus = null;
  let noiseBuffer = null; // shared 1s white-noise buffer
  let muted = false;
  let musicOn = true;
  let musicTimer = null;
  let musicStep = 0;
  let engineVoice = null; // { osc, filter, gain } — created once, reused
  let sirenVoice = null; // { gain } — created once, reused

  function audioCtor() {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = audioCtor();
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC_VOLUME;
      musicBus.connect(master);
      const len = Math.max(1, ctx.sampleRate);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) {
      ctx = null;
      master = null;
      sfxBus = null;
      musicBus = null;
      noiseBuffer = null;
    }
    return ctx;
  }

  function ready() {
    return !!(ctx && ctx.state === 'running');
  }

  // Short enveloped oscillator blip. opts: type, freq, freqEnd, at
  // (seconds from now), dur, vol, bus (defaults to the sfx bus).
  function tone(opts) {
    if (!ready()) return;
    try {
      const t0 = ctx.currentTime + (opts.at || 0);
      const dur = opts.dur || 0.15;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(opts.freq || 440, t0);
      if (opts.freqEnd) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.vol || 0.2), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(opts.bus || sfxBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (e) {
      // Never throw from a sound effect.
    }
  }

  // Short enveloped filtered-noise burst. opts: at, dur, vol, filterType,
  // freq, freqEnd, q, bus (defaults to the sfx bus).
  function noiseHit(opts) {
    if (!ready() || !noiseBuffer) return;
    try {
      const t0 = ctx.currentTime + (opts.at || 0);
      const dur = opts.dur || 0.2;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = opts.filterType || 'lowpass';
      f.frequency.setValueAtTime(opts.freq || 1200, t0);
      f.Q.value = opts.q || 0.8;
      if (opts.freqEnd) {
        f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + dur);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.vol || 0.3), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(opts.bus || sfxBus);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch (e) {
      // Never throw from a sound effect.
    }
  }

  function scheduleMusicStep() {
    if (!ready() || !musicOn) return;
    const step = musicStep % MUSIC_STEPS_PER_BAR;
    musicStep += 1;
    if (step % 2 === 0) {
      // Bass note on even steps.
      tone({
        type: 'triangle',
        freq: BASS_NOTES[(step / 2) | 0],
        dur: 0.23,
        vol: 0.5,
        bus: musicBus
      });
    } else {
      // Hat tick on odd steps.
      noiseHit({
        dur: 0.04,
        vol: 0.1,
        filterType: 'highpass',
        freq: 6000,
        bus: musicBus
      });
    }
  }

  function startMusic() {
    if (musicTimer !== null || !musicOn) return;
    if (typeof setInterval === 'undefined') return;
    if (!ready()) return;
    musicTimer = setInterval(scheduleMusicStep, MUSIC_STEP_MS);
  }

  function stopMusic() {
    if (musicTimer !== null && typeof clearInterval !== 'undefined') {
      clearInterval(musicTimer);
    }
    musicTimer = null;
  }

  // Create (on first call) and resume the AudioContext. Call from a user
  // gesture such as the Start click. Also starts the music bed.
  function resume() {
    try {
      const c = ensureCtx();
      if (!c) return;
      if (c.state === 'suspended' && typeof c.resume === 'function') {
        const p = c.resume();
        if (p && typeof p.then === 'function') {
          p.then(function () { startMusic(); }).catch(function () {});
        }
      } else if (c.state === 'running') {
        startMusic();
      }
    } catch (e) {
      // Never throw.
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      if (ctx && master) {
        master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
      }
    } catch (e) {
      // Never throw.
    }
  }

  // Music bed toggle (extra, beyond the contract list). Default on.
  function setMusic(on) {
    musicOn = !!on;
    if (musicOn) startMusic();
    else stopMusic();
  }

  function ensureEngineVoice() {
    if (engineVoice) return engineVoice;
    if (!ready()) return null;
    try {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = ENGINE_BASE_FREQ;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      filter.Q.value = 1;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(sfxBus);
      osc.start();
      engineVoice = { osc: osc, filter: filter, gain: gain };
      return engineVoice;
    } catch (e) {
      return null;
    }
  }

  // Continuous engine hum. level01 is normalized speed (0..1); on=false
  // fades the voice out. Safe to call every frame.
  function engine(level01, on) {
    try {
      const voice = ensureEngineVoice();
      if (!voice) return;
      const level = clamp01(level01);
      const t = ctx.currentTime;
      if (on) {
        voice.osc.frequency.setTargetAtTime(
          ENGINE_BASE_FREQ + level * ENGINE_FREQ_RANGE, t, 0.08);
        voice.filter.frequency.setTargetAtTime(280 + level * 900, t, 0.08);
        voice.gain.gain.setTargetAtTime(0.045 + level * 0.075, t, 0.08);
      } else {
        voice.gain.gain.setTargetAtTime(0, t, 0.1);
      }
    } catch (e) {
      // Never throw.
    }
  }

  function ensureSirenVoice() {
    if (sirenVoice) return sirenVoice;
    if (!ready()) return null;
    try {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 825; // midway between 700 and 950 Hz
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.9;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 125; // sweeps the siren 700..950 Hz
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(sfxBus);
      osc.start();
      lfo.start();
      sirenVoice = { gain: gain };
      return sirenVoice;
    } catch (e) {
      return null;
    }
  }

  // Police siren loop. on=false fades it out. Safe to call every frame.
  function siren(on) {
    try {
      const voice = ensureSirenVoice();
      if (!voice) return;
      voice.gain.gain.setTargetAtTime(on ? 0.06 : 0, ctx.currentTime, 0.15);
    } catch (e) {
      // Never throw.
    }
  }

  function gunshot() {
    noiseHit({ dur: 0.12, vol: 0.5, filterType: 'bandpass', freq: 1800, q: 0.7 });
    tone({ type: 'square', freq: 160, freqEnd: 55, dur: 0.09, vol: 0.22 });
  }

  function explosion() {
    noiseHit({ dur: 0.9, vol: 0.7, filterType: 'lowpass', freq: 900, freqEnd: 110 });
    tone({ type: 'sine', freq: 70, freqEnd: 30, dur: 0.7, vol: 0.5 });
  }

  function pickup() {
    tone({ type: 'sine', freq: 660, dur: 0.09, vol: 0.25 });
    tone({ type: 'sine', freq: 990, at: 0.07, dur: 0.13, vol: 0.25 });
  }

  function click() {
    tone({ type: 'square', freq: 1250, dur: 0.045, vol: 0.1 });
  }

  function missionComplete() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      tone({ type: 'triangle', freq: notes[i], at: i * 0.1, dur: 0.2, vol: 0.25 });
    }
  }

  function wantedUp() {
    tone({ type: 'sawtooth', freq: 440, dur: 0.12, vol: 0.16 });
    tone({ type: 'sawtooth', freq: 349.23, at: 0.13, dur: 0.18, vol: 0.16 });
  }

  function busted() {
    tone({ type: 'triangle', freq: 392, dur: 0.2, vol: 0.25 });
    tone({ type: 'triangle', freq: 311.13, at: 0.18, dur: 0.2, vol: 0.25 });
    tone({ type: 'triangle', freq: 233.08, at: 0.36, dur: 0.3, vol: 0.25 });
    tone({ type: 'sine', freq: 90, freqEnd: 45, dur: 0.5, vol: 0.3 });
  }

  function horn() {
    tone({ type: 'sawtooth', freq: 370, dur: 0.35, vol: 0.07 });
    tone({ type: 'sawtooth', freq: 466.16, dur: 0.35, vol: 0.07 });
  }

  return {
    resume: resume,
    setMuted: setMuted,
    setMusic: setMusic,
    engine: engine,
    siren: siren,
    gunshot: gunshot,
    explosion: explosion,
    pickup: pickup,
    click: click,
    missionComplete: missionComplete,
    wantedUp: wantedUp,
    busted: busted,
    horn: horn
  };
}
