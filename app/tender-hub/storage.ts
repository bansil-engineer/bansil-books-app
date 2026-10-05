import { emptyWorkspace, type Workspace } from './model';
const DATABASE = 'bansil-tender-hub-local-v1';
type StoredWorkspace = Workspace & {
    generation?: number;
};
export async function openStore(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(DATABASE, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('workspace');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? Error('Local storage unavailable'));
        r.onblocked = () => reject(Error('Close other Tender Hub tabs before upgrading local storage'));
    });
}
export async function loadWorkspace(): Promise<StoredWorkspace> {
    const db = await openStore();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('workspace', 'readonly'), r = tx.objectStore('workspace').get('current');
        r.onsuccess = () => resolve(r.result ?? { ...emptyWorkspace(), generation: 0 });
        r.onerror = () => reject(r.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}
/** Compare-and-swap avoids silently overwriting edits made in another tab. */
export async function saveWorkspace(w: StoredWorkspace): Promise<StoredWorkspace> {
    const db = await openStore();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('workspace', 'readwrite'), store = tx.objectStore('workspace'), r = store.get('current');
        let saved: StoredWorkspace, conflict = false;
        r.onsuccess = () => {
            if ((r.result?.generation ?? 0) !== (w.generation ?? 0)) {
                conflict = true;
                tx.abort();
                return;
            }
            saved = { ...w, generation: (w.generation ?? 0) + 1 };
            store.put(saved, 'current');
        };
        tx.oncomplete = () => { db.close(); resolve(saved); };
        tx.onabort = () => { db.close(); reject(conflict ? Error('Another tab changed this workspace. Refresh before saving again.') : tx.error ?? Error('Save failed; your prior saved data is intact')); };
        tx.onerror = () => { };
    });
}
