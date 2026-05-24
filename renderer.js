/* ============================================================
   renderer.js — paints cards and SVG connectors into the world.

   Cards are absolutely-positioned DOM elements (so HTML semantics
   and CSS hover/tooltip work naturally). Lines between people are
   drawn into an SVG layer that sits behind the cards in the same
   transformed `world` coordinate system, so panning and zooming
   transform both layers together.

   Layout positions are translated so the bounding box of all
   cards starts at (0, 0). The returned `bounds` is used by app.js
   to fit-to-screen and pan to a specific person.
   ============================================================ */

const FamilyRenderer = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs = {}, classes = '') {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (classes) el.setAttribute('class', classes);
    return el;
  }

  function render(layout, data, callbacks) {
    const { positions, constants } = layout;
    const { CARD_W, CARD_H } = constants;

    const cardsContainer = document.getElementById('cards');
    const svg = document.getElementById('connectors');

    cardsContainer.innerHTML = '';
    svg.innerHTML = '';

    // Bounding box of all card rectangles, plus a margin so connectors
    // that overshoot slightly don't get clipped.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of Object.values(positions)) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + CARD_W > maxX) maxX = p.x + CARD_W;
      if (p.y + CARD_H > maxY) maxY = p.y + CARD_H;
    }
    const PAD = 80;
    minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
    const worldW = maxX - minX;
    const worldH = maxY - minY;

    // Shift every position so the world starts at (0,0).
    const offX = -minX;
    const offY = -minY;
    const cardLeft = (id) => positions[id].x + offX;
    const cardTop = (id) => positions[id].y + offY;
    const cardCX = (id) => positions[id].x + offX + CARD_W / 2;
    const cardCY = (id) => positions[id].y + offY + CARD_H / 2;

    // ---- Cards ----
    for (const person of Object.values(data.people)) {
      if (!positions[person.id]) continue;
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.personId = person.id;
      card.dataset.gender = person.gender || '';
      if (person.died) card.classList.add('deceased');
      card.style.left = cardLeft(person.id) + 'px';
      card.style.top = cardTop(person.id) + 'px';

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = person.name;
      card.appendChild(name);

      const life = document.createElement('div');
      life.className = 'card-life';
      life.textContent = FamilyData.lifespan(person);
      card.appendChild(life);

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onSelectPerson(person.id);
      });

      cardsContainer.appendChild(card);
    }

    // ---- SVG sizing ----
    svg.setAttribute('width', worldW);
    svg.setAttribute('height', worldH);
    svg.style.width = worldW + 'px';
    svg.style.height = worldH + 'px';

    // ---- Union and parent-child connectors ----
    // We index children by union (matching both partners). Anyone left over
    // (one parent in the tree but no union with the other) gets a direct line.
    const handledChildren = new Set();

    for (const union of data.unions) {
      const [aId, bId] = union.partners;
      if (!positions[aId] || !positions[bId]) continue;

      // Marriage line: from the inner edge of the left card to the inner edge of the right card.
      const left = cardLeft(aId) <= cardLeft(bId) ? aId : bId;
      const right = left === aId ? bId : aId;
      const lineY = cardCY(left); // both partners on the same generation row
      const lineX1 = cardLeft(left) + CARD_W;
      const lineX2 = cardLeft(right);

      svg.appendChild(svgEl('line', {
        x1: lineX1, y1: lineY, x2: lineX2, y2: lineY,
      }, `union-line ${union.status || 'married'}`));

      const midX = (lineX1 + lineX2) / 2;
      svg.appendChild(svgEl('circle', { cx: midX, cy: lineY, r: 3 }, 'union-dot'));

      // Children belonging to this exact union (both partners are parents).
      const children = Object.values(data.people).filter((c) => {
        const ids = (c.parents || []).map((pr) => pr.id);
        return union.partners.every((pid) => ids.includes(pid));
      });
      if (children.length === 0) continue;

      // Crossbar y: halfway between parent row bottom and child row top.
      const parentRowBottom = cardTop(left) + CARD_H;
      const childRowTop = cardTop(children[0].id);
      const crossY = (parentRowBottom + childRowTop) / 2;

      // Drop from union midpoint down to crossbar.
      svg.appendChild(svgEl('line', {
        x1: midX, y1: lineY, x2: midX, y2: crossY,
      }, 'parent-line biological'));

      // Crossbar across all children + the drop x.
      const xs = children.map((c) => cardCX(c.id));
      xs.push(midX);
      const cbX1 = Math.min(...xs);
      const cbX2 = Math.max(...xs);
      svg.appendChild(svgEl('line', {
        x1: cbX1, y1: crossY, x2: cbX2, y2: crossY,
      }, 'parent-line biological'));

      // Drop from crossbar to each child's top edge.
      for (const child of children) {
        const cx = cardCX(child.id);
        const cyTop = cardTop(child.id);
        // Connection type: if both refs agree, use that; otherwise note as mixed (still uses biological style if either is biological).
        const refA = child.parents.find((pr) => pr.id === aId);
        const refB = child.parents.find((pr) => pr.id === bId);
        let type = 'biological';
        if (refA && refB) {
          if (refA.type === refB.type) type = refA.type;
          else type = (refA.type === 'biological' || refB.type === 'biological') ? 'biological' : refA.type;
        }
        svg.appendChild(svgEl('line', {
          x1: cx, y1: crossY, x2: cx, y2: cyTop,
        }, `parent-line ${type}`));
        handledChildren.add(child.id);
      }
    }

    // Any children whose parent-pair didn't form a recorded union: draw a direct line per parent.
    for (const person of Object.values(data.people)) {
      if (handledChildren.has(person.id)) continue;
      if (!person.parents || person.parents.length === 0) continue;
      if (!positions[person.id]) continue;
      for (const ref of person.parents) {
        const parent = data.people[ref.id];
        if (!parent || !positions[ref.id]) continue;
        const px = cardCX(ref.id);
        const py = cardTop(ref.id) + CARD_H;
        const cx = cardCX(person.id);
        const cyTop = cardTop(person.id);
        const midY = (py + cyTop) / 2;
        // Elbow: down, across, down.
        const path = svgEl('path', {
          d: `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cyTop}`,
        }, `parent-line ${ref.type || 'biological'}`);
        svg.appendChild(path);
      }
    }

    return { worldW, worldH, offX, offY };
  }

  return { render };
})();
