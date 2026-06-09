/* ── Button click sound design ─────────────────────────────────────────────
 *
 * Realistic button sounds using audio samples from langlink.
 * Uses Web Audio API for low-latency playback with press/release variants.
 *
 * Sound files:
 *  - /sounds/click.mp3   - Generic click (down/up variants via playback rate)
 *  - /sounds/key-on.mp3  - Key press sound (split into press/release)
 *  - /sounds/key-off.mp3 - Alternative key sound (split into press/release)
 */

// Bundle audio as inlined data: URIs. Packaged builds load the renderer over
// file://, and Chromium blocks fetch() of file:// URLs — so resolving sounds to
// file:// paths (the old behaviour) silently failed in the DMG. data: URIs are
// fetchable under file:// and work in dev too.
import clickMp3 from "./sounds/click.mp3?inline";
import keyOnMp3 from "./sounds/key-on.mp3?inline";
import keyOffMp3 from "./sounds/key-off.mp3?inline";
import click01Mp3 from "./sounds/click_01.mp3?inline";

export type ButtonClickVariant = "click" | "key" | "rotary" | "none";

/** Button categories for per-category sound settings */
export type ButtonCategory = "primary" | "navigation" | "toggle" | "secondary" | "destructive";

export interface ButtonSoundSettings {
  readonly primary: ButtonClickVariant;
  readonly navigation: ButtonClickVariant;
  readonly toggle: ButtonClickVariant;
  readonly secondary: ButtonClickVariant;
  readonly destructive: ButtonClickVariant;
}

export const DEFAULT_BUTTON_SOUND_SETTINGS: ButtonSoundSettings = {
  primary: "click",
  navigation: "none",
  toggle: "key",
  secondary: "none",
  destructive: "click",
};

export const BUTTON_CLICK_VARIANTS: readonly ButtonClickVariant[] = ["click", "key", "rotary", "none"];

export const BUTTON_CATEGORY_LABELS: Record<ButtonCategory, string> = {
  primary: "Primary actions",
  navigation: "Navigation",
  toggle: "Toggle buttons",
  secondary: "Secondary actions",
  destructive: "Destructive actions",
};

export const BUTTON_CATEGORY_DESCRIPTIONS: Record<ButtonCategory, string> = {
  primary: "Submit, send, start thread, confirm",
  navigation: "Sidebar items, view switching",
  toggle: "Caveman, composer mode, queue mode",
  secondary: "Refresh, copy, open folder",
  destructive: "Delete, remove, cancel",
};

let currentSettings: ButtonSoundSettings = { ...DEFAULT_BUTTON_SOUND_SETTINGS };

export function getButtonSoundSettings(): ButtonSoundSettings {
  return { ...currentSettings };
}

/* ── Audio engine (based on langlink's clickSound.ts) ──────────────────── */

type ClickKind = "down" | "up";
type KeyPhase = "press" | "release";

const URLS: { click: string; keys: string[]; rotary: string[] } = {
  click: clickMp3,
  keys: [keyOnMp3, keyOffMp3],
  rotary: [click01Mp3],
};

const CLICK_RATE: Record<ClickKind, number> = { down: 0.78, up: 1 };

let context: AudioContext | undefined;
let masterGain: GainNode | undefined;

let clickBuffer: AudioBuffer | undefined;
let keyBuffers: Array<{ press: AudioBuffer; release: AudioBuffer }> = [];
let rotaryBuffers: AudioBuffer[] = [];

let loadPromise: Promise<void> | undefined;

let keyRotateIdx = 0;
let lastKeyPressIdx = 0;

let settingsLoaded = false;

/** Load settings from localStorage on first use */
function ensureSettingsLoaded(): void {
  if (settingsLoaded) return;
  settingsLoaded = true;
  try {
    const stored = localStorage.getItem("pi:button-sound-settings");
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ButtonSoundSettings>;
      currentSettings = { ...DEFAULT_BUTTON_SOUND_SETTINGS, ...parsed };
    }
  } catch {
    // ignore parse errors
  }
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    masterGain = context.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(context.destination);
  }
  return context;
}

async function fetchBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const data = await response.arrayBuffer();
    return await ctx.decodeAudioData(data);
  } catch {
    return undefined;
  }
}

function computeEnvelope(channel: Float32Array, windowSize: number): Float32Array {
  const numWindows = Math.floor(channel.length / windowSize);
  const envelope = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w += 1) {
    let sumSq = 0;
    const start = w * windowSize;
    for (let i = 0; i < windowSize; i += 1) {
      const sample = channel[start + i] ?? 0;
      sumSq += sample * sample;
    }
    envelope[w] = Math.sqrt(sumSq / windowSize);
  }
  return envelope;
}

function sliceBuffer(
  ctx: AudioContext,
  source: AudioBuffer,
  startSample: number,
  endSample: number
): AudioBuffer {
  const length = Math.max(1, endSample - startSample);
  const out = ctx.createBuffer(source.numberOfChannels, length, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch += 1) {
    const channelData = source.getChannelData(ch);
    if (channelData) {
      const data = channelData.subarray(startSample, startSample + length);
      out.copyToChannel(data, ch);
    }
  }
  return out;
}

function trimSilence(ctx: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const channel = buffer.getChannelData(0);
  if (!channel) return buffer;
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.003));
  const envelope = computeEnvelope(channel, windowSize);

  let peak = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    const val = envelope[i] ?? 0;
    if (val > peak) peak = val;
  }
  if (peak === 0) return buffer;
  const threshold = peak * 0.04;

  let firstWindow = 0;
  while (firstWindow < envelope.length && (envelope[firstWindow] ?? 0) < threshold) firstWindow += 1;

  let lastWindow = envelope.length - 1;
  while (lastWindow > firstWindow && (envelope[lastWindow] ?? 0) < threshold) lastWindow -= 1;

  const lead = Math.floor(sampleRate * 0.002);
  const tail = Math.floor(sampleRate * 0.025);
  const start = Math.max(0, firstWindow * windowSize - lead);
  const end = Math.min(channel.length, (lastWindow + 1) * windowSize + tail);
  if (end - start < windowSize * 2) return buffer;

  return sliceBuffer(ctx, buffer, start, end);
}

function splitKeySample(
  ctx: AudioContext,
  buffer: AudioBuffer
): { press: AudioBuffer; release: AudioBuffer } {
  const channel = buffer.getChannelData(0);
  if (!channel) {
    const whole = trimSilence(ctx, buffer);
    return { press: whole, release: whole };
  }
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.003));
  const envelope = computeEnvelope(channel, windowSize);

  let peakAIdx = 0;
  let peakAVal = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    const val = envelope[i] ?? 0;
    if (val > peakAVal) {
      peakAVal = val;
      peakAIdx = i;
    }
  }

  const minGap = Math.max(1, Math.floor(0.04 / 0.003));
  const valleyThreshold = peakAVal * 0.08;
  let valleyIdx = peakAIdx + minGap;
  while (valleyIdx < envelope.length && (envelope[valleyIdx] ?? 0) >= valleyThreshold) valleyIdx += 1;
  if (valleyIdx >= envelope.length) {
    const whole = trimSilence(ctx, buffer);
    return { press: whole, release: whole };
  }

  let peakBIdx = valleyIdx;
  let peakBVal = 0;
  for (let i = valleyIdx; i < envelope.length; i += 1) {
    const val = envelope[i] ?? 0;
    if (val > peakBVal) {
      peakBVal = val;
      peakBIdx = i;
    }
  }

  if (peakBVal < peakAVal * 0.1) {
    const whole = trimSilence(ctx, buffer);
    return { press: whole, release: whole };
  }

  let splitWindowIdx = peakBIdx;
  let splitVal = envelope[peakBIdx] ?? 0;
  for (let i = peakAIdx + minGap; i < peakBIdx; i += 1) {
    const val = envelope[i] ?? 0;
    if (val < splitVal) {
      splitVal = val;
      splitWindowIdx = i;
    }
  }

  const lead = Math.floor(sampleRate * 0.003);
  const tail = Math.floor(sampleRate * 0.025);

  const pressStart = Math.max(0, peakAIdx * windowSize - lead);
  const splitSample = splitWindowIdx * windowSize;
  const pressEnd = Math.min(channel.length, splitSample + Math.floor(sampleRate * 0.01));

  const releaseStart = Math.max(splitSample, peakBIdx * windowSize - lead);
  let releaseEndWindow = envelope.length - 1;
  const tailThreshold = peakBVal * 0.08;
  while (releaseEndWindow > peakBIdx && (envelope[releaseEndWindow] ?? 0) < tailThreshold) {
    releaseEndWindow -= 1;
  }
  const releaseEnd = Math.min(channel.length, (releaseEndWindow + 1) * windowSize + tail);

  return {
    press: sliceBuffer(ctx, buffer, pressStart, pressEnd),
    release: sliceBuffer(ctx, buffer, releaseStart, releaseEnd),
  };
}

function loadAll(): Promise<void> {
  if (loadPromise) return loadPromise;
  const ctx = getContext();
  if (!ctx) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  const urls = URLS;
  loadPromise = (async () => {
    const [rawClick, ...rawKeys] = await Promise.all([
      fetchBuffer(ctx, urls.click),
      ...urls.keys.map((url) => fetchBuffer(ctx, url)),
    ]);
    if (rawClick) clickBuffer = trimSilence(ctx, rawClick);
    keyBuffers = rawKeys
      .filter((b): b is AudioBuffer => Boolean(b))
      .map((b) => splitKeySample(ctx, b));
    
    const rawRotary = await Promise.all(
      urls.rotary.map((url) => fetchBuffer(ctx, url))
    );
    rotaryBuffers = rawRotary
      .filter((b): b is AudioBuffer => Boolean(b))
      .map((b) => trimSilence(ctx, b));
  })();

  return loadPromise;
}

async function ensureContextRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "running") return true;
  try {
    await ctx.resume();
    return true;
  } catch {
    return false;
  }
}

async function fire(buffer: AudioBuffer, rate = 1): Promise<void> {
  const ctx = getContext();
  if (!ctx || !masterGain) return;
  if (!(await ensureContextRunning(ctx))) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(masterGain);
  source.start();
}

/** Preload all audio buffers. Call early (e.g. app mount) to avoid latency on first button press. */
export function preloadSounds(): void {
  void loadAll();
}

/** Play a click sound (down = lower pitch, up = normal pitch) */
export function playClick(kind: ClickKind = "down"): void {
  if (clickBuffer) {
    void fire(clickBuffer, CLICK_RATE[kind] ?? 1);
    return;
  }
  void loadAll().then(() => {
    if (clickBuffer) void fire(clickBuffer, CLICK_RATE[kind] ?? 1);
  });
}

/** Play a key sound (press/release pair) */
export function playKey(phase: KeyPhase = "press"): void {
  if (keyBuffers.length === 0) {
    void loadAll().then(() => {
      if (keyBuffers.length > 0) playKey(phase);
    });
    return;
  }

  if (phase === "press") {
    const idx = keyRotateIdx % keyBuffers.length;
    keyRotateIdx = (keyRotateIdx + 1) % keyBuffers.length;
    lastKeyPressIdx = idx;
    const keyBuffer = keyBuffers[idx];
    if (keyBuffer) void fire(keyBuffer.press);
  } else {
    const lastBuffer = keyBuffers[lastKeyPressIdx];
    if (lastBuffer) void fire(lastBuffer.release);
  }
}

/** Play a random rotary switch sound */
export function playRotary(): void {
  if (rotaryBuffers.length === 0) {
    void loadAll().then(() => {
      if (rotaryBuffers.length > 0) playRotary();
    });
    return;
  }

  const idx = Math.floor(Math.random() * rotaryBuffers.length);
  const buffer = rotaryBuffers[idx];
  if (buffer) void fire(buffer, 0.9 + Math.random() * 0.2); // slight pitch variation
}

/** Play button click (legacy API, uses primary category) */
export function playButtonClick(variant?: ButtonClickVariant): void {
  ensureSettingsLoaded();
  const resolvedVariant = variant ?? currentSettings.primary;
  if (resolvedVariant === "none") return;

  if (resolvedVariant === "click") {
    playClick("down");
  } else if (resolvedVariant === "key") {
    playKey("press");
  } else if (resolvedVariant === "rotary") {
    playRotary();
  }
}

/** Play secondary button sound (higher-pitched click) */
export function playButtonSecondary(variant?: ButtonClickVariant): void {
  ensureSettingsLoaded();
  const resolvedVariant = variant ?? currentSettings.secondary;
  if (resolvedVariant === "none") return;

  if (resolvedVariant === "click") {
    playClick("up"); // up is higher-pitched
  } else if (resolvedVariant === "key") {
    playKey("release");
  } else if (resolvedVariant === "rotary") {
    playRotary();
  }
}
