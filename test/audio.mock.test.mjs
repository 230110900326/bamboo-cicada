// 竹知了 · 音频引擎控制逻辑测试（Node 端 WebAudio 模拟器）
// 加载真实的 js/audio.js + js/physics.js，用 Mock AudioContext 验证：
//   - 图形连线正确（振荡器→低通→AM→包络→主输出；噪声→带通→主输出；LFO→参数）
//   - 音高/响度/音色参数随转速连续、单调、门控正确
//   - 实时模式用 setTargetAtTime 平滑（无爆音）；离线模式用 setValueAtTime
// 运行：node test/audio.mock.test.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);

// ---- 加载真实引擎（physics.js 现在同时挂到 globalThis） ----
const physics = require("../js/physics.js");
assert.ok(globalThis.ZZLPHYS, "physics.js 应把 API 挂到 globalThis");
require("../js/audio.js");
assert.ok(globalThis.BambooAudio, "audio.js 应挂载 BambooAudio");
const { buzzLevel, pitchFromSpin } = physics;

// ---- Mock WebAudio ----
class MockParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];          // {method, value, time}
    this.inputs = [];         // 被连接的节点（调制输入）
  }
  setValueAtTime(v, t) { this.calls.push(["setValueAtTime", v, t]); this.value = v; }
  setTargetAtTime(v, t, tau) { this.calls.push(["setTargetAtTime", v, t, tau]); }
  linearRampToValueAtTime(v, t) { this.calls.push(["linearRamp", v, t]); }
  exponentialRampToValueAtTime(v, t) { this.calls.push(["expRamp", v, t]); }
}
class MockNode {
  constructor(ctx, kind) {
    this.ctx = ctx; this.kind = kind;
    this.outputs = [];
    this.started = false;
  }
  connect(target) { this.outputs.push(target); return target; }
  disconnect() { this.outputs = []; }
  start(t) { this.started = true; this.startTime = t; }
  stop(t) { this.stopped = true; }
}
class MockGain extends MockNode { constructor(ctx) { super(ctx, "gain"); this.gain = new MockParam(1); } }
class MockOscillator extends MockNode {
  constructor(ctx) { super(ctx, "osc"); this.frequency = new MockParam(440); this.detune = new MockParam(0); }
  setPeriodicWave(w) { this.wave = w; }
}
class MockBiquad extends MockNode { constructor(ctx) { super(ctx, "biquad"); this.type = "lowpass"; this.frequency = new MockParam(350); this.Q = new MockParam(1); } }
class MockCompressor extends MockNode {
  constructor(ctx) { super(ctx, "comp"); this.threshold = new MockParam(-24); this.knee = new MockParam(30); this.ratio = new MockParam(12); this.attack = new MockParam(0.003); this.release = new MockParam(0.25); }
}
class MockBufferSource extends MockNode {
  constructor(ctx) { super(ctx, "bufferSource"); this.loop = false; }
  set buffer(b) { this._buffer = b; }
  get buffer() { return this._buffer; }
}
class MockAudioContext {
  constructor() { this.currentTime = 0; this.destination = new MockNode(this, "destination"); this.nodes = []; }
  createGain() { const n = new MockGain(this); this.nodes.push(n); return n; }
  createOscillator() { const n = new MockOscillator(this); this.nodes.push(n); return n; }
  createBiquadFilter() { const n = new MockBiquad(this); this.nodes.push(n); return n; }
  createDynamicsCompressor() { const n = new MockCompressor(this); this.nodes.push(n); return n; }
  createBuffer(ch, len, sr) { return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { const n = new MockBufferSource(this); this.nodes.push(n); return n; }
  createPeriodicWave(real, imag) { return { real, imag }; }
  resume() { return Promise.resolve(); }
}

const mock = new MockAudioContext();
const audio = new globalThis.BambooAudio();
audio.ctx = mock;
audio.nodes = audio.buildGraph(mock, mock.destination);
const n = audio.nodes;

// ---- 1. 连线检查 ----
const oscOuts = [n.oscA, n.oscB, n.oscC].map((o) => o.outputs[0]);
assert.ok(oscOuts.every((t) => t === n.lp), "三个振荡器应接入低通");
assert.equal(n.lp.outputs[0], n.amGain, "低通→振幅调制载波");
assert.equal(n.amGain.outputs[0], n.buzzGain, "调制载波→总包络");
assert.equal(n.buzzGain.outputs[0], n.master, "包络→主增益");
assert.equal(n.master.outputs[0].kind, "comp", "主增益→压缩器（限幅防爆音）");
assert.equal(n.master.outputs[0].outputs[0], mock.destination, "压缩器→输出");
const noiseSrc = mock.nodes.find((x) => x.outputs.includes(n.noiseBP));
assert.ok(noiseSrc && noiseSrc.kind === "bufferSource", "噪声源→带通");
assert.equal(noiseSrc.loop, true, "噪声循环（持续风声底）");
assert.equal(n.noiseBP.outputs[0], n.noiseGain, "带通→噪声增益");
assert.equal(n.noiseGain.outputs[0], n.master, "噪声→主输出");
assert.equal(n.amLfo.outputs[0], n.amDepth, "AM LFO→深度");
assert.equal(n.amDepth.outputs[0], n.amGain.gain, "AM 深度→调制载波增益（每转一圈起伏）");
assert.equal(n.vibLfo.outputs[0], n.vibDepth, "颤音 LFO→深度");
assert.deepEqual(n.vibDepth.outputs, [n.oscA.frequency, n.oscB.frequency, n.oscC.frequency], "颤音调制三个振荡器频率");
assert.ok(n.oscA.started && n.oscB.started && n.oscC.started && n.amLfo.started && n.vibLfo.started && noiseSrc.started, "所有声源已启动");
console.log("[1] 图形连线与启动状态 OK");

// ---- 2. 参数随转速映射（离线立即模式 setValueAtTime） ----
function paramsAt(w) {
  audio.setSpin(w, { immediate: true, at: 1.0 });
  return {
    f0: n.oscA.frequency.value, fB: n.oscB.frequency.value, fSub: n.oscC.frequency.value,
    lp: n.lp.frequency.value, amFreq: n.amLfo.frequency.value, amDepth: n.amDepth.gain.value,
    vib: n.vibDepth.gain.value, buzz: n.buzzGain.gain.value, noise: n.noiseGain.gain.value,
  };
}
const p60 = paramsAt(60), p150 = paramsAt(150), p260 = paramsAt(260), p0 = paramsAt(0);
assert.equal(p60.f0, pitchFromSpin(60), "f0 = pitchFromSpin(60)");
assert.equal(p150.f0, pitchFromSpin(150), "f0 = pitchFromSpin(150)");
assert.equal(p260.f0, pitchFromSpin(260), "f0 = pitchFromSpin(260)");
assert.ok(p260.f0 > p150.f0 && p150.f0 > p60.f0, "基频随转速上升");
assert.equal(p150.fB, p150.f0 * 1.004, "失谐振荡器 +0.4%");
assert.equal(p150.fSub, p150.f0 * 0.5, "亚八度 = 半频");
assert.ok(p150.lp > p150.f0 * 3, "低通截止跟随基频（保留谐波质感）");
const expAmFreq = (w) => Math.min(45, Math.max(4, Math.abs(w) / (2 * Math.PI)));
assert.ok(Math.abs(p150.amFreq - expAmFreq(150)) < 0.01, "AM 频率 = 转速（每转一圈）");
assert.ok(p260.amDepth > p150.amDepth && p150.amDepth > p60.amDepth, "AM 深度随强度增大");
assert.equal(p150.vib, p150.f0 * 0.010, "颤音深度 = 基频×1%");
assert.equal(p150.buzz, buzzLevel(150) * 0.85, "包络增益 = 强度×0.85");
assert.equal(p150.noise, buzzLevel(150) ** 2 * 0.09, "噪声增益 ∝ 强度²");
console.log(`[2] 参数映射 OK  f(60)=${p60.f0.toFixed(0)} f(150)=${p150.f0.toFixed(0)} f(260)=${p260.f0.toFixed(0)} Hz`);

// ---- 3. 门控：低于阈值完全无声 ----
assert.equal(p0.buzz, 0, "静止时包络=0");
assert.equal(p0.noise, 0, "静止时噪声=0");
const p10 = paramsAt(10);
assert.equal(p10.buzz, 0, "低于发声阈值（286 RPM）无声");
assert.equal(paramsAt(31).buzz > 0, true, "略高于阈值开始发声");
console.log("[3] 发声门控 OK（阈值 286 RPM）");

// ---- 4. 单调性与连续性 ----
let prev = -1;
for (let w = 31; w <= 300; w += 1) { const g = buzzLevel(w); assert.ok(g >= prev, `buzzLevel 单调 @${w}`); prev = g; }
let prevF = -1;
for (let w = 0; w <= 300; w += 1) { const f = pitchFromSpin(w); assert.ok(f > prevF, `pitch 单调 @${w}`); prevF = f; }
console.log("[4] 强度与音高全程单调 OK");

// ---- 5. 实时模式平滑（setTargetAtTime，避免爆音） ----
const mockLive = new MockAudioContext();
const audioLive = new globalThis.BambooAudio();
audioLive.ctx = mockLive;
audioLive.nodes = audioLive.buildGraph(mockLive, mockLive.destination);
audioLive.setSpin(150, {});
const lastCall = audioLive.nodes.buzzGain.gain.calls.at(-1);
assert.equal(lastCall[0], "setTargetAtTime", "实时模式用 setTargetAtTime 平滑");
assert.ok(lastCall[3] > 0.01 && lastCall[3] < 0.1, `平滑时间常数 ${lastCall[3]}s`);
audioLive.setSpin(0, {});
const gateCall = audioLive.nodes.buzzGain.gain.calls.at(-1);
assert.equal(gateCall[1], 0, "归零时包络目标=0（声音自然衰减消失）");
// 静音
audioLive.setMuted(true);
assert.equal(audioLive.nodes.master.gain.calls.at(-1)[1], 0, "静音→主增益 0");
audioLive.setMuted(false);
assert.equal(audioLive.nodes.master.gain.calls.at(-1)[1], 0.9, "取消静音→主增益 0.9");
console.log("[5] 实时平滑与静音 OK（tau=" + lastCall[3].toFixed(3) + "s）");

console.log("\nALL AUDIO-ENGINE TESTS PASSED");
