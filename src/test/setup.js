import '@testing-library/jest-dom';

/**
 * Node 20+ ships its OWN `localStorage` global, and it stays `undefined` unless
 * the process was started with `--localstorage-file`. That global shadows the
 * one jsdom installs, so under a recent Node every `localStorage.getItem(...)`
 * in a test throws "Cannot read properties of undefined".
 *
 * The tell is the asymmetry: jsdom implements localStorage and sessionStorage
 * identically, yet in this environment `window.sessionStorage` is a real object
 * while `window.localStorage` is undefined. Only an outside shadow explains that.
 * Node also prints "ExperimentalWarning: localStorage is not available because
 * --localstorage-file was not provided" on every run.
 *
 * This shim installs a spec-shaped in-memory Storage ONLY when the environment
 * failed to provide one, so on a correct Node (or once jsdom wins again) it is a
 * no-op and the real implementation is left alone. It is deliberately confined
 * to the test setup: nothing in src/ is changed to work around a Node version.
 */
function createMemoryStorage() {
  const map = new Map();
  const storage = {
    getItem(key) {
      const k = String(key);
      // The spec returns null for a missing key, never undefined. Code that
      // checks `=== null` is common, so getting this wrong hides real bugs.
      return map.has(k) ? map.get(k) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    clear() {
      map.clear();
    },
    key(index) {
      const keys = Array.from(map.keys());
      const i = Number(index);
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
  };
  Object.defineProperty(storage, 'length', {
    get: () => map.size,
    configurable: true,
  });
  return storage;
}

function installStorage(name) {
  const target = typeof window !== 'undefined' ? window : globalThis;
  let present;
  try {
    present = target[name];
  } catch {
    present = undefined;
  }
  if (present && typeof present.getItem === 'function') return; // real one exists

  const storage = createMemoryStorage();
  for (const obj of new Set([target, globalThis])) {
    Object.defineProperty(obj, name, {
      value: storage,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
}

installStorage('localStorage');
installStorage('sessionStorage');
