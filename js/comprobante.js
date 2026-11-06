/* =========================================================
   COMPROBANTE - Ticket del cierre de caja
   Formato de ticket de negocio: angosto, letra de máquina,
   blanco y negro, con espacio para firmas.
   ========================================================= */

const Comprobante = {

  cierre(fecha) {
    const c = Store.all('cierres').find(x => x.fecha === fecha);
    if (!c) return UI.toast('Primero guarda el cierre', 'error');

    const html = `
      <div class="catalog-preview" style="padding:0"><canvas id="comp-canvas"></canvas></div>
      <div class="row mt">
        <button class="btn btn-primary" data-a="imprimir"><i data-lucide="printer"></i> Imprimir</button>
        <button class="btn btn-soft" data-a="descargar"><i data-lucide="download"></i> Descargar</button>
        <button class="btn btn-soft" data-a="compartir"><i data-lucide="share-2"></i> Compartir</button>
      </div>
      ${Imprimir.selector()}`;

    UI.openModal('Ticket del cierre', html, body => {
      const canvas = body.querySelector('#comp-canvas');
      this.dibujar(canvas, c);
      const nombre = `cierre-${c.fecha}.png`;

      body.onchange = e => {
        if (e.target.matches('[data-papel]')) Imprimir.cambiar(e.target.value);
      };
      body.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'imprimir') Imprimir.imagen(canvas, 'Cierre ' + c.fecha);
        if (b.dataset.a === 'descargar') this.descargar(canvas, nombre);
        if (b.dataset.a === 'compartir') this.compartir(canvas, nombre);
      };
    });
  },

  descargar(canvas, nombre) {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      UI.toast('Ticket descargado');
    }, 'image/png');
  },

  compartir(canvas, nombre) {
    canvas.toBlob(async blob => {
      const file = new File([blob], nombre, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Cierre de caja' }); } catch (e) { /* canceló */ }
      } else {
        UI.toast('Tu navegador no puede compartir. Se descargará.', 'error');
        this.descargar(canvas, nombre);
      }
    }, 'image/png');
  },

  dif(d, moneda) {
    if (d === null || d === undefined) return null;
    if (Math.abs(d) < 0.005) return 'CUADRA';
    const m = moneda === 'BS' ? Utils.bs(Math.abs(d)) : Utils.usd(Math.abs(d));
    return (d > 0 ? 'SOBRA ' : 'FALTA ') + m;
  },

  dibujar(canvas, c) {
    const F = '"Courier New", Courier, monospace';
    const W = 576, PAD = 28, S = 2;
    const r = Cierre.resumen(c.fecha);
    const cfg = Store.get('config', {});
    const tasa = (r.ventas.length && r.ventas[r.ventas.length - 1].tasa) || Tasa.valor();
    const bs = usd => Utils.bs(usd * tasa);
    const hay = s => Math.abs(s.USD) >= 0.005 || Math.abs(s.BS) >= 0.005;
    const dual = s => Cierre.dual(s);
    const ganancia = c.gananciaUsd !== undefined ? c.gananciaUsd : r.ganancia;

    // ---- Se arma la lista de líneas del ticket ----
    const ops = [];
    const C = (txt, size = 16, bold = false) => ops.push({ k: 'c', txt, size, bold });
    const R = (l, v, bold = false) => ops.push({ k: 'r', l, v, bold });
    const S_ = () => ops.push({ k: 's' });
    const T = txt => ops.push({ k: 't', txt });
    const G = h => ops.push({ k: 'g', h });

    C(cfg.negocio || 'Mi Tienda', 26, true);
    if (cfg.rif) C('RIF: ' + cfg.rif, 15);
    if (cfg.direccion) C(cfg.direccion, 14);
    if (cfg.telefono) C('Tel: ' + cfg.telefono, 14);
    S_();
    C('CIERRE DE CAJA', 24, true);
    if (c.numero) C('N° ' + String(c.numero).padStart(4, '0'), 16, true);
    R('Fecha', Utils.formatDate(c.fecha));
    R('Emitido', new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }));
    if (cfg.cajero) R('Cajero', cfg.cajero);
    if (tasa > 0) R('Tasa BCV', Utils.bs(tasa));
    S_();

    T('VENTAS');
    R('Nº de ventas', String(r.ventas.length));
    R('Total vendido', Utils.usd(r.totalUsd), true);
    R('', bs(r.totalUsd));
    R('Al mayor', Utils.usd(r.mayorUsd));
    R('Fiado (a crédito)', Utils.usd(r.fiadoUsd));
    if (r.devolucionesUsd > 0.005) R('Devoluciones', Utils.usd(r.devolucionesUsd));
    S_();

    T('ENTRADAS A CAJA');
    R('Ventas de contado', dual(r.ventasCaja));
    R('Cobros de fiados', dual(r.cobros));
    if (hay(r.otrosIng)) R('Otros ingresos', dual(r.otrosIng));
    if (hay(r.cambioIn)) R('Cambio de divisas (recibido)', dual(r.cambioIn));
    R('TOTAL ENTRADAS', dual(r.entro), true);
    S_();

    T('SALIDAS DE CAJA');
    if (hay(r.gastosCaja)) R('Gastos', dual(r.gastosCaja));
    if (hay(r.compras)) R('Compra de mercancía', dual(r.compras));
    if (hay(r.devol)) R('Devoluciones / ajustes', dual(r.devol));
    if (hay(r.cambioOut)) R('Cambio de divisas (entregado)', dual(r.cambioOut));
    if (!hay(r.salio)) R('Sin salidas', '—');
    R('TOTAL SALIDAS', dual(r.salio), true);
    S_();

    T('GANANCIA DEL DÍA');
    R('Pérdidas (mermas)', Utils.usd(r.perdidasUsd));
    R('GANANCIA NETA', Utils.usd(ganancia), true);
    R('', bs(ganancia));
    S_();

    if (c.contadoBs != null || c.contadoUsd != null) {
      T('CUADRE DE CAJA');
      R('Debe haber Bs', Utils.bs(c.esperadoBs));
      R('Debe haber $', Utils.usd(c.esperadoUsd));
      if (c.contadoBs != null) R('Contado Bs', Utils.bs(c.contadoBs));
      if (c.contadoUsd != null) R('Contado $', Utils.usd(c.contadoUsd));
      const dBs = this.dif(c.difBs, 'BS');
      const dUsd = this.dif(c.difUsd, 'USD');
      if (dBs) R('Diferencia Bs', dBs, true);
      if (dUsd) R('Diferencia $', dUsd, true);
      if (c.nota) { G(6); C('Nota: ' + c.nota, 14); }
      S_();
    }

    G(34);
    ops.push({ k: 'f' });
    G(18);
    C('Documento de control interno', 13);
    C('Sin validez fiscal', 13);

    // ---- Alto del ticket ----
    const alto = o => ({ c: o.size + 12, r: 26, s: 22, t: 30, g: o.h, f: 56 })[o.k];
    const H = PAD + ops.reduce((a, o) => a + alto(o), 0) + PAD;

    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';

    // ---- Dibujo ----
    let y = PAD;
    ops.forEach(o => {
      if (o.k === 'c') {
        ctx.textAlign = 'center';
        ctx.font = `${o.bold ? '700' : '400'} ${o.size}px ${F}`;
        ctx.fillText(Factura.ajustar(ctx, o.txt, W - PAD * 2), W / 2, y + o.size + 2);
      } else if (o.k === 'r') {
        ctx.font = `${o.bold ? '700' : '400'} 16px ${F}`;
        ctx.textAlign = 'right';
        ctx.fillText(o.v, W - PAD, y + 18);
        ctx.textAlign = 'left';
        const ancho = W - PAD * 2 - ctx.measureText(o.v).width - 12;
        if (o.l) ctx.fillText(Factura.ajustar(ctx, o.l, ancho), PAD, y + 18);
      } else if (o.k === 's') {
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(PAD, y + 11);
        ctx.lineTo(W - PAD, y + 11);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (o.k === 't') {
        ctx.textAlign = 'left';
        ctx.font = `700 17px ${F}`;
        ctx.fillText(o.txt, PAD, y + 20);
      } else if (o.k === 'f') {
        // Espacio para firmas
        const mitad = W / 2;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(PAD, y + 28); ctx.lineTo(mitad - 14, y + 28);
        ctx.moveTo(mitad + 14, y + 28); ctx.lineTo(W - PAD, y + 28);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.font = `400 14px ${F}`;
        ctx.fillText('Cajero', (PAD + mitad - 14) / 2, y + 48);
        ctx.fillText('Revisado', (mitad + 14 + W - PAD) / 2, y + 48);
      }
      y += alto(o);
    });
  }
};