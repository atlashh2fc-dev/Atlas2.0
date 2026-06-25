// ══════════════════════════════════════════════════════════════════
//  BACKGROUND SERVICE WORKER — CRM Extractor Pro v3.2
//  · Historial, exportación automática (alarmas)
//  · Monitoreo en tiempo real de Vocalcom via chrome.debugger CDP
//    (Network.webSocketFrameReceived → OPEN_SESSION → /T número)
//  · Menú contextual clic derecho para activar/desactivar AUTO
//  · Buscar en Atlas: F5 → esperar carga → Ctrl+K (debugger) → pegar
// ══════════════════════════════════════════════════════════════════

// ── ALARMAS DE EXPORTACIÓN ────────────────────────────────────────
const AUTO_EXPORT_ALARMS = [
  { name: 'export_1200', h: 12, m:  0 },
  { name: 'export_1500', h: 15, m:  0 },
  { name: 'export_1745', h: 17, m: 45 }
];

function scheduleAlarms() {
  AUTO_EXPORT_ALARMS.forEach(({ name, h, m }) => {
    const now = new Date(), target = new Date();
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    chrome.alarms.create(name, { when: target.getTime(), periodInMinutes: 24 * 60 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarms();
  actualizarMenuContextual(false);
});
chrome.alarms.getAll(alarms => { if (!alarms.length) scheduleAlarms(); });

chrome.alarms.onAlarm.addListener(alarm => {
  if (!AUTO_EXPORT_ALARMS.some(a => a.name === alarm.name)) return;
  chrome.storage.local.get(['records'], data => {
    const records = data.records || [];
    if (!records.length) return;
    const header = 'Fecha,Hora,Número,Nombre,RazonSocial,RUT,Rubro,Actividad,Segmento,TelCRM,Correo\n';
    const rows = records.map(r => [
      r.fecha||'', r.hora||'', r.phoneOriginal||'',
      csvCell(r.nombre), csvCell(r.razonSocial), r.rut||'',
      csvCell(r.rubro), csvCell(r.actividad), csvCell(r.segmento),
      r.telefonoCRM||'', r.correo||''
    ].join(',')).join('\n');
    const b64 = btoa(unescape(encodeURIComponent('\uFEFF' + header + rows)));
    const now = new Date();
    const ts  = now.toLocaleDateString('es-CL').replace(/\//g,'-') + '_' +
                now.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}).replace(':','h');
    chrome.downloads.download({
      url: `data:text/csv;charset=utf-8;base64,${b64}`,
      filename: `CRM_Extractor_${ts}.csv`,
      saveAs: false, conflictAction: 'uniquify'
    });
  });
});

function csvCell(val) {
  if (!val) return '';
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ── MENÚ CONTEXTUAL (clic derecho en el ícono) ────────────────────
function crearMenuContextual() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       'toggleAuto',
      title:    '🤖 Activar modo automático',
      contexts: ['action']
    });
  });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'toggleAuto') return;
  chrome.storage.local.get(['modoAuto'], data => {
    const nuevo = !data.modoAuto;
    chrome.storage.local.set({ modoAuto: nuevo }, () => {
      actualizarMenuContextual(nuevo);
      if (nuevo) {
        iniciarModoAuto();
      } else {
        detenerModoAuto();
      }
    });
  });
});

function actualizarMenuContextual(activo) {
  // Recrear siempre en vez de update para evitar errores si el menú no existe
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       'toggleAuto',
      title:    activo ? '⏹ Desactivar modo automático' : '🤖 Activar modo automático',
      contexts: ['action']
    });
  });
  if (activo) {
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' }).catch(() => {});
    iniciarParpadeo();
  } else {
    detenerParpadeo();
  }
}

// ── PARPADEO DEL BADGE ────────────────────────────────────────────
let blinkInterval = null;
let blinkState    = false;

function iniciarParpadeo() {
  if (blinkInterval) return;
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' }).catch(() => {});
  blinkInterval = setInterval(() => {
    blinkState = !blinkState;
    chrome.action.setBadgeText({ text: blinkState ? 'AUTO' : '' }).catch(() => {});
  }, 700);
}

function detenerParpadeo() {
  if (blinkInterval) { clearInterval(blinkInterval); blinkInterval = null; }
  blinkState = false;
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}

// ── MODO AUTOMÁTICO: CDP WebSocket monitoring ─────────────────────
let modoAutoTabId    = null;
let debuggerAttached = false;

async function iniciarModoAuto() {
  const tabs = await chrome.tabs.query({});
  const dialerTab = tabs.find(t => t.url && (
    t.url.includes('vocalcom') ||
    t.url.includes('hermes360') ||
    t.url.includes('PlateformPublication')
  ));
  if (!dialerTab) {
    // Guardar para reconectar cuando abra Vocalcom
    modoAutoTabId = null;
    return { ok: false, error: 'Discador no encontrado' };
  }
  modoAutoTabId = dialerTab.id;
  await attachDebuggerAuto(modoAutoTabId);
  return { ok: true };
}

function detenerModoAuto() {
  if (debuggerAttached && modoAutoTabId) {
    chrome.debugger.detach({ tabId: modoAutoTabId }).catch(() => {});
    debuggerAttached = false;
  }
  modoAutoTabId = null;
}

async function attachDebuggerAuto(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
    debuggerAttached = true;
  } catch(e) {
    debuggerAttached = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  INTEGRACIÓN NATIVA CON ATLAS
//  En vez de simular Ctrl+K dentro de Atlas y luego scrapear el texto
//  renderizado de la ficha (frágil: depende de labels en español,
//  estructura del DOM, etc.), la extensión solo avisa a Atlas el
//  número detectado. Atlas hace el match contra `leads`, registra el
//  evento en `call_events` (mismo patrón que el resto del ciclo de
//  vida de la llamada) y su propio frontend escucha ese evento por
//  Supabase Realtime para navegar automáticamente a la ficha del lead.
//  La extensión deja de tocar el DOM de Atlas por completo.
// ══════════════════════════════════════════════════════════════════
const ATLAS_API_URL = 'https://atlas.geimser.cl/api/dialer/incoming';

async function enviarLlamadaAAtlasNativo(phone) {
  try {
    const res = await fetch(ATLAS_API_URL, {
      method: 'POST',
      credentials: 'include', // usa la cookie de sesión de Atlas ya logueada en el navegador
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      chrome.storage.local.set({
        tempPhone: { number: phone, status: 'error', error: data.error || res.statusText, capturedAt: Date.now() }
      });
      return;
    }

    if (data.matched) {
      // Atlas ya registró el call_event y su propio frontend (vía Realtime)
      // navega al agente a la ficha del lead — no hace falta hacer nada más aquí.
      chrome.storage.local.set({
        tempPhone: { number: phone, status: 'matched', lead: data.lead, leadId: data.leadId, capturedAt: Date.now() }
      });
    } else {
      chrome.storage.local.set({
        tempPhone: { number: phone, status: 'not_found', capturedAt: Date.now() }
      });
    }
  } catch (e) {
    chrome.storage.local.set({
      tempPhone: { number: phone, status: 'error', error: String(e), capturedAt: Date.now() }
    });
  }
}

// Escuchar frames WebSocket via CDP
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Network.webSocketFrameReceived') return;
  const payload = params?.response?.payloadData || '';
  if (!payload.includes('OPEN_SESSION')) return;
  const m = payload.match(/\/T\s+(\d{9,12})\b/);
  if (!m) return;
  const raw   = m[1];
  const phone = raw.startsWith('56') ? '+' + raw : '+56' + raw;
  // Guardar número para que el popup lo muestre mientras Atlas procesa
  chrome.storage.local.set({
    tempPhone: { number: phone, status: 'pending', capturedAt: Date.now() }
  });
  // Avisar a Atlas — el match, el registro del evento y la navegación
  // a la ficha del lead ahora viven ahí, no en la extensión.
  enviarLlamadaAAtlasNativo(phone).catch(() => {});
});

// Reconectar si Vocalcom recarga
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== modoAutoTabId) return;
  debuggerAttached = false;
  setTimeout(() => {
    chrome.storage.local.get(['modoAuto'], data => {
      if (data.modoAuto && modoAutoTabId) attachDebuggerAuto(modoAutoTabId).catch(() => {});
    });
  }, 2000);
});

// Si Vocalcom termina de cargar y modo auto está activo → reconectar
// ── Detectar Vocalcom con tabs.onUpdated (carga completa) ──────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;

  const esVocalcom = tab.url.includes('vocalcom') ||
                     tab.url.includes('hermes360') ||
                     tab.url.includes('PlateformPublication');

  if (esVocalcom) {
    chrome.storage.local.get(['modoAuto'], data => {
      if (!data.modoAuto) return;
      modoAutoTabId    = tabId;
      debuggerAttached = false;
      attachDebuggerAuto(tabId).catch(() => {});
    });
  }
});

// ── Detectar ficha de cliente en Atlas via webNavigation ──────────
// Atlas es SPA — la URL cambia sin recargar la página.
// webNavigation.onHistoryStateUpdated detecta esos cambios de URL.
// Último matchedLeadId procesado — evita extracciones duplicadas
let _lastLeadId = null;
let _extractTimer = null;

function manejarNavegacionAtlas(details) {
  if (!details.url) return;
  if (!details.url.includes('atlas.geimser.cl')) return;
  if (!details.url.includes('matchedLeadId=')) return;

  // Extraer el matchedLeadId de la URL
  const m = details.url.match(/matchedLeadId=([^&]+)/);
  const leadId = m ? m[1] : null;
  if (!leadId) return;

  // Si es el mismo cliente que ya procesamos, ignorar
  if (leadId === _lastLeadId) return;

  chrome.storage.local.get(['modoAuto'], data => {
    if (!data.modoAuto) return;

    // Cancelar extracción anterior si estaba pendiente
    if (_extractTimer) { clearTimeout(_extractTimer); _extractTimer = null; }

    _lastLeadId = leadId;
    chrome.storage.local.set({ extrayendo: true });

    // Esperar que la ficha renderice completamente antes de extraer
    _extractTimer = setTimeout(() => {
      _extractTimer = null;
      extraerFichaAtlas(details.tabId);
    }, 2000);
  });
}

chrome.webNavigation.onHistoryStateUpdated.addListener(manejarNavegacionAtlas, {
  url: [{ hostContains: 'atlas.geimser.cl' }]
});
chrome.webNavigation.onCompleted.addListener(manejarNavegacionAtlas, {
  url: [{ hostContains: 'atlas.geimser.cl' }]
});

// ── EXTRACCIÓN AUTOMÁTICA desde ficha Atlas ───────────────────────
async function extraerFichaAtlas(tabId) {
  // Esperar que el DOM esté listo (sin spinners)
  await esperarCargaTab(tabId, 8000);
  await sleep(600);

  const extractResult = await chrome.scripting.executeScript({
    target: { tabId },
    files:  ['content.js']
  }).catch(() => null);

  const payload = extractResult?.[0]?.result;
  if (!payload || !payload.text) return;

  // Recuperar el teléfono activo del storage
  const stored = await new Promise(res =>
    chrome.storage.local.get(['tempPhone'], d => res(d.tempPhone))
  );
  const phone = stored?.number || payload.phone || '';

  // Guardar resultado y limpiar flag extrayendo atomicamente
  chrome.storage.local.set({
    autoExtractResult: { ...payload, capturedAt: Date.now(), phone },
    extrayendo: false
  });

  // Notificar al popup si está abierto
  chrome.runtime.sendMessage({
    type: 'AUTO_EXTRACT_RESULT',
    payload: { ...payload, phone }
  }).catch(() => {});

  // Mostrar overlay flotante en Atlas con los datos del cliente
  mostrarOverlayEnAtlas(tabId, payload, phone);
}

async function mostrarOverlayEnAtlas(tabId, payload, phone) {
  try {
    // Cerrar ventana anterior si existe
    if (mostrarOverlayEnAtlas._winId) {
      chrome.windows.remove(mostrarOverlayEnAtlas._winId).catch(() => {});
      mostrarOverlayEnAtlas._winId = null;
    }

    // Esperar que autoExtractResult esté guardado en storage
    await sleep(400);

    // ── OPCIÓN 1: chrome.action.openPopup() — Chrome/Edge 127+ ──
    // Abre el popup REAL de la extensión (botones funcionales, historial, todo)
    // Solo requiere que la ventana del navegador esté enfocada.
    const atlasTabs = await chrome.tabs.query({ url: '*://atlas.geimser.cl/*' });
    if (atlasTabs.length) {
      await chrome.windows.update(atlasTabs[0].windowId, { focused: true });
      await sleep(200);
    }
    const opened = await chrome.action.openPopup().then(() => true).catch(() => false);
    if (opened) return; // Funcionó — popup real abierto

    // ── OPCIÓN 2: Ventana independiente (fallback Chrome < 127) ──
    const atlasWin = atlasTabs.length
      ? await chrome.windows.get(atlasTabs[0].windowId).catch(() => null)
      : null;
    const W = 400, H = 600;
    const left = atlasWin ? Math.max(0, atlasWin.left + atlasWin.width - W - 10) : 1050;
    const top  = atlasWin ? atlasWin.top + 60 : 60;

    const win = await chrome.windows.create({
      url:     chrome.runtime.getURL('popup.html'),
      type:    'popup',
      width:   W,
      height:  H,
      top,
      left,
      focused: true
    });
    mostrarOverlayEnAtlas._winId = win.id;
  } catch(e) {}
}
mostrarOverlayEnAtlas._winId = null;

// ── MENSAJES DESDE POPUP ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'PHONE_DETECTED') {
    chrome.storage.local.get(['tempPhone'], data => {
      if (data.tempPhone && data.tempPhone.status === 'pending') {
        sendResponse({ stored: false, reason: 'already_pending' }); return;
      }
      chrome.storage.local.set({
        tempPhone: { number: msg.number, status: 'pending', capturedAt: Date.now() }
      }, () => sendResponse({ stored: true }));
    });
    return true;
  }

  if (msg.type === 'RELEASE_TEMP_PHONE') {
    chrome.storage.local.remove('tempPhone', () => sendResponse({ ok: true }));
    return true;
  }

  // REGISTRAR_NUMERO: crear registro "sin extraer" inmediatamente
  if (msg.type === 'REGISTRAR_NUMERO') {
    const phone = msg.phone;
    if (!phone) { sendResponse({ ok: false }); return true; }
    chrome.storage.local.get(['records'], data => {
      const records = data.records || [];
      // No duplicar si ya existe el mismo número en los últimos 10 minutos
      const yaExiste = records.some(r =>
        r.phoneOriginal === phone && (Date.now() - (r.timestamp || 0)) < 600000
      );
      if (yaExiste) { sendResponse({ ok: true, dup: true }); return; }
      const now = new Date();
      const record = {
        id:            Date.now().toString(36) + Math.random().toString(36).slice(2),
        timestamp:     Date.now(),
        fecha:         now.toLocaleDateString('es-CL'),
        hora:          now.toLocaleTimeString('es-CL', {hour:'2-digit',minute:'2-digit'}),
        phoneOriginal: phone,
        estado:        'sin_extraer',
        razonSocial:'', nombre:'', rut:'', rubro:'',
        actividad:'', segmento:'', telefonoCRM:'',
        correo:'', observaciones:'', sourceUrl:''
      };
      records.unshift(record);
      chrome.storage.local.set({ records }, () =>
        sendResponse({ ok: true, total: records.length, id: record.id })
      );
    });
    return true;
  }

  // SAVE_RECORD: actualizar registro existente a "extraido" o crear nuevo
  if (msg.type === 'SAVE_RECORD') {
    const phone = msg.record.phoneOriginal;
    chrome.storage.local.get(['records'], data => {
      const records = data.records || [];
      // Buscar registro existente para este número:
      //  - "sin extraer" (caso original), o
      //  - ya "extraido" pero dentro de los últimos 10 minutos (misma ventana
      //    que usa REGISTRAR_NUMERO) — evita crear un duplicado cuando
      //    autoSaveRecord() se dispara más de una vez para la misma extracción
      //    (ej: modo AUTO + reapertura del popup).
      const idx = records.findIndex(r =>
        r.phoneOriginal === phone &&
        (r.estado !== 'extraido' || (Date.now() - (r.timestamp || 0)) < 600000)
      );
      const crmData = Object.assign({}, msg.record, { estado: 'extraido' });
      if (idx >= 0) {
        // Actualizar: mantener id, timestamp, fecha, hora, observaciones originales
        records[idx] = Object.assign({}, records[idx], crmData);
      } else {
        // Crear nuevo con ID generado aquí
        crmData.id        = Date.now().toString(36) + Math.random().toString(36).slice(2);
        crmData.timestamp = crmData.timestamp || Date.now();
        records.unshift(crmData);
      }
      chrome.storage.local.set({ records }, () =>
        sendResponse({ ok: true, total: records.length })
      );
    });
    return true;
  }

  if (msg.type === 'UPDATE_RECORD') {
    chrome.storage.local.get(['records'], data => {
      const records = data.records || [];
      const idx = records.findIndex(r => r.id === msg.id);
      if (idx >= 0) Object.assign(records[idx], msg.patch);
      chrome.storage.local.set({ records }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg.type === 'DELETE_RECORD') {
    chrome.storage.local.get(['records'], data => {
      const records = (data.records || []).filter(r => r.id !== msg.id);
      chrome.storage.local.set({ records }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg.type === 'CLEAR_ALL') {
    chrome.storage.local.remove('records', () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'BUSCAR_EN_ATLAS') {
    // Búsqueda manual desde el popup: Ctrl+K → buscar → clic → Enter
    buscarEnAtlas(msg.phone)
      .then(res => sendResponse(res))
      .catch(e  => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SEND_TO_COTIZADORA') {
    // Nueva funcionalidad — NO toca el flujo manual existente (copiar Excel /
    // abrir cotizadora / pegar datos CRM), que sigue intacto.
    enviarACotizadora(msg.tsv)
      .then(res => sendResponse(res))
      .catch(e  => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'GET_MODO_AUTO') {
    chrome.storage.local.get(['modoAuto'], data => sendResponse({ activo: !!data.modoAuto }));
    return true;
  }

  // Leer número del discador — funciona siempre, con o sin modo AUTO
  if (msg.type === 'READ_PHONE_FROM_DIALER') {
    (async () => {
      const CDP_EXPR = `(function(){
        function norm(s){var c=String(s).replace(/\D/g,'');if(c.length<9)return null;if(c.startsWith('56')&&c.length>=10)return '+'+c;if(c.length===9)return '+56'+c;return null;}
        // Priorizar celulares 569XXXXXXXX (11 dígitos) sobre números de trunk
        var candidates=[];
        var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
        var node;
        while((node=walker.nextNode())){
          var tag=node.parentElement&&node.parentElement.tagName?node.parentElement.tagName.toLowerCase():'';
          if(tag==='script'||tag==='style')continue;
          var raw=node.textContent.trim();
          if(raw.length>20)continue;
          var c=raw.replace(/\D/g,'');
          if(c.length>=9&&c.length<=12){var p=norm(c);if(p)candidates.push({p:p,len:c.length});}
        }
        // Preferir 569... de 11 dígitos
        var cel=candidates.filter(function(x){return x.len===11&&x.p.startsWith('+569');});
        if(cel.length)return cel[0].p;
        var any11=candidates.filter(function(x){return x.len===11;});
        if(any11.length)return any11[0].p;
        if(candidates.length)return candidates[0].p;
        return null;
      })()`;

      // ── FUENTE 1: tempPhone del storage (llenado por WebSocket CDP en llamadas entrantes) ──
      const stored = await new Promise(res =>
        chrome.storage.local.get(['tempPhone'], d => res(d.tempPhone))
      );
      if (stored && stored.number) {
        sendResponse({ phone: stored.number, source: 'tempPhone' });
        return;
      }

      // Localizar pestaña del discador
      const tabs = await chrome.tabs.query({});
      const dialerTab = tabs.find(t => t.url && (
        t.url.includes('vocalcom') ||
        t.url.includes('hermes360') ||
        t.url.includes('PlateformPublication')
      ));
      if (!dialerTab) { sendResponse({ phone: null, error: 'Discador no encontrado' }); return; }
      const tabId = dialerTab.id;

      // ── FUENTE 2: CDP con debugger ya adjunto (modo AUTO activo) ──
      if (debuggerAttached && modoAutoTabId === tabId) {
        try {
          const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate',
            { expression: CDP_EXPR, returnByValue: true });
          const phone = r?.result?.value || null;
          if (phone) { sendResponse({ phone, source: 'cdp_attached' }); return; }
        } catch(e) {}
      }

      // ── FUENTE 3: Adjuntar debugger temporal para leer DOM vía CDP ──
      // Funciona aunque el modo AUTO esté activo porque usamos attach/detach rápido
      // en una sesión separada del debugger del modo AUTO.
      // NOTA: Chrome permite un solo debugger por tab — si el modo AUTO ya tiene uno
      // adjunto y este intento falla, caemos al scripting.
      let cdpPhone = null;
      const tempDbg = { tabId };
      try {
        await chrome.debugger.attach(tempDbg, '1.3');
        const r = await chrome.debugger.sendCommand(tempDbg, 'Runtime.evaluate',
          { expression: CDP_EXPR, returnByValue: true });
        cdpPhone = r?.result?.value || null;
        await chrome.debugger.detach(tempDbg).catch(() => {});
      } catch(e) {
        await chrome.debugger.detach(tempDbg).catch(() => {});
      }
      if (cdpPhone) { sendResponse({ phone: cdpPhone, source: 'cdp_temp' }); return; }

      // ── FUENTE 4: scripting.executeScript (fallback cuando no hay debugger) ──
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          files:  ['content_dialer.js']
        });
        const phone = results?.[0]?.result?.phone || null;
        sendResponse({ phone, source: 'scripting' });
      } catch(e) {
        sendResponse({ phone: null, error: e.message });
      }
    })();
    return true;
  }
});

// ── BUSCAR EN ATLAS ───────────────────────────────────────────────
async function buscarEnAtlas(num) {
  const tabs = await chrome.tabs.query({ url: '*://atlas.geimser.cl/*' });
  if (!tabs.length) return { ok: false, error: 'Atlas no está abierto' };

  const target = tabs.find(t => t.url.includes('/app/calls')) || tabs[0];
  const tabId  = target.id;

  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(target.windowId, { focused: true });
  await sleep(500);

  // Abrir buscador Ctrl+K y escribir número todo en un solo executeScript
  // sin usar debugger (que puede estar ocupado con Vocalcom en modo AUTO)
  const searchResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: (numero) => new Promise((resolve) => {

      // Intentar abrir el dialog con Ctrl+K via KeyboardEvent en el document
      function abrirCtrlK() {
        const e = new KeyboardEvent('keydown', {
          key: 'k', code: 'KeyK', keyCode: 75, which: 75,
          ctrlKey: true, metaKey: false,
          bubbles: true, cancelable: true
        });
        document.dispatchEvent(e);
        document.body.dispatchEvent(e);
        // También intentar en el elemento activo
        if (document.activeElement) document.activeElement.dispatchEvent(e);
      }

      function pegarEnInput() {
        const input =
          document.querySelector('[cmdk-input]') ||
          document.querySelector('[role="dialog"] input') ||
          document.querySelector('input[placeholder*="uscar"]') ||
          document.querySelector('input[placeholder*="earch"]');
        if (!input) return false;
        input.focus();
        // Usar setter nativo para que React/cmdk detecte el cambio
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, numero); else input.value = numero;
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      // Intentar abrir el dialog
      abrirCtrlK();

      // Polling: esperar que aparezca el input y pegar el número
      let attempts = 0;
      const poll = setInterval(() => {
        if (pegarEnInput()) {
          clearInterval(poll);
          resolve({ ok: true });
          return;
        }
        attempts++;
        if (attempts % 5 === 0) abrirCtrlK(); // reintentar Ctrl+K cada 500ms
        if (attempts > 60) {
          clearInterval(poll);
          resolve({ ok: false, error: 'No se pudo abrir el buscador' });
        }
      }, 100);
    }),
    args: [num]
  });

  return searchResult?.[0]?.result || { ok: true };
}

// ── ENVIAR A COTIZADORA ───────────────────────────────────────────
// Nueva funcionalidad — NO reemplaza el flujo manual (copiar Excel,
// abrir cotizadora, presionar "Pegar datos CRM" a mano), que sigue intacto.
// Reutiliza exactamente el mismo TSV que ya genera buildExcelTSV() en popup.js
// y reutiliza el botón "Pegar datos CRM" ya existente en la cotizadora —
// no reimplementa ningún mapeo de campos.
const COTIZADORA_URL_PATTERN = 'https://cotizadora.github.io/Cotizadora/*';
const COTIZADORA_URL_BASE    = 'https://cotizadora.github.io/Cotizadora/';

async function enviarACotizadora(tsv) {
  if (!tsv) return { ok: false, error: 'Sin datos para enviar' };

  // 1. Buscar si la cotizadora ya está abierta — evita acumulación de pestañas.
  let tabs = await chrome.tabs.query({ url: COTIZADORA_URL_PATTERN });
  let tabId, windowId;

  if (tabs.length) {
    // Reutilizar la pestaña existente — nunca abrir una nueva.
    tabId    = tabs[0].id;
    windowId = tabs[0].windowId;
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  } else {
    // No existe ninguna — abrir una única pestaña nueva.
    const created = await chrome.tabs.create({ url: COTIZADORA_URL_BASE });
    tabId    = created.id;
    windowId = created.windowId;
  }

  // 2. Esperar que la pestaña esté completamente cargada.
  await esperarCargaTab(tabId, 15000);
  await sleep(400);

  // 3. Escribir el TSV directamente en el portapapeles desde dentro de esa
  //    pestaña (el service worker no tiene acceso a navigator.clipboard).
  const copied = await chrome.scripting.executeScript({
    target: { tabId },
    func: (t) => navigator.clipboard.writeText(t).then(() => true).catch(() => false),
    args: [tsv]
  }).then(r => !!r?.[0]?.result).catch(() => false);

  if (!copied) return { ok: false, error: 'No se pudo copiar al portapapeles en la cotizadora' };

  // 4. Disparar el botón "Pegar datos CRM" ya existente en la cotizadora.
  //    NO se reimplementa el mapeo de campos: solo se simula el click sobre
  //    el botón que ya distribuye los datos correctamente (id real: btn-crm-paste).
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const btn = document.getElementById('btn-crm-paste') ||
        Array.from(document.querySelectorAll('button, [role="button"], a'))
          .find(el => (el.textContent || '').toLowerCase().includes('pegar datos del crm'));
      if (!btn) return { ok: false, error: 'No se encontró el botón "Pegar datos del CRM"' };
      btn.click();
      return { ok: true };
    }
  }).catch(e => [{ result: { ok: false, error: e.message } }]);

  const clickRes = result?.[0]?.result || { ok: false, error: 'Sin respuesta de la cotizadora' };
  return clickRes;
}

// ── FLUJO COMPLETO AUTO: Ctrl+K → pegar → Enter → esperar ficha → extraer ─
async function buscarEnAtlasYExtraer(num) {
  // 1. Buscar en Atlas (Ctrl+K + número + Enter)
  const buscarRes = await buscarEnAtlas(num);
  if (!buscarRes.ok) return buscarRes;

  // 2. Localizar la pestaña Atlas
  const tabs = await chrome.tabs.query({ url: '*://atlas.geimser.cl/*' });
  if (!tabs.length) return { ok: false, error: 'Atlas no está abierto' };
  const target = tabs.find(t => t.url.includes('/app/calls')) || tabs[0];
  const tabId  = target.id;

  // 3. Esperar que la ficha del cliente cargue
  await sleep(2500);
  await esperarCargaTab(tabId, 12000);
  await sleep(800);

  // 4. Verificar que el dialog ya se cerró (ficha abierta)
  const check = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ hasDialog: !!document.querySelector('[role="dialog"]') })
  });
  if (check?.[0]?.result?.hasDialog) {
    await sleep(2000);
    await esperarCargaTab(tabId, 8000);
  }

  // 5. Extraer datos de la ficha
  const extractResult = await chrome.scripting.executeScript({
    target: { tabId },
    files:  ['content.js']
  });

  const payload = extractResult?.[0]?.result;
  if (!payload || !payload.text) {
    return { ok: false, error: 'No se pudo extraer texto de la ficha CRM' };
  }

  // 6. Guardar resultado en storage para que el popup lo tome
  chrome.storage.local.set({
    autoExtractResult: {
      ...payload,
      capturedAt: Date.now(),
      phone: num
    }
  });

  // 7. Notificar al popup si está abierto
  chrome.runtime.sendMessage({
    type:    'AUTO_EXTRACT_RESULT',
    payload: { ...payload, phone: num }
  }).catch(() => {});

  // 8. Mostrar overlay en Atlas
  mostrarOverlayEnAtlas(tabId, payload, num);

  return { ok: true, extracted: true };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function esperarCargaTab(tabId, timeoutMs) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError || !tab) { resolve(); return; }
        if (tab.status === 'complete')         { resolve(); return; }
        if (Date.now() > deadline)             { resolve(); return; }
        setTimeout(check, 300);
      });
    };
    setTimeout(check, 800);
  });
}

async function enviarCtrlKDebugger(tabId) {
  const dbg = { tabId };
  try {
    await chrome.debugger.attach(dbg, '1.3');
    await chrome.debugger.sendCommand(dbg, 'Runtime.evaluate', { expression: 'window.focus();' });
    await sleep(200);
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'k', code: 'KeyK',
      windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75,
      modifiers: 2, isSystemKey: false
    });
    await sleep(80);
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'k', code: 'KeyK',
      windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: 2
    });
    await sleep(400);
  } finally {
    try { await chrome.debugger.detach(dbg); } catch(_) {}
  }
}

async function enviarEscDebugger(tabId) {
  const dbg = { tabId };
  try {
    await chrome.debugger.attach(dbg, '1.3');
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape',
      windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, modifiers: 0
    });
    await sleep(60);
    await chrome.debugger.sendCommand(dbg, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Escape', code: 'Escape',
      windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, modifiers: 0
    });
  } finally {
    try { await chrome.debugger.detach(dbg); } catch(_) {}
  }
}

// Restaurar estado del modo auto al arrancar el service worker
chrome.storage.local.get(['modoAuto'], data => {
  actualizarMenuContextual(!!data.modoAuto);
  if (data.modoAuto) iniciarModoAuto();
});
