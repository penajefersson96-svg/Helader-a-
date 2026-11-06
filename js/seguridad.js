/* =========================================================
   SEGURIDAD - PIN, roles (dueño / empleado) y bloqueo
   Se guarda en "seguridad":
   { activo, salt, dueno, empleado, recup, minutos }
   - Los PIN y el código de recuperación se guardan con hash
     (PBKDF2 + sal), nunca en claro. Esta información NO entra
     en los respaldos.
   - Los intentos fallidos se recuerdan aunque se cierre la app.
   - Con la app bloqueada no se dibuja ningún dato.
   - Las acciones delicadas se vuelven a verificar por dentro:
     no basta con esconder el botón.
   ========================================================= */

const Seguridad = {
  rol: null,          // 'dueno' | 'empleado' | null (bloqueado)
  salio: 0,           // cuándo salió de la app
  ultimo: Date.now(), // última vez que tocó algo
  guardado: 0,
  buf: '',
  estado: 'pin',
  ocupado: false,
  recupOk: false,
  ITER: 120000,
  permitidas: ['ventas', 'fiados', 'calculadora'],   // lo que ve el empleado

  cfg() { return Store.get('seguridad', { activo: false }); },
  activo() { return !!this.cfg().activo; },
  dueno() { return this.rol === 'dueno'; },
  puede(vista) { return this.rol === 'dueno' || this.permitidas.includes(vista); },
  inicio() { return this.rol === 'dueno' ? 'dashboard' : 'ventas'; },

  /* ---------- Hash ---------- */

  // Hash viejo (Parte 14). Solo se usa para reconocer PIN guardados antes.
  legacy(txt, salt) {
    const s = salt + '|' + txt;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  },

  // Hash fuerte: PBKDF2-SHA256 con 120.000 vueltas. Cada intento cuesta tiempo.
  async hash(txt, salt) {
    try {
      if (window.crypto && crypto.subtle) {
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey('raw', enc.encode(txt), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: this.ITER }, base, 256);
        return 'p2$' + [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* sin crypto: se usa el hash simple */ }
    return this.legacy(txt, salt);
  },

  async verificar(txt, guardado, salt) {
    if (!guardado) return false;
    if (String(guardado).startsWith('p2$')) return (await this.hash(txt, salt)) === guardado;
    return this.legacy(txt, salt) === guardado;
  },

  // Si el PIN estaba guardado con el hash viejo, se vuelve a guardar con el fuerte
  async mejorar(campo, pin) {
    const c = this.cfg();
    if (String(c[campo] || '').startsWith('p2$')) return;
    const nuevo = await this.hash(pin, c.salt);
    if (nuevo.startsWith('p2$')) Store.set('seguridad', { ...this.cfg(), [campo]: nuevo });
  },

  // PIN demasiado fáciles: 0000, 1111, 1234, 4321...
  debil(p) {
    return /^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p);
  },

  aleatorio(max) {
    try { return crypto.getRandomValues(new Uint32Array(1))[0] % max; }
    catch (e) { return Math.floor(Math.random() * max); }
  },

  /* ---------- Intentos fallidos (se recuerdan aunque se cierre la app) ---------- */
  intentos() {
    try { return JSON.parse(localStorage.getItem('sec_intentos')) || { n: 0, hasta: 0 }; }
    catch (e) { return { n: 0, hasta: 0 }; }
  },
  guardarIntentos(o) {
    try { localStorage.setItem('sec_intentos', JSON.stringify(o)); } catch (e) { /* nada */ }
  },
  espera() { return Math.max(0, this.intentos().hasta - Date.now()); },
  fallo() {
    const i = this.intentos();
    i.n++;
    // Cada 5 fallos la espera crece: 30 s, 2 min, 10 min, 30 min, 1 hora
    if (i.n % 5 === 0) {
      const seg = [30, 120, 600, 1800, 3600][Math.min(i.n / 5 - 1, 4)];
      i.hasta = Date.now() + seg * 1000;
    }
    this.guardarIntentos(i);
  },
  limpiarIntentos() { this.guardarIntentos({ n: 0, hasta: 0 }); },
  textoEspera(ms) {
    const s = Math.ceil(ms / 1000);
    return s >= 60 ? Math.ceil(s / 60) + ' min' : s + ' s';
  },

  /* ---------- Sesión ---------- */
  guardarSesion() {
    try { sessionStorage.setItem('Tienda_rol', JSON.stringify({ rol: this.rol, t: Date.now() })); } catch (e) { /* nada */ }
    this.guardado = Date.now();
  },
  borrarSesion() {
    try { sessionStorage.removeItem('Tienda_rol'); } catch (e) { /* nada */ }
  },
  leerSesion() {
    try {
      const s = JSON.parse(sessionStorage.getItem('Tienda_rol'));
      const max = (this.cfg().minutos || 0) * 60000;
      if (s && (s.rol === 'dueno' || s.rol === 'empleado') && (!max || Date.now() - s.t < max)) return s.rol;
    } catch (e) { /* nada */ }
    return null;
  },

  /* ---------- Arranque ---------- */
  init() {
    this.montarBoton();
    this.proteger();

    if (!this.activo()) {
      this.rol = 'dueno';
      this.aplicar();
    } else {
      const r = this.leerSesion();
      if (r) { this.rol = r; this.aplicar(); }
      else this.mostrar();
    }

    // Cualquier toque cuenta como actividad
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, () => this.actividad(), { passive: true }));

    // Bloqueo por inactividad (aunque la app siga abierta)
    setInterval(() => {
      const c = this.cfg();
      if (c.activo && this.rol && c.minutos > 0 && Date.now() - this.ultimo > c.minutos * 60000) this.mostrar();
    }, 15000);

    // Si sales de la app por un rato, se bloquea sola
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.salio = Date.now(); return; }
      const c = this.cfg();
      if (c.activo && this.rol && c.minutos > 0 && this.salio &&
          Date.now() - this.salio > c.minutos * 60000) this.mostrar();
    });

    // Teclado (en computador)
    document.addEventListener('keydown', e => {
      const el = document.getElementById('lock');
      if (!el || el.classList.contains('lock-off') || this.estado !== 'pin') return;
      if (/^\d$/.test(e.key)) this.tecla(e.key);
      else if (e.key === 'Backspace') this.tecla('x');
      else if (e.key === 'Enter') this.entrarConPin();
    });
  },

  actividad() {
    this.ultimo = Date.now();
    if (this.rol && this.activo() && Date.now() - this.guardado > 30000) this.guardarSesion();
  },

  // Vuelve a comprobar el rol dentro de las funciones delicadas.
  // Así, aunque alguien muestre un botón escondido, no funciona.
  proteger() {
    const soloDueno = (obj, nombres) => {
      nombres.forEach(n => {
        const f = obj && obj[n];
        if (typeof f !== 'function' || f.__protegida) return;
        const w = function (...a) {
          if (!Seguridad.dueno()) { UI.toast('Solo el dueño puede hacer esto', 'error'); return; }
          return f.apply(this, a);
        };
        w.__protegida = true;
        obj[n] = w;
      });
    };

    // Se buscan los objetos sin eval (así el navegador puede bloquear eval)
    const ex = {
      Inventario: typeof Inventario !== 'undefined' ? Inventario : null,
      Ajustes: typeof Ajustes !== 'undefined' ? Ajustes : null,
      Cierre: typeof Cierre !== 'undefined' ? Cierre : null,
      Comprobante: typeof Comprobante !== 'undefined' ? Comprobante : null,
      Devoluciones: typeof Devoluciones !== 'undefined' ? Devoluciones : null,
      EditarVenta: typeof EditarVenta !== 'undefined' ? EditarVenta : null,
      Caja: typeof Caja !== 'undefined' ? Caja : null,
      Mermas: typeof Mermas !== 'undefined' ? Mermas : null,
      Fiados: typeof Fiados !== 'undefined' ? Fiados : null
    };

    soloDueno(Store, ['remove', 'importAll']);
    soloDueno(Modules.dashboard, ['respaldo', 'restaurar']);
    soloDueno(Modules.inventario, ['form']);
    soloDueno(ex.Inventario, ['abrirCategorias']);
    soloDueno(ex.Ajustes, ['abrir']);
    soloDueno(ex.Cierre, ['abrir']);
    soloDueno(ex.Comprobante, ['cierre']);
    soloDueno(ex.Devoluciones, ['nueva', 'lista']);
    soloDueno(ex.EditarVenta, ['abrir']);
    soloDueno(ex.Caja, ['form']);
    soloDueno(ex.Mermas, ['nueva']);
    soloDueno(ex.Fiados, ['deshacerUltimo']);
  },

  // Botón del candado junto a la tasa
  montarBoton() {
    const chip = document.getElementById('rate-chip');
    if (!chip || document.getElementById('lock-btn')) return;
    const caja = document.createElement('div');
    caja.className = 'topbar-right';
    chip.parentNode.insertBefore(caja, chip);
    caja.appendChild(chip);
    const b = document.createElement('button');
    b.id = 'lock-btn';
    b.className = 'icon-btn';
    b.setAttribute('aria-label', 'Bloquear');
    b.innerHTML = '<i data-lucide="lock"></i>';
    b.onclick = () => this.mostrar();
    caja.insertBefore(b, chip);
  },

  // Muestra u oculta según el rol
  aplicar() {
    document.body.classList.toggle('rol-empleado', this.rol === 'empleado');
    document.querySelectorAll('.nav-item').forEach(b => {
      b.style.display = this.puede(b.dataset.view) ? '' : 'none';
    });
    const b = document.getElementById('lock-btn');
    if (b) b.style.display = this.activo() ? '' : 'none';
  },

  entrar(rol) {
    this.rol = rol;
    this.recupOk = false;
    this.ultimo = Date.now();
    this.guardarSesion();
    this.limpiarIntentos();
    const el = document.getElementById('lock');
    if (el) el.classList.add('lock-off');
    this.aplicar();
    App.go(this.inicio());   // al entrar con el PIN siempre se abre Inicio
    UI.icons();
  },

  /* ---------- Pantalla de bloqueo ---------- */
  mostrar() {
    this.rol = null;
    this.recupOk = false;
    this.borrarSesion();
    UI.closeModal();

    // Con la app bloqueada no queda ningún dato dibujado
    document.querySelectorAll('[id$="-content"]').forEach(d => { d.innerHTML = ''; });
    const t = document.getElementById('toast-container');
    if (t) t.innerHTML = '';

    let el = document.getElementById('lock');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lock';
      document.body.appendChild(el);
      el.onclick = e => this.clic(e);
      el.onsubmit = e => { e.preventDefault(); this.enviar(); };
    }
    el.classList.remove('lock-off');
    this.buf = '';
    this.vistaPin();
  },

  nombreNegocio() {
    return Utils.esc((Store.get('config', {}).negocio) || document.title || 'Mi negocio');
  },

  vistaPin() {
    this.estado = 'pin';
    const el = document.getElementById('lock');
    const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
      .map(n => `<button type="button" data-k="${n}">${n}</button>`).join('');
    el.innerHTML = `
      <div class="lock-box">
        <div class="lock-logo"><i data-lucide="lock"></i></div>
        <h2>${this.nombreNegocio()}</h2>
        <p class="muted">Ingresa tu PIN</p>
        <div class="lock-dots" id="lock-dots"></div>
        <div class="lock-msg" id="lock-msg"></div>
        <div class="lock-pad">
          ${teclas}
          <button type="button" data-k="x" aria-label="Borrar"><i data-lucide="delete"></i></button>
          <button type="button" data-k="0">0</button>
          <button type="button" class="ok" data-a="entrar" aria-label="Entrar"><i data-lucide="check"></i></button>
        </div>
        <button type="button" class="lock-link" data-a="olvide">Olvidé mi PIN</button>
      </div>`;
    this.puntos();
    const e = this.espera();
    if (e > 0) this.msg(`Demasiados intentos. Espera ${this.textoEspera(e)}.`);
    UI.icons();
  },

  puntos() {
    const d = document.getElementById('lock-dots');
    if (!d) return;
    const n = Math.max(4, this.buf.length);
    d.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < this.buf.length ? '' : 'off'}"></i>`).join('');
  },

  msg(t) {
    const m = document.getElementById('lock-msg');
    if (m) m.textContent = t || '';
  },

  tecla(k) {
    if (k === 'x') this.buf = this.buf.slice(0, -1);
    else if (this.buf.length < 8) this.buf += k;
    this.msg('');
    this.puntos();
  },

  clic(e) {
    const k = e.target.closest('[data-k]');
    if (k) return this.tecla(k.dataset.k);
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'entrar') this.entrarConPin();
    if (a.dataset.a === 'olvide') this.vistaRecup();
    if (a.dataset.a === 'volver') this.vistaPin();
    if (a.dataset.a === 'soporte') this.vistaSoporte();
  },

  async entrarConPin() {
    if (this.ocupado) return;
    const espera = this.espera();
    if (espera > 0) return this.msg(`Espera ${this.textoEspera(espera)} para intentar de nuevo`);
    if (this.buf.length < 4) return this.msg('El PIN tiene entre 4 y 8 números');

    this.ocupado = true;
    this.msg('Verificando…');
    const pin = this.buf;
    this.buf = '';
    this.puntos();
    const c = this.cfg();

    try {
      if (await this.verificar(pin, c.dueno, c.salt)) {
        await this.mejorar('dueno', pin);
        return this.entrar('dueno');
      }
      if (c.empleado && await this.verificar(pin, c.empleado, c.salt)) {
        await this.mejorar('empleado', pin);
        return this.entrar('empleado');
      }
      this.fallo();
      const e = this.espera();
      this.msg(e > 0 ? `Demasiados intentos. Espera ${this.textoEspera(e)}.` : 'PIN incorrecto');
    } finally {
      this.ocupado = false;
    }
  },

  /* ---------- Olvidé mi PIN ---------- */
  vistaRecup() {
    this.estado = 'recup';
    const el = document.getElementById('lock');
    el.innerHTML = `
      <form class="lock-box form" autocomplete="off">
        <div class="lock-logo"><i data-lucide="key-round"></i></div>
        <h2>Recuperar acceso</h2>
        <p class="muted">Escribe el código de recuperación de 8 números que te dieron al activar el PIN.</p>
        <div class="field">
          <input name="codigo" type="text" inputmode="numeric" maxlength="8" placeholder="00000000">
        </div>
        <div class="lock-msg" id="lock-msg"></div>
        <button type="submit" class="btn btn-primary btn-block">Continuar</button>
        ${Maestra.listo() ? '<button type="button" class="lock-link" data-a="soporte">No tengo el código: pedir ayuda a soporte</button>' : ''}
        <button type="button" class="lock-link" data-a="volver">Volver</button>
      </form>`;
    UI.icons();
  },

  // Parte 20: el soporte contesta y deja poner un PIN nuevo
  vistaSoporte() {
    this.estado = 'soporte';
    Maestra.pantalla({
      tipo: 'pin',
      mostrar: html => { const el = document.getElementById('lock'); el.innerHTML = html; UI.icons(); return el; },
      volver: () => this.vistaRecup(),
      exito: async () => { this.recupOk = true; this.vistaNuevo(); return true; }
    });
  },

  vistaNuevo() {
    this.estado = 'nuevo';
    const el = document.getElementById('lock');
    el.innerHTML = `
      <form class="lock-box form" autocomplete="off">
        <div class="lock-logo"><i data-lucide="lock"></i></div>
        <h2>Nuevo PIN del dueño</h2>
        <div class="field">
          <input name="pin" type="password" inputmode="numeric" maxlength="8" placeholder="4 a 8 números">
        </div>
        <div class="field">
          <input name="pin2" type="password" inputmode="numeric" maxlength="8" placeholder="Repite el PIN">
        </div>
        <div class="lock-msg" id="lock-msg"></div>
        <button type="submit" class="btn btn-primary btn-block">Guardar y entrar</button>
      </form>`;
    UI.icons();
  },

  async enviar() {
    if (this.ocupado) return;
    const el = document.getElementById('lock');
    const f = el.querySelector('form');
    if (!f) return;
    const c = this.cfg();

    this.ocupado = true;
    try {
      if (this.estado === 'recup') {
        const espera = this.espera();
        if (espera > 0) return this.msg(`Espera ${this.textoEspera(espera)} para intentar de nuevo`);
        this.msg('Verificando…');
        if (!(await this.verificar(f.codigo.value.trim(), c.recup, c.salt))) {
          this.fallo();
          const e = this.espera();
          return this.msg(e > 0 ? `Demasiados intentos. Espera ${this.textoEspera(e)}.` : 'Código incorrecto');
        }
        this.recupOk = true;
        return this.vistaNuevo();
      }

      if (this.estado === 'nuevo') {
        if (!this.recupOk) return this.vistaPin();
        const p = f.pin.value.trim();
        if (!/^\d{4,8}$/.test(p)) return this.msg('Usa entre 4 y 8 números');
        if (this.debil(p)) return this.msg('Ese PIN es muy fácil de adivinar');
        if (p !== f.pin2.value.trim()) return this.msg('Los PIN no coinciden');
        if (c.empleado && await this.verificar(p, c.empleado, c.salt)) return this.msg('Debe ser distinto al del empleado');
        const h = await this.hash(p, c.salt);
        Store.set('seguridad', { ...this.cfg(), dueno: h });
        this.entrar('dueno');
        UI.toast('PIN cambiado');
      }
    } finally {
      this.ocupado = false;
    }
  },

  /* ---------- Configuración (desde "Mi negocio") ---------- */
  configurar() {
    if (!this.dueno()) return UI.toast('Solo el dueño puede hacer esto', 'error');
    const c = this.cfg();
    const activo = !!c.activo;
    const campo = (n, l, p) => `
      <div class="field">
        <label>${l}</label>
        <input name="${n}" type="password" inputmode="numeric" maxlength="8" placeholder="${p || ''}">
      </div>`;
    const check = (n, t) => `
      <label class="check-row"><input type="checkbox" name="${n}"><span><b>${t}</b></span></label>`;
    const min = c.minutos === undefined ? 5 : c.minutos;
    const op = (v, t) => `<option value="${v}" ${min === v ? 'selected' : ''}>${t}</option>`;

    const html = `
      <form class="form" id="seg-form" autocomplete="off">
        <div class="preview">
          <div><span>Estado</span><b>${activo ? 'PIN activado' : 'Sin PIN'}</b></div>
        </div>
        <p class="muted" style="font-size:.86rem">
          El empleado solo puede vender, cobrar fiados y usar el dólar. No ve costos, ganancias,
          caja, reportes ni respaldos.
        </p>

        ${activo ? campo('actual', 'Tu PIN actual') : ''}
        ${campo('pin', activo ? 'Nuevo PIN del dueño (opcional)' : 'PIN del dueño', activo ? 'Vacío = no cambiarlo' : '4 a 8 números')}
        ${campo('pin2', 'Repite el PIN del dueño')}
        ${campo('emp', 'PIN del empleado (opcional)', c.empleado ? 'Vacío = no cambiarlo' : 'Vacío = sin empleados')}
        ${c.empleado ? check('quitarEmp', 'Quitar el PIN del empleado') : ''}

        <div class="field">
          <label>Bloquear sola si no la usas por</label>
          <select name="minutos">
            ${op(1, '1 minuto')}${op(2, '2 minutos')}${op(5, '5 minutos')}
            ${op(10, '10 minutos')}${op(30, '30 minutos')}${op(0, 'Nunca (solo con el candado)')}
          </select>
        </div>

        ${activo ? check('recup', 'Crear un código de recuperación nuevo') + check('desactivar', 'Desactivar el PIN') : ''}

        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="check"></i> Guardar</button>
      </form>`;

    UI.openModal('Seguridad', html, body => {
      const f = body.querySelector('#seg-form');
      f.addEventListener('submit', async e => {
        e.preventDefault();
        if (this.ocupado) return;
        const v = n => f[n].value.trim();
        const ok = p => /^\d{4,8}$/.test(p);
        const err = t => UI.toast(t, 'error');

        this.ocupado = true;
        try {
          if (activo) {
            const espera = this.espera();
            if (espera > 0) return err(`Espera ${this.textoEspera(espera)} para intentar de nuevo`);
            if (!(await this.verificar(v('actual'), c.dueno, c.salt))) {
              this.fallo();
              return err('Tu PIN actual no es correcto');
            }
            this.limpiarIntentos();
          }

          if (activo && f.desactivar.checked) {
            Store.set('seguridad', { activo: false });
            this.rol = 'dueno';
            this.guardarSesion();
            this.aplicar();
            UI.closeModal();
            return UI.toast('PIN desactivado');
          }

          const n = { ...c };
          if (!activo) {
            n.activo = true;
            n.salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
          }

          const pinDueno = v('pin');
          const pinEmp = v('emp');

          if (!activo || pinDueno) {
            if (!ok(pinDueno)) return err('El PIN debe tener entre 4 y 8 números');
            if (this.debil(pinDueno)) return err('Ese PIN es muy fácil de adivinar (0000, 1234...)');
            if (pinDueno !== v('pin2')) return err('Los PIN no coinciden');
          }
          if (pinEmp) {
            if (!ok(pinEmp)) return err('El PIN del empleado debe tener entre 4 y 8 números');
            if (this.debil(pinEmp)) return err('El PIN del empleado es muy fácil de adivinar');
          }
          if (pinDueno && pinEmp && pinDueno === pinEmp) return err('El PIN del empleado debe ser distinto al tuyo');
          if (pinEmp && !pinDueno && n.dueno && await this.verificar(pinEmp, n.dueno, n.salt)) {
            return err('El PIN del empleado debe ser distinto al tuyo');
          }
          if (pinDueno && !pinEmp && n.empleado && await this.verificar(pinDueno, n.empleado, n.salt)) {
            return err('Tu PIN debe ser distinto al del empleado');
          }

          if (pinDueno) n.dueno = await this.hash(pinDueno, n.salt);
          if (pinEmp) n.empleado = await this.hash(pinEmp, n.salt);
          if (f.quitarEmp && f.quitarEmp.checked) n.empleado = null;
          n.minutos = Number(f.minutos.value);

          let codigo = null;
          if (!activo || (f.recup && f.recup.checked)) {
            codigo = String(10000000 + this.aleatorio(90000000));
            n.recup = await this.hash(codigo, n.salt);
          }

          Store.set('seguridad', n);
          this.rol = 'dueno';
          this.guardarSesion();
          this.aplicar();

          if (codigo) this.mostrarCodigo(codigo);
          else { UI.closeModal(); UI.toast('Seguridad guardada'); }
        } finally {
          this.ocupado = false;
        }
      });
    });
  },

  mostrarCodigo(codigo) {
    UI.closeModal();
    const html = `
      <div style="text-align:center">
        <p>Si olvidas tu PIN, este código te deja entrar y poner uno nuevo.</p>
        <div class="lock-code">${codigo}</div>
        <p class="muted" style="font-size:.88rem">
          <b>Anótalo en papel ahora.</b> No se vuelve a mostrar. Sin el PIN y sin este código no hay forma de recuperar el acceso.
        </p>
        <button class="btn btn-primary btn-block" data-ok>Ya lo anoté</button>
      </div>`;
    UI.openModal('Código de recuperación', html, body => {
      body.querySelector('[data-ok]').addEventListener('click', () => {
        UI.closeModal();
        UI.toast('PIN activado');
      });
    });
  }
};

document.addEventListener('DOMContentLoaded', () => Store.listo.then(() => Seguridad.init()));