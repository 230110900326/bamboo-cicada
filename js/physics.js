(function (root) {
  "use strict";
  /* ============================================================
     竹知了 · 旋转物理模型（纯函数，便于单元测试与自检）

     真实机理：掌心搓动竹签 → 竹签获得角速度 → 竹片高速旋转切割空气，
     薄竹片发生气动颤振而发声。模型要点：
       - 搓动输入（画圈角速度 / 摇动冲量）给竹签角速度；
       - 之后受三种阻力衰减：
           恒定摩擦（掌/轴摩擦）+ 线性粘滞 + 平方空气阻力（叶片风阻为主）；
       - 转速低于 minBuzz 时竹片停止颤振（无声），高于后鸣叫强度按
         smoothstep 连续增强——转速降下来声音自然衰减消失。
     ============================================================ */
  const PHYS = Object.freeze({
    constFriction: 2.2,      // rad/s²  恒定摩擦（轴承/掌心）
    viscousFriction: 0.10,   // 1/s     线性粘滞
    quadDrag: 0.0028,        // 1/rad   平方空气阻力（叶片风阻）
    minBuzz: 30,             // rad/s   发声阈值（≈286 RPM）
    maxSpin: 300,            // rad/s   手感上限（≈2865 RPM）
    rubEff: 0.68,            // 搓动→转动的效率
    rubLever: 5.0,           // 掌心滚搓的转速放大倍数（机械优势）
    shakeKick: 34,           // 一次有效摇动的角速度冲量 rad/s
  });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // 阻力角加速度（带符号）
  function spinDecel(w) {
    const a = Math.abs(w);
    if (a === 0) return 0;
    const s = w > 0 ? 1 : -1;
    return s * (PHYS.constFriction + PHYS.viscousFriction * a + PHYS.quadDrag * a * a);
  }

  // 半步中点法积分一帧：单调、稳定、无过冲
  function stepSpin(w, dt) {
    if (w === 0 || dt <= 0) return 0;
    const k1 = spinDecel(w);
    const wMid = w - k1 * dt * 0.5;
    if (wMid === 0) return 0;
    const k2 = spinDecel(wMid);
    const wNext = w - k2 * dt;
    return (wNext * w <= 0) ? 0 : wNext;   // 过零即停
  }

  // 画圈搓动输入：pointerAngularVel 为手指绕杆轴的角速度 (rad/s)
  function applyRub(w, pointerAngularVel, dt) {
    const boost = PHYS.rubEff * PHYS.rubLever * (pointerAngularVel || 0);
    return clamp(w + boost * dt, -PHYS.maxSpin, PHYS.maxSpin);
  }

  // 摇一摇输入：strength ∈ [0,1]。保持原转向；静止时随机定方向
  function applyShake(w, strength) {
    const s = clamp(strength || 0, 0, 1);
    if (s <= 0) return w;
    const dir = Math.abs(w) > 6 ? Math.sign(w) : (Math.random() < 0.5 ? -1 : 1);
    return clamp(w + dir * PHYS.shakeKick * s, -PHYS.maxSpin, PHYS.maxSpin);
  }

  // 归一化"蝉鸣强度" 0..1：低于阈值无声；高于后按幂曲线快速爬升，
  // 让中低转速（约 1300 RPM）就有明显强度/音量（更"敏感"）
  function buzzLevel(w) {
    const a = Math.abs(w);
    if (a <= PHYS.minBuzz) return 0;
    const t = clamp((a - PHYS.minBuzz) / (PHYS.maxSpin - PHYS.minBuzz), 0, 1);
    return Math.pow(t, 0.75);
  }

  // 转速 → 竹片颤振基频 Hz（随转速连续上升）
  function pitchFromSpin(w) {
    return 46 + 6.1 * Math.abs(w);
  }

  function rpmFromSpin(w) { return Math.abs(w) * 60 / (2 * Math.PI); }

  const api = { PHYS, clamp, spinDecel, stepSpin, applyRub, applyShake, buzzLevel, pitchFromSpin, rpmFromSpin };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ZZLPHYS = api;
})(typeof window !== "undefined" ? window : globalThis);
