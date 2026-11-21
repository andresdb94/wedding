/**
 * Backend RSVP: gli invitati cercano il proprio invito in un elenco (un altro Google Sheet),
 * rispondono dal sito e le risposte finiscono in questo foglio.
 * Se l'invitato lascia l'email, riceve un riepilogo.
 *
 * Istruzioni di installazione: vedi README.md in questa cartella.
 */

// ---------- Configurazione ----------

// Elenco invitati: foglio con le colonne "Invitati | N. persone | N. Bambini 3-10 anni | N. Bambini 0-3 anni"
const GUEST_SHEET_ID = '1U4gk0Pq-KW2Nqp1yp0Tyeq3wDu3eGVRJqdkagHIY150';
const GUEST_SHEET_NAME = ''; // vuoto = primo foglio del file

// Email che riceve una notifica a ogni risposta. Lascia vuoto per non riceverla.
const NOTIFY_EMAIL = '';

const SENDER_NAME = 'Alessia & Andrea';
const EVENT_LINE = '15 maggio 2027 · Chiesa del Beato Ildefonso Schuster, Garbagnate Milanese (ore 11:00) · Villa Acquaroli, Carvico (ore 14:00 circa)';
const EVENT_LINE_CAKE = '15 maggio 2027 · Taglio della torta alle ore 18:00 · Villa Acquaroli, Carvico';

// Nell'elenco invitati, le righe dopo quella che contiene questo testo sono invitati
// che non sono a pranzo: confermano solo la presenza al taglio della torta.
const CAKE_MARKER = 'solo al taglio della torta';

const LUNCH = 'Pranzo';
const CAKE = 'Solo torta';

const ADULT = 'Adulto';
const CHILD = 'Bambino 3-10';
const BABY = 'Bambino 0-3';
const BANDS = [ADULT, CHILD, BABY];

const MAX_RESULTS = 8;
const GUEST_CACHE_KEY = 'guests_v2';
const GUEST_CACHE_SECONDS = 300;

const SHEET_ANSWERS = 'Risposte';
const SHEET_SUMMARY = 'Riepilogo';
const SHEET_PENDING = 'Da rispondere';
const YES = 'Sì';
const NO = 'No';
const VALID = 'Sì';
const REPLACED = 'No (sostituita)';

// Colonne del foglio Risposte (1-based)
const HEADERS = [
  'Data', 'ID invio', 'Invito', 'Tipo', 'Telefono', 'Email',
  'Nome', 'Partecipa', 'Fascia', 'Allergie', 'Note', 'Valida',
];
const COL_NUCLEUS = 3, COL_VALID = 12;

// ---------- Menu nel foglio ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('RSVP')
    .addItem('Controlla elenco invitati', 'controllaElenco')
    .addItem('Aggiorna "Da rispondere"', 'aggiornaDaRispondere')
    .addToUi();
}

// ---------- Setup (da eseguire una volta) ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let answers = ss.getSheetByName(SHEET_ANSWERS);
  if (!answers) answers = ss.insertSheet(SHEET_ANSWERS);
  answers.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  answers.setFrozenRows(1);
  answers.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm');
  // Testo semplice: evita che "+39..." o "=..." vengano interpretati come formule
  answers.getRange(1, 2, answers.getMaxRows(), HEADERS.length - 1).setNumberFormat('@');
  if (!answers.getFilter()) answers.getRange(1, 1, answers.getMaxRows(), HEADERS.length).createFilter();

  let summary = ss.getSheetByName(SHEET_SUMMARY);
  if (!summary) summary = ss.insertSheet(SHEET_SUMMARY);
  summary.clear();

  // Colonne di Risposte: D Tipo, H Partecipa, I Fascia, J Allergie, L Valida
  const count = (tipo, partecipa, extra) =>
    '=COUNTIFS(' + SHEET_ANSWERS + '!$D:$D,"' + tipo + '",' + SHEET_ANSWERS + '!$H:$H,"' + partecipa + '",' +
    SHEET_ANSWERS + '!$L:$L,"' + VALID + '"' + (extra || '') + ')';

  const rows = [];
  const headingRows = [];
  const heading = (t) => { rows.push([t, '']); headingRows.push(rows.length); };

  rows.push(['Riepilogo (conta solo l\'ultima risposta valida di ogni invito)', '']);
  rows.push(['', '']);
  heading('PRANZO');
  rows.push(['Persone che vengono a pranzo', count(LUNCH, YES)]);
  rows.push(['Persone che non vengono', count(LUNCH, NO)]);
  rows.push(['', '']);
  heading('PER FASCIA (pranzo, solo chi viene)');
  BANDS.forEach((b) => rows.push([b, count(LUNCH, YES, ',' + SHEET_ANSWERS + '!$I:$I,"' + b + '"')]));
  rows.push(['', '']);
  heading('ALLERGIE E INTOLLERANZE (pranzo, solo chi viene)');
  rows.push(['Persone con allergie o intolleranze', count(LUNCH, YES, ',' + SHEET_ANSWERS + '!$J:$J,"?*"')]);
  rows.push(['', '']);
  heading('SOLO TAGLIO DELLA TORTA');
  rows.push(['Persone che vengono', count(CAKE, YES)]);
  rows.push(['Persone che non vengono', count(CAKE, NO)]);
  rows.push(['', '']);
  rows.push(['Per le allergie: nel foglio "' + SHEET_ANSWERS + '" filtra la colonna "Allergie" e la colonna "Valida" = Sì.', '']);
  rows.push(['Per sapere chi non ha ancora risposto: menu RSVP → Aggiorna "Da rispondere".', '']);

  summary.getRange(1, 1, rows.length, 2).setValues(rows);
  summary.getRange('A1').setFontWeight('bold').setFontSize(12);
  headingRows.forEach((r) => summary.getRange(r, 1).setFontWeight('bold'));
  summary.setColumnWidth(1, 330);

  SpreadsheetApp.flush();
}

// ---------- Elenco invitati ----------

function normalize_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function str_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Assegna la fascia a ogni nome. I nomi sono in ordine di età: prima gli adulti,
 * poi i bambini 3-10, poi gli 0-3. "N. persone" indica gli adulti; se invece
 * contiene il totale, gli adulti si ricavano per differenza.
 */
function bandsFor_(count, persone, k310, k03) {
  let adults;
  if (persone + k310 + k03 === count) adults = persone;
  else if (persone === count) adults = persone - k310 - k03;
  else return null;
  if (adults < 0) return null;

  const bands = [];
  for (let i = 0; i < adults; i++) bands.push(ADULT);
  for (let i = 0; i < k310; i++) bands.push(CHILD);
  for (let i = 0; i < k03; i++) bands.push(BABY);
  return bands;
}

function readGuests_() {
  const ss = SpreadsheetApp.openById(GUEST_SHEET_ID);
  const sh = GUEST_SHEET_NAME ? ss.getSheetByName(GUEST_SHEET_NAME) : ss.getSheets()[0];
  if (!sh) throw new Error('Foglio invitati non trovato');

  const guests = [];
  const problems = [];
  const seen = {};
  const last = sh.getLastRow();
  if (last < 2) return { guests: guests, problems: problems };

  const vals = sh.getRange(2, 1, last - 1, 4).getValues();
  let cakeOnly = false;
  vals.forEach((r, i) => {
    const label = str_(r[0], 300);
    if (!label) return;
    const line = i + 2;

    // Riga separatrice: da qui in poi gli invitati sono solo al taglio della torta
    if (normalize_(label).indexOf(CAKE_MARKER) >= 0) {
      cakeOnly = true;
      return;
    }

    const names = label.split(/\s*,\s*|\s+e\s+|\s+&\s+/i).map((s) => s.trim()).filter(Boolean);
    const bands = bandsFor_(names.length, Number(r[1]) || 0, Number(r[2]) || 0, Number(r[3]) || 0);
    if (!bands) {
      problems.push('Riga ' + line + ' "' + label + '": ' + names.length + ' nomi, ma i numeri delle colonne B, C, D non quadrano.');
      return;
    }
    if (seen[label]) {
      problems.push('Riga ' + line + ' "' + label + '": invito duplicato (viene usata solo la prima riga).');
      return;
    }
    seen[label] = true;
    guests.push({
      id: label,
      search: normalize_(label),
      cakeOnly: cakeOnly,
      people: names.map((n, k) => ({ name: n, band: bands[k] })),
    });
  });

  return { guests: guests, problems: problems };
}

function loadGuests_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(GUEST_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const guests = readGuests_().guests;
  try {
    cache.put(GUEST_CACHE_KEY, JSON.stringify(guests), GUEST_CACHE_SECONDS);
  } catch (err) {
    console.warn('Cache non disponibile', err);
  }
  return guests;
}

// Inviti che hanno già una risposta valida: { "Carlo, Ilva...": true }
function answeredSet_() {
  const set = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  if (!sh || sh.getLastRow() < 2) return set;
  const vals = sh.getRange(2, COL_NUCLEUS, sh.getLastRow() - 1, COL_VALID - COL_NUCLEUS + 1).getValues();
  vals.forEach((r) => {
    if (r[COL_VALID - COL_NUCLEUS] === VALID) set[r[0]] = true;
  });
  return set;
}

function search_(q) {
  const tokens = normalize_(q).split(' ').filter(Boolean);
  if (tokens.join('').length < 3) return [];

  const answered = answeredSet_();
  const out = [];
  const guests = loadGuests_();
  for (let i = 0; i < guests.length && out.length < MAX_RESULTS; i++) {
    const g = guests[i];
    if (tokens.every((t) => g.search.indexOf(t) >= 0)) {
      out.push({ id: g.id, people: g.people, cakeOnly: g.cakeOnly, answered: answered[g.id] === true });
    }
  }
  return out;
}

// Da lanciare dal menu RSVP dopo aver modificato l'elenco invitati
function controllaElenco() {
  const r = readGuests_();
  const count = (list) => list.reduce((n, g) => n + g.people.length, 0);
  const lunch = r.guests.filter((g) => !g.cakeOnly);
  const cake = r.guests.filter((g) => g.cakeOnly);
  const msg =
    'Pranzo: ' + lunch.length + ' inviti, ' + count(lunch) + ' persone.\n' +
    'Solo taglio della torta: ' + cake.length + ' inviti, ' + count(cake) + ' persone.' +
    (r.problems.length ? '\n\nDa correggere:\n' + r.problems.join('\n') : '\n\nTutto in ordine.');
  CacheService.getScriptCache().remove(GUEST_CACHE_KEY);
  try {
    SpreadsheetApp.getUi().alert('Elenco invitati', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log(msg); // esecuzione dall'editor senza interfaccia
  }
}

// Scrive nel foglio "Da rispondere" gli inviti senza una risposta valida
function aggiornaDaRispondere() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_PENDING);
  if (!sh) sh = ss.insertSheet(SHEET_PENDING);
  sh.clear();

  const answered = answeredSet_();
  const pending = readGuests_().guests.filter((g) => !answered[g.id]);
  sh.getRange(1, 1, 1, 3).setValues([['Invito', 'Persone', 'Tipo']]).setFontWeight('bold');
  if (pending.length) {
    sh.getRange(2, 1, pending.length, 3).setValues(
      pending.map((g) => [g.id, g.people.length, g.cakeOnly ? CAKE : LUNCH])
    );
  }
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 400);
  const total = pending.reduce((n, g) => n + g.people.length, 0);
  sh.getRange(1, 5).setValue('Inviti da rispondere: ' + pending.length + ' (' + total + ' persone)');
}

// ---------- Endpoint ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'search') return json_({ ok: true, results: search_(p.q || '') });
    // Utile per verificare che la Web App sia attiva aprendo l'URL nel browser
    return json_({ ok: true, service: 'rsvp' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Errore nella ricerca' });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // Honeypot: i bot compilano il campo nascosto. Fingiamo che sia andata bene.
    if (data.website) return json_({ ok: true });

    const clean = validate_(data);
    save_(clean);

    let emailSent = false;
    if (clean.email) emailSent = sendConfirmation_(clean);
    if (NOTIFY_EMAIL) notifyOwner_(clean);

    return json_({ ok: true, emailSent: emailSent });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Validazione ----------

function validate_(d) {
  const nucleus = str_(d.nucleus, 300);
  const guest = loadGuests_().filter((g) => g.id === nucleus)[0];
  if (!guest) throw new Error('Invito non trovato');

  const phone = str_(d.phone, 30);
  const email = str_(d.email, 120);
  const notes = str_(d.notes, 500);

  if (phone && phone.replace(/\D/g, '').length < 6) throw new Error('Telefono non valido');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email non valida');
  // Nomi e fasce vengono sempre dall'elenco, mai dal browser: nessuna persona in più o in meno
  if (!Array.isArray(d.people) || d.people.length !== guest.people.length) {
    throw new Error('Numero di persone non valido');
  }

  const people = guest.people.map((g, i) => {
    const p = d.people[i] || {};
    if (p.attending !== true) return { name: g.name, band: g.band, attending: false, allergies: '' };
    // Chi è solo al taglio della torta non è a pranzo: nessuna allergia da indicare
    if (guest.cakeOnly) return { name: g.name, band: g.band, attending: true, allergies: '' };
    return { name: g.name, band: g.band, attending: true, allergies: str_(p.allergies, 200) };
  });

  return { nucleus: nucleus, cakeOnly: guest.cakeOnly === true, phone: phone, email: email, notes: notes, people: people };
}

// ---------- Salvataggio ----------

function save_(c) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_ANSWERS)) setup();
  const sh = ss.getSheetByName(SHEET_ANSWERS);

  // Le risposte precedenti dello stesso invito non vengono cancellate, ma marcate come sostituite
  const last = sh.getLastRow();
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    const flags = vals.map((r) => [
      r[COL_VALID - 1] === VALID && r[COL_NUCLEUS - 1] === c.nucleus ? REPLACED : r[COL_VALID - 1],
    ]);
    sh.getRange(2, COL_VALID, flags.length, 1).setValues(flags);
  }

  const now = new Date();
  const id = Utilities.getUuid().slice(0, 8);
  const rows = c.people.map((p) => [
    now, id, c.nucleus, c.cakeOnly ? CAKE : LUNCH, c.phone, c.email,
    p.name, p.attending ? YES : NO, p.band, p.allergies, c.notes, VALID,
  ]);

  const start = sh.getLastRow() + 1;
  sh.getRange(start, 2, rows.length, HEADERS.length - 1).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
  sh.getRange(start, 1, rows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
}

// ---------- Email ----------

function esc_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function peopleLines_(c) {
  return c.people.map((p) => {
    if (!p.attending) return p.name + ' — non potrà esserci';
    if (c.cakeOnly) return p.name + ' — ci sarà al taglio della torta';
    return (
      p.name + ' — ci sarà' +
      (p.allergies ? ' (allergie/intolleranze: ' + p.allergies + ')' : '')
    );
  });
}

function sendConfirmation_(c) {
  try {
    const lines = peopleLines_(c);
    const eventLine = c.cakeOnly ? EVENT_LINE_CAKE : EVENT_LINE;
    const anyYes = c.people.some((p) => p.attending);
    const intro = anyYes
      ? 'Grazie per aver risposto! Ecco il riepilogo di ciò che abbiamo registrato.'
      : 'Grazie per avercelo fatto sapere. Ecco il riepilogo di ciò che abbiamo registrato.';
    const fix =
      'Se c\'è qualcosa da correggere, cerca di nuovo il vostro invito sul sito e invia una nuova risposta: ' +
      'l\'ultima sostituisce la precedente.';

    const text =
      'Ciao ' + c.nucleus + ',\n\n' + intro + '\n\n' +
      lines.map((l) => '• ' + l).join('\n') +
      (c.notes ? '\n\nNote: ' + c.notes : '') +
      '\n\n' + eventLine + '\n\n' + fix + '\n\nAlessia & Andrea';

    const html =
      '<p>Ciao ' + esc_(c.nucleus) + ',</p><p>' + esc_(intro) + '</p><ul>' +
      lines.map((l) => '<li>' + esc_(l) + '</li>').join('') + '</ul>' +
      (c.notes ? '<p><em>Note: ' + esc_(c.notes) + '</em></p>' : '') +
      '<p>' + esc_(eventLine) + '</p><p>' + esc_(fix) + '</p><p>Alessia &amp; Andrea</p>';

    const opts = {
      to: c.email,
      subject: 'Riepilogo della vostra risposta · Alessia & Andrea',
      body: text,
      htmlBody: html,
      name: SENDER_NAME,
    };
    if (NOTIFY_EMAIL) opts.replyTo = NOTIFY_EMAIL;
    MailApp.sendEmail(opts);
    return true;
  } catch (err) {
    // L'invio dell'email non deve far fallire il salvataggio della risposta
    console.error('Email non inviata', err);
    return false;
  }
}

function notifyOwner_(c) {
  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: 'Nuova risposta RSVP: ' + c.nucleus,
      body:
        c.nucleus + (c.phone ? ' · ' + c.phone : '') + (c.email ? ' · ' + c.email : '') + '\n\n' +
        peopleLines_(c).map((l) => '• ' + l).join('\n') +
        (c.notes ? '\n\nNote: ' + c.notes : ''),
      name: SENDER_NAME,
    });
  } catch (err) {
    console.error('Notifica non inviata', err);
  }
}
