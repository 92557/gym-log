// Tiny IndexedDB wrapper. Everything the app knows lives here first, so it works with no signal.
//   kv      – settings, cached sheet data, the in-progress workout, locally saved sessions
//   outbox  – operations waiting to be sent to the Google Sheet (keyPath: id)

const DB_NAME = 'gym-log';
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kvGet = key => tx('kv', 'readonly', s => s.get(key));
export const kvSet = (key, value) => tx('kv', 'readwrite', s => { s.put(value, key); });
export const kvDel = key => tx('kv', 'readwrite', s => { s.delete(key); });
export const outboxAll = () => tx('outbox', 'readonly', s => s.getAll());
export const outboxPut = op => tx('outbox', 'readwrite', s => { s.put(op); });
export const outboxDelete = id => tx('outbox', 'readwrite', s => { s.delete(id); });
