/* =========================================================
   MAESTRA - Llave maestra de soporte (solicitud y respuesta)
   Sirve para ayudar a alguien que perdió su PIN o su contraseña,
   SIN guardar ninguna clave secreta dentro de la app:
   - La app solo trae la llave PÚBLICA del soporte (PUB).
   - La llave PRIVADA solo la tiene el dueño del sistema.
   - Quien pide ayuda recibe un "código de solicitud" y se lo manda
     al soporte. El soporte contesta con un "código de respuesta".
   - Cada respuesta sirve para UNA sola solicitud y UN solo teléfono.
   ========================================================= */

const Maestra = {
  // Llave pública del soporte. Se genera en soporte.html ("Crear mi llave maestra").
  PUB: 'BGKj96h2l7hYeZILiY7mcFbVdDd7tNZD_q-eihiMCquLV-_2dmS3lSb2FVA4TeWeX6hvP0dhpio1yWKIXvJWD00',

  VIGENCIA: 48 * 3600 * 1000,   // una solicitud vale 48 horas
  CURVA: { name: 'ECDH', namedCurve: 'P-256' },

  listo() { return !!(this.PUB && window.crypto && crypto.subtle); },

  _b64u(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  _deB64u(txt) {
    let t = String(txt).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const s = atob(t);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  },

  _pub() { return crypto.subtle.importKey('raw', this._deB64u(this.PUB), this.CURVA, false, []); },

  async _llave(bits, sal, info) {
    const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: sal, info: new TextEncoder().encode(info) },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },

  // Huella corta para comprobar por teléfono que ambos ven la misma solicitud
  async huella(bytes) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const x = [...h.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return x.slice(0, 4) + '-' + x.slice(4);
  },

  // Copia de la llave de datos, cifrada para que SOLO el soporte pueda abrirla.
  // Se guarda junto a los datos cifrados (Bóveda) si el dueño lo permite.
  async guardarCopia(dek) {
    const par = await crypto.subtle.generateKey(this.CURVA, true, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await this._pub() }, par.privateKey, 256);
    const k = await this._llave(bits, new TextEncoder().encode('tienda-escrow'), 'tienda-maestra-escrow-v1');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, dek));
    const epk = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
    const out = new Uint8Array(65 + 12 + ct.length);
    out.set(epk, 0); out.set(iv, 65); out.set(ct, 77);
    return this._b64u(out);
  },

  /* ---------- Solicitud ---------- */
  pendiente() {
    try {
      const p = JSON.parse(localStorage.getItem('sec_maestra'));
      if (p && p.hasta > Date.now()) return p;
    } catch (e) { /* nada */ }
    this.cancelar();
    return null;
  },

  cancelar() { try { localStorage.removeItem('sec_maestra'); } catch (e) { /* nada */ } },

  // tipo: 'pin' (reiniciar el PIN) o 'dek' (abrir datos cifrados; necesita c3)
  async solicitar(tipo, c3) {
    const previa = this.pendiente();
    if (previa && previa.t === tipo && (previa.c3 || null) === (c3 || null)) {
      return { codigo: previa.codigo, huella: previa.huella };   // misma solicitud, mismo código
    }
    const par = await crypto.subtle.generateKey(this.CURVA, true, ['deriveBits']);
    const epub = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const c3b = tipo === 'dek' ? this._deB64u(c3) : new Uint8Array(0);
    const bytes = new Uint8Array(79 + c3b.length);
    bytes[0] = 1;
    bytes[1] = tipo === 'dek' ? 2 : 1;
    bytes.set(nonce, 2);
    bytes.set(epub, 14);
    bytes.set(c3b, 79);
    const codigo = 'SOL1-' + this._b64u(bytes);
    const huella = await this.huella(epub);
    const priv = await crypto.subtle.exportKey('jwk', par.privateKey);
    try {
      localStorage.setItem('sec_maestra', JSON.stringify({
        t: tipo, n: this._b64u(nonce), priv, c3: c3 || null, codigo, huella, hasta: Date.now() + this.VIGENCIA
      }));
    } catch (e) { /* sin espacio: la solicitud igual sirve mientras no se cierre */ }
    return { codigo, huella };
  },

  // Devuelve { tipo, dek? } o { error }
  async abrirRespuesta(texto) {
    const p = this.pendiente();
    if (!p) return { error: 'La solicitud venció. Pide una nueva.' };
    try {
      const t = String(texto || '').replace(/\s+/g, '');
      if (!t.startsWith('RES1-')) return { error: 'Eso no es un código de respuesta' };
      const b = this._deB64u(t.slice(5));
      if (b[0] !== 1 || b.length < 30) return { error: 'El código de respuesta está incompleto' };
      const iv = b.slice(1, 13), ct = b.slice(13);

      const priv = await crypto.subtle.importKey('jwk', p.priv, this.CURVA, false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await this._pub() }, priv, 256);
      const nonce = this._deB64u(p.n);
      const k = await this._llave(bits, nonce, 'tienda-maestra-resp-v1');
      const plano = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: nonce }, k, ct));
      const o = JSON.parse(new TextDecoder().decode(plano));

      if (o.t !== p.t || o.n !== p.n) return { error: 'Ese código es de otra solicitud' };
      const out = { tipo: o.t };
      if (o.t === 'dek') {
        const d = this._deB64u(o.dek);
        if (d.length !== 32) return { error: 'El código de respuesta está dañado' };
        out.dek = d;
      }
      this.cancelar();   // un código de respuesta sirve una sola vez
      return out;
    } catch (e) {
      return { error: 'Código incorrecto. Revisa que lo copiaste completo y que es para esta solicitud.' };
    }
  },

  /* ---------- Pantalla (dentro de la pantalla de bloqueo) ----------
     tipo: 'pin' | 'dek'
     mostrar(html) -> dibuja en la pantalla de bloqueo y devuelve el elemento
     volver()      -> regresa a la pantalla anterior
     exito(r)      -> se llama con la respuesta válida; devuelve true si todo salió bien */
  async pantalla({ tipo, c3, mostrar, volver, exito }) {
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    mostrar(`<div class="lock-box"><div class="lock-logo"><i data-lucide="life-buoy"></i></div><h2>Ayuda de soporte</h2><p class="muted">Preparando tu solicitud…</p></div>`);

    let sol;
    try { sol = await this.solicitar(tipo, c3); }
    catch (e) {
      console.error(e);
      mostrar(`<div class="lock-box"><div class="lock-logo"><i data-lucide="life-buoy"></i></div><h2>Ayuda de soporte</h2>
        <p class="muted">No se pudo preparar la solicitud en este navegador.</p>
        <button type="button" class="lock-link" data-m="volver">Volver</button></div>`)
        .querySelector('[data-m="volver"]').onclick = () => volver();
      return;
    }

    const texto = tipo === 'pin'
      ? 'Mi PIN se me olvidó. Solicitud de ayuda:'
      : 'Olvidé mi contraseña de cifrado. Solicitud de ayuda:';
    const mensaje = `${texto}\n${sol.codigo}\nHuella: ${sol.huella}`;

    const el = mostrar(`
      <form class="lock-box form" autocomplete="off">
        <div class="lock-logo"><i data-lucide="life-buoy"></i></div>
        <h2>Ayuda de soporte</h2>
        <p class="muted">1) Envía este código a tu soporte.<br>2) Pega aquí el código que te conteste.</p>
        <textarea readonly rows="4" data-m="sol" style="width:100%;padding:10px;border:1.5px solid #d6ecfa;border-radius:12px;font:inherit;font-size:.72rem;word-break:break-all;background:#f5fbff">${esc(sol.codigo)}</textarea>
        <p class="muted" style="font-size:.8rem;margin:4px 0 8px">Huella: <b>${esc(sol.huella)}</b></p>
        <div class="row" style="gap:8px;justify-content:center">
          <button type="button" class="btn btn-soft btn-sm" data-m="copiar">Copiar</button>
          <button type="button" class="btn btn-soft btn-sm" data-m="compartir">Compartir</button>
        </div>
        <textarea name="resp" rows="3" placeholder="Pega aquí el código de respuesta" style="width:100%;padding:10px;margin-top:12px;border:1.5px solid #d6ecfa;border-radius:12px;font:inherit;font-size:.72rem;word-break:break-all"></textarea>
        <div class="lock-msg" id="lock-msg"></div>
        <button type="submit" class="btn btn-primary btn-block">Continuar</button>
        <button type="button" class="lock-link" data-m="volver">Volver</button>
      </form>`);

    const msg = t => { const m = el.querySelector('#lock-msg'); if (m) m.textContent = t || ''; };
    const f = el.querySelector('form');

    el.querySelector('[data-m="volver"]').onclick = () => volver();
    el.querySelector('[data-m="copiar"]').onclick = async () => {
      try { await navigator.clipboard.writeText(mensaje); msg(''); const b = el.querySelector('[data-m="copiar"]'); b.textContent = '¡Copiado!'; }
      catch (e) { const t = el.querySelector('[data-m="sol"]'); t.removeAttribute('readonly'); t.select(); try { document.execCommand('copy'); } catch (_) { /* nada */ } t.setAttribute('readonly', ''); }
    };
    el.querySelector('[data-m="compartir"]').onclick = async () => {
      try { if (navigator.share) await navigator.share({ text: mensaje }); else await navigator.clipboard.writeText(mensaje); } catch (e) { /* cancelado */ }
    };

    f.addEventListener('submit', async e => {
      e.preventDefault();
      e.stopPropagation();   // la pantalla de bloqueo no debe tratar este envío
      if (!f.resp.value.trim()) return msg('Pega el código de respuesta');
      const b = f.querySelector('button[type=submit]'); b.disabled = true; msg('Comprobando…');
      const r = await this.abrirRespuesta(f.resp.value);
      if (r.error) { b.disabled = false; return msg(r.error); }
      const ok = await exito(r);
      if (!ok) { b.disabled = false; msg('El código era válido pero no se pudo abrir. Pide una solicitud nueva.'); }
    });
  }
};