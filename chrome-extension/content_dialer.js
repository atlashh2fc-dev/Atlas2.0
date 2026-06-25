// ══════════════════════════════════════════════════════════════════
//  CONTENT_DIALER.JS — CRM Extractor Pro
//  Detecta el número del CLIENTE en Vocalcom Hermes360.
//  El número del cliente aparece en el panel verde "En línea"
//  junto al ícono de teléfono 📞, ej: "56999697471"
//  NO confundir con el número del trunk/campaña (ej: 56225204000)
// ══════════════════════════════════════════════════════════════════
(function () {

  function normalizePhone(raw) {
    const clean = String(raw).replace(/\D/g, '');
    if (clean.length < 9) return null;
    if (clean.startsWith('56') && clean.length >= 10) return '+' + clean;
    if (clean.length === 9) return '+56' + clean;
    return null;
  }

  function validPhone(str) {
    if (!str) return null;
    const clean = String(str).replace(/\D/g, '');
    if (clean.length < 9 || clean.length > 12) return null;
    // Debe empezar con 56 o ser celular/fijo chileno
    if (!clean.startsWith('56') && !/^[2-9]/.test(clean)) return null;
    return normalizePhone(clean);
  }

  // ── CAPA 1: Panel de llamada activa (bloque verde "En línea") ──
  // Es el contenedor más específico — contiene el número del cliente
  function tryActiveCallPanel() {
    // Buscar el contenedor del panel de llamada activa
    const panelSelectors = [
      // El bloque verde con "En línea" y el número
      '[class*="active-call"]',
      '[class*="activeCall"]',
      '[class*="call-active"]',
      '[class*="current-call"]',
      '[class*="currentCall"]',
      '[class*="call-info"]',
      '[class*="callInfo"]',
      '[class*="on-call"]',
      '[class*="oncall"]',
      // Hermes360 específico
      '[class*="interaction"]',
      '[class*="Interaction"]',
    ];

    for (const psel of panelSelectors) {
      const panels = document.querySelectorAll(psel);
      for (const panel of panels) {
        // Buscar el span/div con el número dentro del panel
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const clean = node.textContent.trim().replace(/\D/g, '');
          const p = validPhone(clean);
          if (p) return p;
        }
      }
    }
    return null;
  }

  // ── CAPA 2: Elemento con ícono de teléfono + número adyacente ──
  function tryPhoneIcon() {
    // Buscar elementos que contengan ícono de teléfono (svg, i, span con clase phone)
    const iconEls = document.querySelectorAll(
      '[class*="phone-icon"], [class*="phoneIcon"], [class*="icon-phone"], ' +
      '[class*="tel-icon"], svg[class*="phone"], i[class*="phone"]'
    );
    for (const icon of iconEls) {
      // Buscar el número en el elemento siguiente o en el padre
      const siblings = [icon.nextElementSibling, icon.parentElement, icon.parentElement?.nextElementSibling];
      for (const el of siblings) {
        if (!el) continue;
        const clean = (el.textContent || '').trim().replace(/\D/g, '');
        const p = validPhone(clean);
        if (p) return p;
      }
    }
    return null;
  }

  // ── CAPA 3: Nodos de texto — priorizar números de 11 dígitos con 56 ──
  function tryTextNodes() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const candidates = [];
    let node;
    while ((node = walker.nextNode())) {
      const tag = node.parentElement?.tagName?.toLowerCase();
      if (['script','style','noscript'].includes(tag)) continue;
      const raw = node.textContent.trim();
      const clean = raw.replace(/\D/g, '');
      const p = validPhone(clean);
      if (p && raw.length < 20) { // solo nodos cortos = más específicos
        candidates.push({ phone: p, len: clean.length, raw });
      }
    }
    if (!candidates.length) return null;
    // Preferir 56 + 9 dígitos (celular) de exactamente 11 dígitos
    const cel = candidates.filter(c => c.len === 11 && c.phone.startsWith('+569'));
    if (cel.length) return cel[0].phone;
    // Luego cualquier 11 dígitos con 56
    const any11 = candidates.filter(c => c.len === 11);
    if (any11.length) return any11[0].phone;
    return candidates[0].phone;
  }

  // ── CAPA 4: URL de la página ──────────────────────────────────
  function tryURL() {
    const url = window.location.href;
    const m = url.match(/[&?](?:phone|ani|dnis|calledNumber|number)=(\+?56[2-9]\d{7,9})/i);
    if (m) return normalizePhone(m[1]);
    return null;
  }

  // ── CAPA 5: HTML fuente ───────────────────────────────────────
  function tryHTML() {
    const html = document.documentElement.innerHTML;
    const patterns = [
      /"(?:phone|phoneNumber|ani|dnis|calledNumber)"\s*:\s*"(\+?56[2-9]\d{7,9})"/i,
      /data-(?:phone|number)="(\+?56[2-9]\d{7,9})"/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) { const p = validPhone(m[1]); if (p) return p; }
    }
    return null;
  }

  const phone =
    tryActiveCallPanel() ||
    tryPhoneIcon()       ||
    tryTextNodes()       ||
    tryURL()             ||
    tryHTML()            ||
    null;

  return {
    type:       'DIALER_PHONE_DETECTED',
    phone,
    url:        window.location.href,
    capturedAt: Date.now(),
  };
})();
