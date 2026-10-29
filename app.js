'use strict';

/* =========================================================
   AFRO BULK - app.js
   Boutique e-commerce + comptes clients + espace admin
   Couche securite : PBKDF2, sessions, verrouillage, XSS, CSP
   ========================================================= */

/* ---------- Helpers ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('fr-FR') + ' FCFA';
const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
const digits = (s) => String(s || '').replace(/\D/g, '');
const validPhone = (s) => { const d = digits(s); return d.length >= 8 && d.length <= 15; };
const nowISO = () => new Date().toISOString();

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = String(msg || '');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

/* ---------- Images : validation stricte (XSS / URL dangereuses) ---------- */
function normalizeImage(src) {
  const s = String(src || '').trim();
  if (!s) return null;
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^[a-z0-9_-]+\.(png|jpe?g|webp|gif|avif)$/i.test(s)) return s;
  return null;
}
function safeImage(src) { return normalizeImage(src) || 'bulk.jpg'; }

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('Aucun fichier sélectionné.')); return; }
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type)) { reject(new Error('Format non pris en charge (JPG, PNG, WEBP, GIF, AVIF).')); return; }
    if (file.size > 1.5 * 1024 * 1024) { reject(new Error('Image trop lourde (1,5 Mo max).')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}

/* ---------- Cryptographie : PBKDF2-SHA256 ---------- */
const PBKDF2_ITERATIONS = 120000;

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function derivePassword(password, saltHex) {
  if (!(window.crypto && crypto.subtle)) throw new Error('Crypto indisponible : ouvrez le site en HTTPS ou sur localhost.');
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return { hash: bytesToHex(new Uint8Array(bits)), salt: saltHex || bytesToHex(salt) };
}
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyPassword(password, record) {
  if (!record || !record.hash || !record.salt) return false;
  const derived = await derivePassword(password, record.salt);
  return safeEqualHex(derived.hash, record.hash);
}

/* ---------- Base locale (localStorage) ---------- */
const DB_KEY = 'afro.bulk.db.v1';
const SESSION_KEY = 'afro.bulk.session';
const ADMIN_SESSION_KEY = 'afro.bulk.admin';
const LOCK_KEY = 'afro.bulk.lock';
const CART_KEY = 'afro.bulk.cart';

const STATUS = {
  en_attente: { label: 'En attente', cls: 'pending' },
  confirmee: { label: 'Confirmée', cls: 'confirmed' },
  expediee: { label: 'Expédiée', cls: 'shipped' },
  livree: { label: 'Livrée', cls: 'delivered' },
  annulee: { label: 'Annulée', cls: 'cancelled' }
};

function defaultDB() {
  return {
    version: 1,
    createdAt: nowISO(),
    products: [
      {
        id: 'bulk228',
        name: 'BULK 228',
        tagline: 'Prise de masse & force',
        description: "Le complément naturel des athlètes togolais : un shake protéiné artisanal pour une prise de masse propre, une récupération rapide et une endurance maximale.",
        features: [
          'Protéines végétales pures (soja toasté, arachide)',
          'Dattes, avoine et moringa du Togo',
          'Poids net : 1 kg — environ 30 portions',
          'Sans additif, sans sucre ajouté'
        ],
        price: 5000,
        image: 'bulk.jpg',
        available: true,
        stock: 30
      },
      {
        id: 'afrofit',
        name: 'AFRO FIT',
        tagline: 'Minceur & tonification',
        description: "Le mélange minceur et détox : flocons d'avoine, gingembre, soja et citron séché pour affiner la silhouette et brûler les graisses abdominales.",
        features: [
          'Effet coupe-faim naturel et brûle-graisse',
          '33 portions · 100 % vegan · sans sucre ajouté',
          'Poids net : 1 kg',
          'Fabrication artisanale à Lomé'
        ],
        price: 6000,
        image: 'fit.jpg',
        available: false,
        stock: 0,
        comingSoon: true
      }
    ],
    users: [],
    orders: [],
    settings: {
      admin: null,
      delivery: { lome: 500, interior: 1500, freeFrom: 15000 }
    }
  };
}

let db = null;

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    db = raw ? JSON.parse(raw) : null;
  } catch (e) { db = null; }
  if (!db || !Array.isArray(db.products) || !db.products.length) {
    db = defaultDB();
    saveDB();
  }
  const base = defaultDB();
  if (!db.settings) db.settings = base.settings;
  if (!db.settings.delivery) db.settings.delivery = base.settings.delivery;
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.orders)) db.orders = [];
}

function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    toast('Stockage local saturé — réduisez la taille des photos.');
    return false;
  }
}

/* ---------- Sessions ---------- */
function sessionRead() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.exp || s.exp < Date.now()) { sessionStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch (e) { return null; }
}
function sessionSet(userId) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId, exp: Date.now() + 24 * 3600 * 1000, token: uid() })); } catch (e) {}
}
function sessionClear() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
function currentUser() {
  const s = sessionRead();
  if (!s) return null;
  return db.users.find((u) => u.id === s.userId) || null;
}

function adminSessionRead() {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.exp || s.exp < Date.now()) { sessionStorage.removeItem(ADMIN_SESSION_KEY); return null; }
    return s;
  } catch (e) { return null; }
}
function adminSessionSet() {
  try { sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ exp: Date.now() + 8 * 3600 * 1000, token: uid() })); } catch (e) {}
}
function adminSessionClear() { try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch (e) {} }

/* ---------- Anti-bruteforce (5 essais / verrou 5 min) ---------- */
function lockData() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function lockSaved(data) {
  try { localStorage.setItem(LOCK_KEY, JSON.stringify(data)); } catch (e) {}
}
function lockRemaining(key) {
  const rec = lockData()[key];
  return rec && rec.until && rec.until > Date.now() ? Math.ceil((rec.until - Date.now()) / 1000) : 0;
}
function lockRegisterFail(key) {
  const all = lockData();
  const rec = all[key] || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 5) { rec.count = 0; rec.until = Date.now() + 5 * 60 * 1000; }
  all[key] = rec;
  lockSaved(all);
}
function lockClear(key) {
  const all = lockData();
  delete all[key];
  lockSaved(all);
}

/* ---------- Panier ---------- */
let cart = [];
let qtyState = {};
let checkoutProof = null;

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    cart = Array.isArray(raw) ? raw.filter((l) => l && db.products.some((p) => p.id === l.id) && Number(l.qty) > 0) : [];
  } catch (e) { cart = []; }
}
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
}
function cartLines() {
  return cart.map((l) => {
    const p = db.products.find((x) => x.id === l.id);
    return p ? { id: p.id, name: p.name, price: p.price, qty: l.qty, lineTotal: p.price * l.qty } : null;
  }).filter(Boolean);
}
function cartSubtotal() { return cartLines().reduce((s, l) => s + l.lineTotal, 0); }
function deliveryFee(subtotal, zone) {
  const d = db.settings.delivery;
  if (!subtotal) return 0;
  if (subtotal >= d.freeFrom) return 0;
  return zone === 'interior' ? d.interior : d.lome;
}

/* ---------- Rendu boutique ---------- */
function renderProducts() {
  const grid = $('#productGrid');
  if (!grid) return;
  grid.innerHTML = db.products.map((p) => {
    const inStock = p.available && p.stock > 0;
    let badge = '<span class="product-badge badge-out">Rupture</span>';
    if (p.comingSoon) badge = '<span class="product-badge badge-soon">Bientôt disponible</span>';
    else if (inStock) badge = '<span class="product-badge badge-stock">En stock</span>';
    const qty = qtyState[p.id] || 1;
    const waText = encodeURIComponent('Bonjour Afro Bulk, je souhaite commander ' + p.name + ' (' + money(p.price) + ')');
    const cta = inStock ? 'Ajouter au panier' : (p.comingSoon ? 'Bientôt disponible' : 'Indisponible');
    const stockLine = inStock ? 'Stock : ' + p.stock + ' disponible' + (p.stock > 1 ? 's' : '') : (p.comingSoon ? 'Bientôt disponible' : 'Rupture de stock');
    const orderBtn = p.comingSoon ? 'Être prévenu sur WhatsApp' : 'Commander via WhatsApp';
    const actions = p.comingSoon
      ? '<div class="product-actions">' +
          '<button class="btn-add-cart" type="button" disabled>' + cta + '</button>' +
          '<div class="stock-line">' + stockLine + '</div>' +
          '<a class="btn-order-wa" href="https://wa.me/22879413779?text=' + waText + '" target="_blank" rel="noopener noreferrer">' + orderBtn + '</a>' +
        '</div>'
      : '<div class="product-actions">' +
          '<div class="qty-row">' +
            '<button class="qty-btn" type="button" data-qty="-1" data-id="' + esc(p.id) + '"' + (inStock ? '' : ' disabled') + '>−</button>' +
            '<span class="qty-display" data-qty-val="' + esc(p.id) + '">' + qty + '</span>' +
            '<button class="qty-btn" type="button" data-qty="1" data-id="' + esc(p.id) + '"' + (inStock ? '' : ' disabled') + '>+</button>' +
            '<button class="btn-add-cart" type="button" data-add="' + esc(p.id) + '"' + (inStock ? '' : ' disabled') + '>' + cta + '</button>' +
          '</div>' +
          '<div class="stock-line">' + stockLine + '</div>' +
          '<a class="btn-order-wa" href="https://wa.me/22879413779?text=' + waText + '" target="_blank" rel="noopener noreferrer">' + orderBtn + '</a>' +
        '</div>';
    return '<article class="product-card' + (p.id === 'afrofit' ? ' fit' : '') + '" data-id="' + esc(p.id) + '">' +
      badge +
      '<div class="product-image-wrap"><img src="' + esc(safeImage(p.image)) + '" alt="' + esc(p.name) + '" loading="lazy"></div>' +
      '<div class="product-details">' +
        '<h3 class="product-title">' + esc(p.name) + '</h3>' +
        '<div class="product-subtitle">' + esc(p.tagline) + '</div>' +
        '<p class="product-desc">' + esc(p.description) + '</p>' +
        '<ul class="features-list">' + p.features.map((f) => '<li><span class="check"></span><span>' + esc(f) + '</span></li>').join('') + '</ul>' +
        '<div class="price-row"><span class="price-val">' + money(p.price) + '</span><span class="price-unit">/ sachet de 1 kg</span></div>' +
        actions +
      '</div>' +
    '</article>';
  }).join('');
}

function changeQty(id, delta) {
  const p = db.products.find((x) => x.id === id);
  if (!p) return;
  const max = Math.max(1, p.stock || 1);
  qtyState[id] = Math.min(max, Math.max(1, (qtyState[id] || 1) + delta));
  const el = $('[data-qty-val="' + id + '"]');
  if (el) el.textContent = qtyState[id];
}

function addToCart(id) {
  const p = db.products.find((x) => x.id === id);
  if (!p || !p.available || p.stock <= 0) { toast('Produit indisponible.'); return; }
  const qty = Math.max(1, qtyState[id] || 1);
  const line = cart.find((l) => l.id === id);
  const inCart = line ? line.qty : 0;
  if (inCart + qty > p.stock) { toast('Stock insuffisant (max ' + p.stock + ').'); return; }
  if (line) line.qty += qty; else cart.push({ id, qty });
  saveCart();
  renderCart();
  openCart();
  toast(p.name + ' ajouté au panier.');
}

function removeFromCart(id) {
  cart = cart.filter((l) => l.id !== id);
  saveCart();
  renderCart();
}

/* ---------- Rendu panier ---------- */
function renderCart() {
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const countEl = $('#cartCount');
  if (countEl) countEl.textContent = count;

  const itemsEl = $('#cartItems');
  if (itemsEl) {
    itemsEl.innerHTML = lines.length
      ? lines.map((l) => '<div class="cart-item"><div><h4>' + esc(l.name) + '</h4><p>' + l.qty + ' × ' + money(l.price) + ' = ' + money(l.lineTotal) + '</p></div><button class="cart-remove" type="button" data-remove="' + esc(l.id) + '" aria-label="Retirer ' + esc(l.name) + '">&times;</button></div>').join('')
      : '<p class="muted center">Votre panier est vide.</p>';
  }

  renderTotals();
  toggleCheckout();
}

function renderTotals() {
  const el = $('#cartSummary');
  if (!el) return;
  const lines = cartLines();
  const sub = lines.reduce((s, l) => s + l.lineTotal, 0);
  const zone = $('#coZone') ? $('#coZone').value : 'lome';
  const fee = deliveryFee(sub, zone);
  const free = sub >= db.settings.delivery.freeFrom;
  el.innerHTML = '<div class="totals">' +
    '<div class="row"><span>Sous-total</span><span>' + money(sub) + '</span></div>' +
    '<div class="row"><span>Livraison</span><span>' + (free ? 'Offerte' : money(fee)) + '</span></div>' +
    '<div class="row total"><span>Total</span><span>' + money(sub + fee) + '</span></div>' +
  '</div>';
}

function toggleCheckout() {
  const user = currentUser();
  const form = $('#checkoutForm');
  const login = $('#checkoutLogin');
  const success = $('#orderSuccess');
  const hasItems = cartLines().length > 0;
  if (success && hasItems) success.classList.add('hidden');
  if (form) form.classList.toggle('hidden', !user || !hasItems);
  if (login) login.classList.toggle('hidden', !!user || !hasItems);
  if (user) {
    const nameEl = $('#coName');
    const phoneEl = $('#coPhone');
    if (nameEl && !nameEl.value) nameEl.value = user.name;
    if (phoneEl && !phoneEl.value) phoneEl.value = user.phone;
  }
}

function openCart() {
  const d = $('#cartDrawer');
  const b = $('#cartBackdrop');
  if (!d || !b) return;
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  b.classList.add('open');
}
function closeCart() {
  const d = $('#cartDrawer');
  const b = $('#cartBackdrop');
  if (!d || !b) return;
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  b.classList.remove('open');
}

/* ---------- Compte client ---------- */
function renderAccount() {
  const user = currentUser();
  const authPanel = $('#authPanel');
  const profile = $('#profilePanel');
  if (!authPanel || !profile) return;
  if (user) {
    authPanel.classList.add('hidden');
    profile.classList.remove('hidden');
    const nameEl = $('#profileName');
    const phoneEl = $('#profilePhone');
    const avatar = $('#profileAvatar');
    if (nameEl) nameEl.textContent = user.name;
    if (phoneEl) phoneEl.textContent = user.phone;
    if (avatar) avatar.textContent = (user.name || 'A').trim().charAt(0).toUpperCase() || 'A';
    renderMyOrders(user);
  } else {
    authPanel.classList.remove('hidden');
    profile.classList.add('hidden');
  }
}

function waOrderLink(o) {
  const lines = o.items.map((i) => '• ' + i.name + ' × ' + i.qty).join('\n');
  const msg = 'Bonjour Afro Bulk,\nCommande ' + o.number + '\n' + lines +
    '\nTotal : ' + money(o.total) +
    '\nLivraison : ' + o.customer.address +
    '\nPaiement : ' + (o.payment.method === 'mixx' ? 'Mixx by Yas' : 'Flooz') +
    (o.payment.ref ? ' (réf. ' + o.payment.ref + ')' : ' (preuve jointe)');
  return 'https://wa.me/22879413779?text=' + encodeURIComponent(msg);
}

function setOrderStatus(o, status) {
  const wasCancelled = o.status === 'annulee';
  o.status = status;
  if (status === 'annulee' && !wasCancelled) {
    o.items.forEach((it) => {
      const p = db.products.find((x) => x.id === it.id);
      if (!p) return;
      p.stock = Math.min(999, Number(p.stock || 0) + it.qty);
      if (!p.comingSoon) p.available = true;
    });
  }
}

function cancelOrder(orderId) {
  const o = db.orders.find((x) => x.id === orderId);
  if (!o || o.status !== 'en_attente') return;
  if (!window.confirm('Annuler la commande ' + o.number + ' ?')) return;
  setOrderStatus(o, 'annulee');
  saveDB();
  renderAccount();
  renderProducts();
  renderAdminDash();
  toast('Commande annulée. Le stock a été remis.');
}

function customerOrderCard(o) {
  const st = STATUS[o.status] || STATUS.en_attente;
  const items = o.items.map((i) => '<li>' + esc(i.name) + ' × ' + i.qty + ' — ' + money(i.price * i.qty) + '</li>').join('');
  let progress = '';
  if (o.status === 'annulee') {
    progress = '<div class="progress cancelled">Commande annulée</div>';
  } else {
    const steps = ['en_attente', 'confirmee', 'expediee', 'livree'];
    const idx = steps.indexOf(o.status);
    progress = '<div class="progress">' + steps.map((s, i) =>
      '<span class="step' + (i <= idx ? ' done' : '') + '">' + STATUS[s].label + '</span>' +
      (i < steps.length - 1 ? '<span class="arrow">→</span>' : '')
    ).join('') + '</div>';
  }
  return '<article class="order-card">' +
    '<div class="order-head"><div><strong>' + esc(o.number) + '</strong> <span class="date">' + new Date(o.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + '</span></div>' +
    '<span class="status ' + st.cls + '">' + st.label + '</span></div>' +
    '<ul class="order-items">' + items + '</ul>' +
    '<div class="order-customer">Livraison : ' + esc(o.customer.address) + ' · ' + esc(o.payment.method === 'mixx' ? 'Mixx by Yas' : 'Flooz') + '</div>' +
    '<div class="order-foot"><span>' + (o.payment.ref ? 'Réf. ' + esc(o.payment.ref) : 'Preuve jointe') + '</span><strong>' + money(o.total) + '</strong></div>' +
    progress +
    '<div class="order-actions">' +
      (o.status === 'en_attente' ? '<button class="btn-mini danger" type="button" data-cancel-order="' + esc(o.id) + '">Annuler</button>' : '') +
      '<a class="btn-mini wa" href="' + esc(waOrderLink(o)) + '" target="_blank" rel="noopener noreferrer">Récap sur WhatsApp</a>' +
    '</div>' +
  '</article>';
}

function renderMyOrders(user) {
  const list = $('#ordersList');
  if (!list) return;
  const orders = db.orders.filter((o) => o.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  list.innerHTML = orders.length
    ? orders.map(customerOrderCard).join('')
    : '<p class="muted">Aucune commande pour le moment. <a href="#boutique">Découvrir la boutique</a>.</p>';
}

async function onRegister(ev) {
  ev.preventDefault();
  const name = String($('#regName').value || '').trim();
  const phone = String($('#regPhone').value || '').trim();
  const pass = String($('#regPass').value || '');
  const pass2 = String($('#regPass2').value || '');
  if (name.length < 3) { toast('Nom trop court (3 caractères min.).'); return; }
  if (!validPhone(phone)) { toast('Numéro de téléphone invalide.'); return; }
  if (pass.length < 8) { toast('Mot de passe : 8 caractères minimum.'); return; }
  if (pass !== pass2) { toast('Les mots de passe ne correspondent pas.'); return; }
  const norm = digits(phone);
  if (db.users.some((u) => u.phone === norm)) { toast('Ce numéro possède déjà un compte.'); return; }
  try {
    const rec = await derivePassword(pass);
    const user = { id: uid(), name, phone: norm, pass: rec, createdAt: nowISO() };
    db.users.push(user);
    saveDB();
    sessionSet(user.id);
    ev.target.reset();
    renderAccount();
    renderCart();
    toast('Bienvenue ' + name + ' !');
  } catch (err) { toast(err.message || 'Inscription impossible.'); }
}

async function onLogin(ev) {
  ev.preventDefault();
  const remaining = lockRemaining('login');
  if (remaining) { toast('Trop de tentatives. Réessayez dans ' + remaining + ' s.'); return; }
  const phone = digits($('#loginPhone').value);
  const pass = String($('#loginPass').value || '');
  const user = db.users.find((u) => u.phone === phone);
  if (!user) { lockRegisterFail('login'); toast('Numéro ou mot de passe incorrect.'); return; }
  const ok = await verifyPassword(pass, user.pass);
  if (!ok) {
    lockRegisterFail('login');
    const left = lockRemaining('login');
    toast(left ? 'Compte verrouillé ' + left + ' s.' : 'Numéro ou mot de passe incorrect.');
    return;
  }
  lockClear('login');
  sessionSet(user.id);
  ev.target.reset();
  renderAccount();
  renderCart();
  toast('Connexion réussie.');
}

function onLogout() {
  sessionClear();
  renderAccount();
  renderCart();
  toast('Vous êtes déconnecté.');
}

/* ---------- Commande (checkout) ---------- */
async function onCheckout(ev) {
  ev.preventDefault();
  const user = currentUser();
  if (!user) { toast('Connectez-vous pour commander.'); location.hash = '#compte'; return; }
  const lines = cartLines();
  if (!lines.length) { toast('Votre panier est vide.'); return; }
  for (const l of lines) {
    const p = db.products.find((x) => x.id === l.id);
    if (!p || !p.available || p.stock < l.qty) { toast('Stock insuffisant pour ' + l.name + '.'); return; }
  }
  const name = String($('#coName').value || '').trim();
  const phone = String($('#coPhone').value || '').trim();
  const address = String($('#coAddress').value || '').trim();
  const zone = $('#coZone').value === 'interior' ? 'interior' : 'lome';
  const payEl = $('input[name="pay"]:checked');
  const method = payEl && payEl.value === 'mixx' ? 'mixx' : 'flooz';
  const ref = String($('#coRef').value || '').trim();
  if (name.length < 3) { toast('Nom complet requis (3 caractères min.).'); return; }
  if (!validPhone(phone)) { toast('Numéro WhatsApp invalide.'); return; }
  if (address.length < 5) { toast('Adresse de livraison trop courte.'); return; }
  if (!ref && !checkoutProof) { toast('Ajoutez une référence ou une preuve de paiement.'); return; }
  const sub = lines.reduce((s, l) => s + l.lineTotal, 0);
  const fee = deliveryFee(sub, zone);
  const order = {
    id: uid(),
    number: 'AB-' + Date.now().toString(36).toUpperCase().slice(-6),
    userId: user.id,
    customer: { name, phone: digits(phone), address, zone },
    items: lines.map((l) => ({ id: l.id, name: l.name, price: l.price, qty: l.qty })),
    subtotal: sub,
    delivery: fee,
    total: sub + fee,
    payment: { method, ref, proof: checkoutProof },
    status: 'en_attente',
    createdAt: nowISO()
  };
  lines.forEach((l) => {
    const p = db.products.find((x) => x.id === l.id);
    if (p) { p.stock = Math.max(0, p.stock - l.qty); if (p.stock === 0) p.available = false; }
  });
  db.orders.push(order);
  saveDB();
  cart = [];
  qtyState = {};
  checkoutProof = null;
  saveCart();
  if (ev.target && ev.target.reset) ev.target.reset();
  const proofInput = $('#coProof');
  if (proofInput) proofInput.value = '';
  renderProducts();
  renderCart();
  renderAccount();
  renderAdmin();

  const success = $('#orderSuccess');
  if (success) {
    const wa = $('#orderSuccessWa');
    if (wa) wa.href = waOrderLink(order);
    success.classList.remove('hidden');
  }
  const form = $('#checkoutForm');
  if (form) form.classList.add('hidden');
  openCart();
  toast('Commande ' + order.number + ' enregistrée.');
}

/* ---------- Admin : connexion ---------- */
function renderAdmin() {
  const authed = !!adminSessionRead();
  const hasAdmin = !!db.settings.admin;
  const authEl = $('#adminAuth');
  const dashEl = $('#adminDash');
  if (!authEl || !dashEl) return;
  authEl.classList.toggle('hidden', authed);
  dashEl.classList.toggle('hidden', !authed);
  const confirmWrap = $('#adminConfirmWrap');
  if (confirmWrap) confirmWrap.classList.toggle('hidden', authed || hasAdmin);
  const submit = $('#adminSubmit');
  if (submit) submit.textContent = hasAdmin ? 'Entrer' : 'Créer le mot de passe';
  const hint = $('#adminHint');
  if (hint) {
    hint.classList.toggle('hidden', authed);
    hint.textContent = hasAdmin
      ? 'Mot de passe admin requis. Verrouillage temporaire après 5 essais.'
      : 'Première visite : créez le mot de passe admin (8 caractères minimum).';
  }
  if (authed) renderAdminDash();
}

async function onAdminAuth(ev) {
  ev.preventDefault();
  const remaining = lockRemaining('admin');
  if (remaining) { toast('Verrouillé. Réessayez dans ' + remaining + ' s.'); return; }
  const pass = String($('#adminPass').value || '');
  if (!db.settings.admin) {
    const pass2 = String($('#adminPass2').value || '');
    if (pass.length < 8) { toast('8 caractères minimum.'); return; }
    if (pass !== pass2) { toast('Les mots de passe ne correspondent pas.'); return; }
    try {
      db.settings.admin = await derivePassword(pass);
      saveDB();
      adminSessionSet();
      ev.target.reset();
      renderAdmin();
      toast('Mot de passe admin créé.');
    } catch (err) { toast(err.message || 'Création impossible.'); }
    return;
  }
  const ok = await verifyPassword(pass, db.settings.admin);
  if (!ok) {
    lockRegisterFail('admin');
    const left = lockRemaining('admin');
    toast(left ? 'Trop de tentatives. Verrouillé ' + left + ' s.' : 'Mot de passe incorrect.');
    return;
  }
  lockClear('admin');
  adminSessionSet();
  ev.target.reset();
  renderAdmin();
  toast("Bienvenue dans l'espace admin.");
}

function onAdminLogout() {
  adminSessionClear();
  renderAdmin();
  toast('Session admin fermée.');
}

/* ---------- Admin : tableau de bord ---------- */
function setText(sel, text) { const el = $(sel); if (el) el.textContent = text; }

let orderFilterState = 'all';

function renderAdminDash() {
  const orders = db.orders.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const revenue = db.orders.filter((o) => o.status !== 'annulee').reduce((s, o) => s + Number(o.total || 0), 0);
  const pending = db.orders.filter((o) => o.status === 'en_attente').length;
  const stock = db.products.reduce((s, p) => s + (p.available ? Number(p.stock || 0) : 0), 0);
  setText('#statOrders', String(db.orders.length));
  setText('#statRevenue', money(revenue));
  setText('#statPending', String(pending));
  setText('#statStock', String(stock));
  renderSalesChart();
  const list = $('#adminOrders');
  if (list) {
    const filtered = orderFilterState === 'all' ? orders : orders.filter((o) => o.status === orderFilterState);
    list.innerHTML = filtered.length
      ? filtered.map(adminOrderCard).join('')
      : '<p class="muted">Aucune commande pour ce filtre.</p>';
  }
  renderAdminProducts();
  renderFeeSettings();
}

function renderFeeSettings() {
  const d = db.settings.delivery;
  const pairs = [['#feeLome', d.lome], ['#feeInterior', d.interior], ['#feeFree', d.freeFrom]];
  pairs.forEach(([sel, val]) => {
    const el = $(sel);
    if (el && document.activeElement !== el) el.value = String(val);
  });
}

function saveFeeSettings() {
  const read = (sel, fallback) => {
    const el = $(sel);
    const n = parseInt(el && el.value, 10);
    return isNaN(n) ? fallback : Math.max(0, Math.min(1000000, n));
  };
  const d = db.settings.delivery;
  db.settings.delivery = {
    lome: read('#feeLome', d.lome),
    interior: read('#feeInterior', d.interior),
    freeFrom: read('#feeFree', d.freeFrom)
  };
  saveDB();
  updateDeliveryHint();
  renderTotals();
  toast('Frais de livraison enregistrés.');
}

function renderSalesChart() {
  const el = $('#salesChart');
  if (!el) return;
  const days = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i -= 1) days.push(new Date(start.getTime() - i * 86400000));
  const totals = days.map((d) => {
    const next = new Date(d.getTime() + 86400000);
    return db.orders
      .filter((o) => o.status !== 'annulee')
      .filter((o) => { const t = new Date(o.createdAt); return t >= d && t < next; })
      .reduce((s, o) => s + Number(o.total || 0), 0);
  });
  const max = Math.max.apply(null, totals.concat([1]));
  el.innerHTML = days.map((d, i) => {
    const h = Math.max(4, Math.round((totals[i] / max) * 100));
    const label = d.toLocaleDateString('fr-FR', { weekday: 'short' });
    const val = totals[i] ? Math.round(totals[i] / 1000) + 'k' : '';
    return '<div class="bar-wrap"><div class="bar" style="height:' + h + '%"><span class="bar-val">' + val + '</span></div><span class="bar-label">' + esc(label) + '</span></div>';
  }).join('');
}

function adminOrderCard(o) {
  const st = STATUS[o.status] || STATUS.en_attente;
  const items = o.items.map((i) => '<li>' + esc(i.name) + ' × ' + i.qty + ' — ' + money(i.price * i.qty) + '</li>').join('');
  const options = Object.keys(STATUS).map((k) => '<option value="' + k + '"' + (k === o.status ? ' selected' : '') + '>' + STATUS[k].label + '</option>').join('');
  const proof = o.payment.proof
    ? '<button class="btn btn-outline btn-sm" type="button" data-proof="' + esc(o.id) + '">Voir la preuve de paiement</button>'
    : '<span class="small muted">Aucune preuve jointe</span>';
  return '<article class="order-card">' +
    '<div class="order-head">' +
      '<div><strong>' + esc(o.number) + '</strong> <span class="date">' + new Date(o.createdAt).toLocaleString('fr-FR') + '</span></div>' +
      '<select class="status-select" data-order-status="' + esc(o.id) + '" aria-label="Statut de la commande">' + options + '</select>' +
    '</div>' +
    '<div class="order-customer">' + esc(o.customer.name) + ' · ' + esc(o.customer.phone) + ' · ' + esc(o.customer.address) + '</div>' +
    '<ul class="order-items">' + items + '</ul>' +
    '<div class="order-foot"><span>' + (o.payment.method === 'mixx' ? 'Mixx by Yas' : 'Flooz') + (o.payment.ref ? ' · Réf. ' + esc(o.payment.ref) : '') + '</span><strong>' + money(o.total) + '</strong></div>' +
    '<div class="order-actions">' +
      proof +
      '<a class="btn-mini wa" href="' + esc(waOrderLink(o)) + '" target="_blank" rel="noopener noreferrer">Écrire au client</a>' +
    '</div>' +
  '</article>';
}

function renderAdminProducts() {
  const wrap = $('#adminProducts');
  if (!wrap) return;
  wrap.innerHTML = db.products.map((p) => {
    const urlVal = /^data:image\//i.test(String(p.image || '')) ? '' : esc(p.image);
    return '<div class="admin-product" data-pid="' + esc(p.id) + '">' +
      '<div class="admin-product-top"><img class="admin-thumb" src="' + esc(safeImage(p.image)) + '" alt="' + esc(p.name) + '">' +
        '<div><h4>' + esc(p.name) + '</h4><p class="small muted">' + money(p.price) + (p.comingSoon ? ' · bientôt' : '') + '</p></div></div>' +
      '<label>Photo (URL https ou fichier)<input type="text" data-img-url="' + esc(p.id) + '" value="' + urlVal + '" placeholder="https://... ou bulk.jpg" maxlength="500"></label>' +
      '<input type="file" accept="image/*" data-img-file="' + esc(p.id) + '" aria-label="Choisir une photo pour ' + esc(p.name) + '">' +
      '<div class="admin-row">' +
        '<label>Nom<input type="text" data-name="' + esc(p.id) + '" value="' + esc(p.name) + '" maxlength="40"></label>' +
        '<label>Prix (FCFA)<input type="number" min="0" max="1000000" step="500" data-price="' + esc(p.id) + '" value="' + Number(p.price || 0) + '"></label>' +
      '</div>' +
      '<div class="admin-row">' +
        '<label>Stock<input type="number" min="0" max="999" data-stock="' + esc(p.id) + '" value="' + Number(p.stock || 0) + '"></label>' +
        '<label class="checkbox"><input type="checkbox" data-available="' + esc(p.id) + '"' + (p.available ? ' checked' : '') + '> Disponible</label>' +
      '</div>' +
      '<div class="admin-actions">' +
        '<button class="btn btn-primary btn-sm" type="button" data-save-product="' + esc(p.id) + '">Enregistrer</button>' +
        '<button class="btn btn-outline btn-sm" type="button" data-reset-img="' + esc(p.id) + '">Réinitialiser la photo</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function onSaveProduct(id) {
  const p = db.products.find((x) => x.id === id);
  if (!p) return;
  const urlEl = $('[data-img-url="' + id + '"]');
  const fileEl = $('[data-img-file="' + id + '"]');
  const stockEl = $('[data-stock="' + id + '"]');
  const availEl = $('[data-available="' + id + '"]');
  const nameEl = $('[data-name="' + id + '"]');
  const priceEl = $('[data-price="' + id + '"]');
  const newName = String((nameEl && nameEl.value) || '').trim();
  if (newName.length < 2) { toast('Nom du produit trop court.'); return; }
  const newPrice = parseInt(priceEl && priceEl.value, 10);
  if (isNaN(newPrice) || newPrice < 0) { toast('Prix invalide.'); return; }
  try {
    if (fileEl && fileEl.files && fileEl.files[0]) {
      p.image = await readImageFile(fileEl.files[0]);
    } else if (urlEl && String(urlEl.value || '').trim()) {
      const norm = normalizeImage(urlEl.value);
      if (!norm) { toast('Image invalide : URL https ou fichier .jpg/.png uniquement.'); return; }
      p.image = norm;
    }
    const stock = parseInt(stockEl && stockEl.value, 10);
    p.stock = isNaN(stock) ? 0 : Math.max(0, Math.min(999, stock));
    p.available = !!(availEl && availEl.checked);
    p.name = newName;
    p.price = Math.max(0, Math.min(1000000, newPrice));
    saveDB();
    renderProducts();
    renderAdminProducts();
    toast(p.name + ' mis à jour.');
  } catch (err) { toast(err.message || 'Mise à jour impossible.'); }
}

function onResetImage(id) {
  const p = db.products.find((x) => x.id === id);
  if (!p) return;
  p.image = p.id === 'afrofit' ? 'fit.jpg' : 'bulk.jpg';
  saveDB();
  renderProducts();
  renderAdminProducts();
  toast('Photo réinitialisée.');
}

function openProof(orderId) {
  const o = db.orders.find((x) => x.id === orderId);
  if (!o || !o.payment || !o.payment.proof) return;
  const img = $('#proofImage');
  if (img) img.src = o.payment.proof;
  const overlay = $('#proofOverlay');
  if (overlay) overlay.classList.remove('hidden');
}
function closeProof() {
  const overlay = $('#proofOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function openLegal() {
  const overlay = $('#legalOverlay');
  if (overlay) overlay.classList.remove('hidden');
}
function closeLegal() {
  const overlay = $('#legalOverlay');
  if (overlay) overlay.classList.add('hidden');
}

/* ---------- Sauvegarde / restauration ---------- */
function downloadFile(filename, content, type) {
  try {
    const blob = new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) { return false; }
}

function exportCsv() {
  const head = ['Numero', 'Date', 'Client', 'Telephone', 'Adresse', 'Zone', 'Articles', 'Sous-total', 'Livraison', 'Total', 'Paiement', 'Reference', 'Statut'];
  const rows = db.orders.map((o) => [
    o.number,
    new Date(o.createdAt).toLocaleString('fr-FR'),
    o.customer.name,
    o.customer.phone,
    o.customer.address,
    o.customer.zone === 'interior' ? 'Interieur' : 'Lome',
    o.items.map((i) => i.name + ' x' + i.qty).join(' | '),
    o.subtotal,
    o.delivery,
    o.total,
    o.payment.method === 'mixx' ? 'Mixx by Yas' : 'Flooz',
    o.payment.ref || '',
    STATUS[o.status] ? STATUS[o.status].label : o.status
  ]);
  const csv = '\uFEFF' + [head].concat(rows)
    .map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';'))
    .join('\r\n');
  downloadFile('afro-bulk-commandes-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv;charset=utf-8');
  toast('Export CSV généré.');
}

function exportDB() {
  const json = JSON.stringify(db);
  const pretty = JSON.stringify(db, null, 2);
  downloadFile('afro-bulk-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', pretty, 'application/json');
  const ta = $('#backupText');
  if (ta) {
    ta.value = json;
    ta.classList.remove('hidden');
  }
  toast('Sauvegarde exportée.');
}

function importDB(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('Fichier trop volumineux (8 Mo max).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    let data = null;
    try { data = JSON.parse(String(reader.result || '')); } catch (e) { data = null; }
    const ok = data && Array.isArray(data.products) && data.products.length &&
      Array.isArray(data.users) && Array.isArray(data.orders) && data.settings;
    if (!ok) { toast('Fichier de sauvegarde invalide.'); return; }
    if (!window.confirm('Remplacer toutes les données de ce navigateur par cette sauvegarde ?')) return;
    db = data;
    if (!db.settings.delivery) db.settings.delivery = { lome: 500, interior: 1500, freeFrom: 15000 };
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.orders)) db.orders = [];
    saveDB();
    renderProducts();
    renderCart();
    renderAccount();
    renderAdmin();
    renderTotals();
    updateDeliveryHint();
    toast('Sauvegarde restaurée.');
  };
  reader.onerror = () => toast('Lecture du fichier impossible.');
  reader.readAsText(file);
}

/* ---------- Aides d'affichage ---------- */
function updateDeliveryHint() {
  const el = $('#deliveryHint');
  if (!el) return;
  const d = db.settings.delivery;
  el.textContent = 'Une référence ou une capture suffit. Livraison offerte dès ' + money(d.freeFrom) +
    '. Paiement à valider par WhatsApp si besoin.';
}

/* ---------- Application installable (PWA) ---------- */
function registerSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

function setupInstall() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (sessionStorage.getItem('afro.install.dismissed') === '1') return;
    deferred = e;
    showInstallBar(() => {
      if (deferred) { deferred.prompt(); deferred = null; }
    });
  });
  window.addEventListener('appinstalled', () => toast('AFRO BULK installé sur votre écran d’accueil.'));
}

function showInstallBar(onInstall) {
  if (document.getElementById('installBar')) return;
  const bar = document.createElement('div');
  bar.id = 'installBar';
  bar.className = 'install-bar';
  const span = document.createElement('span');
  span.textContent = 'Installer AFRO BULK comme une application ?';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.textContent = 'Installer';
  yes.addEventListener('click', () => { bar.remove(); onInstall(); });
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'ghost';
  no.textContent = 'Plus tard';
  no.addEventListener('click', () => {
    sessionStorage.setItem('afro.install.dismissed', '1');
    bar.remove();
  });
  bar.append(span, yes, no);
  const boutique = document.querySelector('#view-boutique');
  if (boutique) boutique.prepend(bar); else document.body.prepend(bar);
}

/* ---------- Routeur (vues) ---------- */
const VIEWS = ['boutique', 'compte', 'admin'];

function showView(name) {
  closeCart();
  VIEWS.forEach((v) => {
    const el = $('#view-' + v);
    if (el) el.classList.toggle('hidden', v !== name);
  });
  $$('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + name);
  });
  window.scrollTo(0, 0);
  if (name === 'compte') renderAccount();
  if (name === 'admin') renderAdmin();
}

function route() {
  const raw = String(location.hash || '').replace('#', '');
  showView(VIEWS.indexOf(raw) >= 0 ? raw : 'boutique');
}

/* ---------- Evénements ---------- */
function bindEvents() {
  window.addEventListener('hashchange', route);

  const openBtn = $('#openCart');
  if (openBtn) openBtn.addEventListener('click', openCart);
  const closeBtn = $('#closeCart');
  if (closeBtn) closeBtn.addEventListener('click', closeCart);
  const backdrop = $('#cartBackdrop');
  if (backdrop) backdrop.addEventListener('click', closeCart);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeCart(); closeProof(); closeLegal(); }
  });

  $$('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = $('#' + btn.getAttribute('data-scroll'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const grid = $('#productGrid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) { addToCart(add.getAttribute('data-add')); return; }
      const q = e.target.closest('[data-qty]');
      if (q) changeQty(q.getAttribute('data-id'), parseInt(q.getAttribute('data-qty'), 10) || 0);
    });
  }

  const items = $('#cartItems');
  if (items) {
    items.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) removeFromCart(rm.getAttribute('data-remove'));
    });
  }

  const zone = $('#coZone');
  if (zone) zone.addEventListener('change', renderTotals);

  const proofInput = $('#coProof');
  if (proofInput) {
    proofInput.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) { checkoutProof = null; return; }
      try { checkoutProof = await readImageFile(f); toast('Preuve de paiement jointe.'); }
      catch (err) { checkoutProof = null; e.target.value = ''; toast(err.message); }
    });
  }

  const checkout = $('#checkoutForm');
  if (checkout) checkout.addEventListener('submit', onCheckout);

  $$('[data-auth-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const which = tab.getAttribute('data-auth-tab');
      $$('[data-auth-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      const loginForm = $('#loginForm');
      const registerForm = $('#registerForm');
      if (loginForm) loginForm.classList.toggle('hidden', which !== 'login');
      if (registerForm) registerForm.classList.toggle('hidden', which !== 'register');
    });
  });
  const loginForm = $('#loginForm');
  if (loginForm) loginForm.addEventListener('submit', onLogin);
  const registerForm = $('#registerForm');
  if (registerForm) registerForm.addEventListener('submit', onRegister);
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', onLogout);

  const adminForm = $('#adminLoginForm');
  if (adminForm) adminForm.addEventListener('submit', onAdminAuth);
  const adminLogout = $('#adminLogout');
  if (adminLogout) adminLogout.addEventListener('click', onAdminLogout);

  const adminOrders = $('#adminOrders');
  if (adminOrders) {
    adminOrders.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-order-status]');
      if (!sel) return;
      const o = db.orders.find((x) => x.id === sel.getAttribute('data-order-status'));
      if (!o) return;
      setOrderStatus(o, sel.value);
      saveDB();
      renderAdminDash();
      renderProducts();
      toast('Statut mis à jour : ' + (STATUS[o.status] ? STATUS[o.status].label : o.status));
    });
    adminOrders.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-proof]');
      if (btn) openProof(btn.getAttribute('data-proof'));
    });
  }

  const adminProducts = $('#adminProducts');
  if (adminProducts) {
    adminProducts.addEventListener('click', (e) => {
      const save = e.target.closest('[data-save-product]');
      if (save) { onSaveProduct(save.getAttribute('data-save-product')); return; }
      const reset = e.target.closest('[data-reset-img]');
      if (reset) onResetImage(reset.getAttribute('data-reset-img'));
    });
  }

  const saveSettingsBtn = $('#saveSettings');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveFeeSettings);
  const exportBtn = $('#exportDB');
  if (exportBtn) exportBtn.addEventListener('click', exportDB);
  const exportCsvBtn = $('#exportCsv');
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCsv);
  const orderFilter = $('#orderFilter');
  if (orderFilter) {
    orderFilter.addEventListener('change', () => {
      orderFilterState = orderFilter.value;
      renderAdminDash();
    });
  }
  const legalBtn = $('#openLegal');
  if (legalBtn) legalBtn.addEventListener('click', openLegal);
  const closeLegalBtn = $('#closeLegal');
  if (closeLegalBtn) closeLegalBtn.addEventListener('click', closeLegal);
  const legalOverlay = $('#legalOverlay');
  if (legalOverlay) legalOverlay.addEventListener('click', (e) => { if (e.target === legalOverlay) closeLegal(); });
  const importInput = $('#importDB');
  if (importInput) {
    importInput.addEventListener('change', (e) => {
      importDB(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
  }

  const ordersList = $('#ordersList');
  if (ordersList) {
    ordersList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cancel-order]');
      if (btn) cancelOrder(btn.getAttribute('data-cancel-order'));
    });
  }

  const closeProofBtn = $('#closeProof');
  if (closeProofBtn) closeProofBtn.addEventListener('click', closeProof);
  const overlay = $('#proofOverlay');
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeProof(); });
}

/* ---------- Démarrage ---------- */
function init() {
  loadDB();
  loadCart();
  bindEvents();
  renderProducts();
  renderCart();
  route();
  renderAccount();
  updateDeliveryHint();
  registerSW();
  setupInstall();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
