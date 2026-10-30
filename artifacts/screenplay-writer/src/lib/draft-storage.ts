const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open("screenplay-writer", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("drafts");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export async function saveDrafts(value: unknown) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(value, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function loadDrafts(): Promise<unknown> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction("drafts").objectStore("drafts").get("current");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
export async function deleteDrafts() {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete("current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
