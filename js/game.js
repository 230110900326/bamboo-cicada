(function () {
  "use strict";
  /* ============================================================
     竹知了 · 游戏主逻辑
     输入：桌面鼠标画圈拖拽 / 移动端触摸画圈 + 重力感应摇一摇
     渲染：Canvas 2D —— 竹签（带竹节）、竹片（椭圆投影 + 高速模糊环 + 颤振抖动）
     玩法：随意把玩 / 鸣叫挑战（连续鸣叫时长）/ 极速挑战（峰值转速）
     ============================================================ */
  if (!window.ZZLPHYS || !window.BambooAudio) { window.__ERR__.push("缺少依赖脚本"); return; }

  const P = window.ZZLPHYS;
  const { PHYS, stepSpin, applyRub, applyShake, buzzLevel, pitchFromSpin, rpmFromSpin } = P;

  const canvas = document.getElementById("toy");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  const $ = (id) => document.getElementById(id);
  const els = {
    rpm: $("hud-rpm"), meter: $("buzz-meter"), status: $("status-line"),
    modeChip: $("mode-chip"), runHud: $("hud-run"), idle: $("idle-hint"),
    toasts: $("toasts"), ladder: $("ladder"), btnRun: $("btn-run"),
    runState: $("run-state"), recBuzz: $("rec-buzz"), recRpm: $("rec-rpm"),
    btnMute: $("btn-mute"), btnShake: $("btn-shake"), shakeChip: $("shake-chip"),
    chTitle: $("challenge-title"), chDesc: $("challenge-desc"),
  };
  const audio = new window.BambooAudio();

  /* ---------- 玩法定义 ---------- */
  const MODES = {
    free: { name: "随意把玩", title: "随意把玩", desc: "自由玩耍：画圈搓动竹签，看竹片转得多快、叫得多响。音调与响度随转速实时变化。" },
    buzz: { name: "鸣叫挑战", title: "鸣叫挑战", desc: "让竹知了连续鸣叫，坚持得越久越好；转速跌破阈值 0.5 秒，鸣叫即断。" },
    rpm: { name: "极速挑战", title: "极速挑战", desc: "20 秒内把转速冲到最高，冲击 2100 RPM「蝉皇」之位！" },
  };
  const LADDERS = {
    buzz: [
      { t: 3, n: "初鸣" }, { t: 5, n: "蝉声渐起" }, { t: 8, n: "声声入耳" },
      { t: 12, n: "蝉鸣如潮" }, { t: 16, n: "一鸣惊人" }, { t: 20, n: "长鸣不绝" },
      { t: 25, n: "蝉噪林静" }, { t: 30, n: "蝉王" },
    ],
    rpm: [
      { t: 600, n: "疾风" }, { t: 900, n: "破风" }, { t: 1200, n: "穿林" },
      { t: 1500, n: "惊蝉" }, { t: 1800, n: "裂空" }, { t: 2100, n: "蝉皇" },
    ],
  };

  /* ---------- 状态 ---------- */
  const state = {
    w: 0, theta: 0, t: 0, mode: "free",
    pointer: { active: false, prevAngle: 0, angVel: 0, lastT: 0, radius: 0 },
    shake: { enabled: false, last: -1, hp: 9.81 },
    run: null,           // { type, time, peak, grace, endsIn, done:Set }
    buzz: { on: false, streak: 0, sessionPeak: 0 },
    best: { buzz: 0, rpm: 0 },
    muted: false,
    dispRpm: 0,
    dpr: 1, w: 0, h: 0, cx: 0, cy: 0, stickLen: 0, bladeR: 0,
  };
  const phi = 0.30, sinP = Math.sin(phi), cosP = Math.cos(phi);

  /* ---------- 尺寸 ---------- */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    state.w = rect.width; state.h = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * state.dpr));
    canvas.height = Math.max(1, Math.round(rect.height * state.dpr));
    state.cx = state.w / 2;
    state.cy = state.h * 0.60;
    state.stickLen = Math.min(state.h * 0.36, state.w * 0.34);
    state.bladeR = state.stickLen * 0.45;
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  resize();

  /* ---------- 输入：画圈搓动 ---------- */
  function ptInfo(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const dx = x - state.cx, dy = y - state.cy;
    return { angle: Math.atan2(dy, dx), radius: Math.hypot(dx, dy) };
  }
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audio.ensure();
    const st = state.pointer;
    if (st.active) return;                       // 忽略第二根手指
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const p = ptInfo(e);
    st.active = true; st.prevAngle = p.angle; st.angVel = 0; st.radius = p.radius;
    st.lastT = performance.now() / 1000;
  });
  canvas.addEventListener("pointermove", (e) => {
    const st = state.pointer;
    if (!st.active) return;
    e.preventDefault();
    const p = ptInfo(e);
    const now = performance.now() / 1000;
    const dT = now - st.lastT;
    if (dT < 0.004) return;
    st.lastT = now;
    let dA = p.angle - st.prevAngle;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    st.prevAngle = p.angle;
    const vel = dA / dT;                          // 手指绕杆角速度 rad/s
    const rF = Math.min(1, Math.max(0, (p.radius - 16) / 40));  // 离杆太近的圈几乎无效
    const sm = 0.78;                              // 平滑，抗抖动
    st.angVel = st.angVel * sm + vel * (1 - sm) * rF;
    st.radius = p.radius;
  });
  function endPointer() { state.pointer.active = false; state.pointer.angVel = 0; }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------- 输入：摇一摇（重力感应） ---------- */
  function onMotion(e) {
    const a = e.accelerationIncludingGravity || {};
    const ax = a.x || 0, ay = a.y || 0, az = a.z || 0;
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    const sh = state.shake;
    sh.hp = sh.hp * 0.93 + mag * 0.07;            // 高频包络基准（剔除重力）
    const excess = mag - sh.hp - 5;
    const now = performance.now() / 1000;
    if (excess > 5 && now - sh.last > 0.13) {
      sh.last = now;
      state.w = applyShake(state.w, Math.min(1, excess / 16));
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
      spawnToast("摇", "shake", 700);
    }
  }
  function enableShake() {
    if (state.shake.enabled) return;
    window.addEventListener("devicemotion", onMotion, { passive: true });
    state.shake.enabled = true;
    els.shakeChip.hidden = false;
    els.btnShake.hidden = true;
  }
  function initShake() {
    if (!("DeviceMotionEvent" in window)) return;
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      // iOS：需要用户手势授权
      els.btnShake.hidden = false;
      els.btnShake.addEventListener("click", async () => {
        try { await DeviceMotionEvent.requestPermission(); } catch (_) {}
        enableShake();
      });
    } else {
      enableShake();
    }
  }

  /* ---------- Toast ---------- */
  function spawnToast(text, kind, ttl) {
    const el = document.createElement("div");
    el.className = "toast toast-" + kind;
    el.textContent = text;
    els.toasts.appendChild(el);
    setTimeout(() => el.remove(), ttl + 600);
  }

  /* ---------- 状态栏 ---------- */
  function setStatus(text, cls) {
    els.status.textContent = text;
    els.status.className = "status-line" + (cls ? " " + cls : "");
  }

  /* ---------- 挑战玩法 ---------- */
  function renderLadder() {
    if (state.mode === "free") { els.ladder.innerHTML = ""; return; }
    const done = state.run ? state.run.done : new Set();
    const unit = state.mode === "buzz" ? "s" : "";
    els.ladder.innerHTML = LADDERS[state.mode]
      .map((m) => `<span class="ladder-item ${done.has(m.t) ? "done" : ""}">${m.t}${unit} ${m.n}</span>`).join("");
  }
  function startRun() {
    audio.ensure();
    const type = state.mode;
    state.run = { type, time: 0, peak: 0, grace: 0, endsIn: type === "rpm" ? 20 : 0, done: new Set() };
    els.btnRun.disabled = true;
    els.btnRun.textContent = "进行中…";
    els.runState.textContent = type === "buzz" ? "进行中 — 保持鸣叫！转速别掉下去" : "进行中 — 快搓！";
    renderLadder();
    setStatus(type === "buzz" ? "保持鸣叫！" : "冲！还剩 20 秒");
  }
  function endRun() {
    const run = state.run; if (!run) return;
    state.run = null;
    els.btnRun.disabled = false;
    const isBuzz = run.type === "buzz";
    const score = isBuzz ? run.time : run.peak;
    const rec = isBuzz ? state.best.buzz : state.best.rpm;
    let msg;
    if (isBuzz) {
      msg = `本次鸣叫 ${score.toFixed(1)} 秒`;
      if (score > rec) { state.best.buzz = score; msg += " · 新纪录！"; }
      else msg += ` · 最佳 ${rec.toFixed(1)} 秒`;
    } else {
      msg = `峰值转速 ${Math.round(score)} RPM`;
      if (score > rec) { state.best.rpm = score; msg += " · 新纪录！"; }
      else msg += ` · 最佳 ${Math.round(rec)} RPM`;
    }
    saveBest(); updateRecordsUI();
    spawnToast(msg, "result", 3400);
    els.btnRun.textContent = "再来一局";
    els.runState.textContent = isBuzz
      ? "鸣叫中断了。保持转速高于阈值，坚持更久！"
      : "时间到！搓得更快更狠，冲击更高转速。";
    renderLadder();
    setStatus("再来一局！");
  }
  function updateRun(dt, buzzing, wAbs) {
    const run = state.run; if (!run) return;
    if (run.type === "buzz") {
      if (buzzing) { run.time += dt; run.grace = 0; }
      else {
        run.grace += dt;
        if (run.grace > 0.5) { endRun(); return; }
      }
      for (const m of LADDERS.buzz) {
        if (!run.done.has(m.t) && run.time >= m.t) { run.done.add(m.t); spawnToast(`达成 · ${m.n}（${m.t} 秒）`, "milestone", 2200); renderLadder(); }
      }
    } else {
      run.endsIn -= dt;
      run.peak = Math.max(run.peak, wAbs);
      for (const m of LADDERS.rpm) {
        if (!run.done.has(m.t) && run.peak >= m.t) { run.done.add(m.t); spawnToast(`突破 · ${m.n}（${m.t} RPM）`, "milestone", 2200); renderLadder(); }
      }
      if (run.endsIn <= 0) endRun();
    }
  }
  function switchMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    els.modeChip.textContent = MODES[mode].name;
    els.chTitle.textContent = MODES[mode].title;
    els.chDesc.textContent = MODES[mode].desc;
    state.run = null;
    els.btnRun.hidden = mode === "free";
    els.btnRun.disabled = false;
    els.btnRun.textContent = "开始挑战";
    els.runState.textContent = mode === "buzz" ? "鸣叫阈值 286 RPM · 跌破阈值 0.5 秒即中断" :
      mode === "rpm" ? "20 秒计时 · 取峰值转速" : "";
    renderLadder();
    setStatus("按住竹签画圈搓动 · 搓得越快叫得越响");
  }

  /* ---------- 纪录 ---------- */
  function loadBest() {
    try {
      state.best.buzz = parseFloat(localStorage.getItem("zzl.buzzBest") || "0") || 0;
      state.best.rpm = parseFloat(localStorage.getItem("zzl.rpmBest") || "0") || 0;
    } catch (_) {}
    updateRecordsUI();
  }
  function saveBest() {
    try {
      localStorage.setItem("zzl.buzzBest", String(state.best.buzz));
      localStorage.setItem("zzl.rpmBest", String(state.best.rpm));
    } catch (_) {}
  }
  function updateRecordsUI() {
    els.recBuzz.textContent = state.best.buzz > 0 ? state.best.buzz.toFixed(1) + " 秒" : "--";
    els.recRpm.textContent = state.best.rpm > 0 ? Math.round(state.best.rpm) + " RPM" : "--";
  }

  /* ---------- 主循环 ---------- */
  // 自检模式下不启动 rAF（无头虚拟时间下时序才可控），由自检手动 tick 驱动
  const SELFTEST_MODE = new URLSearchParams(location.search).has("selftest");
  let last = performance.now() / 1000;
  function frame(nowMs) {
    requestAnimationFrame(frame);
    const now = nowMs / 1000;
    let dt = now - last; last = now;
    if (dt <= 0 || dt > 0.05) dt = dt > 0.05 ? 0.05 : dt;
    if (document.hidden) return;      // 页面隐藏时冻结
    update(dt);
    render();
  }
  function update(dt) {
    state.t += dt;
    if (state.pointer.active) state.w = applyRub(state.w, state.pointer.angVel, dt);
    state.w = stepSpin(state.w, dt);
    state.theta += state.w * dt;

    const gLvl = buzzLevel(state.w);
    const wAbs = Math.abs(state.w);
    audio.setSpin(state.w, {});       // 每帧：转速 → 音高/响度/音色

    const buzzing = gLvl > 0.012;
    if (buzzing) { state.buzz.streak += dt; state.buzz.sessionPeak = Math.max(state.buzz.sessionPeak, wAbs); }
    else state.buzz.streak = 0;
    if (buzzing !== state.buzz.on) {
      state.buzz.on = buzzing;
      stage.classList.toggle("buzzing", buzzing);
    }

    updateRun(dt, buzzing, wAbs);

    /* HUD */
    state.dispRpm += (wAbs - state.dispRpm) * Math.min(1, dt * 12);
    const rpm = rpmFromSpin(state.dispRpm);
    els.rpm.textContent = Math.round(rpm).toString();
    els.meter.style.width = Math.round(gLvl * 100) + "%";
    const cls = wAbs < PHYS.minBuzz ? "cold" : wAbs < 110 ? "warm" : wAbs < 180 ? "hot" : "blaze";
    if (els.rpm.dataset.cls !== cls) { els.rpm.dataset.cls = cls; els.rpm.className = "rpm-num " + cls; }

    if (state.run) {
      if (state.run.type === "buzz") els.runHud.textContent = `鸣叫 ${state.run.time.toFixed(1)}s`;
      else els.runHud.textContent = `剩余 ${Math.max(0, state.run.endsIn).toFixed(0)}s · 峰值 ${Math.round(state.run.peak)}`;
    } else if (state.mode === "free") {
      els.runHud.textContent = state.buzz.on
        ? `连续鸣叫 ${state.buzz.streak.toFixed(1)}s`
        : (state.buzz.sessionPeak > 0 ? `峰值 ${Math.round(rpmFromSpin(state.buzz.sessionPeak))} RPM` : "");
    } else {
      els.runHud.textContent = "";
    }

    if (state.buzz.on) setStatus(`蝉鸣中 · ${Math.round(rpm)} RPM`, "on");
    else if (!state.run) setStatus("按住竹签画圈搓动 · 搓得越快叫得越响");

    els.idle.classList.toggle("show", !state.pointer.active && !state.buzz.on && !state.run);
  }

  /* ---------- 渲染 ---------- */
  function drawStick(topX, topY, botX, botY) {
    const sw = 9, swT = 5.5;
    const grd = ctx.createLinearGradient(botX - sw / 2, 0, botX + sw / 2, 0);
    grd.addColorStop(0, "#a8823c"); grd.addColorStop(0.35, "#e3c07c");
    grd.addColorStop(0.65, "#c29a52"); grd.addColorStop(1, "#7a5c26");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(botX - sw / 2, botY); ctx.lineTo(botX + sw / 2, botY);
    ctx.lineTo(topX + swT / 2, topY); ctx.lineTo(topX - swT / 2, topY);
    ctx.closePath(); ctx.fill();
    // 竹节
    for (const f of [0.28, 0.62, 0.92]) {
      const yy = botY + (topY - botY) * f;
      const ww = sw + (swT - sw) * f + 1.6;
      ctx.strokeStyle = "rgba(70,48,16,.5)"; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(botX - ww / 2, yy);
      ctx.quadraticCurveTo(botX, yy - 2.5, botX + ww / 2, yy);
      ctx.stroke();
    }
    // 高光
    ctx.strokeStyle = "rgba(255,250,230,.5)"; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(botX - sw / 2 + 2.2, botY - 4);
    ctx.lineTo(topX - swT / 2 + 1.6, topY + 4);
    ctx.stroke();
  }
  function drawTassel(botX, botY) {
    ctx.strokeStyle = "#a63a2b"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(botX, botY);
    ctx.quadraticCurveTo(botX - 5, botY + 9, botX - 6, botY + 17); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(botX, botY);
    ctx.quadraticCurveTo(botX + 1, botY + 10, botX + 2, botY + 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(botX, botY);
    ctx.quadraticCurveTo(botX + 6, botY + 9, botX + 8, botY + 16); ctx.stroke();
    ctx.fillStyle = "#8f2f22";
    ctx.beginPath(); ctx.arc(botX, botY - 1, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  function drawBlade(alpha, jitX, theta) {
    const L = state.bladeR, W = L * 0.30;
    ctx.save();
    ctx.translate(state.cx, state.topY);
    ctx.translate(jitX, 0);
    ctx.rotate(theta);
    ctx.scale(1, cosP);
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(-W / 2, -W / 2, W / 2, W / 2);
    grad.addColorStop(0, "#7a5c26"); grad.addColorStop(0.5, "#c9a24b"); grad.addColorStop(1, "#5d451c");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(L * 0.18, -W * 0.42, L * 0.55, -W * 0.55, L * 0.88, -W * 0.28);
    ctx.quadraticCurveTo(L * 1.0, 0, L * 0.88, W * 0.28);
    ctx.bezierCurveTo(L * 0.55, W * 0.55, L * 0.18, W * 0.42, 0, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(60,42,12,.55)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(L * 0.06, 0); ctx.quadraticCurveTo(L * 0.55, 0, L * 0.92, 0); ctx.stroke();
    ctx.restore();
    // 轴头（盖住竹片根部）
    ctx.fillStyle = "rgba(93,69,28,.9)";
    ctx.beginPath(); ctx.arc(state.cx, state.topY, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  function render() {
    const { w, h, cx, cy } = state;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const len = state.stickLen, R = state.bladeR;
    const topX = cx, topY = cy - len * cosP;
    const botX = cx, botY = cy;
    state.topY = topY;

    const wAbs = Math.abs(state.w), gLvl = buzzLevel(state.w);
    const sign = Math.sign(state.w) || 1;

    // 地面阴影
    ctx.fillStyle = "rgba(70,52,24,.16)";
    ctx.beginPath(); ctx.ellipse(cx, botY + 3, 22, 4.5, 0, 0, Math.PI * 2); ctx.fill();

    // 空闲时的搓动轨道指引
    if (!state.pointer.active && !state.buzz.on) {
      const pulse = 0.5 + 0.5 * Math.sin(state.t * 2.6);
      ctx.save();
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = -state.t * 26;
      ctx.strokeStyle = `rgba(138,106,47,${(0.2 + 0.15 * pulse).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, R + 26, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // 掌心提示（半透明椭圆）
      ctx.fillStyle = "rgba(201,168,139,.14)";
      ctx.save();
      ctx.translate(cx - 26, cy + 12); ctx.rotate(-0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(cx + 26, cy + 12); ctx.rotate(0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 高速模糊环（竹片高速旋转成"盘"）
    if (wAbs > 40 && gLvl > 0.03) {
      const alpha = Math.min(0.42, gLvl * 0.48 + 0.04);
      ctx.save();
      ctx.translate(cx, topY);
      ctx.scale(1, cosP);
      ctx.rotate(state.theta * sign * 0.6);
      ctx.globalAlpha = alpha;
      const rg = ctx.createRadialGradient(R * 0.5, 0, 2, R * 0.5, 0, R * 1.1);
      rg.addColorStop(0, "rgba(140,105,45,0)");
      rg.addColorStop(0.72, "rgba(160,120,55,0.85)");
      rg.addColorStop(1, "rgba(140,105,45,0)");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(R * 0.5, 0, R * 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(220,190,120,0.8)";
      ctx.lineWidth = R * 0.07;
      ctx.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(R * 0.5, 0, R * 0.78, k * 2.1 + state.t * 9 * sign, k * 2.1 + 1.35 + state.t * 9 * sign);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 竹片：位置/颤振抖动随鸣叫强度增强
    const bladeAlpha = Math.max(0.12, 1 - Math.min(0.88, gLvl * 1.15));
    const jit = gLvl * (1.6 * Math.sin(state.t * (5 + 26 * gLvl) * Math.PI * 2) + (Math.random() - 0.5) * 1.4);
    drawBlade(bladeAlpha, jit, state.theta);

    drawStick(topX, topY, botX, botY);
    drawTassel(botX, botY);
  }

  /* ---------- 控件 ---------- */
  document.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  });
  els.btnRun.addEventListener("click", startRun);
  els.btnMute.addEventListener("click", () => {
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    els.btnMute.textContent = state.muted ? "🔇" : "🔊";
    els.btnMute.classList.toggle("muted", state.muted);
  });
  $("btn-clear-records").addEventListener("click", () => {
    try { localStorage.removeItem("zzl.buzzBest"); localStorage.removeItem("zzl.rpmBest"); } catch (_) {}
    state.best.buzz = 0; state.best.rpm = 0;
    updateRecordsUI();
    spawnToast("纪录已清空", "milestone", 1600);
  });

  /* ---------- 启动 ---------- */
  loadBest();
  renderLadder();
  initShake();
  document.addEventListener("visibilitychange", () => { last = performance.now() / 1000; });
  if (!SELFTEST_MODE) requestAnimationFrame(frame);

  /* 调试钩子（自检/自动化验证用） */
  window.__ZZL_DEBUG__ = {
    canvas,
    tick: (dtSec) => { update(dtSec); render(); },   // 自检模式下手动驱动一帧
    getState: () => ({
      w: state.w, theta: state.theta, rpm: rpmFromSpin(state.w), g: buzzLevel(state.w),
      cx: state.cx, cy: state.cy, topY: state.topY,
      stickLen: state.stickLen, bladeR: state.bladeR,
      buzzOn: state.buzz.on, pointerActive: state.pointer.active, mode: state.mode,
      run: state.run ? { type: state.run.type, time: state.run.time, peak: state.run.peak, endsIn: state.run.endsIn } : null,
    }),
    audio,
    startRun, endRun, switchMode,
  };
})();
