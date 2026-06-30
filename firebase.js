// ===== FIREBASE CONFIG =====
// Замените значения на данные вашего Firebase проекта:
// https://console.firebase.google.com → Project Settings → Your apps → SDK setup
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ===== INIT =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app      = initializeApp(FIREBASE_CONFIG);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

let _fbUid = null;

// ===== STORAGE HOOKS (подключаются к app.js через window) =====
window.storageGet = async (key) => {
  if (!_fbUid) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }
  try {
    const snap = await getDoc(doc(db, 'users', _fbUid, 'data', key));
    return snap.exists() ? snap.data().value : null;
  } catch (e) {
    console.warn('Firestore read error:', e);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }
};

window.storageSet = async (key, value) => {
  localStorage.setItem(key, JSON.stringify(value)); // всегда локально
  if (!_fbUid) return;
  try {
    await setDoc(doc(db, 'users', _fbUid, 'data', key), { value });
  } catch (e) {
    console.warn('Firestore write error:', e);
  }
};

// ===== AUTH UI =====
window.googleSignIn = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Sign-in error:', e);
    alert('Ошибка входа: ' + e.message);
  }
};

window.googleSignOut = async () => {
  await signOut(auth);
};

// ===== MIGRATE localStorage → Firestore на первом входе =====
async function migrateLocalToFirestore(uid) {
  const keys = [
    'dashboard_data',
    'dashboard_categories',
    'dashboard_life_areas',
    'dashboard_dump',
    'dashboard_plan_pages'
  ];
  for (const key of keys) {
    const local = localStorage.getItem(key);
    if (!local) continue;
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'data', key));
      if (!snap.exists()) {
        // В облаке пусто — загружаем локальные данные
        await setDoc(doc(db, 'users', uid, 'data', key), { value: JSON.parse(local) });
      }
    } catch (e) {
      console.warn('Migration error for', key, e);
    }
  }
}

// ===== AUTH SCREEN =====
window.authSkip = function() {
  localStorage.setItem('auth_skipped', '1');
  document.getElementById('auth-screen')?.classList.add('hidden');
};

function maybeShowAuthScreen(user) {
  const skipped = localStorage.getItem('auth_skipped');
  const screen = document.getElementById('auth-screen');
  if (!screen) return;
  if (!user && !skipped) {
    screen.classList.remove('hidden');
  } else {
    screen.classList.add('hidden');
  }
}

// ===== AUTH STATE LISTENER =====
onAuthStateChanged(auth, async (user) => {
  _fbUid = user ? user.uid : null;

  maybeShowAuthScreen(user);

  if (user) {
    await migrateLocalToFirestore(user.uid);
    renderAuthUI(user);
    // Сбрасываем кэш чтобы перечитать данные из Firestore
    if (window._cacheReady !== undefined) window._cacheReady = false;
    // app.js хранит _cacheReady как let — сбрасываем через глобальный флаг
    window.__fbReloadNeeded = true;
    if (typeof ensureCache === 'function') {
      await ensureCache();
      if (typeof renderItems === 'function') renderItems();
      if (typeof renderSidebarCalendar === 'function') renderSidebarCalendar();
      if (typeof renderSidebarPlansTree === 'function') renderSidebarPlansTree();
    }
  } else {
    renderAuthUI(null);
  }
});

// ===== RENDER AUTH UI =====
function renderAuthUI(user) {
  const btn = document.getElementById('auth-btn');
  const avatar = document.getElementById('auth-avatar');
  if (!btn) return;

  if (user) {
    btn.textContent = 'Выйти';
    btn.onclick = window.googleSignOut;
    btn.classList.add('signed-in');
    if (avatar) {
      avatar.style.display = 'flex';
      const img = avatar.querySelector('img');
      const name = avatar.querySelector('.auth-name');
      if (img) img.src = user.photoURL || '';
      if (name) name.textContent = user.displayName || user.email;
    }
  } else {
    btn.textContent = 'Войти через Google';
    btn.onclick = window.googleSignIn;
    btn.classList.remove('signed-in');
    if (avatar) avatar.style.display = 'none';
  }
}
