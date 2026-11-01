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

/**
 * يرجع { state, unreadable }. unreadable=true يعني وجود بيانات تعذرت قراءتها:
 * في هذه الحالة لا يجوز إنشاء بيانات جديدة فوقها.
 */
export async function loadState() {
  let fromIdb = null; let idbError = false;
  try {
    const d = await db();
    fromIdb = await new Promise((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch { idbError = true; }
  let fromLs = null; let lsCorrupt = false;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try { fromLs = JSON.parse(raw); } catch {
        lsCorrupt = true;
        // نحتفظ بنسخة من النص التالف بدل حذفه
        try { localStorage.setItem(`${LS_KEY}-unreadable-${Date.now()}`, raw); } catch { /* quota */ }
      }
    }
  } catch { /* localStorage unavailable */ }
  const valid = (x) => x && typeof x === 'object' && Array.isArray(x.items) && Array.isArray(x.payments);
  if (!valid(fromIdb)) fromIdb = null;
  if (!valid(fromLs)) fromLs = null;
  let state = null;
  if (fromIdb && fromLs) state = (fromLs.savedAt || '') > (fromIdb.savedAt || '') ? fromLs : fromIdb;
  else state = fromIdb || fromLs;
  return { state, unreadable: !state && (lsCorrupt || idbError) };
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
