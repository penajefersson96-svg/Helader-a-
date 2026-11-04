/* =========================================================
   IMPRIMIR - Imprime una imagen (factura, comprobante...)
   en hoja carta/A4 o en ticket de 80 mm / 58 mm.
   Se guarda el tamaño de papel elegido ("papel").
   ========================================================= */

const Imprimir = {
  papel() { return Store.get('papel', 'hoja'); },

  cambiar(valor) { Store.set('papel', valor); },

  // Selector de papel para pegar dentro de un modal
  selector() {
    const p = this.papel();
    const op = (v, t) => `<option value="${v}" ${p === v ? 'selected' : ''}>${t}</option>`;
    return `
      <div class="field mt">
        <label>Papel para imprimir</label>
        <select data-papel>
          ${op('hoja', 'Hoja carta / A4')}
          ${op('80', 'Ticket 80 mm')}
          ${op('58', 'Ticket 58 mm')}
        </select>
      </div>`;
  },

  imagen(canvas, titulo) {
    const papel = this.papel();
    const cfg = {
      hoja: { size: 'A4', margen: '12mm', ancho: '150mm' },
      '80': { size: '80mm auto', margen: '2mm', ancho: '72mm' },
      '58': { size: '58mm auto', margen: '1mm', ancho: '54mm' }
    }[papel] || { size: 'A4', margen: '12mm', ancho: '150mm' };

    // En ticket (impresora térmica) se imprime en blanco y negro
    let fuente = canvas;
    if (papel !== 'hoja') {
      fuente = document.createElement('canvas');
      fuente.width = canvas.width;
      fuente.height = canvas.height;
      const x = fuente.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, fuente.width, fuente.height);
      x.filter = 'grayscale(1) contrast(1.6)';
      x.drawImage(canvas, 0, 0);
    }

    const url = fuente.toDataURL('image/png');
    const marco = document.createElement('iframe');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(marco);

    const d = marco.contentWindow.document;
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${Utils.esc(titulo || 'Imprimir')}</title>
      <style>
        @page { size: ${cfg.size}; margin: ${cfg.margen}; }
        html, body { margin: 0; padding: 0; background: #fff; }
        img { display: block; margin: 0 auto; width: ${cfg.ancho}; max-width: 100%; height: auto; }
      </style></head><body><img src="${url}"></body></html>`);
    d.close();

    const img = d.querySelector('img');
    const lanzar = () => {
      try {
        marco.contentWindow.focus();
        marco.contentWindow.print();
      } catch (e) {
        UI.toast('No se pudo abrir la impresión. Descarga la imagen e imprímela.', 'error');
      }
      setTimeout(() => marco.remove(), 60000);
    };
    if (img.complete) lanzar(); else img.onload = lanzar;
  }
};