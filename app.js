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
  state.selectedWeekDay = state.weekFrom;
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
    panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
  });
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

// ─── TAB: CAMPING ─────────────────────────────────────────────────────────────

const renderCampingTab = () => {
  const panel = document.getElementById('tab-camping');
  const today = todayStr();
  const soon = addDays(today, 7);

  const incoming = state.requests.filter(r =>
    r.status === 'confirmed' && r.arrival >= today && r.arrival <= soon
  ).sort((a, b) => a.arrival.localeCompare(b.arrival));

  const guests = [...state.guests].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  panel.innerHTML = `
    ${!state.gasEnabled ? `<p class="gas-warning">⚠️ Google Sheets nicht verbunden – lokaler Modus</p>` : ''}

    <div class="section-header">
      <span class="section-title">Ankommend (${incoming.length})</span>
    </div>
    ${incoming.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">🗓️</div><p>Keine bestätigten Ankünfte in den nächsten 7 Tagen.</p></div>`
      : `<div id="incoming-list">${incoming.map(r => renderIncomingCard(r)).join('')}</div>`
    }

    <div class="section-header" style="margin-top:0.5rem">
      <span class="section-title">Aktuelle Gäste (${guests.length})</span>
      <button class="btn btn-sm btn-primary" id="add-guest-btn">+ Gast</button>
    </div>
    ${guests.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">⛺</div><p>Keine Gäste eingecheckt.</p></div>`
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
      ${detailRow('📧', req.email)}
      ${detailRow('📞', req.phone)}
      ${detailRow('🚐', req.pitchTypes?.join(', '), 'Fahrzeug')}
      ${detailRow('👥', [req.adults ? `${req.adults} Erw.` : '', req.children ? `${req.children} Kinder` : ''].filter(Boolean).join(', '))}
      ${req.message ? detailRow('💬', req.message, 'Nachricht') : ''}
      <div class="detail-divider"></div>
      <button class="btn btn-primary btn-full checkin-from-booking-btn" data-id="${escHtml(req.id)}">
        ✓ Jetzt einchecken
      </button>
    </div>
  </div>
`;

const renderGuestCard = (guest) => `
  <div class="card" data-id="${escHtml(guest.id)}">
    <button class="card-trigger" data-toggle="${escHtml(guest.id)}">
      <div class="card-trigger-main">
        <span class="card-name">${escHtml(guest.name)}</span>
        <span class="card-sub">${escHtml(guest.stellplatz)} ${escHtml(String(guest.stellplatznummer))} · ${fmtDate(guest.arrival)} – ${fmtDate(guest.departure)}</span>
      </div>
      <div class="card-trigger-end">
        ${guest.paid ? badgeHtml('Bezahlt', 'paid') : badgeHtml('Offen', 'unpaid')}
        <span class="card-chevron">▼</span>
      </div>
    </button>
    <div class="card-body">
      ${detailRow('📧', guest.email)}
      ${detailRow('📞', guest.phone)}
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
      <button class="btn btn-outline btn-sm checkout-btn" data-id="${escHtml(guest.id)}" style="margin-top:0.5rem">
        Auschecken
      </button>
    </div>
  </div>
`;

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
};

// ─── TAB: STELLPLÄTZE ─────────────────────────────────────────────────────────

const renderPitchesTab = () => {
  const panel = document.getElementById('tab-pitches');
  const weekStart = mondayOfWeek(state.weekFrom || todayStr());
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
    <div style="margin-top:0.25rem">
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

  const countDots = [
    free     > 0 ? `<span class="zone-count"><span class="status-dot free"></span>${free} frei</span>`       : '',
    reserved > 0 ? `<span class="zone-count"><span class="status-dot reserved"></span>${reserved} res.</span>` : '',
    occupied > 0 ? `<span class="zone-count"><span class="status-dot occupied"></span>${occupied} bel.</span>` : '',
  ].filter(Boolean).join('');

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

  return `
    <div class="pitch-row">
      <span class="status-dot ${escHtml(pitch.status)}"></span>
      <span class="pitch-row-number">Nr. ${escHtml(String(pitch.number))}</span>
      ${guestName
        ? `<span class="pitch-row-guest">${escHtml(guestName)}</span>`
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
      state.selectedWeekDay = newFrom;
      renderPitchesTab();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('week-next')?.addEventListener('click', async () => {
    const newFrom = addDays(state.weekFrom, 7);
    try {
      await loadWeek(newFrom);
      state.selectedWeekDay = newFrom;
      renderPitchesTab();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.querySelectorAll('.week-day').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedWeekDay = btn.dataset.date;
      document.querySelectorAll('.week-day').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
    });
  });

  // Zonen auf-/zuklappen
  if (!state.openZones) state.openZones = new Set();
  document.querySelectorAll('.zone-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const zone = btn.dataset.zone;
      const pitches = btn.nextElementSibling;
      const isOpen = state.openZones.has(zone);
      if (isOpen) {
        state.openZones.delete(zone);
        btn.classList.remove('is-open');
        pitches.classList.add('hidden');
      } else {
        state.openZones.add(zone);
        btn.classList.add('is-open');
        pitches.classList.remove('hidden');
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
        <button class="filter-tab ${state.requestFilter === f.key ? 'is-active' : ''}" data-filter="${f.key}">
          ${escHtml(f.label)} (${counts[f.key]})
        </button>
      `).join('')}
    </div>

    ${filtered.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Keine Anfragen.</p></div>`
      : `<div id="requests-list">${filtered.map(r => renderRequestCard(r)).join('')}</div>`
    }
  `;

  bindRequestEvents();
};

const renderRequestCard = (req) => {
  const statusLabels = { new: 'Neu', confirmed: 'Bestätigt', cancelled: 'Abgelehnt', done: 'Erledigt' };
  const statusBadge = { new: 'new', confirmed: 'confirmed', cancelled: 'cancelled', done: 'paid' };

  const confirmTpl = `wir freuen uns, Ihre Buchungsanfrage bestätigen zu können.\n\nWir erwarten Sie am ${fmtDate(req.arrival)}${req.preferredPitch ? ` auf ${req.preferredPitch}` : ''}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhr Team vom Hiasen Hof am Thiersee`;
  const replyTpl = `vielen Dank für Ihre Anfrage.\n\n\n\nMit freundlichen Grüßen\nIhr Team vom Hiasen Hof am Thiersee`;

  return `
    <div class="card" data-id="${escHtml(req.id)}">
      <button class="card-trigger" data-toggle="${escHtml(req.id)}">
        <div class="card-trigger-main">
          <span class="card-name">${escHtml(req.name)}</span>
          <span class="card-sub">${fmtDate(req.arrival)} – ${fmtDate(req.departure)} · ${escHtml(req.preferredPitch || 'Kein Wunschplatz')}</span>
        </div>
        <div class="card-trigger-end">
          ${badgeHtml(statusLabels[req.status] || req.status, statusBadge[req.status] || 'new')}
          <span class="card-chevron">▼</span>
        </div>
      </button>
      <div class="card-body">
        ${detailRow('📧', req.email)}
        ${detailRow('📞', req.phone)}
        ${detailRow('🚐', req.pitchTypes?.join(', '), 'Fahrzeug')}
        ${detailRow('👥', [req.adults ? `${req.adults} Erw.` : '', req.children ? `${req.children} Kinder` : ''].filter(Boolean).join(', '))}
        ${req.estimatedTotal ? detailRow('💰', req.estimatedTotal, 'Geschätzter Preis') : ''}
        ${req.message ? detailRow('💬', req.message, 'Nachricht') : ''}
        <div class="detail-divider"></div>

        <!-- Antwort-Formular -->
        <div class="reply-form" data-request-id="${escHtml(req.id)}">
          <div class="form-group">
            <label>Antwort</label>
            <textarea class="textarea reply-text" rows="5" data-confirm-tpl="${escHtml(confirmTpl)}" data-reply-tpl="${escHtml(replyTpl)}">${escHtml(replyTpl)}</textarea>
          </div>
          <p class="reply-actions-label">Aktion wählen:</p>
          <div class="btn-row">
            <button class="btn btn-primary reply-send-btn" data-action="confirm" data-id="${escHtml(req.id)}" ${!state.resendConfigured ? 'disabled title="Resend nicht konfiguriert"' : ''}>
              ✅ Bestätigen &amp; senden
            </button>
            <button class="btn btn-outline reply-send-btn" data-action="reply" data-id="${escHtml(req.id)}" ${!state.resendConfigured ? 'disabled title="Resend nicht konfiguriert"' : ''}>
              📨 Antworten
            </button>
          </div>
          <p class="form-status reply-status" style="display:none" data-id="${escHtml(req.id)}"></p>
        </div>
      </div>
    </div>
  `;
};

const bindRequestEvents = () => {
  // Karten auf/zuklappen + Vorlagen einsetzen
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      const wasOpen = card.classList.contains('is-open');
      card.classList.toggle('is-open');
      // Beim Öffnen Standardvorlage setzen
      if (!wasOpen) {
        const textarea = card.querySelector('.reply-text');
        if (textarea) textarea.value = textarea.dataset.replyTpl;
      }
    });
  });

  // Filter-Tabs
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.requestFilter = btn.dataset.filter;
      renderRequestsTab();
    });
  });

  // Antwort senden
  document.querySelectorAll('.reply-send-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const form = btn.closest('.reply-form');
      const textarea = form.querySelector('.reply-text');
      const statusEl = form.querySelector('.reply-status');
      const message = textarea?.value?.trim();

      if (!message) { showToast('Bitte eine Nachricht eingeben', 'error'); return; }

      const req = state.requests.find(r => r.id === id);
      if (!req) return;

      // Beim Bestätigen Vorlage laden falls noch Standard
      if (action === 'confirm' && textarea.value.trim() === textarea.dataset.replyTpl) {
        textarea.value = textarea.dataset.confirmTpl;
        showToast('Bestätigungstext eingesetzt – bitte prüfen und erneut senden', 'info');
        return;
      }

      btn.disabled = true;
      form.querySelectorAll('.reply-send-btn').forEach(b => b.disabled = true);

      try {
        await api(`/api/app/requests/${id}/reply`, {
          method: 'POST',
          body: JSON.stringify({ message, action, requestData: req }),
        });

        if (action === 'confirm') {
          req.status = 'confirmed';
        }

        showToast(action === 'confirm' ? 'Buchung bestätigt & E-Mail gesendet' : 'Antwort gesendet', 'success');
        statusEl.style.display = 'block';
        statusEl.className = 'form-status success reply-status';
        statusEl.textContent = action === 'confirm' ? '✓ Bestätigt & E-Mail versendet' : '✓ Antwort versendet';
      } catch (err) {
        showToast(err.message, 'error');
        statusEl.style.display = 'block';
        statusEl.className = 'form-status error reply-status';
        statusEl.textContent = err.message;
        form.querySelectorAll('.reply-send-btn').forEach(b => b.disabled = false);
      }
    });
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

const bindModalEvents = () => {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
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
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Anmelden';
      setLoading(false);
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('Wirklich abmelden?')) logout();
  });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

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

boot();
