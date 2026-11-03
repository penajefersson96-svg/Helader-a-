/* =========================================================
   STORE - Guarda y lee los datos en el navegador
   Todo se guarda en localStorage con el prefijo "heladeria_"
   ========================================================= */

const Store = {
  PREFIX: 'heladeria_',
  
  /* ---------- Lectura / escritura básica ---------- */
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(this.PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.error('Error leyendo', key, e);
      return fallback;
    }
  },
  
  set(key, value) {
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent('store:change', { detail: { key } }));
      return true;
    } catch (e) {
      console.error('Error guardando', key, e);
      UI.toast('No se pudo guardar. Revisa el espacio del navegador.', 'error');
      return false;
    }
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
  
  /* ---------- Respaldo (lo usaremos en una parte futura) ---------- */
  exportAll() {
    const data = {};
    Object.keys(localStorage)
      .filter(k => k.startsWith(this.PREFIX))
      .forEach(k => { data[k.slice(this.PREFIX.length)] = JSON.parse(localStorage.getItem(k)); });
    return JSON.stringify(data, null, 2);
  },
  
  importAll(json) {
    const data = JSON.parse(json);
    Object.entries(data).forEach(([k, v]) => {
      localStorage.setItem(this.PREFIX + k, JSON.stringify(v));
    });
    window.dispatchEvent(new CustomEvent('store:change', { detail: { key: '*' } }));
  }
};