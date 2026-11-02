# Technical Whiteboard: Feature List

An open-source, self-hosted online whiteboard for teaching **math and physics**, in the spirit of iDroo.

Priority legend:
- **[MVP]**: needed for the first usable version
- **[v1]**: important, but can come after the MVP
- **[Later]**: nice to have

---

## 1. Canvas & Navigation

- [MVP] Infinite canvas with pan (drag, space+drag, two-finger) and zoom (wheel, pinch)
- [MVP] Multiple pages/boards per session, with a page list or thumbnails
- [MVP] Undo / redo (per user in collaborative mode)
- [MVP] Background options: blank, square grid, dotted, lined, graph paper (mm)
- [MVP] Dark mode / chalkboard theme (green or black board)

## 2. Drawing & Handwriting

- [MVP] Freehand pen with pressure sensitivity (Wacom, XP-Pen, iPad + Apple Pencil, Surface pen)
- [MVP] Stroke smoothing for clean handwriting
- [MVP] Color palette plus a custom color picker; multiple stroke widths
- [MVP] Highlighter (semi-transparent)
- [MVP] Eraser: stroke eraser and pixel/area eraser
- [MVP] Palm rejection / "pen only" mode on touch devices
- [v1] Shape recognition (a rough circle becomes a perfect circle, a wobbly line becomes straight)
- [v1] Dashed and dotted line styles

## 3. Selection & Editing

- [MVP] Select tool (click, lasso, rectangle) for moving, resizing, rotating and deleting objects
- [MVP] Copy / paste / duplicate
- [v1] Group / ungroup objects
- [v1] Align and distribute; bring to front / send to back
- [v1] Snap to grid and to other objects
- [v1] Change the color or width of selected strokes after drawing

## 4. Shapes & Lines

- [MVP] Line, arrow (single and double-headed), rectangle, ellipse/circle, triangle, polygon
- [MVP] Fill color and transparency for shapes
- [MVP] Regular polygons (n-gon)
- [MVP] Arcs and sectors
- [v1] Bezier curves
- [Later] Connectors that stay attached to shapes when the shapes move

## 5. Math Tools

- [MVP] **LaTeX / equation editor** (KaTeX or MathJax rendering) with a visual editor (e.g. MathLive) for users who don't know LaTeX
- [MVP] **Function graphing**: plot `y = f(x)` on a coordinate system on the board, with adjustable axes, range and grid
- [v1] Multiple functions per graph, each with its own color
- [v1] Parametric and polar plots; inequalities and shaded regions
- [v1] Points, tangent lines, intersections and labels on graphs
- [v1] Sliders for parameters (e.g. `y = a·sin(bx)` with live sliders)
- [v1] Coordinate axes object (2D) with ticks and labels
- [Later] 3D graphs and surfaces (rotatable)
- [Later] Built-in calculator / CAS (e.g. Nerdamer or a math.js integration)
- [Later] Number line, Venn diagrams, tables, fraction bars

## 6. Geometry Instruments

- [MVP] **Ruler**: draggable, rotatable, draw along its edge, with measurement readout
- [MVP] **Protractor**: draggable and rotatable, shows angles
- [MPV] **Compass**: draw circles and arcs by radius
- [MVP] **Set squares** (45° and 30/60° triangles)
- [MVP] Angle and length measurement tool
- [Later] Constructions: perpendicular bisector, angle bisector, parallel line through a point

## 7. Physics Tools

- [v1] Vector tool: arrow with a label (e.g. **F**, **v**), with component decomposition (x/y)

## 8. Text

- [MVP] Text boxes with font size, color, bold, italic
- [MVP] Inline math inside text (e.g. `$E = mc^2$`)
- [v1] Sticky notes
- [v1] Bulleted and numbered lists
- [Later] Rich text formatting (headers, tables)

## 9. Images, Documents & Media

- [MVP] Insert images (upload, drag and drop, paste from clipboard)
- [MVP] **Import PDF**, with each page as a board page or background, so you can annotate worksheets
- [v1] Screenshot / screen-region capture inserted onto the board

## 10. Real-time Collaboration

- [MVP] Real-time multi-user drawing (CRDT-based, e.g. Yjs)
- [MVP] Live cursors with user names
- [MVP] Share a board via link
- [MVP] Reconnect and offline resilience (changes are synced after reconnect)
- [v1] Presence list (who is online)

## 12. Teacher / Classroom Controls

- [MVP] Roles: owner (teacher), editor, viewer

## 13. Saving, Export & History

- [MVP] Auto-save to the server
- [MVP] Export a board or page to **PDF** and **PNG**

## 14. Accounts & Board Management

- [MVP] User accounts (email + password)
- [MVP] Dashboard: list, create, rename, duplicate, delete boards
- [MVP] Guest access via link (students don't need accounts)

## 15. Self-hosting & Administration

- [MVP] **Docker Compose** deployment (single command)
- [MVP] Configuration through environment variables
- [MVP] Storage: PostgreSQL (or SQLite for small setups) plus file storage (local disk or S3-compatible such as MinIO)
- [v1] HTTPS via a reverse proxy (Caddy/Traefik example configs)

## 16. Platform & Accessibility

- [MVP] Works in modern browsers (Chrome, Firefox, Safari, Edge), with no installation
- [MVP] Touch and tablet support (iPad, Android tablets)
- [MVP] Keyboard shortcuts for all tools
- [MVP] Responsive UI for small screens
- [v1] Internationalization (i18n), starting with English and Polish

## 17. Privacy & Security

- [MVP] No external tracking or telemetry by default
- [MVP] Data stays on the self-hosted server
- [MVP] No user data collection
- [v1] Rate limiting and upload size limits

---

## Open Questions for Review

1. Should the MVP include built-in audio/video, or should people use an external call (Zoom, Meet, Discord) at first? No built-in audio/video
2. What is the main use case: 1:1 tutoring (like iDroo), or a full classroom with many students?
1:1 tutoring
3. What tech stack do you prefer? A possible starting point: TypeScript + React frontend, Yjs for sync, Node.js backend, PostgreSQL.
Choose the most sensible for this project and for you
4. MIT/Apache-2.0 (more permissive)?
