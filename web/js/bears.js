/* ============================================================
   BearShop · 北极熊吉祥物（全部为手绘矢量图形，可任意缩放、离线可用）
   ============================================================ */
const BEARS = (function () {
  const C = {
    fur: '#FFFFFF',
    shade: '#EFF7FD',
    line: '#C9E0F2',
    dark: '#2E4257',
    blush: '#FFD3DC',
    scarf: '#4FA3E3',
    scarfD: '#3B8BCB',
    ice: '#D9ECFA',
    iceD: '#2F86D6'
  };

  /* ---------- 头部（参数化，可复用） ---------- */
  function head(cx, cy, s, eyes) {
    const st = 6 * s;
    const eyeType = eyes || 'open';
    let eyesG = '';
    if (eyeType === 'open' || eyeType === 'wink') {
      const leftOpen =
        `<ellipse cx="${cx - 28 * s}" cy="${cy - 10 * s}" rx="${9 * s}" ry="${11 * s}" fill="${C.dark}"/>` +
        `<circle cx="${cx - 25.4 * s}" cy="${cy - 14 * s}" r="${3.4 * s}" fill="#fff"/>`;
      const left = eyeType === 'wink'
        ? `<path d="M${cx - 38 * s} ${cy - 6 * s} q${10 * s} ${-13 * s} ${20 * s} 0" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round" fill="none"/>`
        : leftOpen;
      eyesG = left +
        `<ellipse cx="${cx + 28 * s}" cy="${cy - 10 * s}" rx="${9 * s}" ry="${11 * s}" fill="${C.dark}"/>` +
        `<circle cx="${cx + 30.6 * s}" cy="${cy - 14 * s}" r="${3.4 * s}" fill="#fff"/>`;
    } else if (eyeType === 'happy') {
      eyesG =
        `<path d="M${cx - 38 * s} ${cy - 6 * s} q${10 * s} ${-14 * s} ${20 * s} 0" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round" fill="none"/>` +
        `<path d="M${cx + 18 * s} ${cy - 6 * s} q${10 * s} ${-14 * s} ${20 * s} 0" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round" fill="none"/>`;
    } else if (eyeType === 'sleepy') {
      eyesG =
        `<path d="M${cx - 38 * s} ${cy - 8 * s} h${20 * s}" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round"/>` +
        `<path d="M${cx + 18 * s} ${cy - 8 * s} h${20 * s}" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round"/>`;
    }

    const mouth = eyeType === 'happy'
      ? `<path d="M${cx - 13 * s} ${cy + 26 * s} q${13 * s} ${16 * s} ${26 * s} 0 z" fill="${C.dark}"/>`
      : `<path d="M${cx} ${cy + 25 * s} v${6 * s}" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round" fill="none"/>` +
        `<path d="M${cx} ${cy + 31 * s} q${-9 * s} ${9 * s} ${-18 * s} ${1 * s}" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round" fill="none"/>` +
        `<path d="M${cx} ${cy + 31 * s} q${9 * s} ${9 * s} ${18 * s} ${1 * s}" stroke="${C.dark}" stroke-width="${5 * s}" stroke-linecap="round" fill="none"/>`;

    return `
    <g class="bear-head">
      <circle cx="${cx - 52 * s}" cy="${cy - 60 * s}" r="${30 * s}" fill="${C.fur}" stroke="${C.line}" stroke-width="${st}"/>
      <circle cx="${cx + 52 * s}" cy="${cy - 60 * s}" r="${30 * s}" fill="${C.fur}" stroke="${C.line}" stroke-width="${st}"/>
      <circle cx="${cx - 52 * s}" cy="${cy - 60 * s}" r="${13 * s}" fill="${C.shade}"/>
      <circle cx="${cx + 52 * s}" cy="${cy - 60 * s}" r="${13 * s}" fill="${C.shade}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${76 * s}" ry="${70 * s}" fill="${C.fur}" stroke="${C.line}" stroke-width="${st}"/>
      <ellipse cx="${cx}" cy="${cy + 28 * s}" rx="${40 * s}" ry="${30 * s}" fill="${C.shade}"/>
      <ellipse cx="${cx - 60 * s}" cy="${cy + 16 * s}" rx="${11 * s}" ry="${7.5 * s}" fill="${C.blush}" opacity=".9"/>
      <ellipse cx="${cx + 60 * s}" cy="${cy + 16 * s}" rx="${11 * s}" ry="${7.5 * s}" fill="${C.blush}" opacity=".9"/>
      ${eyesG}
      <ellipse cx="${cx}" cy="${cy + 16 * s}" rx="${13 * s}" ry="${9.5 * s}" fill="${C.dark}"/>
      ${mouth}
    </g>`;
  }

  /* ---------- 胶囊状四肢（外描边 + 内填充） ---------- */
  function limb(x1, y1, x2, y2, w) {
    return (
      `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${C.line}" stroke-width="${w + 6}" stroke-linecap="round" fill="none"/>` +
      `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${C.fur}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`
    );
  }

  /* ---------- 身体 + 腿 ---------- */
  function torso(cx, cy, s) {
    return `
      <ellipse cx="${cx - 32 * s}" cy="${cy + 52 * s}" rx="${25 * s}" ry="${17 * s}" fill="${C.fur}" stroke="${C.line}" stroke-width="${5 * s}"/>
      <ellipse cx="${cx + 32 * s}" cy="${cy + 52 * s}" rx="${25 * s}" ry="${17 * s}" fill="${C.fur}" stroke="${C.line}" stroke-width="${5 * s}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${54 * s}" ry="${55 * s}" fill="${C.fur}" stroke="${C.line}" stroke-width="${6 * s}"/>
      <ellipse cx="${cx}" cy="${cy + 20 * s}" rx="${30 * s}" ry="${26 * s}" fill="${C.shade}"/>`;
  }

  function scarf(cx, cy, s) {
    return `
      <path d="M${cx - 42 * s} ${cy} q${42 * s} ${16 * s} ${84 * s} 0 l0 ${15 * s} q${-42 * s} ${12 * s} ${-84 * s} 0 z" fill="${C.scarf}" stroke="${C.scarfD}" stroke-width="${3 * s}" stroke-linejoin="round"/>
      <path d="M${cx + 22 * s} ${cy + 10 * s} l${14 * s} ${30 * s} l${-13 * s} ${5 * s} l${-13 * s} ${-30 * s} z" fill="${C.scarfD}"/>`;
  }

  function heart(cx, cy, s, fill) {
    return `<path d="M${cx} ${cy + 10 * s} c${-16 * s} ${-11 * s} ${-16 * s} ${-26 * s} ${-5 * s} ${-26 * s} c${5 * s} 0 ${5 * s} ${4 * s} ${5 * s} ${4 * s} c0 0 0 ${-4 * s} ${5 * s} ${-4 * s} c${11 * s} 0 ${11 * s} ${15 * s} ${-5 * s} ${26 * s} z" fill="${fill || '#FF8FA6'}"/>`;
  }

  /* ============ 1. 头像 Logo ============ */
  function face(size) {
    size = size || 96;
    return wrap(size, '0 0 200 200', head(100, 112, 0.86, 'open'));
  }

  /* ============ 2. 招手北极熊（空状态 / 欢迎） ============ */
  function wave(size) {
    size = size || 160;
    return wrap(size, '0 0 220 250', `
      ${limb(72, 150, 36, 104, 26)}
      ${limb(148, 152, 176, 186, 26)}
      ${torso(110, 156, 1)}
      ${head(110, 84, 0.72, 'happy')}
      ${scarf(110, 116, 0.72)}
      <circle cx="34" cy="84" r="5" fill="${C.iceD}" opacity=".55"/>
      <circle cx="188" cy="70" r="7" fill="${C.iceD}" opacity=".35"/>
      <circle cx="176" cy="128" r="4" fill="${C.iceD}" opacity=".5"/>
    `);
  }

  /* ============ 3. 举着二维码卡片的北极熊（扫码中） ============ */
  function scan(size) {
    size = size || 160;
    return wrap(size, '0 0 220 230', `
      <ellipse cx="110" cy="150" rx="66" ry="50" fill="${C.fur}" stroke="${C.line}" stroke-width="6"/>
      ${head(110, 62, 0.62, 'open')}
      <rect x="46" y="92" width="128" height="126" rx="18" fill="#fff" stroke="${C.line}" stroke-width="6"/>
      <rect x="58" y="104" width="104" height="102" rx="10" fill="${C.shade}"/>
      <g fill="${C.dark}">
        <rect x="68" y="114" width="24" height="24" rx="4"/>
        <rect x="75" y="121" width="10" height="10" rx="2" fill="#fff"/>
        <rect x="128" y="114" width="24" height="24" rx="4"/>
        <rect x="135" y="121" width="10" height="10" rx="2" fill="#fff"/>
        <rect x="68" y="160" width="24" height="24" rx="4"/>
        <rect x="75" y="167" width="10" height="10" rx="2" fill="#fff"/>
        <rect x="104" y="118" width="10" height="10" rx="2"/>
        <rect x="104" y="138" width="10" height="10" rx="2"/>
        <rect x="122" y="150" width="10" height="10" rx="2"/>
        <rect x="140" y="150" width="10" height="10" rx="2"/>
        <rect x="104" y="168" width="10" height="10" rx="2"/>
        <rect x="126" y="172" width="10" height="10" rx="2"/>
        <rect x="146" y="174" width="10" height="10" rx="2"/>
        <rect x="112" y="150" width="10" height="10" rx="2"/>
      </g>
      <rect x="44" y="82" width="24" height="18" rx="9" fill="${C.fur}" stroke="${C.line}" stroke-width="5"/>
      <rect x="152" y="82" width="24" height="18" rx="9" fill="${C.fur}" stroke="${C.line}" stroke-width="5"/>
      <path d="M18 130 q10 14 0 28 q-10 -14 0 -28 z" fill="${C.iceD}" opacity=".5"/>
      <path d="M204 112 q9 12 0 24 q-9 -12 0 -24 z" fill="${C.iceD}" opacity=".35"/>
    `);
  }

  /* ============ 4. 开心北极熊（收款成功） ============ */
  function happy(size) {
    size = size || 160;
    return wrap(size, '0 0 220 250', `
      ${limb(76, 152, 34, 100, 26)}
      ${limb(144, 152, 186, 100, 26)}
      ${torso(110, 156, 1)}
      ${head(110, 84, 0.72, 'happy')}
      <path d="M66 132 q44 18 88 0 l0 15 q-44 14 -88 0 z" fill="${C.scarf}" stroke="${C.scarfD}" stroke-width="3"/>
      ${heart(30, 74, 1, '#FF8FA6')}
      ${heart(190, 62, 0.8, '#FFB3C4')}
      <circle cx="150" cy="34" r="4" fill="${C.iceD}" opacity=".5"/>
      <circle cx="52" cy="30" r="6" fill="${C.iceD}" opacity=".3"/>
    `);
  }

  /* ============ 5. 找不到商品的北极熊（放大镜） ============ */
  function search(size) {
    size = size || 150;
    return wrap(size, '0 0 240 240', `
      ${head(100, 100, 0.78, 'sleepy')}
      <circle cx="176" cy="176" r="40" fill="#fff" fill-opacity=".85" stroke="${C.iceD}" stroke-width="9"/>
      <path d="M204 204 L230 230" stroke="${C.iceD}" stroke-width="16" stroke-linecap="round"/>
      <text x="176" y="192" text-anchor="middle" font-size="46" font-weight="800" fill="${C.iceD}" font-family="system-ui, sans-serif">?</text>
    `);
  }

  /* ============ 6. 空篮子北极熊（清单为空） ============ */
  function basket(size) {
    size = size || 160;
    return wrap(size, '0 0 220 230', `
      <ellipse cx="110" cy="150" rx="66" ry="50" fill="${C.fur}" stroke="${C.line}" stroke-width="6"/>
      ${head(110, 62, 0.62, 'open')}
      <path d="M46 96 q64 -46 128 0" fill="none" stroke="${C.line}" stroke-width="7" stroke-linecap="round"/>
      <path d="M40 98 L180 98 L162 186 q-2 14 -16 14 L74 200 q-14 0 -16 -14 z" fill="#fff" stroke="${C.line}" stroke-width="6" stroke-linejoin="round"/>
      <path d="M58 120 L162 120 M64 144 L158 144 M70 168 L154 168" stroke="${C.ice}" stroke-width="8" stroke-linecap="round"/>
      <rect x="44" y="86" width="24" height="18" rx="9" fill="${C.fur}" stroke="${C.line}" stroke-width="5"/>
      <rect x="152" y="86" width="24" height="18" rx="9" fill="${C.fur}" stroke="${C.line}" stroke-width="5"/>
    `);
  }

  /* ============ 7. 爪子印（装饰） ============ */
  function paw(size, color) {
    size = size || 40;
    return wrap(size, '0 0 100 100', `
      <ellipse cx="50" cy="64" rx="26" ry="22" fill="${color || C.ice}"/>
      <ellipse cx="24" cy="36" rx="11" ry="14" fill="${color || C.ice}"/>
      <ellipse cx="43" cy="26" rx="11" ry="14" fill="${color || C.ice}"/>
      <ellipse cx="62" cy="26" rx="11" ry="14" fill="${color || C.ice}"/>
      <ellipse cx="80" cy="36" rx="11" ry="14" fill="${color || C.ice}"/>
    `);
  }

  /* ============ 8. 商标（圆角方形容器 + 熊头） ============ */
  function mark(size) {
    size = size || 40;
    const id = 'bg' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#EAF5FE"/><stop offset="1" stop-color="#C7E4FA"/>
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill="url(#${id})"/>
      <g transform="translate(60,64) scale(0.44) translate(-100,-112)">${head(100, 112, 0.86, 'open')}</g>
    </svg>`;
  }

  /* ============ 9. 底部导航线性图标 ============ */
  function icon(name, size) {
    size = size || 24;
    const S = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"`;
    const P = {
      sell: `<path d="M4.5 8h15l-1.2 10.2A2.6 2.6 0 0 1 15.7 20.5H8.3A2.6 2.6 0 0 1 5.7 18.2z"/><path d="M9 8V6.2A3 3 0 0 1 15 6.2V8"/><path d="M9.5 12.5h5"/>`,
      stock: `<path d="M12 3.5v9.5"/><path d="M8.2 9.4 12 13.2l3.8-3.8"/><path d="M4 15v3.5A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2V15"/>`,
      product: `<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>`,
      records: `<path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6L8.4 20.5 6 18.9z"/><path d="M9.2 8.2h5.6M9.2 12h5.6"/>`,
      settings: `<path d="M4 7.5h8M17 7.5h3M4 16.5h3M12 16.5h8"/><circle cx="14.4" cy="7.5" r="2.6"/><circle cx="9.4" cy="16.5" r="2.6"/>`
    };
    return `<svg ${S} aria-hidden="true">${P[name] || ''}</svg>`;
  }

  /* ---------- 工具 ---------- */
  function wrap(size, viewBox, inner) {
    return `<svg viewBox="${viewBox}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
  }

  return { face, wave, scan, happy, search, basket, paw, mark, icon, colors: C };
})();
