/* =========================================================
   APP - Navegación entre secciones y arranque del sistema
   Se carga de último, cuando todos los módulos ya existen
   ========================================================= */

const App = {
  views: {
    dashboard: { title: 'Inicio', subtitle: 'Resumen de tu negocio' },
    inventario: { title: 'Mercancía', subtitle: 'Lo que compras y a cuánto lo vendes' },
    catalogo:    { title: 'Catálogo',   subtitle: 'Tus precios al detal y al mayor' },
    clientes:    { title: 'Clientes',   subtitle: 'Personas y negocios a los que vendes' },
    reportes:    { title: 'Reportes',   subtitle: 'Lo que más vendes, tus mejores días y tu ganancia' },
    ventas: { title: 'Ventas', subtitle: 'Registra lo que vendes' },
    fiados: { title: 'Fiados', subtitle: 'Quién te debe y cuándo paga' },
    caja: { title: 'Caja', subtitle: 'Tu dinero, gastos y lo que queda' },
    calculadora: { title: 'Dólar BCV', subtitle: 'Calcula en dólares y bolívares' }
  },
  
  current: 'dashboard',
  
  init() {
    // Botones del menú
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.go(btn.dataset.view));
    });
    
    // Chip de la tasa -> lleva a la calculadora
    document.getElementById('rate-chip').addEventListener('click', () => this.go('calculadora'));
    
    // Cerrar ventana emergente
    document.getElementById('modal-close').addEventListener('click', UI.closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', e => {
      if (e.target.id === 'modal-backdrop') UI.closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') UI.closeModal();
    });
    
    // Si cambian los datos, se actualiza la tasa y la vista actual
    window.addEventListener('store:change', e => {
      this.updateRate();
      if (e.detail.key !== 'tasa') this.render();
    });
    
    // Abre la última sección visitada (o la que venga en la URL: #ventas)
    const fromUrl = location.hash.replace('#', '');
    const saved = Store.get('vista', 'dashboard');
    const start = this.views[fromUrl] ? fromUrl : (this.views[saved] ? saved : 'dashboard');
    
    this.updateRate();
    this.go(start);
  },
  
  go(view) {
    if (!this.views[view]) return;
    if (!Seguridad.puede(view)) view = Seguridad.inicio();
    this.current = view;
    Store.PREFIX && localStorage.setItem(Store.PREFIX + 'vista', JSON.stringify(view));
    history.replaceState(null, '', '#' + view);
    
    document.querySelectorAll('.nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === `view-${view}`));
    
    document.getElementById('view-title').textContent = this.views[view].title;
    document.getElementById('view-subtitle').textContent = this.views[view].subtitle;
    
    this.render();
    window.scrollTo({ top: 0 });
  },
  
  // Le pide al módulo de la sección actual que se dibuje
  render() {
    const box = document.getElementById(`${this.current}-content`);
    const mod = Modules[this.current];
    if (!box) return;
    
    if (mod && typeof mod.render === 'function') {
      mod.render(box);
    } else {
      box.innerHTML = `
        <div class="card empty">
          <i data-lucide="construction"></i>
          <p>Esta sección se construye en una próxima parte.</p>
        </div>`;
    }
    UI.icons();
  },
  
  updateRate() {
    const { valor } = Store.getTasa();
    document.getElementById('rate-value').textContent =
      valor > 0 ? Utils.bs(valor) : '-- Bs';
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());