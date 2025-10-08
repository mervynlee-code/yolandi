/* global window */
const el =
  (typeof window !== 'undefined' && window.wp && window.wp.element) ||
  (typeof window !== 'undefined' && window.React) ||
  {};

export const Fragment = el.Fragment || ((props) => props.children);

export function jsx(type, props, key) {
  const ce =
    (el && el.createElement) ||
    (typeof window !== 'undefined' && window.React && window.React.createElement);
  return ce ? ce(type, { ...props, key }) : { type, props: { ...props, key } };
}

export const jsxs = jsx;
export const jsxDEV = jsx;
