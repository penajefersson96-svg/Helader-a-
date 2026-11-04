/* =========================================================
   PICKER - Buscador desplegable de productos
   Lo usan la venta y los fiados.
   items: [{ id, nombre, categoria, sub, precio, pop }]
   ========================================================= */

const Picker = {
  attach({ input, list, items, onSelect, onClear, max = 6 }) {
    let elegido = '';
    const norm = s => Inventario.norm(s);

    const pintar = () => {
      const texto = input.value.trim();
      const q = texto === elegido ? '' : norm(texto);

      let res = items.filter(i =>
        !q || norm(i.nombre).includes(q) || norm(i.categoria).includes(q));

      // Primero los que empiezan con lo escrito; si no hay texto, los más vendidos
      res.sort((a, b) => {
        const ea = norm(a.nombre).startsWith(q) ? 0 : 1;
        const eb = norm(b.nombre).startsWith(q) ? 0 : 1;
        return ea - eb || (b.pop || 0) - (a.pop || 0) || a.nombre.localeCompare(b.nombre);
      });

      const total = res.length;
      res = res.slice(0, max);

      list.innerHTML = res.length
        ? res.map(i => `
            <button type="button" class="pick" data-id="${Utils.esc(i.id)}">
              <span>
                <b>${Utils.esc(i.nombre)}</b>
                <small>${Utils.esc(i.categoria || '')}${i.sub ? ' · ' + Utils.esc(i.sub) : ''}</small>
              </span>
              <span class="pick-price">${Utils.esc(i.precio || '')}</span>
            </button>`).join('')
          + (total > max ? `<div class="pick-more">Hay ${total - max} más. Sigue escribiendo para filtrar.</div>` : '')
        : '<div class="pick-more">No hay productos con ese nombre.</div>';
    };

    const abrir = () => { list.classList.remove('hidden'); pintar(); };
    const cerrar = () => list.classList.add('hidden');

    input.addEventListener('focus', () => { abrir(); input.select(); });
    input.addEventListener('input', () => {
      elegido = '';
      if (onClear) onClear();
      abrir();
    });

    list.addEventListener('click', e => {
      const b = e.target.closest('.pick');
      if (!b) return;
      const item = items.find(i => String(i.id) === b.dataset.id);
      if (!item) return;
      elegido = item.nombre;
      input.value = item.nombre;
      cerrar();
      if (onSelect) onSelect(item);
    });

    // Tocar fuera del campo cierra la lista
    const campo = input.closest('.field') || input.parentElement;
    const fuera = e => {
      if (!list.isConnected) return document.removeEventListener('click', fuera);
      if (!campo.contains(e.target)) cerrar();
    };
    document.addEventListener('click', fuera);

    return {
      fijar(nombre) { elegido = nombre; input.value = nombre; cerrar(); }
    };
  }
};