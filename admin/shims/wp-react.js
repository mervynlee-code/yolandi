/* admin/shims/wp-react.js */
/* global window */
const getEl = () =>
  (typeof window !== 'undefined' && window.wp && window.wp.element) ||
  (typeof window !== 'undefined' && window.React) ||
  null;

// Default export: proxy that resolves properties at *call time*
const ReactProxy = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'default') return ReactProxy; // support default import interop
    if (prop === 'Fragment') {
      const F = getEl()?.Fragment;
      return F || ((props) => props?.children ?? null);
    }
    // Always return a callable so `React.createElement(...)` etc. exist
    return (...args) => {
      const el = getEl();
      const fn = el && el[prop];
      if (typeof fn !== 'function') {
        throw new Error(`React not ready: ${String(prop)}`);
      }
      return fn(...args);
    };
  }
});

export default ReactProxy;

// Named exports that also resolve at call time
export const Fragment = (props) => (getEl()?.Fragment?.(props)) ?? (props?.children ?? null);
export const createElement = (...a) => getEl()?.createElement?.(...a);
export const cloneElement  = (...a) => getEl()?.cloneElement?.(...a);
export const createContext = (...a) => getEl()?.createContext?.(...a);
export const useState      = (...a) => getEl()?.useState?.(...a);
export const useEffect     = (...a) => getEl()?.useEffect?.(...a);
export const useLayoutEffect = (...a) => getEl()?.useLayoutEffect?.(...a);
export const useMemo       = (...a) => getEl()?.useMemo?.(...a);
export const useRef        = (...a) => getEl()?.useRef?.(...a);
export const useCallback   = (...a) => getEl()?.useCallback?.(...a);
export const useReducer    = (...a) => getEl()?.useReducer?.(...a);
export const useContext    = (...a) => getEl()?.useContext?.(...a);
