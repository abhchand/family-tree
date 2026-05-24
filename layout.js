/* ============================================================
   layout.js — tree layout algorithm.

   Maps each person to a world-space {x, y} coordinate.

   Algorithm overview
   ------------------
   1. Generation assignment.
      - Anyone with no parents starts at generation 0.
      - A child's generation is max(parent generations) + 1, computed
        via fixpoint iteration so it tolerates the people coming in
        any order in the JSON.
      - Spouses without parents in the dataset (people who "marry in")
        get bumped up to match their partner so couples sit on the
        same row.

   2. Subtree placement (recursive).
      For each generation-0 "spine" person, we recursively place:
        a. The person themselves.
        b. Each of their unions' partners (the partner is marked
           visited so we don't recurse back through them).
        c. The children of each union — each child is laid out as
           a subtree, and the children-block is then centered under
           the midpoint of that union.
      Each call returns {positions, width}. The parent caller stacks
      child subtrees side by side, so widths bubble up naturally.

      Single-union case: parents go side by side (self left, partner
      right) and the children block sits below, centered under the
      pair's midpoint. The total width is max(parentSpan, childWidth).

      Two-union case (e.g., a person remarried with kids from each
      marriage): partner_0 on the left, self in the middle, partner_1
      on the right. Each union's children block is centered under
      its own midpoint, with horizontal offsets sized to fit the
      wider of the two child blocks.

      Three-or-more unions fall back to chaining partners to the right.

   3. Roots are ordered "spine first" — the gen-0 person with the
      most unions (and most descendants) is laid out first so that
      multi-marriage people anchor the layout naturally.
   ============================================================ */

const FamilyLayout = (() => {
  const ROW_H = 180;        // vertical spacing between generations
  const CARD_W = 160;       // card pixel width
  const CARD_H = 80;        // card pixel height
  const H_GAP = 60;         // horizontal gap between adjacent cards
  const SLOT_W = CARD_W + H_GAP; // 220 — width of one "slot" left-to-right

  function computeGenerations(data) {
    const gen = {};
    for (const id of Object.keys(data.people)) {
      const p = data.people[id];
      gen[id] = (p.parents && p.parents.length > 0) ? null : 0;
    }

    // Fixpoint: parents push child down; union partner pushes up to match.
    for (let iter = 0; iter < 200; iter++) {
      let changed = false;
      for (const id of Object.keys(data.people)) {
        const p = data.people[id];
        let target = gen[id];

        if (p.parents && p.parents.length > 0) {
          const known = p.parents
            .map((pr) => gen[pr.id])
            .filter((g) => g !== null && g !== undefined);
          if (known.length > 0) {
            const ng = Math.max(...known) + 1;
            if (target === null || ng > target) target = ng;
          }
        } else if (target === null) {
          target = 0;
        }

        for (const u of data.unions) {
          if (!u.partners.includes(id)) continue;
          const otherId = u.partners.find((o) => o !== id);
          const og = gen[otherId];
          if (og !== null && og !== undefined && og > (target ?? 0)) {
            target = og;
          }
        }

        if (gen[id] !== target) {
          gen[id] = target;
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const id of Object.keys(gen)) if (gen[id] === null) gen[id] = 0;
    return gen;
  }

  function compute(data) {
    const gen = computeGenerations(data);
    const peopleArr = Object.values(data.people);

    const childrenOfUnion = (u) =>
      peopleArr
        .filter((p) => {
          const ids = (p.parents || []).map((pr) => pr.id);
          return u.partners.every((pid) => ids.includes(pid));
        })
        .sort((a, b) => (a.born || '').localeCompare(b.born || ''));

    const personUnions = (id) =>
      data.unions
        .filter((u) => u.partners.includes(id))
        .sort((a, b) => (a.married || '').localeCompare(b.married || ''));

    const otherPartner = (u, id) => u.partners.find((p) => p !== id);

    // Count descendants for spine ordering (gen-0 with most descendants comes first).
    function countDesc(id, seen = new Set()) {
      if (seen.has(id)) return 0;
      seen.add(id);
      let n = 0;
      for (const u of personUnions(id)) {
        for (const c of childrenOfUnion(u)) {
          n += 1 + countDesc(c.id, seen);
        }
      }
      return n;
    }

    const visited = new Set();

    function layoutSubtree(personId) {
      if (visited.has(personId)) return null;
      visited.add(personId);
      const ySelf = gen[personId] * ROW_H;

      const unionsList = personUnions(personId).filter((u) => {
        const o = otherPartner(u, personId);
        return o && !visited.has(o);
      });

      if (unionsList.length === 0) {
        return {
          positions: { [personId]: { x: 0, y: ySelf } },
          width: CARD_W,
        };
      }

      const partners = unionsList.map((u) => otherPartner(u, personId));
      for (const pid of partners) visited.add(pid);

      // Lay out a child-block per union by concatenating each child's subtree left to right.
      const blocks = unionsList.map((u) => {
        const children = childrenOfUnion(u);
        const positions = {};
        let cx = 0;
        for (const c of children) {
          const sub = layoutSubtree(c.id);
          if (!sub) continue;
          for (const [id, p] of Object.entries(sub.positions)) {
            positions[id] = { x: p.x + cx, y: p.y };
          }
          cx += sub.width + H_GAP;
        }
        const blockWidth = children.length ? cx - H_GAP : 0;
        return { positions, blockWidth };
      });

      const positions = {};
      const n = unionsList.length;

      // ---------------- single union ----------------
      if (n === 1) {
        const W = blocks[0].blockWidth;
        const parentSpan = SLOT_W + CARD_W; // 2 cards + 1 gap = 380
        const totalWidth = Math.max(parentSpan, W);
        const pairLeft = (totalWidth - parentSpan) / 2;
        const selfX = pairLeft;
        const partnerX = pairLeft + SLOT_W;
        positions[personId] = { x: selfX, y: ySelf };
        positions[partners[0]] = { x: partnerX, y: ySelf };
        const childOffsetX = (totalWidth - W) / 2;
        for (const [id, p] of Object.entries(blocks[0].positions)) {
          positions[id] = { x: p.x + childOffsetX, y: p.y };
        }
        return { positions, width: totalWidth };
      }

      // ---------------- two unions ----------------
      if (n === 2) {
        const W0 = blocks[0].blockWidth;
        const W1 = blocks[1].blockWidth;
        // Each side's offset from self has to be wide enough to fit its child block.
        const off0 = Math.max(SLOT_W, W0 + H_GAP);
        const off1 = Math.max(SLOT_W, W1 + H_GAP);
        const partner0X = 0;
        const selfX = off0;
        const partner1X = off0 + off1;
        positions[personId] = { x: selfX, y: ySelf };
        positions[partners[0]] = { x: partner0X, y: ySelf };
        positions[partners[1]] = { x: partner1X, y: ySelf };

        const um0 = (partner0X + CARD_W / 2 + selfX + CARD_W / 2) / 2;
        const child0Off = um0 - W0 / 2;
        for (const [id, p] of Object.entries(blocks[0].positions)) {
          positions[id] = { x: p.x + child0Off, y: p.y };
        }

        const um1 = (selfX + CARD_W / 2 + partner1X + CARD_W / 2) / 2;
        const child1Off = um1 - W1 / 2;
        for (const [id, p] of Object.entries(blocks[1].positions)) {
          positions[id] = { x: p.x + child1Off, y: p.y };
        }
        return { positions, width: partner1X + CARD_W };
      }

      // ---------------- 3+ unions: chain to the right ----------------
      let curX = 0;
      const selfX = 0;
      positions[personId] = { x: selfX, y: ySelf };
      for (let i = 0; i < n; i++) {
        const Wi = blocks[i].blockWidth;
        const offI = Math.max(SLOT_W, Wi + H_GAP);
        curX += offI;
        positions[partners[i]] = { x: curX, y: ySelf };
        const umI = (selfX + CARD_W / 2 + curX + CARD_W / 2) / 2;
        const childOffI = umI - Wi / 2;
        for (const [id, p] of Object.entries(blocks[i].positions)) {
          positions[id] = { x: p.x + childOffI, y: p.y };
        }
      }
      return { positions, width: curX + CARD_W };
    }

    // Roots: gen-0 people sorted spine-first (most unions, then most descendants).
    const gen0Roots = peopleArr
      .filter((p) => gen[p.id] === 0)
      .sort((a, b) => {
        const ua = personUnions(a.id).length;
        const ub = personUnions(b.id).length;
        if (ub !== ua) return ub - ua;
        return countDesc(b.id) - countDesc(a.id);
      });

    const allPositions = {};
    let xCursor = 0;
    const place = (rootId) => {
      const sub = layoutSubtree(rootId);
      if (!sub) return;
      for (const [id, p] of Object.entries(sub.positions)) {
        allPositions[id] = { x: p.x + xCursor, y: p.y };
      }
      xCursor += sub.width + H_GAP * 3;
    };

    for (const p of gen0Roots) {
      if (!visited.has(p.id)) place(p.id);
    }
    // Stragglers: anyone left over (e.g., person with parents outside the dataset
    // who never got pulled in by a union).
    for (const p of peopleArr) {
      if (!visited.has(p.id)) place(p.id);
    }

    return {
      positions: allPositions,
      generations: gen,
      constants: { ROW_H, CARD_W, CARD_H, H_GAP, SLOT_W },
    };
  }

  return { compute };
})();
