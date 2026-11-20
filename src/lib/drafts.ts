export type SceneId = "studio" | "lifestyle" | "seasonal";
export type Draft = {
  id: string;
  name: string;
  facts: string;
  scene: SceneId;
  ratio: "1:1" | "4:5" | "16:9";
  channel: "Product listing" | "Instagram" | "Website";
  image: Blob;
  imageName: string;
  updatedAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Browser storage is unavailable."));
      return;
    }
    const request = indexedDB.open("shelf-studio-local", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Your browser could not open draft storage."));
    request.onblocked = () =>
      reject(new Error("Close other Shelf Studio tabs and try again."));
  });
}
export async function listDrafts(): Promise<Draft[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readonly");
    const request = transaction.objectStore("drafts").getAll();
    transaction.oncomplete = () => {
      db.close();
      resolve(
        (request.result as Draft[]).sort((a, b) => b.updatedAt - a.updatedAt),
      );
    };
    transaction.onerror = () => {
      db.close();
      reject(new Error("Saved drafts could not be loaded."));
    };
    transaction.onabort = () => {
      db.close();
      reject(new Error("Draft loading was interrupted."));
    };
  });
}
export async function saveDraft(draft: Draft): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").put(draft);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(
        new Error(
          "The draft could not be saved. Your browser storage may be full.",
        ),
      );
    };
    transaction.onabort = () => {
      db.close();
      reject(new Error("The draft was not saved. Please try again."));
    };
  });
}
