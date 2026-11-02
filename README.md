# Technical Whiteboard

An open-source, self-hosted online whiteboard for **1:1 tutoring in math and physics**. Write with a pen tablet, typeset equations, plot functions, use a ruler, protractor and compass, and annotate PDF worksheets together with your student in real time.

See [FEATURES.md](FEATURES.md) for the full feature list and roadmap.

## Features

- **Infinite canvas** with pan and zoom (mouse wheel, trackpad, pinch), multiple pages with thumbnails, and per-page backgrounds: blank, 1 cm squares, dots, lined, mm graph paper
- **Board themes**: whiteboard, dark, and green chalkboard. The default "ink" colour adapts to the theme.
- **Handwriting**: pressure-sensitive smoothed pen (Wacom, Apple Pencil, Surface), highlighter, an eraser for whole objects or areas, and a "pen only" palm-rejection mode that switches on automatically when a pen is detected
- **Shapes**: lines, arrows (one or two heads), rectangles, ellipses and circles, triangles, free polygons, regular n-gons, arcs and sectors, with fill colour and transparency. Hold Shift to snap angles, squares and circles.
- **Math**: LaTeX equations rendered with MathJax, edited in a visual editor (MathLive); text boxes with inline math (`$E = mc^2$`); function graphs with adjustable axes and grid
- **Geometry instruments**: ruler, protractor (with a measuring needle) and 45° / 30°-60° set squares, which you can drag and rotate. Drawing near an edge follows it, showing a length readout. Also a compass and a length/angle measuring tool, with sizes shown in real centimetres.
- **Editing**: select by click, rectangle or lasso; move, resize and rotate; copy, paste and duplicate; lock objects; per-user undo and redo
- **Images and PDFs**: insert images by upload, drag-and-drop or paste. PDF worksheets are imported as pages with a locked background.
- **Export**: the current page as PNG, or all pages as PDF
- **Real-time collaboration** (Yjs CRDT) with live cursors and in-progress strokes. Works offline: changes are cached in the browser and sync on reconnect.
- **Sharing**: an edit link and a view-only link per board. Students join with just a name and need no account. Roles are owner, editor and viewer; viewer access is enforced on the server.
- **Accounts and dashboard**: email and password accounts; create, rename, duplicate and delete boards
- **Privacy**: no telemetry, no external requests (fonts and libraries are bundled), and all data stays on your server. Guest names are never stored on the server.

## Quick start (Docker)

```bash
git clone <this repo> technical-whiteboard
cd technical-whiteboard
docker compose up -d
```

Open http://localhost:3000, create your account, then set `ALLOW_REGISTRATION=false` in `.env` and run `docker compose up -d` again if you don't want anyone else to register.

This uses SQLite and stores uploads on the `whiteboard-data` volume. For PostgreSQL and S3-compatible storage (MinIO):

```bash
cp .env.example .env   # set POSTGRES_PASSWORD and MINIO_PASSWORD
docker compose -f docker-compose.postgres.yml up -d
```

### HTTPS

Run the app behind a reverse proxy such as Caddy, Traefik or nginx, and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`. The proxy must forward WebSocket upgrades for `/api/boards/*/ws`. With Caddy:

```
whiteboard.example.com {
    reverse_proxy localhost:3000
}
```

Browsers only allow clipboard access and pen pressure in secure contexts, so use HTTPS for anything other than localhost.

## Configuration

All settings are environment variables. See [.env.example](.env.example).

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and uploaded files |
| `DATABASE_URL` | (empty) | PostgreSQL connection string; SQLite is used when empty |
| `STORAGE` | `local` | `local` or `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | | S3-compatible storage settings |
| `ALLOW_REGISTRATION` | `true` | Allow new accounts |
| `MAX_UPLOAD_MB` | `25` | Upload size limit |
| `COOKIE_SECURE` | `false` | Secure session cookies (HTTPS) |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers |
| `SESSION_DAYS` | `30` | Login session lifetime |

## Development

Requires Node.js 24 or newer, because the server uses the built-in `node:sqlite`.

```bash
npm install
npm run dev        # server on :3000, client on http://localhost:5173 (proxies /api)
npm test           # server integration tests + client unit tests
npm run typecheck
npm run build && npm start   # production build served on :3000
```

### Project layout

```
server/            Fastify + TypeScript
  src/app.ts       REST API (auth, boards, sharing, uploads) and static client
  src/collab.ts    Yjs WebSocket sync (y-websocket protocol, read-only viewers)
  src/db.ts        SQLite (node:sqlite) / PostgreSQL
  src/storage.ts   Local disk / S3 file storage
client/            React + Vite + TypeScript
  src/board/       Whiteboard engine (no React)
    editor.ts      Camera, input, gestures, selection, clipboard, presence
    tools.ts       Pen, eraser, shapes, compass, measure, select, …
    render.ts      Canvas 2D rendering of all objects and backgrounds
    instruments.ts Ruler, protractor, set squares
    doc.ts         Shared Yjs document model (pages, objects, undo)
  src/ui/          Toolbar, panels and dialogs
```

### Data model

Each board is a Yjs document holding a map of objects (`stroke`, `shape`, `text`, `math`, `graph`, `image`), the page order, per-page settings and the board theme. The server keeps the current state of each board in the `boards.ydoc` column. Presence data (cursors, in-progress strokes, instruments) is shared through Yjs awareness and is never stored.

1 cm on the board is 40 world units. Rulers, graph paper, measurements and imported PDFs all use this scale.

## License

[MIT](LICENSE)
