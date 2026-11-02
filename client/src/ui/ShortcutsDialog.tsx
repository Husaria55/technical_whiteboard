import type { Editor } from '../board/editor';
import { Modal } from './Modal';

const GROUPS: [string, [string, string][]][] = [
  [
    'Tools',
    [
      ['V', 'Select'],
      ['H or hold Space', 'Pan'],
      ['P', 'Pen'],
      ['I', 'Highlighter'],
      ['E', 'Eraser'],
      ['L / A', 'Line / arrow'],
      ['R / O', 'Rectangle / ellipse'],
      ['Y / J / N', 'Triangle / polygon / regular polygon'],
      ['K / C', 'Arc / compass'],
      ['T / M / G', 'Text / equation / graph'],
      ['D', 'Measure'],
    ],
  ],
  [
    'Instruments',
    [
      ['U', 'Ruler'],
      ['W', 'Protractor'],
      ['Q / Shift Q', 'Set square 45° / 30°-60°'],
    ],
  ],
  [
    'Editing',
    [
      ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
      ['Ctrl C / X / V', 'Copy / cut / paste'],
      ['Ctrl D', 'Duplicate'],
      ['Ctrl A', 'Select all'],
      ['Delete', 'Delete selection'],
      ['Arrows (+Shift)', 'Nudge selection'],
      ['Shift while drawing', 'Snap angles, squares, circles'],
      ['Double-click', 'Edit text, equation or graph'],
      ['Esc', 'Cancel / deselect'],
    ],
  ],
  [
    'View',
    [
      ['Wheel / pinch', 'Zoom'],
      ['Two fingers / middle drag', 'Pan'],
      ['Ctrl + / Ctrl − / Ctrl 0', 'Zoom in / out / 100%'],
      ['Shift 1', 'Zoom to content'],
      ['Page Up / Down', 'Previous / next page'],
      ['?', 'This help'],
    ],
  ],
];

export function ShortcutsDialog({ editor }: { editor: Editor }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={() => editor.openDialog(null)} wide>
      <div className="shortcuts">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl>
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
