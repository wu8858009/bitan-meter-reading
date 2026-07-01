/*
  抄表照片存證：用 IndexedDB 存放壓縮後的照片 Blob（不是 localStorage）。
  70 間店 × 3 種錶 × 每期都拍，體積很快就會超過 localStorage 的容量上限，
  IndexedDB 的容量以百 MB 起跳才夠長期使用。
  照片只存在拍照當下那台裝置的瀏覽器裡，不包含在「備份匯出」的 JSON 裡。
*/

const PHOTO_DB_NAME = 'bpt_meter_photos';
const PHOTO_STORE_NAME = 'photos';
const PHOTO_MAX_DIMENSION = 1024;
const PHOTO_JPEG_QUALITY = 0.7;

let photoDbPromise = null;

function photoKey(period, rowId, type) {
  return `${period}_${rowId}_${type}`;
}

function openPhotoDB() {
  if (photoDbPromise) return photoDbPromise;
  photoDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PHOTO_STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return photoDbPromise;
}

async function compressImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
}

async function savePhoto(period, rowId, type, file) {
  const blob = await compressImageFile(file);
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(PHOTO_STORE_NAME).put({ id: photoKey(period, rowId, type), period, rowId, type, blob, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhotoKeysForPeriod(period) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const keys = new Set();
    const tx = db.transaction(PHOTO_STORE_NAME, 'readonly');
    const cursorReq = tx.objectStore(PHOTO_STORE_NAME).openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) { resolve(keys); return; }
      if (cursor.value.period === period) keys.add(`${cursor.value.rowId}_${cursor.value.type}`);
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

async function getPhotoBlob(period, rowId, type) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readonly');
    const req = tx.objectStore(PHOTO_STORE_NAME).get(photoKey(period, rowId, type));
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
  });
}
