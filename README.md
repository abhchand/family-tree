# family-tree

A lightweight, client-side family-tree viewer. Vanilla HTML/CSS/JavaScript — no
build step, no framework. Drop it on any static host (Netlify, GitHub Pages, S3,
your own server) and it works.

The tree reads from a single JSON file at `data/data.json`, lays out the
people on an infinite, pannable, zoomable canvas, and exposes details in a
side panel when a card is clicked.

## Run locally

Because the app uses `fetch()` to load `data/data.json`, most browsers block
it when you open `index.html` directly via `file://`. Use any static server:

```sh
# any of these will work
npx serve .
python3 -m http.server 8080
php -S localhost:8080
```

Then visit `http://localhost:8080`.

## Passphrase

The app is gated by a SHA-256 passphrase stored in `app.js`:

```js
const PASSPHRASE_HASH = '071c00fa66449df33ffca0f3b71da9f9375eaf8feef471f348c9bac19e6f4914';
```

That hash corresponds to the demo passphrase **`family2024`**.

To set your own passphrase, compute its SHA-256 hex and paste it in:

```sh
echo -n "your-new-passphrase" | sha256sum
# or
printf '%s' "your-new-passphrase" | shasum -a 256
```

A successful login stores a 7-day session in `localStorage` so you don't have to
re-enter the passphrase on every reload. The **Lock** button in the toolbar
clears the session.

This is a passphrase *gate*, not real security — the hash is shipped to the
client, so anyone determined enough can dictionary-attack it. Use a passphrase
you'd be OK with a casual snoop guessing, and don't store anything sensitive in
the data file.

## Editing the data

All people and unions live in `data/data.json`. The schema:

### People

```json
"people": {
  "p1": {
    "id": "p1",
    "name": "Rajan Iyer",
    "gender": "male",          // "male" | "female" | "nonbinary"
    "born": "1945-03-12",      // ISO date, or just "1945"
    "died": "2010-11-04",      // optional; presence implies deceased
    "maidenName": "Krishnan",  // optional; shown in panel as "née Krishnan"
    "nickname": "Sury",        // optional; shown in panel in quotes
    "description": "Short bio.",
    "photos": ["rajan.jpg", "rajan-young.jpg"],  // optional; filenames under data/images/
    "parents": [
      { "id": "p7", "type": "biological" }   // type: biological | adoptive | step
    ]
  }
}
```

- The object key (`"p1"`) and `id` must match.
- A person can have 0, 1, or 2 parents. Mixed types are fine.

### Photos

Drop image files into `data/images/` and reference them by filename in the
`photos` array. The app fetches `./data/images/<filename>` for each entry —
landscape or portrait JPEG/PNG/WebP all work.

- The **first** entry is the profile photo, shown on the tree card (cropped
  to a circle) and as the hero image at the top of the side panel.
- Any **additional** entries appear as a thumbnail grid above the Parents
  section in the side panel. Clicking a thumbnail opens the full-size image
  in a new tab.

If `photos` is omitted, empty, or a named file is missing, the silhouette at
`data/no-image.jpg` is used instead. That fallback ships with the app and
can be replaced with your own placeholder by overwriting the file.

### Unions

```json
"unions": [
  {
    "id": "u1",
    "partners": ["p1", "p2"],  // exactly two person IDs
    "married": "1968-05-10",
    "divorced": "1980-03-01",  // optional
    "status": "divorced"       // married | divorced | widowed | partnered
  }
]
```

A single person can be in multiple unions (remarriage). Children are
attached to a union when **both** of the child's parents appear together in
that union's `partners` list.

## Controls

| Action | How |
|---|---|
| Pan | Click and drag the background, or one-finger drag on touch |
| Zoom | Mouse wheel / trackpad pinch / two-finger pinch on touch |
| Fit to screen | **Fit** button in the toolbar |
| Search | Type in the toolbar search box; press Enter to jump to a single match |
| Open details | Click any card |
| Navigate from panel | Click any linked relative name |
| Close details | Click the **×**, or click empty canvas |
| Sign out | **Lock** button |

## Deploy

### Netlify

```sh
# from this directory
netlify deploy --prod --dir=.
```

Or drag-and-drop the folder onto the Netlify dashboard. No build settings
needed — it's a flat static site.

### GitHub Pages

1. Push the repo to GitHub.
2. In repo settings → Pages, set the source to the `main` branch, root.
3. Wait a minute for GitHub to publish, then open
   `https://<user>.github.io/<repo>/`.

### Anywhere else

Upload the files as-is — there is no build step. The only requirement is that
`data/data.json` is reachable at the relative path `./data/data.json` from
`index.html`.

## File layout

```
family-tree/
├── index.html       toolbar, viewport, side panel, login overlay
├── style.css        all styles, theme tokens, responsive rules
├── data.js          fetch + lookup helpers (children, spouses, siblings, parents)
├── layout.js        generation assignment + recursive subtree layout
├── renderer.js      DOM card creation + SVG connector painting
├── app.js           auth, camera (pan/zoom), search, side panel, boot
└── data/
    └── data.json    the family data
```
