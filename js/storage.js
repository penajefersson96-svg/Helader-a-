/* =========================================================
   STORE - Guarda y lee los datos en el navegador
   Todo se guarda en localStorage con el prefijo PREFIX (ver abajo)
   ========================================================= */

const Store = {
  PREFIX: 'heladeria_',   // <- déjalo con el valor que ya tenías

  // Modo cifrado (Parte 18): los datos viven en memoria y se guardan sellados.
  _mem: null,                       // { clave: 'texto JSON' } cuando está abierto
  _bloqueado: false,                // cifrado y todavía sin la contraseña
  _sucio: new Set(),
  _volcando: false,

  /* ---------- Acceso crudo (texto JSON) ---------- */
  _leer(key) {
    if (this._bloqueado) return null;
    if (this._mem) { const v = this._mem[key]; return v === undefined ? null : v; }
    return localStorage.getItem(this.PREFIX + key);
  },

  _escribir(key, texto) {
    if (this._bloqueado) throw new Error('bloqueado');
    if (this._mem) { this._mem[key] = texto; this._marcar(key); return; }
    localStorage.setItem(this.PREFIX + key, texto);
  },

  _borrar(key) {
    if (this._bloqueado) throw new Error('bloqueado');
    if (this._mem) { delete this._mem[key]; this._marcar(key); return; }
    localStorage.removeItem(this.PREFIX + key);
  },

  // Guarda sellado (cifrado) lo que cambió, en segundo plano y en orden
  _marcar(key) {
    this._sucio.add(key);
    if (this._volcando) return;
    this._volcando = true;
    (async () => {
      await Promise.resolve();   // junta escrituras seguidas
      try {
        while (this._sucio.size) {
          const k = this._sucio.values().next().value;
          this._sucio.delete(k);
          const v = this._mem ? this._mem[k] : undefined;
          try {
            if (v === undefined) localStorage.removeItem(this.PREFIX + k);
            else localStorage.setItem(this.PREFIX + k, await Boveda.sellar(k, v));
          } catch (e) {
            console.error('Error guardando', k, e);
            UI.toast('No se pudo guardar. Revisa el espacio del navegador.', 'error');
          }
        }
      } finally { this._volcando = false; }
    })();
  },

  async esperarVolcado() {
    while (this._volcando || this._sucio.size) await new Promise(r => setTimeout(r, 10));
  },

  /* ---------- Lectura / escritura básica ---------- */
  get(key, fallback = null) {
    try {
      const raw = this._leer(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.error('Error leyendo', key, e);
      return fallback;
    }
  },

  set(key, value) {
    try {
      this._escribir(key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent('store:change', { detail: { key } }));
      return true;
    } catch (e) {
      console.error('Error guardando', key, e);
      UI.toast('No se pudo guardar. Revisa el espacio del navegador.', 'error');
      return false;
    }
  },

  // Igual que set, pero sin avisar a la pantalla (para guardar la sección actual)
  setQuiet(key, value) {
    try { this._escribir(key, JSON.stringify(value)); } catch (e) { /* nada */ }
  },

  /* ---------- Listas (productos, ventas, fiados, gastos...) ---------- */
  all(name) {
    return this.get(name, []);
  },
  
  find(name, id) {
    return this.all(name).find(item => item.id === id) || null;
  },
  
  add(name, item) {
    const list = this.all(name);
    const record = { id: Utils.uid(), creado: new Date().toISOString(), ...item };
    list.push(record);
    this.set(name, list);
    return record;
  },
  
  update(name, id, changes) {
    const list = this.all(name);
    const i = list.findIndex(item => item.id === id);
    if (i === -1) return null;
    list[i] = { ...list[i], ...changes };
    this.set(name, list);
    return list[i];
  },
  
  remove(name, id) {
    const list = this.all(name).filter(item => item.id !== id);
    this.set(name, list);
  },
  
  /* ---------- Tasa del dólar BCV ---------- */
  getTasa() {
    return this.get('tasa', { valor: 0, fecha: null });
  },
  
  setTasa(valor) {
    return this.set('tasa', { valor: Number(valor) || 0, fecha: Utils.today() });
  },
  
  /* ---------- Respaldo ---------- */

  // Qué entra en un respaldo y de qué tipo es cada cosa.
  // "seguridad" (el PIN) NUNCA entra al respaldo ni se restaura desde uno.
  FORMATO: {
    productos: 'lista', ventas: 'lista', deudas: 'lista', movimientos: 'lista',
    clientes: 'lista', facturas: 'lista', mermas: 'lista', cierres: 'lista',
    devoluciones: 'lista', categorias: 'textos',
    config: 'objeto', tasa: 'objeto',
    facturaSeq: 'numero', cierreSeq: 'numero',
    ultimoRespaldo: 'texto', papel: 'texto', vista: 'texto'
  },

  exportAll() {
    const data = {};
    Object.keys(this.FORMATO).forEach(k => {
      const raw = this._leer(k);
      if (raw === null) return;
      try { data[k] = JSON.parse(raw); } catch (e) { /* dato dañado: se omite */ }
    });
    return JSON.stringify(data, null, 2);
  },

  // Revisa un respaldo ANTES de tocar nada. Devuelve { datos } o { error }.
  validarRespaldo(texto) {
    if (typeof texto !== 'string' || texto.length > 8 * 1024 * 1024) {
      return { error: 'El archivo es demasiado grande para ser un respaldo' };
    }
    let obj;
    try { obj = JSON.parse(texto); } catch (e) { return { error: 'El archivo no se puede leer' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'Ese archivo no es un respaldo válido' };

    const NUM = ['cantidad', 'total', 'precioUnit', 'costoUnit', 'costo', 'costoTotal',
      'costoOriginal', 'monto', 'precioOrig', 'pagoMonto', 'tasa', 'cantidadInicial', 'devuelto'];
    const fechaOk = f => f === undefined || f === null || f === '' || /^\d{4}-\d{2}-\d{2}$/.test(f);
    const mal = k => ({ error: `El respaldo tiene datos dañados en "${k}"` });
    const datos = {};

    for (const [k, v] of Object.entries(obj)) {
      const tipo = this.FORMATO[k];
      if (!tipo) continue;                         // lo desconocido (y el PIN) se ignora

      if (tipo === 'lista') {
        if (!Array.isArray(v) || v.length > 50000) return mal(k);
        for (const r of v) {
          if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string') return mal(k);
          for (const n of NUM) {
            if (r[n] !== undefined && r[n] !== null && !Number.isFinite(r[n])) return mal(k);
          }
          if (!fechaOk(r.fecha) || !fechaOk(r.fechaPago)) return mal(k);
        }
      } else if (tipo === 'textos') {
        if (!Array.isArray(v) || v.length > 500 || !v.every(x => typeof x === 'string' && x.length <= 80)) return mal(k);
      } else if (tipo === 'objeto') {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return mal(k);
      } else if (tipo === 'numero') {
        if (!Number.isFinite(v)) return mal(k);
      } else if (tipo === 'texto') {
        if (typeof v !== 'string' || v.length > 200) return mal(k);
      }
      datos[k] = v;
    }

    if (!Object.keys(datos).length) return { error: 'El archivo no tiene datos de este sistema' };
    return { datos };
  },

  // Reemplaza los datos por los del respaldo. Si algo falla a la mitad, deja todo como estaba.
  importAll(texto) {
    const r = this.validarRespaldo(texto);
    if (r.error) return r;

    const claves = Object.keys(this.FORMATO);
    const antes = {};
    claves.forEach(k => { antes[k] = this._leer(k); });

    try {
      claves.forEach(k => this._borrar(k));
      Object.entries(r.datos).forEach(([k, v]) => this._escribir(k, JSON.stringify(v)));
    } catch (e) {
      claves.forEach(k => {
        if (antes[k] === null) this._borrar(k);
        else this._escribir(k, antes[k]);
      });
      return { error: 'No se pudo restaurar (sin espacio). Tus datos quedaron como estaban.' };
    }

    window.dispatchEvent(new CustomEvent('store:change', { detail: { key: '*' } }));
    return { ok: true };
  }
};

/* Promesa que se cumple cuando los datos ya se pueden usar.
   Sin cifrado es inmediata; con cifrado, cuando se escribe la contraseña. */
Store._bloqueado = localStorage.getItem(Store.PREFIX + '_boveda') !== null;
Store.listo = new Promise(r => { Store._abrir = r; });
if (!Store._bloqueado) Store._abrir();