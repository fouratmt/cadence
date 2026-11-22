const BEEPS = {
  prepare: [520],
  work: [760, 955],
  rest: [455, 350],
  cooldown: [525, 390],
  finished: [620, 780, 930],
};

export class WorkoutCues {
  #context;
  #voice;
  #playing = new Set();
  #sequence = 0;

  prepare(voice) {
    try {
      this.#context ??= new AudioContext();
    } catch {
      return;
    }

    if (this.#context.state !== "running") this.#context.resume().catch(() => {});
    if (voice && !this.#voice) {
      this.#voice = Promise.all(Object.keys(BEEPS).map(async (phase) => {
        const response = await fetch(`./assets/voice-${phase}.wav`);
        if (!response.ok) throw new Error("Voice asset unavailable");
        const buffer = await this.#context.decodeAudioData(await response.arrayBuffer());
        return [phase, buffer];
      })).then(Object.fromEntries).catch(() => {
        this.#voice = undefined;
        return {};
      });
    }
  }

  stop() {
    this.#sequence++;
    for (const source of this.#playing) source.stop();
    this.#playing.clear();
  }

  #start(source, start) {
    this.#playing.add(source);
    source.onended = () => this.#playing.delete(source);
    source.start(start);
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
    const notes = BEEPS[phase];
    const bell = settings.soundStyle === "bell";
    const pulse = settings.soundStyle === "pulse";
    const spacing = bell ? .19 : .135;
    const duration = bell ? .34 : .13;

    if (settings.sound) {
      notes.forEach((note, index) => {
        const start = context.currentTime + index * spacing;
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = note * (bell ? 1.42 : pulse ? .72 : 1);
        oscillator.type = pulse ? "triangle" : "sine";
        gain.gain.setValueAtTime(.001, start);
        gain.gain.exponentialRampToValueAtTime(volume * .28, start + .015);
        gain.gain.exponentialRampToValueAtTime(.001, start + duration);
        oscillator.connect(gain).connect(context.destination);
        this.#start(oscillator, start);
        oscillator.stop(start + duration);
      });
    }

    if (settings.voice) {
      const speech = await this.#voice;
      if (sequence !== this.#sequence || context.state !== "running" || !speech?.[phase]) return;
      const start = context.currentTime + (settings.sound ? (notes.length - 1) * spacing + duration : 0);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = speech[phase];
      gain.gain.value = volume;
      source.connect(gain).connect(context.destination);
      this.#start(source, start);
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
