const DB_NAME = 'neon-scope-archive';
const STORE = 'pending';
const KEY = 'pending-archive';
const AUDIO_STORE = 'last-audio';
const AUDIO_KEY = 'last-audio';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putPendingArchive(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function takePendingArchive() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(KEY);
    request.onsuccess = () => {
      const value = request.result || null;
      if (value) store.delete(KEY);
      tx.oncomplete = () => { db.close(); resolve(value); };
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function putLastAudio(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).put(value, AUDIO_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getLastAudio() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const request = tx.objectStore(AUDIO_STORE).get(AUDIO_KEY);
    request.onsuccess = () => {
      const value = request.result || null;
      tx.oncomplete = () => { db.close(); resolve(value); };
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
