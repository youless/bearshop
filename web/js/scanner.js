/* ============================================================
   BearScanner —— BearShop 自研扫码引擎  v2
   ============================================================
   为什么不用现成的网页扫码库：
   它们解码时都是把「整帧画面」缩到一块固定画布上再识别。缩得越小、
   码在画面里越不起眼，解码器就越认不出来。实测：同一套代码在
   640×480 的测试画面上百发百中，换成真机常见的 1280×720 就频繁
   认不出 —— 这就是"相机明明开着却读不出二维码"的根因。

   本引擎的解法是「一路不行就多路一起上」：每帧轮转下面的档位解码，
   总有一路能命中。所有档位都受像素预算约束，保证每帧开销可控。
     ① full     整帧（按像素预算缩放）      —— 正常距离
     ② roi65    中心 65%，原生像素          —— 相当于把码放大看
     ③ roi45    中心 45%，原生像素
     ④ roi28x2  中心 28% 放大 2 倍          —— 码离得远、很小
     ⑤ roi45i   中心 45% + 正反色都试       —— 反光 / 屏幕上的浅色码
     ⑥ roi90    中心 90%，原生像素          —— 码大但没对准正中
     ⑦ roi65bw  中心 65% 二值化             —— 弱光 / 低对比度
     ⑧ roi65m   中心 65% 镜像               —— 前置摄像头镜像画面

   另外还做了可靠性兜底：
     · 画面亮度诊断：连续多帧几乎全黑 → 判定「没有画面送达解码器」
     · 光线不足且设备支持 → 自动打开手电筒
     · 解码耗时自适应调速：慢机器自动降帧，快机器全速
     · 摄像头打不开时给出可读原因（拒绝 / 无相机 / 被占用 / 超时）

   对外接口（window.BearScanner）：
     available()  -> 环境是否支持
     start({host, onCode, onReady, onMeta, onLost, onStuck}) -> {ok, kind, message}
     stop()       -> Promise
     setTorch(on) -> Promise<boolean>
     video()      -> 当前 video 元素
     info()       -> 运行时诊断快照
   ============================================================ */
window.BearScanner = (function () {
  'use strict';

  /* ---------------- 调参 ---------------- */
  var TICK_MIN = 60;          // 两次解码的最小间隔（毫秒）
  var TICK_MAX = 200;         // 两次解码的最大间隔
  var CAP_FULL = 600000;      // 整帧解码画布的像素预算（约等于 1030×580）
  var CAP_CROP = 420000;      // 中心区解码画布的像素预算（约等于 648×648）
  var ROI_RATIO = 0.74;       // 中心区边长 = min(画面宽,高) × 该系数
  var DARK_LUMA = 46;         // 平均亮度低于此值视为光线不足
  var BLACK_LUMA = 6;         // 平均亮度低于此值且方差极小 → 视为没有画面
  var BLACK_STREAK = 14;      // 连续这么多帧没有画面 → 通知上层
  var NO_FRAME_MS = 7000;     // 启动后这么久还没拿到画面尺寸 → 通知上层

  var S = {
    /* 会话 */
    stream: null, video: null, alive: false, done: false, cb: null, host: null,
    startedAt: 0, vw: 0, vh: 0, flip: false,
    /* 循环 */
    raf: 0, lastAt: 0, gap: 110, cost: 0, pi: 0,
    /* 画布 */
    cv: null, ctx: null, bw: null,
    /* 识别器 */
    det: null, detTried: false, detBusy: false, lastDetAt: 0,
    /* 统计 */
    frames: 0, tries: 0, hits: 0, fps: 0, fpsAt: 0, decAt: 0, metaAt: 0,
    emaLuma: 0, blackStreak: 0, lastLuma: 0, torchAuto: false, torchAvail: false,
    stuck: false, lastPlan: ''
  };
  var darkFired = false;   /* 上一轮是不是已经判定"光线不足"了 */

  function available() {
    return typeof window.jsQR === 'function'
      && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function video() { return S.video; }

  function info() {
    return {
      alive: S.alive, flip: S.flip, gap: Math.round(S.gap), cost: Math.round(S.cost),
      frames: S.frames, tries: S.tries, hits: S.hits, fps: S.fps,
      vw: S.vw, vh: S.vh, luma: Math.round(S.lastLuma),
      min: S.lastMin == null ? -1 : S.lastMin, max: S.lastMax == null ? -1 : S.lastMax,
      src: S.src ? (S.srcW + 'x' + S.srcH) : 'none',
      plan: S.lastPlan, detector: !!S.det, blackStreak: S.blackStreak, torch: S.torchAuto,
      lastText: S.lastText || '', cbOk: S.cbOk || 0, cbErr: S.cbErr || ''
    };
  }

  function fail(kind, message) {
    return { ok: false, kind: kind || 'other', message: message || '' };
  }

  function tell(name, arg) {
    var f = S.cb && S.cb[name];
    if (!f) return;
    try { f(arg); } catch (e) { /* 回调里出错不影响引擎 */ }
  }

  /* ---------------- 错误归类 ---------------- */
  function classify(e) {
    var name = (e && e.name) || '';
    var msg = String((e && (e.message || e)) || '');
    if (name === 'NotAllowedError' || name === 'SecurityError' ||
        /permission|denied|notallowed|dismiss/i.test(msg)) return 'denied';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' ||
        /no camera|not found|requested device/i.test(msg)) return 'nocam';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError' ||
        /in use|could not start|not readable/i.test(msg)) return 'busy';
    if (name === 'OverconstrainedError') return 'constraint';
    if (name === 'TimeoutError' || /timeout/i.test(msg)) return 'timeout';
    return 'other';
  }

  function timeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        var err = new Error('timeout');
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (!done) { done = true; clearTimeout(timer); resolve(v); }
      }, function (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      });
    });
  }

  /* ---------------- 开流 ---------------- */
  /* 后置摄像头优先；逐级放宽直到拿到一条能用的流 */
  async function openStream() {
    var tries = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' }, width: { min: 640 } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false }
    ];
    var lastErr = null;
    for (var i = 0; i < tries.length; i++) {
      try {
        return await timeout(navigator.mediaDevices.getUserMedia(tries[i]), i === 0 ? 12000 : 7000);
      } catch (e) {
        lastErr = e;
        if (classify(e) === 'denied') break;   // 权限被拒，换参数也没意义
      }
    }
    throw lastErr || new Error('no camera');
  }

  function track() {
    try { return S.stream ? S.stream.getVideoTracks()[0] : null; } catch (e) { return null; }
  }

  function hasTorch() {
    try {
      var t = track();
      var caps = t && t.getCapabilities ? t.getCapabilities() : null;
      return !!(caps && caps.torch);
    } catch (e) { return false; }
  }

  /* ---------------- 解码档位 ----------------
     档位按「先便宜、后贵」排列：中心区用原生像素（不缩放），
     整帧才按像素预算缩小。像素预算比长边上限更重要 ——
     jsQR 的耗时几乎只取决于总像素数。 */
  function buildPlan(vw, vh) {
    var m = Math.min(vw, vh);
    function crop(r) {
      var s = Math.round(m * r);
      return { x: Math.round((vw - s) / 2), y: Math.round((vh - s) / 2), s: s };
    }
    var c90 = crop(0.90), c65 = crop(0.65), c45 = crop(0.45), c28 = crop(0.28);
    return [
      /* ① 整帧 —— 绝大多数情况第一路就命中 */
      { id: 'full', sx: 0, sy: 0, sw: vw, sh: vh, cap: CAP_FULL },
      /* ② 中心 65% 原生像素 —— 相当于把码放大看 */
      { id: 'roi65', sx: c65.x, sy: c65.y, sw: c65.s, sh: c65.s, cap: CAP_CROP },
      /* ③ 中心 45% 原生像素 */
      { id: 'roi45', sx: c45.x, sy: c45.y, sw: c45.s, sh: c45.s, cap: CAP_CROP },
      /* ④ 中心 28% 放大 2 倍 —— 码离得远、在画面里很小 */
      { id: 'roi28x2', sx: c28.x, sy: c28.y, sw: c28.s, sh: c28.s, cap: CAP_CROP, up: 2 },
      /* ⑤ 中心 45% + 正反色都试 —— 反光 / 屏幕上的浅色码 */
      { id: 'roi45i', sx: c45.x, sy: c45.y, sw: c45.s, sh: c45.s, cap: CAP_CROP, inv: 'attemptBoth' },
      /* ⑥ 中心 90% 原生像素 —— 码比较大但没对准正中 */
      { id: 'roi90', sx: c90.x, sy: c90.y, sw: c90.s, sh: c90.s, cap: CAP_CROP },
      /* ⑦ 中心 65% 二值化 —— 弱光 / 低对比度 */
      { id: 'roi65bw', sx: c65.x, sy: c65.y, sw: c65.s, sh: c65.s, cap: CAP_CROP, bw: true },
      /* ⑧ 镜像 —— 前置摄像头 / 某些设备的镜像画面 */
      { id: 'roi65m', sx: c65.x, sy: c65.y, sw: c65.s, sh: c65.s, cap: CAP_CROP, flip: true }
    ];
  }

  /* 画面亮度统计（顺带判断是不是"根本没有画面"） */
  function frameStats(data) {
    var sum = 0, sum2 = 0, n = 0, lo = 255, hi = 0;
    for (var i = 0; i < data.length; i += 212) {          // 每 53 个像素采一个
      var g = (data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8;
      sum += g; sum2 += g * g; n++;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    if (!n) return;
    var m = sum / n;
    var varr = sum2 / n - m * m;
    S.lastLuma = m;
    S.lastMin = lo;
    S.lastMax = hi;
    S.emaLuma = S.emaLuma ? (S.emaLuma * 0.72 + m * 0.28) : m;
    if (m < BLACK_LUMA && varr < 60) S.blackStreak++; else S.blackStreak = 0;
  }

  /* Otsu 全局二值化：弱光、低对比度下比直接解码稳得多 */
  function otsu(data) {
    var hist = new Int32Array(256);
    var n = 0, i;
    for (i = 0; i < data.length; i += 12) {               // 每 3 个像素采一个
      hist[(data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8]++;
      n++;
    }
    if (!n) return data;
    var sum = 0, t;
    for (t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, best = -1, thr = 128;
    for (t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = n - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var d = sumB / wB - (sum - sumB) / wF;
      var v = wB * wF * d * d;
      if (v > best) { best = v; thr = t; }
    }
    var len = data.length;
    if (!S.bw || S.bw.length !== len) S.bw = new Uint8ClampedArray(len);
    var out = S.bw;
    for (i = 0; i < len; i += 4) {
      var px = ((data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8) > thr ? 255 : 0;
      out[i] = out[i + 1] = out[i + 2] = px;
      out[i + 3] = 255;
    }
    return out;
  }

  /* 跑一个档位。
     取画方式刻意走「两步」：先用最朴素的 5 参 drawImage 把整帧取到中转画布，
     再从中转画布裁剪出需要的区域。直接对视频源用 9 参裁剪在某些
     WebView / 无头环境上会拿到空画面（实测：画面明明正常，解码却永远失败），
     两步走是所有环境都可靠的路径。 */
  function runPlan(p, v) {
    /* 缩放系数按「总像素数」算预算，而不是按长边 —— 解码耗时只看像素数 */
    var k = 1;
    var area = p.sw * p.sh;
    if (area > p.cap) k = Math.sqrt(p.cap / area);
    if (p.up) k *= p.up;
    var cw = Math.max(1, Math.round(p.sw * k));
    var ch = Math.max(1, Math.round(p.sh * k));

    var cv = S.cv, ctx = S.ctx;    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }

    var mirror = (p.flip === undefined) ? S.flip : p.flip;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (mirror) ctx.setTransform(-1, 0, 0, 1, cw, 0);
      /* 关键：按取样矩形等比绘制，画面绝不拉伸变形 */
      ctx.drawImage(S.src, p.sx, p.sy, p.sw, p.sh, 0, 0, cw, ch);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } catch (e) { return ''; }

    var data;
    try { data = ctx.getImageData(0, 0, cw, ch).data; } catch (e) { return ''; }
    if (!p.bw) frameStats(data);
    var feed = p.bw ? otsu(data) : data;

    var res = null;
    try {
      res = window.jsQR(feed, cw, ch, { inversionAttempts: p.inv || 'dontInvert' });
    } catch (e) { res = null; }

    S.lastPlan = p.id;
    if (res && res.data) {
      if (p.flip !== undefined && p.flip !== S.flip) S.flip = p.flip;   // 记住镜像方向
      return String(res.data);
    }
    return '';
  }

  /* 中转画布：每帧只从摄像头取一次整帧（5 参 drawImage，兼容性最好） */
  function ensureSrc(v) {
    var vw = v.videoWidth, vh = v.videoHeight;
    if (!S.src || S.srcW !== vw || S.srcH !== vh) {
      S.srcW = vw; S.srcH = vh;
      if (!S.src) {
        S.src = document.createElement('canvas');
        S.sctx = S.src.getContext('2d', { willReadFrequently: true });
      }
      S.src.width = vw; S.src.height = vh;
    }
    try { S.sctx.drawImage(v, 0, 0); } catch (e) { return false; }
    return true;
  }

  /* 系统自带条码识别（WebView 上通常没有，有就用，作为独立的一路） */
  function initDetector() {
    if (S.detTried) return;
    S.detTried = true;
    try {
      var BD = window.BarcodeDetector;
      if (!BD) return;
      var p = (typeof BD.getSupportedFormats === 'function') ? BD.getSupportedFormats() : Promise.resolve(null);
      Promise.resolve(p).then(function (sup) {
        if (!S.alive) return;
        try { S.det = (sup && sup.length) ? new BD({ formats: sup }) : new BD(); }
        catch (e) { S.det = null; }
      }).catch(function () {});
    } catch (e) { /* 没有就算了，jsQR 照样工作 */ }
  }

  function nativeProbe(cv) {
    if (!S.det || S.detBusy) return;
    var now = Date.now();
    if (now - S.lastDetAt < 500) return;
    S.lastDetAt = now;
    S.detBusy = true;
    Promise.resolve(S.det.detect(cv)).then(function (codes) {
      S.detBusy = false;
      if (!S.alive || !codes || !codes.length) return;
      for (var i = 0; i < codes.length; i++) {
        var val = codes[i] && codes[i].rawValue;
        if (val) { emitCode(val); return; }
      }
    }).catch(function () { S.detBusy = false; });
  }

  function emitCode(text) {
    if (!S.alive || S.done || !text) return;
    S.done = true;                       // 一单一码，避免重复入单
    S.hits++;
    S.lastText = String(text);
    var f = S.cb && S.cb.onCode;         // 注意：必须先把 done 置真再回调，
    if (f) {                             // 且这里不能走 tell() 的通用守卫
      try { f(S.lastText); S.cbOk = (S.cbOk || 0) + 1; }
      catch (e) { S.cbErr = String(e && e.message || e); }
    }
  }

  function emitMeta() {
    var now = Date.now();
    if (now - S.metaAt < 600) return;
    S.metaAt = now;
    var dt = now - S.fpsAt;
    if (dt >= 900) {
      S.fps = Math.round(S.frames * 1000 / dt);
      S.frames = 0;
      S.fpsAt = now;
    }
    var dark = S.emaLuma > 0 && S.emaLuma < DARK_LUMA;
    var black = S.blackStreak > BLACK_STREAK;
    tell('onMeta', {
      text: (S.vw || 0) + '\u00d7' + (S.vh || 0) + (S.fps ? ' \u00b7 ' + S.fps + 'fps' : '')
            + (S.tries ? ' \u00b7 ' + S.tries + '\u6b21' : ''),
      engine: S.det ? 'jsQR+BarcodeDetector' : 'jsQR',
      w: S.vw, h: S.vh, fps: S.fps, tries: S.tries,
      plan: S.lastPlan, luma: Math.round(S.lastLuma),
      dark: dark, black: black, torch: S.torchAvail
    });

    /* 光线不足：自动补光一次（用户仍可手动开关） */
    if (dark && !darkFired && !S.torchAuto && S.torchAvail) {
      S.torchAuto = true;
      setTorch(true).then(function (ok) { if (ok) tell('onTorch', true); });
    }
    darkFired = dark;

    /* 连续黑帧 → 如实告诉上层：相机会话在，但没有画面数据 */
    if (black && !S.stuck) {
      S.stuck = true;
      tell('onStuck', 'black');
    }
  }

  function loop() {
    if (!S.alive) return;
    S.raf = requestAnimationFrame(loop);

    var v = S.video;
    if (!v) return;

    /* 还没拿到画面尺寸：启动超时后如实上报，绝不无限黑屏 */
    if (!v.videoWidth || v.readyState < 2) {
      if (!S.stuck && S.startedAt && Date.now() - S.startedAt > NO_FRAME_MS) {
        S.stuck = true;
        tell('onStuck', 'noframes');
      }
      return;
    }

    var now = Date.now();
    if (now - S.lastAt < S.gap) return;
    S.lastAt = now;
    var t0 = now;

    if (v.videoWidth !== S.vw || v.videoHeight !== S.vh) {
      S.vw = v.videoWidth;
      S.vh = v.videoHeight;
      S.plan = buildPlan(S.vw, S.vh);
      S.pi = 0;
      tell('onGeometry', { width: S.vw, height: S.vh, torch: S.torchAvail });
    }

    S.frames++;

    /* 每帧只从摄像头取一次整帧，之后所有档位都从中转画布裁剪 */
    if (!ensureSrc(v)) { S.tries++; return; }

    var text = '';
    /* 基线档：整帧。命中率最高，每次必跑 */
    if (!S.done) text = runPlan(S.plan[0], v);
    /* 轮转档：每次再试一路，保证各种刁钻情况都被覆盖到 */
    if (!text && !S.done && S.plan.length > 1) {
      var k = 1 + (S.pi++ % (S.plan.length - 1));
      text = runPlan(S.plan[k], v);
    }
    if (!text && !S.done) text = '';
    S.tries += 2;

    if (!text && !S.done) nativeProbe(S.cv);

    /* 解码耗时自适应：慢机器自动降帧，不把界面拖卡 */
    S.cost = S.cost ? (S.cost * 0.75 + (Date.now() - t0) * 0.25) : (Date.now() - t0);
    S.gap = Math.max(TICK_MIN, Math.min(TICK_MAX, Math.round(S.cost * 1.25)));

    emitMeta();
    if (text) emitCode(text);
  }

  function notifyReady() {
    var v = S.video;
    if (!v || !v.videoWidth) return;
    tell('onReady', { width: v.videoWidth, height: v.videoHeight, torch: hasTorch() });
  }

  async function start(opts) {
    opts = opts || {};
    await stop();

    S.cb = opts;
    S.host = opts.host || null;
    S.done = false;
    S.startedAt = Date.now();
    S.vw = S.vh = 0;
    S.plan = null;
    S.pi = 0;
    S.tries = 0;
    S.hits = 0;
    S.lastText = '';
    S.cbOk = 0;
    S.cbErr = '';
    S.frames = 0;
    S.fps = 0;
    S.fpsAt = Date.now();
    S.metaAt = 0;
    S.lastAt = 0;
    S.cost = 0;
    S.gap = 110;
    S.emaLuma = 0;
    S.lastLuma = 0;
    S.blackStreak = 0;
    darkFired = false;
    S.torchAuto = false;
    S.torchAvail = false;
    S.stuck = false;
    S.lastPlan = '';
    ensureCanvas();
    S.bw = null;
    S.det = null;
    S.detBusy = false;
    S.lastDetAt = 0;

    if (!available()) return fail('unsupported', 'jsQR or getUserMedia missing');

    var stream;
    try {
      stream = await openStream();
    } catch (e) {
      return fail(classify(e), (e && e.message) || '');
    }

    S.alive = true;
    S.stream = stream;
    var t = track();

    /* 尽量开启连续对焦（不支持就算了） */
    try {
      if (t && t.applyConstraints) {
        Promise.resolve(t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })).catch(function () {});
      }
    } catch (e) {}

    /* 前置摄像头画面是镜像的，镜像的二维码无法解码 —— 翻转回来 */
    try {
      var st = t && t.getSettings ? t.getSettings() : null;
      S.flip = !!(st && st.facingMode === 'user');
    } catch (e) { S.flip = false; }

    var host = S.host;
    if (host) { try { host.innerHTML = ''; } catch (e) {} }

    var v = document.createElement('video');
    v.className = 'cam-video';
    v.setAttribute('playsinline', 'true');
    v.setAttribute('webkit-playsinline', 'true');
    v.setAttribute('autoplay', 'true');
    v.setAttribute('muted', 'true');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.srcObject = stream;
    if (host) { try { host.appendChild(v); } catch (e) {} }
    S.video = v;

    /* 等画面尺寸；自动播放被拦时反复重试，不静默失败 */
    await new Promise(function (resolve) {
      var done = false;
      var fin = function () { if (!done) { done = true; resolve(); } };
      v.addEventListener('loadedmetadata', fin);
      v.addEventListener('loadeddata', fin);
      setTimeout(fin, 4000);
      var kick = function () {
        if (done) return;
        try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      };
      kick();
      setTimeout(kick, 400);
      setTimeout(kick, 1200);
      setTimeout(kick, 2500);
    });

    v.addEventListener('resize', notifyReady);
    /* 用户手一碰画面也顺手再补一次播放（个别设备自动播放会被拦） */
    if (host) host.addEventListener('click', function () {
      try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }, true);

    if (t) {
      t.addEventListener('ended', function () {
        if (S.alive) tell('onLost');
      });
    }

    S.torchAvail = hasTorch();
    notifyReady();
    initDetector();
    loop();
    return { ok: true, kind: 'ok', message: '' };
  }

  async function stop() {
    S.alive = false;
    S.done = false;
    if (S.raf) { try { cancelAnimationFrame(S.raf); } catch (e) {} S.raf = 0; }

    var v = S.video;
    S.video = null;
    if (v) {
      try { v.pause(); } catch (e) {}
      try { v.srcObject = null; } catch (e) {}
      try { if (v.parentNode) v.parentNode.removeChild(v); } catch (e) {}
    }

    var s = S.stream;
    S.stream = null;
    if (s) {
      try {
        s.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      } catch (e) {}
    }

    S.det = null;
    S.detBusy = false;
    S.detTried = false;
    S.plan = null;

    var host = S.host;
    if (host) { try { host.innerHTML = ''; } catch (e) {} }
  }

  async function setTorch(on) {
    try {
      var t = track();
      if (!t || !t.applyConstraints) return false;
      await t.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch (e) { return false; }
  }

  /* 每帧复用同一块画布，避免反复分配内存 */
  function ensureCanvas() {
    if (!S.cv) {
      S.cv = document.createElement('canvas');
      S.ctx = S.cv.getContext('2d', { willReadFrequently: true });
    }
  }

  return {
    available: available,
    video: video,
    info: info,
    start: start,
    stop: stop,
    setTorch: setTorch
  };
})();
