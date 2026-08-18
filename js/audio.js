(function (root) {
  "use strict";
  /* ============================================================
     竹知了 · WebAudio 实时合成引擎（无任何预录音频文件）

     声源模型，对应真实发声机理：
       竹片高速旋转切割空气 → 薄片气动颤振 → "嗡嗡如蝉鸣"
       - 颤振音：一对失谐锯齿波(周期波表) + 亚八度波（竹管共鸣的"嗡"体），
         经随基频滑动的低通滤波成型；
       - 每转一圈拍击一次空气 → 以转速为频率的振幅调制(LFO)；
       - 气流噪声：白噪声经带通，响度随转速平方衰减。

     关键要求：音调与响度由实时转速连续驱动——
       每帧 setSpin(ω) 用 setTargetAtTime 平滑过渡；
       转速下降 → 音调连续下滑、响度自然衰减 → 低于阈值彻底消失。
     ============================================================ */
  const P = root.ZZLPHYS;
  const { buzzLevel, pitchFromSpin, clamp } = P;

  class BambooAudio {
    constructor() { this.ctx = null; this.nodes = null; this.muted = false; }

    // 必须在用户手势中调用（浏览器自动播放策略）
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
        return;
      }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.nodes = this.buildGraph(this.ctx, this.ctx.destination);
      } catch (e) { this.ctx = null; }
    }

    // 图构建抽象出来：普通上下文与 OfflineAudioContext 复用（自检用）
    buildGraph(ctx, out) {
      const master = ctx.createGain(); master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 3;
      comp.attack.value = 0.004; comp.release.value = 0.16;
      master.connect(comp); comp.connect(out);

      // 周期波表：锯齿状（前 15 次谐波，幅度 1/n^0.95）——颤振音的"糙"质感
      const N = 15;
      const real = new Float32Array(N), imag = new Float32Array(N);
      for (let n = 1; n < N; n++) imag[n] = 1 / Math.pow(n, 0.95);
      const wave = ctx.createPeriodicWave(real, imag);

      const oscA = ctx.createOscillator(); oscA.setPeriodicWave(wave); oscA.frequency.value = 300;
      const oscB = ctx.createOscillator(); oscB.setPeriodicWave(wave); oscB.frequency.value = 301.2; // 失谐拍频
      const oscC = ctx.createOscillator(); oscC.setPeriodicWave(wave); oscC.frequency.value = 150;   // 亚八度：低沉"嗡"体
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500; lp.Q.value = 0.55;
      const amGain = ctx.createGain(); amGain.gain.value = 1;      // 振幅调制载波
      const buzzGain = ctx.createGain(); buzzGain.gain.value = 0;  // 总包络（转速驱动）
      oscA.connect(lp); oscB.connect(lp); oscC.connect(lp);
      lp.connect(amGain); amGain.connect(buzzGain); buzzGain.connect(master);

      // 每转一圈的振幅起伏（竹片每圈拍击空气）
      const amLfo = ctx.createOscillator(); amLfo.frequency.value = 6;
      const amDepth = ctx.createGain(); amDepth.gain.value = 0;
      amLfo.connect(amDepth); amDepth.connect(amGain.gain);
      amLfo.start();

      // 轻微颤音（真实颤振的不稳定感）
      const vibLfo = ctx.createOscillator(); vibLfo.frequency.value = 5.5;
      const vibDepth = ctx.createGain(); vibDepth.gain.value = 3;
      vibLfo.connect(vibDepth);
      vibDepth.connect(oscA.frequency); vibDepth.connect(oscB.frequency); vibDepth.connect(oscC.frequency);
      vibLfo.start();

      // 气流噪声（"呼呼"的风声底）
      const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
      const noiseBP = ctx.createBiquadFilter(); noiseBP.type = "bandpass"; noiseBP.frequency.value = 1200; noiseBP.Q.value = 0.9;
      const noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
      noise.connect(noiseBP); noiseBP.connect(noiseGain); noiseGain.connect(master);
      noise.start();

      oscA.start(); oscB.start(); oscC.start();
      return { oscA, oscB, oscC, lp, amGain, amLfo, amDepth, vibLfo, vibDepth, noiseBP, noiseGain, buzzGain, master };
    }

    // 每帧调用：把实时转速映射为音高/响度/音色参数，连续平滑变化
    setSpin(w, opts) {
      const n = this.nodes; if (!n) return;
      opts = opts || {};
      const g = buzzLevel(w);
      const f0 = pitchFromSpin(w);
      const fRot = clamp(Math.abs(w) / (2 * Math.PI), 4, 45);   // 每转一圈的 AM 频率
      const now = this.ctx.currentTime;
      const at = opts.immediate ? (opts.at != null ? opts.at : now) : now + 0.02;
      const tau = opts.immediate ? 0.0001 : 0.035;
      const set = (p, v) => { if (opts.immediate) p.setValueAtTime(v, at); else p.setTargetAtTime(v, at, tau); };
      set(n.oscA.frequency, f0);
      set(n.oscB.frequency, f0 * 1.004);
      set(n.oscC.frequency, f0 * 0.5);
      set(n.lp.frequency, clamp(f0 * 4.2, 700, 8400));
      set(n.amLfo.frequency, fRot);
      set(n.amDepth.gain, 0.06 + 0.24 * g);
      set(n.vibDepth.gain, f0 * 0.010);
      set(n.buzzGain.gain, g * 0.85);
      set(n.noiseBP.frequency, clamp(f0 * 2.4, 500, 6200));
      set(n.noiseGain.gain, g * g * 0.09);
    }

    setMuted(m) {
      this.muted = m;
      if (this.nodes) this.nodes.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  root.BambooAudio = BambooAudio;
})(typeof window !== "undefined" ? window : globalThis);
