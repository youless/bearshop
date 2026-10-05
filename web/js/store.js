/* ============================================================
   BearShop · 本地数据层（localStorage，零服务器、离线可用）
   ============================================================ */
const Store = (function () {
  const KEY = 'bearshop.data.v1';
  const VERSION = '1.0.0';

  const blank = () => ({
    version: VERSION,
    shop: 'BearShop',
    mail: '',       // 备份收件邮箱（用户设置项）
    seq: 0,
    products: {},   // code -> { code, name, price, unit:'pc'|'jin', stock, createdAt, updatedAt }
    sales: []       // [{ id, at, items:[{code,name,price,unit,qty,amount}], total }]
  });

  let data = blank();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = Object.assign(blank(), parsed);
        if (!data.products || typeof data.products !== 'object') data.products = {};
        if (!Array.isArray(data.sales)) data.sales = [];
      }
    } catch (e) {
      console.warn('BearShop: 读取本地数据失败', e);
      data = blank();
    }
    return data;
  }

  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(flush, 120);
  }
  function flush() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.warn('BearShop: 保存失败', e); }
  }

  /* ---------------- 商品 ---------------- */
  function nextCode() {
    data.seq = (data.seq || 0) + 1;
    save();
    return 'BS' + String(1000 + data.seq).slice(-4);
  }

  function getProduct(code) {
    if (!code) return null;
    return data.products[normCode(code)] || null;
  }

  function normCode(code) {
    return String(code || '').trim().replace(/^bearshop:/i, '').trim();
  }

  function upsertProduct(p) {
    const code = normCode(p.code);
    const prev = data.products[code];
    const now = Date.now();
    data.products[code] = {
      code,
      name: String(p.name || '').trim(),
      price: Number(p.price) || 0,
      unit: p.unit === 'jin' ? 'jin' : 'pc',
      stock: Number(p.stock) || 0,
      createdAt: prev ? prev.createdAt : now,
      updatedAt: now
    };
    save();
    return data.products[code];
  }

  function removeProduct(code) {
    const c = normCode(code);
    if (data.products[c]) { delete data.products[c]; save(); return true; }
    return false;
  }

  function addStock(code, qty) {
    const p = data.products[normCode(code)];
    if (!p) return null;
    p.stock = round3((Number(p.stock) || 0) + (Number(qty) || 0));
    p.updatedAt = Date.now();
    save();
    return p;
  }

  function listProducts() {
    return Object.keys(data.products)
      .map(k => data.products[k])
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  /* ---------------- 销售 ---------------- */
  function addSale(sale) {
    const rec = {
      id: 'S' + Date.now() + Math.floor(Math.random() * 900 + 100),
      at: Date.now(),
      items: sale.items.map(it => ({
        code: it.code, name: it.name, price: Number(it.price) || 0,
        unit: it.unit, qty: Number(it.qty) || 0,
        amount: round2((Number(it.price) || 0) * (Number(it.qty) || 0))
      })),
      total: round2(sale.total)
    };
    data.sales.unshift(rec);
    // 扣库存
    rec.items.forEach(it => {
      const p = data.products[normCode(it.code)];
      if (p) p.stock = round3((Number(p.stock) || 0) - (Number(it.qty) || 0));
    });
    save();
    return rec;
  }

  function removeSale(id, restoreStock) {
    const i = data.sales.findIndex(s => s.id === id);
    if (i < 0) return false;
    const rec = data.sales[i];
    if (restoreStock) {
      rec.items.forEach(it => {
        const p = data.products[normCode(it.code)];
        if (p) p.stock = round3((Number(p.stock) || 0) + (Number(it.qty) || 0));
      });
    }
    data.sales.splice(i, 1);
    save();
    return true;
  }

  function listSales() { return data.sales.slice(); }

  function monthStats() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    let revenue = 0, orders = 0, units = 0;
    data.sales.forEach(s => {
      const d = new Date(s.at);
      if (d.getFullYear() === y && d.getMonth() === m) {
        revenue += s.total;
        orders += 1;
        s.items.forEach(it => { units += it.qty; });
      }
    });
    return { revenue: round2(revenue), orders, units: round3(units) };
  }

  function todayStats() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    let revenue = 0, orders = 0, units = 0;
    data.sales.forEach(s => {
      if (s.at >= start.getTime()) {
        revenue += s.total; orders += 1;
        s.items.forEach(it => { units += it.qty; });
      }
    });
    return { revenue: round2(revenue), orders, units: round3(units) };
  }

  function allStats() {
    let revenue = 0, units = 0;
    data.sales.forEach(s => {
      revenue += s.total;
      s.items.forEach(it => { units += it.qty; });
    });
    return {
      revenue: round2(revenue), orders: data.sales.length,
      units: round3(units), products: Object.keys(data.products).length
    };
  }

  /* ---------------- 设置 / 备份 ---------------- */
  function getShop() { return data.shop || 'BearShop'; }
  function setShop(v) { data.shop = String(v || '').trim() || 'BearShop'; save(); }

  function getMail() { return data.mail || ''; }
  function setMail(v) { data.mail = String(v || '').trim(); save(); }

  function exportJSON() {
    flush();
    return JSON.stringify(Object.assign({}, data, { exportedAt: new Date().toISOString(), app: 'BearShop' }), null, 2);
  }

  function importJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || (!obj.products && !obj.sales)) throw new Error('bad');
    data = Object.assign(blank(), obj);
    if (!data.products) data.products = {};
    if (!Array.isArray(data.sales)) data.sales = [];
    flush();
    return true;
  }

  /* ---------------- CSV 备份（BearShop.csv） ----------------
     一张固定列的表格，靠 type 列区分三类行：
       product → 商品档案
       sale    → 一笔销售单（金额在 total 列）
       item    → 该单里的一个商品明细
     文件开头用 # 开头的注释行携带元信息（版本 / 店铺 / 邮箱 / 编号序号 / 导出时间），
     这类行是标准 CSV 里常见的注释写法，用 Excel 打开也只是多几行说明，不影响阅读。
     UTF-8 + BOM，Excel 直接双击打开中文不乱码。
     ────────────────────────────────────────────────────────── */
  const CSV_COLS = ['type', 'id', 'code', 'name', 'price', 'unit', 'qty',
    'stock', 'at', 'createdAt', 'updatedAt', 'total'];

  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvLine(arr) { return arr.map(csvCell).join(','); }

  function exportCSV() {
    flush();
    const rows = [];
    rows.push('#BearShop backup');
    rows.push('#version,' + VERSION);
    rows.push('#shop,' + csvCell(data.shop || 'BearShop'));
    rows.push('#mail,' + csvCell(data.mail || ''));
    rows.push('#seq,' + (data.seq || 0));
    rows.push('#exportedAt,' + new Date().toISOString());
    rows.push(csvLine(CSV_COLS));

    // 商品：按编号升序，便于人工查看
    Object.keys(data.products)
      .map(k => data.products[k])
      .sort((a, b) => String(a.code).localeCompare(String(b.code), 'en'))
      .forEach(p => rows.push(csvLine([
        'product', '', p.code, p.name, round2(p.price).toFixed(2), p.unit === 'jin' ? 'jin' : 'pc',
        '', num(p.stock), '', p.createdAt || '', p.updatedAt || '', ''
      ])));

    // 销售：按时间升序输出（内部存储是最新在前，导入时再翻回去）
    data.sales.slice().sort((a, b) => (a.at || 0) - (b.at || 0)).forEach(s => {
      rows.push(csvLine([
        'sale', s.id, '', '', '', '', '', '', s.at || '', '', '',
        round2(s.total).toFixed(2)
      ]));
      (s.items || []).forEach(it => rows.push(csvLine([
        'item', s.id, it.code, it.name, round2(it.price).toFixed(2),
        it.unit === 'jin' ? 'jin' : 'pc', num(it.qty), '', '', '', '',
        round2(it.amount).toFixed(2)
      ])));
    });

    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }

  /** RFC4180 解析：支持引号包裹、引号转义("")、单元格内换行 */
  function parseCSV(text) {
    let s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);      // 去掉 BOM
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(cell); cell = '';
      } else if (ch === '\n') {
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else if (ch !== '\r') {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function importCSV(text) {
    const rows = parseCSV(text);
    const meta = {};
    let head = null, from = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const first = String(r[0] || '').trim();
      if (first.charAt(0) === '#') {                       // 元信息注释行
        const key = first.slice(1).trim().toLowerCase();
        if (r.length > 1 && key !== 'bearshop backup') meta[key] = String(r[1] || '');
        continue;
      }
      if (first.toLowerCase() === 'type') {                // 表头
        head = r.map(x => String(x || '').trim().toLowerCase());
        from = i + 1;
        break;
      }
      // 容错：没有注释行、也没表头就直接结束了
      break;
    }
    if (!head) throw new Error('no header');

    const col = {};
    head.forEach((h, i) => { col[h] = i; });
    const get = (r, k) => {
      const i = col[k];
      return i === undefined ? '' : String(r[i] === undefined || r[i] === null ? '' : r[i]).trim();
    };

    const products = {};
    const saleMap = {};
    const order = [];
    let maxSeq = 0;

    for (let i = from; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const type = get(r, 'type').toLowerCase();
      if (!type) continue;

      if (type === 'product') {
        const code = normCode(get(r, 'code'));
        if (!code) continue;
        const createdAt = Number(get(r, 'createdat')) || Date.now();
        products[code] = {
          code,
          name: get(r, 'name'),
          price: round2(Number(get(r, 'price')) || 0),
          unit: get(r, 'unit') === 'jin' ? 'jin' : 'pc',
          stock: round3(Number(get(r, 'stock')) || 0),
          createdAt,
          updatedAt: Number(get(r, 'updatedat')) || createdAt
        };
        const m = /^BS(\d+)$/i.exec(code);                 // 记住最大编号，导入后继续发号不会撞车
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10) - 1000);
      } else if (type === 'sale') {
        const id = get(r, 'id');
        if (!id) continue;
        if (!saleMap[id]) {
          saleMap[id] = { id, at: Number(get(r, 'at')) || Date.now(), items: [], total: 0 };
          order.push(id);
        }
        saleMap[id].total = round2(Number(get(r, 'total')) || 0);
      } else if (type === 'item') {
        const id = get(r, 'id');
        if (!id) continue;
        if (!saleMap[id]) {
          saleMap[id] = { id, at: Number(get(r, 'at')) || Date.now(), items: [], total: 0 };
          order.push(id);
        }
        saleMap[id].items.push({
          code: normCode(get(r, 'code')),
          name: get(r, 'name'),
          price: round2(Number(get(r, 'price')) || 0),
          unit: get(r, 'unit') === 'jin' ? 'jin' : 'pc',
          qty: round3(Number(get(r, 'qty')) || 0),
          amount: round2(Number(get(r, 'total')) || 0)
        });
      }
    }

    if (!Object.keys(products).length && !order.length) throw new Error('empty');

    const sales = order.map(id => saleMap[id]);
    sales.forEach(s => {
      if (!s.total) s.total = round2(s.items.reduce((a, it) => a + (it.amount || 0), 0));
      if (!s.at) s.at = Date.now();
    });
    sales.sort((a, b) => (b.at || 0) - (a.at || 0));       // 内部存储：最新在前

    data = Object.assign(blank(), {
      version: meta.version || VERSION,
      shop: (meta.shop || '').trim() || data.shop || 'BearShop',
      mail: (meta.mail || '').trim() || data.mail || '',
      seq: Number(meta.seq) || maxSeq,
      products,
      sales
    });
    flush();
    return true;
  }

  function clearAll() { data = blank(); flush(); }

  /* ---------------- 数字工具 ---------------- */
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
  function money(n) { return '¥' + (round2(n)).toFixed(2); }
  function num(n) {
    const v = round3(n);
    return Number.isInteger(v) ? String(v) : String(v).replace(/0+$/, '').replace(/\.$/, '');
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleString(I18n.locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString(I18n.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  return {
    load, save, flush, blank,
    nextCode, normCode, getProduct, upsertProduct, removeProduct, addStock, listProducts,
    addSale, removeSale, listSales, monthStats, todayStats, allStats,
    getShop, setShop, getMail, setMail,
    exportJSON, importJSON, exportCSV, importCSV, clearAll,
    money, num, round2, round3, fmtDate, fmtTime,
    get raw() { return data; }
  };
})();
