/* =========================================================
   BÓVEDA - Cifra los datos guardados en el teléfono (AES-256-GCM)
   - Una llave de datos al azar protege todo. Esa llave se guarda
     "envuelta" dos veces: con tu contraseña y con un código de
     recuperación. Cambiar la contraseña no recifra los datos.
   - La contraseña y la llave NUNCA se guardan: solo viven en
     memoria mientras la app está abierta.
   - Si se pierden la contraseña Y el código, no hay forma de
     recuperar los datos (solo un respaldo).
   ========================================================= */

const Boveda = {
  ITER: 600000,        // vueltas para la contraseña
  ITER_CODIGO: 100000, // el código ya es largo y al azar
  dek: null,           // bytes de la llave de datos (solo en memoria)
  llave: null,         // la misma llave lista para usar
  nueva: false,        // entró con el código y debe poner contraseña nueva
  ALFA: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

  disponible() { return !!(window.crypto && crypto.subtle); },
  activa() { return localStorage.getItem(Store.PREFIX + '_boveda') !== null; },
  _meta() { try { return JSON.parse(localStorage.getItem(Store.PREFIX + '_boveda')); } catch (e) { return null; } },
  _guardarMeta(m) { localStorage.setItem(Store.PREFIX + '_boveda', JSON.stringify(m)); },

  /* ---------- Piezas de cifrado ---------- */
  async _kek(secreto, sal, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },

  async _envolver(bytes, secreto, iter) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await this._kek(secreto, sal, iter);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes);
    return { iter, sal: Cripto._aB64(sal), iv: Cripto._aB64(iv), ct: Cripto._aB64(new Uint8Array(ct)) };
  },

  // Devuelve los bytes de la llave, o null si el secreto no es el correcto
  async _abrirEnv(env, secreto) {
    try {
      if (!env || !Number.isInteger(env.iter) || env.iter < 50000 || env.iter > 2000000) return null;
      const sal = Cripto._deB64(env.sal), iv = Cripto._deB64(env.iv), ct = Cripto._deB64(env.ct);
      if (sal.length !== 16 || iv.length !== 12) return null;
      const k = await this._kek(secreto, sal, env.iter);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct));
    } catch (e) { return null; }
  },

  _importar(bytes) {
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  },

  // Sella un dato: 'enc1:' + iv + ':' + texto cifrado. El nombre del dato va "pegado"
  // para que nadie pueda cambiar el contenido de un dato por el de otro.
  async sellar(nombre, texto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('tienda|' + nombre) },
      this.llave, new TextEncoder().encode(texto));
    return 'enc1:' + Cripto._aB64(iv) + ':' + Cripto._aB64(new Uint8Array(ct));
  },

  async abrir(nombre, valor) {
    const [, iv, ct] = String(valor).split(':');
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Cripto._deB64(iv), additionalData: new TextEncoder().encode('tienda|' + nombre) },
      this.llave, Cripto._deB64(ct));
    return new TextDecoder().decode(buf);
  },

  codigoNuevo() {
    const b = crypto.getRandomValues(new Uint8Array(20));
    const c = [...b].map(x => this.ALFA[x & 31]).join('');
    return c.match(/.{4}/g).join('-');
  },
  normalizar(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },

  _nombres() {
    const P = Store.PREFIX, out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(P) && k !== P + '_boveda') out.push(k.slice(P.length));
    }
    return out;
  },

  /* ---------- Activar / desactivar ---------- */

  // Cifra todo lo guardado. Antes de cambiar nada comprueba que se pueda volver a abrir.
  async activar(clave) {
    const P = Store.PREFIX;
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const codigo = this.codigoNuevo();
    const meta = {
      v: 1,
      c1: await this._envolver(dek, clave, this.ITER),
      c2: await this._envolver(dek, this.normalizar(codigo), this.ITER_CODIGO)
    };
    const llave = await this._importar(dek);
    this.llave = llave;

    const nombres = this._nombres();
    const originales = {}, sellados = {};
    for (const n of nombres) {
      originales[n] = localStorage.getItem(P + n);
      sellados[n] = await this.sellar(n, originales[n]);
    }
    for (const n of nombres) {
      if ((await this.abrir(n, sellados[n])) !== originales[n]) throw new Error('verificación');
    }

    this._guardarMeta(meta);   // primero la llave, luego los datos
    try {
      nombres.forEach(n => localStorage.setItem(P + n, sellados[n]));
    } catch (e) {
      nombres.forEach(n => localStorage.setItem(P + n, originales[n]));
      localStorage.removeItem(P + '_boveda');
      this.llave = null;
      throw e;
    }
    this.dek = dek;
    Store._mem = originales;
    Store._bloqueado = false;
    return codigo;
  },

  async desactivar() {
    await Store.esperarVolcado();
    const P = Store.PREFIX;
    Object.entries(Store._mem || {}).forEach(([k, v]) => localStorage.setItem(P + k, v));
    localStorage.removeItem(P + '_boveda');   // al final: si algo falla, sigue protegido
    Store._mem = null;
    this.dek = null;
    this.llave = null;
  },

  async claveCorrecta(clave) { return !!(await this._abrirEnv((this._meta() || {}).c1, clave)); },

  async cambiarClave(nueva) {
    const m = this._meta();
    m.c1 = await this._envolver(this.dek, nueva, this.ITER);
    if (!(await this._abrirEnv(m.c1, nueva))) throw new Error('verificación');
    this._guardarMeta(m);
  },

  async cambiarCodigo() {
    const m = this._meta();
    const codigo = this.codigoNuevo();
    m.c2 = await this._envolver(this.dek, this.normalizar(codigo), this.ITER_CODIGO);
    this._guardarMeta(m);
    return codigo;
  },

  /* ---------- Abrir al arrancar ---------- */
  async desbloquear(secreto, cual) {
    const m = this._meta();
    const bytes = m ? await this._abrirEnv(m[cual], secreto) : null;
    if (!bytes) return false;
    this.dek = bytes;
    this.llave = await this._importar(bytes);

    const P = Store.PREFIX, mem = {}, pendientes = [];
    let malos = 0;
    for (const n of this._nombres()) {
      const v = localStorage.getItem(P + n);
      if (String(v).startsWith('enc1:')) {
        try { mem[n] = await this.abrir(n, v); } catch (e) { malos++; console.error('Dato ilegible', n); }
      } else { mem[n] = v; pendientes.push(n); }   // quedó a medias: se termina de cifrar
    }
    Store._mem = mem;
    Store._bloqueado = false;
    pendientes.forEach(n => Store._marcar(n));
    if (malos) setTimeout(() => UI.toast('Algún dato no se pudo leer. Restaura un respaldo si algo falta.', 'error'), 800);
    return true;
  },

  /* ---------- Pantalla de contraseña ---------- */
  intentos() { try { return JSON.parse(localStorage.getItem('sec_bov')) || { n: 0, hasta: 0 }; } catch (e) { return { n: 0, hasta: 0 }; } },
  fallo() {
    const i = this.intentos(); i.n++;
    if (i.n % 5 === 0) i.hasta = Date.now() + [30, 120, 600, 1800, 3600][Math.min(i.n / 5 - 1, 4)] * 1000;
    try { localStorage.setItem('sec_bov', JSON.stringify(i)); } catch (e) { /* nada */ }
  },
  limpiar() { try { localStorage.removeItem('sec_bov'); } catch (e) { /* nada */ } },

  _pantalla(html) {
    let el = document.getElementById('lock');
    if (!el) { el = document.createElement('div'); el.id = 'lock'; document.body.appendChild(el); }
    el.onclick = null;
    el.onsubmit = null;
    el.innerHTML = html;
    UI.icons();
    return el;
  },
  _msg(t) { const m = document.getElementById('lock-msg'); if (m) m.textContent = t; },
  _nombre() { return Utils.esc(document.title || 'Mi negocio'); },

  iniciar() {
    if (!Store._bloqueado) return;
    if (!this.disponible()) {
      this._pantalla(`<div class="lock-box"><div class="lock-logo"><i data-lucide="shield-alert"></i></div>
        <h2>No se puede abrir</h2>
        <p class="muted">Tus datos están cifrados y este navegador no permite abrirlos. Abre la app desde su dirección https.</p></div>`);
      return;
    }
    this.vistaClave();
  },

  vistaClave() {
    const el = this._pantalla(`
      <form class="lock-box form" autocomplete="off">
        <div class="lock-logo"><i data-lucide="shield-check"></i></div>
        <h2>${this._nombre()}</h2>
        <p class="muted">Tus datos están cifrados. Escribe tu contraseña.</p>
        <div class="field"><input name="clave" type="password" autocomplete="current-password" placeholder="Contraseña"></div>
        <div class="lock-msg" id="lock-msg"></div>
        <button type="submit" class="btn btn-primary btn-block">Abrir</button>
        <button type="button" class="lock-link" data-a="recup">Olvidé mi contraseña</button>
      </form>`);
    const f = el.querySelector('form');
    el.onclick = e => { if (e.target.closest('[data-a="recup"]')) this.vistaCodigo(); };
    f.onsubmit = async e => {
      e.preventDefault();
      const espera = this.intentos().hasta - Date.now();
      if (espera > 0) return this._msg(`Demasiados intentos. Espera ${Math.ceil(espera / 1000)} s.`);
      if (!f.clave.value) return;
      const b = f.querySelector('button[type=submit]'); b.disabled = true; this._msg('Abriendo...');
      const ok = await this.desbloquear(f.clave.value, 'c1');
      if (ok) { this.limpiar(); this.liberar(); }
      else { this.fallo(); b.disabled = false; this._msg('Contraseña incorrecta'); f.clave.select(); }
    };
    f.clave.focus();
  },

  vistaCodigo() {
    const el = this._pantalla(`
      <form class="lock-box form" autocomplete="off">
        <div class="lock-logo"><i data-lucide="key-round"></i></div>
        <h2>Recuperar acceso</h2>
        <p class="muted">Escribe el código de recuperación de 20 letras y números que te dieron al activar el cifrado.</p>
        <div class="field"><input name="codigo" type="text" autocapitalize="characters" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></div>
        <div class="lock-msg" id="lock-msg"></div>
        <button type="submit" class="btn btn-primary btn-block">Continuar</button>
        <button type="button" class="lock-link" data-a="volver">Volver</button>
      </form>`);
    const f = el.querySelector('form');
    el.onclick = e => { if (e.target.closest('[data-a="volver"]')) this.vistaClave(); };
    f.onsubmit = async e => {
      e.preventDefault();
      const espera = this.intentos().hasta - Date.now();
      if (espera > 0) return this._msg(`Demasiados intentos. Espera ${Math.ceil(espera / 1000)} s.`);
      const b = f.querySelector('button[type=submit]'); b.disabled = true; this._msg('Comprobando...');
      const ok = await this.desbloquear(this.normalizar(f.codigo.value), 'c2');
      if (ok) { this.limpiar(); this.vistaNueva(); }
      else { this.fallo(); b.disabled = false; this._msg('Código incorrecto'); }
    };
    f.codigo.focus();
  },

  // Entró con el código: debe poner una contraseña nueva antes de seguir
  vistaNueva() {
    const el = this._pantalla(`
      <form class="lock-box form" autocomplete="off">
        <div class="lock-logo"><i data-lucide="lock"></i></div>
        <h2>Contraseña nueva</h2>
        <p class="muted">Mínimo 8 caracteres.</p>
        <div class="field"><input name="p1" type="password" autocomplete="new-password" placeholder="Contraseña nueva"></div>
        <div class="field"><input name="p2" type="password" autocomplete="new-password" placeholder="Repite la contraseña"></div>
        <div class="lock-msg" id="lock-msg"></div>
        <button type="submit" class="btn btn-primary btn-block">Guardar y entrar</button>
      </form>`);
    const f = el.querySelector('form');
    f.onsubmit = async e => {
      e.preventDefault();
      if (f.p1.value.length < 8) return this._msg('Mínimo 8 caracteres');
      if (f.p1.value !== f.p2.value) return this._msg('No coinciden');
      const b = f.querySelector('button'); b.disabled = true; this._msg('Guardando...');
      try { await this.cambiarClave(f.p1.value); this.liberar(); }
      catch (err) { b.disabled = false; this._msg('No se pudo guardar. Intenta otra vez.'); }
    };
    f.p1.focus();
  },

  // Quita la pantalla y deja arrancar la app (el PIN, si hay, aparece después)
  liberar() {
    const el = document.getElementById('lock');
    if (el) el.remove();
    Store._abrir();
  },

  /* ---------- Ajustes: activar, cambiar, desactivar ---------- */
  configurar() {
    if (!Seguridad.dueno()) return UI.toast('Solo el dueño puede hacer esto', 'error');
    if (!this.disponible()) return UI.toast('Este navegador no permite cifrar aquí', 'error');
    this.activa() ? this.vistaActiva() : this.vistaActivar();
  },

  vistaActivar() {
    UI.openModal('Cifrar los datos', `
      <form class="form" id="bv-form" autocomplete="off">
        <p class="muted">Tus ventas, clientes y mercancía se guardan cifrados en este teléfono. Al abrir la app se pide la contraseña.</p>
        <div class="field"><label>Contraseña (mínimo 8 caracteres)</label><input type="password" name="p1" autocomplete="new-password"></div>
        <div class="field"><label>Repite la contraseña</label><input type="password" name="p2" autocomplete="new-password"></div>
        <p class="hint">Antes de cifrar se descarga un respaldo. Al terminar te daré un <b>código de recuperación</b>: anótalo en papel.</p>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:.9rem">
          <input type="checkbox" name="ok" style="margin-top:3px">
          <span>Entiendo que si pierdo la contraseña y el código, los datos no se pueden recuperar (solo con un respaldo).</span>
        </label>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="shield-check"></i> Cifrar mis datos</button>
      </form>`, body => {
      const f = body.querySelector('#bv-form');
      f.addEventListener('submit', e => {
        e.preventDefault();
        if (f.p1.value.length < 8) return UI.toast('La contraseña debe tener al menos 8 caracteres', 'error');
        if (f.p1.value !== f.p2.value) return UI.toast('Las contraseñas no coinciden', 'error');
        if (!f.ok.checked) return UI.toast('Marca la casilla para continuar', 'error');
        const clave = f.p1.value;
        UI.closeModal();
        Modules.dashboard.respaldo(false, async () => {
          UI.toast('Cifrando tus datos...');
          try {
            const codigo = await this.activar(clave);
            this.mostrarCodigo(codigo, 'Datos cifrados');
          } catch (err) {
            console.error(err);
            UI.toast('No se pudo cifrar. Tus datos quedaron como estaban.', 'error');
          }
        });
      });
    });
  },

  vistaActiva() {
    UI.openModal('Datos cifrados', `
      <div class="form">
        <p class="muted"><b>El cifrado está activo.</b> Los datos de este teléfono están protegidos con tu contraseña.</p>
        <button class="btn btn-soft btn-block" data-a="clave"><i data-lucide="key-round"></i> Cambiar contraseña</button>
        <button class="btn btn-soft btn-block" data-a="codigo"><i data-lucide="file-key"></i> Código de recuperación nuevo</button>
        <button class="btn btn-danger btn-block" data-a="quitar"><i data-lucide="shield-off"></i> Quitar el cifrado</button>
      </div>`, body => {
      body.querySelector('.form').addEventListener('click', e => {
        const a = e.target.closest('[data-a]');
        if (a) this.vistaAccion(a.dataset.a);
      });
    });
  },

  vistaAccion(accion) {
    const titulo = { clave: 'Cambiar contraseña', codigo: 'Código de recuperación nuevo', quitar: 'Quitar el cifrado' }[accion];
    const nueva = accion === 'clave';
    UI.openModal(titulo, `
      <form class="form" id="bv-acc" autocomplete="off">
        <div class="field"><label>Tu contraseña actual</label><input type="password" name="actual" autocomplete="current-password"></div>
        ${nueva ? `<div class="field"><label>Contraseña nueva (mínimo 8)</label><input type="password" name="p1" autocomplete="new-password"></div>
        <div class="field"><label>Repite la nueva</label><input type="password" name="p2" autocomplete="new-password"></div>` : ''}
        ${accion === 'quitar' ? '<p class="hint">Los datos volverán a guardarse sin cifrar en este teléfono.</p>' : ''}
        ${accion === 'codigo' ? '<p class="hint">El código anterior dejará de servir.</p>' : ''}
        <button type="submit" class="btn ${accion === 'quitar' ? 'btn-danger' : 'btn-primary'} btn-block">Continuar</button>
      </form>`, body => {
      const f = body.querySelector('#bv-acc');
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (nueva) {
          if (f.p1.value.length < 8) return UI.toast('La contraseña nueva debe tener al menos 8 caracteres', 'error');
          if (f.p1.value !== f.p2.value) return UI.toast('Las contraseñas no coinciden', 'error');
        }
        const b = f.querySelector('button'); b.disabled = true;
        if (!(await this.claveCorrecta(f.actual.value))) { b.disabled = false; return UI.toast('La contraseña actual no es correcta', 'error'); }
        try {
          if (accion === 'clave') { await this.cambiarClave(f.p1.value); UI.closeModal(); UI.toast('Contraseña cambiada'); }
          if (accion === 'codigo') { const c = await this.cambiarCodigo(); this.mostrarCodigo(c, 'Código nuevo'); }
          if (accion === 'quitar') { await this.desactivar(); UI.closeModal(); UI.toast('Cifrado quitado'); }
        } catch (err) { console.error(err); b.disabled = false; UI.toast('No se pudo completar', 'error'); }
      });
    });
  },

  mostrarCodigo(codigo, titulo) {
    UI.closeModal();
    UI.openModal(titulo, `
      <div style="text-align:center">
        <p>Si olvidas la contraseña, este código te deja entrar y poner una nueva.</p>
        <div class="lock-code">${codigo}</div>
        <p class="muted" style="font-size:.88rem"><b>Anótalo en papel ahora.</b> No se vuelve a mostrar. Sin la contraseña y sin este código, los datos no se recuperan.</p>
        <button class="btn btn-primary btn-block" data-ok>Ya lo anoté</button>
      </div>`, body => {
      body.querySelector('[data-ok]').addEventListener('click', () => UI.closeModal());
    });
  }
};

document.addEventListener('DOMContentLoaded', () => Boveda.iniciar());