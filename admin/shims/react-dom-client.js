/* global window */
const el = (typeof window !== 'undefined' && window.wp && window.wp.element) || {};
const R = (typeof window !== 'undefined' && window.ReactDOM) || el || {};

export function createRoot(container, options) {
  if (R && typeof R.createRoot === 'function') return R.createRoot(container, options);
  // Legacy fallback polyfill for React 17-style render
  return {
    render(node) {
      const render = (R && R.render) || el.render;
      if (typeof render === 'function') render(node, container);
    },
    unmount() {
      if (typeof R.unmount === 'function') return R.unmount();
      if (typeof R.unmountComponentAtNode === 'function') return R.unmountComponentAtNode(container);
      // best-effort
      const render = (R && R.render) || el.render;
      if (typeof render === 'function') render(null, container);
    },
  };
}

export function hydrateRoot(container, children, options) {
  if (R && typeof R.hydrateRoot === 'function') return R.hydrateRoot(container, children, options);
  const hydrate = (R && R.hydrate) || el.hydrate;
  if (typeof hydrate === 'function') hydrate(children, container);
  return { hydrate() {}, render() {}, unmount() {} };
}

export default { createRoot, hydrateRoot };
