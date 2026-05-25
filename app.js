/* ============================================================
   app.js — application entry: camera, search, side panel.
   ============================================================ */

(async function main() {
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
    html += `<img class="panel-photo${person.died ? ' deceased-photo' : ''}" alt="" src="${escapeHtml(FamilyData.photoUrl(person))}" data-fallback-src="${escapeHtml(FamilyData.fallbackPhotoUrl())}">`;
    html += `<h2${person.died ? ' class="deceased-name"' : ''}>${escapeHtml(person.name)}</h2>`;

    const aka = [];
    if (person.nickname) aka.push(`&ldquo;${escapeHtml(person.nickname)}&rdquo;`);
    if (person.maidenName) aka.push(`née ${escapeHtml(person.maidenName)}`);
    if (aka.length) html += `<div class="alt-name">${aka.join(' · ')}</div>`;

    html += `<div class="meta">${meta.join(' · ')}</div>`;

    if (person.id !== currentRootId) {
      html += `<p class="center-link-wrap"><a class="center-link" data-center-id="${escapeHtml(person.id)}">Center tree on ${escapeHtml(person.name)} →</a></p>`;
    }

    if (person.description) html += `<p>${escapeHtml(person.description)}</p>`;

    const extras = FamilyData.extraPhotoUrls(person);
    if (extras.length) {
      html += '<h3>Photos</h3><div class="photo-grid">';
      for (const url of extras) {
        const safe = escapeHtml(url);
        html += `<a class="photo-thumb" href="${safe}" target="_blank" rel="noopener noreferrer"><img src="${safe}" alt=""></a>`;
      }
      html += '</div>';
    }

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
    content.querySelectorAll('.center-link').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        centerOnPerson(a.dataset.centerId);
      });
    });
    // Wire the panel photo fallback in case the named file is missing.
    content.querySelectorAll('.panel-photo').forEach((img) => {
      img.addEventListener('error', () => {
        if (!img.dataset.fallback) {
          img.dataset.fallback = '1';
          img.src = img.dataset.fallbackSrc;
        }
      });
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
  const searchResults = document.getElementById('search-results');
  const MAX_SEARCH_RESULTS = 10;

  function hideSearchResults() {
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
  }

  function renderSearchResults(q) {
    if (!q || !q.trim()) {
      hideSearchResults();
      return;
    }
    const lower = q.trim().toLowerCase();
    const matches = FamilyData.allPeople()
      .filter((p) => p.name.toLowerCase().includes(lower))
      .slice(0, MAX_SEARCH_RESULTS);

    searchResults.innerHTML = '';
    searchResults.classList.remove('hidden');

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = 'No results found';
      searchResults.appendChild(empty);
      return;
    }

    for (const person of matches) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'search-result';
      item.dataset.id = person.id;
      item.setAttribute('role', 'option');

      const img = document.createElement('img');
      img.className = 'search-photo';
      img.alt = '';
      img.src = FamilyData.photoUrl(person);
      img.addEventListener('error', () => {
        if (!img.dataset.fallback) {
          img.dataset.fallback = '1';
          img.src = FamilyData.fallbackPhotoUrl();
        }
      });
      item.appendChild(img);

      const text = document.createElement('div');
      text.className = 'search-text';

      const name = document.createElement('div');
      name.className = 'search-name';
      name.textContent = person.name;
      text.appendChild(name);

      const lifespan = FamilyData.lifespan(person);
      if (lifespan) {
        const life = document.createElement('div');
        life.className = 'search-life';
        life.textContent = lifespan;
        text.appendChild(life);
      }

      item.appendChild(text);

      item.addEventListener('click', () => centerOnPerson(person.id));
      searchResults.appendChild(item);
    }
  }

  searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) renderSearchResults(searchInput.value);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      hideSearchResults();
      searchInput.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = searchResults.querySelector('.search-result');
      if (first) first.click();
    }
  });
  // Click outside the search area dismisses the dropdown.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) hideSearchResults();
  });

  // -----------------------------------------------------------
  // Legend toggle
  // -----------------------------------------------------------
  document.getElementById('legend-toggle').addEventListener('click', () => {
    document.getElementById('legend-body').classList.toggle('hidden');
  });

  // -----------------------------------------------------------
  // Root + visibility — pick a focal person and filter the tree to
  // their immediate relations (ancestors, descendants, siblings,
  // spouses, and spouses-of-those). Everyone else collapses into
  // clickable "pills" that re-center the tree when tapped.
  // -----------------------------------------------------------

  let currentRootId = null;

  function getRequestedRootId() {
    return new URLSearchParams(location.search).get('root');
  }

  function centerOnPerson(personId) {
    // Navigate to a clean URL with just ?root=<id>. Full reload keeps the
    // layout pipeline straightforward — no need to recompute live.
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('root', personId);
    location.href = url.toString();
  }

  function computeDisplayedSet(data, rootId) {
    const displayed = new Set();
    if (!data.people[rootId]) return displayed;
    displayed.add(rootId);

    // Ancestors via parent chain.
    (function addAncestors(id, seen = new Set()) {
      if (seen.has(id)) return;
      seen.add(id);
      const p = data.people[id];
      if (!p || !p.parents) return;
      for (const pr of p.parents) {
        if (data.people[pr.id]) {
          displayed.add(pr.id);
          addAncestors(pr.id, seen);
        }
      }
    })(rootId);

    // Descendants via children scan.
    const childrenOf = (id) =>
      Object.values(data.people).filter(
        (p) => (p.parents || []).some((pr) => pr.id === id),
      );
    (function addDescendants(id, seen = new Set()) {
      if (seen.has(id)) return;
      seen.add(id);
      for (const c of childrenOf(id)) {
        displayed.add(c.id);
        addDescendants(c.id, seen);
      }
    })(rootId);

    // Siblings of root (share at least one parent).
    const rootParents = new Set(
      (data.people[rootId].parents || []).map((pr) => pr.id),
    );
    if (rootParents.size > 0) {
      for (const p of Object.values(data.people)) {
        if (p.id === rootId) continue;
        if ((p.parents || []).some((pr) => rootParents.has(pr.id))) {
          displayed.add(p.id);
        }
      }
    }

    // Spouses of anyone already displayed (single pass — does not chain
    // through spouses-of-spouses by design).
    const snapshot = new Set(displayed);
    for (const id of snapshot) {
      for (const u of data.unions) {
        if (!u.partners.includes(id)) continue;
        for (const pid of u.partners) {
          if (pid !== id && data.people[pid]) displayed.add(pid);
        }
      }
    }

    return displayed;
  }

  function computePills(data, displayed) {
    const pills = new Map();
    const allPeople = Object.values(data.people);

    for (const id of displayed) {
      const person = data.people[id];
      if (!person) continue;

      // Hidden siblings: share at least one parent, not displayed, not self.
      let hiddenSiblings = 0;
      const myParents = new Set((person.parents || []).map((pr) => pr.id));
      if (myParents.size > 0) {
        for (const p of allPeople) {
          if (p.id === id) continue;
          if (displayed.has(p.id)) continue;
          if ((p.parents || []).some((pr) => myParents.has(pr.id))) {
            hiddenSiblings++;
          }
        }
      }

      // Hidden children.
      let hiddenChildren = 0;
      for (const p of allPeople) {
        if (displayed.has(p.id)) continue;
        if ((p.parents || []).some((pr) => pr.id === id)) hiddenChildren++;
      }

      // Hidden parents (only count parents present in the dataset).
      const hiddenParents = (person.parents || [])
        .filter((pr) => data.people[pr.id] && !displayed.has(pr.id))
        .length;

      if (hiddenSiblings || hiddenChildren || hiddenParents) {
        pills.set(id, { siblings: hiddenSiblings, children: hiddenChildren, parents: hiddenParents });
      }
    }
    return pills;
  }

  // Pick which side a sibling pill should sit on, then reserve horizontal
  // padding so it doesn't collide with adjacent cards. We pick the side that
  // has no union partner (no "line"). When both sides have partners (2+ unions)
  // we can't avoid a line — default to the right.
  const SIBLING_PILL_PAD = 100; // ~75px pill + 14px gap + small margin

  function siblingPillSideFromPositions(personId, positions, data) {
    const pos = positions[personId];
    if (!pos) return 'right';
    let hasLeft = false, hasRight = false;
    for (const u of data.unions) {
      if (!u.partners.includes(personId)) continue;
      const otherId = u.partners.find((p) => p !== personId);
      if (!positions[otherId]) continue;
      if (positions[otherId].x < pos.x) hasLeft = true;
      else if (positions[otherId].x > pos.x) hasRight = true;
    }
    if (!hasRight) return 'right';
    if (!hasLeft) return 'left';
    return 'right';
  }

  function annotatePillSides(pills, positions, data) {
    for (const [pid, info] of pills) {
      if (!info.siblings) continue;
      info.siblingsSide = siblingPillSideFromPositions(pid, positions, data);
    }
  }

  function pillPaddingMap(pills) {
    const pads = new Map();
    for (const [pid, info] of pills) {
      if (!info.siblings) continue;
      const side = info.siblingsSide || 'right';
      pads.set(pid, side === 'left'
        ? { left: SIBLING_PILL_PAD, right: 0 }
        : { left: 0, right: SIBLING_PILL_PAD });
    }
    return pads;
  }

  function filterData(data, displayed) {
    return {
      people: Object.fromEntries(
        Object.entries(data.people).filter(([id]) => displayed.has(id)),
      ),
      unions: data.unions.filter(
        (u) => u.partners.every((pid) => displayed.has(pid)),
      ),
    };
  }

  // -----------------------------------------------------------
  // Boot
  // -----------------------------------------------------------
  async function startApp() {
    try {
      const data = await FamilyData.load();

      // Resolve root: ?root= overrides, otherwise the first person in JSON.
      const peopleIds = Object.keys(data.people);
      const requested = getRequestedRootId();
      currentRootId =
        (requested && data.people[requested]) ? requested : peopleIds[0];

      const displayed = computeDisplayedSet(data, currentRootId);
      const pills = computePills(data, displayed);
      const visible = filterData(data, displayed);

      // Two-pass layout: the first pass discovers where each card actually
      // lives, so we can pick the empty side for each sibling pill; the second
      // pass re-runs with the resulting padding reserved.
      const probe = FamilyLayout.compute(visible);
      annotatePillSides(pills, probe.positions, visible);
      const pillPads = pillPaddingMap(pills);
      const layout = FamilyLayout.compute(visible, { pillPads });
      const bounds = FamilyRenderer.render(layout, visible, {
        onSelectPerson: focusPerson,
        onCenterPerson: centerOnPerson,
        pills,
        rootId: currentRootId,
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

  await startApp();
})();
