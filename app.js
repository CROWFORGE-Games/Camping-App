'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  activeTab: 'camping',
  guests: [],
  requests: [],
  pitches: [],
  weekData: [],
  weekFrom: null,
  requestFilter: 'new',
  selectedWeekDay: null,
  settings: {},
  gasEnabled: false,
  resendConfigured: false,
  guestSearch: '',
};

// ─── API ──────────────────────────────────────────────────────────────────────

const getToken = () => localStorage.getItem('camping_token');
const setToken = (t) => localStorage.setItem('camping_token', t);
const clearToken = () => localStorage.removeItem('camping_token');

const api = async (url, options = {}) => {
  const token = getToken();
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new Error((data?.error) || `Fehler ${res.status}`);
  return data;
};

// ─── Datum-Hilfsfunktionen ────────────────────────────────────────────────────

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDate = (dateStr) => {
  if (!dateStr) return '–';
  const p = String(dateStr).split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : dateStr;
};

const mondayOfWeek = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Nav-Indicator ────────────────────────────────────────────────────────────

const updateNavIndicator = () => {
  const activeBtn = document.querySelector('.nav-btn.is-active');
  const indicator = document.getElementById('nav-indicator');
  if (!activeBtn || !indicator) return;
  indicator.style.left = `${activeBtn.offsetLeft}px`;
  indicator.style.width = `${activeBtn.offsetWidth}px`;
};

const updateRequestsBadge = () => {
  const count = state.requests.filter(r => r.status === 'new').length;
  const badge = document.getElementById('requests-badge');
  if (!badge) return;
  badge.textContent = count > 9 ? '9+' : count;
  badge.classList.toggle('hidden', count === 0);
};

// ─── Toast ────────────────────────────────────────────────────────────────────

const showToast = (msg, type = 'info') => {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
};

// ─── Loading ──────────────────────────────────────────────────────────────────

const setLoading = (on) => {
  document.getElementById('loading-overlay').classList.toggle('hidden', !on);
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

const login = async (email, password) => {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
};

const logout = async () => {
  clearToken();
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
};

const checkSession = async () => {
  const token = getToken();
  if (!token) return false;
  const data = await api('/api/auth/session');
  return Boolean(data?.user);
};

// ─── Daten laden ──────────────────────────────────────────────────────────────

const loadBootstrap = async () => {
  const data = await api('/api/app/bootstrap');
  state.guests = data.guests || [];
  state.requests = data.requests || [];
  state.pitches = data.pitches || [];
  state.weekData = data.weekData || [];
  state.weekFrom = data.weekFrom || todayStr();
  state.selectedWeekDay = todayStr();
  state.settings = data.settings || {};
  state.gasEnabled = Boolean(data.gasEnabled);
  state.resendConfigured = Boolean(data.resendConfigured);
};

const loadWeek = async (fromDate) => {
  const data = await api(`/api/app/week?from=${fromDate}`);
  state.weekData = data.weekData || [];
  state.weekFrom = data.weekFrom;
};

const refreshAll = async () => {
  await loadBootstrap();
  renderActiveTab();
};

// ─── Tab-Navigation ───────────────────────────────────────────────────────────

const switchTab = (tab) => {
  state.activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isActive = panel.id === `tab-${tab}`;
    panel.classList.toggle('hidden', !isActive);
    if (isActive) {
      panel.classList.remove('tab-fade-in');
      void panel.offsetWidth; // force reflow
      panel.classList.add('tab-fade-in');
    }
  });
  updateNavIndicator();
  renderActiveTab();
};

const renderActiveTab = () => {
  if (state.activeTab === 'camping') renderCampingTab();
  if (state.activeTab === 'pitches') renderPitchesTab();
  if (state.activeTab === 'requests') renderRequestsTab();
};

// ─── Hilfsfunktionen Rendering ────────────────────────────────────────────────

const escHtml = (str) => String(str || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const badgeHtml = (label, cls) => `<span class="badge badge-${cls}">${escHtml(label)}</span>`;

const detailRow = (icon, text, label = '') => text
  ? `<div class="detail-row">
       <span class="detail-row-icon">${icon}</span>
       <div class="detail-row-text">
         ${label ? `<span class="detail-row-label">${escHtml(label)}: </span>` : ''}${escHtml(String(text))}
       </div>
     </div>`
  : '';

const emailRow = (email) => email
  ? `<div class="detail-row">
       <span class="detail-row-icon">📧</span>
       <div class="detail-row-text"><a href="mailto:${escHtml(email)}" class="detail-link">${escHtml(email)}</a></div>
     </div>`
  : '';

const phoneRow = (phone) => phone
  ? `<div class="detail-row">
       <span class="detail-row-icon">📞</span>
       <div class="detail-row-text"><a href="tel:${escHtml(phone.replace(/\s/g, ''))}" class="detail-link">${escHtml(phone)}</a></div>
     </div>`
  : '';

// ─── TAB: CAMPING ─────────────────────────────────────────────────────────────

const renderCampingTab = () => {
  const panel = document.getElementById('tab-camping');
  const today = todayStr();
  const soon = addDays(today, 7);

  const incoming = state.requests.filter(r =>
    r.status === 'confirmed' && r.arrival >= today && r.arrival <= soon
  ).sort((a, b) => a.arrival.localeCompare(b.arrival));

  const search = state.guestSearch || '';
  const allGuests = state.guests;
  const guests = allGuests.filter(g =>
    !search ||
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    `${g.stellplatz} ${g.stellplatznummer}`.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const arrivalsToday = state.requests.filter(r => r.status === 'confirmed' && r.arrival === today).length;
  const departuresToday = allGuests.filter(g => g.departure === today).length;
  const totalPitches = state.pitches.length;
  const occupiedPitches = state.pitches.filter(p => p.status === 'occupied').length;
  const occupancyPct = totalPitches > 0 ? Math.round(occupiedPitches / totalPitches * 100) : '–';

  panel.innerHTML = `
    ${!state.gasEnabled ? `<p class="gas-warning">⚠️ Google Sheets nicht verbunden – lokaler Modus</p>` : ''}

    <div class="stat-row">
      <div class="stat-card stat-card-green">
        <span class="stat-value">${allGuests.length}</span>
        <span class="stat-label">Gäste aktiv</span>
      </div>
      <div class="stat-card stat-card-blue">
        <span class="stat-value">${arrivalsToday}</span>
        <span class="stat-label">Ankünfte heute</span>
      </div>
      <div class="stat-card stat-card-orange">
        <span class="stat-value">${departuresToday}</span>
        <span class="stat-label">Abreisen heute</span>
      </div>
      <div class="stat-card stat-card-neutral">
        <span class="stat-value">${occupancyPct}${typeof occupancyPct === 'number' ? '%' : ''}</span>
        <span class="stat-label">Auslastung</span>
      </div>
    </div>

    <div class="section-header">
      <span class="section-title">Ankommend (${incoming.length})</span>
    </div>
    ${incoming.length === 0
      ? `<p class="incoming-empty">Keine bestätigten Ankünfte in den nächsten 7 Tagen.</p>`
      : `<div id="incoming-list">${incoming.map(r => renderIncomingCard(r)).join('')}</div>`
    }

    <div class="section-header" style="margin-top:0.5rem">
      <span class="section-title">Aktuelle Gäste (${allGuests.length})</span>
      <button class="btn btn-sm btn-primary" id="add-guest-btn">+ Gast</button>
    </div>
    <div class="search-wrap">
      <input class="input search-input" type="search" id="guest-search"
        placeholder="Name oder Stellplatz suchen…"
        value="${escHtml(search)}" autocomplete="off" />
    </div>
    ${guests.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l9-18 9 18"/><path d="M7 21v-4a2 2 0 012-2h6a2 2 0 012 2v4"/><path d="M12 3v3"/></svg></div><p>${search ? 'Keine Treffer.' : 'Keine Gäste eingecheckt.'}</p></div>`
      : `<div id="guests-list">${guests.map(g => renderGuestCard(g)).join('')}</div>`
    }
  `;

  bindCampingEvents();
};

const renderIncomingCard = (req) => `
  <div class="card" data-id="${escHtml(req.id)}">
    <button class="card-trigger" data-toggle="${escHtml(req.id)}">
      <div class="card-trigger-main">
        <span class="card-name">${escHtml(req.name)}</span>
        <span class="card-sub">${escHtml(req.preferredPitch || 'Kein Wunschplatz')} · Anreise ${fmtDate(req.arrival)}</span>
      </div>
      <div class="card-trigger-end">
        ${badgeHtml('Ankommend', 'incoming')}
        <span class="card-chevron">▼</span>
      </div>
    </button>
    <div class="card-body">
      ${detailRow('📅', `${fmtDate(req.arrival)} – ${fmtDate(req.departure)}`, 'Zeitraum')}
      ${emailRow(req.email)}
      ${phoneRow(req.phone)}
      ${detailRow('🚐', req.pitchTypes?.join(', '), 'Fahrzeug')}
      ${detailRow('👥', [req.adults ? `${req.adults} Erw.` : '', req.children ? `${req.children} Kinder` : ''].filter(Boolean).join(', '))}
      ${req.message ? detailRow('💬', req.message, 'Nachricht') : ''}
      <div class="detail-divider"></div>
      <button class="btn btn-primary btn-full checkin-from-booking-btn" data-id="${escHtml(req.id)}">
        ✓ Jetzt einchecken
      </button>
      <button class="btn btn-danger btn-sm incoming-delete-btn" data-id="${escHtml(req.id)}" style="margin-top:0.5rem;width:100%">
        Löschen
      </button>
    </div>
  </div>
`;

const renderGuestCard = (guest) => `
  <div class="card" data-id="${escHtml(guest.id)}">
    <button class="card-trigger" data-toggle="${escHtml(guest.id)}">
      <div class="card-trigger-main">
        <div class="card-name-wrap">
          <span class="guest-dot ${guest.paid ? 'guest-dot-paid' : 'guest-dot-unpaid'}"></span>
          <span class="card-name">${escHtml(guest.name)}</span>
        </div>
        <span class="card-sub">${escHtml(guest.stellplatz)} ${escHtml(String(guest.stellplatznummer))} · ${fmtDate(guest.arrival)} – ${fmtDate(guest.departure)}</span>
      </div>
      <div class="card-trigger-end">
        <span class="card-chevron">▼</span>
      </div>
    </button>
    <div class="card-body">
      ${emailRow(guest.email)}
      ${phoneRow(guest.phone)}
      ${detailRow('🚐', guest.pitchTypes, 'Fahrzeug')}
      ${detailRow('👥', [guest.adults ? `${guest.adults} Erw.` : '', guest.children ? `${guest.children} Kinder` : ''].filter(Boolean).join(', '))}
      ${guest.childrenAge ? detailRow('🎒', guest.childrenAge, 'Alter Kinder') : ''}
      ${guest.notes ? detailRow('📝', guest.notes, 'Notiz') : ''}
      <div class="detail-divider"></div>
      <div class="toggle-row">
        <span>Bezahlt</span>
        <button type="button" class="toggle ${guest.paid ? 'is-on' : ''} paid-toggle-btn"
          data-id="${escHtml(guest.id)}" data-paid="${guest.paid ? 'true' : 'false'}"
          aria-pressed="${guest.paid ? 'true' : 'false'}">
        </button>
      </div>
      <div class="btn-row" style="margin-top:0.5rem">
        <button class="btn btn-outline btn-sm checkout-btn" data-id="${escHtml(guest.id)}">
          Auschecken
        </button>
        <button class="btn btn-ghost btn-sm meldezettel-btn" data-id="${escHtml(guest.id)}">
          🖨 Meldezettel
        </button>
        <button class="btn btn-danger btn-sm guest-delete-btn" data-id="${escHtml(guest.id)}" style="margin-left:auto">
          Löschen
        </button>
      </div>
    </div>
  </div>
`;

const printMeldezettel = (guestId) => {
  const guest = state.guests.find(g => g.id === guestId);
  if (!guest) return;
  const w = window.open('', '_blank', 'width=720,height=960');
  const nights = (() => {
    const a = new Date(`${guest.arrival}T00:00:00`);
    const d = new Date(`${guest.departure}T00:00:00`);
    return Math.max(1, Math.round((d - a) / 86400000));
  })();
  w.document.write(`<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
<title>Meldezettel – ${escHtml(guest.name)}</title>
<style>
  body{font-family:Arial,sans-serif;padding:2cm;color:#000;font-size:12pt}
  h1{font-size:20pt;margin:0 0 4px}
  .sub{color:#555;font-size:11pt;margin:0 0 1.5cm}
  table{width:100%;border-collapse:collapse}
  td{padding:7px 10px;border-bottom:1px solid #ddd;vertical-align:top}
  td:first-child{font-weight:bold;width:38%;color:#333}
  .sig{margin-top:2.5cm;display:flex;gap:3cm}
  .sig-line{flex:1;border-top:1px solid #000;padding-top:6px;font-size:10pt;color:#555}
  .footer{margin-top:1.5cm;font-size:9pt;color:#999;text-align:center}
  @media print{body{padding:1cm}}
</style></head><body>
<h1>Meldezettel</h1>
<p class="sub">Hiasen Hof am Thiersee · Campingplatz</p>
<table>
  <tr><td>Name</td><td>${escHtml(guest.name)}</td></tr>
  <tr><td>E-Mail</td><td>${escHtml(guest.email || '–')}</td></tr>
  <tr><td>Telefon</td><td>${escHtml(guest.phone || '–')}</td></tr>
  <tr><td>Stellplatz</td><td>${escHtml(guest.stellplatz)} Nr. ${escHtml(String(guest.stellplatznummer))}</td></tr>
  <tr><td>Anreise</td><td>${fmtDate(guest.arrival)}</td></tr>
  <tr><td>Abreise</td><td>${fmtDate(guest.departure)}</td></tr>
  <tr><td>Aufenthalt</td><td>${nights} Nacht${nights !== 1 ? 'e' : ''}</td></tr>
  <tr><td>Erwachsene</td><td>${guest.adults || 1}</td></tr>
  <tr><td>Kinder</td><td>${guest.children || 0}${guest.childrenAge ? ` (Alter: ${escHtml(guest.childrenAge)})` : ''}</td></tr>
  <tr><td>Fahrzeug / Typ</td><td>${escHtml(guest.pitchTypes || '–')}</td></tr>
  <tr><td>Bezahlt</td><td>${guest.paid ? 'Ja ✓' : 'Nein'}</td></tr>
  ${guest.notes ? `<tr><td>Notizen</td><td>${escHtml(guest.notes)}</td></tr>` : ''}
</table>
<div class="sig">
  <div class="sig-line">Unterschrift Gast</div>
  <div class="sig-line">Datum / Stempel</div>
</div>
<p class="footer">Ausgestellt am ${new Date().toLocaleDateString('de-AT')} · Hiasen Hof am Thiersee · +43 664 885 305 24</p>
<script>window.print();window.onafterprint=()=>window.close();<\/script>
</body></html>`);
  w.document.close();
};

const bindCampingEvents = () => {
  // Karten auf/zuklappen
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      card.classList.toggle('is-open');
    });
  });

  // Gast manuell anlegen
  document.getElementById('add-guest-btn')?.addEventListener('click', () => openGuestModal());

  // Einchecken aus Buchung
  document.querySelectorAll('.checkin-from-booking-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const req = state.requests.find(r => r.id === btn.dataset.id);
      if (req) openGuestModal(req);
    });
  });

  // Bezahlt-Toggle
  document.querySelectorAll('.paid-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const paid = btn.dataset.paid !== 'true';
      btn.classList.toggle('is-on', paid);
      btn.dataset.paid = String(paid);
      btn.setAttribute('aria-pressed', String(paid));
      // Badge in derselben Karte aktualisieren
      const card = btn.closest('.card');
      const badge = card.querySelector('.badge');
      if (badge) {
        badge.className = `badge badge-${paid ? 'paid' : 'unpaid'}`;
        badge.textContent = paid ? 'Bezahlt' : 'Offen';
      }
      try {
        await api(`/api/app/guests/${id}`, { method: 'PATCH', body: JSON.stringify({ paid }) });
        const guest = state.guests.find(g => g.id === id);
        if (guest) guest.paid = paid;
        showToast(paid ? 'Als bezahlt markiert' : 'Als offen markiert', 'success');
      } catch (err) {
        showToast(err.message, 'error');
        // Zurücksetzen
        btn.classList.toggle('is-on', !paid);
        btn.dataset.paid = String(!paid);
      }
    });
  });

  // Schnellsuche
  document.getElementById('guest-search')?.addEventListener('input', (e) => {
    state.guestSearch = e.target.value;
    const cursorPos = e.target.selectionStart;
    renderCampingTab();
    const newInput = document.getElementById('guest-search');
    if (newInput) {
      newInput.focus();
      try { newInput.setSelectionRange(cursorPos, cursorPos); } catch {}
    }
  });

  // Meldezettel drucken
  document.querySelectorAll('.meldezettel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      printMeldezettel(btn.dataset.id);
    });
  });

  // Auschecken
  document.querySelectorAll('.checkout-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Gast wirklich auschecken?')) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api(`/api/app/guests/${id}`, { method: 'DELETE' });
        state.guests = state.guests.filter(g => g.id !== id);
        showToast('Gast ausgecheckt', 'success');
        renderCampingTab();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // Gast löschen (z.B. bei Absage)
  document.querySelectorAll('.guest-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Gast wirklich löschen?')) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api(`/api/app/guests/${id}`, { method: 'DELETE' });
        state.guests = state.guests.filter(g => g.id !== id);
        showToast('Gast gelöscht', 'success');
        renderCampingTab();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // Ankommende Anfrage löschen (bei Absage vor Anreise)
  document.querySelectorAll('.incoming-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Ankommenden Gast wirklich löschen?')) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api(`/api/app/requests/${id}`, { method: 'DELETE' });
        state.requests = state.requests.filter(r => r.id !== id);
        showToast('Gelöscht', 'success');
        renderCampingTab();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
};

// ─── TAB: STELLPLÄTZE ─────────────────────────────────────────────────────────

const renderPitchesTab = () => {
  const panel = document.getElementById('tab-pitches');
  const weekStart = state.weekFrom || todayStr();
  const weekEnd = addDays(weekStart, 6);

  const zones = [...new Set(state.pitches.map(p => p.zone))];

  panel.innerHTML = `
    ${!state.gasEnabled ? `<p class="gas-warning">⚠️ Google Sheets nicht verbunden – lokaler Modus</p>` : ''}

    <!-- Wochennavigation -->
    <div class="week-nav" style="margin-top:0.25rem">
      <button class="btn-icon" id="week-prev" aria-label="Vorherige Woche">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="week-nav-label">${fmtDate(weekStart)} – ${fmtDate(weekEnd)}</span>
      <button class="btn-icon" id="week-next" aria-label="Nächste Woche">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>

    <!-- Wochenstreifen -->
    <div class="week-strip">
      ${state.weekData.map(day => `
        <button class="week-day ${day.date === todayStr() ? 'is-today' : ''} ${day.date === state.selectedWeekDay ? 'is-selected' : ''}"
          data-date="${escHtml(day.date)}" aria-label="${escHtml(day.dayDate)}, ${day.occupied} belegt">
          <span class="week-day-name">${escHtml(day.dayName)}</span>
          <span class="week-day-date">${escHtml(day.dayDate)}</span>
          <span class="week-day-count">${day.occupied}</span>
          <span class="week-day-label">belegt</span>
        </button>
      `).join('')}
    </div>

    <!-- Zonen als Dropdowns -->
    <div class="zone-groups" style="margin-top:0.25rem">
      ${zones.map(zone => renderZoneGroup(zone)).join('')}
    </div>
  `;

  bindPitchEvents();
};

const renderZoneGroup = (zone) => {
  const pitches = state.pitches.filter(p => p.zone === zone);
  const zoneLabel = pitches[0]?.zoneLabel || zone;
  const isOpen = state.openZones?.has(zone) ?? false;

  const free     = pitches.filter(p => p.status === 'free').length;
  const reserved = pitches.filter(p => p.status === 'reserved').length;
  const occupied = pitches.filter(p => p.status === 'occupied').length;

  const countDots = `
    <span class="zone-count ${free === 0 ? 'is-zero' : ''}"><span class="status-dot free"></span>${free} frei</span>
    <span class="zone-count ${reserved === 0 ? 'is-zero' : ''}"><span class="status-dot reserved"></span>${reserved} res.</span>
    <span class="zone-count ${occupied === 0 ? 'is-zero' : ''}"><span class="status-dot occupied"></span>${occupied} bel.</span>
  `;

  return `
    <div class="zone-group">
      <button class="zone-header ${isOpen ? 'is-open' : ''}" data-zone="${escHtml(zone)}">
        <span class="zone-header-name">${escHtml(zoneLabel)}</span>
        <div class="zone-counts">${countDots}</div>
        <span class="zone-chevron">▼</span>
      </button>
      <div class="zone-pitches ${isOpen ? '' : 'hidden'}">
        ${pitches.map(p => renderPitchRow(p)).join('')}
      </div>
    </div>
  `;
};

const renderPitchRow = (pitch) => {
  const guestName = pitch.currentGuest?.name
    || (pitch.nextBooking?.name ? `ab ${fmtDate(pitch.nextBooking.arrival)}: ${pitch.nextBooking.name}` : '');
  const departure = pitch.currentGuest?.departure
    || pitch.nextBooking?.departure
    || '';

  return `
    <div class="pitch-row">
      <span class="status-dot ${escHtml(pitch.status)}"></span>
      <span class="pitch-row-number">Nr. ${escHtml(String(pitch.number))}</span>
      ${guestName
        ? `<span class="pitch-row-guest">${escHtml(guestName)}</span>${departure ? `<span class="pitch-row-until">bis ${escHtml(fmtDate(departure))}</span>` : ''}`
        : pitch.nextBooking
          ? `<span class="pitch-row-free">Frei</span><span class="pitch-row-until">frei bis ${escHtml(fmtDate(pitch.nextBooking.arrival))}</span>`
          : `<span class="pitch-row-free">Frei</span>`
      }
    </div>
  `;
};

const bindPitchEvents = () => {
  document.getElementById('week-prev')?.addEventListener('click', async () => {
    const newFrom = addDays(state.weekFrom, -7);
    try {
      await loadWeek(newFrom);
      state.selectedWeekDay = state.weekFrom;
      const data = await api(`/api/app/pitches?date=${state.selectedWeekDay}`);
      state.pitches = data.pitches || [];
      renderPitchesTab();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('week-next')?.addEventListener('click', async () => {
    const newFrom = addDays(state.weekFrom, 7);
    try {
      await loadWeek(newFrom);
      state.selectedWeekDay = state.weekFrom;
      const data = await api(`/api/app/pitches?date=${state.selectedWeekDay}`);
      state.pitches = data.pitches || [];
      renderPitchesTab();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.querySelectorAll('.week-day').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.selectedWeekDay = btn.dataset.date;
      document.querySelectorAll('.week-day').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      try {
        const data = await api(`/api/app/pitches?date=${state.selectedWeekDay}`);
        state.pitches = data.pitches || [];
        const zonesEl = document.querySelector('#tab-pitches .zone-groups');
        if (zonesEl) {
          const zones = [...new Set(state.pitches.map(p => p.zone))];
          zonesEl.innerHTML = zones.map(zone => renderZoneGroup(zone)).join('');
          bindZoneEvents();
        }
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  bindZoneEvents();
};

const bindZoneEvents = () => {
  if (!state.openZones) state.openZones = new Set();
  document.querySelectorAll('.zone-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const zone = btn.dataset.zone;
      const pitchesEl = btn.nextElementSibling;
      const isOpen = state.openZones.has(zone);
      if (isOpen) {
        state.openZones.delete(zone);
        btn.classList.remove('is-open');
        pitchesEl.classList.add('hidden');
      } else {
        state.openZones.add(zone);
        btn.classList.add('is-open');
        pitchesEl.classList.remove('hidden');
      }
    });
  });
};

// ─── TAB: ANFRAGEN ────────────────────────────────────────────────────────────

const renderRequestsTab = () => {
  const panel = document.getElementById('tab-requests');
  const filters = [
    { key: 'new', label: 'Neu' },
    { key: 'confirmed', label: 'Bestätigt' },
    { key: 'cancelled', label: 'Abgelehnt' },
    { key: 'all', label: 'Alle' },
  ];

  const filtered = state.requests.filter(r =>
    state.requestFilter === 'all' ? true : r.status === state.requestFilter
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const counts = {
    new: state.requests.filter(r => r.status === 'new').length,
    confirmed: state.requests.filter(r => r.status === 'confirmed').length,
    cancelled: state.requests.filter(r => r.status === 'cancelled').length,
    all: state.requests.length,
  };

  panel.innerHTML = `
    ${!state.gasEnabled ? `<p class="gas-warning">⚠️ Google Sheets nicht verbunden – lokaler Modus</p>` : ''}
    ${!state.resendConfigured ? `<p class="gas-warning" style="margin-top:0.5rem">📧 Resend nicht konfiguriert – E-Mail-Versand deaktiviert</p>` : ''}

    <div class="filter-tabs">
      ${filters.map(f => `
        <button class="filter-tab ${state.requestFilter === f.key ? 'is-active' : ''}" data-filter="${escHtml(f.key)}">
          ${escHtml(f.label)} (${counts[f.key]})
        </button>
      `).join('')}
    </div>

    ${filtered.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/></svg></div><p>Keine Anfragen.</p></div>`
      : `<div id="requests-list" style="display:flex;flex-direction:column;gap:0.5rem">${filtered.map(r => renderRequestCard(r)).join('')}</div>`
    }
  `;

  bindRequestEvents();
};

const renderRequestCard = (req) => {
  const statusLabels = { new: 'Neu', confirmed: 'Bestätigt', cancelled: 'Abgelehnt', done: 'Erledigt' };
  const statusBadge  = { new: 'new', confirmed: 'confirmed', cancelled: 'cancelled', done: 'paid' };

  const confirmTpl = `wir freuen uns, Ihre Buchungsanfrage bestätigen zu können.\n\nWir erwarten Sie am ${fmtDate(req.arrival)}${req.preferredPitch ? ` auf ${req.preferredPitch}` : ''}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhr Team vom Hiasen Hof am Thiersee`;
  const cancelTpl  = `vielen Dank für Ihre Anfrage.\n\nLeider müssen wir Ihnen mitteilen, dass wir Ihre Buchung für den gewünschten Zeitraum leider nicht ermöglichen können.\n\nWir hoffen, Sie zu einem anderen Zeitpunkt bei uns begrüßen zu dürfen.\n\nMit freundlichen Grüßen\nIhr Team vom Hiasen Hof am Thiersee`;
  const replyTpl   = `vielen Dank für Ihre Anfrage.\n\n\n\nMit freundlichen Grüßen\nIhr Team vom Hiasen Hof am Thiersee`;

  const pax = [req.adults ? `${req.adults} Erw.` : '', req.children ? `${req.children} Kinder` : ''].filter(Boolean).join(', ');
  const dis = !state.resendConfigured ? 'disabled title="Resend nicht konfiguriert"' : '';

  return `
    <div class="req-card req-card-${escHtml(req.status || 'new')}" data-id="${escHtml(req.id)}">
      <div class="req-card-top">
        <div class="req-card-info">
          <span class="req-name">${escHtml(req.name)}</span>
          <span class="req-sub">${escHtml(req.preferredPitch || 'Kein Wunschplatz')}</span>
          <span class="req-dates">${fmtDate(req.arrival)} – ${fmtDate(req.departure)}${pax ? ` · ${escHtml(pax)}` : ''}</span>
          <div class="req-meta">
            ${req.email ? `<span>${escHtml(req.email)}</span>` : ''}
            ${req.phone ? `<span>${escHtml(req.phone)}</span>` : ''}
            ${req.pitchTypes?.length ? `<span>${escHtml(req.pitchTypes.join(', '))}</span>` : ''}
            ${req.estimatedTotal ? `<span>${escHtml(req.estimatedTotal)}</span>` : ''}
          </div>
          ${req.message ? `<p class="req-message">${escHtml(req.message)}</p>` : ''}
        </div>
        <span class="badge badge-${escHtml(statusBadge[req.status] || 'new')}">${escHtml(statusLabels[req.status] || req.status)}</span>
      </div>

      <div class="req-actions">
        <button class="btn btn-danger btn-sm req-delete-btn" data-id="${escHtml(req.id)}">Löschen</button>
        <button class="btn btn-outline btn-sm req-reply-toggle" data-id="${escHtml(req.id)}">Antworten</button>
      </div>

      <div class="req-reply hidden" data-id="${escHtml(req.id)}">
        <textarea class="textarea reply-text" rows="5"
          data-confirm-tpl="${escHtml(confirmTpl)}"
          data-cancel-tpl="${escHtml(cancelTpl)}"
          data-reply-tpl="${escHtml(replyTpl)}"
        >${escHtml(replyTpl)}</textarea>
        <p class="form-status reply-status" style="display:none"></p>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm req-tpl-btn" data-action="confirm" data-id="${escHtml(req.id)}">✅ Bestätigen</button>
          <button class="btn btn-danger btn-sm req-tpl-btn" data-action="cancel" data-id="${escHtml(req.id)}">❌ Ablehnen</button>
          <button class="btn btn-outline btn-sm reply-send-btn" data-id="${escHtml(req.id)}" ${dis} style="margin-left:auto">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Senden
          </button>
        </div>
      </div>
    </div>
  `;
};

const bindRequestEvents = () => {
  // Filter-Tabs
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.requestFilter = btn.dataset.filter;
      renderRequestsTab();
    });
  });

  // Antwort-Bereich togglen
  document.querySelectorAll('.req-reply-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const replyEl = document.querySelector(`.req-reply[data-id="${id}"]`);
      const isOpen = !replyEl.classList.contains('hidden');
      document.querySelectorAll('.req-reply').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.req-reply-toggle').forEach(b => b.textContent = 'Antworten');
      if (!isOpen) {
        replyEl.classList.remove('hidden');
        btn.textContent = 'Schließen';
        const textarea = replyEl.querySelector('.reply-text');
        if (textarea) textarea.value = textarea.dataset.replyTpl;
      }
    });
  });

  // Löschen
  document.querySelectorAll('.req-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Anfrage wirklich löschen?')) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api(`/api/app/requests/${id}`, { method: 'DELETE' });
        state.requests = state.requests.filter(r => r.id !== id);
        updateRequestsBadge();
        showToast('Anfrage gelöscht', 'success');
        renderRequestsTab();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // Bestätigen / Ablehnen → nur Vorlage laden
  document.querySelectorAll('.req-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const replyEl = btn.closest('.req-reply');
      const textarea = replyEl.querySelector('.reply-text');
      textarea.value = action === 'confirm' ? textarea.dataset.confirmTpl : textarea.dataset.cancelTpl;
      replyEl.dataset.pendingAction = action;
      replyEl.querySelectorAll('.req-tpl-btn').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      textarea.focus();
    });
  });

  // Senden → E-Mail abschicken
  document.querySelectorAll('.reply-send-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const replyEl = btn.closest('.req-reply');
      const action = replyEl.dataset.pendingAction || 'reply';
      const textarea = replyEl.querySelector('.reply-text');
      const statusEl = replyEl.querySelector('.reply-status');
      const message = textarea?.value?.trim();

      if (!message) { showToast('Bitte eine Nachricht eingeben', 'error'); return; }

      const req = state.requests.find(r => r.id === id);
      if (!req) return;

      btn.disabled = true;
      statusEl.style.display = 'none';

      try {
        await api(`/api/app/requests/${id}/reply`, {
          method: 'POST',
          body: JSON.stringify({ message, action, requestData: req }),
        });

        if (action === 'confirm') { req.status = 'confirmed'; updateRequestsBadge(); }
        if (action === 'cancel')  { req.status = 'cancelled'; updateRequestsBadge(); }

        const toastMsg = action === 'confirm' ? 'Buchung bestätigt & E-Mail gesendet'
          : action === 'cancel' ? 'Absage gesendet' : 'Nachricht gesendet';
        showToast(toastMsg, 'success');
        renderRequestsTab();
      } catch (err) {
        showToast(err.message, 'error');
        statusEl.style.display = 'block';
        statusEl.className = 'form-status error reply-status';
        statusEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  });
};

// ─── MODAL: EINSTELLUNGEN ─────────────────────────────────────────────────────

const openSettingsModal = () => {
  const s = state.settings || {};
  document.getElementById('set-sender-name').value = s.senderName || '';
  document.getElementById('settings-status').style.display = 'none';
  document.getElementById('pw-status').style.display = 'none';
  document.getElementById('pw-form').reset();
  document.getElementById('settings-overlay').classList.remove('hidden');
};

const closeSettingsModal = () => {
  document.getElementById('settings-overlay').classList.add('hidden');
};

const bindSettingsEvents = () => {
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settings-overlay')) closeSettingsModal();
  });

  document.getElementById('settings-logout-btn').addEventListener('click', () => {
    closeSettingsModal();
    if (confirm('Wirklich abmelden?')) logout();
  });

  // Einstellungen speichern
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    const statusEl = document.getElementById('settings-status');
    btn.disabled = true;
    statusEl.style.display = 'none';
    try {
      const data = await api('/api/app/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          senderName: document.getElementById('set-sender-name').value.trim(),
        }),
      });
      state.settings = data.settings;
      statusEl.style.display = 'block';
      statusEl.className = 'form-status success';
      statusEl.textContent = '✓ Einstellungen gespeichert';
      showToast('Einstellungen gespeichert', 'success');
    } catch (err) {
      statusEl.style.display = 'block';
      statusEl.className = 'form-status error';
      statusEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Passwort ändern
  document.getElementById('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    const statusEl = document.getElementById('pw-status');
    const newPw = document.getElementById('pw-new').value;
    const confirmPw = document.getElementById('pw-confirm').value;
    statusEl.style.display = 'none';

    if (newPw !== confirmPw) {
      statusEl.style.display = 'block';
      statusEl.className = 'form-status error';
      statusEl.textContent = 'Passwörter stimmen nicht überein.';
      return;
    }

    btn.disabled = true;
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('pw-current').value,
          newPassword: newPw,
        }),
      });
      e.target.reset();
      statusEl.style.display = 'block';
      statusEl.className = 'form-status success';
      statusEl.textContent = '✓ Passwort erfolgreich geändert';
      showToast('Passwort geändert', 'success');
    } catch (err) {
      statusEl.style.display = 'block';
      statusEl.className = 'form-status error';
      statusEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
};

// ─── MODAL: GAST ANLEGEN / EINCHECKEN ────────────────────────────────────────

const openGuestModal = (prefill = null) => {
  const overlay = document.getElementById('modal-overlay');
  const form = document.getElementById('modal-guest-form');
  const title = document.getElementById('modal-title');
  const submitBtn = document.getElementById('modal-submit');

  form.reset();
  document.getElementById('mg-paid-toggle').classList.remove('is-on');
  document.getElementById('mg-paid-input').value = 'false';
  document.getElementById('modal-status').style.display = 'none';
  document.getElementById('modal-booking-id').value = '';

  if (prefill) {
    title.textContent = 'Gast einchecken';
    submitBtn.textContent = 'Einchecken';
    form.name.value = prefill.name || '';
    form.email.value = prefill.email || '';
    form.phone.value = prefill.phone || '';
    form.arrival.value = prefill.arrival || todayStr();
    form.departure.value = prefill.departure || '';
    form.adults.value = prefill.adults || 1;
    form.children.value = prefill.children || 0;
    form.pitchTypes.value = Array.isArray(prefill.pitchTypes) ? prefill.pitchTypes.join(', ') : (prefill.pitchTypes || '');
    document.getElementById('modal-booking-id').value = prefill.id || '';

    // Stellplatz aus Wunsch vorbelegen
    if (prefill.preferredPitchZone) {
      const zoneMap = { wiese1: 'Wiese 1', wiese2: 'Wiese 2', wiese3: 'Wiese 3', see: 'Seeplatz' };
      const normalZone = prefill.preferredPitchZone.trim();
      const zoneName = zoneMap[normalZone.toLowerCase()] || normalZone;
      const select = document.getElementById('mg-zone');
      Array.from(select.options).forEach(opt => {
        if (opt.value === zoneName) select.value = zoneName;
      });
    }
    if (prefill.preferredPitchNumber) {
      document.getElementById('mg-number').value = prefill.preferredPitchNumber;
    }
  } else {
    title.textContent = 'Gast anlegen';
    submitBtn.textContent = 'Einchecken';
    form.arrival.value = todayStr();
  }

  overlay.classList.remove('hidden');
  form.querySelector('input[name="name"]').focus();
};

const closeModal = () => {
  document.getElementById('modal-overlay').classList.add('hidden');
};

const calcEstimatedPrice = () => {
  const arrival = document.getElementById('mg-arrival')?.value;
  const departure = document.getElementById('mg-departure')?.value;
  const adults = parseInt(document.getElementById('mg-adults')?.value) || 1;
  const children = parseInt(document.getElementById('mg-children')?.value) || 0;
  const el = document.getElementById('mg-price-calc');
  if (!el) return;
  if (!arrival || !departure) { el.style.display = 'none'; return; }
  const nights = Math.round((new Date(`${departure}T00:00:00`) - new Date(`${arrival}T00:00:00`)) / 86400000);
  if (nights <= 0) { el.style.display = 'none'; return; }
  const total = nights * (8 + adults * 7.5 + children * 4);
  el.textContent = `ca. € ${total.toFixed(2).replace('.', ',')}  ·  ${nights} Nacht${nights !== 1 ? 'e' : ''}  ·  ${adults} Erw.${children > 0 ? ` + ${children} Kind${children !== 1 ? 'er' : ''}` : ''}`;
  el.style.display = 'block';
};

const bindModalEvents = () => {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Preisrechner
  ['mg-arrival', 'mg-departure', 'mg-adults', 'mg-children'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', calcEstimatedPrice);
    document.getElementById(id)?.addEventListener('input', calcEstimatedPrice);
  });

  // Bezahlt-Toggle im Modal
  const paidToggle = document.getElementById('mg-paid-toggle');
  paidToggle.addEventListener('click', () => {
    const isOn = paidToggle.classList.toggle('is-on');
    document.getElementById('mg-paid-input').value = String(isOn);
    paidToggle.setAttribute('aria-pressed', String(isOn));
  });

  // Formular absenden
  document.getElementById('modal-guest-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('modal-status');
    const submitBtn = document.getElementById('modal-submit');
    submitBtn.disabled = true;
    statusEl.style.display = 'none';

    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name'),
      email: fd.get('email'),
      phone: fd.get('phone'),
      stellplatz: fd.get('stellplatz'),
      stellplatznummer: Number(fd.get('stellplatznummer')),
      arrival: fd.get('arrival'),
      departure: fd.get('departure'),
      adults: Number(fd.get('adults')),
      children: Number(fd.get('children')),
      pitchTypes: fd.get('pitchTypes'),
      notes: fd.get('notes'),
      paid: fd.get('paid') === 'true',
      bookingId: fd.get('bookingId'),
    };

    try {
      const data = await api('/api/app/guests', { method: 'POST', body: JSON.stringify(payload) });
      state.guests.push(data.guest);
      showToast(`${payload.name} eingecheckt`, 'success');
      closeModal();
      if (state.activeTab === 'camping') renderCampingTab();
    } catch (err) {
      statusEl.style.display = 'block';
      statusEl.className = 'form-status error';
      statusEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
};

// ─── INIT ─────────────────────────────────────────────────────────────────────

const showApp = () => {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
};

const showLogin = () => {
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
};

const boot = async () => {
  // Statische Events einmalig binden
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    const btn = e.target.querySelector('button[type="submit"]');
    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Anmelden…';
    try {
      await login(e.target.email.value, e.target.password.value);
      setLoading(true);
      await loadBootstrap();
      setLoading(false);
      showApp();
      renderCampingTab();
      updateRequestsBadge();
      requestAnimationFrame(updateNavIndicator);
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Anmelden';
      setLoading(false);
    }
  });

  bindSettingsEvents();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    try {
      await refreshAll();
      showToast('Aktualisiert', 'success');
    } catch {
      showToast('Aktualisierung fehlgeschlagen', 'error');
    } finally {
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    }
  });

  requestAnimationFrame(updateNavIndicator);
  window.addEventListener('resize', updateNavIndicator);

  bindModalEvents();

  // Auto-Login: Token prüfen
  if (getToken()) {
    setLoading(true);
    try {
      const valid = await checkSession();
      if (valid) {
        await loadBootstrap();
        showApp();
        renderCampingTab();
        updateRequestsBadge();
        requestAnimationFrame(updateNavIndicator);
      } else {
        clearToken();
        showLogin();
      }
    } catch {
      clearToken();
      showLogin();
    } finally {
      setLoading(false);
    }
  }
};

// ─── PWA Install Banner ───────────────────────────────────────────────────────

let _installPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _installPrompt = e;
  document.getElementById('install-banner').classList.remove('hidden');
});

document.getElementById('install-btn').addEventListener('click', async () => {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('install-banner').classList.add('hidden');
  }
  _installPrompt = null;
});

document.getElementById('install-dismiss').addEventListener('click', () => {
  document.getElementById('install-banner').classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner').classList.add('hidden');
  _installPrompt = null;
});

boot();
