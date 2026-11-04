/* =========================================================
   AJUSTES - Datos del negocio
   Se guardan en "config" y salen en la factura y en el
   ticket del cierre de caja.
   ========================================================= */

const Ajustes = {
  datos() { return Store.get('config', {}); },

  abrir() {
    const c = this.datos();
    const v = x => Utils.esc(c[x] || '');

    const html = `
      <form class="form" id="ajustes-form" autocomplete="off">
        <div class="field">
          <label>Nombre del negocio</label>
          <input name="negocio" type="text" placeholder="Mi Tienda" value="${v('negocio')}">
        </div>
        <div class="form-row">
          <div class="field">
            <label>RIF (opcional)</label>
            <input name="rif" type="text" placeholder="J-12345678-9" value="${v('rif')}">
          </div>
          <div class="field">
            <label>Teléfono (opcional)</label>
            <input name="telefono" type="text" inputmode="tel" placeholder="0414-0000000" value="${v('telefono')}">
          </div>
        </div>
        <div class="field">
          <label>Dirección (opcional)</label>
          <input name="direccion" type="text" placeholder="Calle, sector, ciudad" value="${v('direccion')}">
        </div>
        <div class="field">
          <label>Cajero o responsable del cierre (opcional)</label>
          <input name="cajero" type="text" placeholder="Nombre" value="${v('cajero')}">
        </div>
        <div class="field">
          <label>Mensaje al final de la factura</label>
          <input name="pie" type="text" placeholder="¡Gracias por su compra!" value="${v('pie')}">
        </div>
        <button type="button" class="btn btn-soft btn-block" data-seg><i data-lucide="lock"></i> Seguridad (PIN y empleados)</button>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="check"></i> Guardar</button>
      </form>`;

    UI.openModal('Datos del negocio', html, body => {
      const f = body.querySelector('#ajustes-form');
      body.querySelector('[data-seg]').addEventListener('click', () => Seguridad.configurar());
      f.addEventListener('submit', e => {
        e.preventDefault();
        const t = n => f[n].value.trim();
        Store.set('config', {
          ...this.datos(),
          negocio: t('negocio'), rif: t('rif'), telefono: t('telefono'),
          direccion: t('direccion'), cajero: t('cajero'), pie: t('pie')
        });
        UI.closeModal();
        UI.toast('Datos guardados');
      });
    });
  }
};
// Pone el nombre del negocio en el menú y en el título de la página
Ajustes.aplicarNombre = function() {
  const n = (Store.get('config', {}).negocio || '').trim();
  if (!n) return;
  const t = document.querySelector('.brand-text strong');
  if (t) t.textContent = n;
  document.title = n;
};
document.addEventListener('DOMContentLoaded', () => Ajustes.aplicarNombre());
window.addEventListener('store:change', e => {
  if (e.detail && e.detail.key === 'config') Ajustes.aplicarNombre();
});