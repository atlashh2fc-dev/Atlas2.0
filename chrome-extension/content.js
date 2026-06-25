// ══════════════════════════════════════════════════════════════════
//  CONTENT SCRIPT — CRM Extractor Pro
//  Se inyecta en la pestaña activa cuando el ejecutivo presiona
//  "Capturar página actual" desde el popup.
//
//  Responsabilidades:
//    1. Leer el texto visible del DOM completo
//    2. Opcionalmente leer el HTML fuente
//    3. Enviar ambos al popup para que el parser interno los procese
//    4. NO hace ningún parser aquí — solo extrae bruto
// ══════════════════════════════════════════════════════════════════

(function () {
  // ── 1. EXTRAER TEXTO VISIBLE ──────────────────────────────────
  // Recorremos el body completo y recolectamos todos los text nodes visibles.
  // Esto es más robusto que innerText porque incluye tablas, divs ocultos con
  // datos y etiquetas <label>/<span> que el CRM suele usar.

  function getVisibleText() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Omitir scripts, styles y nodos vacíos
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'svg'].includes(tag))
            return NodeFilter.FILTER_REJECT;
          const text = node.textContent.trim();
          if (!text) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const lines = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t) lines.push(t);
    }
    return lines.join('\n');
  }

  // ── 2. INTENTAR EXTRAER TAMBIÉN PARES LABEL→VALOR ────────────
  // Muchos CRMs muestran los datos como pares etiqueta/valor.
  // Armamos un mapa estructurado que facilita el parser.
  function getLabelValuePairs() {
    const pairs = {};
    // Patrón 1: <label> seguido de texto en elemento hermano o hijo
    document.querySelectorAll('label').forEach(label => {
      const key = label.textContent.trim().replace(/:$/, '');
      if (!key) return;
      // Busca el campo asociado via "for" o hermano siguiente
      let valueEl = null;
      if (label.htmlFor) valueEl = document.getElementById(label.htmlFor);
      if (!valueEl) valueEl = label.nextElementSibling;
      if (valueEl) {
        const val = (valueEl.value || valueEl.textContent || '').trim();
        if (val) pairs[key] = val;
      }
    });

    // Patrón 2: elementos con data-label o title como clave
    document.querySelectorAll('[data-label], [data-field], [data-key]').forEach(el => {
      const key = el.getAttribute('data-label') || el.getAttribute('data-field') || el.getAttribute('data-key');
      const val = (el.value || el.textContent || '').trim();
      if (key && val) pairs[key] = val;
    });

    return pairs;
  }

  // ── 3. ENVIAR AL POPUP ────────────────────────────────────────
  const payload = {
    type:       'PAGE_CAPTURED',
    url:        window.location.href,
    title:      document.title,
    text:       getVisibleText(),
    html:       document.documentElement.outerHTML.substring(0, 200000), // límite 200KB
    pairs:      getLabelValuePairs(),
    capturedAt: Date.now()
  };

  // Enviamos al runtime (el popup lo estará esperando via chrome.runtime.onMessage
  // o directamente como respuesta al scripting.executeScript)
  chrome.runtime.sendMessage(payload);

  // También lo retornamos como valor para scripting.executeScript({func})
  return payload;
})();