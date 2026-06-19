const STORAGE_KEY = 'dashboard_data';
const CATEGORIES_KEY = 'dashboard_categories';

const TAB_TITLES = {
  goals: 'Цели',
  plans: 'Планы',
  notes: 'Заметки',
  done: 'Сделано',
  dump: 'Выгрузка',
};

let currentTab = 'goals';
let editingId = null;
let selectedPriority = 'normal';
let selectedCategoryFilter = '';

// ===== IN-MEMORY CACHE (async storage abstr.) =====
let _cache = {};         // { dashboard_data: {...}, dashboard_categories: [...] }
let _cacheReady = false;

async function ensureCache() {
  if (_cacheReady) return;
  const getter = window.storageGet || ((k) => Promise.resolve(JSON.parse(localStorage.getItem(k))));
  _cache[STORAGE_KEY]    = (await getter(STORAGE_KEY))    || {};
  _cache[CATEGORIES_KEY] = (await getter(CATEGORIES_KEY)) || [];
  _cache['dashboard_dump'] = (await getter('dashboard_dump')) || [];
  _cacheReady = true;
}

async function persistKey(key) {
  const setter = window.storageSet || ((k, v) => { localStorage.setItem(k, JSON.stringify(v)); return Promise.resolve(); });
  await setter(key, _cache[key]);
}

// ===== CATEGORIES STORAGE =====
function loadCategories() {
  return _cache[CATEGORIES_KEY] || [];
}

async function saveCategories(cats) {
  _cache[CATEGORIES_KEY] = cats;
  await persistKey(CATEGORIES_KEY);
}

// ===== DATA =====
function loadData() {
  return _cache[STORAGE_KEY] || {};
}

async function saveData(data) {
  _cache[STORAGE_KEY] = data;
  await persistKey(STORAGE_KEY);
}

function getItems(tab) {
  return loadData()[tab] || [];
}

async function saveItems(tab, items) {
  const data = loadData();
  data[tab] = items;
  await saveData(data);
}

function totalCount() {
  const data = loadData();
  return Object.values(data).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
}

// ===== RENDER =====
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getAllCategories() {
  return loadCategories();
}

function syncCategoryFromCards() {
  const data = loadData();
  const existing = new Set(loadCategories());
  Object.values(data).forEach(arr => {
    if (Array.isArray(arr)) arr.forEach(i => { if (i.category) existing.add(i.category); });
  });
  saveCategories([...existing].sort((a, b) => a.localeCompare(b, 'ru')));
}

function updateCategoryFilter() {
  const sel = document.getElementById('category-filter');
  const prev = sel.value;
  const cats = getAllCategories();
  sel.innerHTML = '<option value="">Все категории</option>' +
    cats.map(c => `<option value="${escHtml(c)}" ${c === prev ? 'selected' : ''}>${escHtml(c)}</option>`).join('');
  selectedCategoryFilter = sel.value;

  const datalist = document.getElementById('category-suggestions');
  if (datalist) datalist.innerHTML = cats.map(c => `<option value="${escHtml(c)}"></option>`).join('');
}

function renderItems(filter = '') {
  const grid = document.getElementById('items-grid');
  const emptyState = document.getElementById('empty-state');

  let items = getItems(currentTab);
  if (filter) {
    const q = filter.toLowerCase();
    items = items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.desc || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q)
    );
  }
  if (selectedCategoryFilter) {
    items = items.filter(i => (i.category || '') === selectedCategoryFilter);
  }

  updateCategoryFilter();

  document.getElementById('total-count').textContent = `${totalCount()} записей`;

  if (items.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  grid.innerHTML = items.map(item => `
    <div class="card ${item.done ? 'is-done' : ''}" data-id="${item.id}">
      <div class="card-header">
        <div class="card-title">${escHtml(item.title)}</div>
        <div class="card-actions">
          ${currentTab !== 'done' ? `<button class="card-btn done-btn" title="Отметить как сделано" onclick="markDone('${item.id}')">✓</button>` : ''}
          <button class="card-btn edit-btn" title="Редактировать" onclick="openEdit('${item.id}')">✎</button>
          <button class="card-btn delete-btn" title="Удалить" onclick="deleteItem('${item.id}')">✕</button>
        </div>
      </div>
      ${item.category && currentTab === 'notes' ? `<div class="card-category">🏷 ${escHtml(item.category)}</div>` : ''}
      ${item.desc ? `<div class="card-desc">${escHtml(item.desc)}</div>` : ''}
      <div class="card-footer">
        <span class="card-date">${formatDate(item.createdAt)}</span>
        <span class="priority-badge ${item.priority}">${priorityLabel(item.priority)}</span>
      </div>
    </div>
  `).join('');
}

function priorityLabel(p) {
  return { normal: 'Обычный', medium: 'Важный', high: 'Срочный' }[p] || p;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== ACTIONS =====
async function deleteItem(id) {
  const items = getItems(currentTab).filter(i => i.id !== id);
  await saveItems(currentTab, items);
  tgHaptic?.('light');
  renderItems(document.getElementById('search-input').value);
}

async function markDone(id) {
  const allData = loadData();
  const items = allData[currentTab] || [];
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;

  const [item] = items.splice(idx, 1);
  item.done = true;
  item.doneAt = Date.now();

  allData[currentTab] = items;
  allData['done'] = allData['done'] || [];
  allData['done'].unshift(item);
  await saveData(allData);
  tgHaptic?.('medium');
  renderItems(document.getElementById('search-input').value);
}

function openEdit(id) {
  const item = getItems(currentTab).find(i => i.id === id);
  if (!item) return;

  editingId = id;
  document.getElementById('modal-title').textContent = 'Редактировать';
  document.getElementById('input-title').value = item.title;
  document.getElementById('input-desc').value = item.desc || '';
  document.getElementById('input-category').value = item.category || '';
  setActivePriority(item.priority || 'normal');
  openModal();
}

// ===== MODAL =====
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  const isNotes = currentTab === 'notes';
  document.querySelector('.priority-btns').style.display = isNotes ? 'none' : '';
  document.getElementById('priority-label').style.display = isNotes ? 'none' : '';
  document.getElementById('input-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('input-title').value = '';
  document.getElementById('input-desc').value = '';
  document.getElementById('input-category').value = '';
  setActivePriority('normal');
  editingId = null;
  document.getElementById('modal-title').textContent = 'Новая запись';
}

function setActivePriority(p) {
  selectedPriority = p;
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === p);
  });
}

async function saveItem() {
  const title = document.getElementById('input-title').value.trim();
  if (!title) {
    document.getElementById('input-title').focus();
    document.getElementById('input-title').style.borderColor = 'var(--danger)';
    setTimeout(() => document.getElementById('input-title').style.borderColor = '', 1000);
    return;
  }

  const desc = document.getElementById('input-desc').value.trim();
  const category = document.getElementById('input-category').value.trim();
  let items = getItems(currentTab);

  if (editingId) {
    items = items.map(i => i.id === editingId ? { ...i, title, desc, category, priority: selectedPriority } : i);
  } else {
    items.unshift({
      id: Date.now().toString(),
      title,
      desc,
      category,
      priority: selectedPriority,
      createdAt: Date.now(),
      done: false,
    });
  }

  await saveItems(currentTab, items);
  tgHaptic?.('light');
  closeModal();
  renderItems(document.getElementById('search-input').value);
}

// ===== TABS =====
function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const dumpPanel = document.getElementById('dump-panel');
  const obsPanel  = document.getElementById('obsidian-panel');
  const mainEl    = document.querySelector('.main');

  dumpPanel.classList.add('hidden');
  obsPanel.classList.add('hidden');
  mainEl.style.display = '';

  if (tab === 'dump') {
    mainEl.style.display = 'none';
    dumpPanel.classList.remove('hidden');
    return;
  }
  if (tab === 'obsidian') {
    mainEl.style.display = 'none';
    obsPanel.classList.remove('hidden');
    return;
  }

  document.getElementById('tab-title').textContent = TAB_TITLES[tab];
  document.getElementById('search-input').value = '';
  selectedCategoryFilter = '';

  const isNotes = tab === 'notes';
  document.querySelector('.category-filter-wrap').style.display = isNotes ? '' : 'none';

  renderItems();
}

// ===== INIT =====
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('open-modal').addEventListener('click', () => {
  editingId = null;
  openModal();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', saveItem);

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

document.querySelectorAll('.priority-btn').forEach(btn => {
  btn.addEventListener('click', () => setActivePriority(btn.dataset.priority));
});

document.getElementById('search-input').addEventListener('input', (e) => {
  renderItems(e.target.value);
});

document.getElementById('category-filter').addEventListener('change', (e) => {
  selectedCategoryFilter = e.target.value;
  renderItems(document.getElementById('search-input').value);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeCatManager();
  }
  if (e.key === 'Enter' && !document.getElementById('modal-overlay').classList.contains('hidden')) {
    if (e.target.tagName !== 'TEXTAREA') saveItem();
  }
});

async function init() {
  await ensureCache();
  syncCategoryFromCards();
  document.querySelector('.category-filter-wrap').style.display = 'none';
  renderItems();
  const user = window.getTelegramUser?.();
  if (user) {
    const footer = document.getElementById('total-count');
    if (footer) footer.title = `Привет, ${user.first_name}!`;
  }
}

init();

// ===== CATEGORY MANAGER =====
function openCatManager() {
  document.getElementById('cat-manager-overlay').classList.remove('hidden');
  document.getElementById('cat-new-input').value = '';
  renderCatList();
  document.getElementById('cat-new-input').focus();
}

function closeCatManager() {
  const overlay = document.getElementById('cat-manager-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  updateCategoryFilter();
  renderItems(document.getElementById('search-input').value);
}

function renderCatList() {
  const cats = loadCategories();
  const list = document.getElementById('cat-list');
  if (cats.length === 0) {
    list.innerHTML = '<div class="cat-empty">Категорий пока нет. Добавь первую!</div>';
    return;
  }
  list.innerHTML = cats.map((cat, idx) => `
    <div class="cat-item" data-idx="${idx}">
      <span class="cat-item-icon">🏷</span>
      <span class="cat-item-name" id="cat-name-${idx}">${escHtml(cat)}</span>
      <input class="cat-item-input hidden" id="cat-input-${idx}" value="${escHtml(cat)}" />
      <div class="cat-item-actions">
        <button class="cat-btn cat-edit-btn" onclick="startEditCat(${idx})" id="cat-edit-btn-${idx}" title="Переименовать">✎</button>
        <button class="cat-btn cat-save-btn hidden" onclick="saveEditCat(${idx})" id="cat-save-btn-${idx}" title="Сохранить">✓</button>
        <button class="cat-btn cat-cancel-btn hidden" onclick="cancelEditCat()" id="cat-cancel-btn-${idx}" title="Отмена">✕</button>
        <button class="cat-btn cat-delete-btn" onclick="deleteCat(${idx})" id="cat-delete-btn-${idx}" title="Удалить">🗑</button>
      </div>
    </div>
  `).join('');
}

function addCategory() {
  const input = document.getElementById('cat-new-input');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const cats = loadCategories();
  if (cats.map(c => c.toLowerCase()).includes(name.toLowerCase())) {
    input.style.borderColor = 'var(--warning)';
    setTimeout(() => input.style.borderColor = '', 1000);
    return;
  }
  cats.push(name);
  cats.sort((a, b) => a.localeCompare(b, 'ru'));
  saveCategories(cats);
  input.value = '';
  renderCatList();
  updateCategoryFilter();
}

function startEditCat(idx) {
  renderCatList();
  document.getElementById(`cat-name-${idx}`).classList.add('hidden');
  document.getElementById(`cat-input-${idx}`).classList.remove('hidden');
  document.getElementById(`cat-edit-btn-${idx}`).classList.add('hidden');
  document.getElementById(`cat-delete-btn-${idx}`).classList.add('hidden');
  document.getElementById(`cat-save-btn-${idx}`).classList.remove('hidden');
  document.getElementById(`cat-cancel-btn-${idx}`).classList.remove('hidden');
  document.getElementById(`cat-input-${idx}`).focus();
}

function cancelEditCat() {
  renderCatList();
}

async function saveEditCat(idx) {
  const input = document.getElementById(`cat-input-${idx}`);
  const newName = input.value.trim();
  if (!newName) return;
  const cats = loadCategories();
  const oldName = cats[idx];
  if (newName === oldName) { renderCatList(); return; }
  if (cats.map(c => c.toLowerCase()).includes(newName.toLowerCase())) {
    input.style.borderColor = 'var(--warning)';
    setTimeout(() => input.style.borderColor = '', 1000);
    return;
  }
  cats[idx] = newName;
  cats.sort((a, b) => a.localeCompare(b, 'ru'));
  saveCategories(cats);
  const data = loadData();
  Object.keys(data).forEach(tab => {
    if (Array.isArray(data[tab])) {
      data[tab] = data[tab].map(item =>
        item.category === oldName ? { ...item, category: newName } : item
      );
    }
  });
  await saveData(data);
  renderCatList();
}

async function deleteCat(idx) {
  const cats = loadCategories();
  const name = cats[idx];
  const data = loadData();
  let usedIn = 0;
  Object.values(data).forEach(arr => {
    if (Array.isArray(arr)) arr.forEach(i => { if (i.category === name) usedIn++; });
  });
  const msg = usedIn > 0
    ? `Удалить категорию «${name}»?\nОна используется в ${usedIn} карточках — у них категория станет пустой.`
    : `Удалить категорию «${name}»?`;
  if (!confirm(msg)) return;
  cats.splice(idx, 1);
  saveCategories(cats);
  if (usedIn > 0) {
    Object.keys(data).forEach(tab => {
      if (Array.isArray(data[tab])) {
        data[tab] = data[tab].map(item =>
          item.category === name ? { ...item, category: '' } : item
        );
      }
    });
    await saveData(data);
  }
  renderCatList();
  updateCategoryFilter();
}

// ===== DUMP PANEL =====
const DUMP_KEY = 'dashboard_dump';

function loadDumpItems() {
  return _cache[DUMP_KEY] || [];
}
async function saveDumpItems(items) {
  _cache[DUMP_KEY] = items;
  const setter = window.storageSet || ((k, v) => { localStorage.setItem(k, JSON.stringify(v)); return Promise.resolve(); });
  await setter(DUMP_KEY, items);
}

async function parseDump() {
  const text = document.getElementById('dump-textarea').value;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  const existing = loadDumpItems();
  const newItems = lines.map(line => ({
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    text: line,
    done: false,
  }));
  await saveDumpItems([...existing, ...newItems]);
  document.getElementById('dump-textarea').value = '';
  renderDump();
}

function renderDump() {
  const col = document.getElementById('dump-items-col');
  const items = loadDumpItems();

  if (!items.length) {
    col.innerHTML = '<div class="dump-empty-hint">Введи текст → нажми «Разбить»</div>';
    return;
  }

  const cats = loadCategories();
  const catOptions = ['goals','plans','notes'].map(t =>
    `<option value="${t}">${TAB_TITLES[t]}</option>`
  ).join('');

  col.innerHTML = `
    <div class="dump-list-header">
      <span>${items.length} пунктов</span>
      <button class="dump-clear-btn" onclick="clearDump()">Очистить всё</button>
    </div>
    <div class="dump-list">
      ${items.map((item, idx) => `
        <div class="dump-item ${item.done ? 'dump-item-sent' : ''}" data-id="${item.id}">
          <div class="dump-item-text">${escHtml(item.text)}</div>
          <div class="dump-item-controls">
            ${!item.done ? `
              <select class="dump-dest-select" id="dest-${item.id}">
                ${catOptions}
              </select>
              <button class="dump-send-btn" onclick="sendDumpItem('${item.id}')">→ Отправить</button>
              <button class="dump-del-btn" onclick="removeDumpItem('${item.id}')">✕</button>
            ` : `
              <span class="dump-sent-label">✓ Отправлено</span>
              <button class="dump-del-btn" onclick="removeDumpItem('${item.id}')">✕</button>
            `}
          </div>
        </div>
      `).join('')}
    </div>
    <div class="dump-bulk">
      <span class="dump-bulk-label">Выбранные:</span>
      <select class="dump-dest-select" id="dump-bulk-dest">
        ${catOptions}
      </select>
      <button class="dump-send-btn" onclick="sendAllPending()">→ Отправить все</button>
    </div>
  `;
}

async function sendDumpItem(id) {
  const items = loadDumpItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  const dest = document.getElementById(`dest-${id}`).value;
  const tabItems = getItems(dest);
  tabItems.unshift({
    id: Date.now().toString(),
    title: item.text,
    desc: '',
    category: '',
    priority: 'normal',
    createdAt: Date.now(),
    done: false,
  });
  await saveItems(dest, tabItems);
  item.done = true;
  await saveDumpItems(items);
  tgHaptic?.('light');
  renderDump();
}

async function sendAllPending() {
  const items = loadDumpItems();
  const pending = items.filter(i => !i.done);
  if (!pending.length) return;
  const dest = document.getElementById('dump-bulk-dest').value;
  const tabItems = getItems(dest);
  pending.forEach(item => {
    tabItems.unshift({
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      title: item.text,
      desc: '',
      category: '',
      priority: 'normal',
      createdAt: Date.now(),
      done: false,
    });
    item.done = true;
  });
  await saveItems(dest, tabItems);
  await saveDumpItems(items);
  tgHaptic?.('medium');
  renderDump();
}

async function removeDumpItem(id) {
  await saveDumpItems(loadDumpItems().filter(i => i.id !== id));
  renderDump();
}

async function clearDump() {
  if (!confirm('Очистить весь список выгрузки?')) return;
  await saveDumpItems([]);
  renderDump();
}

function updateDumpPreview() {
  const text = document.getElementById('dump-textarea').value;
  const preview = document.getElementById('dump-preview');
  const lines = text.split('\n');

  const hasContent = lines.some(l => l.trim());
  if (!hasContent) {
    preview.classList.add('hidden');
    return;
  }

  preview.classList.remove('hidden');
  preview.innerHTML = lines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return `<div class="dump-preview-gap"></div>`;
    return `<div class="dump-preview-item">
      <span class="dump-preview-num">${idx + 1}</span>
      <span class="dump-preview-text">${escHtml(trimmed)}</span>
    </div>`;
  }).join('');
}

document.getElementById('dump-parse-btn').addEventListener('click', () => {
  parseDump();
  document.getElementById('dump-preview').classList.add('hidden');
});
document.getElementById('dump-textarea').addEventListener('input', updateDumpPreview);
document.getElementById('dump-textarea').addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    parseDump();
    document.getElementById('dump-preview').classList.add('hidden');
  }
});

document.getElementById('open-cat-manager').addEventListener('click', openCatManager);
document.getElementById('cat-manager-close').addEventListener('click', closeCatManager);
document.getElementById('cat-manager-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeCatManager();
});
document.getElementById('cat-add-btn').addEventListener('click', addCategory);
document.getElementById('cat-new-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCategory();
});

// ===== MOBILE SIDEBAR =====
const hamburger = document.getElementById('hamburger');
const sidebarEl = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

function openSidebar() {
  sidebarEl.classList.add('open');
  hamburger.classList.add('open');
  sidebarOverlay.classList.remove('hidden');
  sidebarOverlay.classList.add('visible');
}

function closeSidebar() {
  sidebarEl.classList.remove('open');
  hamburger.classList.remove('open');
  sidebarOverlay.classList.add('hidden');
  sidebarOverlay.classList.remove('visible');
}

hamburger.addEventListener('click', () => {
  sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar();
});

sidebarOverlay.addEventListener('click', closeSidebar);

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebar();
  });
});
