/* global window */
const el = (typeof window !== 'undefined' && window.wp && window.wp.element) || {};
const R = (typeof window !== 'undefined' && window.ReactDOM) || el || {};

export const render = (R && R.render) || el.render || (() => {});
export const hydrate = (R && R.hydrate) || el.hydrate || (() => {});
export const createPortal = (R && R.createPortal) || el.createPortal || ((children, container) => {
  render(children, container);
  return children;
});
export const unmountComponentAtNode =
  (R && R.unmountComponentAtNode) ||
  (container => {
    try { render(null, container); } catch (_) {}
  });

export default { render, hydrate, createPortal, unmountComponentAtNode };
