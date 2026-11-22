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

function installAudio(t) {
  const started = [];
  const stopped = [];
  const gains = [];

  function source(kind) {
    const node = {
      kind,
      connect: (destination) => destination,
      start: (when) => started.push({ node, when }),
      stop: (when) => stopped.push({ node, when }),
    };
    return node;
  }

  setGlobal(t, "AudioContext", class {
    state = "running";
    currentTime = 5;

    createOscillator() {
      return Object.assign(source("tone"), { frequency: {} });
    }

    createBufferSource() {
      return source("voice");
    }

    createGain() {
      const gain = {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
      gains.push(gain.gain);
      return gain;
    }

    async decodeAudioData(buffer) {
      return buffer;
    }
  });
  return { started, stopped, gains };
}

test("plays phase tones and respects sound style and mute settings", async (t) => {
  const { started } = installAudio(t);
  const cues = new WorkoutCues();
  cues.prepare(false);

  await cues.play("work", { ...DEFAULT_SETTINGS, soundStyle: "pulse" });
  assert.equal(started.length, 2);
  assert.equal(started[0].node.type, "triangle");
  assert.ok(started[1].when > started[0].when);

  await cues.play("rest", { ...DEFAULT_SETTINGS, sound: false });
  await cues.play("rest", { ...DEFAULT_SETTINGS, volume: 0 });
  assert.equal(started.length, 2);
});

test("plays the bundled voice after the tone and applies the selected volume", async (t) => {
  const { started, gains } = installAudio(t);
  const requests = [];
  const speech = new ArrayBuffer(8);
  setGlobal(t, "fetch", async (url) => {
    requests.push(url);
    return { ok: true, arrayBuffer: async () => speech };
  });
  const cues = new WorkoutCues();
  cues.prepare(true);
  await cues.play("work", { ...DEFAULT_SETTINGS, voice: true, volume: 35 });

  assert.equal(requests.length, 5);
  assert.ok(requests.includes("./assets/voice-work.wav"));
  const voice = started.at(-1);
  assert.equal(voice.node.kind, "voice");
  assert.equal(voice.node.buffer, speech);
  assert.ok(voice.when > started[1].when);
  assert.equal(gains.at(-1).value, 0.35);
});

test("cancels an in-flight spoken cue when the workout is paused", async (t) => {
  const { started, stopped } = installAudio(t);
  const loading = Promise.withResolvers();
  setGlobal(t, "fetch", () => loading.promise);
  const cues = new WorkoutCues();
  cues.prepare(true);
  const playback = cues.play("work", { ...DEFAULT_SETTINGS, voice: true });
  cues.stop();
  loading.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await playback;

  assert.deepEqual(started.map(({ node }) => node.kind), ["tone", "tone"]);
  assert.equal(stopped.filter(({ when }) => when === undefined).length, 2);
});

test("falls back to tones during a voice fetch failure and retries on the next preparation", async (t) => {
  const { started } = installAudio(t);
  let canFetch = false;
  setGlobal(t, "fetch", async () => ({ ok: canFetch, arrayBuffer: async () => new ArrayBuffer(8) }));
  const cues = new WorkoutCues();
  const settings = { ...DEFAULT_SETTINGS, voice: true };

  cues.prepare(true);
  await cues.play("prepare", settings);
  assert.deepEqual(started.map(({ node }) => node.kind), ["tone"]);

  canFetch = true;
  cues.prepare(true);
  await cues.play("work", { ...settings, sound: false });
  assert.deepEqual(started.map(({ node }) => node.kind), ["tone", "voice"]);
});

test("tolerates a browser without Web Audio", async (t) => {
  setGlobal(t, "AudioContext", undefined);
  const cues = new WorkoutCues();
  cues.prepare(true);
  await cues.play("work", { ...DEFAULT_SETTINGS, voice: true });
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
