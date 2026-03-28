// ═══════════════════════════════════════════════════════════════════════════
// Hiasen Hof – Google Apps Script
// Erweiterte Version: Enthält alle Funktionen der Camping-Webseite +
// neue Funktionen für die Camping-App (Camping-Sheet).
// Alle bestehenden eventTypes sind UNVERÄNDERT übernommen.
// ═══════════════════════════════════════════════════════════════════════════

const SPREADSHEET_ID = '1r7EpmM4JBXTvac94nl73T98qYjzDH9r26pS2XUfKq3w';
const SHARED_TOKEN = '';

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};

    if (SHARED_TOKEN && String(params.token || '') !== SHARED_TOKEN) {
      return jsonResponse({ ok: false, error: 'Ungültiges Token.' });
    }

    const eventType = String(params.eventType || '');
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

    // ── Bestehende Webseiten-Funktionen (UNVERÄNDERT) ─────────────────────

    if (eventType === 'spots') {
      return jsonResponse({
        ok: true,
        rows: readSpots(spreadsheet, String(params.sheetName || 'Spots')),
      });
    }

    if (eventType === 'inquiries') {
      return jsonResponse({
        ok: true,
        rows: readInquiries(spreadsheet, String(params.sheetName || 'Anfragen')),
      });
    }

    if (eventType === 'settings') {
      return jsonResponse({
        ok: true,
        rows: readSettings(spreadsheet, String(params.sheetName || 'Einstellungen')),
      });
    }

    if (eventType === 'prices') {
      return jsonResponse({
        ok: true,
        rows: readPrices(spreadsheet, String(params.sheetName || 'Preise')),
      });
    }

    // ── Neue Camping-App Funktionen ───────────────────────────────────────

    if (eventType === 'camping') {
      return jsonResponse({
        ok: true,
        rows: readCamping(spreadsheet, String(params.sheetName || 'Camping')),
      });
    }

    return jsonResponse({ ok: false, error: 'Unbekannter eventType.' });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (SHARED_TOKEN && body.token !== SHARED_TOKEN) {
      return jsonResponse({ ok: false, error: 'Ungültiges Token.' });
    }

    const eventType = String(body.eventType || '');
    const payload = body.payload || {};
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

    // ── Bestehende Webseiten-Funktionen (UNVERÄNDERT) ─────────────────────

    if (eventType === 'booking' || eventType === 'contact') {
      appendInquiry(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'spots') {
      replaceSpots(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'appendSpotReservation') {
      appendSpotReservation(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'deleteInquiry') {
      deleteInquiry(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'updateInquiryStatus') {
      updateInquiryStatus(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'saveSettings') {
      saveSettings(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'savePrices') {
      savePrices(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    // ── Neue Camping-App Funktionen ───────────────────────────────────────

    if (eventType === 'appendCamping') {
      appendCamping(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'updateCamping') {
      updateCamping(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    if (eventType === 'deleteCamping') {
      deleteCamping(spreadsheet, payload);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: 'Unbekannter eventType.' });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN (UNVERÄNDERT von Camping-Webseite)
// ═══════════════════════════════════════════════════════════════════════════

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(spreadsheet, sheetName) {
  const existing = spreadsheet.getSheetByName(sheetName);
  return existing || spreadsheet.insertSheet(sheetName);
}

function writeHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const differs = headers.some(function (header, index) {
    return existingHeaders[index] !== header;
  });

  if (differs) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BESTEHENDE FUNKTIONEN (UNVERÄNDERT von Camping-Webseite)
// ═══════════════════════════════════════════════════════════════════════════

function appendInquiry(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Anfragen');
  const row = payload.row || {};
  const headers = [
    'Erstellt am', 'Anfrageart', 'Status', 'Name', 'E-Mail', 'Telefon',
    'Straße', 'PLZ / Ort', 'Land', 'Betreff', 'Anreise', 'Abreise',
    'Wunschstellplatz', 'Wunschstellplatzbereich', 'Wunschstellplatznummer',
    'Platzwahl', 'Erwachsene', 'Kinder', 'Alter der Kinder',
    'Geschätzter Gesamtpreis', 'Nachricht', 'ID',
  ];
  const values = [[
    row.createdAt || '', row.inquiryType || '', row.status || '',
    row.name || '', row.email || '', row.phone || '',
    row.street || '', row.city || '', row.country || '',
    row.subject || '', row.arrival || '', row.departure || '',
    row.preferredPitch || '', row.preferredPitchZone || '', row.preferredPitchNumber || '',
    row.pitchTypes || '', row.adults || '', row.children || '',
    row.childrenAge || '', row.estimatedTotal || '', row.message || '', row.id || '',
  ]];

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  writeHeaders(sheet, headers);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function saveSettings(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Einstellungen');
  const settings = payload.settings || {};
  const headers = ['Schlüssel', 'Wert'];
  const rows = [
    ['bookingRecipientEmail', settings.bookingRecipientEmail || ''],
    ['bookingPhone', settings.bookingPhone || ''],
    ['senderName', settings.senderName || ''],
    ['adminPassword', settings.adminPassword || ''],
  ];

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  sheet.clearContents();
  writeHeaders(sheet, headers);
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function replaceSpots(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Spots');
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const headers = ['Stellplatz', 'Stellplatznummer', 'Status', 'Von', 'Bis'];
  const values = rows.map(function (row) {
    return [row.stellplatz || '', row.stellplatznummer || '', row.status || '', row.von || '', row.bis || ''];
  });

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  sheet.clearContents();
  writeHeaders(sheet, headers);

  if (values.length > 0) {
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function appendSpotReservation(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Spots');
  const row = payload.row || {};
  const headers = ['Stellplatz', 'Stellplatznummer', 'Status', 'Von', 'Bis'];
  const values = [[
    row.stellplatz || '', row.stellplatznummer || '',
    row.status || '', row.von || '', row.bis || '',
  ]];

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  writeHeaders(sheet, headers);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function savePrices(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Preise');
  const prices = Array.isArray(payload.prices) ? payload.prices : [];
  const headers = ['Key', 'Label', 'Amount', 'Category', 'Unit', 'BookingOption', 'SelectionValue'];
  const values = prices.map(function (price) {
    return [
      price.key || '', price.label || '', price.amount || 0,
      price.category || '', price.unit || '',
      price.bookingOption ? 'true' : 'false', price.selectionValue || '',
    ];
  });

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  sheet.clearContents();
  writeHeaders(sheet, headers);

  if (values.length > 0) {
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function deleteInquiry(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Anfragen');
  const id = String(payload.id || '').trim();

  if (!id) throw new Error('Keine Anfrage-ID übergeben.');

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const idIndex = headers.findIndex(function (h) { return String(h || '').trim() === 'ID'; });

  if (idIndex === -1) throw new Error('Spalte ID nicht gefunden.');

  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idIndex] || '').trim() === id) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

function updateInquiryStatus(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Anfragen');
  const id = String(payload.id || '').trim();
  const status = String(payload.status || '').trim();

  if (!id) throw new Error('Keine Anfrage-ID übergeben.');

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) throw new Error('Keine Anfrage gefunden.');

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const idIndex = headers.findIndex(function (h) { return String(h || '').trim() === 'ID'; });
  const statusIndex = headers.findIndex(function (h) { return String(h || '').trim() === 'Status'; });

  if (idIndex === -1 || statusIndex === -1) throw new Error('Spalte ID oder Status nicht gefunden.');

  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idIndex] || '').trim() === id) {
      sheet.getRange(i + 2, statusIndex + 1).setValue(status);
      return;
    }
  }

  throw new Error('Anfrage nicht gefunden.');
}

function readInquiries(spreadsheet, sheetName) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const idx = {};
  headers.forEach(function (h, i) { idx[String(h || '').trim()] = i; });

  return values.map(function (row) {
    return {
      createdAt: row[idx['Erstellt am']] || '',
      inquiryType: row[idx['Anfrageart']] || '',
      status: row[idx['Status']] || '',
      name: row[idx['Name']] || '',
      email: row[idx['E-Mail']] || '',
      phone: row[idx['Telefon']] || '',
      street: row[idx['Straße']] || '',
      city: row[idx['PLZ / Ort']] || '',
      country: row[idx['Land']] || '',
      subject: row[idx['Betreff']] || '',
      arrival: row[idx['Anreise']] || '',
      departure: row[idx['Abreise']] || '',
      preferredPitch: row[idx['Wunschstellplatz']] || '',
      preferredPitchZone: row[idx['Wunschstellplatzbereich']] || '',
      preferredPitchNumber: row[idx['Wunschstellplatznummer']] || '',
      pitchTypes: row[idx['Platzwahl']] || '',
      adults: row[idx['Erwachsene']] || '',
      children: row[idx['Kinder']] || '',
      childrenAge: row[idx['Alter der Kinder']] || '',
      estimatedTotal: row[idx['Geschätzter Gesamtpreis']] || '',
      message: row[idx['Nachricht']] || '',
      id: row[idx['ID']] || '',
    };
  });
}

function readSettings(spreadsheet, sheetName) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 2).getValues().map(function (row) {
    return { key: row[0] || '', value: row[1] || '' };
  });
}

function readSpots(spreadsheet, sheetName) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const idx = {};
  headers.forEach(function (h, i) { idx[String(h || '').trim()] = i; });

  return values.map(function (row) {
    return {
      stellplatz: row[idx['Stellplatz']] || '',
      stellplatznummer: row[idx['Stellplatznummer']] || '',
      status: row[idx['Status']] || '',
      von: row[idx['Von']] || '',
      bis: row[idx['Bis']] || '',
    };
  });
}

function readPrices(spreadsheet, sheetName) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const idx = {};
  headers.forEach(function (h, i) { idx[String(h || '').trim()] = i; });

  return values.map(function (row) {
    return {
      key: row[idx['Key']] || '',
      label: row[idx['Label']] || '',
      amount: row[idx['Amount']] || 0,
      category: row[idx['Category']] || '',
      unit: row[idx['Unit']] || '',
      bookingOption: row[idx['BookingOption']] || '',
      selectionValue: row[idx['SelectionValue']] || '',
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// NEUE FUNKTIONEN – CAMPING-APP (Camping-Sheet)
// Sheet-Spalten:
//   ID | Eingecheckt am | Name | E-Mail | Telefon | Stellplatz |
//   Stellplatznummer | Anreise | Abreise | Platzwahl | Erwachsene |
//   Kinder | Alter der Kinder | Bezahlt | Bemerkungen | Buchungs-ID
// ═══════════════════════════════════════════════════════════════════════════

var CAMPING_HEADERS = [
  'ID', 'Eingecheckt am', 'Name', 'E-Mail', 'Telefon',
  'Stellplatz', 'Stellplatznummer', 'Anreise', 'Abreise',
  'Platzwahl', 'Erwachsene', 'Kinder', 'Alter der Kinder',
  'Bezahlt', 'Bemerkungen', 'Buchungs-ID',
];

function readCamping(spreadsheet, sheetName) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) return [];

  const headers = sheet.getRange(1, 1, 1, Math.max(lastColumn, CAMPING_HEADERS.length)).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, Math.max(lastColumn, 1)).getValues();
  const idx = {};
  headers.forEach(function (h, i) { idx[String(h || '').trim()] = i; });

  return values.map(function (row) {
    return {
      id: String(row[idx['ID']] || '').trim(),
      checkedInAt: String(row[idx['Eingecheckt am']] || '').trim(),
      name: String(row[idx['Name']] || '').trim(),
      email: String(row[idx['E-Mail']] || '').trim(),
      phone: String(row[idx['Telefon']] || '').trim(),
      stellplatz: String(row[idx['Stellplatz']] || '').trim(),
      stellplatznummer: Number(row[idx['Stellplatznummer']] || 0),
      arrival: String(row[idx['Anreise']] || '').trim(),
      departure: String(row[idx['Abreise']] || '').trim(),
      pitchTypes: String(row[idx['Platzwahl']] || '').trim(),
      adults: Number(row[idx['Erwachsene']] || 0),
      children: Number(row[idx['Kinder']] || 0),
      childrenAge: String(row[idx['Alter der Kinder']] || '').trim(),
      paid: String(row[idx['Bezahlt']] || '').trim().toLowerCase() === 'true',
      notes: String(row[idx['Bemerkungen']] || '').trim(),
      bookingId: String(row[idx['Buchungs-ID']] || '').trim(),
    };
  }).filter(function (g) { return g.id && g.name; });
}

function appendCamping(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Camping');
  const row = payload.row || {};

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  writeHeaders(sheet, CAMPING_HEADERS);

  const values = [[
    row.id || '',
    row.checkedInAt || new Date().toISOString(),
    row.name || '',
    row.email || '',
    row.phone || '',
    row.stellplatz || '',
    row.stellplatznummer || '',
    row.arrival || '',
    row.departure || '',
    row.pitchTypes || '',
    row.adults || 0,
    row.children || 0,
    row.childrenAge || '',
    row.paid ? 'true' : 'false',
    row.notes || '',
    row.bookingId || '',
  ]];

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, CAMPING_HEADERS.length).setValues(values);
}

function updateCamping(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Camping');
  const id = String(payload.id || '').trim();
  const updates = payload.updates || {};

  if (!id) throw new Error('Keine Gast-ID übergeben.');

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) throw new Error('Keine Gäste gefunden.');

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const idx = {};
  headers.forEach(function (h, i) { idx[String(h || '').trim()] = i; });

  if (idx['ID'] === undefined) throw new Error('Spalte ID nicht gefunden.');

  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idx['ID']] || '').trim() === id) {
      const rowNum = i + 2;
      if (updates.paid !== undefined && idx['Bezahlt'] !== undefined) {
        sheet.getRange(rowNum, idx['Bezahlt'] + 1).setValue(String(updates.paid));
      }
      if (updates.notes !== undefined && idx['Bemerkungen'] !== undefined) {
        sheet.getRange(rowNum, idx['Bemerkungen'] + 1).setValue(String(updates.notes));
      }
      return;
    }
  }

  throw new Error('Gast nicht gefunden.');
}

function deleteCamping(spreadsheet, payload) {
  const sheetName = String(payload.sheetName || 'Camping');
  const id = String(payload.id || '').trim();

  if (!id) throw new Error('Keine Gast-ID übergeben.');

  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const idIndex = headers.findIndex(function (h) { return String(h || '').trim() === 'ID'; });

  if (idIndex === -1) throw new Error('Spalte ID nicht gefunden.');

  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idIndex] || '').trim() === id) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}
