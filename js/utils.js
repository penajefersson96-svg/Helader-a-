/* =========================================================
   UTILS - Funciones de ayuda usadas en todo el sistema
   ========================================================= */

/* Parte 16: no permite que otra página meta esta app dentro de un marco
   (así nadie puede taparla con botones falsos). Solo actúa en https. */
if (location.protocol === 'https:' && window.top !== window.self) {
  try { window.top.location = window.self.location; } catch (_) {}
  document.documentElement.innerHTML = '';
  throw new Error('Marco bloqueado');
}
// Registro de módulos: cada archivo (inventario.js, ventas.js...)
// se registra aquí con Modules.nombre = { render(container) {...} }
const Modules = {};

const Utils = {
  /* ---------- Identificadores ---------- */
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },
  
  /* ---------- Números y dinero ---------- */
  // Convierte texto a número. Acepta coma o punto: "12,5" -> 12.5
  num(value) {
    let s = String(value ?? '').trim().replace(/\s/g, '');
    if (s.includes(',') && s.includes('.')) {
      // el último símbolo es el decimal; el otro separa miles
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if ((s.match(/,/g) || []).length > 1) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
    if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) && Math.abs(n) <= 1e12 ? n : 0;
  },
  
  fmt(n, decimals = 2) {
    return new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(Number(n) || 0);
  },
  
  usd(n) { return '$' + Utils.fmt(n); },
  bs(n) { return Utils.fmt(n) + ' Bs'; },
  
  /* ---------- Fechas (formato guardado: AAAA-MM-DD) ---------- */
  toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  
  today() { return Utils.toISODate(new Date()); },
  
  // "2026-11-03" -> "03/11/2026"
  formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  },
  
  // Días que faltan para una fecha (negativo = ya pasó)
  daysUntil(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((target - now) / 86400000);
  },
  
  /* ---------- Seguridad: evita que un texto rompa el HTML ---------- */
  esc(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

/* =========================================================
   UI - Ventanas emergentes, avisos e iconos
   ========================================================= */
const UI = {
  // Vuelve a dibujar los iconos después de insertar HTML nuevo
  icons() {
    if (window.lucide) lucide.createIcons();
  },
  
  toast(message, type = 'success') {
    const box = document.getElementById('toast-container');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  },
  
  openModal(title, html, onMount) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-backdrop').classList.add('open');
    UI.icons();
    if (typeof onMount === 'function') onMount(document.getElementById('modal-body'));
  },
  
  closeModal() {
    document.getElementById('modal-backdrop').classList.remove('open');
    document.getElementById('modal-body').innerHTML = '';
  },
  
  confirm(message) {
    return window.confirm(message);
  }
};