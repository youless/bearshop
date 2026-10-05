/* ============================================================
   BearShop · 主程序
   中文 / English 双语 · 扫码入库 · 扫码售出结算
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const APP_VERSION = '1.0.9';

  const state = {
    tab: 'sell',
    cart: [],            // { code, name, price, unit, qty }
    pending: null,       // 扫码后待入清单的商品
    scanMode: 'sell',    // sell | stock
    scanBusy: false,
    unit: 'pc',          // 入库表单的计价方式
    stockMode: 'new',    // new | restock
    editFields: false,   // 补货时是否展开资料编辑
    qrProduct: null,
    lastMeta: null,      // 扫码引擎最新一次诊断快照
    nmProduct: null,     // 品名入库：匹配到的已有商品（null = 新商品）
    nmUnit: 'pc'         // 品名入库（新商品）的计价方式
  };

  const BS = window.BearScanner || null;   // 自研扫码引擎（js/scanner.js）
  let toastTimer = null;

  /* ============================================================
     工具
     ============================================================ */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const t = (k, v) => I18n.t(k, v);
  const unitText = u => (u === 'jin' ? t('unit_jin') : t('unit_pc'));

  function toast(msg, ms) {
    const box = $('#toast');
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, ms || 2000);
  }

  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 45); } catch (e) {} }

  function openSheet(id) { const e = $('#' + id); if (e) e.hidden = false; }
  function closeSheet(id) { const e = $('#' + id); if (e) e.hidden = true; }

  function download(filename, content, type) {
    try {
      const blob = new Blob([content], { type: type || 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
      return true;
    } catch (e) { return false; }
  }

  /* ============================================================
     原生外壳（Android APK）桥接
     在浏览器里 Native 为空，一切走 Web 原生能力；
     在 APK 里由 MainActivity 注入 BearShopNative 对象。
     ============================================================ */
  const Native = (typeof window.BearShopNative !== 'undefined' && window.BearShopNative) || null;
  const isApp = !!Native;
  // APK 里资源以 https://appassets.androidplatform.net/ 加载，属于安全上下文，
  // 但为节省体积与规避 Service Worker 兼容问题，外壳内不注册 SW。
  const isShellOrigin = isApp || location.hostname === 'appassets.androidplatform.net';

  function nativeSaveText(filename, text) {
    try { return !!Native.saveText(filename, String(text)); } catch (e) { return false; }
  }
  function nativeSaveImage(filename, dataUrl) {
    try { return !!Native.saveImage(filename, String(dataUrl)); } catch (e) { return false; }
  }
  // 打印标签：外壳交给 Android 系统打印服务（可另存为 PDF / 直连打印机），浏览器用 window.print()
  function doPrint() {
    if (isApp) { try { Native.print(); return; } catch (e) {} }
    window.print();
  }

  /* ---------- 通用提示 / 确认弹层 ---------- */
  function buildNoticeSheet() {
    const wrap = document.createElement('div');
    wrap.className = 'sheet';
    wrap.id = 'noticeSheet';
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="sheet-mask" data-close="noticeSheet"></div>
      <div class="sheet-panel">
        <span class="sheet-bear" id="noticeBear"></span>
        <div class="sheet-head"><h3 id="noticeTitle"></h3></div>
        <p class="sheet-sub" id="noticeText"></p>
        <div class="row2">
          <button class="btn btn-ghost" id="noticeCancel" type="button"></button>
          <button class="btn btn-primary" id="noticeOk" type="button"></button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    $('#noticeCancel').addEventListener('click', () => {
      closeSheet('noticeSheet');
      if (wrap._onCancel) wrap._onCancel();
    });
    $('#noticeOk').addEventListener('click', () => {
      closeSheet('noticeSheet');
      if (wrap._onOk) wrap._onOk();
    });
  }

  function notice(opt) {
    const wrap = $('#noticeSheet');
    wrap._onOk = opt.onOk || null;
    wrap._onCancel = opt.onCancel || null;
    $('#noticeBear').innerHTML = opt.bear || BEARS.face(72);
    $('#noticeTitle').textContent = opt.title || '';
    $('#noticeText').textContent = opt.text || '';
    $('#noticeCancel').textContent = opt.cancel || t('cancel');
    $('#noticeOk').textContent = opt.ok || t('confirm');
    $('#noticeCancel').hidden = !!opt.onlyOk;
    openSheet('noticeSheet');
  }

  const confirmBox = (title, text, onOk, okText) =>
    notice({ title, text, onOk, ok: okText || t('confirm'), bear: BEARS.search(72) });

  /* ============================================================
     北极熊素材注入
     ============================================================ */
  function renderBears() {
    $('#brandMark').innerHTML = BEARS.mark(38);
    $('#heroBear').innerHTML = BEARS.wave(76);
    $('#stockBear').innerHTML = BEARS.scan(76);
    $('#scanBear').innerHTML = BEARS.face(66);
    $('#scanErrorBear').innerHTML = BEARS.search(130);
    $('#qtyBear').innerHTML = BEARS.scan(72);
    $('#coBear').innerHTML = BEARS.face(72);
    $('#qrBear').innerHTML = BEARS.face(72);
    $('#bkBear').innerHTML = BEARS.basket(72);
    $('#nmBear').innerHTML = BEARS.happy(72);
    $('#codeBear').innerHTML = BEARS.face(72);
    $('#okBear').innerHTML = BEARS.happy(140);
    $('#aboutBear').innerHTML = BEARS.mark(62);
    $$('[data-ico]').forEach(el => { el.innerHTML = BEARS.icon(el.getAttribute('data-ico'), 22); });
  }

  /* ============================================================
     底部导航
     ============================================================ */
  const TABS = [
    { key: 'sell', label: 'tab_sell', icon: 'sell' },
    { key: 'stock', label: 'tab_stock', icon: 'stock' },
    { key: 'product', label: 'tab_product', icon: 'product' },
    { key: 'record', label: 'tab_record', icon: 'records' },
    { key: 'setting', label: 'tab_setting', icon: 'settings' }
  ];

  function renderTabs() {
    const nav = $('#tabbar');
    nav.innerHTML = TABS.map(tb => `
      <button class="tab${state.tab === tb.key ? ' on' : ''}" type="button" data-tab="${tb.key}">
        <span class="tab-ico">${BEARS.icon(tb.icon, 21)}</span>
        <span class="tab-label" data-tab-i18n="${tb.label}">${esc(t(tb.label))}</span>
      </button>`).join('');
  }

  function switchTab(key) {
    state.tab = key;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + key));
    $$('.tab').forEach(b => b.classList.toggle('on', b.getAttribute('data-tab') === key));
    const main = $('#main');
    if (main) main.scrollTop = 0;
    if (key === 'product') renderProducts();
    if (key === 'record') renderRecords();
    if (key === 'setting') renderSettings();
  }

  /* ============================================================
     语言
     ============================================================ */
  function applyLang() {
    document.documentElement.lang = I18n.lang === 'en' ? 'en' : 'zh-CN';
    document.title = 'BearShop · ' + t('tagline');
    $('#langBtn').textContent = I18n.switchLabel();     // 中文界面 → English；英文界面 → 中文
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    $$('[data-tab-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-tab-i18n')); });
    $$('#langSeg button').forEach(b => b.classList.toggle('on', b.getAttribute('data-lang') === I18n.lang));
    $('#brandName').textContent = Store.getShop();
    $('#aboutVer').textContent = t('se_version', { v: APP_VERSION });
    $('#qtyQuick').innerHTML = quickValues()
      .map(v => `<button type="button" data-q="${v}">${v}</button>`).join('');
    renderCart();
    renderProducts();
    renderRecords();
    renderSettings();
  }

  function setLang(lang) {
    I18n.set(lang);
    applyLang();
  }

  /* ============================================================
     销售：清单
     ============================================================ */
  function cartTotal() {
    return Store.round2(state.cart.reduce((s, i) => s + i.price * i.qty, 0));
  }
  function cartUnits() {
    return Store.round3(state.cart.reduce((s, i) => s + i.qty, 0));
  }

  function renderCart() {
    const list = $('#cartList');
    const btnCheckout = $('#btnCheckout');
    $('#cartTotal').textContent = Store.money(cartTotal());
    $('#cartCount').textContent = Store.num(cartUnits());
    $('#btnClearCart').hidden = state.cart.length === 0;

    if (!state.cart.length) {
      list.innerHTML = `<div class="empty">
        <span class="empty-bear">${BEARS.basket(128)}</span>
        <h4>${esc(t('sell_cartEmpty'))}</h4>
        <p>${esc(t('sell_cartEmptyHint'))}</p>
      </div>`;
      btnCheckout.disabled = true;
      return;
    }

    list.innerHTML = state.cart.map((it, i) => `
      <div class="cart-item">
        <div class="ci-main">
          <div class="ci-name">${esc(it.name)}</div>
          <div class="ci-sub">${Store.money(it.price)} / ${esc(unitText(it.unit))} × ${Store.num(it.qty)}${esc(unitText(it.unit))}</div>
        </div>
        <div class="ci-amt">${Store.money(it.price * it.qty)}</div>
        <button class="ci-del" type="button" data-del="${i}" aria-label="remove">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`).join('');
    btnCheckout.disabled = false;
  }

  function removeCartItem(i) {
    const it = state.cart[i];
    if (!it) return;
    state.cart.splice(i, 1);
    renderCart();
    toast(t('removedMsg', { name: it.name }));
  }

  /* ============================================================
     扫码
     ============================================================ */
  /* ---------- 相机权限（APK 外壳）----------
     APK 里由原生侧负责申请相机权限，申请结果通过 BearShopCameraResult 回传。
     必须「先授权、后调用摄像头」：如果让 WebView 自己去请求，系统权限弹窗会让
     Activity 暂停，WebView 会取消那个挂起的 getUserMedia，表现为扫码完全没反应。 */
  let camWaiters = [];
  window.BearShopCameraResult = function (ok, reason) {
    const list = camWaiters;
    camWaiters = [];
    list.forEach(fn => { try { fn(!!ok, String(reason || '')); } catch (e) {} });
  };

  function ensureCameraNative(timeoutMs) {
    return new Promise(resolve => {
      if (!isApp) { resolve(true, 'browser'); return; }
      let settled = false;
      const done = (ok, reason) => { if (!settled) { settled = true; resolve(!!ok, String(reason || '')); } };
      camWaiters.push(done);
      try { Native.ensureCamera(); } catch (e) { done(false, 'bridge'); return; }
      setTimeout(() => done(false, 'waitTimeout'), timeoutMs || 25000);
    });
  }

  // 等弹层完成布局（取景容器有真实尺寸后）再启动摄像头，否则扫码库拿不到画面尺寸
  function nextFrame() {
    return new Promise(res => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 70)));
    });
  }

  // 给 getUserMedia 加超时：某些机型上它既不成功也不报错，会永远挂住
  function withTimeout(promise, ms, timeoutMsg) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error(timeoutMsg || t('sc_timeoutHint')));
      }, ms);
      Promise.resolve(promise).then(
        v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        e => { if (!done) { done = true; clearTimeout(timer); reject(e); } }
      );
    });
  }

  function isTimeoutError(e) {
    const m = String((e && (e.message || e)) || '');
    return m.indexOf(t('sc_timeoutHint')) >= 0 || /timeout/i.test(m);
  }

  async function openScan(mode) {
    state.scanMode = mode;
    state.scanBusy = false;
    $('#scanTitle').textContent = t(mode === 'sell' ? 'sc_title_sell' : 'sc_title_stock');
    $('#scanHint').textContent = t('sc_hint');
    $('#scanError').hidden = true;
    $('#scanErrSettings').hidden = true;
    $('#scanTorch').hidden = true;

    if (isApp) {
      // 先弹出界面再申请权限，用户能看到「为什么要相机」的上下文
      openSheet('scanSheet');
      $('#scanHint').textContent = t('sc_permAsk');
      const r = await ensureCameraNative(30000);
      if (!r.ok && r.reason === 'blocked') {
        showScanError(t('sc_permissionTitle'), t('sc_blockedHint'), true);
        return;
      }
      if (!r.ok && r.reason === 'denied') {
        showScanError(t('sc_permissionTitle'), t('sc_deniedHint'), true);
        return;
      }
      // granted / waitTimeout 都继续尝试启动，具体错误交给 startScan 报告
    } else {
      openSheet('scanSheet');
    }

    await nextFrame();
    startScan();
  }

  /* ---------- 取景框尺寸 ----------
     预览框按摄像头画面的宽高比等比定尺寸（只影响观感）。
     真正保证识别的是引擎：解码画布永远按画面真实比例建立，绝不拉伸。 */
  function fitStageToVideo() {
    const host = $('#qrReader');
    const stage = host && host.parentElement;
    const v = BS && BS.video();
    if (!host || !stage || !v || !v.videoWidth || !v.videoHeight) return false;
    const aw = stage.clientWidth, ah = stage.clientHeight;
    if (!aw || !ah) return false;
    const k = Math.min(aw / v.videoWidth, ah / v.videoHeight);
    host.style.width = Math.max(120, Math.round(v.videoWidth * k)) + 'px';
    host.style.height = Math.max(120, Math.round(v.videoHeight * k)) + 'px';
    host.style.aspectRatio = v.videoWidth + ' / ' + v.videoHeight;
    return true;
  }

  /* 旋屏 / 窗口变化后重算取景框；解码几何不受影响，无需重启摄像头 */
  let refitTimer = null;

  function bindScanRefit() {
    const onResize = function () {
      if (refitTimer) clearTimeout(refitTimer);
      refitTimer = setTimeout(function () {
        if ($('#scanSheet').hidden) return;
        fitStageToVideo();
      }, 260);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', onResize);
    }
  }

  /* ---------- 提示 / 诊断信息 ---------- */
  let tipTimer = null;

  function clearTipTimer() { if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; } }

  function startTipTimer() {
    clearTipTimer();
    tipTimer = setTimeout(function () {
      if (!state.scanBusy) $('#scanHint').textContent = t('sc_tip');
    }, 9000);
  }

  function setScanMeta(text) {
    const el = $('#scanMeta');
    if (el) el.textContent = text || '';
  }

  /* 状态行：默认只给用户看分辨率和帧率；
     长按标题（约 0.7 秒）可展开引擎诊断，出了问题时方便截图反馈。 */
  let scanDiag = false;

  function metaLine(m) {
    m = m || {};
    const base = m.text || '';
    if (scanDiag) {
      return base + ' · ' + (m.engine || '?') + ' · ' + (m.plan || '?')
        + ' · L' + (m.luma == null ? '-' : m.luma) + (m.black ? '!' : '');
    }
    if (m.black) return base + ' · ' + t('sc_diagBlack');
    if (m.dark) return base + ' · ' + t('sc_diagDark');
    return base;
  }

  /* ---------- 启动 / 停止 ---------- */
  async function startScan() {
    $('#scanError').hidden = true;
    $('#scanErrSettings').hidden = true;
    setScanMeta('');

    if (!window.isSecureContext && location.protocol !== 'file:') {
      showScanError(t('sc_denied'), t('sc_insecure'));
      return;
    }
    if (!BS || !BS.available()) {
      showScanError(t('sc_denied'), t('sc_unavailable'));
      return;
    }

    $('#scanHint').textContent = t('sc_starting');
    await stopScan();

    const r = await BS.start({
      host: $('#qrReader'),
      onCode: function (text) { onScanSuccess(text); },
      onReady: function (info) {
        fitStageToVideo();
        setScanMeta(info.width + '\u00d7' + info.height);
        $('#scanHint').textContent = t('sc_hint');
        const tb = $('#scanTorch');
        tb.hidden = !info.torch;
        tb.dataset.on = '0';
        tb.textContent = t('sc_torchOff');
        startTipTimer();
      },
      /* 画面尺寸晚一拍才确定时重新贴合取景框 */
      onGeometry: function (info) {
        fitStageToVideo();
        const tb = $('#scanTorch');
        if (tb) tb.hidden = !info.torch;
      },
      onMeta: function (m) {
        state.lastMeta = m;
        setScanMeta(metaLine(m));
        if (m.black) {
          if (!state.scanBusy) $('#scanHint').textContent = t('sc_blackHint');
        } else if (m.dark) {
          if (!state.scanBusy) $('#scanHint').textContent = t('sc_darkHint');
        }
      },
      /* 光线不足时引擎自动补了光 */
      onTorch: function (on) {
        const tb = $('#scanTorch');
        if (!tb) return;
        tb.hidden = false;
        tb.dataset.on = on ? '1' : '0';
        tb.textContent = on ? t('sc_torchOn') : t('sc_torchOff');
      },
      onLost: function () {
        if (state.scanBusy) return;
        try { BS.stop(); } catch (e) {}
        showScanError(t('sc_denied'), t('sc_busyHint'), false);
      },
      /* 引擎卡住时如实告知，绝不无限黑屏 */
      onStuck: function (reason) {
        if (state.scanBusy) return;
        if (reason === 'noframes') {
          try { BS.stop(); } catch (e) {}
          showScanError(t('sc_denied'), t('sc_busyHint'), false);
        } else if (reason === 'black') {
          $('#scanHint').textContent = t('sc_blackHint');
        }
      }
    });

    if (r && r.ok) return;
    try { await BS.stop(); } catch (e) {}

    const kind = (r && r.kind) || 'other';
    const denied = kind === 'denied';
    showScanError(
      denied ? t('sc_permissionTitle') : t('sc_denied'),
      denied ? t('sc_deniedHint')
        : (kind === 'busy' ? t('sc_busyHint')
        : (kind === 'timeout' ? t('sc_timeoutHint')
        : ((r && r.message) || t('sc_noCamera')))),
      denied
    );
  }

  async function stopScan() {
    clearTipTimer();
    setScanMeta('');
    if (!BS) return;
    try { await BS.stop(); } catch (e) {}
  }

  function showScanError(title, text, showSettings) {
    $('#scanErrTitle').textContent = title;
    $('#scanErrText').textContent = text;
    $('#scanErrSettings').hidden = !showSettings;
    $('#scanError').hidden = false;
  }

  async function closeScan() {
    await stopScan();
    closeSheet('scanSheet');
  }

  async function onScanSuccess(text) {
    if (state.scanBusy) return;
    state.scanBusy = true;
    vibrate(60);
    const code = Store.normCode(text);
    await closeScan();
    handleCode(code);
  }

  function handleCode(code) {
    if (!code) return;
    if (state.scanMode === 'stock') {
      switchTab('stock');
      openStockForm(code);
    } else {
      openQtySheet(code);
    }
  }

  function openManual(mode) {
    state.scanMode = mode;
    const inp = $('#codeInput');
    inp.value = '';
    openSheet('codeSheet');
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 240);
  }

  /* ============================================================
     销售：数量面板
     ============================================================ */
  function quickValues() {
    return state.pending && state.pending.unit === 'jin' ? [0.5, 1, 2, 5] : [1, 2, 5, 10];
  }

  function openQtySheet(code) {
    const p = Store.getProduct(code);
    if (!p) {
      notice({
        bear: BEARS.search(72),
        title: t('sell_notFound'),
        text: t('sell_notFoundHint', { code }),
        ok: t('sell_goStock'),
        onOk: function () { switchTab('stock'); openStockForm(code); }
      });
      return;
    }
    state.pending = p;
    $('#qtyName').textContent = p.name;
    $('#qtyUnitTag').textContent = unitText(p.unit);
    $('#qtyPrice').textContent = Store.money(p.price) + ' / ' + unitText(p.unit);
    $('#qtyStock').textContent = Store.num(p.stock) + ' ' + unitText(p.unit);
    $('#qtyInput').setAttribute('step', p.unit === 'jin' ? '0.1' : '1');
    $('#qtyInput').value = p.unit === 'jin' ? '1' : '1';
    $('#qtyQuick').innerHTML = quickValues().map(v => `<button type="button" data-q="${v}">${v}</button>`).join('');
    const warn = $('#qtyWarn');
    if (p.price <= 0) { warn.hidden = false; warn.textContent = t('sell_priceZero'); }
    else { warn.hidden = true; }
    updateQtyAmount();
    openSheet('qtySheet');
  }

  function updateQtyAmount() {
    const p = state.pending;
    if (!p) return;
    const q = parseFloat($('#qtyInput').value) || 0;
    $('#qtyAmount').textContent = Store.money(p.price * q);
    const warn = $('#qtyWarn');
    if (p.price > 0 && q > 0 && q > p.stock) {
      warn.hidden = false;
      warn.textContent = t('sell_outOfStock', { n: Store.num(p.stock), unit: unitText(p.unit) });
    } else if (p.price > 0) {
      warn.hidden = true;
    }
  }

  function addToCart() {
    const p = state.pending;
    if (!p) return;
    const q = Store.round3(parseFloat($('#qtyInput').value));
    if (!q || q <= 0) { toast(t('sell_zeroQty')); return; }
    const i = state.cart.findIndex(x => x.code === p.code);
    if (i >= 0) state.cart[i].qty = Store.round3(state.cart[i].qty + q);
    else state.cart.push({ code: p.code, name: p.name, price: p.price, unit: p.unit, qty: q });
    state.pending = null;
    closeSheet('qtySheet');
    renderCart();
    vibrate(30);
    toast(t('sell_addedMsg', { name: p.name }));
  }

  /* ============================================================
     结算
     ============================================================ */
  function openCheckout() {
    if (!state.cart.length) return;
    const total = cartTotal();
    $('#coSub').textContent = t('co_items', { n: state.cart.length, q: Store.num(cartUnits()) });
    $('#coList').innerHTML = state.cart.map(it => `
      <div class="co-line">
        <div class="co-line-l">
          <div class="co-line-name">${esc(it.name)}</div>
          <div class="co-line-sub">${Store.money(it.price)} × ${Store.num(it.qty)}${esc(unitText(it.unit))}</div>
        </div>
        <div class="co-line-r">${Store.money(it.price * it.qty)}</div>
      </div>`).join('');
    $('#coTotal').textContent = Store.money(total);
    openSheet('coSheet');
  }

  function payNow() {
    if (!state.cart.length) return;
    const total = cartTotal();
    Store.addSale({ items: state.cart.slice(), total });
    state.cart = [];
    closeSheet('coSheet');
    renderCart();
    renderProducts();
    renderRecords();
    vibrate([40, 60, 40]);

    $('#okAmount').textContent = Store.money(total);
    $('#okTitle').textContent = t('co_paid');
    $('#okThanks').textContent = t('co_thanks');
    openSheet('okOverlay');
  }

  /** 收款成功浮层上的「返回」：关掉浮层，回到销售界面 */
  function closeOkOverlay() {
    closeSheet('okOverlay');
    if (state.tab !== 'sell') switchTab('sell');
  }

  /* ============================================================
     入库
     ============================================================ */
  function openStockForm(code) {
    const p = Store.getProduct(code);
    switchTab('stock');
    $('#stockFormCard').hidden = false;

    if (p) {
      state.stockMode = 'restock';
      state.editFields = false;
      state.pendingCode = p.code;
      $('#stockFormTitle').textContent = t('st_restock');
      $('#stockFormCode').textContent = p.code;
      $('#stockExistingBox').hidden = false;
      $('#stockNewFields').hidden = !state.editFields;
      $('#stkName').textContent = p.name;
      $('#stkPrice').textContent = Store.money(p.price) + ' / ' + unitText(p.unit);
      $('#stkStock').textContent = Store.num(p.stock) + ' ' + unitText(p.unit);
      $('#inQty').value = '';
      setUnitSeg(p.unit);
      $('#stockQtyLabel').textContent = p.unit === 'jin' ? t('st_addJin') : t('st_addQty');
      $('#btnStockEdit').textContent = t('st_editInfo');
      $('#stockEditRow').hidden = false;
      $('#inName').value = p.name;
      $('#inPrice').value = p.price;
    } else {
      state.stockMode = 'new';
      state.editFields = true;
      state.pendingCode = code || Store.nextCode();
      $('#stockFormTitle').textContent = t('st_new');
      $('#stockFormCode').textContent = state.pendingCode;
      $('#stockExistingBox').hidden = true;
      $('#stockNewFields').hidden = false;
      $('#stockEditRow').hidden = true;
      setUnitSeg(state.unit);
      $('#stockQtyLabel').textContent = state.unit === 'jin' ? t('st_stockJin') : t('st_stockQty');
      $('#inName').value = '';
      $('#inPrice').value = '';
      $('#inQty').value = '';
    }
    $('#stockFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setUnitSeg(u) {
    state.unit = u === 'jin' ? 'jin' : 'pc';
    $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.getAttribute('data-unit') === state.unit));
    if (state.stockMode === 'new') {
      $('#stockQtyLabel').textContent = state.unit === 'jin' ? t('st_stockJin') : t('st_stockQty');
    }
  }

  function saveStock() {
    const code = state.pendingCode;
    if (!code) return;
    const name = $('#inName').value.trim();
    const price = parseFloat($('#inPrice').value);
    const qty = Store.round3(parseFloat($('#inQty').value));

    if (state.stockMode === 'restock' && !state.editFields) {
      if (!qty || qty <= 0) { toast(t('st_needQty')); return; }
      const p = Store.addStock(code, qty);
      toast(t('st_savedStock', { name: p ? p.name : code, n: Store.num(qty) }));
      $('#inQty').value = '';
      if (p) {
        $('#stkStock').textContent = Store.num(p.stock) + ' ' + unitText(p.unit);
      }
      renderProducts();
      setTimeout(() => openScan('stock'), 420);
      return;
    }

    if (!name) { toast(t('st_needName')); return; }
    if (isNaN(price) || price < 0) { toast(t('st_needPrice')); return; }
    if (!qty || qty <= 0) { toast(t('st_needQty')); return; }

    const isNew = !Store.getProduct(code);
    let stock = qty;
    if (!isNew && state.stockMode === 'restock') {
      const prev = Store.getProduct(code);
      stock = Store.round3(prev.stock + qty);
    }
    const p = Store.upsertProduct({ code, name, price, unit: state.unit, stock });
    renderProducts();
    toast(t('st_savedNew', { name: p.name }));
    vibrate(40);

    if (isNew) {
      notice({
        bear: BEARS.happy(72),
        title: t('st_savedNew', { name: p.name }),
        text: t('st_newCodeIs', { code: p.code }),
        cancel: t('later'),
        ok: t('st_printNow'),
        onOk: function () { openQR(p); },
        onCancel: function () { openScan('stock'); }
      });
    } else {
      openScan('stock');
    }
  }

  /* ============================================================
     入库 · 输入品名（不扫码：品名 → 自动编号 + 二维码 → 填数量）
     ============================================================ */
  function openNameSheet() {
    switchTab('stock');
    state.nmProduct = null;
    state.nmUnit = 'pc';
    $('#nmName').value = '';
    $('#nmPriceIn').value = '';
    $('#nmQty').value = '';
    setNmUnit('pc');
    hideNmSug();
    applyNmMatch(null);
    openSheet('nameSheet');
    setTimeout(() => { try { $('#nmName').focus(); } catch (e) {} }, 260);
  }

  function hideNmSug() {
    const box = $('#nmSug');
    box.hidden = true;
    box.innerHTML = '';
  }

  function setNmUnit(u) {
    state.nmUnit = u === 'jin' ? 'jin' : 'pc';
    $$('#nmUnitSeg button').forEach(b =>
      b.classList.toggle('on', b.getAttribute('data-unit') === state.nmUnit));
    if (!state.nmProduct) renderNmQuick();
  }

  /* 当前生效的计价方式：匹配到已有商品时以该商品为准 */
  function nmUnit() { return state.nmProduct ? state.nmProduct.unit : state.nmUnit; }

  function renderNmQuick() {
    const u = nmUnit();
    const vals = u === 'jin' ? [1, 2, 5, 10] : [1, 6, 12, 24];
    $('#nmQuick').innerHTML = vals.map(v => `<button type="button" data-nq="${v}">${v}</button>`).join('');
    $('#nmUnitTag').textContent = unitText(u);
    $('#nmQty').setAttribute('step', u === 'jin' ? '0.1' : '1');
    $('#nmQtyLabel').textContent = state.nmProduct
      ? (u === 'jin' ? t('st_addJin') : t('st_addQty'))
      : (u === 'jin' ? t('st_stockJin') : t('st_stockQty'));
  }

  /* 命中已有商品 → 表单切成「补货」形态（只填数量） */
  function applyNmMatch(p) {
    state.nmProduct = p || null;
    $('#nmExistingBox').hidden = !p;
    $('#nmNewFields').hidden = !!p;
    if (p) {
      $('#nmFlag').textContent = t('nm_existing');
      $('#nmPrice').textContent = Store.money(p.price) + ' / ' + unitText(p.unit);
      $('#nmStock').textContent = Store.num(p.stock) + ' ' + unitText(p.unit);
    }
    renderNmQuick();
  }

  /* 品名 / 编号模糊搜索（最多 5 条），完全同名直接判定为已有商品 */
  function nmSearch(kw) {
    const k = String(kw || '').trim().toLowerCase();
    if (!k) return [];
    return Store.listProducts().filter(p =>
      String(p.name).toLowerCase().indexOf(k) >= 0 ||
      String(p.code).toLowerCase().indexOf(k) >= 0
    ).slice(0, 5);
  }

  function renderNmSug() {
    const kw = $('#nmName').value.trim();
    const hit = nmSearch(kw);
    const exact = hit.filter(p => String(p.name).toLowerCase() === kw.toLowerCase())[0] || null;
    applyNmMatch(exact);

    const box = $('#nmSug');
    if (!kw || !hit.length || exact) { hideNmSug(); return; }
    box.innerHTML = hit.map(p => `
      <button type="button" data-pick="${esc(p.code)}">
        <div class="s-name">${esc(p.name)}</div>
        <div class="s-sub">${esc(p.code)} · ${Store.money(p.price)} / ${esc(unitText(p.unit))} · ${esc(t('pd_stockShort', { n: Store.num(p.stock) }))}</div>
      </button>`).join('');
    box.hidden = false;
  }

  function pickNmProduct(code) {
    const p = Store.getProduct(code);
    if (!p) return;
    $('#nmName').value = p.name;
    applyNmMatch(p);
    hideNmSug();
    setTimeout(() => { try { $('#nmQty').focus(); } catch (e) {} }, 60);
  }

  function saveNameStock() {
    const name = $('#nmName').value.trim();
    const qty = Store.round3(parseFloat($('#nmQty').value));
    if (!name) { toast(t('st_needName')); return; }
    if (!qty || qty <= 0) { toast(t('st_needQty')); return; }

    /* ---- 已有商品：补货，留在表单里方便连着一件件入 ---- */
    const hit = state.nmProduct || Store.listProducts().filter(
      p => String(p.name).toLowerCase() === name.toLowerCase())[0] || null;
    if (hit) {
      const p = Store.addStock(hit.code, qty);
      renderProducts();
      vibrate(40);
      toast(t('nm_restocked', { name: p.name, n: Store.num(qty) }), 2400);
      $('#nmName').value = '';
      $('#nmQty').value = '';
      hideNmSug();
      applyNmMatch(null);
      setTimeout(() => { try { $('#nmName').focus(); } catch (e) {} }, 160);
      return;
    }

    /* ---- 新商品：自动编号 → 入库 → 立刻出二维码 ---- */
    const price = parseFloat($('#nmPriceIn').value);
    if (isNaN(price) || price < 0) { toast(t('st_needPrice')); return; }

    const p = Store.upsertProduct({
      code: Store.nextCode(), name, price, unit: state.nmUnit, stock: qty
    });
    renderProducts();
    renderSettings();
    vibrate([30, 40, 30]);
    closeSheet('nameSheet');
    openQR(p, t('nm_qrReady'));
  }

  /* ============================================================
     商品
     ============================================================ */
  function productStockTotal() {
    return Store.listProducts().reduce((s, p) => s + (Number(p.stock) || 0), 0);
  }

  function renderProducts() {
    const box = $('#pdList');
    if (!box) return;
    const kw = ($('#pdSearch').value || '').trim().toLowerCase();
    let list = Store.listProducts();
    if (kw) {
      list = list.filter(p =>
        p.name.toLowerCase().indexOf(kw) >= 0 || String(p.code).toLowerCase().indexOf(kw) >= 0);
    }
    $('#pdCount').textContent = t('pd_count', { n: list.length }) +
      ' · ' + t('pd_countStock', { n: Store.num(productStockTotal()) });

    if (!list.length) {
      box.innerHTML = `<div class="card empty">
        <span class="empty-bear">${BEARS.basket(128)}</span>
        <h4>${esc(t('pd_empty'))}</h4>
        <p>${esc(t('pd_emptyHint'))}</p>
      </div>`;
      return;
    }

    box.innerHTML = list.map(p => `
      <div class="pd-item" data-code="${esc(p.code)}">
        <span class="pd-ico">${BEARS.face(34)}</span>
        <div class="pd-main">
          <div class="pd-name">${esc(p.name)}</div>
          <div class="pd-sub">${esc(p.code)} · ${esc(unitText(p.unit))}</div>
        </div>
        <div class="pd-right">
          <div class="pd-price">${Store.money(p.price)}</div>
          <div class="pd-stock${p.stock <= 0 ? ' low' : ''}">${esc(t('pd_stockShort', { n: Store.num(p.stock) }))}</div>
        </div>
      </div>`).join('');
  }

  /* ============================================================
     二维码
     生成的图片 = 上方的品名标题 + 下方二维码，整体白底深字。
     标题不会侵入二维码的静默区，因此不影响扫描。
     ============================================================ */
  const QR_FONT = '700 %spx "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif';
  const QR_INK = '#0B1620';

  /** 中文按字断行、拉丁按词断行，最多 maxRows 行，放不下返回 null */
  function wrapTokens(ctx, text, maxW, maxRows) {
    const toks = [];
    let buf = '';
    for (const ch of String(text)) {
      if (/[\u1100-\u11ff\u2e80-\u9fff\u3000-\u303f\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch)) {
        if (buf) { toks.push(buf); buf = ''; }
        toks.push(ch);
      } else if (ch === ' ') {
        if (buf) { toks.push(buf); buf = ''; }
        toks.push(' ');
      } else {
        buf += ch;
      }
    }
    if (buf) toks.push(buf);

    const lines = [];
    let cur = '';
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk === ' ') { if (cur) cur += ' '; continue; }
      const test = cur + tk;
      if (cur && ctx.measureText(test.trim()).width > maxW) {
        lines.push(cur.trim());
        if (lines.length >= maxRows) return null;
        cur = tk;
      } else {
        cur = test;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines.length <= maxRows ? lines : null;
  }

  /**
   * 画二维码。label 传品名时会自动在顶部居中加标题（自动选字号、必要时折成两行）。
   * @returns {HTMLCanvasElement}
   */
  function qrCanvas(code, cell, margin, label) {
    const cellS = cell || 8;
    const mg = margin === undefined ? 3 : margin;
    const qr = qrcode(0, 'M');
    qr.addData(String(code));
    qr.make();
    const n = qr.getModuleCount();
    const qrSize = (n + mg * 2) * cellS;

    const title = String(label == null ? '' : label).trim();
    const probe = document.createElement('canvas').getContext('2d');
    let fontPx = 0, lines = null, lineH = 0;

    if (title) {
      const maxW = qrSize * 0.9;
      const base = Math.max(12, Math.round(Math.min(cellS * 3.2, qrSize * 0.16)));
      const min = Math.max(11, Math.round(base * 0.45));
      for (let f = base; f >= min; f--) {
        probe.font = QR_FONT.replace('%s', f);
        const ls = wrapTokens(probe, title, maxW, 2);
        if (ls) { fontPx = f; lines = ls; break; }
      }
      if (!lines) {                       // 超长品名：缩到最小后再截断成一行
        fontPx = min;
        probe.font = QR_FONT.replace('%s', fontPx);
        let s = title;
        while (s.length > 1 && probe.measureText(s + '…').width > maxW) s = s.slice(0, -1);
        lines = [s === title ? title : s + '…'];
      }
      lineH = Math.round(fontPx * 1.3);
    }

    const padTop = lines ? Math.round(fontPx * 0.55) : 0;
    const gap = lines ? Math.round(Math.max(6, qrSize * 0.03)) : 0;
    const headH = lines ? padTop + lineH * lines.length + gap : 0;

    const cv = document.createElement('canvas');
    cv.width = qrSize;
    cv.height = headH + qrSize;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);

    if (lines) {
      ctx.fillStyle = QR_INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = QR_FONT.replace('%s', fontPx);
      lines.forEach((ln, i) => ctx.fillText(ln, cv.width / 2, padTop + i * lineH));
    }

    ctx.fillStyle = QR_INK;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + mg) * cellS, headH + (r + mg) * cellS, cellS, cellS);
        }
      }
    }
    return cv;
  }

  /** 生成 PNG data URL（画布绘制，打印与保存都清晰） */
  function qrDataURL(code, cell, margin, label) {
    try { return qrCanvas(code, cell, margin, label).toDataURL('image/png'); }
    catch (e) { console.warn('QR 生成失败', e); return ''; }
  }

  function openQR(p, hint) {
    if (!p) return;
    state.qrProduct = p;
    $('#qrName').textContent = p.name;
    $('#qrHint').textContent = hint || t('pd_qrHint');
    $('#qrImg').src = qrDataURL(p.code, 10, 3, p.name);
    $('#qrPrice').textContent = Store.money(p.price) + ' / ' + unitText(p.unit);
    $('#qrCode').textContent = p.code;
    openSheet('qrSheet');
  }

  function printLabels(list) {
    if (!list || !list.length) { toast(t('noData')); return; }
    toast(t('lb_printing'));
    const area = $('#printArea');
    area.innerHTML = '<div class="label-sheet">' + list.map(p => `
      <div class="label">
        <img src="${qrDataURL(p.code, 12, 3, p.name)}" alt="${esc(p.name)}">
        <div class="l-price">${Store.money(p.price)} / ${esc(unitText(p.unit))}</div>
        <div class="l-code">${esc(p.code)}</div>
        <div class="l-brand">BearShop</div>
      </div>`).join('') + '</div>';
    const imgs = $$('#printArea img');
    let done = 0;
    const go = () => { if (++done >= imgs.length) setTimeout(doPrint, 220); };
    if (!imgs.length) { setTimeout(doPrint, 220); return; }
    imgs.forEach(im => { if (im.complete) go(); else { im.onload = go; im.onerror = go; } });
  }

  function saveQRImage(p) {
    const url = qrDataURL(p.code, 14, 4, p.name);
    const name = 'BearShop-' + String(p.name).replace(/[\\/:*?"<>|\s]+/g, '_') + '-' + p.code + '.png';
    if (!url) { toast(t('pd_pngFail')); return; }
    if (isApp) {
      const okN = nativeSaveImage(name, url);
      toast(okN ? t('pd_pngSaved') : t('pd_pngFail'), 2600);
      return;
    }
    const ok = download(name, dataURLtoBlob(url), 'image/png');
    toast(ok ? t('pd_pngSaved') : t('pd_pngFail'));
  }

  function dataURLtoBlob(dataURL) {
    const parts = String(dataURL).split(',');
    const mime = /:(.*?);/.exec(parts[0])[1];
    const bin = atob(parts[1]);
    const len = bin.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  /* ============================================================
     备份（BearShop.csv）
     ============================================================ */
  const BACKUP_FILE = 'BearShop.csv';

  /** 备份到本机：APK 写入「下载/BearShop」，浏览器走下载 */
  function backupLocal() {
    const csv = Store.exportCSV();
    const ok = isApp
      ? nativeSaveText(BACKUP_FILE, csv)
      : download(BACKUP_FILE, csv, 'text/csv;charset=utf-8');
    closeSheet('backupSheet');
    toast(ok ? t('se_backupLocalDone') : t('se_backupFail'), 3200);
  }

  /** 备份到邮箱：唤起系统邮件应用，收件人/主题/正文/附件全部预填 */
  function backupMail() {
    const to = String(Store.getMail() || '').trim();
    if (!to) {
      closeSheet('backupSheet');
      if (state.tab !== 'setting') switchTab('setting');
      renderSettings();
      toast(t('se_mailMissing'), 3400);
      setTimeout(() => {
        try {
          const el = $('#seMail');
          el.scrollIntoView({ block: 'center' });
          el.focus();
        } catch (e) {}
      }, 280);
      return;
    }

    const stats = Store.allStats();
    const subject = t('se_mailSubject', { shop: Store.getShop() });
    const body = t('se_mailBody', { shop: Store.getShop(), n: stats.products, m: stats.orders });
    const csv = Store.exportCSV();

    if (isApp && Native && typeof Native.shareBackup === 'function') {
      let ok = false;
      try { ok = !!Native.shareBackup(BACKUP_FILE, csv, to, subject, body); } catch (e) { ok = false; }
      if (ok) { closeSheet('backupSheet'); toast(t('se_mailOpened'), 3400); return; }
      toast(t('se_backupFail'), 3000);
      return;
    }

    // 浏览器里没法自动带附件：先把文件下载下来，再唤起本机邮件客户端
    download(BACKUP_FILE, csv, 'text/csv;charset=utf-8');
    try {
      location.href = 'mailto:' + encodeURIComponent(to) +
        '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    } catch (e) {}
    closeSheet('backupSheet');
    toast(t('se_mailWeb'), 3800);
  }

  /** 导入：自动识别 BearShop.csv（也兼容早期的 JSON 备份），导入后完整回灌界面 */
  function importBackupText(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    if (/^\s*[{[]/.test(clean)) Store.importJSON(clean);
    else Store.importCSV(clean);

    state.cart = [];
    applyLang();          // 内部会重绘清单 / 商品 / 记录 / 设置
    renderTabs();
  }

  /* ============================================================
     记录
     ============================================================ */
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const t0 = today.getTime();
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (dd === t0) return t('rc_today');
    if (dd === t0 - 86400000) return t('rc_yesterday');
    return d.toLocaleDateString(I18n.locale(), { month: 'short', day: 'numeric', weekday: 'short' });
  }

  function renderRecords() {
    const box = $('#rcList');
    if (!box) return;
    const sales = Store.listSales();
    const mon = Store.monthStats();
    const tdy = Store.todayStats();
    const all = Store.allStats();

    $('#rcStats').innerHTML = `
      <div class="stat"><b>${Store.money(tdy.revenue).replace('¥', '')}</b><span>${esc(t('rc_today'))} (¥)</span></div>
      <div class="stat"><b>${Store.money(mon.revenue).replace('¥', '')}</b><span>${esc(t('rc_month'))} (¥)</span></div>
      <div class="stat"><b>${all.orders}</b><span>${esc(t('rc_salesCount'))}</span></div>`;

    $('#rcCount').textContent = t('rc_revenue') + ' ¥' + all.revenue.toFixed(2) +
      ' · ' + t('rc_itemsSold') + ' ' + Store.num(all.units);

    if (!sales.length) {
      box.innerHTML = `<div class="card empty">
        <span class="empty-bear">${BEARS.wave(128)}</span>
        <h4>${esc(t('rc_empty'))}</h4>
        <p>${esc(t('rc_emptyHint'))}</p>
      </div>`;
      return;
    }

    const groups = [];
    const idx = {};
    sales.forEach(s => {
      const k = dayKey(s.at);
      if (idx[k] === undefined) { idx[k] = groups.length; groups.push({ key: k, at: s.at, items: [] }); }
      groups[idx[k]].items.push(s);
    });

    let n = sales.length;
    box.innerHTML = groups.map(g => `
      <div class="rc-group-title">${esc(dayLabel(g.at))}</div>
      ${g.items.map(s => `
        <div class="rc-item">
          <div class="rc-head" data-toggle="1">
            <div class="rc-head-l">
              <div class="rc-title">${esc(t('rc_order', { n: n-- }))}</div>
              <div class="rc-time">${esc(Store.fmtTime(s.at))} · ${s.items.length} ${esc(t('tab_product'))}</div>
            </div>
            <div class="rc-amt">${Store.money(s.total)}</div>
          </div>
          <div class="rc-body" hidden>
            ${s.items.map(it => `
              <div class="rc-line">
                <span>${esc(it.name)} · ${Store.money(it.price)} × ${Store.num(it.qty)}${esc(unitText(it.unit))}</span>
                <b>${Store.money(it.amount)}</b>
              </div>`).join('')}
            <button class="btn btn-danger btn-block rc-undo" type="button" data-undo="${esc(s.id)}">${esc(t('rc_undo'))}</button>
          </div>
        </div>`).join('')}
    `).join('');
  }

  /* ============================================================
     设置
     ============================================================ */
  function renderSettings() {
    const s = Store.allStats();
    $('#seShop').value = Store.getShop();
    $('#seMail').value = Store.getMail();
    $('#seStats').innerHTML = `
      <div class="stat"><b>${s.products}</b><span>${esc(t('se_statProducts'))}</span></div>
      <div class="stat"><b>${s.orders}</b><span>${esc(t('se_statRecords'))}</span></div>
      <div class="stat"><b>${s.revenue.toFixed(2)}</b><span>${esc(t('se_statRevenue'))}</span></div>`;
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bindEvents() {
    /* 语言切换（右上角键） */
    $('#langBtn').addEventListener('click', () => {
      setLang(I18n.lang === 'zh' ? 'en' : 'zh');
      toast(I18n.lang === 'en' ? 'Switched to English' : '已切换为中文');
    });
    $$('#langSeg button').forEach(b => b.addEventListener('click', () => setLang(b.getAttribute('data-lang'))));

    /* 导航 */
    $('#tabbar').addEventListener('click', e => {
      const b = e.target.closest('.tab');
      if (b) switchTab(b.getAttribute('data-tab'));
    });

    /* 销售 */
    $('#btnScanSell').addEventListener('click', () => openScan('sell'));
    $('#btnManualSell').addEventListener('click', () => openManual('sell'));
    $('#btnCheckout').addEventListener('click', openCheckout);
    $('#btnClearCart').addEventListener('click', () => {
      confirmBox(t('sell_clearCart'), t('sell_clearCartConfirm'), () => {
        state.cart = []; renderCart();
      }, t('clear'));
    });
    $('#cartList').addEventListener('click', e => {
      const b = e.target.closest('[data-del]');
      if (b) removeCartItem(parseInt(b.getAttribute('data-del'), 10));
    });

    /* 数量面板 */
    $('#qtyInput').addEventListener('input', updateQtyAmount);
    $('#qtyQuick').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const v = parseFloat(b.textContent);
      const cur = parseFloat($('#qtyInput').value) || 0;
      $('#qtyInput').value = Store.num(cur + v);
      updateQtyAmount();
    });
    $$('#qtySheet .step').forEach(b => b.addEventListener('click', () => {
      const step = parseFloat(b.getAttribute('data-step'));
      const fine = state.pending && state.pending.unit === 'jin';
      const cur = parseFloat($('#qtyInput').value) || 0;
      let v = cur + (fine ? step * 0.5 : step);
      if (v < 0) v = 0;
      $('#qtyInput').value = Store.num(v);
      updateQtyAmount();
    }));
    $('#qtyAdd').addEventListener('click', addToCart);
    $('#qtyCancel').addEventListener('click', () => { state.pending = null; closeSheet('qtySheet'); });
    $('#qtyNext').addEventListener('click', () => { state.pending = null; closeSheet('qtySheet'); setTimeout(() => openScan('sell'), 200); });

    /* 结算 */
    $('#coPay').addEventListener('click', payNow);
    $('#coCancel').addEventListener('click', () => closeSheet('coSheet'));
    $('#okAgain').addEventListener('click', () => { closeSheet('okOverlay'); setTimeout(() => openScan('sell'), 180); });
    $('#okBack').addEventListener('click', () => closeOkOverlay());

    /* 入库 */
    $('#btnNameStock').addEventListener('click', openNameSheet);
    $('#btnScanStock').addEventListener('click', () => openScan('stock'));
    $('#btnManualStock').addEventListener('click', () => openManual('stock'));

    /* 入库 · 输入品名 */
    $('#nmName').addEventListener('input', renderNmSug);
    $('#nmName').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const target = state.nmProduct ? $('#nmQty') : $('#nmPriceIn');
      try { target.focus(); } catch (err) {}
    });
    $('#nmSug').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) pickNmProduct(b.getAttribute('data-pick'));
    });
    $('#nmUnitSeg').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) setNmUnit(b.getAttribute('data-unit'));
    });
    $('#nmQuick').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const v = parseFloat(b.getAttribute('data-nq'));
      const cur = parseFloat($('#nmQty').value) || 0;
      $('#nmQty').value = Store.num(cur + v);
    });
    $$('#nameSheet .step').forEach(b => b.addEventListener('click', () => {
      const step = parseFloat(b.getAttribute('data-step'));
      const fine = nmUnit() === 'jin';
      const cur = parseFloat($('#nmQty').value) || 0;
      let v = cur + (fine ? step * 0.5 : step);
      if (v < 0) v = 0;
      $('#nmQty').value = Store.num(v);
    }));
    $('#nmQty').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveNameStock(); }
    });
    $('#nmSave').addEventListener('click', saveNameStock);
    $('#nmCancel').addEventListener('click', () => closeSheet('nameSheet'));

    $('#unitSeg').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) setUnitSeg(b.getAttribute('data-unit'));
    });
    $('#btnStockSave').addEventListener('click', saveStock);
    $('#btnStockCancel').addEventListener('click', () => {
      $('#stockFormCard').hidden = true;
      state.pendingCode = null;
      renderProducts();
    });
    $('#btnStockEdit').addEventListener('click', () => {
      state.editFields = !state.editFields;
      $('#stockNewFields').hidden = !state.editFields;
      $('#btnStockEdit').textContent = state.editFields ? t('cancel') : t('st_editInfo');
    });

    /* 商品 */
    $('#pdSearch').addEventListener('input', renderProducts);
    $('#btnAddProduct').addEventListener('click', openNameSheet);
    $('#btnPrintAll').addEventListener('click', () => {
      const list = Store.listProducts();
      if (!list.length) { toast(t('noData')); return; }
      notice({
        bear: BEARS.face(72),
        title: t('lb_title'),
        text: t('lb_hint') + ' (' + list.length + ')',
        cancel: t('cancel'),
        ok: t('lb_printAll'),
        onOk: () => printLabels(list)
      });
    });
    $('#pdList').addEventListener('click', e => {
      const it = e.target.closest('.pd-item');
      if (!it) return;
      const p = Store.getProduct(it.getAttribute('data-code'));
      if (p) openQR(p);
    });

    /* 二维码面板 */
    $('#qrSave').addEventListener('click', () => state.qrProduct && saveQRImage(state.qrProduct));
    $('#qrPrint').addEventListener('click', () => state.qrProduct && printLabels([state.qrProduct]));
    $('#qrClose').addEventListener('click', () => closeSheet('qrSheet'));
    $('#qrMore').addEventListener('click', () => {
      closeSheet('qrSheet');
      setTimeout(openNameSheet, 160);
    });
    $('#qrEdit').addEventListener('click', () => {
      const p = state.qrProduct;
      if (!p) return;
      closeSheet('qrSheet');
      openStockForm(p.code);
    });
    $('#qrDel').addEventListener('click', () => {
      const p = state.qrProduct;
      if (!p) return;
      confirmBox(t('delete'), t('pd_delConfirm', { name: p.name }), () => {
        Store.removeProduct(p.code);
        closeSheet('qrSheet');
        renderProducts();
        toast(t('pd_deleted', { name: p.name }));
      }, t('delete'));
    });

    /* 记录：展开 / 撤销 */
    $('#rcList').addEventListener('click', e => {
      const undo = e.target.closest('[data-undo]');
      if (undo) {
        const id = undo.getAttribute('data-undo');
        confirmBox(t('rc_undo'), t('rc_undoConfirm'), () => {
          Store.removeSale(id, true);
          renderRecords(); renderProducts();
          toast(t('rc_undone'));
        }, t('undo'));
        return;
      }
      const head = e.target.closest('.rc-head');
      if (head) {
        const body = head.parentElement.querySelector('.rc-body');
        if (body) body.hidden = !body.hidden;
      }
    });

    /* 设置 */
    $('#seShop').addEventListener('change', () => {
      Store.setShop($('#seShop').value);
      $('#brandName').textContent = Store.getShop();
      $('#seShop').value = Store.getShop();
    });
    $('#seMail').addEventListener('change', () => {
      Store.setMail($('#seMail').value);
      $('#seMail').value = Store.getMail();
    });

    /* 备份 / 导入 */
    $('#btnBackup').addEventListener('click', () => openSheet('backupSheet'));
    $('#bkLocal').addEventListener('click', backupLocal);
    $('#bkMail').addEventListener('click', backupMail);
    $('#bkCancel').addEventListener('click', () => closeSheet('backupSheet'));

    $('#btnImport').addEventListener('click', () => $('#fileImport').click());
    $('#fileImport').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          importBackupText(String(r.result || ''));
          toast(t('se_imported'), 2600);
        } catch (err) { toast(t('se_importFail'), 2800); }
      };
      r.readAsText(f, 'UTF-8');
      e.target.value = '';
    });

    /* 手动输入编号 */
    $('#codeOk').addEventListener('click', () => {
      const v = Store.normCode($('#codeInput').value);
      if (!v) return;
      closeSheet('codeSheet');
      handleCode(v);
    });
    $('#codeCancel').addEventListener('click', () => closeSheet('codeSheet'));
    $('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#codeOk').click(); });

    /* 扫码面板 */
    $('#scanClose').addEventListener('click', closeScan);
    $('#scanErrClose').addEventListener('click', () => closeSheet('scanSheet'));
    $('#scanRetry').addEventListener('click', () => { openScan(state.scanMode); });
    $('#scanErrSettings').addEventListener('click', () => {
      if (isApp) { try { Native.openAppSettings(); return; } catch (e) {} }
      toast(t('sc_blockedHint'));
    });
    $('#scanManual').addEventListener('click', () => {
      closeScan().then(() => openManual(state.scanMode));
    });
    $('#scanTorch').addEventListener('click', async () => {
      const tb = $('#scanTorch');
      const on = tb.dataset.on !== '1';
      const ok = BS && await BS.setTorch(on);
      if (!ok) { toast(t('sc_denied')); return; }
      tb.dataset.on = on ? '1' : '0';
      tb.textContent = on ? t('sc_torchOn') : t('sc_torchOff');
    });

    /* 长按扫码标题 0.7 秒：展开/收起引擎诊断行（排查问题时截图用） */
    (function () {
      const title = $('#scanTitle');
      let timer = null;
      const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
      title.addEventListener('contextmenu', e => e.preventDefault());
      title.addEventListener('pointerdown', () => {
        stop();
        timer = setTimeout(function () {
          timer = null;
          scanDiag = !scanDiag;
          setScanMeta(metaLine(state.lastMeta || {}));
          toast(scanDiag ? t('sc_diagOn') : t('sc_diagOff'));
        }, 700);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
        title.addEventListener(ev, stop));
    })();

    /* 遮罩关闭 */
    document.addEventListener('click', e => {
      const c = e.target.closest('[data-close]');
      if (c) {
        const id = c.getAttribute('data-close');
        if (id === 'scanSheet') closeScan(); else closeSheet(id);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!$('#scanSheet').hidden) closeScan();
        else ['qtySheet', 'coSheet', 'qrSheet', 'nameSheet', 'backupSheet', 'codeSheet', 'noticeSheet'].forEach(id => closeSheet(id));
      }
    });
  }

  /* ============================================================
     离线缓存
     ============================================================ */
  function registerSW() {
    if (isShellOrigin) return;                                   // APK 内外壳自带离线资源
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    try {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    } catch (e) {}
  }

  /* ============================================================
     安卓返回键（由 APK 外壳调用；返回 true 表示已消费）
     ============================================================ */
  function handleBack() {
    if (!$('#okOverlay').hidden) { closeOkOverlay(); return true; }
    if (!$('#scanSheet').hidden) { closeScan(); return true; }
    const sheets = ['qtySheet', 'coSheet', 'qrSheet', 'nameSheet', 'backupSheet', 'codeSheet', 'noticeSheet'];
    for (let i = sheets.length - 1; i >= 0; i--) {
      const el = $('#' + sheets[i]);
      if (el && !el.hidden) { closeSheet(sheets[i]); return true; }
    }
    if (state.tab !== 'sell') { switchTab('sell'); return true; }
    return false;
  }
  window.BearShopBack = handleBack;

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    I18n.init();
    Store.load();
    buildNoticeSheet();
    renderBears();
    renderTabs();
    bindEvents();
    applyLang();
    switchTab('sell');
    renderCart();
    registerSW();
    bindScanRefit();
  }

  /* 旋屏 / 改窗口后重算取景框（见上面的 bindScanRefit） */

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
