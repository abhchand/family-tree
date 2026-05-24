/* ============================================================
   app.js — application entry: auth, camera, search, side panel.

   Passphrase: the default demo passphrase is "family2024".
   Its SHA-256 (lowercase hex) is stored in PASSPHRASE_HASH below.
   To set your own, run in a terminal:

     echo -n "your-new-passphrase" | sha256sum

   and paste the resulting hex into PASSPHRASE_HASH.
   ============================================================ */

(async function main() {
  // Precomputed hash of "family2024" — replace this constant to change the passphrase.
  const PASSPHRASE_HASH =
    '071c00fa66449df33ffca0f3b71da9f9375eaf8feef471f348c9bac19e6f4914';

  const SESSION_KEY = 'family-tree.session';
  const SESSION_DAYS = 7;

  // -----------------------------------------------------------
  // Auth
  // -----------------------------------------------------------
  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function checkSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s.expiresAt || Date.now() > s.expiresAt) {
        localStorage.removeItem(SESSION_KEY);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function createSession() {
    const token =
      (crypto.randomUUID && crypto.randomUUID()) ||
      Math.random().toString(36).slice(2);
    const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  function showLogin() {
    const o = document.getElementById('login-overlay');
    o.classList.remove('hidden');
    o.setAttribute('aria-hidden', 'false');
    setTimeout(
      () => document.getElementById('passphrase-input').focus(),
      50,
    );
  }

  function hideLogin() {
    const o = document.getElementById('login-overlay');
    o.classList.add('hidden');
    o.setAttribute('aria-hidden', 'true');
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('passphrase-input');
    const errEl = document.getElementById('login-error');
    const hash = await sha256Hex(input.value);
    if (hash === PASSPHRASE_HASH) {
      errEl.textContent = '';
      createSession();
      hideLogin();
      await startApp();
    } else {
      errEl.textContent = 'Incorrect passphrase';
      input.select();
    }
  });

  document.getElementById('lock-btn').addEventListener('click', clearSession);

  // -----------------------------------------------------------
  // Camera (pan + zoom) — applied as a CSS transform on #world.
  //
  // World point W maps to viewport point V by:
  //   V = W * zoom + camera_translate
  // So to zoom toward a viewport point (cx, cy), keep the world point
  // under (cx, cy) fixed by adjusting the translate after we change the
  // scale. That's the worldX/worldY math below.
  // -----------------------------------------------------------
  const viewport = document.getElementById('viewport');
  const world = document.getElementById('world');

  const camera = { x: 0, y: 0, zoom: 1 };
  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 2.5;

  function applyCamera() {
    world.style.transform =
      `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  }

  function setZoomAt(newZoom, cx, cy) {
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    const worldX = (cx - camera.x) / camera.zoom;
    const worldY = (cy - camera.y) / camera.zoom;
    camera.zoom = newZoom;
    camera.x = cx - worldX * newZoom;
    camera.y = cy - worldY * newZoom;
    applyCamera();
  }

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoomAt(camera.zoom * factor, cx, cy);
    },
    { passive: false },
  );

  // Pointer-based pan and pinch-zoom (works for mouse, pen, and touch).
  const pointers = new Map();
  let panning = false;
  let panStart = null;
  let pinchStart = null;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.card')) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      panning = true;
      viewport.classList.add('panning');
      panStart = { mx: e.clientX, my: e.clientY, cx: camera.x, cy: camera.y };
    } else if (pointers.size === 2) {
      panning = false;
      const [p1, p2] = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        zoom: camera.zoom,
        centerX: (p1.x + p2.x) / 2,
        centerY: (p1.y + p2.y) / 2,
      };
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStart) {
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const rect = viewport.getBoundingClientRect();
      setZoomAt(
        pinchStart.zoom * (dist / pinchStart.dist),
        pinchStart.centerX - rect.left,
        pinchStart.centerY - rect.top,
      );
    } else if (panning) {
      camera.x = panStart.cx + (e.clientX - panStart.mx);
      camera.y = panStart.cy + (e.clientY - panStart.my);
      applyCamera();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      panning = false;
      viewport.classList.remove('panning');
    }
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  // Clicking empty canvas closes the side panel.
  viewport.addEventListener('click', (e) => {
    if (!e.target.closest('.card')) closeSidePanel();
  });

  // -----------------------------------------------------------
  // Fit to screen + pan to a specific person.
  // -----------------------------------------------------------
  let layoutData = null;

  function fitToScreen() {
    if (!layoutData) return;
    const vp = viewport.getBoundingClientRect();
    const { worldW, worldH } = layoutData.bounds;
    const margin = 40;
    const zoomX = (vp.width - margin * 2) / worldW;
    const zoomY = (vp.height - margin * 2) / worldH;
    const zoom = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.min(zoomX, zoomY, 1.5)),
    );
    camera.zoom = zoom;
    camera.x = (vp.width - worldW * zoom) / 2;
    camera.y = (vp.height - worldH * zoom) / 2;
    applyCamera();
  }

  document.getElementById('fit-btn').addEventListener('click', fitToScreen);
  window.addEventListener('resize', () => {
    if (layoutData) applyCamera();
  });

  function panToPerson(personId) {
    if (!layoutData) return;
    const pos = layoutData.layout.positions[personId];
    if (!pos) return;
    const { CARD_W, CARD_H } = layoutData.layout.constants;
    const { offX, offY } = layoutData.bounds;
    const vp = viewport.getBoundingClientRect();
    const wx = pos.x + offX + CARD_W / 2;
    const wy = pos.y + offY + CARD_H / 2;
    camera.x = vp.width / 2 - wx * camera.zoom;
    // Bias slightly upward so the card isn't hidden behind the side panel.
    camera.y = vp.height / 2 - wy * camera.zoom;
    applyCamera();
  }

  // -----------------------------------------------------------
  // Side panel
  // -----------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function cap(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  function openSidePanel(personId) {
    const person = FamilyData.getPerson(personId);
    if (!person) return;

    const parents = FamilyData.getParents(personId);
    const siblings = FamilyData.getSiblings(personId);
    const spouses = FamilyData.getSpouses(personId);
    const children = FamilyData.getChildren(personId);

    const meta = [];
    if (person.gender) meta.push(cap(person.gender));
    if (person.born) meta.push('b. ' + FamilyData.formatDate(person.born));
    if (person.died) meta.push('d. ' + FamilyData.formatDate(person.died));

    let html = '';
    html += `<h2>${escapeHtml(person.name)}${person.died ? ' <span class="dagger">†</span>' : ''}</h2>`;
    html += `<div class="meta">${meta.join(' · ')}</div>`;
    if (person.description) html += `<p>${escapeHtml(person.description)}</p>`;

    const list = (title, items, fmt) => {
      if (!items.length) return '';
      let out = `<h3>${title}</h3><ul>`;
      for (const item of items) out += fmt(item);
      out += '</ul>';
      return out;
    };

    html += list('Parents', parents, ({ person: p, type }) =>
      `<li><a class="person-link" data-id="${p.id}">${escapeHtml(p.name)}</a>` +
      (type && type !== 'biological' ? `<span class="relation-type">${type}</span>` : '') +
      `</li>`,
    );

    html += list('Spouse(s)', spouses, ({ person: p, union }) => {
      const bits = [];
      if (union.status) bits.push(union.status);
      if (union.married) bits.push('m. ' + FamilyData.formatDate(union.married, 'year'));
      if (union.divorced) bits.push('div. ' + FamilyData.formatDate(union.divorced, 'year'));
      return `<li><a class="person-link" data-id="${p.id}">${escapeHtml(p.name)}</a>` +
        (bits.length ? `<span class="relation-type">${bits.join(' · ')}</span>` : '') +
        `</li>`;
    });

    html += list('Children', children, ({ person: p, type }) =>
      `<li><a class="person-link" data-id="${p.id}">${escapeHtml(p.name)}</a>` +
      (type && type !== 'biological' ? `<span class="relation-type">${type}</span>` : '') +
      `</li>`,
    );

    html += list('Siblings', siblings, (sib) =>
      `<li><a class="person-link" data-id="${sib.id}">${escapeHtml(sib.name)}</a></li>`,
    );

    const content = document.getElementById('panel-content');
    content.innerHTML = html;
    content.querySelectorAll('.person-link').forEach((a) => {
      a.addEventListener('click', () => focusPerson(a.dataset.id));
    });

    const panel = document.getElementById('side-panel');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');

    document.querySelectorAll('.card.focused').forEach((c) =>
      c.classList.remove('focused'),
    );
    const card = document.querySelector(
      `.card[data-person-id="${personId}"]`,
    );
    if (card) card.classList.add('focused');
  }

  function closeSidePanel() {
    const panel = document.getElementById('side-panel');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.card.focused').forEach((c) =>
      c.classList.remove('focused'),
    );
  }

  function focusPerson(id) {
    openSidePanel(id);
    panToPerson(id);
  }

  document
    .getElementById('panel-close')
    .addEventListener('click', closeSidePanel);

  // -----------------------------------------------------------
  // Search / highlight
  // -----------------------------------------------------------
  const searchInput = document.getElementById('search-input');

  function applySearch(q) {
    const cards = document.querySelectorAll('.card');
    if (!q || !q.trim()) {
      cards.forEach((c) => c.classList.remove('match', 'dim'));
      return [];
    }
    const lower = q.trim().toLowerCase();
    const matches = [];
    cards.forEach((card) => {
      const id = card.dataset.personId;
      const person = FamilyData.getPerson(id);
      const isMatch = !!(person && person.name.toLowerCase().includes(lower));
      card.classList.toggle('match', isMatch);
      card.classList.toggle('dim', !isMatch);
      if (isMatch) matches.push(id);
    });
    return matches;
  }

  searchInput.addEventListener('input', () => applySearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const m = applySearch(searchInput.value);
      if (m.length === 1) focusPerson(m[0]);
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      applySearch('');
    }
  });

  // -----------------------------------------------------------
  // Legend toggle
  // -----------------------------------------------------------
  document.getElementById('legend-toggle').addEventListener('click', () => {
    document.getElementById('legend-body').classList.toggle('hidden');
  });

  // -----------------------------------------------------------
  // Boot
  // -----------------------------------------------------------
  async function startApp() {
    try {
      const data = await FamilyData.load();
      const layout = FamilyLayout.compute(data);
      const bounds = FamilyRenderer.render(layout, data, {
        onSelectPerson: focusPerson,
      });
      layoutData = { layout, bounds };
      fitToScreen();
    } catch (err) {
      console.error('Failed to start app:', err);
      const cards = document.getElementById('cards');
      cards.innerHTML =
        `<div style="padding:24px;color:#a33">Could not load family data: ${escapeHtml(err.message || String(err))}<br>If you opened this file directly, run a local server (e.g. <code>npx serve .</code>) — most browsers block <code>fetch()</code> on <code>file://</code> URLs.</div>`;
    }
  }

  if (checkSession()) {
    hideLogin();
    await startApp();
  } else {
    showLogin();
  }
})();
