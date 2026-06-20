// ===== TELEGRAM MINI APP INTEGRATION =====

const TG = window.Telegram?.WebApp;
const IS_TG = !!TG;

if (IS_TG) {
  TG.ready();
  TG.expand();
  applyTelegramTheme();
}

function applyTelegramTheme() {
  // Намеренно не применяем тему Telegram — используем свою палитру
  // чтобы текст всегда был виден на тёмном фоне
}

// ===== CLOUD STORAGE HELPERS =====
const CHUNK_SIZE = 3800;

function tgGet(key) {
  return new Promise((resolve) => {
    if (!IS_TG || !TG.CloudStorage) return resolve(null);
    TG.CloudStorage.getItem(key, (err, val) => resolve(err ? null : (val || null)));
  });
}

function tgSet(key, value) {
  return new Promise((resolve) => {
    if (!IS_TG || !TG.CloudStorage) return resolve(false);
    TG.CloudStorage.setItem(key, value, (err) => resolve(!err));
  });
}

function tgRemove(key) {
  return new Promise((resolve) => {
    if (!IS_TG || !TG.CloudStorage) return resolve();
    TG.CloudStorage.removeItem(key, () => resolve());
  });
}

async function tgSetChunked(key, str) {
  const chunks = Math.ceil(str.length / CHUNK_SIZE);
  for (let i = 0; i < chunks; i++) {
    await tgSet(`${key}__c${i}`, str.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  await tgSet(`${key}__n`, String(chunks));
}

async function tgGetChunked(key) {
  const countStr = await tgGet(`${key}__n`);
  if (!countStr) return null;
  const count = parseInt(countStr);
  let result = '';
  for (let i = 0; i < count; i++) {
    const chunk = await tgGet(`${key}__c${i}`);
    if (chunk === null) return null;
    result += chunk;
  }
  return result;
}

// ===== PUBLIC STORAGE API =====

window.storageGet = async function(key) {
  if (IS_TG && TG.CloudStorage) {
    let val = await tgGet(key);
    if (!val) val = await tgGetChunked(key);
    if (val) {
      try { return JSON.parse(val); } catch { return null; }
    }
  }
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};

window.storageSet = async function(key, value) {
  const str = JSON.stringify(value);
  localStorage.setItem(key, str);
  if (IS_TG && TG.CloudStorage) {
    if (str.length > CHUNK_SIZE) {
      await tgSetChunked(key, str);
    } else {
      await tgSet(key, str);
    }
  }
};

// ===== TELEGRAM USER =====
window.getTelegramUser = function() {
  if (!IS_TG) return null;
  return TG.initDataUnsafe?.user || null;
};

// ===== HAPTIC =====
window.tgHaptic = function(type = 'light') {
  if (!IS_TG || !TG.HapticFeedback) return;
  TG.HapticFeedback.impactOccurred(type);
};

// ===== BACK BUTTON =====
window.tgShowBack = function(cb) {
  if (!IS_TG) return;
  TG.BackButton.show();
  TG.BackButton.onClick(cb);
};

window.tgHideBack = function() {
  if (!IS_TG) return;
  TG.BackButton.hide();
  TG.BackButton.offClick();
};

console.log(IS_TG ? '✅ Telegram Mini App' : '🌐 Browser mode');
