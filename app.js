/* Adv Precalc — the student app.
   index.json is built by admin/app/deploy.py from the 26-27 schedule.  Every
   class day is a row; a row carries its own materials (quarto, tickets, calc)
   only when Ryan has approved them, otherwise the day says "materials coming". */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const md = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
  const docUrl = f => `${f.file}?h=${f.hash.slice(0, 12)}`;

  let IDX = null, view = 'upcoming';
  try { view = localStorage.getItem('advpc-view') || 'upcoming'; } catch (e) {}

  // ── network status ──
  function setNet(online, cached) {
    const p = $('#netpill');
    p.classList.toggle('off', !online || cached);
    $('#nettext').textContent = !online ? 'Offline' : cached ? 'Offline copy' : 'Up to date';
  }
  addEventListener('online', () => setNet(true, false));
  addEventListener('offline', () => setNet(false, false));

  // ── rendering ──
  const days = () => IDX.rows.filter(r => r.kind !== 'unit' && r.kind !== 'break');

  function chip(r) {
    if (!r.assess) return '';
    const k = r.kind === 'test' ? 'test' : 'quiz';
    return `<span class="chip ${k}">${esc(r.assess)}</span>`;
  }

  function mats(r) {
    const b = [];
    if (r.quarto) b.push(`<button class="mat" data-doc="${esc(docUrl(r.quarto))}" data-title="${esc(r.quarto.title || r.topic)}">Lecture</button>`);
    // Everything opens in the in-app viewer.  Tickets are PDFs (data-pdf: see
    // openDoc for the one exception); calc-site pages frame fine — GitHub Pages
    // sends no X-Frame-Options — and keep their #section anchor.
    (r.tickets || []).forEach((t, i, a) =>
      b.push(`<button class="mat" data-doc="${esc(docUrl(t))}" data-pdf="1" data-title="Entry ticket · ${esc(md(r.date))}">Entry ticket${a.length > 1 ? ' ' + (i + 1) : ''}</button>`));
    if (r.calc) b.push(`<button class="mat ext" data-doc="${esc(r.calc)}" data-title="Calc lesson · ${esc(r.sec)}">Calc lesson</button>`);
    if (b.length) return `<div class="mats">${b.join('')}</div>`;
    return r.kind === 'lesson' ? '<div class="coming">Materials coming</div>' : '';
  }

  function dayCard(r) {
    const past = r.date < TODAY, today = r.date === TODAY;
    if (r.kind === 'open') {
      return `<div class="day open${past ? ' past' : ''}"><div class="date">${md(r.date)}</div>
        <div class="body"><div class="topic muted">Open day</div></div></div>`;
    }
    const meta = [r.sec && r.sec !== '—' && !/^(quiz|test|review)$/i.test(r.sec) ? esc(r.sec) : '', chip(r),
                  past ? '<span class="chip past">past</span>' : ''].filter(Boolean).join(' ');
    return `<div class="day${past ? ' past' : ''}${today ? ' today' : ''}" id="d${r.date}">
      <div class="date">${md(r.date)}${today ? '<small>today</small>' : ''}</div>
      <div class="body">
        <div class="topic">${esc(r.topic || '—')}</div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
        ${r.kind === 'lesson' ? `<div class="hw"><b>HW</b>${r.hw ? esc(r.hw) : (past ? '—' : 'given in class')}</div>` : ''}
        ${mats(r)}
      </div></div>`;
  }

  function renderHead() {
    const ds = days();
    const next = ds.find(r => r.date >= TODAY && r.kind !== 'open');
    if (next) {
      $('#next').innerHTML = `<div class="hero">
        <div class="eyebrow">${next.date === TODAY ? 'Today' : 'Next class · ' + md(next.date)}</div>
        <h2>${esc(next.topic || '—')}</h2>
        <div class="sub">${[next.sec && !/^(quiz|test|review)$/i.test(next.sec) ? esc(next.sec) : '', next.hw ? 'HW ' + esc(next.hw) : ''].filter(Boolean).join(' · ')}</div>
        ${mats(next)}</div>`;
    } else {
      $('#next').innerHTML = '<div class="hero"><div class="eyebrow">2026–27</div><h2>That’s the year.</h2></div>';
    }
    const soon = ds.filter(r => r.date >= TODAY && (r.kind === 'quiz' || r.kind === 'test')).slice(0, 3);
    $('#soon').innerHTML = soon.length ? `<div class="soon">${soon.map(r =>
      `<span class="chip ${r.kind}">${esc(r.assess)} · ${md(r.date)}</span>`).join('')}</div>` : '';
  }

  function renderList() {
    const out = [];
    let pendingUnit = null, lastUnit = null;
    for (const r of IDX.rows) {
      if (r.kind === 'unit') { pendingUnit = r; continue; }
      if (r.kind === 'break') {             // breaks carry no date: whole-year view only
        if (view === 'all') out.push(`<div class="brk">${esc(r.text)}</div>`);
        continue;
      }
      if (view === 'upcoming' && r.date < TODAY) { if (pendingUnit) { lastUnit = pendingUnit; pendingUnit = null; } continue; }
      const u = pendingUnit || (view === 'upcoming' && out.length === 0 ? lastUnit : null);
      if (u) out.push(`<div class="unit">Unit ${u.unit} · ${esc(u.title)}</div>`);
      pendingUnit = null;
      out.push(dayCard(r));
    }
    $('#list').innerHTML = out.join('') || '<p class="muted">No class days left.</p>';
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
  }

  function render() {
    $('#bootmsg').remove?.();
    renderHead(); renderList();
    $('#tabs').hidden = false; $('#foot').hidden = false;
    countSaved();
  }

  // ── viewer ──
  // Android Chrome does not render a PDF inside an iframe (it shows a blank box
  // or a download prompt), so there — and only there — a PDF opens in a new tab.
  // Same origin, so the service worker still serves the saved copy offline.
  const NO_PDF_FRAME = /Android/i.test(navigator.userAgent);

  function openDoc(url, title, pdf) {
    if (pdf && NO_PDF_FRAME) { window.open(url, '_blank', 'noopener'); return; }
    $('#vtitle').textContent = title;
    $('#vopen').href = url;
    // A fresh iframe per document: re-pointing an existing iframe's src adds a
    // joint-history entry, and then Back steps the frame back instead of closing.
    const f = document.createElement('iframe');
    f.id = 'vframe'; f.title = title; f.src = url;
    $('#viewer').appendChild(f);
    $('#viewer').hidden = false;
    document.body.style.overflow = 'hidden';
    history.pushState({ doc: url }, '');
  }
  function closeDoc() {
    $('#viewer').hidden = true;
    const f = $('#vframe'); if (f) f.remove();
    document.body.style.overflow = '';
  }
  // Back always closes, even after in-frame navigation; then drop our entry.
  function back() {
    if ($('#viewer').hidden) return;
    closeDoc();
    if (history.state && history.state.doc) history.back();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-doc]');
    if (b) { openDoc(b.dataset.doc, b.dataset.title, !!b.dataset.pdf); return; }
    const t = e.target.closest('.tab');
    if (t) {
      view = t.dataset.view;
      try { localStorage.setItem('advpc-view', view); } catch (err) {}
      renderList();
      if (view === 'all') { const el = document.getElementById('d' + (days().find(r => r.date >= TODAY) || {}).date); if (el) el.scrollIntoView({ block: 'center' }); }
    }
  });
  $('#vback').addEventListener('click', back);
  addEventListener('popstate', () => { if (!$('#viewer').hidden) closeDoc(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') back(); });

  // ── save for offline ──
  const allFiles = () => (IDX.files || []).map(docUrl);
  async function countSaved() {
    if (!('caches' in window)) { $('#savenote').textContent = ''; return; }
    try {
      const c = await caches.open('advpc-docs-v1');
      const keys = new Set((await c.keys()).map(r => { const u = new URL(r.url); return u.pathname.split('/').slice(-2).join('/') + u.search; }));
      const n = allFiles().filter(f => keys.has(f)).length;
      $('#savenote').textContent = `${n} of ${allFiles().length} documents saved on this device.`;
    } catch (e) { $('#savenote').textContent = ''; }
  }
  $('#savebtn').addEventListener('click', async () => {
    const b = $('#savebtn'); b.disabled = true; b.textContent = 'Saving…';
    let ok = 0;
    for (const f of allFiles()) { try { const r = await fetch(f); if (r.ok) ok++; } catch (e) {} }
    b.disabled = false; b.textContent = 'Save everything for offline';
    countSaved();
  });

  // ── boot ──
  async function load() {
    try {
      const res = await fetch('index.json', { cache: 'no-store' });
      IDX = await res.json();
      setNet(navigator.onLine, res.headers.get('X-From-Cache') === '1');
      render();
    } catch (e) {
      $('#bootmsg').textContent = 'Could not load the schedule. Connect once to download it.';
      setNet(false, false);
    }
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
