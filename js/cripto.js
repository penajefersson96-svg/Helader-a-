/* =========================================================
   CRIPTO - Cifra los respaldos con una contraseña (AES-256-GCM)
   La contraseña NUNCA se guarda en ningún lado: si se olvida,
   el respaldo no se puede abrir. La llave se fabrica con la
   contraseña usando PBKDF2 (600.000 vueltas, lento a propósito
   para que adivinarla por fuerza bruta sea muy costoso).
   ========================================================= */

const Cripto = {
  ITER: 600000,
  MARCA: 'tienda-respaldo',
  AAD: 'tienda-respaldo-v1',

  disponible() { return !!(window.crypto && crypto.subtle); },

  _aB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  },

  _deB64(txt) {
    const s = atob(String(txt));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  },

  async _clave(pass, sal, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },

  async cifrar(texto, pass) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const clave = await this._clave(pass, sal, this.ITER);
    const buf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(this.AAD) },
      clave, new TextEncoder().encode(texto)
    );
    return JSON.stringify({
      formato: this.MARCA, version: 1, cifrado: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
      iter: this.ITER, sal: this._aB64(sal), iv: this._aB64(iv), datos: this._aB64(new Uint8Array(buf))
    });
  },

  esCifrado(texto) {
    try { const o = JSON.parse(texto); return !!o && o.formato === this.MARCA; } catch (_) { return false; }
  },

  // Devuelve { texto } o { error }
  async descifrar(texto, pass) {
    let o;
    try { o = JSON.parse(texto); } catch (_) { return { error: 'El archivo no se puede leer' }; }
    if (!o || o.formato !== this.MARCA || o.version !== 1) return { error: 'Ese archivo no es un respaldo cifrado de este sistema' };
    // límites: un archivo malicioso no puede pedir una cantidad absurda de vueltas
    if (!Number.isInteger(o.iter) || o.iter < 100000 || o.iter > 2000000) return { error: 'El respaldo tiene datos dañados' };
    try {
      const sal = this._deB64(o.sal), iv = this._deB64(o.iv), datos = this._deB64(o.datos);
      if (sal.length !== 16 || iv.length !== 12 || datos.length < 17) return { error: 'El respaldo tiene datos dañados' };
      const clave = await this._clave(pass, sal, o.iter);
      const buf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(this.AAD) }, clave, datos
      );
      return { texto: new TextDecoder().decode(buf) };
    } catch (_) {
      return { error: 'Contraseña incorrecta o el archivo está dañado' };
    }
  },

  /* ---------- Ventanas ---------- */

  // Al respaldar: elegir contraseña o guardar sin proteger. alElegir(clave | null)
  elegir(alElegir) {
    if (!this.disponible()) {
      UI.toast('Este navegador no permite cifrar aquí. Se guardará sin contraseña.', 'error');
      return alElegir(null);
    }
    UI.openModal('Proteger el respaldo', `
      <form class="form" id="cr-form" autocomplete="off">
        <p class="muted">Un respaldo sin contraseña lo puede leer cualquiera que tenga el archivo. Con contraseña queda cifrado.</p>
        <div class="field">
          <label>Contraseña (mínimo 8 caracteres)</label>
          <input type="password" name="p1" autocomplete="new-password">
        </div>
        <div class="field">
          <label>Repite la contraseña</label>
          <input type="password" name="p2" autocomplete="new-password">
        </div>
        <p class="hint"><b>Anótala en un lugar seguro:</b> si la olvidas, el respaldo no se puede abrir.</p>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="lock"></i> Cifrar y descargar</button>
        <button type="button" class="btn btn-soft btn-block" id="cr-sin">Guardar sin contraseña</button>
      </form>`, body => {
      const f = body.querySelector('#cr-form');
      f.addEventListener('submit', e => {
        e.preventDefault();
        const p1 = f.p1.value, p2 = f.p2.value;
        if (p1.length < 8) return UI.toast('La contraseña debe tener al menos 8 caracteres', 'error');
        if (p1 !== p2) return UI.toast('Las contraseñas no coinciden', 'error');
        UI.closeModal();
        alElegir(p1);
      });
      body.querySelector('#cr-sin').addEventListener('click', () => { UI.closeModal(); alElegir(null); });
      f.p1.focus();
    });
  },

  // Al restaurar: pedir la contraseña. intentar(clave) devuelve true si abrió
  // (la ventana se cierra y corre luego) o false si falló (la ventana sigue abierta).
  pedir(intentar, luego) {
    UI.openModal('Respaldo con contraseña', `
      <form class="form" id="cr-form" autocomplete="off">
        <p class="muted">Este respaldo está cifrado. Escribe la contraseña que le pusiste.</p>
        <div class="field">
          <label>Contraseña</label>
          <input type="password" name="p1" autocomplete="current-password">
        </div>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="unlock"></i> Abrir respaldo</button>
      </form>`, body => {
      const f = body.querySelector('#cr-form');
      const boton = f.querySelector('button');
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (!f.p1.value) return;
        boton.disabled = true;
        const ok = await intentar(f.p1.value);
        if (ok) { UI.closeModal(); if (luego) luego(); }
        else { boton.disabled = false; f.p1.select(); }
      });
      f.p1.focus();
    });
  }
};