import assert from "node:assert/strict";
import { test } from "node:test";
import { ScreenAwake, WorkoutCues } from "../../cues.mjs";
import { DEFAULT_SETTINGS } from "../../timer.mjs";

function setGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

function audioResponse(file) {
  return { ok: true, arrayBuffer: async () => ({ file, duration: 1.2 }) };
}

function installAudio(t, fetchAudio = async (file) => audioResponse(file)) {
  const started = [];
  const stopped = [];
  const gains = [];
  const requests = [];

  setGlobal(t, "fetch", (file) => {
    requests.push(file);
    return fetchAudio(file);
  });

  setGlobal(t, "AudioContext", class {
    state = "running";
    currentTime = 5;

    createBufferSource() {
      const node = {
        playbackRate: {},
        connect: (destination) => destination,
        start: (when) => started.push({ node, when }),
        stop: (when) => stopped.push({ node, when }),
      };
      return node;
    }

    createGain() {
      const gain = {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
      };
      gains.push(gain.gain);
      return gain;
    }

    async decodeAudioData(buffer) {
      return buffer;
    }
  });
  return { started, stopped, gains, requests };
}

test("plays a rising work melody and a descending rest melody using recorded bells", async (t) => {
  const { started, requests } = installAudio(t);
  const cues = new WorkoutCues();
  cues.prepare(DEFAULT_SETTINGS);

  await cues.play("work", DEFAULT_SETTINGS);
  assert.equal(started.length, 3);
  assert.deepEqual(requests, ["./assets/bell-tubular.wav"]);
  assert.ok(started.every(({ node }) => node.buffer.file === "./assets/bell-tubular.wav"));
  assert.ok(started[0].when < started[1].when && started[1].when < started[2].when);
  assert.ok(started[0].node.playbackRate.value < started[1].node.playbackRate.value);
  assert.ok(started[1].node.playbackRate.value < started[2].node.playbackRate.value);

  const setting = { ...DEFAULT_SETTINGS, soundStyle: "pulse" };
  await cues.play("rest", setting);
  const rest = started.slice(3);
  assert.equal(rest.length, 2);
  assert.ok(rest.every(({ node }) => node.buffer.file === "./assets/bell-hand.wav"));
  assert.ok(rest[0].node.playbackRate.value > rest[1].node.playbackRate.value);
  await cues.play("rest", { ...setting, sound: false });
  await cues.play("rest", { ...setting, volume: 0 });
  assert.equal(started.length, 5);
});

test("plays the bundled voice after the bell phrase and applies the selected volume", async (t) => {
  const { started, gains, requests, stopped } = installAudio(t);
  const cues = new WorkoutCues();
  const settings = { ...DEFAULT_SETTINGS, voice: true, volume: 35 };
  cues.prepare(settings);
  await cues.play("work", settings);

  assert.equal(requests.length, 6);
  assert.ok(requests.includes("./assets/voice-work.wav"));
  const voice = started.at(-1);
  assert.equal(voice.node.buffer.file, "./assets/voice-work.wav");
  assert.ok(voice.when > started[2].when);
  assert.equal(stopped.length, 3);
  assert.ok(stopped.every(({ when }) => when <= voice.when + 1e-9));
  assert.equal(gains.at(-1).value, 0.35);
});

test("cancels scheduled bells and a voice that is still loading when the workout pauses", async (t) => {
  const loading = Promise.withResolvers();
  const { started, stopped } = installAudio(t, async (file) =>
    file.includes("/voice-") ? loading.promise : audioResponse(file));
  const cues = new WorkoutCues();
  const settings = { ...DEFAULT_SETTINGS, voice: true };
  cues.prepare(settings);
  const playback = cues.play("work", settings);
  await new Promise(setImmediate);
  assert.equal(started.length, 3);

  cues.stop();
  loading.resolve(audioResponse("./assets/voice-work.wav"));
  await playback;
  assert.equal(started.length, 3);
  assert.equal(stopped.filter(({ when }) => when === undefined).length, 3);
});

test("does not play a bell whose download completed after reset", async (t) => {
  const loading = Promise.withResolvers();
  const { started } = installAudio(t, () => loading.promise);
  const cues = new WorkoutCues();
  cues.prepare(DEFAULT_SETTINGS);
  const playback = cues.play("work", DEFAULT_SETTINGS);
  cues.stop();
  loading.resolve(audioResponse("./assets/bell-tubular.wav"));
  await playback;
  assert.equal(started.length, 0);
});

test("keeps the bells when voice loading fails and retries the voice on the next preparation", async (t) => {
  let canFetchVoice = false;
  const { started } = installAudio(t, async (file) =>
    !canFetchVoice && file.includes("/voice-") ? { ok: false } : audioResponse(file));
  const cues = new WorkoutCues();
  const settings = { ...DEFAULT_SETTINGS, voice: true };

  cues.prepare(settings);
  await cues.play("prepare", settings);
  assert.deepEqual(started.map(({ node }) => node.buffer.file), [
    "./assets/bell-tubular.wav", "./assets/bell-tubular.wav",
  ]);

  canFetchVoice = true;
  const voiceOnly = { ...settings, sound: false };
  cues.prepare(voiceOnly);
  await cues.play("work", voiceOnly);
  assert.equal(started.at(-1).node.buffer.file, "./assets/voice-work.wav");
});

test("tolerates a browser without Web Audio", async (t) => {
  setGlobal(t, "AudioContext", undefined);
  const cues = new WorkoutCues();
  const settings = { ...DEFAULT_SETTINGS, voice: true };
  cues.prepare(settings);
  await cues.play("work", settings);
});

class FakeWakeLock extends EventTarget {
  releases = 0;

  async release() {
    this.releases++;
    this.dispatchEvent(new Event("release"));
  }
}

test("holds a single wake lock, releases it when hidden, and reacquires on return", async (t) => {
  const document = { hidden: false };
  const locks = [];
  const statuses = [];
  setGlobal(t, "document", document);
  setGlobal(t, "navigator", { wakeLock: {
    async request(type) {
      assert.equal(type, "screen");
      const lock = new FakeWakeLock();
      locks.push(lock);
      return lock;
    },
  } });
  const wake = new ScreenAwake((status) => statuses.push(status));

  await wake.update(true);
  await wake.update(true, true);
  assert.equal(locks.length, 1);

  document.hidden = true;
  await wake.update(true);
  assert.equal(locks[0].releases, 1);
  document.hidden = false;
  await wake.update(true, true);
  await wake.update(false);

  assert.equal(locks.length, 2);
  assert.equal(locks[1].releases, 1);
  assert.deepEqual(statuses, ["held", "", "held", ""]);
});

test("releases a pending wake lock that arrives after pause", async (t) => {
  const pending = Promise.withResolvers();
  let requests = 0;
  setGlobal(t, "document", { hidden: false });
  setGlobal(t, "navigator", { wakeLock: { request: () => {
    requests++;
    return pending.promise;
  } } });
  const statuses = [];
  const wake = new ScreenAwake((status) => statuses.push(status));

  const acquiring = wake.update(true);
  await wake.update(true, true);
  await wake.update(false);
  const lock = new FakeWakeLock();
  pending.resolve(lock);
  await acquiring;

  assert.equal(requests, 1);
  assert.equal(lock.releases, 1);
  assert.deepEqual(statuses, []);
});

test("reports unavailable wake lock support without failing the timer", async (t) => {
  setGlobal(t, "document", { hidden: false });
  setGlobal(t, "navigator", {});
  const statuses = [];
  const wake = new ScreenAwake((status) => statuses.push(status));
  await wake.update(true);
  await wake.update(false);
  assert.deepEqual(statuses, ["unavailable", ""]);
});

test("reports browser denial and retries when the browser becomes eligible", async (t) => {
  let denied = true;
  setGlobal(t, "document", { hidden: false });
  setGlobal(t, "navigator", { wakeLock: { async request() {
    if (denied) throw new Error("Power saving");
    return new FakeWakeLock();
  } } });
  const statuses = [];
  const wake = new ScreenAwake((status) => statuses.push(status));

  await wake.update(true);
  denied = false;
  await wake.update(true, true);
  assert.deepEqual(statuses, ["unavailable", "held"]);
});

test("reports a wake lock revoked by the system", async (t) => {
  const lock = new FakeWakeLock();
  const statuses = [];
  setGlobal(t, "document", { hidden: false });
  setGlobal(t, "navigator", { wakeLock: { request: async () => lock } });
  const wake = new ScreenAwake((status) => statuses.push(status));

  await wake.update(true);
  lock.dispatchEvent(new Event("release"));
  assert.deepEqual(statuses, ["held", "unavailable"]);
});
