// حفظ محلي: IndexedDB أساسًا، مع نسخة مرآة في localStorage كاحتياط.
const DB = 'my-financial-plan';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'mfp-state-v1';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp = null;
const db = () => (dbp ||= openDb());

export async function loadState() {
  let fromIdb = null;
  try {
    const d = await db();
    fromIdb = await new Promise((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch { /* fallback */ }
  let fromLs = null;
  try { const raw = localStorage.getItem(LS_KEY); if (raw) fromLs = JSON.parse(raw); } catch { /* ignore */ }
  // اختر الأحدث
  if (fromIdb && fromLs) return (fromLs.savedAt || '') > (fromIdb.savedAt || '') ? fromLs : fromIdb;
  return fromIdb || fromLs;
}

let pending = null;
let chain = Promise.resolve();
export function saveState(state) {
  state.savedAt = new Date().toISOString();
  const snapshot = JSON.parse(JSON.stringify(state));
  try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot)); } catch { /* quota */ }
  pending = snapshot;
  chain = chain.then(async () => {
    if (!pending) return;
    const s = pending; pending = null;
    try {
      const d = await db();
      await new Promise((res, rej) => {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(s, KEY);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch { /* localStorage holds it */ }
  });
  return chain;
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}
