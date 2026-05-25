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
      if (callbacks.rootId && person.id === callbacks.rootId) card.classList.add('root');
      card.style.left = cardLeft(person.id) + 'px';
      card.style.top = cardTop(person.id) + 'px';

      const img = document.createElement('img');
      img.className = 'card-photo';
      img.alt = '';
      img.src = FamilyData.photoUrl(person);
      // If the named photo is missing, swap to the silhouette once.
      img.addEventListener('error', () => {
        if (!img.dataset.fallback) {
          img.dataset.fallback = '1';
          img.src = FamilyData.fallbackPhotoUrl();
        }
      });
      card.appendChild(img);

      const text = document.createElement('div');
      text.className = 'card-text';

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = person.name;
      text.appendChild(name);

      const life = document.createElement('div');
      life.className = 'card-life';
      life.textContent = FamilyData.lifespan(person);
      text.appendChild(life);

      card.appendChild(text);

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

    // PASS 1: draw marriage lines + union dots, collect crossbar info.
    // Crossbars need to be processed together so we can stagger overlapping
    // ones into separate y-channels (otherwise two sibling-groups whose kids
    // sit on the same row produce crossbars at the same y and visually merge).
    const groups = [];
    for (const union of data.unions) {
      const [aId, bId] = union.partners;
      if (!positions[aId] || !positions[bId]) continue;

      const left = cardLeft(aId) <= cardLeft(bId) ? aId : bId;
      const right = left === aId ? bId : aId;
      const lineY = cardCY(left);
      const lineX1 = cardLeft(left) + CARD_W;
      const lineX2 = cardLeft(right);

      svg.appendChild(svgEl('line', {
        x1: lineX1, y1: lineY, x2: lineX2, y2: lineY,
      }, `union-line ${union.status || 'married'}`));

      const midX = (lineX1 + lineX2) / 2;
      svg.appendChild(svgEl('circle', { cx: midX, cy: lineY, r: 3 }, 'union-dot'));

      const children = Object.values(data.people).filter((c) => {
        const ids = (c.parents || []).map((pr) => pr.id);
        return union.partners.every((pid) => ids.includes(pid));
      });
      if (children.length === 0) continue;

      const parentRowBottom = cardTop(left) + CARD_H;
      const childRowTop = cardTop(children[0].id);
      const xs = children.map((c) => cardCX(c.id));
      xs.push(midX);
      const x1 = Math.min(...xs);
      const x2 = Math.max(...xs);

      groups.push({
        aId, bId, lineY, midX, children, x1, x2,
        parentRowBottom, childRowTop,
      });
    }

    // PASS 2: assign each crossbar a y-channel. Groups sharing the same
    // generation gap that horizontally overlap go into different channels;
    // non-overlapping groups all share the centered channel.
    const CHANNEL_SPACING = 18; // px between adjacent channels
    const channelOffset = (c) => {
      if (c === 0) return 0;
      const step = Math.ceil(c / 2);
      const sign = c % 2 === 1 ? -1 : 1; // 1=above, 2=below, 3=further above, ...
      return sign * step * CHANNEL_SPACING;
    };

    const groupsByGap = new Map();
    for (const g of groups) {
      const key = `${g.parentRowBottom}-${g.childRowTop}`;
      if (!groupsByGap.has(key)) groupsByGap.set(key, []);
      groupsByGap.get(key).push(g);
    }
    for (const list of groupsByGap.values()) {
      list.sort((a, b) => a.x1 - b.x1);
      const occupied = []; // occupied[channel] = [[x1, x2], ...]
      for (const g of list) {
        let c = 0;
        while (true) {
          const ranges = occupied[c] || [];
          const collides = ranges.some(([rx1, rx2]) => !(g.x2 < rx1 || g.x1 > rx2));
          if (!collides) {
            (occupied[c] = occupied[c] || []).push([g.x1, g.x2]);
            break;
          }
          c++;
        }
        const center = (g.parentRowBottom + g.childRowTop) / 2;
        g.crossY = center + channelOffset(c);
      }
    }

    // PASS 3: draw the drop, crossbar, and child drops using the channel y.
    for (const g of groups) {
      const { aId, bId, lineY, midX, children, x1, x2, crossY } = g;

      svg.appendChild(svgEl('line', {
        x1: midX, y1: lineY, x2: midX, y2: crossY,
      }, 'parent-line biological'));

      svg.appendChild(svgEl('line', {
        x1, y1: crossY, x2, y2: crossY,
      }, 'parent-line biological'));

      for (const child of children) {
        const cx = cardCX(child.id);
        const cyTop = cardTop(child.id);
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

    // ---- Collapse pills ----
    // For each displayed person with hidden relations, draw a small clickable
    // pill in the appropriate gap. Clicking the pill re-centers the tree on
    // the person it's attached to, which makes their hidden relations visible.
    const pills = callbacks.pills || new Map();
    const PILL_GAP = 14;     // distance from card edge to pill
    const PILL_H = 22;

    for (const [pid, info] of pills) {
      if (!positions[pid]) continue;
      const left = cardLeft(pid);
      const top = cardTop(pid);
      const cx = cardCX(pid);
      const cy = cardCY(pid);

      const makePill = (text, side) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `pill pill-${side}`;
        pill.textContent = text;
        pill.title = `Center tree on this person to show ${text}`;
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          if (callbacks.onCenterPerson) callbacks.onCenterPerson(pid);
        });
        cardsContainer.appendChild(pill);
        return pill;
      };

      if (info.siblings) {
        const text = `${info.siblings} sibling${info.siblings === 1 ? '' : 's'}`;
        const pill = makePill(text, 'siblings');
        // Position pill flush to the right of the card, vertically centered.
        pill.style.left = (left + CARD_W + PILL_GAP) + 'px';
        pill.style.top = (cy - PILL_H / 2) + 'px';
        svg.appendChild(svgEl('line', {
          x1: left + CARD_W, y1: cy, x2: left + CARD_W + PILL_GAP, y2: cy,
        }, 'pill-line'));
      }

      if (info.children) {
        const text = `${info.children} ${info.children === 1 ? 'child' : 'children'}`;
        const pill = makePill(text, 'children');
        pill.style.left = (cx) + 'px';
        pill.style.top = (top + CARD_H + PILL_GAP) + 'px';
        pill.style.transform = 'translateX(-50%)';
        svg.appendChild(svgEl('line', {
          x1: cx, y1: top + CARD_H, x2: cx, y2: top + CARD_H + PILL_GAP,
        }, 'pill-line'));
      }

      if (info.parents) {
        const text = `${info.parents} parent${info.parents === 1 ? '' : 's'}`;
        const pill = makePill(text, 'parents');
        pill.style.left = (cx) + 'px';
        pill.style.top = (top - PILL_GAP - PILL_H) + 'px';
        pill.style.transform = 'translateX(-50%)';
        svg.appendChild(svgEl('line', {
          x1: cx, y1: top, x2: cx, y2: top - PILL_GAP,
        }, 'pill-line'));
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
