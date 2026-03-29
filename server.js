'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const PORT = Number(process.env.PORT || 3002);
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-jwt-secret-in-production';
const JWT_EXPIRES_IN = '30d';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@hiasenhof.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM_EMAIL = String(process.env.RESEND_FROM_EMAIL || '').trim();
const RESEND_FROM_NAME = String(process.env.RESEND_FROM_NAME || 'Hiasen Hof').trim();

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const GAS_ENABLED = parseBool(process.env.GOOGLE_APPS_SCRIPT_ENABLED);
const GAS_URL = String(process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL || '').trim();
const GAS_TOKEN = String(process.env.GOOGLE_APPS_SCRIPT_TOKEN || '').trim();
const GAS_CAMPING_SHEET = String(process.env.GAS_CAMPING_SHEET || 'Camping').trim();
const GAS_ANFRAGEN_SHEET = String(process.env.GAS_ANFRAGEN_SHEET || 'Anfragen').trim();
const GAS_SPOTS_SHEET = String(process.env.GAS_SPOTS_SHEET || 'Spots').trim();

if (!process.env.JWT_SECRET) {
  console.warn('WARNUNG: JWT_SECRET nicht gesetzt. Bitte in der .env-Datei setzen.');
}

// ─── Store ────────────────────────────────────────────────────────────────────

let storeCache = null;

const defaultStore = () => ({
  users: [],
  gasGuests: [],     // von GAS gecacht
  gasRequests: [],   // von GAS gecacht
  guests: [],        // lokal hinzugefügt (GAS deaktiviert)
  requests: [],      // lokal hinzugefügt (GAS deaktiviert)
  pitchConfig: null, // Stellplatz-Zonen von GAS (JSON)
  lastGasSync: null, // ISO-Timestamp letzter erfolgreicher GAS-Sync
  settings: {
    bookingRecipientEmail: '',
    cc: '',
    bookingPhone: '+43 664 885 305 24',
    senderName: RESEND_FROM_NAME || 'Hiasen Hof',
  },
});

const loadStore = () => {
  if (storeCache) return storeCache;
  if (!fs.existsSync(STORE_FILE)) {
    const store = defaultStore();
    writeStore(store);
    return store;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    storeCache = { ...defaultStore(), ...parsed, settings: { ...defaultStore().settings, ...(parsed.settings || {}) } };
    return storeCache;
  } catch {
    const store = defaultStore();
    writeStore(store);
    return store;
  }
};

const writeStore = (store) => {
  storeCache = store;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
};

// ─── Default-Stellplätze ──────────────────────────────────────────────────────

const FALLBACK_PITCH_ZONES = [
  { zone: 'wiese1', label: 'Wiese 1', start: 1, end: 12 },
  { zone: 'wiese2', label: 'Wiese 2', start: 1, end: 11 },
  { zone: 'wiese3', label: 'Wiese 3', start: 12, end: 18 },
  { zone: 'see',    label: 'Seeplatz', start: 1, end: 26 },
];

const getPitchZones = () => {
  const store = loadStore();
  if (Array.isArray(store.pitchConfig) && store.pitchConfig.length > 0) return store.pitchConfig;
  return FALLBACK_PITCH_ZONES;
};

const defaultPitches = () => {
  const zones = getPitchZones();
  return zones.flatMap(({ zone, label, start, end }) =>
    Array.from({ length: end - start + 1 }, (_, i) => ({
      id: `${zone}-${start + i}`,
      zone,
      zoneLabel: label,
      number: start + i,
    }))
  );
};

// ─── Hintergrund-GAS-Sync ────────────────────────────────────────────────────

const syncState = { syncing: false, lastSync: null, error: null, lastAttempt: 0 };
const MIN_SYNC_INTERVAL_MS = 45_000; // min. 45 s zwischen zwei Syncs

const runBackgroundGasSync = () => {
  if (syncState.syncing) return;
  if (!GAS_ENABLED || !GAS_URL) return;
  if (Date.now() - syncState.lastAttempt < MIN_SYNC_INTERVAL_MS) return; // Cooldown
  syncState.syncing = true;
  syncState.error = null;
  syncState.lastAttempt = Date.now();

  (async () => {
    try {
      invalidateGasCache('camping', 'inquiries', 'settings');
      const [guestsRaw, requestsRaw] = await Promise.all([
        getGuestsFromGAS(),
        getRequestsFromGAS(),
      ]);
      const store = loadStore();
      if (guestsRaw)   store.gasGuests   = guestsRaw;
      if (requestsRaw) store.gasRequests = requestsRaw;

      // Einstellungen + Stellplatz-Konfiguration aus GAS laden
      try {
        const settingsData = await gasGet('settings', { sheetName: 'Einstellungen' });
        if (Array.isArray(settingsData?.rows)) {
          const findVal = (key) => {
            const row = settingsData.rows.find(r => String(r.key || '').trim() === key);
            return (row && String(row.value || '').trim()) || null;
          };
          const senderName = findVal('senderName');
          const bookingRecipientEmail = findVal('bookingRecipientEmail');
          const cc = findVal('cc');
          const pitchConfigRaw = findVal('pitchConfig');

          if (senderName)             store.settings.senderName = senderName;
          if (bookingRecipientEmail)  store.settings.bookingRecipientEmail = bookingRecipientEmail;
          // cc: expliziter GAS-Wert hat Vorrang; sonst bookingRecipientEmail als Standard
          if (cc !== null)            store.settings.cc = cc;
          else if (bookingRecipientEmail && !store.settings.cc)
            store.settings.cc = bookingRecipientEmail;
          if (pitchConfigRaw) {
            try {
              const parsed = JSON.parse(pitchConfigRaw);
              if (Array.isArray(parsed) && parsed.length > 0) store.pitchConfig = parsed;
            } catch { /* ungültiges JSON */ }
          }
        }
      } catch { /* GAS-Einstellungen optional */ }

      store.lastGasSync = new Date().toISOString();
      writeStore(store);
      syncState.lastSync = store.lastGasSync;
    } catch (err) {
      syncState.error = err.message;
      console.error('Hintergrund-GAS-Sync fehlgeschlagen:', err.message);
    } finally {
      syncState.syncing = false;
    }
  })();
};

// ─── Datums-Hilfsfunktionen ───────────────────────────────────────────────────

const todayString = () => {
  // Use Europe/Vienna timezone to avoid UTC off-by-one after midnight Austrian time
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
};

const normalizeDateOnly = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // ISO format YYYY-MM-DD (most common from GAS)
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  // German format DD.MM.YYYY (GAS may export this)
  const deMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (deMatch) return `${deMatch[3]}-${deMatch[2]}-${deMatch[1]}`;
  // Fallback: let JS parse (e.g. "April 17, 2026")
  const date = new Date(raw);
  if (isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const mondayOfWeek = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const addDaysToDateString = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + Number(days));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDateDisplay = (dateStr) => {
  if (!dateStr) return '-';
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
};

// ─── Stellplatz-Normalisierung ────────────────────────────────────────────────

const normalizePitchZone = (value) => {
  const n = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
  if (n.startsWith('wiese1')) return 'wiese1';
  if (n.startsWith('wiese2')) return 'wiese2';
  if (n.startsWith('wiese3')) return 'wiese3';
  if (n.startsWith('seeplatz') || n.startsWith('see')) return 'see';
  return n;
};

const zoneLabelForZone = (zone) => {
  const map = { wiese1: 'Wiese 1', wiese2: 'Wiese 2', wiese3: 'Wiese 3', see: 'Seeplatz' };
  return map[String(zone || '').trim()] || String(zone || 'Stellplatz');
};

// ─── GAS-Integration ──────────────────────────────────────────────────────────

const gasCache = new Map();

const gasGet = async (eventType, params = {}) => {
  if (!GAS_ENABLED || !GAS_URL) return null;

  const cacheKey = `${eventType}:${JSON.stringify(params)}`;
  const cached = gasCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const url = new URL(GAS_URL);
  url.searchParams.set('eventType', eventType);
  if (GAS_TOKEN) url.searchParams.set('token', GAS_TOKEN);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res;
  try {
    res = await fetch(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `GAS Fehler: ${res.status}`);

  gasCache.set(cacheKey, { data, expiresAt: Date.now() + 60_000 });
  return data;
};

const gasPost = async (eventType, payload) => {
  if (!GAS_ENABLED || !GAS_URL) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: GAS_TOKEN || '', eventType, payload }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `GAS Fehler: ${res.status}`);
};

const invalidateGasCache = (...prefixes) => {
  for (const prefix of prefixes) {
    for (const key of gasCache.keys()) {
      if (key.startsWith(prefix + ':')) gasCache.delete(key);
    }
  }
};

// ─── Daten laden ─────────────────────────────────────────────────────────────

const normalizeInquiryStatus = (status) => {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'confirmed' || s === 'bestätigt') return 'confirmed';
  if (s === 'cancelled' || s === 'abgelehnt' || s === 'abgesagt') return 'cancelled';
  if (s === 'done' || s === 'erledigt') return 'done';
  return 'new';
};

const normalizeInquiryType = (value) => {
  const n = String(value || '').trim().toLowerCase();
  // Nur explizit als Kontakt markierte Anfragen → 'contact'; alles andere → 'booking'
  if (n === 'contact' || n === 'kontakt') return 'contact';
  return 'booking';
};

const getGuestsFromGAS = async () => {
  try {
    const data = await gasGet('camping', { sheetName: GAS_CAMPING_SHEET });
    if (!Array.isArray(data?.rows)) return null;
    return data.rows.map(row => ({
      id: String(row.id || '').trim(),
      checkedInAt: String(row.checkedInAt || '').trim(),
      name: String(row.name || '').trim(),
      email: String(row.email || '').trim(),
      phone: String(row.phone || '').trim(),
      stellplatz: String(row.stellplatz || '').trim(),
      stellplatznummer: Number(row.stellplatznummer || 0),
      arrival: normalizeDateOnly(row.arrival || ''),
      departure: normalizeDateOnly(row.departure || ''),
      pitchTypes: String(row.pitchTypes || '').trim(),
      adults: Number(row.adults || 0),
      children: Number(row.children || 0),
      childrenAge: String(row.childrenAge || '').trim(),
      paid: parseBool(row.paid),
      notes: String(row.notes || '').trim(),
      bookingId: String(row.bookingId || '').trim(),
    })).filter(g => g.id && g.name);
  } catch (err) {
    console.error('Gäste konnten nicht geladen werden:', err.message);
    return null;
  }
};

const getRequestsFromGAS = async () => {
  try {
    const data = await gasGet('inquiries', { sheetName: GAS_ANFRAGEN_SHEET });
    if (!Array.isArray(data?.rows)) return null;
    return data.rows.map(row => ({
      id: String(row.id || '').trim(),
      type: normalizeInquiryType(row.inquiryType),
      status: normalizeInquiryStatus(row.status),
      createdAt: normalizeDateOnly(row.createdAt || '') || String(row.createdAt || '').trim(),
      name: String(row.name || '').trim(),
      email: String(row.email || '').trim(),
      phone: String(row.phone || '').trim(),
      street: String(row.street || '').trim(),
      city: String(row.city || '').trim(),
      country: String(row.country || '').trim(),
      arrival: normalizeDateOnly(row.arrival || ''),
      departure: normalizeDateOnly(row.departure || ''),
      preferredPitch: String(row.preferredPitch || '').trim(),
      preferredPitchZone: String(row.preferredPitchZone || '').trim(),
      preferredPitchNumber: Number(row.preferredPitchNumber || 0),
      pitchTypes: Array.isArray(row.pitchTypes)
        ? row.pitchTypes
        : String(row.pitchTypes || '').split(',').map(s => s.trim()).filter(Boolean),
      adults: Number(row.adults || 0),
      children: Number(row.children || 0),
      childrenAge: String(row.childrenAge || '').trim(),
      estimatedTotal: String(row.estimatedTotal || '').trim(),
      message: String(row.message || '').trim(),
    })).filter(r => r.id && r.name);
  } catch (err) {
    console.error('Anfragen konnten nicht geladen werden:', err.message);
    return null;
  }
};

// ─── Stellplätze berechnen ────────────────────────────────────────────────────

const computePitches = (guests, requests, refDate) => {
  const pitches = defaultPitches();

  const occupiedMap = new Map();
  for (const g of guests) {
    if (!g.stellplatz || !g.stellplatznummer) continue;
    const arrival = normalizeDateOnly(g.arrival);
    const departure = normalizeDateOnly(g.departure);
    if (!arrival || !departure) continue;
    if (arrival <= refDate && departure > refDate) {
      const key = `${normalizePitchZone(g.stellplatz)}:${g.stellplatznummer}`;
      occupiedMap.set(key, g);
    }
  }

  // Build future bookings per pitch (all confirmed with arrival > refDate), sorted by arrival
  const futureMap = new Map();
  for (const r of requests) {
    if (r.status !== 'confirmed' || !r.preferredPitchZone || !r.preferredPitchNumber) continue;
    const arrival = normalizeDateOnly(r.arrival);
    if (!arrival || arrival < refDate) continue;
    const key = `${normalizePitchZone(r.preferredPitchZone)}:${r.preferredPitchNumber}`;
    if (!futureMap.has(key)) futureMap.set(key, []);
    futureMap.get(key).push(r);
  }
  for (const list of futureMap.values()) {
    list.sort((a, b) => normalizeDateOnly(a.arrival).localeCompare(normalizeDateOnly(b.arrival)));
  }

  return pitches.map(pitch => {
    const key = `${pitch.zone}:${pitch.number}`;
    const futureList = futureMap.get(key) || [];
    const nextBooking = futureList[0] || null;
    if (occupiedMap.has(key)) {
      // Eingecheckt → Belegt
      return { ...pitch, status: 'occupied', currentGuest: occupiedMap.get(key), nextBooking };
    } else if (nextBooking && normalizeDateOnly(nextBooking.arrival) === refDate) {
      // Anreisetag, noch nicht eingecheckt → Reserviert
      return { ...pitch, status: 'reserved', currentGuest: null, nextBooking };
    } else {
      // Anreise in der Zukunft oder keine Buchung → Frei (nextBooking für "Frei bis"-Anzeige)
      return { ...pitch, status: 'free', currentGuest: null, nextBooking };
    }
  });
};

const computeWeekData = (guests, requests, fromDate) => {
  const totalPitches = defaultPitches().length;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dateStr = addDaysToDateString(fromDate, i);
    const date = new Date(`${dateStr}T00:00:00`);
    const dayName = date.toLocaleDateString('de-AT', { weekday: 'short' });
    const dayDate = date.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });

    const presentGuests = guests.filter(g =>
      g.arrival && g.departure && g.arrival <= dateStr && g.departure > dateStr
    );
    const arrivingBookings = requests.filter(r =>
      r.status === 'confirmed' && r.arrival === dateStr
    );

    days.push({
      date: dateStr,
      dayName,
      dayDate,
      occupied: presentGuests.length,
      free: Math.max(0, totalPitches - presentGuests.length),
      arriving: arrivingBookings.length,
    });
  }
  return days;
};

// ─── E-Mail via Resend ────────────────────────────────────────────────────────

const isResendConfigured = () => Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL);

const sendResendEmail = async ({ to, subject, text }) => {
  if (!isResendConfigured()) throw new Error('E-Mail-Versand ist nicht konfiguriert (RESEND_API_KEY / RESEND_FROM_EMAIL fehlt).');

  const store = loadStore();
  const senderName = store.settings.senderName || RESEND_FROM_NAME || 'Hiasen Hof';
  const ccEmail = String(store.settings.cc || '').trim();

  const body = {
    from: `${senderName} <${RESEND_FROM_EMAIL}>`,
    to: [String(to || '').trim()],
    subject,
    text,
  };
  if (ccEmail) body.cc = [ccEmail];

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.message || result.error || 'E-Mail-Versand fehlgeschlagen.');
  return true;
};

const buildEmailBody = (request, message) => [
  `Guten Tag ${request.name},`,
  '',
  message,
  '',
  '─────────────────────────────────',
  `Buchungsanfrage vom ${formatDateDisplay(String(request.createdAt || '').slice(0, 10))}`,
  `Anreise: ${formatDateDisplay(request.arrival)}`,
  `Abreise: ${formatDateDisplay(request.departure)}`,
  `Wunschstellplatz: ${request.preferredPitch || '-'}`,
].join('\n');

// ─── Auth ─────────────────────────────────────────────────────────────────────

const generateToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const verifyToken = (token) => {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
};

const ensureAdminUser = async () => {
  const store = loadStore();
  if (store.users.length > 0) return;
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  store.users = [{ id: crypto.randomUUID(), email: ADMIN_EMAIL, passwordHash: hash, role: 'admin', createdAt: new Date().toISOString() }];
  writeStore(store);
  console.log(`Admin-Benutzer angelegt: ${ADMIN_EMAIL}`);
};

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const requireAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht authentifiziert.' });
  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu anmelden.' });
  req.user = payload;
  next();
};

// ─── Auth-Routen ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich.' });

    const store = loadStore();
    const user = store.users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
    if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login-Fehler:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/auth/session', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.json({ user: null });
  const payload = verifyToken(auth.slice(7));
  res.json({ user: payload || null });
});

app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

// ─── App-Routen ───────────────────────────────────────────────────────────────

app.get('/api/app/bootstrap', requireAuth, async (req, res) => {
  try {
    const store = loadStore();

    // Beim ersten Start (noch kein Sync-Cache) → einmalig synchron laden
    if (GAS_ENABLED && GAS_URL && !store.lastGasSync) {
      await new Promise(resolve => {
        runBackgroundGasSync();
        // Kurz warten bis Sync fertig (max. 10 s)
        const start = Date.now();
        const wait = setInterval(() => {
          if (!syncState.syncing || Date.now() - start > 10_000) {
            clearInterval(wait);
            storeCache = null; // Store-Cache ungültig machen
            resolve();
          }
        }, 100);
      });
    }

    const fresh  = loadStore();
    const guests   = [...(fresh.gasGuests || []), ...(fresh.guests || [])];
    const requests = [...(fresh.gasRequests || []), ...(fresh.requests || [])].filter(r => r.type !== 'contact');
    const today    = todayString();
    const pitches  = computePitches(guests, requests, today);
    const weekData = computeWeekData(guests, requests, today);

    // GAS-Sync synchron anstoßen – setzt syncState.syncing = true intern (wenn kein Cooldown/laufender Sync)
    if (GAS_ENABLED && GAS_URL) runBackgroundGasSync();

    res.json({
      guests, requests, pitches, weekData,
      weekFrom: today,
      today,           // Server-seitiges "heute" (Vienna-Timezone) für Client
      settings: fresh.settings,
      gasEnabled: GAS_ENABLED && Boolean(GAS_URL),
      resendConfigured: isResendConfigured(),
      sync: {
        syncing:  syncState.syncing, // korrekter Wert nach runBackgroundGasSync()
        lastSync: fresh.lastGasSync,
        error:    syncState.error,
      },
    });
  } catch (err) {
    console.error('Bootstrap-Fehler:', err);
    res.status(500).json({ error: 'Daten konnten nicht geladen werden.' });
  }
});

app.get('/api/app/sync-status', requireAuth, (_req, res) => {
  const store = loadStore();
  res.json({ syncing: syncState.syncing, lastSync: store.lastGasSync, error: syncState.error });
});

app.get('/api/app/pitches', requireAuth, (req, res) => {
  try {
    const refDate = normalizeDateOnly(req.query.date) || todayString();
    const store   = loadStore();
    const guests   = [...(store.gasGuests || []), ...(store.guests || [])];
    const requests = [...(store.gasRequests || []), ...(store.requests || [])].filter(r => r.type !== 'contact');
    res.json({
      pitches: computePitches(guests, requests, refDate),
      sync: { syncing: syncState.syncing, lastSync: store.lastGasSync },
    });
  } catch (err) {
    res.status(500).json({ error: 'Stellplatzdaten konnten nicht geladen werden.' });
  }
});

app.get('/api/app/week', requireAuth, (req, res) => {
  try {
    const fromDate = normalizeDateOnly(req.query.from) || todayString();
    const store    = loadStore();
    const guests   = [...(store.gasGuests || []), ...(store.guests || [])];
    const requests = [...(store.gasRequests || []), ...(store.requests || [])].filter(r => r.type !== 'contact');
    res.json({ weekData: computeWeekData(guests, requests, fromDate), weekFrom: fromDate });
  } catch (err) {
    res.status(500).json({ error: 'Wochendaten konnten nicht geladen werden.' });
  }
});

// Gast einchecken (aus Buchung ODER manuell)
app.post('/api/app/guests', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const guest = {
      id: crypto.randomUUID(),
      checkedInAt: new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      name: String(body.name || '').trim(),
      email: String(body.email || '').trim(),
      phone: String(body.phone || '').trim(),
      stellplatz: String(body.stellplatz || '').trim(),
      stellplatznummer: Number(body.stellplatznummer || 0),
      arrival: normalizeDateOnly(body.arrival) || todayString(),
      departure: normalizeDateOnly(body.departure) || '',
      pitchTypes: String(body.pitchTypes || '').trim(),
      adults: Number(body.adults || 0),
      children: Number(body.children || 0),
      childrenAge: String(body.childrenAge || '').trim(),
      paid: parseBool(body.paid),
      notes: String(body.notes || '').trim(),
      bookingId: String(body.bookingId || '').trim(),
    };

    if (!guest.name) return res.status(400).json({ error: 'Name ist erforderlich.' });
    if (!guest.stellplatz || !guest.stellplatznummer) return res.status(400).json({ error: 'Stellplatz ist erforderlich.' });

    if (GAS_ENABLED && GAS_URL) {
      await gasPost('appendCamping', { sheetName: GAS_CAMPING_SHEET, row: guest });
      await gasPost('appendSpotReservation', {
        sheetName: GAS_SPOTS_SHEET,
        row: {
          stellplatz: zoneLabelForZone(normalizePitchZone(guest.stellplatz)),
          stellplatznummer: guest.stellplatznummer,
          status: '2',
          von: guest.arrival,
          bis: guest.departure,
        },
      });
      invalidateGasCache('camping', 'spots');
    } else {
      const store = loadStore();
      store.guests = [...(store.guests || []), guest];
      writeStore(store);
    }

    res.status(201).json({ guest });
  } catch (err) {
    console.error('Check-in Fehler:', err);
    res.status(500).json({ error: err.message || 'Fehler beim Einchecken.' });
  }
});

// Gast aktualisieren (Bezahlt-Status, Bemerkungen) – optimistisch
app.patch('/api/app/guests/:id', requireAuth, (req, res) => {
  try {
    const { id }  = req.params;
    const updates = req.body || {};
    const store   = loadStore();

    // 1. Sofort im lokalen Cache aktualisieren
    const gasIdx   = (store.gasGuests || []).findIndex(g => g.id === id);
    const localIdx = (store.guests    || []).findIndex(g => g.id === id);
    if (gasIdx === -1 && localIdx === -1) return res.status(404).json({ error: 'Gast nicht gefunden.' });
    if (gasIdx !== -1) {
      store.gasGuests[gasIdx] = { ...store.gasGuests[gasIdx], ...updates };
    } else {
      store.guests[localIdx] = { ...store.guests[localIdx], ...updates };
    }
    writeStore(store);

    // 2. Sofort antworten
    res.json({ ok: true });

    // 3. Im Hintergrund zu GAS syncen
    if (GAS_ENABLED && GAS_URL) {
      setImmediate(async () => {
        try {
          await gasPost('updateCamping', {
            sheetName: GAS_CAMPING_SHEET, id,
            updates: {
              ...(updates.paid  !== undefined && { paid:  String(Boolean(updates.paid)) }),
              ...(updates.notes !== undefined && { notes: String(updates.notes) }),
            },
          });
          invalidateGasCache('camping');
        } catch (err) {
          console.error('Hintergrund-Update (Gast) fehlgeschlagen:', err.message);
        }
      });
    }
  } catch (err) {
    console.error('Gast-Update Fehler:', err);
    res.status(500).json({ error: err.message || 'Fehler beim Aktualisieren.' });
  }
});

// Gast auschecken – optimistisch
app.delete('/api/app/guests/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const store  = loadStore();

    // 1. Sofort aus Cache entfernen
    store.gasGuests = (store.gasGuests || []).filter(g => g.id !== id);
    store.guests    = (store.guests    || []).filter(g => g.id !== id);
    writeStore(store);

    // 2. Sofort antworten
    res.json({ ok: true });

    // 3. Im Hintergrund zu GAS syncen
    if (GAS_ENABLED && GAS_URL) {
      setImmediate(async () => {
        try {
          await gasPost('deleteCamping', { sheetName: GAS_CAMPING_SHEET, id });
          invalidateGasCache('camping', 'spots');
        } catch (err) {
          console.error('Hintergrund-Delete (Gast) fehlgeschlagen:', err.message);
        }
      });
    }
  } catch (err) {
    console.error('Check-out Fehler:', err);
    res.status(500).json({ error: err.message || 'Fehler beim Auschecken.' });
  }
});

// Anfrage-Status setzen – optimistisch
app.patch('/api/app/requests/:id/status', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const valid = ['new', 'confirmed', 'cancelled', 'done'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });

    // 1. Sofort im Cache aktualisieren
    const store = loadStore();
    const gasIdx = (store.gasRequests || []).findIndex(r => r.id === id);
    if (gasIdx !== -1) store.gasRequests[gasIdx] = { ...store.gasRequests[gasIdx], status };
    const localIdx = (store.requests || []).findIndex(r => r.id === id);
    if (localIdx !== -1) store.requests[localIdx] = { ...store.requests[localIdx], status };
    writeStore(store);

    // 2. Sofort antworten
    res.json({ ok: true });

    // 3. Im Hintergrund zu GAS syncen
    if (GAS_ENABLED && GAS_URL) {
      setImmediate(async () => {
        try {
          await gasPost('updateInquiryStatus', { sheetName: GAS_ANFRAGEN_SHEET, id, status });
          invalidateGasCache('inquiries');
        } catch (err) {
          console.error('Hintergrund-Update (Anfrage-Status) fehlgeschlagen:', err.message);
        }
      });
    }
  } catch (err) {
    console.error('Status-Update Fehler:', err);
    res.status(500).json({ error: err.message || 'Fehler beim Status-Update.' });
  }
});

// Anfrage beantworten (+ optional bestätigen)
app.post('/api/app/requests/:id/reply', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { message, action, requestData } = req.body || {};

    if (!String(message || '').trim()) return res.status(400).json({ error: 'Nachricht darf nicht leer sein.' });
    if (!requestData?.email) return res.status(400).json({ error: 'Keine E-Mail-Adresse vorhanden.' });

    const subject = action === 'confirm'
      ? 'Buchungsbestätigung – Hiasen Hof am Thiersee'
      : action === 'cancel'
        ? 'Absage Ihrer Buchungsanfrage – Hiasen Hof am Thiersee'
        : 'Antwort auf Ihre Buchungsanfrage – Hiasen Hof am Thiersee';

    await sendResendEmail({ to: requestData.email, subject, text: buildEmailBody(requestData, message) });

    if (action === 'confirm' || action === 'cancel') {
      const newStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
      if (GAS_ENABLED && GAS_URL) {
        await gasPost('updateInquiryStatus', { sheetName: GAS_ANFRAGEN_SHEET, id, status: newStatus });
        invalidateGasCache('inquiries');
      }
      const store = loadStore();
      const gasIdx2 = (store.gasRequests || []).findIndex(r => r.id === id);
      if (gasIdx2 >= 0) store.gasRequests[gasIdx2] = { ...store.gasRequests[gasIdx2], status: newStatus };
      const localIdx2 = (store.requests || []).findIndex(r => r.id === id);
      if (localIdx2 >= 0) store.requests[localIdx2] = { ...store.requests[localIdx2], status: newStatus };
      writeStore(store);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Antwort-Fehler:', err);
    res.status(500).json({ error: err.message || 'E-Mail konnte nicht gesendet werden.' });
  }
});

// Einstellungen speichern + zu GAS syncen
app.patch('/api/app/settings', requireAuth, async (req, res) => {
  try {
    const { senderName, bookingRecipientEmail, bookingPhone, cc } = req.body || {};
    const store = loadStore();
    const gasUpdates = []; // { key, value } für GAS-Sync
    if (senderName !== undefined) {
      store.settings.senderName = String(senderName).trim();
      gasUpdates.push({ key: 'senderName', value: store.settings.senderName });
    }
    if (bookingRecipientEmail !== undefined) {
      store.settings.bookingRecipientEmail = String(bookingRecipientEmail).trim();
      gasUpdates.push({ key: 'bookingRecipientEmail', value: store.settings.bookingRecipientEmail });
    }
    if (cc !== undefined) {
      store.settings.cc = String(cc).trim();
      gasUpdates.push({ key: 'cc', value: store.settings.cc });
    }
    if (bookingPhone !== undefined) store.settings.bookingPhone = String(bookingPhone).trim();
    writeStore(store);
    storeCache = null;
    res.json({ ok: true, settings: store.settings });

    // Geänderte Werte im Hintergrund zu GAS syncen
    if (GAS_ENABLED && GAS_URL && gasUpdates.length > 0) {
      setImmediate(async () => {
        for (const { key, value } of gasUpdates) {
          try {
            await gasPost('updateSetting', { sheetName: 'Einstellungen', key, value });
            invalidateGasCache('settings');
          } catch (err) {
            console.error(`GAS-Setting-Update (${key}) fehlgeschlagen:`, err.message);
          }
        }
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Fehler beim Speichern.' });
  }
});

// Passwort ändern
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Alle Felder erforderlich.' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen lang sein.' });
    const store = loadStore();
    const user = (store.users || []).find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Aktuelles Passwort falsch.' });
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    writeStore(store);
    storeCache = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Fehler beim Passwort ändern.' });
  }
});

// Anfrage löschen
app.delete('/api/app/requests/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (GAS_ENABLED && GAS_URL) {
      await gasPost('deleteInquiry', { sheetName: GAS_ANFRAGEN_SHEET, id }).catch(() => {});
      invalidateGasCache('inquiries');
    }
    const store = loadStore();
    store.gasRequests = (store.gasRequests || []).filter(r => r.id !== id);
    store.requests    = (store.requests    || []).filter(r => r.id !== id);
    writeStore(store);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Fehler beim Löschen.' });
  }
});

// Statische Dateien + SPA-Fallback
app.use(express.static(ROOT_DIR, { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));

// ─── Health check (Cloud Run) ─────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── Start ────────────────────────────────────────────────────────────────────

const start = async () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  await ensureAdminUser();

  app.listen(PORT, () => {
    console.log(`✓ Camping App läuft auf http://localhost:${PORT}`);
    if (!GAS_ENABLED || !GAS_URL) {
      console.log('  Hinweis: GAS nicht konfiguriert – lokaler Modus aktiv.');
    }
    if (!isResendConfigured()) {
      console.log('  Hinweis: Resend nicht konfiguriert – E-Mail-Versand deaktiviert.');
    }
  });
};

start().catch(err => { console.error('Startfehler:', err); process.exit(1); });
