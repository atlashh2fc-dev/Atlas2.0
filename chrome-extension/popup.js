// ══════════════════════════════════════════════════════════════════
//  POPUP.JS — CRM Extractor Pro v3.2
//  · Paso 1: Detectar/pegar número del discador
//  · Paso 2: Capturar datos del CRM (pestaña activa)
//  · Parser interno de datos CRM
//  · El número del discador se preserva durante TODO el flujo
//  · Exportación Excel (TSV), texto plano, historial permanente
// ══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
//  ESTADO GLOBAL
// ─────────────────────────────────────────────
let currentParsed  = null;   // Datos parseados del último capture
let currentView    = 'main'; // 'main' | 'history' | 'stats'
let allRecords     = [];     // Cache local del historial
let activeFilter   = 'all';  // Filtro de tiempo activo
let searchQuery    = '';     // Texto de búsqueda
let activePhone    = '';     // Número del discador activo en esta sesión

// ─────────────────────────────────────────────
//  INICIALIZACIÓN
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTempPhone();
  loadRecords();
  bindEvents();
});

// ─────────────────────────────────────────────
//  BIND DE EVENTOS
// ─────────────────────────────────────────────
function bindEvents() {
  // Navegación
  document.getElementById('btnViewHistory').addEventListener('click', () => showView('history'));
  document.getElementById('btnViewStats').addEventListener('click',   () => showView('stats'));
  document.getElementById('btnBackFromHistory').addEventListener('click', () => showView('main'));
  document.getElementById('btnBackFromStats').addEventListener('click',   () => showView('main'));

  // Paso 1 — Detectar número del discador
  document.getElementById('btnDetectPhone').addEventListener('click', detectFromDialer);
  document.getElementById('btnSetPhone').addEventListener('click', pastePhone);
  document.getElementById('phoneInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') pastePhone();
  });
  document.getElementById('btnClearPhone').addEventListener('click', clearPhone);
  document.getElementById('btnSearchAtlas').addEventListener('click', () => {
    if (activePhone) searchInAtlas(activePhone);
  });

  // Paso 2 — Captura CRM
  document.getElementById('btnCapture').addEventListener('click', captureCurrentTab);

  // Acciones del resultado
  document.getElementById('btnDiscardResult').addEventListener('click', discardResult);
  document.getElementById('btnCopyExcel').addEventListener('click', copyForExcel);
  document.getElementById('btnCopyText').addEventListener('click',  copyAsText);
  document.getElementById('btnSaveRecord').addEventListener('click', saveRecord);
  const btnSendCotizadora = document.getElementById('btnSendCotizadora');
  if (btnSendCotizadora) btnSendCotizadora.addEventListener('click', sendToCotizadora);

  // Manual
  // Historial
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnImportCSV').addEventListener('click', () => document.getElementById('fileImport').click());
  document.getElementById('fileImport').addEventListener('change', importCSV);
  document.getElementById('btnClearAll').addEventListener('click', clearAll);
  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase();
    renderHistory();
  });
  document.querySelectorAll('.fbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderHistory();
    });
  });

  // Estadísticas
  const btnExportCSVStats = document.getElementById('btnExportCSVStats');
  if (btnExportCSVStats) btnExportCSVStats.addEventListener('click', exportCSV);
}

// ─────────────────────────────────────────────
//  VISTAS
// ─────────────────────────────────────────────
function showView(name) {
  currentView = name;
  document.getElementById('viewMain').classList.toggle('hidden',    name !== 'main');
  document.getElementById('viewHistory').classList.toggle('hidden', name !== 'history');
  document.getElementById('viewStats').classList.toggle('hidden',   name !== 'stats');

  document.getElementById('btnViewHistory').classList.toggle('active', name === 'history');
  document.getElementById('btnViewStats').classList.toggle('active',   name === 'stats');

  if (name === 'history') renderHistory();
  if (name === 'stats')   renderStats();
}

// ─────────────────────────────────────────────
//  PASO 1 — NÚMERO DEL DISCADOR
//  El número se preserva en `activePhone` (memoria)
//  Y también en chrome.storage.local como `tempPhone`
//  para sobrevivir cierres del popup.
// ─────────────────────────────────────────────

/** Carga el número temporal guardado en storage al abrir el popup */
function loadTempPhone() {
  chrome.storage.local.get(['tempPhone'], data => {
    if (data.tempPhone && data.tempPhone.number) {
      setActivePhone(data.tempPhone.number, false); // no re-guardar en storage
      checkDuplicate(data.tempPhone.number);
    }
  });
}

/** Detecta el número desde la pestaña del discador (Vocalcom/Hermes360) */
async function detectFromDialer() {
  const btn = document.getElementById('btnDetectPhone');
  btn.disabled = true;

  try {
    // Siempre delegar al background — él sabe si el debugger está adjunto
    // y puede usar CDP directamente sin conflicto.
    // El background intenta en orden: tempPhone → CDP eval → scripting.executeScript
    const phone = await new Promise(res =>
      chrome.runtime.sendMessage({ type: 'READ_PHONE_FROM_DIALER' }, r => res(r?.phone || null))
    );

    if (phone) {
      confirmPhone(phone);
    } else {
      showToast('main', '✖ No se detectó número en el discador', 'err');
    }
  } catch (err) {
    showToast('main', '✖ Error: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

/** Pegar/establecer manualmente el número desde el input */
async function pastePhone() {
  let val = document.getElementById('phoneInput').value.trim();

  // Si el campo está vacío, intentar leer el portapapeles
  if (!val) {
    try {
      val = (await navigator.clipboard.readText()).trim();
    } catch(e) { /* ignorar */ }
  }

  if (!val) {
    showToast('main', '✖ Ingresa o copia un número primero', 'err');
    return;
  }

  const normalized = normalizePhone(val);
  if (!normalized) {
    showToast('main', '✖ Número no reconocido', 'err');
    return;
  }

  confirmPhone(normalized);
}

/** Muestra el número detectado y lo activa */
// ─────────────────────────────────────────────
//  HISTORIAL — registrar número inmediato
//  Definido ANTES de confirmPhone para que esté disponible
// ─────────────────────────────────────────────
function histRegistrar(phone) {
  if (!phone) return;
  // Delegar al background — es el único que escribe al storage de forma segura
  chrome.runtime.sendMessage({ type: 'REGISTRAR_NUMERO', phone: phone });
}

function confirmPhone(phone) {
  document.getElementById('phoneInput').value = phone;
  setActivePhone(phone, true);
  checkDuplicate(phone);
  showToast('main', `✔ Número activo: ${phone}`, 'ok');
  histRegistrar(phone);
  searchInAtlas(phone);
}

/** Establece el número activo en UI y opcionalmente en storage */
function setActivePhone(phone, saveToStorage) {
  activePhone = phone;

  // UI: mostrar badge con el número
  document.getElementById('phoneSaved').classList.remove('hidden');
  document.getElementById('phoneSavedDisplay').textContent = phone;
  // Mostrar número en el input (no limpiar — el usuario puede verlo)
  document.getElementById('phoneInput').value = phone;

  // Actualizar currentParsed si existe
  if (currentParsed) {
    currentParsed.phoneOriginal = phone;
    document.getElementById('fPhone').textContent = phone;
  }

  if (saveToStorage) {
    chrome.storage.local.set({
      tempPhone: { number: phone, status: 'pending', capturedAt: Date.now() }
    });
  }
}

/** Limpia el número activo */
function clearPhone() {
  activePhone = '';
  document.getElementById('phoneSaved').classList.add('hidden');
  document.getElementById('dupeAlert').classList.add('hidden');
  document.getElementById('phoneInput').value = '';
  chrome.storage.local.remove('tempPhone');

  if (currentParsed) {
    currentParsed.phoneOriginal = '';
    document.getElementById('fPhone').textContent = '(sin número)';
  }
}

/** Verifica si el número ya fue llamado antes y muestra alerta con fecha y último comentario */
function checkDuplicate(phone) {
  chrome.storage.local.get(['records'], data => {
    const records = data.records || [];
    const matches = records
      .filter(r => r.phoneOriginal === phone)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const dupeEl = document.getElementById('dupeAlert');

    // Solo mostrar aviso si hay un registro ANTERIOR (no el de hoy mismo como primer contacto).
    // Condición: debe haber al menos un registro cuyo timestamp sea anterior a los últimos 60 seg,
    // o bien que existan 2+ registros (significa que ya fue llamado en sesiones previas).
    const ahora = Date.now();
    const previos = matches.filter(r => (ahora - (r.timestamp || 0)) > 60000);

    if (!previos.length) {
      dupeEl.classList.add('hidden');
      return;
    }
    dupeEl.classList.remove('hidden');
    const last = previos[0];
    let msg = '\u{1F4DE} Ya llamaste a este cliente el ' + (last.fecha || '?');
    if (last.hora) msg += ' a las ' + last.hora;
    const ultimoComentario = last.tipificacion
      ? 'Tipificaci\u00f3n: ' + last.tipificacion
      : (last.observaciones ? truncate(last.observaciones, 60) : null);
    dupeEl.innerHTML =
      '<span>' + msg + '</span>' +
      (ultimoComentario ? '<span class="dupe-last-comment">\u{1F4AC} ' + ultimoComentario + '</span>' : '');
  });
}

/** Busca el número en Atlas */
function searchInAtlas(phone) {
  chrome.runtime.sendMessage({ type: 'BUSCAR_EN_ATLAS', phone }, res => {
    if (res && !res.ok) {
      showToast('main', '✖ ' + (res.error || 'Error buscando en Atlas'), 'err');
    } else {
      showToast('main', '✔ Buscando en Atlas...', 'ok');
    }
  });
}

// ─────────────────────────────────────────────
//  PASO 2 — CAPTURA DE LA PESTAÑA ACTIVA
// ─────────────────────────────────────────────
async function captureCurrentTab() {
  const btn = document.getElementById('btnCapture');
  btn.disabled = true;
  btn.querySelector('span:last-child').textContent = 'Capturando...';

  try {
    // Buscar Atlas primero aunque no esté en foco
    let tab = null;
    const atlasTabs = await chrome.tabs.query({ url: '*://atlas.geimser.cl/*' });
    if (atlasTabs.length) {
      tab = atlasTabs.find(t => t.url.includes('/app/calls')) || atlasTabs[0];
    }
    // Fallback: pestaña activa actual
    if (!tab) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }

    if (!tab || !tab.id) throw new Error('No hay pestaña activa');
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      throw new Error('No se puede capturar páginas del navegador');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ['content.js']
    });

    const payload = results && results[0] && results[0].result;
    if (!payload || !payload.text) throw new Error('No se pudo extraer texto de la página');

    const parsed = parseData(payload.text, payload.pairs || {});
    parsed.sourceUrl   = payload.url;
    parsed.sourceTitle = payload.title;
    parsed.capturedAt  = Date.now();

    // CRÍTICO: inyectar el número del discador en el resultado
    // Prioridad: activePhone en memoria > tempPhone en storage
    if (activePhone) {
      parsed.phoneOriginal = activePhone;
      showParsedResult(parsed);
    } else {
      chrome.storage.local.get(['tempPhone'], data => {
        if (data.tempPhone && data.tempPhone.number) {
          activePhone = data.tempPhone.number;
          parsed.phoneOriginal = activePhone;
        }
        showParsedResult(parsed);
      });
    }

  } catch (err) {
    showToast('main', '✖ ' + err.message, 'err');
    btn.disabled = false;
    btn.querySelector('span:last-child').textContent = 'Extraer desde CRM';
  }

  btn.disabled = false;
  btn.querySelector('span:last-child').textContent = 'Extraer desde CRM';
}

// ─────────────────────────────────────────────
//  PARSER INTERNO
//  Atlas CRM muestra los datos como bloques de texto con etiqueta
//  en una línea y valor en la siguiente:
//    "Razón social\nCOMERCIAL BRAVO Y MARTINEZ SA\nRUT empresa\n76.849.210-7"
//  La función fromLines() extrae el valor que sigue a cada etiqueta.
// ─────────────────────────────────────────────
function parseData(text, pairs) {
  const d = {
    phoneOriginal: activePhone || '',
    nombre:        '',
    razonSocial:   '',
    rut:           '',
    rubro:         '',
    actividad:     '',
    segmento:      '',
    telefonoCRM:   '',
    correo:        ''
  };

  // Dividir el texto en líneas limpias para leer etiqueta → valor
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // fromLines: busca la primera línea que haga match con alguna clave
  // y retorna la SIGUIENTE línea (que es el valor), siempre que no sea
  // otra etiqueta conocida.
  const KNOWN_LABELS = [
    'razón social', 'razon social', 'rut empresa', 'rut', 'dirección empresa',
    'direccion empresa', 'dirección', 'asesor origen', 'observación inicial',
    'observacion inicial', 'tipificación inicial', 'tipificacion inicial',
    'mail', 'correo', 'teléfono', 'telefono', 'fono', 'rubro', 'actividad',
    'segmento', 'nombre'
  ];

  function isLabel(line) {
    const l = line.toLowerCase();
    return KNOWN_LABELS.some(lbl => l === lbl || l.startsWith(lbl));
  }

  function fromLines(...keys) {
    for (const key of keys) {
      const lk = key.toLowerCase().trim();
      for (let i = 0; i < lines.length - 1; i++) {
        const lineLower = lines[i].toLowerCase().trim();
        if (lineLower === lk || lineLower.startsWith(lk)) {
          const val = lines[i + 1];
          // El valor no debe ser otra etiqueta conocida ni vacío
          if (val && !isLabel(val) && val.length > 0) {
            return val.trim();
          }
        }
      }
    }
    return '';
  }

  // fromPairs: busca en los pares label→valor del DOM (más preciso cuando existen)
  function fromPairs(...keys) {
    for (const key of keys) {
      const lk = key.toLowerCase().trim();
      for (const [k, v] of Object.entries(pairs)) {
        const kl = k.toLowerCase().trim();
        if (kl === lk) return v.trim();          // match exacto primero
      }
      for (const [k, v] of Object.entries(pairs)) {
        const kl = k.toLowerCase().trim();
        if (kl.includes(lk) || lk.includes(kl)) return v.trim(); // match parcial después
      }
    }
    return '';
  }

  function fromText(...patterns) {
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  }

  const RUT_RE = /\b(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b/;

  // Versión de fromLines que solo acepta si el valor pasa un test adicional
  function fromLinesIf(testFn, ...keys) {
    for (const key of keys) {
      const lk = key.toLowerCase().trim();
      for (let i = 0; i < lines.length - 1; i++) {
        const lineLower = lines[i].toLowerCase().trim();
        if (lineLower === lk || lineLower.startsWith(lk)) {
          const val = lines[i + 1];
          if (val && !isLabel(val) && val.length > 0 && testFn(val)) {
            return val.trim();
          }
        }
      }
    }
    return '';
  }

  // ── RUT ──
  // Atlas a veces pone el RUT en el header como "RUT empresa: 76.327.012-2  Sin teléfono"
  // (todo en una línea). El regex extrae el RUT directamente del texto completo.
  // fromPairs es más preciso cuando el DOM tiene los pares etiqueta/valor.
  d.rut = fromPairs('rut empresa', 'rut') ||
          fromText(RUT_RE) ||
          fromLinesIf(v => RUT_RE.test(v), 'rut empresa', 'rut');
  if (d.rut) {
    // Extraer solo el RUT si viene con texto adicional (ej: "76.327.012-2  Sin teléfono")
    const rutMatch = d.rut.match(RUT_RE);
    if (rutMatch) d.rut = rutMatch[1];
    d.rut = normalizeRut(d.rut);
  }

  // ── RAZÓN SOCIAL ──
  d.razonSocial = fromPairs('razón social', 'razon social') ||
                  fromLines('razón social', 'razon social') ||
                  fromText(/razón social\s*[:\-]?\s*\n?([^\n]+)/i);

  // ── NOMBRE (contacto) ──
  d.nombre = fromPairs('nombre') ||
             fromLines('nombre') ||
             d.razonSocial;

  // ── RUBRO ──
  d.rubro = fromPairs('rubro', 'industria', 'sector', 'giro') ||
            fromLines('rubro', 'giro', 'industria') ||
            fromText(/rubro\s*[:\-]\s*(.+)/i);

  // ── ACTIVIDAD ──
  d.actividad = fromPairs('actividad económica', 'actividad economica', 'actividad') ||
                fromLines('actividad económica', 'actividad economica', 'actividad') ||
                fromText(/actividad(?:\s+econ[oó]mica)?\s*[:\-]\s*(.+)/i);

  // ── SEGMENTO ──
  d.segmento = fromPairs('segmento', 'tamaño empresa', 'tamano empresa', 'clasificación') ||
               fromLines('segmento', 'tamaño', 'clasificación') ||
               fromText(/segmento\s*[:\-]\s*(.+)/i);

  // ── TELÉFONO CRM ──
  // "Sin teléfono" no es un teléfono — filtrar explícitamente
  const rawTel = fromPairs('teléfono', 'telefono', 'fono', 'celular', 'móvil', 'movil') ||
                 fromLinesIf(v => /\d{7,}/.test(v), 'teléfono', 'telefono', 'fono') ||
                 fromText(/\b(\+?56[\s]?[2-9][\d\s]{7,})\b/);
  d.telefonoCRM = (rawTel && !/sin tel/i.test(rawTel)) ? rawTel.replace(/\s/g, '') : '';

  // ── CORREO ──
  d.correo = fromPairs('mail', 'correo', 'email', 'e-mail') ||
             fromLines('mail', 'correo', 'email') ||
             fromText(/\b([\w.+\-]{3,}@[\w.\-]+\.[a-z]{2,})\b/i);

  return d;
}

/** Normaliza RUT chileno a formato 12.345.678-9 */
function normalizeRut(raw) {
  const clean = raw.replace(/[\s.]/g, '');
  if (!clean.includes('-')) return raw;
  const [body, dv] = clean.split('-');
  if (!body || !dv) return raw;
  const num = parseInt(body, 10);
  if (isNaN(num)) return raw;
  return num.toLocaleString('es-CL').replace(/,/g, '.') + '-' + dv.toUpperCase();
}

/** Normaliza número de teléfono a formato +56XXXXXXXXX */
function normalizePhone(raw) {
  if (!raw) return '';
  const clean = String(raw).replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(clean)) return '';
  if (clean.startsWith('56') && clean.length >= 11) return '+' + clean;
  if (clean.length === 9) return '+56' + clean;
  if (clean.length === 8) return '+562' + clean;
  if (clean.length >= 9 && clean.length <= 12) return '+56' + clean;
  return '';
}

// ─────────────────────────────────────────────
//  MOSTRAR RESULTADO
// ─────────────────────────────────────────────
function showParsedResult(parsed) {
  // CRÍTICO: siempre usar el activePhone, nunca sobreescribir con datos del CRM
  if (activePhone) parsed.phoneOriginal = activePhone;

  currentParsed = parsed;

  document.getElementById('fPhone').textContent       = parsed.phoneOriginal || '(sin número del discador)';
  document.getElementById('fRazonSocial').textContent = parsed.razonSocial   || '—';
  document.getElementById('fRut').textContent         = parsed.rut           || '—';
  document.getElementById('fRubro').textContent       = parsed.rubro         || '—';
  document.getElementById('fActividad').textContent   = parsed.actividad     || '—';
  document.getElementById('fSegmento').textContent    = parsed.segmento      || '—';
  document.getElementById('fTelCRM').textContent      = parsed.telefonoCRM   || '—';
  document.getElementById('fCorreo').textContent      = parsed.correo        || '—';

  document.getElementById('parseResult').classList.remove('hidden');
  showView('main');

  // ── COPIADO AUTOMÁTICO AL PORTAPAPELES ──
  autoCopyToClipboard(parsed);

  // ── GUARDADO AUTOMÁTICO AL HISTORIAL ──
  // Sin necesidad de presionar 💾 — cada extracción queda registrada
  autoSaveRecord();
}

function autoCopyToClipboard(p) {
  const tsv = buildExcelTSV(p);

  navigator.clipboard.writeText(tsv)
    .then(() => showToast('main', '✔ Copiado automáticamente — pega en Excel con Ctrl+V', 'ok'))
    .catch(() => {
      // Si falla el auto-copy (ej: popup sin foco), no interrumpir el flujo
    });
}

// Flag: bloquear discardResult por 10s tras extracción automática
var _autoExtractLock = false;

function discardResult() {
  if (_autoExtractLock) return; // no ocultar si fue extracción automática
  currentParsed = null;
  document.getElementById('parseResult').classList.add('hidden');
  document.getElementById('manualText').value = '';
}

// ─────────────────────────────────────────────
//  PARSEO MANUAL (textarea)
// ─────────────────────────────────────────────
function parseManual() {
  const text = document.getElementById('manualText').value.trim();
  if (!text) {
    showToast('main', '✖ Pega texto antes de extraer', 'err');
    return;
  }
  const parsed = parseData(text, {});
  parsed.capturedAt = Date.now();
  // CRÍTICO: siempre preservar el número del discador
  parsed.phoneOriginal = activePhone || parsed.phoneOriginal;
  showParsedResult(parsed);
}

// ─────────────────────────────────────────────
//  EXPORTACIÓN
// ─────────────────────────────────────────────

/** Construye el TSV de Excel a partir del objeto parseado.
 *  Única fuente de verdad — reutilizada por copyForExcel(), autoCopyToClipboard()
 *  y el nuevo botón "Enviar a Cotizadora" para garantizar idéntica estructura.
 *  Columnas: FECHA | EMPRESA | RUT | TELÉFONO | CORREO ELECTRÓNICO
 */
function buildExcelTSV(p) {
  const now   = new Date();
  const fecha = now.toLocaleDateString('es-CL'); // dd/mm/yyyy
  return [
    fecha,
    p.razonSocial   || p.nombre || '',
    p.rut           || '',
    p.phoneOriginal || '',
    p.correo        || '',
  ].join('\t');
}

/** Copiar para Excel → TSV alineado con planilla:
 *  FECHA | EMPRESA | RUT | TELÉFONO | CORREO ELECTRÓNICO | REPRESENTANTE | SERVICIO OFRECIDO
 */
function copyForExcel() {
  if (!currentParsed) return;
  const tsv = buildExcelTSV(currentParsed);

  navigator.clipboard.writeText(tsv)
    .then(() => showToast('main', '✔ Copiado — pega en Excel con Ctrl+V', 'ok'))
    .catch(() => showToast('main', '✖ Error al copiar', 'err'));
}

/** Enviar a Cotizadora → reutiliza exactamente el mismo TSV que copyForExcel(),
 *  delega al background la apertura/reutilización de la pestaña y el disparo
 *  del botón "Pegar datos CRM" ya existente en la cotizadora (sin mapeo propio).
 */
function sendToCotizadora() {
  if (!currentParsed) return;
  const tsv = buildExcelTSV(currentParsed);
  const btn = document.getElementById('btnSendCotizadora');
  if (btn) btn.disabled = true;

  chrome.runtime.sendMessage({ type: 'SEND_TO_COTIZADORA', tsv }, res => {
    if (btn) btn.disabled = false;
    if (res && res.ok) {
      showToast('main', '✔ Enviado a la cotizadora', 'ok');
    } else {
      showToast('main', '✖ ' + (res && res.error ? res.error : 'No se pudo enviar a la cotizadora'), 'err');
    }
  });
}

/** Copiar como texto plano */
function copyAsText() {
  if (!currentParsed) return;
  const p   = currentParsed;
  const now = new Date();

  const txt = [
    `Número discador: ${p.phoneOriginal || '—'}`,
    `Razón social:    ${p.razonSocial   || '—'}`,
    `RUT:             ${p.rut           || '—'}`,
    `Rubro:           ${p.rubro         || '—'}`,
    `Actividad:       ${p.actividad     || '—'}`,
    `Segmento:        ${p.segmento      || '—'}`,
    `Teléfono CRM:    ${p.telefonoCRM   || '—'}`,
    `Correo:          ${p.correo        || '—'}`,
    `Fecha:           ${now.toLocaleDateString('es-CL')}`,
    `Hora:            ${now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
  ].join('\n');

  navigator.clipboard.writeText(txt)
    .then(() => showToast('main', '✔ Copiado — pega en notas o WhatsApp', 'ok'))
    .catch(() => showToast('main', '✖ Error al copiar', 'err'));
}

// ─────────────────────────────────────────────
//  GUARDAR REGISTRO EN HISTORIAL
// ─────────────────────────────────────────────
// Construir el objeto record desde currentParsed
function buildRecord() {
  if (!currentParsed) return null;
  var phone = activePhone || currentParsed.phoneOriginal || '';
  var now   = new Date();
  return {
    phoneOriginal: phone,
    estado:        'extraido',
    fecha:         now.toLocaleDateString('es-CL'),
    hora:          now.toLocaleTimeString('es-CL', {hour:'2-digit',minute:'2-digit'}),
    timestamp:     Date.now(),
    razonSocial:   currentParsed.razonSocial || '',
    nombre:        currentParsed.nombre      || '',
    rut:           currentParsed.rut         || '',
    rubro:         currentParsed.rubro       || '',
    actividad:     currentParsed.actividad   || '',
    segmento:      currentParsed.segmento    || '',
    telefonoCRM:   currentParsed.telefonoCRM || '',
    correo:        currentParsed.correo      || '',
    observaciones: '',
    sourceUrl:     currentParsed.sourceUrl   || ''
  };
}

// Guardado automático — no oculta el panel de resultados
function autoSaveRecord() {
  var record = buildRecord();
  if (!record || !record.phoneOriginal) return;
  chrome.runtime.sendMessage({ type: 'SAVE_RECORD', record: record }, function(res) {
    if (res && res.ok) {
      chrome.storage.local.get(['records'], function(data) { allRecords = data.records || []; });
    }
  });
}

// Guardado manual con botón 💾 — oculta el panel y confirma con toast
function saveRecord() {
  var record = buildRecord();
  if (!record) return;
  chrome.runtime.sendMessage({ type: 'SAVE_RECORD', record: record }, function(res) {
    if (res && res.ok) {
      chrome.storage.local.get(['records'], function(data) { allRecords = data.records || []; });
      showToast('main', '✔ Guardado — ' + res.total + ' registros', 'ok');
      chrome.storage.local.get(['tempPhone'], function(d) {
        if (d.tempPhone) chrome.storage.local.set({tempPhone: Object.assign({}, d.tempPhone, {status:'associated'})});
      });
      setTimeout(function() { discardResult(); }, 400);
    }
  });
}

// ─────────────────────────────────────────────
//  HISTORIAL
// ─────────────────────────────────────────────
function loadRecords() {
  chrome.storage.local.get(['records'], data => {
    allRecords = data.records || [];
  });
}

// getFilteredRecords → definida más abajo

// renderHistory → definida más abajo

function copyRecordExcel(id) {
  const r = allRecords.find(x => x.id === id);
  if (!r) return;
  // Columnas: FECHA | EMPRESA | RUT | TELÉFONO | CORREO ELECTRÓNICO | REPRESENTANTE | SERVICIO OFRECIDO
  const tsv = [
    r.fecha         || '',
    r.razonSocial   || r.nombre || '',
    r.rut           || '',
    r.phoneOriginal || '',
    r.correo        || '',
  ].join('\t');
  navigator.clipboard.writeText(tsv)
    .then(() => showToast('main', '✔ Copiado para Excel', 'ok'))
    .catch(() => {});
}

function copyRecordText(id) {
  const r = allRecords.find(x => x.id === id);
  if (!r) return;
  const txt = `Número discador: ${r.phoneOriginal||'—'}\nRazón social:    ${r.razonSocial||'—'}\nRUT:             ${r.rut||'—'}\nRubro:           ${r.rubro||'—'}\nActividad:       ${r.actividad||'—'}\nSegmento:        ${r.segmento||'—'}\nTeléfono CRM:    ${r.telefonoCRM||'—'}\nCorreo:          ${r.correo||'—'}\nFecha:           ${r.fecha} ${r.hora}`;
  navigator.clipboard.writeText(txt)
    .then(() => showToast('main', '✔ Copiado como texto', 'ok'))
    .catch(() => {});
}

function deleteRecord(id) {
  chrome.runtime.sendMessage({ type: 'DELETE_RECORD', id }, () => {
    allRecords = allRecords.filter(r => r.id !== id);
    renderHistory();
  });
}

function clearAll() {
  if (!confirm('¿Borrar todo el historial? Esta acción no se puede deshacer.')) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, () => {
    allRecords = [];
    renderHistory();
  });
}

// ─────────────────────────────────────────────
//  EXPORTAR / IMPORTAR CSV
// ─────────────────────────────────────────────
function exportCSV() {
  chrome.storage.local.get(['records'], data => {
    const records = data.records || [];
    if (!records.length) {
      showToast('main', '✖ No hay registros para exportar', 'err');
      return;
    }
    const header = 'Fecha,Hora,Número,RazonSocial,RUT,Rubro,Actividad,Segmento,TelCRM,Correo\n';
    const rows = records.map(r => [
      r.fecha || '', r.hora || '', r.phoneOriginal || '',
      csvCell(r.razonSocial), r.rut || '',
      csvCell(r.rubro), csvCell(r.actividad), csvCell(r.segmento),
      r.telefonoCRM || '', r.correo || ''
    ].join(',')).join('\n');

    const b64 = btoa(unescape(encodeURIComponent('\uFEFF' + header + rows)));
    const now  = new Date();
    const ts   = now.toLocaleDateString('es-CL').replace(/\//g,'-') + '_' +
                 now.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}).replace(':','h');
    chrome.downloads.download({
      url: `data:text/csv;charset=utf-8;base64,${b64}`,
      filename: `CRM_Extractor_${ts}.csv`,
      saveAs: true
    });
  });
}

function csvCell(val) {
  if (!val) return '';
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.replace(/\r/g,'').split('\n').filter(Boolean);
    if (lines.length < 2) { showToast('main', '✖ CSV vacío o inválido', 'err'); return; }
    const rows = lines.slice(1); // Skip header
    const newRecords = rows.map(line => {
      const cols = parseCsvLine(line);
      return {
        id:            Date.now().toString(36) + Math.random().toString(36).slice(2),
        timestamp:     Date.now(),
        fecha:         cols[0] || '',
        hora:          cols[1] || '',
        phoneOriginal: cols[2] || '',  // CRÍTICO: número del discador en col 3
        razonSocial:   cols[3] || '',
        nombre:        cols[3] || '',  // Alias
        rut:           cols[4] || '',
        rubro:         cols[5] || '',
        actividad:     cols[6] || '',
        segmento:      cols[7] || '',
        telefonoCRM:   cols[8] || '',
        correo:        cols[9] || ''
      };
    });

    chrome.storage.local.get(['records'], data => {
      const existing = data.records || [];
      // Evitar duplicados por ID
      const merged = [...newRecords, ...existing];
      chrome.storage.local.set({ records: merged }, () => {
        allRecords = merged;
        showToast('main', `✔ Importados ${newRecords.length} registros`, 'ok');
        if (currentView === 'history') renderHistory();
      });
    });
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = ''; // Reset para poder importar el mismo archivo de nuevo
}

function parseCsvLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─────────────────────────────────────────────
//  ESTADÍSTICAS
// ─────────────────────────────────────────────
function renderStats() {
  chrome.storage.local.get(['records'], data => {
    const records = data.records || [];
    allRecords    = records;

    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const today      = records.filter(r => r.timestamp >= startOfDay.getTime());
    const empresas   = new Set(records.map(r => (r.razonSocial || r.nombre || '').toUpperCase()).filter(Boolean));
    const ruts       = new Set(records.map(r => r.rut).filter(Boolean));

    document.getElementById('statTotal').textContent    = records.length;
    document.getElementById('statToday').textContent    = today.length;
    document.getElementById('statEmpresas').textContent = empresas.size;
    document.getElementById('statRuts').textContent     = ruts.size;
  });
}

// ─────────────────────────────────────────────
//  ESCUCHAR CAMBIOS EN STORAGE (modo AUTO)
//  Si el popup está abierto y cae una llamada via
//  CDP en background, actualizamos el número activo.
// ─────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // ── Extracción automática completada → mostrar datos ──
  if (changes.autoExtractResult && changes.autoExtractResult.newValue) {
    const res = changes.autoExtractResult.newValue;
    if (res && res.text) {
      const parsed = parseData(res.text, res.pairs || {});
      parsed.sourceUrl     = res.url   || '';
      parsed.sourceTitle   = res.title || '';
      parsed.capturedAt    = res.capturedAt || Date.now();
      parsed.phoneOriginal = res.phone || activePhone || '';
      if (res.phone) { activePhone = res.phone; setActivePhone(res.phone, false); }
      _autoExtractLock = true;
      showParsedResult(parsed);
      showToast('main', '✔ Extracción automática completada', 'ok');
      setTimeout(function() { _autoExtractLock = false; }, 15000);
    }
    return;
  }

  // ── Número nuevo detectado ──
  if (changes.tempPhone && changes.tempPhone.newValue) {
    const tp = changes.tempPhone.newValue;
    if (tp.status !== 'pending' || !tp.number) return;

    // Verificar si hay extracción en curso en el background
    chrome.storage.local.get(['extrayendo'], function(d) {
      if (d.extrayendo || _autoExtractLock) {
        // Solo actualizar número silenciosamente — NO lanzar búsqueda ni limpiar vista
        activePhone = tp.number;
        setActivePhone(tp.number, false);
        checkDuplicate(tp.number);
      } else {
        confirmPhone(tp.number);
      }
    });
  }
});

// Al abrir el popup, verificar si hay una extracción automática pendiente
// (el background la completó mientras el popup estaba cerrado)
chrome.storage.local.get(['autoExtractResult'], data => {
  if (data.autoExtractResult && data.autoExtractResult.text) {
    const res = data.autoExtractResult;
    const parsed = parseData(res.text, res.pairs || {});
    parsed.sourceUrl   = res.url   || '';
    parsed.sourceTitle = res.title || '';
    parsed.capturedAt  = res.capturedAt || Date.now();
    if (res.phone) {
      activePhone = res.phone;
      setActivePhone(res.phone, false);
    }
    parsed.phoneOriginal = activePhone || res.phone || '';
    _autoExtractLock = true;
    showParsedResult(parsed);
    setTimeout(function() { _autoExtractLock = false; }, 10000);
  }
});

// ─────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────
function showToast(ctx, msg, type) {
  const el = document.getElementById('toastMain');
  if (!el) return;
  el.textContent = msg;
  el.className   = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// Exponer funciones globales para onclick en HTML generado
window.copyRecordExcel = copyRecordExcel;
window.copyRecordText  = copyRecordText;
window.deleteRecord    = deleteRecord;
// ════════════════════════════════════════════════════════════════
//  MÓDULO HISTORIAL COMPLETO
// ════════════════════════════════════════════════════════════════

// ── RENDERIZAR HISTORIAL ─────────────────────────────────────────
function renderHistory() {
  chrome.storage.local.get(['records'], function(data) {
    allRecords = data.records || [];
    var filtered  = getFilteredRecords();
    var container = document.getElementById('historyList');
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state">📭 No hay registros<br>que coincidan con los filtros</div>';
      return;
    }
    container.innerHTML = filtered.map(function(r) {
      var extraido = r.estado === 'extraido';
      var sid      = 'hcd-' + r.id;
      // Fila compacta siempre visible
      var estadoTxt  = extraido ? '✓ EXTRAÍDO' : '○ SIN EXTRAER';
      var estadoCls  = extraido ? 'hcr-ok' : 'hcr-pend';
      var agBadge    = r.agendaFecha ? ' ⏰' : '';
      var tipifBadge = r.tipificacion ? ' <span class="hcr-tipif-badge">' + esc(r.tipificacion) + '</span>' : '';
      // Detalle expandible (oculto por defecto)
      var nombre     = esc(r.razonSocial || r.nombre || '—');
      var crmFields  = extraido ? (
        '<div class="hcd-row"><span class="hcd-l">Razón Social</span><span class="hcd-v">' + nombre + '</span></div>' +
        '<div class="hcd-row"><span class="hcd-l">RUT</span><span class="hcd-v">' + esc(r.rut||'—') + '</span></div>' +
        '<div class="hcd-row"><span class="hcd-l">Rubro</span><span class="hcd-v">' + esc(r.rubro||'—') + '</span></div>' +
        '<div class="hcd-row"><span class="hcd-l">Actividad</span><span class="hcd-v">' + esc(truncate(r.actividad,40)) + '</span></div>' +
        '<div class="hcd-row"><span class="hcd-l">Segmento</span><span class="hcd-v">' + esc(r.segmento||'—') + '</span></div>' +
        '<div class="hcd-row"><span class="hcd-l">Correo</span><span class="hcd-v">' + esc(r.correo||'—') + '</span></div>'
      ) : '<div class="hcd-row"><span class="hcd-l">Empresa</span><span class="hcd-v">' + nombre + '</span></div>';
      return (
        '<div class="hcr" data-id="' + r.id + '">' +
          // ── Fila compacta — clic para expandir ──
          '<div class="hcr-line" data-target="' + sid + '">' +
            '<span class="hcr-phone hcr-phone-link" data-action="crm" data-id="' + r.id + '" title="Buscar en CRM">' + esc(r.phoneOriginal||'—') + '</span>' +
            '<span class="hcr-estado ' + estadoCls + '">' + estadoTxt + agBadge + '</span>' +
            tipifBadge +
            '<span class="hcr-dt">' + esc(r.fecha) + ' ' + esc(r.hora) + '</span>' +
            '<span class="hcr-arrow">▼</span>' +
          '</div>' +
          // ── Detalle colapsado ──
          '<div class="hcd" id="' + sid + '">' +
            crmFields +
            '<div class="hcd-row"><span class="hcd-l">Observaciones</span>' +
              '<textarea class="hcd-obs" rows="2" placeholder="Observaciones..."' +
              ' data-obs-id="' + r.id + '">' + esc(r.observaciones||'') + '</textarea>' +
            '</div>' +
            '<div class="hcd-agenda">' +
              '<input type="date" id="agd-d-' + r.id + '" value="' + (r.agendaFecha||'') + '">' +
              '<input type="time" id="agd-t-' + r.id + '" value="' + (r.agendaHora||'') + '">' +
              '<button class="btn-agenda-set" data-action="agenda" data-id="' + r.id + '">⏰ Agendar</button>' +
            '</div>' +
            '<div class="hcd-tipif">' +
              '<label>🏷 Tipif.</label>' +
              '<select class="hcd-tipif-sel" data-tipif-id="' + r.id + '">' +
                '<option value="">— Sin tipificación —</option>' +
                '<option value="Interesado"' + (r.tipificacion==='Interesado'?' selected':'') + '>Interesado</option>' +
                '<option value="No interesado"' + (r.tipificacion==='No interesado'?' selected':'') + '>No interesado</option>' +
                '<option value="Volver a llamar"' + (r.tipificacion==='Volver a llamar'?' selected':'') + '>Volver a llamar</option>' +
                '<option value="No contesta"' + (r.tipificacion==='No contesta'?' selected':'') + '>No contesta</option>' +
                '<option value="Número equivocado"' + (r.tipificacion==='Número equivocado'?' selected':'') + '>Número equivocado</option>' +
                '<option value="Buzón de voz"' + (r.tipificacion==='Buzón de voz'?' selected':'') + '>Buzón de voz</option>' +
                '<option value="Ya es cliente"' + (r.tipificacion==='Ya es cliente'?' selected':'') + '>Ya es cliente</option>' +
                '<option value="Solicita información"' + (r.tipificacion==='Solicita información'?' selected':'') + '>Solicita información</option>' +
                '<option value="Promesa de pago"' + (r.tipificacion==='Promesa de pago'?' selected':'') + '>Promesa de pago</option>' +
              '</select>' +
              '<button class="btn-save-tipif" data-action="tipif" data-id="' + r.id + '">✔</button>' +
            '</div>' +
            '<div class="hcd-btns">' +
              '<button class="hcd-btn hcd-btn-excel" data-action="excel" data-id="' + r.id + '">📊 Excel</button>' +
              '<button class="hcd-btn hcd-btn-text"  data-action="text"  data-id="' + r.id + '">📝 Notas</button>' +
              '<button class="hcd-btn hcd-btn-crm"   data-action="crm"   data-id="' + r.id + '">🔍 CRM</button>' +
              '<button class="hcd-btn hcd-btn-del"   data-action="del"   data-id="' + r.id + '">✖</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  });
}

// ── BUSCADOR: todos los campos ───────────────────────────────────
function getFilteredRecords() {
  var now = Date.now(), day = 86400000;
  var filtered = allRecords.slice();
  if (activeFilter === 'today') {
    var s = new Date(); s.setHours(0,0,0,0);
    filtered = filtered.filter(function(r){ return r.timestamp >= s.getTime(); });
  } else if (activeFilter === '7d') {
    filtered = filtered.filter(function(r){ return r.timestamp >= now - 7*day; });
  } else if (activeFilter === '30d') {
    filtered = filtered.filter(function(r){ return r.timestamp >= now - 30*day; });
  }
  if (searchQuery) {
    var q = searchQuery.toLowerCase();
    filtered = filtered.filter(function(r) {
      return [r.phoneOriginal,r.nombre,r.razonSocial,r.rut,r.rubro,
              r.actividad,r.segmento,r.correo,r.telefonoCRM,
              r.observaciones,r.fecha,r.estado]
        .some(function(v){ return v && String(v).toLowerCase().indexOf(q) >= 0; });
    });
  }
  return filtered;
}

// ── GUARDAR OBSERVACIÓN ──────────────────────────────────────────
window.saveObs = function(id, val) {
  chrome.runtime.sendMessage({ type: 'UPDATE_RECORD', id: id, patch: { observaciones: val } });
};

// ── AGENDA ───────────────────────────────────────────────────────
window.setAgenda = function(id) {
  var dEl = document.getElementById('agd-d-' + id);
  var tEl = document.getElementById('agd-t-' + id);
  if (!dEl || !tEl || !dEl.value || !tEl.value) {
    showToast('main', '✖ Pon fecha y hora', 'err'); return;
  }
  var ts = new Date(dEl.value + 'T' + tEl.value).getTime();
  chrome.runtime.sendMessage({
    type: 'UPDATE_RECORD', id: id,
    patch: { agendaFecha: dEl.value, agendaHora: tEl.value, agendaTs: ts }
  }, function() {
    chrome.alarms.create('agenda_' + id, { when: ts });
    showToast('main', '✔ Agendado ' + dEl.value + ' ' + tEl.value, 'ok');
    renderHistory();
  });
};

// ── ALARMAS ──────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name.startsWith('agenda_')) {
    var id = alarm.name.replace('agenda_', '');
    chrome.storage.local.get(['records'], function(data) {
      var r = (data.records||[]).find(function(x){ return x.id===id; });
      if (r) mostrarRecordatorio(r);
    });
  }
  if (alarm.name.startsWith('respaldo_')) generarRespaldoTXT();
});

function mostrarRecordatorio(r) {
  var modal = document.getElementById('modalRecordatorio');
  var body  = document.getElementById('modalBody');
  if (!modal || !body) return;
  body.innerHTML =
    '<div><b>Cliente:</b> '       + esc(r.razonSocial||r.nombre||'—') + '</div>' +
    '<div><b>Teléfono:</b> '      + esc(r.phoneOriginal||'—')         + '</div>' +
    '<div><b>RUT:</b> '           + esc(r.rut||'—')                   + '</div>' +
    '<div><b>Observaciones:</b> ' + esc(r.observaciones||'—')         + '</div>' +
    '<div><b>Agendado:</b> '      + esc((r.agendaFecha||'')+' '+(r.agendaHora||'')) + '</div>';
  document.getElementById('btnModalCRM').onclick = function() {
    if (r.phoneOriginal) chrome.runtime.sendMessage({type:'BUSCAR_EN_ATLAS', phone:r.phoneOriginal});
    modal.classList.add('hidden');
  };
  document.getElementById('btnModalCerrar').onclick = function() { modal.classList.add('hidden'); };
  modal.classList.remove('hidden');
  try {
    var ctx = new (window.AudioContext||window.webkitAudioContext)();
    [0,0.35,0.7].forEach(function(t) {
      var o=ctx.createOscillator(), g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value=880; o.type='sine';
      g.gain.setValueAtTime(0.4,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.28);
      o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.28);
    });
  } catch(e) {}
}

// ── RESPALDOS AUTOMÁTICOS TXT ────────────────────────────────────
function programarRespaldos() {
  [{h:12,m:0},{h:15,m:0},{h:17,m:45}].forEach(function(hm) {
    var nombre = 'respaldo_' + hm.h + '_' + String(hm.m).padStart(2,'0');
    var ahora  = new Date();
    var target = new Date(ahora);
    target.setHours(hm.h, hm.m, 0, 0);
    if (target <= ahora) target.setDate(target.getDate()+1);
    chrome.alarms.create(nombre, {when:target.getTime(), periodInMinutes:1440});
  });
}

function generarRespaldoTXT() {
  chrome.storage.local.get(['records'], function(data) {
    var records = data.records || [];
    if (!records.length) return;
    var now  = new Date();
    var pad  = function(n){ return String(n).padStart(2,'0'); };
    var name = 'HISTORIAL_' + now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) +
               '_' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '.txt';
    var sep  = '─'.repeat(50);
    var body = records.map(function(r) {
      return [sep,
        'Fecha:        ' + (r.fecha||'') + '  ' + (r.hora||''),
        'Teléfono:     ' + (r.phoneOriginal||'—'),
        'Estado:       ' + (r.estado==='extraido'?'EXTRAÍDO':'SIN EXTRAER'),
        'Razón Social: ' + (r.razonSocial||'—'),
        'RUT:          ' + (r.rut||'—'),
        'Rubro:        ' + (r.rubro||'—'),
        'Actividad:    ' + (r.actividad||'—'),
        'Correo:       ' + (r.correo||'—'),
        'Observaciones:' + (r.observaciones||'—'),
        r.agendaFecha ? 'Agenda:       '+r.agendaFecha+' '+r.agendaHora : ''
      ].filter(Boolean).join('\n');
    }).join('\n\n');
    var txt = 'HISTORIAL CRM EXTRACTOR PRO\nGenerado: ' + name.replace('HISTORIAL_','').replace('.txt','').replace('_',' ') +
              '\nTotal: ' + records.length + ' registros\n\n' + body;
    var b64 = btoa(unescape(encodeURIComponent(txt)));
    chrome.downloads.download({url:'data:text/plain;charset=utf-8;base64,'+b64, filename:name, saveAs:false});
  });
}

programarRespaldos();

// ── TOGGLE DETALLE HISTORIAL — event delegation ──────────────────
// Un solo listener en el contenedor, sin onclick inline (más robusto en extensiones)
document.addEventListener('click', function(e) {
  // Si el clic fue sobre el número de teléfono (link CRM), no expandir
  if (e.target.closest && e.target.closest('.hcr-phone-link')) return;
  var line = e.target.closest ? e.target.closest('.hcr-line') : null;
  if (!line) return;
  var sid = line.getAttribute('data-target');
  if (!sid) return;
  var det = document.getElementById(sid);
  if (!det) return;
  var open = det.classList.toggle('hcd-open');
  var arr  = line.querySelector('.hcr-arrow');
  if (arr) arr.textContent = open ? '▲' : '▼';
});

// ── CONSULTAR CRM DESDE HISTORIAL ───────────────────────────────
window.consultarCRM = function(id) {
  var r = allRecords.find(function(x){ return x.id === id; });
  if (r && r.phoneOriginal) {
    chrome.runtime.sendMessage({ type: 'BUSCAR_EN_ATLAS', phone: r.phoneOriginal });
  }
};

// ── EVENT DELEGATION para botones y obs del historial ────────────
document.addEventListener('click', function(e) {
  var btn = e.target.closest ? e.target.closest('[data-action]') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-action');
  var id     = btn.getAttribute('data-id');
  if (!id) return;
  e.stopPropagation();
  if (action === 'excel')  { copyRecordExcel(id); return; }
  if (action === 'text')   { copyRecordText(id);  return; }
  if (action === 'del')    { deleteRecord(id);    return; }
  if (action === 'crm')    { window.consultarCRM(id); return; }
  if (action === 'agenda') { window.setAgenda(id); return; }
  if (action === 'tipif')  {
    var sel = document.querySelector('.hcd-tipif-sel[data-tipif-id="' + id + '"]');
    if (sel) {
      var val = sel.value;
      chrome.runtime.sendMessage({ type: 'UPDATE_RECORD', id: id, patch: { tipificacion: val } }, function() {
        showToast('main', val ? ('✔ Tipificado: ' + val) : '✔ Tipificación borrada', 'ok');
        renderHistory();
      });
    }
    return;
  }
});

// ── Guardar observaciones via data-obs-id ─────────────────────────
document.addEventListener('blur', function(e) {
  var ta = e.target;
  if (!ta || ta.tagName !== 'TEXTAREA') return;
  var obsId = ta.getAttribute('data-obs-id');
  if (obsId) window.saveObs(obsId, ta.value);
}, true);
