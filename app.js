/* Adv Precalc — the student app.
   index.json is built by admin/app/deploy.py from the 26-27 schedule.  Every
   class day is a row; a row carries its own materials (quarto, tickets, calc)
   only when Ryan has approved them, otherwise the day says "materials coming".

   The look is calc's and astro's (Ryan, 2026-11-04): a rail on the left
   (Upcoming / Whole year, the coming quizzes and tests, collapsible units of
   class days) and a reader on the right (the day's head with its HW, a chip per
   document, the document).  At phone width the rail is the home screen; a day
   opens full screen with a back arrow.  On a computer the next class opens by
   itself.

   Routes (hash):  #upcoming  #all  a rail view
                   #day=<date>[&doc=<n>]  a class day, on its n-th document */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const md = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = iso => DOW[new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).getDay()];
  const docUrl = f => `${f.file}?h=${f.hash.slice(0, 12)}`;
  const DOCS_CACHE = 'advpc-docs-v1';

  let IDX = null, view = 'upcoming', route = null, backInApp = false, cached = new Set(), railScroll = 0;
  const byKey = new Map();
  try { view = localStorage.getItem('advpc-view') || 'upcoming'; } catch (e) {}
  // Units the student has opened or closed on this device.  A unit never touched
  // follows the default (the current unit open), so the default moves with the year.
  let unitState = {};
  try { unitState = JSON.parse(localStorage.getItem('advpc-units')) || {}; } catch (e) {}

  // ── network status ──
  let fromCache = false;
  function setNet() {
    const online = navigator.onLine;
    $('#netpill').classList.toggle('off', !online || fromCache);
    $('#nettext').textContent = !online ? 'Offline' : fromCache ? 'Offline copy' : 'Up to date';
  }
  addEventListener('online', setNet);
  addEventListener('offline', setNet);

  // ── data helpers ──
  const days = () => IDX.rows.filter(r => r.kind !== 'unit' && r.kind !== 'break');
  const nextDay = () => days().find(r => r.date >= TODAY && r.kind !== 'open');
  const isPhone = () => matchMedia('(max-width:760px)').matches;
  const secText = r => r.sec && r.sec !== '—' && !/^(quiz|test|review)$/i.test(r.sec) ? r.sec : '';

  /** A day's documents, in the order the old cards showed them. */
  function docs(r) {
    const d = [];
    if (r.quarto) d.push({ label: 'Lecture', url: docUrl(r.quarto), pdf: false });
    // Everything opens in the in-app reader.  Tickets are PDFs (see drawPDF);
    // calc-site pages frame fine (GitHub Pages sends no X-Frame-Options).
    (r.tickets || []).forEach((t, i, a) => d.push({ label: `Entry ticket${a.length > 1 ? ' ' + (i + 1) : ''}`, url: docUrl(t), pdf: true }));
    if (r.calc) d.push({ label: 'Calc lesson', url: r.calc, pdf: false, ext: true });
    return d;
  }

  function tags(r) {
    const t = [];
    if (r.date === TODAY) t.push('<span class="tag today">Today</span>');
    if (r.kind === 'quiz' || r.kind === 'test') t.push(`<span class="tag ${r.kind}">${esc(r.assess || r.kind)}</span>`);
    return t.join('');
  }

  // ── rail ──
  const CHEV = '<span class="chev"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg></span>';

  function rowHTML(r, onKey) {
    const on = r.key === onKey ? ' on' : '', past = r.date < TODAY ? ' past' : '';
    if (r.kind === 'quiz' || r.kind === 'test')
      return `<button class="assess ${r.kind}${on}${past}" data-go="#day=${r.key}">${esc(r.topic || r.assess)}<span>${dow(r.date)} ${md(r.date)}</span></button>`;
    const n = docs(r).length;
    const sub = [tags(r)];
    if (r.kind === 'lesson' && r.hw) sub.push(`<span>HW ${esc(r.hw)}</span>`);
    if (n) sub.push(`<span>${n} item${n > 1 ? 's' : ''}</span>`);
    else if (r.kind === 'lesson') sub.push('<span>Materials coming</span>');
    const title = r.kind === 'open' ? 'Open day' : (r.topic || '—');
    const code = secText(r) ? `<span class="dcode">${esc(secText(r))}</span>` : '';
    return `<button class="drow${on}${past}${n ? '' : ' empty'}${r.date === TODAY ? ' today' : ''}" id="d${r.date}" data-go="#day=${r.key}">` +
      `<div class="ddate">${md(r.date)}<i>${dow(r.date)}</i></div>` +
      `<div class="dmeta"><div class="dtitle">${code}${esc(title)}</div><div class="dsub">${sub.join('')}</div></div></button>`;
  }

  function renderRail() {
    document.querySelectorAll('#tabs .utab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
    const body = $('#railbody');
    const keep = body.dataset.view === view ? railScroll : null;    // hidden while reading on a phone, so remembered
    const onKey = route && route.row ? route.row.key : null;
    const nd = nextDay(), current = nd ? nd.unit : null;
    const out = [];
    const soon = days().filter(r => r.date >= TODAY && (r.kind === 'quiz' || r.kind === 'test')).slice(0, 3);
    if (soon.length) out.push(`<div class="rsec">Coming up</div><div class="soon">${soon.map(r =>
      `<span class="tag ${r.kind}">${esc(r.assess)} · ${md(r.date)}</span>`).join('')}</div>`);
    let u = null, body_ = [], n = 0, hasOn = false;
    const flush = () => {
      if (u && n) {
        const open = (u.unit in unitState ? unitState[u.unit] : u.unit === current) || (hasOn && !isPhone());
        out.push(`<details class="ufold" data-unit="${u.unit}"${open ? ' open' : ''}>` +
          `<summary class="unit">${CHEV}<b>Unit ${u.unit} · ${esc(u.title)}</b><span class="n">${n}</span></summary>${body_.join('')}</details>`);
      }
      body_ = []; n = 0; hasOn = false;
    };
    let nowPlaced = false;
    for (const r of IDX.rows) {
      if (r.kind === 'unit') { flush(); u = r; continue; }
      if (r.kind === 'break') {             // breaks carry no date: whole-year view only
        if (view === 'all') body_.push(`<div class="brk">${esc(r.text)}</div>`);
        continue;
      }
      if (view === 'upcoming' && r.date < TODAY) continue;
      if (view === 'all' && !nowPlaced && nd && r === nd) {
        nowPlaced = true;
        if (nd.date !== TODAY && n > 0) body_.push('<div class="nowline">Today</div>');
      }
      if (r.key === onKey) hasOn = true;
      body_.push(rowHTML(r, onKey)); n++;
    }
    flush();
    body.innerHTML = out.join('') || '<div class="emptyday"><b>No class days left.</b></div>';
    if (keep !== null) body.scrollTop = keep;
    else {
      body.scrollTop = 0; body.dataset.view = view;
      const t = body.querySelector('.drow.on, .assess.on') || (nd && document.getElementById('d' + nd.date));
      if (t && t.offsetParent && view === 'all') t.scrollIntoView({ block: 'center' });
    }
    countSaved();
  }

  // ── reader ──
  // PDFs on phones and tablets: an iframe shows only page 1 on iPhone and iPad and
  // nothing on Android, and a new tab strands the installed home-screen app on a
  // bare PDF with no way back (Ryan, 2026-10-30: "still no return path on app").
  // So there the reader draws every page itself with the bundled PDF.js (lib/,
  // precached by sw.js, works offline).  ?pdfjs=1 forces this on any browser.
  // iPadOS reports itself as a Mac; touch points give it away.
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const PDFJS = IOS || /Android/i.test(navigator.userAgent) || /[?&]pdfjs=1\b/.test(location.search);
  const STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const isSaved = d => !d.ext && cached.has(d.url);

  /** Each document of the open day is mounted once and toggled by [hidden]: a
   *  reloaded frame loses its widget state, and re-pointing one frame's src adds
   *  history entries that Back would step through. */
  function renderReader() {
    const head = $('#dochead'), chips = $('#chips'), stage = $('#stage');
    if (!route.row) { head.innerHTML = ''; chips.innerHTML = ''; stage.innerHTML = ''; stage.dataset.key = ''; return; }
    const r = route.row, ds = docs(r);
    const d = ds[route.doc] || ds[0];
    const kicker = `${dow(r.date)} ${md(r.date)} · Unit ${r.unit}`;
    const sub = [secText(r) ? esc(secText(r)) : '', r.kind === 'lesson' ? `<b>HW</b>${r.hw ? esc(r.hw) : (r.date < TODAY ? '—' : 'given in class')}` : '']
      .filter(Boolean).join(' &nbsp;·&nbsp; ');
    const tools = d ? '<div class="dh-tools">' +
      (IOS && STANDALONE ? '' :            // a new tab there is the same dead end
        `<a class="iconbtn" href="${esc(d.url)}" target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>`) +
      '</div>' : '';
    head.innerHTML = `<div class="dh-main"><div class="dh-kicker">${esc(kicker)}${tags(r)}</div>` +
      `<h1 class="dh-title">${esc(r.kind === 'open' ? 'Open day' : (r.topic || '—'))}</h1>${sub ? `<div class="dh-sub">${sub}</div>` : ''}</div>${tools}`;
    chips.innerHTML = ds.map((x, i) => `<button class="chip${x === d ? ' on' : ''}" role="tab" data-doc="${i}">` +
      `${isSaved(x) ? '<span class="ok" title="Saved for offline"></span>' : ''}${esc(x.label)}${x.ext ? ' <small>↗</small>' : ''}</button>`).join('');

    if (stage.dataset.key !== r.key) { stage.innerHTML = ''; stage.dataset.key = r.key; }
    if (!d) {
      const msg = r.kind === 'lesson' ? 'Materials coming' : r.kind === 'open' ? 'Open day' : 'Nothing to open for this day.';
      stage.innerHTML = `<div class="pane"><div class="emptyday"><b>${msg}</b>${r.kind === 'lesson' ? 'Check back closer to class.' : ''}</div></div>`;
      return;
    }
    let f = [...stage.children].find(x => x.dataset.url === d.url);
    if (!f && d.pdf && PDFJS) {
      f = document.createElement('div');
      f.className = 'pdfview'; f.dataset.url = d.url; f.title = d.label;
      stage.appendChild(f);
      drawPDF(f, d.url);
    } else if (!f) {
      f = document.createElement('iframe');
      f.dataset.url = d.url; f.title = d.label;
      f.setAttribute('allowfullscreen', '');
      f.src = d.url;
      stage.appendChild(f);
    }
    [...stage.children].forEach(x => { x.hidden = x !== f; });
  }

  /** Draw every page of a PDF into `box`, page by page, at the box's width. */
  async function drawPDF(box, url) {
    box.innerHTML = '<p class="pdfmsg">Opening&hellip;</p>';
    try {
      const lib = await import('./lib/pdf.min.js');
      lib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
      const pdf = await lib.getDocument({ url, disableRange: true, disableStream: true }).promise;
      box.innerHTML = '';
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const width = Math.max(box.clientWidth - 16, 280);
      for (let n = 1; n <= pdf.numPages && box.isConnected; n++) {
        const page = await pdf.getPage(n);
        const vp = page.getViewport({ scale: (width * dpr) / page.getViewport({ scale: 1 }).width });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.setAttribute('aria-label', `Page ${n} of ${pdf.numPages}`);
        box.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    } catch (e) {
      box.innerHTML = '<p class="pdfmsg">This PDF could not be shown. Connect to the internet once, then try again.</p>';
    }
  }

  // ── routing ──
  function parse() {
    const h = decodeURIComponent(location.hash.slice(1));
    const p = {};
    h.split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = kv.slice(i + 1); });
    if (p.day && byKey.has(p.day)) return { row: byKey.get(p.day), doc: +p.doc || 0 };
    return { view: h === 'all' || h === 'upcoming' ? h : null };
  }
  function go() {
    if (!IDX) return;
    let r = parse();
    if (r.view && r.view !== view) {
      view = r.view;
      try { localStorage.setItem('advpc-view', view); } catch (e) {}
    }
    if (!r.row && !isPhone()) {
      const d = nextDay() || days()[days().length - 1];
      if (d) { history.replaceState(null, '', `#day=${d.key}`); r = { row: d, doc: 0 }; }
    }
    // Back may use history only if this app pushed the day entry itself.
    if (r.row && !(route && route.row)) backInApp = !!route;
    route = r;
    document.body.classList.toggle('reading', !!r.row);   // before drawing: a hidden rail cannot scroll
    renderRail();
    renderReader();
    $('#backbtn').hidden = !(isPhone() && r.row);
  }

  // ── search ──
  const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function buildSearch() {
    const INDEX = days().filter(r => r.kind !== 'open').map(r => ({
      t: r.topic || r.assess || '—', s: [`${dow(r.date)} ${md(r.date)}`, secText(r), r.hw ? 'HW ' + r.hw : ''].filter(Boolean).join(' · '),
      k: [r.topic, r.sec, r.assess].join(' '), h: `#day=${r.key}` }));
    const inp = $('#search'), box = $('#results');
    let sel = 0, hits = [];
    inp.oninput = () => {
      const q = fold(inp.value.trim());
      if (!q) { box.classList.remove('open'); return; }
      const words = q.split(/\s+/);
      hits = INDEX.filter(x => words.every(w => fold(x.k + ' ' + x.s).includes(w))).slice(0, 14);
      sel = 0; draw();
    };
    function draw() {
      box.innerHTML = hits.length ? '' : '<div class="res"><span>No matches</span></div>';
      hits.forEach((x, i) => {
        const b = document.createElement('button');
        b.className = 'res' + (i === sel ? ' on' : '');
        b.innerHTML = `<b>${esc(x.t)}</b><span>${esc(x.s)}</span>`;
        b.onmousedown = e => { e.preventDefault(); pick(x); };
        box.appendChild(b);
      });
      box.classList.add('open');
    }
    function pick(x) {
      box.classList.remove('open'); inp.value = ''; inp.blur();
      if (location.hash === x.h) go(); else location.hash = x.h;
    }
    inp.onkeydown = e => {
      if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && hits[sel]) pick(hits[sel]);
      if (e.key === 'Escape') { inp.value = ''; box.classList.remove('open'); inp.blur(); }
    };
    inp.onblur = () => setTimeout(() => box.classList.remove('open'), 150);
  }

  // ── wiring ──
  document.addEventListener('click', e => {
    const t = e.target.closest('#tabs .utab');
    if (t) {
      view = t.dataset.view;
      try { localStorage.setItem('advpc-view', view); } catch (err) {}
      if (route && route.row) renderRail(); else location.hash = view;
      return;
    }
    const g = e.target.closest('[data-go]');
    if (g) { if (location.hash === g.dataset.go) go(); else location.hash = g.dataset.go; return; }
    const c = e.target.closest('#chips .chip');
    // Switching documents within a day replaces the hash, so Back still leaves the day.
    if (c) { location.replace(`#day=${route.row.key}&doc=${c.dataset.doc}`); return; }
    const s = e.target.closest('summary.unit');
    if (s) {                                 // click fires before the fold flips
      const d = s.parentElement;
      unitState[d.dataset.unit] = !d.open;
      try { localStorage.setItem('advpc-units', JSON.stringify(unitState)); } catch (err) {}
    }
  });
  $('#railbody').addEventListener('scroll', e => { if (e.target.offsetParent) railScroll = e.target.scrollTop; }, { passive: true });
  $('#backbtn').addEventListener('click', () => backInApp ? history.back() : location.replace('#' + view));
  $('#brand').addEventListener('click', e => { e.preventDefault(); location.hash = view; });
  $('#themebtn').addEventListener('click', () => {
    const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
    const t = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('advpc-theme', t); } catch (err) {}
  });
  addEventListener('hashchange', () => refreshCached().then(go));
  matchMedia('(max-width:760px)').addEventListener('change', go);
  addEventListener('keydown', e => {
    if (e.target.matches('input')) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
    if (e.key === 'Escape' && route && route.row && isPhone()) $('#backbtn').click();
  });

  // ── save for offline ──
  const allFiles = () => (IDX.files || []).map(docUrl);
  async function refreshCached() {
    cached = new Set();
    if (!('caches' in window)) return;
    try {
      const c = await caches.open(DOCS_CACHE);
      for (const r of await c.keys()) { const u = new URL(r.url); cached.add(decodeURIComponent(u.pathname.split('/').slice(-2).join('/')) + u.search); }
    } catch (e) {}
  }
  function countSaved() {
    if (!('caches' in window)) { $('#savenote').textContent = ''; return; }
    const n = allFiles().filter(f => cached.has(f)).length;
    $('#savenote').textContent = `${n} of ${allFiles().length} documents saved on this device`;
  }
  $('#savebtn').addEventListener('click', async () => {
    const b = $('#savebtn'); b.disabled = true;
    const todo = allFiles().filter(f => !cached.has(f));
    let i = 0;
    for (const f of todo) { b.textContent = `Saving ${++i}/${todo.length}…`; try { await fetch(f); } catch (e) {} }
    b.disabled = false; b.textContent = 'Save everything for offline';
    await refreshCached(); countSaved();
  });

  // ── boot ──
  async function load() {
    try {
      const res = await fetch('index.json', { cache: 'no-store' });
      IDX = await res.json();
      fromCache = res.headers.get('X-From-Cache') === '1';
    } catch (e) {
      $('#bootmsg').textContent = 'Could not load the schedule. Connect once to download it.';
      setNet(); return;
    }
    IDX.rows.forEach((r, i) => { if (r.date) { r.key = byKey.has(r.date) ? `${r.date}-${i}` : r.date; byKey.set(r.key, r); } });
    if (IDX.year) $('#year').textContent = IDX.year.replace('-', '–');
    if (isPhone()) $('#search').placeholder = 'Search';
    setNet();
    await refreshCached();
    buildSearch();
    document.body.classList.add('ready');
    go();
  }
  load();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Only an UPDATE earns the toast; the first install has nothing to reload.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'activated' && hadController) {
            $('#toastmsg').textContent = 'A new version is ready.';
            $('#toast').classList.add('show');
          }
        });
      });
    }).catch(() => {});
    $('#toastbtn').addEventListener('click', () => location.reload());
  }
})();
