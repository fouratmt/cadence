// Each note gives its start in seconds, pitch in semitones, and relative level.
const BELL_PHRASES = {
  prepare: [[0, -5, .65], [.23, 0, .74]],
  work: [[0, 0, .85], [.14, 4, .78], [.32, 7, 1]],
  rest: [[0, 2, .78], [.22, -3, .74]],
  cooldown: [[0, 4, .69], [.24, 2, .65], [.48, -5, .76]],
  finished: [[0, -5, .75], [.17, 0, .83], [.35, 4, .79], [.56, 0, .35], [.56, 7, .94]],
};

// Keep the style IDs used in saved preferences.
const BELL_STYLES = {
  bell: { file: "bell-tubular", transpose: 5, gain: .52 },
  beep: { file: "bell-hand", transpose: 0, gain: .72 },
  pulse: { file: "bell-hand", transpose: -5, gain: .51 },
};

function bellStyle(name) {
  return Object.hasOwn(BELL_STYLES, name) ? BELL_STYLES[name] : BELL_STYLES.bell;
}

export class WorkoutCues {
  #context;
  #buffers = new Map();
  #playing = new Set();
  #sequence = 0;

  prepare(settings) {
    if ((!settings.sound && !settings.voice) || !settings.volume) return;
    try {
      this.#context ??= new AudioContext();
    } catch {
      return;
    }

    if (this.#context.state !== "running") this.#context.resume().catch(() => {});
    if (settings.sound) this.#load(bellStyle(settings.soundStyle).file);
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
    for (const source of this.#playing) source.stop();
    this.#playing.clear();
  }

  #start(buffer, start, volume, rate = 1, ring = Infinity) {
    const context = this.#context;
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
    this.#playing.add(source);
    source.onended = () => this.#playing.delete(source);
    source.start(start);
    if (shortened) source.stop(start + ring);
  }

  async play(phase, settings) {
    this.stop();
    if ((!settings.sound && !settings.voice) || !settings.volume || !this.#context) return;
    const sequence = this.#sequence;
    if (this.#context.state !== "running") {
      await this.#context.resume().catch(() => {});
    }
    if (sequence !== this.#sequence || this.#context.state !== "running") return;

    const context = this.#context;
    const volume = settings.volume / 100;
    const style = bellStyle(settings.soundStyle);
    const voice = settings.voice ? this.#load(`voice-${phase}`) : undefined;
    const bell = settings.sound ? await this.#load(style.file) : undefined;
    if (sequence !== this.#sequence || context.state !== "running") return;

    let speechStart = context.currentTime;
    if (bell) {
      const start = context.currentTime;
      const notes = BELL_PHRASES[phase];
      const speechOffset = notes.at(-1)[0] + .32;
      for (const [offset, pitch, level] of notes) {
        const rate = 2 ** ((pitch + style.transpose) / 12);
        const ring = voice ? speechOffset - offset : Infinity;
        this.#start(bell, start + offset, volume * style.gain * level, rate, ring);
      }
      speechStart = start + speechOffset;
    }

    const speech = await voice;
    if (speech && sequence === this.#sequence && context.state === "running") {
      this.#start(speech, Math.max(speechStart, context.currentTime), volume);
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
