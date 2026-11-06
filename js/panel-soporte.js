/* =========================================================
   PANEL DE SOPORTE (solo para el dueño del sistema)
   - Crea la llave maestra (ECDH P-256). La llave PRIVADA nunca
     sale de este teléfono sin cifrar: se guarda cifrada con tu
     frase secreta (PBKDF2 600.000 + AES-GCM).
   - Contesta solicitudes de la app: PIN (reiniciar) o datos
     cifrados (solo si el cliente permitió la copia de soporte).
   ========================================================= */

(() => {
  const $ = id => document.getElementById(id);
  const CLAVE = 'soporte_llave';          // { pub, blob }
  const ITER = 600000;
  let priv = null;                         // llave privada abierta (solo en memoria)

  const msg = (id, t, ok) => { const e = $(id); e.textContent = t || ''; e.className = t ? (ok ? 'ok' : 'err') : ''; };
  const guardado = () => { try { return JSON.parse(localStorage.getItem(CLAVE)); } catch (e) { return null; } };
  const copiar = async (txt, id) => {
    try { await navigator.clipboard.writeText(txt); msg(id, 'Copiado', true); }
    catch (e) { msg(id, 'No se pudo copiar. Selecciona el texto y cópialo a mano.'); }
  };

  async function kek(frase, sal) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(frase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function sellarPriv(jwk, frase) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('tienda-mk1') },
      await kek(frase, sal), new TextEncoder().encode(JSON.stringify(jwk))));
    const out = new Uint8Array(28 + ct.length);
    out.set(sal, 0); out.set(iv, 16); out.set(ct, 28);
    return 'TMK1-' + Maestra._b64u(out);
  }

  async function abrirPriv(blob, frase) {
    const b = Maestra._deB64u(String(blob).replace(/\s+/g, '').replace(/^TMK1-/, ''));
    const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(16, 28), additionalData: new TextEncoder().encode('tienda-mk1') },
      await kek(frase, b.slice(0, 16)), b.slice(28));
    const jwk = JSON.parse(new TextDecoder().decode(plano));
    return { jwk, key: await crypto.subtle.importKey('jwk', jwk, Maestra.CURVA, false, ['deriveBits']) };
  }

  async function pubDeJwk(jwk) {
    const k = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, Maestra.CURVA, true, []);
    return Maestra._b64u(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
  }

  function pintar() {
    const g = guardado();
    $('sin-llave').classList.toggle('hidden', !!g);
    $('con-llave').classList.toggle('hidden', !g);
    $('estado-llave').textContent = !g ? '' : priv ? 'Tu llave está abierta en esta pantalla.' : 'Escribe tu frase para abrir tu llave.';
    $('pub-box').classList.toggle('hidden', !g);
    $('rest-sec').classList.toggle('hidden', !!g);
    if (g) { $('t-pub').value = g.pub; $('t-blob').value = g.blob; }
  }

  $('b-crear').onclick = async () => {
    const f1 = $('f-nueva').value, f2 = $('f-nueva2').value;
    if (f1.length < 10) return msg('m-llave', 'La frase debe tener al menos 10 caracteres');
    if (f1 !== f2) return msg('m-llave', 'Las frases no coinciden');
    msg('m-llave', 'Creando…', true);
    try {
      const par = await crypto.subtle.generateKey(Maestra.CURVA, true, ['deriveBits']);
      const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
      const pub = Maestra._b64u(new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)));
      const blob = await sellarPriv(jwk, f1);
      localStorage.setItem(CLAVE, JSON.stringify({ pub, blob }));
      priv = par.privateKey;
      $('f-nueva').value = $('f-nueva2').value = '';
      msg('m-llave', 'Listo. Copia la llave pública a js/maestra.js y guarda la copia de seguridad.', true);
    } catch (e) { console.error(e); msg('m-llave', 'No se pudo crear la llave'); }
    pintar();
  };

  $('b-abrir').onclick = async () => {
    const g = guardado();
    try {
      priv = (await abrirPriv(g.blob, $('f-abrir').value)).key;
      $('f-abrir').value = '';
      msg('m-llave', 'Llave abierta', true);
    } catch (e) { msg('m-llave', 'Frase incorrecta'); }
    pintar();
  };

  $('b-bloq').onclick = () => $('pub-box').scrollIntoView();
  $('b-cpub').onclick = () => copiar($('t-pub').value, 'm-llave');
  $('b-cblob').onclick = () => copiar($('t-blob').value, 'm-llave');
  $('b-restaurar').onclick = () => $('rest-box').classList.toggle('hidden');
  $('b-rest-ok').onclick = async () => {
    const frase = $('f-rest').value;
    const texto = $('t-rest').value.replace(/\s+/g, '');
    if (!texto.startsWith('TMK1-')) return msg('m-llave', 'Esa no es una copia de seguridad (debe empezar con TMK1-)');
    if (!frase) return msg('m-llave', 'Escribe la frase secreta de esa copia');
    msg('m-llave', 'Restaurando…', true);
    try {
      const { jwk, key } = await abrirPriv(texto, frase);
      localStorage.setItem(CLAVE, JSON.stringify({ pub: await pubDeJwk(jwk), blob: texto }));
      priv = key;
      $('t-rest').value = $('f-rest').value = '';
      $('rest-box').classList.add('hidden');
      msg('m-llave', 'Llave restaurada y abierta. Ya puedes contestar solicitudes.', true);
    } catch (e) { msg('m-llave', 'No se pudo abrir esa copia (frase incorrecta o copia incompleta)'); }
    pintar();
  };

  /* ---------- Contestar ---------- */
  async function responder(texto) {
    const t = texto.replace(/\s+/g, '');
    if (!t.startsWith('SOL1-')) throw new Error('Eso no es una solicitud (debe empezar con SOL1-)');
    const b = Maestra._deB64u(t.slice(5));
    if (b[0] !== 1 || b.length < 79) throw new Error('La solicitud está incompleta');
    const tipo = b[1] === 2 ? 'dek' : b[1] === 1 ? 'pin' : null;
    if (!tipo) throw new Error('Tipo de solicitud desconocido');
    const nonce = b.slice(2, 14), epub = b.slice(14, 79);
    const huella = await Maestra.huella(epub);

    const o = { t: tipo, n: Maestra._b64u(nonce), ts: Date.now() };
    if (tipo === 'dek') {
      const c3 = b.slice(79);
      if (c3.length < 77 + 16) throw new Error('Esta persona no activó la copia para soporte: sus datos cifrados no se pueden recuperar. Solo con su código de recuperación o un respaldo.');
      const epk = c3.slice(0, 65), iv = c3.slice(65, 77), ct = c3.slice(77);
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', epk, Maestra.CURVA, false, []) }, priv, 256);
      const k = await Maestra._llave(bits, new TextEncoder().encode('tienda-escrow'), 'tienda-maestra-escrow-v1');
      let dek;
      try { dek = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct)); }
      catch (e) { throw new Error('Esa copia no corresponde a tu llave maestra'); }
      o.dek = Maestra._b64u(dek);
    }

    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', epub, Maestra.CURVA, false, []) }, priv, 256);
    const k = await Maestra._llave(bits, nonce, 'tienda-maestra-resp-v1');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: nonce }, k, new TextEncoder().encode(JSON.stringify(o))));
    const out = new Uint8Array(13 + ct.length);
    out[0] = 1; out.set(iv, 1); out.set(ct, 13);
    return { tipo, huella, codigo: 'RES1-' + Maestra._b64u(out) };
  }

  $('b-resp').onclick = async () => {
    $('out').classList.add('hidden');
    if (!priv) return msg('m-resp', 'Primero abre tu llave (paso 1)');
    try {
      const r = await responder($('t-sol').value);
      $('o-huella').textContent = r.huella;
      $('o-tipo').textContent = r.tipo === 'pin' ? 'Esta respuesta le deja poner un PIN nuevo.' : 'Esta respuesta le abre sus datos cifrados.';
      $('t-res').value = r.codigo;
      $('out').classList.remove('hidden');
      msg('m-resp', 'Comprueba la huella con la persona antes de enviarle la respuesta.', true);
    } catch (e) { msg('m-resp', e.message || 'No se pudo generar la respuesta'); }
  };
  $('b-cres').onclick = () => copiar($('t-res').value, 'm-resp');
  $('b-sres').onclick = async () => {
    try { if (navigator.share) await navigator.share({ text: $('t-res').value }); else await copiar($('t-res').value, 'm-resp'); } catch (e) { /* cancelado */ }
  };

  pintar();
})();