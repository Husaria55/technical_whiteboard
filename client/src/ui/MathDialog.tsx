import { useEffect, useRef, useState } from 'react';
import type { Dialog, Editor } from '../board/editor';
import { Modal } from './Modal';

type MathfieldEl = HTMLElement & { value: string; executeCommand?: (cmd: unknown) => boolean; insert?: (s: string) => boolean };

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { 'math-virtual-keyboard-policy'?: string };
    }
  }
}

let mathliveLoading: Promise<unknown> | null = null;
function loadMathLive() {
  mathliveLoading ??= Promise.all([import('mathlive'), import('mathlive/fonts.css')]).then(([m]) => {
    // Fonts are bundled through fonts.css; no external requests.
    m.MathfieldElement.fontsDirectory = null;
    m.MathfieldElement.soundsDirectory = null;
  });
  return mathliveLoading;
}

const SNIPPETS: [string, string][] = [
  ['\\frac{#?}{#?}', 'a/b'],
  ['\\sqrt{#?}', '√'],
  ['#?^{#?}', 'xⁿ'],
  ['#?_{#?}', 'xₙ'],
  ['\\int_{#?}^{#?}', '∫'],
  ['\\sum_{#?}^{#?}', 'Σ'],
  ['\\lim_{#? \\to #?}', 'lim'],
  ['\\vec{#?}', 'v⃗'],
  ['\\pi', 'π'],
  ['\\alpha', 'α'],
  ['\\theta', 'θ'],
  ['\\Delta', 'Δ'],
  ['\\omega', 'ω'],
  ['\\infty', '∞'],
  ['\\cdot', '·'],
  ['\\pm', '±'],
  ['\\le', '≤'],
  ['\\ge', '≥'],
  ['\\ne', '≠'],
  ['\\approx', '≈'],
];

export function MathDialog({ editor, dialog }: { editor: Editor; dialog: Extract<Dialog, { kind: 'math' }> }) {
  const [latex, setLatex] = useState(dialog.latex);
  const [ready, setReady] = useState(false);
  const fieldRef = useRef<MathfieldEl>(null);

  useEffect(() => {
    let cancelled = false;
    loadMathLive().then(
      () => !cancelled && setReady(true),
      () => !cancelled && setReady(false),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = fieldRef.current;
    if (!ready || !el) return;
    el.value = latex;
    const onInput = () => setLatex(el.value);
    el.addEventListener('input', onInput);
    setTimeout(() => el.focus(), 0);
    return () => el.removeEventListener('input', onInput);
    // Only initialise once MathLive is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const setRaw = (v: string) => {
    setLatex(v);
    if (fieldRef.current) fieldRef.current.value = v;
  };

  const insert = (snippet: string) => {
    const el = fieldRef.current;
    if (el?.insert) {
      el.insert(snippet);
      el.focus();
      setLatex(el.value);
    } else {
      setRaw(latex + snippet.replace(/#\?/g, ''));
    }
  };

  const save = () => void editor.saveMath(latex);

  return (
    <Modal title={dialog.id ? 'Edit equation' : 'Insert equation'} onClose={() => editor.openDialog(null)} wide>
      <div className="math-dialog">
        <div className="snippets">
          {SNIPPETS.map(([s, label]) => (
            <button key={s} title={s} onClick={() => insert(s)}>
              {label}
            </button>
          ))}
        </div>
        {ready ? (
          <math-field
            ref={fieldRef as React.Ref<HTMLElement>}
            className="math-field"
            math-virtual-keyboard-policy="auto"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
            }}
          />
        ) : (
          <p className="muted">Loading visual editor…</p>
        )}
        <label>
          LaTeX
          <textarea className="latex-input" rows={3} value={latex} spellCheck={false} onChange={(e) => setRaw(e.target.value)} placeholder="e.g. x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}" />
        </label>
        <div className="modal-actions">
          <span className="muted small">Ctrl+Enter to insert</span>
          <button onClick={() => editor.openDialog(null)}>Cancel</button>
          <button className="primary" onClick={save} disabled={!latex.trim()}>
            {dialog.id ? 'Save' : 'Insert'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
