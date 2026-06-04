import { el } from '../design-system/index.js';

export const meta = { title: 'Example Primitive', layer: 'primitive' };

export default function render() {
  return el('section', {
    style: {
      width: '280px',
      padding: 'var(--ff-space-7)',
      border: '1px solid var(--ff-border-hi)',
      borderRadius: 'var(--ff-radius-xl)',
      background: 'var(--ff-elev)',
      color: 'var(--ff-text)',
      fontFamily: 'var(--ff-font)',
    },
  }, [
    el('h2', {
      text: 'Blank Viewport',
      style: {
        margin: '0 0 var(--ff-space-4)',
        fontSize: 'var(--ff-type-h1)',
        fontWeight: '600',
      },
    }),
    el('p', {
      text: 'Replace this artboard with project-owned primitives, modules, and composites.',
      style: {
        margin: '0',
        color: 'var(--ff-text-mid)',
        fontSize: 'var(--ff-type-body)',
        lineHeight: '1.45',
      },
    }),
  ]);
}
