// 竹知了 · 旋转物理单元测试：node test/physics.test.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PHYS, stepSpin, applyRub, applyShake, buzzLevel, pitchFromSpin, rpmFromSpin } = require("../js/physics.js");

const dt = 1 / 120;

// 1) 自由衰减：260 rad/s → 0，单调下降，鸣叫时长 5.5~10.5s（符合手搓后持续嗡嗡数秒的直觉）
let w = 260, t = 0, buzz = 0;
while (w > 1e-9 && t < 40) {
  const nw = stepSpin(w, dt);
  assert.ok(nw <= w + 1e-9, `monotonic broken at t=${t.toFixed(2)}: ${w} -> ${nw}`);
  if (nw > PHYS.minBuzz) buzz += dt;
  w = nw; t += dt;
}
assert.equal(w, 0, "spin must stop at zero");
assert.ok(buzz > 5.5 && buzz < 10.5, `buzz duration ${buzz.toFixed(2)}s out of range`);
console.log(`[1] decay 260->0 in ${t.toFixed(2)}s, buzzing ${buzz.toFixed(2)}s  OK`);

// 2) 持续画圈搓动（22 rad/s ≈ 3.5 圈/秒）→ 稳态转速落在合理区间
let ws = 0;
for (let i = 0; i < 60 * 120; i++) { ws = stepSpin(ws, dt); ws = applyRub(ws, 22, dt); }
assert.ok(ws > 110 && ws < 190, `steady ${ws.toFixed(1)} out of range`);
console.log(`[2] sustain @22rad/s: ${ws.toFixed(1)} rad/s = ${rpmFromSpin(ws).toFixed(0)} RPM  OK`);

// 3) 摇一摇冲量
const wk = applyShake(120, 1);
assert.ok(wk > 150 && wk < 160, `shake kick ${wk}`);
console.log(`[3] shake: 120 -> ${wk.toFixed(1)} rad/s  OK`);

// 4) 映射单调性与发声门控
assert.equal(buzzLevel(0), 0);
assert.equal(buzzLevel(PHYS.minBuzz - 1), 0);
assert.ok(buzzLevel(80) > buzzLevel(40) && buzzLevel(200) > buzzLevel(80), "buzzLevel must be monotonic above threshold");
assert.ok(pitchFromSpin(200) > pitchFromSpin(100), "pitch must rise with spin");
assert.ok(rpmFromSpin(PHYS.minBuzz) > 285 && rpmFromSpin(PHYS.minBuzz) < 288, "minBuzz RPM");
console.log(`[4] mappings OK; 发声阈值 = ${rpmFromSpin(PHYS.minBuzz).toFixed(0)} RPM  OK`);

console.log("\nALL PHYSICS TESTS PASSED");
