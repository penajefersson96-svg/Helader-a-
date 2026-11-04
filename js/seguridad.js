/* =========================================================
   SEGURIDAD - PIN, roles (dueño / empleado) y bloqueo
   Se guarda en "seguridad":
   { activo, salt, dueno, empleado, recup, minutos }
   Los PIN y el código de recuperación se guardan con hash,
   nunca en claro. El rol de la sesión va en sessionStorage.
   ========================================================= */

const Seguridad = {
  rol: null,          // 'dueno' | 'empleado' | null (bloqueado)
  salio: 0,
  buf: '',
  fallos: 0,
  hasta: 0,
  permitidas: ['ventas', 'fiados', 'calculadora'],   // lo que ve el empleado

  cfg() { return Store.get('seguridad', { activo: false }); },
  activo() { return !!this.cfg().activo; },
  dueno() { return this.rol === 'dueno'; },
  puede(vista) { return this.rol === 'dueno' || this.permitidas.includes(vista); },
  inicio() { return this.rol === 'dueno' ? 'dashboard' : 'ventas'; },

  // Hash simple y siempre igual en cualquier navegador
  hash(txt, salt) {
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

  aleatorio(max) {
    try { return crypto.getRandomValues(new Uint32Array(1))[0] % max; }
    catch (e) { return Math.floor(Math.random() * max); }
  },

  /* ---------- Arranque ---------- */
  init() {
    this.montarBoton();

    if (!this.activo()) {
      this.rol = 'dueno';
      this.aplicar();
    } else {
      let r = null;
      try { r = sessionStorage.getItem('heladeria_rol'); } catch (e) { /* nada */ }
      if (r === 'dueno' || r === 'empleado') { this.rol = r; this.aplicar(); }
      else this.mostrar();
    }

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
    try { sessionStorage.setItem('heladeria_rol', rol); } catch (e) { /* nada */ }
    this.fallos = 0;
    const el = document.getElementById('lock');
    if (el) el.classList.add('lock-off');
    this.aplicar();
    App.go(App.current);
    UI.icons();
  },

  /* ---------- Pantalla de bloqueo ---------- */
  mostrar() {
    this.rol = null;
    try { sessionStorage.removeItem('heladeria_rol'); } catch (e) { /* nada */ }
    UI.closeModal();
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

  vistaPin() {
    this.estado = 'pin';
    const el = document.getElementById('lock');
    const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
      .map(n => `<button type="button" data-k="${n}">${n}</button>`).join('');
    el.innerHTML = `
      <div class="lock-box">
        <div class="lock-logo"><i data-lucide="lock"></i></div>
        <h2>${Utils.esc((Store.get('config', {}).negocio) || 'Mi Heladería')}</h2>
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
    else if (this.buf.length < 6) this.buf += k;
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
  },

  entrarConPin() {
    const c = this.cfg();
    if (Date.now() < this.hasta) {
      return this.msg(`Espera ${Math.ceil((this.hasta - Date.now()) / 1000)} s para intentar de nuevo`);
    }
    if (this.buf.length < 4) return this.msg('El PIN tiene entre 4 y 6 números');
    const h = this.hash(this.buf, c.salt);
    this.buf = '';
    this.puntos();

    if (h === c.dueno) return this.entrar('dueno');
    if (c.empleado && h === c.empleado) return this.entrar('empleado');

    this.fallos++;
    if (this.fallos >= 5) {
      this.fallos = 0;
      this.hasta = Date.now() + 30000;
      this.msg('Demasiados intentos. Espera 30 segundos.');
    } else {
      this.msg('PIN incorrecto');
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
        <button type="button" class="lock-link" data-a="volver">Volver</button>
      </form>`;
    UI.icons();
  },

  vistaNuevo() {
    this.estado = 'nuevo';
    const el = document.getElementById('lock');
    el.innerHTML = `
      <form class="lock-box form" autocomplete="off">
        <div class="lock-logo"><i data-lucide="lock"></i></div>
        <h2>Nuevo PIN del dueño</h2>
        <div class="field">
          <input name="pin" type="password" inputmode="numeric" maxlength="6" placeholder="4 a 6 números">
        </div>
        <div class="field">
          <input name="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="Repite el PIN">
        </div>
        <div class="lock-msg" id="lock-msg"></div>
        <button type="submit" class="btn btn-primary btn-block">Guardar y entrar</button>
      </form>`;
    UI.icons();
  },

  enviar() {
    const el = document.getElementById('lock');
    const f = el.querySelector('form');
    if (!f) return;
    const c = this.cfg();

    if (this.estado === 'recup') {
      if (this.hash(f.codigo.value.trim(), c.salt) !== c.recup) return this.msg('Código incorrecto');
      return this.vistaNuevo();
    }
    if (this.estado === 'nuevo') {
      const p = f.pin.value.trim();
      if (!/^\d{4,6}$/.test(p)) return this.msg('Usa entre 4 y 6 números');
      if (p !== f.pin2.value.trim()) return this.msg('Los PIN no coinciden');
      const h = this.hash(p, c.salt);
      if (c.empleado && c.empleado === h) return this.msg('Debe ser distinto al del empleado');
      Store.set('seguridad', { ...c, dueno: h });
      this.entrar('dueno');
      UI.toast('PIN cambiado');
    }
  },

  /* ---------- Configuración (desde "Mi negocio") ---------- */
  configurar() {
    const c = this.cfg();
    const activo = !!c.activo;
    const campo = (n, l, p) => `
      <div class="field">
        <label>${l}</label>
        <input name="${n}" type="password" inputmode="numeric" maxlength="6" placeholder="${p || ''}">
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
        ${campo('pin', activo ? 'Nuevo PIN del dueño (opcional)' : 'PIN del dueño', activo ? 'Vacío = no cambiarlo' : '4 a 6 números')}
        ${campo('pin2', 'Repite el PIN del dueño')}
        ${campo('emp', 'PIN del empleado (opcional)', c.empleado ? 'Vacío = no cambiarlo' : 'Vacío = sin empleados')}
        ${c.empleado ? check('quitarEmp', 'Quitar el PIN del empleado') : ''}

        <div class="field">
          <label>Bloquear sola si sales de la app por</label>
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
      f.addEventListener('submit', e => {
        e.preventDefault();
        const v = n => f[n].value.trim();
        const ok = p => /^\d{4,6}$/.test(p);
        const err = t => UI.toast(t, 'error');

        if (activo && this.hash(v('actual'), c.salt) !== c.dueno) return err('Tu PIN actual no es correcto');

        if (activo && f.desactivar.checked) {
          Store.set('seguridad', { activo: false });
          this.rol = 'dueno';
          this.aplicar();
          UI.closeModal();
          return UI.toast('PIN desactivado');
        }

        const n = { ...c };
        if (!activo) {
          n.activo = true;
          n.salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
        if (!activo || v('pin')) {
          if (!ok(v('pin'))) return err('El PIN debe tener entre 4 y 6 números');
          if (v('pin') !== v('pin2')) return err('Los PIN no coinciden');
          n.dueno = this.hash(v('pin'), n.salt);
        }
        if (v('emp')) {
          if (!ok(v('emp'))) return err('El PIN del empleado debe tener entre 4 y 6 números');
          n.empleado = this.hash(v('emp'), n.salt);
        }
        if (f.quitarEmp && f.quitarEmp.checked) n.empleado = null;
        if (n.empleado && n.empleado === n.dueno) return err('El PIN del empleado debe ser distinto al tuyo');
        n.minutos = Number(f.minutos.value);

        let codigo = null;
        if (!activo || (f.recup && f.recup.checked)) {
          codigo = String(10000000 + this.aleatorio(90000000));
          n.recup = this.hash(codigo, n.salt);
        }

        Store.set('seguridad', n);
        this.rol = 'dueno';
        try { sessionStorage.setItem('heladeria_rol', 'dueno'); } catch (x) { /* nada */ }
        this.aplicar();

        if (codigo) this.mostrarCodigo(codigo);
        else { UI.closeModal(); UI.toast('Seguridad guardada'); }
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

document.addEventListener('DOMContentLoaded', () => Seguridad.init());