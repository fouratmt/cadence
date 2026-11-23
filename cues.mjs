// Each note gives its start in seconds, pitch in semitones, and relative level.
const BELL_PHRASES = {
  prepare: [[0, -5, .65], [.23, 0, .74]],
  work: [[0, 0, .85], [.14, 4, .78], [.32, 7, 1]],
  rest: [[0, 2, .78], [.22, -3, .74]],
  cooldown: [[0, 4, .69], [.24, 2, .65], [.48, -5, .76]],
  finished: [[0, -5, .75], [.17, 0, .83], [.35, 4, .79], [.56, 0, .35], [.56, 7, .94]],
};

const SPORT_PHRASES = {
  prepare: [[0, 0, .7], [.2, 0, .9]],
  work: [[0, 0, 1]],
  rest: [[0, -3, .83]],
  cooldown: [[0, 0, .67], [.29, -4, .83]],
  finished: [[0, 0, .79], [.2, 0, .86], [.4, 2, 1]],
};

// Keep the style IDs used in saved preferences.
const SOUND_STYLES = {
  bell: { file: "bell-tubular", transpose: 5, gain: .52 },
  beep: { file: "bell-hand", transpose: 0, gain: .72 },
  pulse: { file: "bell-hand", transpose: -5, gain: .51 },
  sport: { file: "sport-whistle", workFile: "sport-whistle-long", phrases: SPORT_PHRASES, transpose: 0, gain: .78 },
};

function soundStyle(name) {
  return Object.hasOwn(SOUND_STYLES, name) ? SOUND_STYLES[name] : SOUND_STYLES.bell;
}

const MIX_RATE = 24_000;

function wavBlob(samples) {
  const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
  wav.setUint32(0, 0x52494646); // RIFF
  wav.setUint32(4, wav.byteLength - 8, true);
  wav.setUint32(8, 0x57415645); // WAVE
  wav.setUint32(12, 0x666d7420); // fmt
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // Mono
  wav.setUint32(24, MIX_RATE, true);
  wav.setUint32(28, MIX_RATE * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  wav.setUint32(36, 0x64617461); // data
  wav.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    wav.setInt16(44 + index * 2, Math.max(-1, Math.min(1, samples[index])) * 32767, true);
  }
  return new Blob([wav], { type: "audio/wav" });
}

async function renderCue(seconds, draw) {
  const context = new OfflineAudioContext(1, Math.ceil(seconds * MIX_RATE), MIX_RATE);
  draw(context);
  return wavBlob((await context.startRendering()).getChannelData(0));
}

let activationClip;

class MediaCuePlayer {
  #audio = new Audio();
  #activation;
  #needsGesture = true;
  #request = 0;
  #url;
  #settingsKey;
  #mixes = new Map();

  activate() {
    if (!this.#needsGesture) return;
    this.stop();
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {
      // An audio session is optional for media element playback.
    }
    // WebKit grants autoplay permission to the element used in the tap handler.
    activationClip ??= URL.createObjectURL(wavBlob(new Float32Array(720)));
    this.#audio.src = activationClip;
    const activation = this.#audio.play().then(() => {
      if (this.#activation === activation && !document.hidden) this.#needsGesture = false;
      return true;
    }, () => false);
    this.#activation = activation;
  }

  interrupt() {
    this.#needsGesture = true;
  }

  #releaseClip() {
    if (!this.#url) return;
    this.#audio.pause();
    URL.revokeObjectURL(this.#url);
    this.#url = undefined;
  }

  stop() {
    this.#request++;
    this.#releaseClip();
  }

  async play(kind, settings, render) {
    if (!this.#activation) return;
    const request = ++this.#request;
    const settingsKey = `${settings.sound}:${settings.soundStyle}:${settings.voice}:${settings.volume}`;
    if (settingsKey !== this.#settingsKey) {
      this.#settingsKey = settingsKey;
      this.#mixes.clear();
    }
    if (!this.#mixes.has(kind)) this.#mixes.set(kind, render());
    const mix = this.#mixes.get(kind);
    let clip;
    try {
      clip = await mix;
    } catch {
      if (this.#mixes.get(kind) === mix) this.#mixes.delete(kind);
      return;
    }
    if (!clip && this.#mixes.get(kind) === mix) this.#mixes.delete(kind);
    if (!clip || !(await this.#activation) || request !== this.#request) return;
    this.#releaseClip();
    this.#url = URL.createObjectURL(clip);
    this.#audio.src = this.#url;
    try {
      await this.#audio.play();
    } catch {
      if (request === this.#request) this.interrupt();
    }
  }
}

function phaseTracks(clip, style, cue, volume, hasVoice) {
  if (!clip) return { tracks: [], voiceAt: 0 };
  const notes = (style.phrases ?? BELL_PHRASES)[cue];
  const voiceAt = Math.max(notes.at(-1)[0] + .32, cue === "work" && style.workFile ? clip.duration : 0);
  const tracks = notes.map(([offset, pitch, level]) => ({
    clip, offset, volume: volume * style.gain * level, rate: 2 ** ((pitch + style.transpose) / 12),
    ring: hasVoice ? voiceAt - offset : Infinity,
  }));
  return { tracks, voiceAt };
}

export class WorkoutCues {
  #context;
  #media;
  #buffers = new Map();
  #playing = new Set();
  #sequence = 0;

  constructor({ useMedia = false } = {}) {
    if (useMedia && typeof OfflineAudioContext === "function") this.#media = new MediaCuePlayer();
  }

  prepare(settings, activate = true) {
    if ((!settings.sound && !settings.voice) || !settings.volume) return;
    try {
      if (this.#media) {
        if (activate) this.#media.activate();
        this.#context ??= new OfflineAudioContext(1, 1, MIX_RATE);
      } else {
        this.#context ??= new AudioContext();
      }
    } catch {
      return;
    }

    if (!this.#media && this.#context.state !== "running") this.#context.resume().catch(() => {});
    if (settings.sound) {
      const { file, workFile } = soundStyle(settings.soundStyle);
      this.#load(file);
      if (workFile) this.#load(workFile);
    }
    if (settings.voice) {
      for (const phase of Object.keys(BELL_PHRASES)) this.#load(`voice-${phase}`);
    }
  }

  #load(file) {
    if (!this.#buffers.has(file)) {
      const loading = fetch(`./assets/${file}.wav`).then(async (response) => {
        if (!response.ok) throw new Error(`Audio asset unavailable: ${file}`);
        return this.#context.decodeAudioData(await response.arrayBuffer());
      }).catch(() => {
        this.#buffers.delete(file);
      });
      this.#buffers.set(file, loading);
    }
    return this.#buffers.get(file);
  }

  stop() {
    this.#sequence++;
    this.#media?.stop();
    for (const source of this.#playing) source.stop();
    this.#playing.clear();
  }

  interrupt() {
    this.#media?.interrupt();
  }

  #schedule(source, start) {
    this.#playing.add(source);
    source.onended = () => this.#playing.delete(source);
    source.start(start);
  }

  #start(context, buffer, start, volume, rate = 1, ring = Infinity) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    const shortened = ring < buffer.duration / rate;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    if (shortened) {
      gain.gain.setValueAtTime(volume, start + Math.max(0, ring - .14));
      gain.gain.linearRampToValueAtTime(0, start + ring);
    }
    source.connect(gain).connect(context.destination);
    if (context === this.#context) this.#schedule(source, start);
    else source.start(start);
    if (shortened) source.stop(start + ring);
  }

  #bip(context, volume) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    const end = start + .09;
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume * .22, start + .005);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain).connect(context.destination);
    if (context === this.#context) this.#schedule(oscillator, start);
    else oscillator.start(start);
    oscillator.stop(end);
  }

  async countdown(settings) {
    const context = this.#context;
    if (!settings.sound || !settings.volume || !context) return;
    const volume = settings.volume / 100;
    if (this.#media) {
      return this.#media.play("countdown", settings, () => renderCue(.09, (output) => this.#bip(output, volume)));
    }
    const sequence = this.#sequence;
    if (context.state !== "running") await context.resume().catch(() => {});
    if (sequence === this.#sequence && context.state === "running") this.#bip(context, volume);
  }

  async play(phase, settings) {
    this.stop();
    if ((!settings.sound && !settings.voice) || !settings.volume || !this.#context) return;
    const sequence = this.#sequence;
    if (!this.#media && this.#context.state !== "running") {
      await this.#context.resume().catch(() => {});
    }
    if (sequence !== this.#sequence || (!this.#media && this.#context.state !== "running")) return;

    const context = this.#context;
    const volume = settings.volume / 100;
    const style = soundStyle(settings.soundStyle);
    const cue = phase === "cycleRest" ? "rest" : phase;
    const workFile = cue === "work" ? style.workFile : undefined;
    const voice = settings.voice ? this.#load(`voice-${cue}`) : undefined;
    const loading = settings.sound ? this.#load(workFile ?? style.file) : undefined;
    if (this.#media) {
      return this.#media.play(cue, settings, async () => {
        const [clip, speech] = await Promise.all([loading, voice]);
        if (!clip && !speech) return;
        const { tracks, voiceAt } = phaseTracks(clip, style, cue, volume, Boolean(speech));
        if (speech) tracks.push({ clip: speech, offset: voiceAt, volume, rate: 1, ring: Infinity });
        const seconds = Math.max(...tracks.map((track) => track.offset + Math.min(track.ring, track.clip.duration / track.rate)));
        return renderCue(seconds, (output) => {
          for (const note of tracks) this.#start(output, note.clip, note.offset, note.volume, note.rate, note.ring);
        });
      });
    }
    const clip = await loading;
    if (sequence !== this.#sequence || context.state !== "running") return;

    const start = context.currentTime;
    const { tracks, voiceAt } = phaseTracks(clip, style, cue, volume, Boolean(voice));
    for (const note of tracks) this.#start(context, note.clip, start + note.offset, note.volume, note.rate, note.ring);

    const speech = await voice;
    if (speech && sequence === this.#sequence && context.state === "running") {
      this.#start(context, speech, Math.max(start + voiceAt, context.currentTime), volume);
    }
  }
}

export class ScreenAwake {
  #sentinel;
  #pending = false;
  #wanted = false;
  #status = "";
  #onChange;

  constructor(onChange) {
    this.#onChange = onChange;
  }

  #show(status) {
    if (status !== this.#status) {
      this.#status = status;
      this.#onChange(status);
    }
  }

  async update(wanted, retry = false) {
    const changed = this.#wanted !== wanted;
    this.#wanted = wanted;
    if (!wanted || document.hidden) {
      const sentinel = this.#sentinel;
      this.#sentinel = undefined;
      if (sentinel) await sentinel.release().catch(() => {});
      if (!this.#wanted || document.hidden) this.#show("");
      return;
    }

    if (this.#sentinel || this.#pending || (!changed && !retry)) return;
    if (!navigator.wakeLock) {
      this.#show("unavailable");
      return;
    }

    this.#pending = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!this.#wanted || document.hidden) {
        await sentinel.release();
        return;
      }
      this.#sentinel = sentinel;
      this.#show("held");
      sentinel.addEventListener("release", () => {
        if (this.#sentinel === sentinel) {
          this.#sentinel = undefined;
          this.#show(this.#wanted && !document.hidden ? "unavailable" : "");
        }
      }, { once: true });
    } catch {
      this.#show(this.#wanted && !document.hidden ? "unavailable" : "");
    } finally {
      this.#pending = false;
    }
  }
}
