/* ============================================================
   data.js — JSON loader and lookup helpers.

   All functions here operate on the parsed `data.json` object,
   which has the shape: { people: { id -> person }, unions: [...] }.
   They are intentionally pure (no DOM access).
   ============================================================ */

const FamilyData = (() => {
  let _data = null;

  async function load(path = './data/data.json') {
    // Cache-bust so edits to data.json show up on the next page load.
    const url = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    _data = await res.json();
    _data.people = _data.people || {};
    _data.unions = _data.unions || [];
    return _data;
  }

  function get() {
    if (!_data) throw new Error('FamilyData not loaded yet');
    return _data;
  }

  function getPerson(id) {
    return get().people[id] || null;
  }

  function allPeople() {
    return Object.values(get().people);
  }

  function allUnions() {
    return get().unions;
  }

  // Resolve parent objects with `{ person, type }`. Missing parent IDs are skipped.
  function getParents(personId) {
    const p = getPerson(personId);
    if (!p || !p.parents) return [];
    return p.parents
      .map((ref) => {
        const person = getPerson(ref.id);
        return person ? { person, type: ref.type } : null;
      })
      .filter(Boolean);
  }

  // Scan all people whose `parents` array includes this ID. Returns `{ person, type }`.
  function getChildren(personId) {
    const out = [];
    for (const person of allPeople()) {
      const ref = (person.parents || []).find((r) => r.id === personId);
      if (ref) out.push({ person, type: ref.type });
    }
    return out;
  }

  // All unions that include this person.
  function getUnionsFor(personId) {
    return allUnions().filter((u) => u.partners.includes(personId));
  }

  // Spouse/partner person objects (other side of every union containing this person).
  function getSpouses(personId) {
    return getUnionsFor(personId).map((u) => {
      const otherId = u.partners.find((id) => id !== personId);
      return { person: getPerson(otherId), union: u };
    }).filter((s) => s.person);
  }

  // Siblings: people who share at least one parent. Excludes self.
  function getSiblings(personId) {
    const me = getPerson(personId);
    if (!me) return [];
    const myParentIds = new Set((me.parents || []).map((p) => p.id));
    if (myParentIds.size === 0) return [];
    const out = [];
    for (const person of allPeople()) {
      if (person.id === personId) continue;
      const shared = (person.parents || []).some((p) => myParentIds.has(p.id));
      if (shared) out.push(person);
    }
    return out;
  }

  // Find the union (if any) whose partner set equals the given pair (order-independent).
  function findUnionByPartners(idA, idB) {
    return allUnions().find(
      (u) =>
        u.partners.length === 2 &&
        u.partners.includes(idA) &&
        u.partners.includes(idB),
    ) || null;
  }

  // Format a date string from the JSON. Accepts `YYYY-MM-DD` or `YYYY` (partial).
  // `style` is "long" (Month DD, YYYY) or "year" (just the year).
  function formatDate(str, style = 'long') {
    if (!str) return '';
    if (style === 'year') {
      return str.slice(0, 4);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m, d] = str.split('-').map(Number);
      const months = [
        'January','February','March','April','May','June',
        'July','August','September','October','November','December',
      ];
      return `${months[m - 1]} ${d}, ${y}`;
    }
    // Partial dates fall back to the raw string.
    return str;
  }

  // Lifespan string used on cards.
  function lifespan(person) {
    const b = person.born ? formatDate(person.born, 'year') : null;
    const d = person.died ? formatDate(person.died, 'year') : null;
    if (b && d) return `${b}–${d}`;
    if (b) return `b. ${b}`;
    if (d) return `d. ${d}`;
    return '';
  }

  const FALLBACK_PHOTO = './data/no-image.jpg';
  const PHOTOS_DIR = './data/images/';

  // The first entry in `photos` is the profile photo. The remaining
  // entries show up as a thumbnail grid in the side panel.
  function photoUrl(person) {
    const list = person && person.photos;
    return list && list.length > 0 ? PHOTOS_DIR + list[0] : FALLBACK_PHOTO;
  }

  function extraPhotoUrls(person) {
    const list = person && person.photos;
    if (!list || list.length <= 1) return [];
    return list.slice(1).map((f) => PHOTOS_DIR + f);
  }

  function fallbackPhotoUrl() {
    return FALLBACK_PHOTO;
  }

  return {
    load,
    get,
    getPerson,
    allPeople,
    allUnions,
    getParents,
    getChildren,
    getUnionsFor,
    getSpouses,
    getSiblings,
    findUnionByPartners,
    formatDate,
    lifespan,
    photoUrl,
    extraPhotoUrls,
    fallbackPhotoUrl,
  };
})();
