const STORAGE_KEY = 'dashboard_data';
const CATEGORIES_KEY = 'dashboard_categories';
const LIFE_AREAS_KEY = 'dashboard_life_areas';
const PLAN_PAGES_KEY = 'dashboard_plan_pages';

const TAB_TITLES = {
  goals: 'Цели',
  tasks: 'Дела',
  zadachi: 'Задачи',
  plans: 'Планы',
  notes: 'Заметки',
  done: 'Сделано',
  dump: 'Выгрузка',
};

let currentTab = 'goals';
let editingId = null;
let selectedPriority = 'normal';
let selectedStatus = 'not_started';
let selectedCategoryFilter = '';
let currentPlanPageId = null;

// ===== IN-MEMORY CACHE (async storage abstr.) =====
let _cache = {};         // { dashboard_data: {...}, dashboard_categories: [...] }
let _cacheReady = false;

async function ensureCache() {
  if (_cacheReady) return;
  const getter = window.storageGet || ((k) => Promise.resolve(JSON.parse(localStorage.getItem(k))));
  _cache[STORAGE_KEY]    = (await getter(STORAGE_KEY))    || {};
  _cache[CATEGORIES_KEY] = (await getter(CATEGORIES_KEY)) || [];
  _cache[LIFE_AREAS_KEY] = (await getter(LIFE_AREAS_KEY)) || ['Здоровье', 'Карьера', 'Семья', 'Финансы', 'Саморазвитие', 'Отдых'];
  _cache['dashboard_dump'] = (await getter('dashboard_dump')) || [];
  _cache[PLAN_PAGES_KEY] = (await getter(PLAN_PAGES_KEY)) || [];
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

// ===== LIFE AREAS STORAGE =====
function loadLifeAreas() {
  return _cache[LIFE_AREAS_KEY] || ['Здоровье', 'Карьера', 'Семья', 'Финансы', 'Саморазвитие', 'Отдых'];
}

async function saveLifeAreas(areas) {
  _cache[LIFE_AREAS_KEY] = areas;
  await persistKey(LIFE_AREAS_KEY);
}

// ===== PLAN PAGES STORAGE =====
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const WEEKDAY_NAMES = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

function loadPlanPages() {
  return _cache[PLAN_PAGES_KEY] || [];
}

async function savePlanPages(pages) {
  _cache[PLAN_PAGES_KEY] = pages;
  await persistKey(PLAN_PAGES_KEY);
}

function getPlanPage(id) {
  return loadPlanPages().find(p => p.id === id) || null;
}

function planPageChildren(parentId) {
  return loadPlanPages()
    .filter(p => p.parentId === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function planPageBreadcrumb(id) {
  const chain = [];
  let cur = id ? getPlanPage(id) : null;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? getPlanPage(cur.parentId) : null;
  }
  return chain;
}

function newPlanPageId() {
  return 'pp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function addPlanPage(type, parentId, title) {
  const pages = loadPlanPages();
  const siblings = pages.filter(p => p.parentId === parentId);
  const order = siblings.length ? Math.max(...siblings.map(p => p.order ?? 0)) + 1 : 0;
  const page = { id: newPlanPageId(), type, parentId: parentId || null, title, order };
  pages.push(page);
  await savePlanPages(pages);
  return page;
}

async function deletePlanPage(id) {
  const pages = loadPlanPages();
  // собираем id страницы и всех потомков
  const toDelete = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of pages) {
      if (p.parentId && toDelete.has(p.parentId) && !toDelete.has(p.id)) {
        toDelete.add(p.id);
        changed = true;
      }
    }
  }
  // удаляем элементы планов, привязанные к этим страницам
  const items = getItems('plans').filter(i => !toDelete.has(i.pageId));
  await saveItems('plans', items);
  await savePlanPages(pages.filter(p => !toDelete.has(p.id)));
}

async function renamePlanPage(id, title) {
  const pages = loadPlanPages();
  const page = pages.find(p => p.id === id);
  if (!page) return;
  page.title = title;
  await savePlanPages(pages);
}

async function generateYearMonths() {
  const year = new Date().getFullYear();
  const pages = loadPlanPages();
  const existing = pages.filter(p => !p.parentId);
  for (let m = 0; m < 12; m++) {
    const title = `${MONTH_NAMES[m]} ${year}`;
    if (existing.some(p => p.title === title)) continue;
    const order = existing.length + m;
    pages.push({ id: newPlanPageId(), type: 'month', parentId: null, title, order });
  }
  _cache[PLAN_PAGES_KEY] = pages;
  renderPlansNav();
  await persistKey(PLAN_PAGES_KEY);
}

async function generateMonthWeeks(monthId) {
  const pages = loadPlanPages();
  const existing = pages.filter(p => p.parentId === monthId);
  const start = existing.length;
  for (let w = 1; w <= 4; w++) {
    const title = `Неделя ${start + w}`;
    if (existing.some(p => p.title === title)) continue;
    pages.push({ id: newPlanPageId(), type: 'week', parentId: monthId, title, order: start + w });
  }
  _cache[PLAN_PAGES_KEY] = pages;
  renderPlansNav();
  await persistKey(PLAN_PAGES_KEY);
}

async function generateWeekDays(weekId) {
  const pages = loadPlanPages();
  const existing = pages.filter(p => p.parentId === weekId);
  for (let d = 0; d < 7; d++) {
    const title = WEEKDAY_NAMES[d];
    if (existing.some(p => p.title === title)) continue;
    pages.push({ id: newPlanPageId(), type: 'day', parentId: weekId, title, order: d });
  }
  _cache[PLAN_PAGES_KEY] = pages;
  renderPlansNav();
  await persistKey(PLAN_PAGES_KEY);
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

function updateLifeAreaSelect() {
  const sel = document.getElementById('input-life-area');
  if (!sel) return;
  const areas = loadLifeAreas();
  const prev = Array.from(sel.selectedOptions).map(o => o.value);
  sel.innerHTML = areas.map(a => `<option value="${escHtml(a)}" ${prev.includes(a) ? 'selected' : ''}>${escHtml(a)}</option>`).join('');
}

function openLifeAreaManager() {
  document.getElementById('life-area-manager-overlay').classList.remove('hidden');
  document.getElementById('life-area-new-input').value = '';
  renderLifeAreaList();
  document.getElementById('life-area-new-input').focus();
}

function closeLifeAreaManager() {
  document.getElementById('life-area-manager-overlay').classList.add('hidden');
  updateLifeAreaSelect();
}

async function addLifeArea() {
  const input = document.getElementById('life-area-new-input');
  const name = input.value.trim();
  if (!name) return;
  const areas = loadLifeAreas();
  if (areas.map(a => a.toLowerCase()).includes(name.toLowerCase())) {
    input.style.borderColor = 'var(--warning)';
    setTimeout(() => input.style.borderColor = '', 1000);
    return;
  }
  areas.push(name);
  areas.sort((a, b) => a.localeCompare(b, 'ru'));
  await saveLifeAreas(areas);
  input.value = '';
  renderLifeAreaList();
  updateLifeAreaSelect();
}

function renderLifeAreaList() {
  const list = document.getElementById('life-area-list');
  const areas = loadLifeAreas();
  list.innerHTML = areas.map((a, idx) => `
    <div class="cat-item">
      <span class="cat-item-name">${escHtml(a)}</span>
      <div class="cat-item-actions">
        <button class="cat-item-btn" onclick="editLifeArea(${idx})">✎</button>
        <button class="cat-item-btn delete" onclick="deleteLifeArea(${idx})">✕</button>
      </div>
    </div>
  `).join('');
}

function editLifeArea(idx) {
  const areas = loadLifeAreas();
  const name = areas[idx];
  const list = document.getElementById('life-area-list');
  list.innerHTML = areas.map((a, i) => i === idx ? `
    <div class="cat-item">
      <input type="text" class="cat-item-input" id="life-area-input-${i}" value="${escHtml(a)}" />
      <div class="cat-item-actions">
        <button class="cat-item-btn" onclick="saveEditLifeArea(${i})">✓</button>
        <button class="cat-item-btn delete" onclick="renderLifeAreaList()">✕</button>
      </div>
    </div>
  ` : `
    <div class="cat-item">
      <span class="cat-item-name">${escHtml(a)}</span>
      <div class="cat-item-actions">
        <button class="cat-item-btn" onclick="editLifeArea(${i})">✎</button>
        <button class="cat-item-btn delete" onclick="deleteLifeArea(${i})">✕</button>
      </div>
    </div>
  `).join('');
  document.getElementById(`life-area-input-${idx}`).focus();
}

async function saveEditLifeArea(idx) {
  const input = document.getElementById(`life-area-input-${idx}`);
  const newName = input.value.trim();
  if (!newName) return;
  const areas = loadLifeAreas();
  const oldName = areas[idx];
  if (newName === oldName) { renderLifeAreaList(); return; }
  if (areas.map(a => a.toLowerCase()).includes(newName.toLowerCase())) {
    input.style.borderColor = 'var(--warning)';
    setTimeout(() => input.style.borderColor = '', 1000);
    return;
  }
  areas[idx] = newName;
  areas.sort((a, b) => a.localeCompare(b, 'ru'));
  await saveLifeAreas(areas);
  const data = loadData();
  Object.keys(data).forEach(tab => {
    if (Array.isArray(data[tab])) {
      data[tab].forEach(item => {
        if (item.lifeAreas) {
          item.lifeAreas = item.lifeAreas.map(a => a === oldName ? newName : a);
        }
      });
    }
  });
  await saveData(data);
  renderLifeAreaList();
  updateLifeAreaSelect();
  renderItems(document.getElementById('search-input').value);
}

async function deleteLifeArea(idx) {
  const areas = loadLifeAreas();
  const name = areas[idx];
  if (!confirm(`Удалить сферу жизни «${name}»?`)) return;
  areas.splice(idx, 1);
  await saveLifeAreas(areas);
  const data = loadData();
  Object.keys(data).forEach(tab => {
    if (Array.isArray(data[tab])) {
      data[tab].forEach(item => {
        if (item.lifeAreas) item.lifeAreas = item.lifeAreas.filter(a => a !== name);
      });
    }
  });
  await saveData(data);
  renderLifeAreaList();
  updateLifeAreaSelect();
  renderItems(document.getElementById('search-input').value);
}

function renderItems(filter = '') {
  const grid = document.getElementById('items-grid');
  const emptyState = document.getElementById('empty-state');

  let items = getItems(currentTab);
  if (currentTab === 'plans') {
    items = items.filter(i => (i.pageId || null) === currentPlanPageId);
  }
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

  // Checkbox-based rendering for "tasks" (Дела)
  if (currentTab === 'tasks') {
    emptyState.classList.add('hidden');
    grid.innerHTML = `
      <div class="tasks-checklist">
        <div class="tasks-input-row">
          <input type="text" id="tasks-quick-input" class="tasks-quick-input" placeholder="Добавить дело..." />
        </div>
        <div class="tasks-list"></div>
      </div>
    `;
    renderTasksList();
    const input = document.getElementById('tasks-quick-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        addQuickTask(input.value.trim());
        input.value = '';
      }
    });
    return;
  }

  if (items.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  const showNumbers = currentTab === 'goals';

  grid.innerHTML = items.map((item, idx) => `
    <div class="card ${item.done ? 'is-done' : ''}" data-id="${item.id}">
      <div class="card-header">
        <div class="card-title">${showNumbers ? `<span class="goal-number">${idx + 1}.</span> ` : ''}${escHtml(item.title)}</div>
        <div class="card-actions">
          ${currentTab !== 'done' ? `<button class="card-btn done-btn" title="Отметить как сделано" onclick="markDone('${item.id}')">✓</button>` : ''}
          <button class="card-btn edit-btn" title="Редактировать" onclick="openEdit('${item.id}')">✎</button>
          <button class="card-btn delete-btn" title="Удалить" onclick="deleteItem('${item.id}')">✕</button>
        </div>
      </div>
      ${item.category && currentTab === 'notes' ? `<div class="card-category">🏷 ${escHtml(item.category)}</div>` : ''}
      ${item.link && currentTab === 'notes' ? `<a class="card-link" href="${escHtml(item.link)}" target="_blank" rel="noopener noreferrer">🔗 ${escHtml(item.link)}</a>` : ''}
      ${item.lifeAreas?.length ? `<div class="life-area-tags">${item.lifeAreas.map(a => `<span class="life-area-tag">${escHtml(a)}</span>`).join('')}</div>` : ''}
      ${(currentTab === 'goals' || currentTab === 'zadachi') ? `
        <div class="goal-meta">
          ${item.status ? `<span class="status-badge ${item.status}">${STATUS_LABELS[item.status]}</span>` : ''}
          ${item.startDate ? `<span class="meta-date">🚀 ${formatDateShort(item.startDate)}</span>` : ''}
          ${item.dueDate ? `<span class="meta-date">📅 ${formatDateShort(item.dueDate)}</span>` : ''}
        </div>
        ${item.metric ? `<div class="metric">🎯 ${escHtml(item.metric)}</div>` : ''}
      ` : ''}
      ${item.dueDate && currentTab !== 'goals' && currentTab !== 'zadachi' ? `<div class="due-date">📅 ${formatDateShort(item.dueDate)}</div>` : ''}
      ${item.desc ? `<div class="card-desc">${escHtml(item.desc)}</div>` : ''}
      <div class="card-footer">
        <span class="card-date">${formatDate(item.createdAt)}</span>
        <span class="priority-badge ${item.priority}">${priorityLabel(item.priority)}</span>
      </div>
    </div>
  `).join('');
}

async function addQuickTask(title) {
  const data = loadData();
  if (!data.tasks) data.tasks = [];
  data.tasks.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    desc: '',
    priority: 'normal',
    done: false,
    createdAt: Date.now()
  });
  renderTasksList();
  await saveData(data);
}

async function toggleTaskCheck(id, checked) {
  const data = loadData();
  const items = data.tasks || [];
  const item = items.find(i => i.id === id);
  if (!item) return;
  item.done = checked;
  if (checked) item.doneAt = Date.now();
  renderTasksList();
  await saveData(data);
}

function renderTasksList() {
  const filter = (document.getElementById('search-input')?.value || '').toLowerCase();
  let items = getItems('tasks');
  if (filter) {
    items = items.filter(i => i.title.toLowerCase().includes(filter));
  }
  const listEl = document.querySelector('.tasks-list');
  if (!listEl) return;
  listEl.innerHTML = items.map(item => `
    <label class="tasks-item ${item.done ? 'is-checked' : ''}" data-id="${item.id}">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskCheck('${item.id}', this.checked)" />
      <span class="tasks-item-text">${escHtml(item.title)}</span>
      <button class="tasks-item-del" onclick="event.preventDefault();deleteTaskItem('${item.id}')" title="Удалить">✕</button>
    </label>
  `).join('');
  document.getElementById('total-count').textContent = `${totalCount()} записей`;
}

async function deleteTaskItem(id) {
  const data = loadData();
  data.tasks = (data.tasks || []).filter(i => i.id !== id);
  renderTasksList();
  await saveData(data);
}

function formatDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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
  document.getElementById('modal-title').textContent = currentTab === 'goals' ? 'Редактировать цель' : currentTab === 'zadachi' ? 'Редактировать задачу' : currentTab === 'tasks' ? 'Редактировать дело' : 'Редактировать';
  document.getElementById('input-title').value = item.title;
  document.getElementById('input-desc').value = item.desc || '';
  document.getElementById('input-category').value = item.category || '';
  document.getElementById('input-due-date').value = item.dueDate || '';
  document.getElementById('input-start-date').value = item.startDate || '';
  document.getElementById('input-metric').value = item.metric || '';
  document.getElementById('input-link').value = item.link || '';
  setActiveStatus(item.status || 'not_started');
  updateLifeAreaSelect();
  Array.from(document.getElementById('input-life-area').options).forEach(o => {
    o.selected = (item.lifeAreas || []).includes(o.value);
  });
  setActivePriority(item.priority || 'normal');
  openModal();
}

// ===== MODAL =====
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  const isNotes = currentTab === 'notes';
  const isGoals = currentTab === 'goals';
  const isZadachi = currentTab === 'zadachi';
  const isTasks = currentTab === 'tasks';
  document.querySelector('.priority-btns').style.display = isNotes ? 'none' : '';
  document.getElementById('priority-label').style.display = isNotes ? 'none' : '';
  document.getElementById('status-btns').style.display = (isGoals || isZadachi) ? '' : 'none';
  document.getElementById('status-label').style.display = (isGoals || isZadachi) ? '' : 'none';
  document.getElementById('input-start-date').style.display = isGoals ? '' : 'none';
  document.getElementById('input-start-date').previousElementSibling.style.display = isGoals ? '' : 'none';
  document.getElementById('input-metric').style.display = isGoals ? '' : 'none';
  document.getElementById('input-metric').previousElementSibling.style.display = isGoals ? '' : 'none';
  // Срок: скрываем для заметок
  document.getElementById('input-due-date').style.display = isNotes ? 'none' : '';
  document.getElementById('due-date-label').style.display = isNotes ? 'none' : '';
  // Ссылка: только для заметок
  document.getElementById('input-link').style.display = isNotes ? '' : 'none';
  document.getElementById('link-label').style.display = isNotes ? '' : 'none';
  // Сфера жизни: только для целей
  const lifeAreaWrap = document.querySelector('.life-areas-wrap');
  lifeAreaWrap.style.display = isGoals ? '' : 'none';
  lifeAreaWrap.previousElementSibling.style.display = isGoals ? '' : 'none';
  updateLifeAreaSelect();
  setActiveStatus('not_started');
  if (isGoals) {
    const nextNumber = getItems('goals').length + 1;
    document.getElementById('modal-title').textContent = `Цель №${nextNumber}`;
  } else if (isZadachi) {
    document.getElementById('modal-title').textContent = 'Новая задача';
  } else if (isTasks) {
    document.getElementById('modal-title').textContent = 'Новое дело';
  } else {
    document.getElementById('modal-title').textContent = 'Новая запись';
  }
  document.getElementById('input-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('input-title').value = '';
  document.getElementById('input-desc').value = '';
  document.getElementById('input-category').value = '';
  document.getElementById('input-due-date').value = '';
  document.getElementById('input-start-date').value = '';
  document.getElementById('input-metric').value = '';
  document.getElementById('input-link').value = '';
  document.getElementById('input-life-area').selectedIndex = -1;
  setActivePriority('normal');
  setActiveStatus('not_started');
  editingId = null;
  document.getElementById('modal-title').textContent = 'Новая запись';
}

function setActivePriority(p) {
  selectedPriority = p;
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === p);
  });
}

function setActiveStatus(s) {
  selectedStatus = s;
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === s);
  });
}

const STATUS_LABELS = {
  not_started: 'Не начато',
  in_progress: 'В процессе',
  paused: 'Пауза',
  done: 'Выполнено',
};

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
  const dueDate = document.getElementById('input-due-date').value;
  const startDate = document.getElementById('input-start-date').value;
  const metric = document.getElementById('input-metric').value.trim();
  const link = document.getElementById('input-link').value.trim();
  const lifeAreas = Array.from(document.getElementById('input-life-area').selectedOptions)
    .map(o => o.value).filter(Boolean);
  let items = getItems(currentTab);

  if (editingId) {
    items = items.map(i => i.id === editingId ? { ...i, title, desc, category, priority: selectedPriority, dueDate, startDate, status: selectedStatus, metric, link, lifeAreas } : i);
  } else {
    items.unshift({
      id: Date.now().toString(),
      title,
      desc,
      category,
      priority: selectedPriority,
      dueDate,
      startDate,
      status: selectedStatus,
      metric,
      link,
      lifeAreas,
      pageId: currentTab === 'plans' ? currentPlanPageId : undefined,
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
    initDumpEditor();
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
  const isTasks = tab === 'tasks';
  document.querySelector('.category-filter-wrap').style.display = isNotes ? '' : 'none';
  document.getElementById('open-modal').style.display = isTasks ? 'none' : '';

  const plansNav = document.getElementById('plans-nav');
  if (tab === 'plans') {
    currentPlanPageId = null;
    plansNav.classList.remove('hidden');
    renderPlansNav();
  } else {
    plansNav.classList.add('hidden');
  }

  renderItems();
}

// ===== PLANS NAVIGATION =====
const PLAN_TYPE_LABELS = { month: 'месяц', week: 'неделя', day: 'день' };

function selectPlanPage(id) {
  currentPlanPageId = id;
  renderPlansNav();
  renderItems(document.getElementById('search-input').value);
}

function renderPlansNav() {
  const nav = document.getElementById('plans-nav');
  if (!nav) return;

  const crumbs = planPageBreadcrumb(currentPlanPageId);
  const current = currentPlanPageId ? getPlanPage(currentPlanPageId) : null;
  const children = planPageChildren(currentPlanPageId);

  // Хлебные крошки
  const breadcrumbHtml = `
    <div class="plans-breadcrumb">
      <button class="crumb ${!currentPlanPageId ? 'active' : ''}" onclick="selectPlanPage(null)">📋 Планы</button>
      ${crumbs.map(c => `<span class="crumb-sep">›</span><button class="crumb ${c.id === currentPlanPageId ? 'active' : ''}" onclick="selectPlanPage('${c.id}')">${escHtml(c.title)}</button>`).join('')}
    </div>`;

  // Кнопки действий по уровню
  let actionsHtml = '';
  if (!current) {
    actionsHtml = `
      <button class="plans-action" onclick="onGenerateMonths()">📅 Сформировать год по месяцам</button>
      <button class="plans-action ghost" onclick="onAddPlanPage('month', null)">+ Месяц</button>`;
  } else if (current.type === 'month') {
    actionsHtml = `
      <button class="plans-action" onclick="onGenerateWeeks('${current.id}')">🗓 Сформировать недели</button>
      <button class="plans-action ghost" onclick="onAddPlanPage('week', '${current.id}')">+ Неделя</button>`;
  } else if (current.type === 'week') {
    actionsHtml = `
      <button class="plans-action" onclick="onGenerateDays('${current.id}')">📆 Сформировать дни</button>
      <button class="plans-action ghost" onclick="onAddPlanPage('day', '${current.id}')">+ День</button>`;
  }

  // Чипы дочерних страниц
  const childTypeLabel = children.length ? PLAN_TYPE_LABELS[children[0].type] : '';
  const chipsHtml = children.length ? `
    <div class="plans-chips">
      ${children.map(c => `
        <div class="plan-chip" onclick="selectPlanPage('${c.id}')">
          <span class="plan-chip-title">${escHtml(c.title)}</span>
          <button class="plan-chip-btn" title="Переименовать" onclick="event.stopPropagation(); onRenamePlanPage('${c.id}')">✎</button>
          <button class="plan-chip-btn delete" title="Удалить" onclick="event.stopPropagation(); onDeletePlanPage('${c.id}')">✕</button>
        </div>
      `).join('')}
    </div>` : '';

  nav.innerHTML = `
    ${breadcrumbHtml}
    <div class="plans-toolbar">${actionsHtml}</div>
    ${chipsHtml}
  `;
}

async function onGenerateMonths() {
  await generateYearMonths();
  renderPlansNav();
  renderItems(document.getElementById('search-input').value);
}

async function onGenerateWeeks(monthId) {
  await generateMonthWeeks(monthId);
  renderPlansNav();
  renderItems(document.getElementById('search-input').value);
}

async function onGenerateDays(weekId) {
  await generateWeekDays(weekId);
  renderPlansNav();
  renderItems(document.getElementById('search-input').value);
}

async function onAddPlanPage(type, parentId) {
  const label = PLAN_TYPE_LABELS[type];
  const title = prompt(`Название (${label}):`, '');
  if (title === null) return;
  const name = title.trim();
  if (!name) return;
  await addPlanPage(type, parentId, name);
  renderPlansNav();
}

async function onRenamePlanPage(id) {
  const page = getPlanPage(id);
  if (!page) return;
  const title = prompt('Новое название:', page.title);
  if (title === null) return;
  const name = title.trim();
  if (!name) return;
  await renamePlanPage(id, name);
  renderPlansNav();
  renderItems(document.getElementById('search-input').value);
}

async function onDeletePlanPage(id) {
  const page = getPlanPage(id);
  if (!page) return;
  if (!confirm(`Удалить «${page.title}» и все вложенные странички и записи?`)) return;
  await deletePlanPage(id);
  if (currentPlanPageId === id) currentPlanPageId = page.parentId || null;
  renderPlansNav();
  renderItems(document.getElementById('search-input').value);
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

document.querySelectorAll('.status-btn').forEach(btn => {
  btn.addEventListener('click', () => setActiveStatus(btn.dataset.status));
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
  initDumpEditor();
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
const DUMP_DRAFT_KEY = 'dashboard_dump_draft';

function loadDumpItems() {
  return _cache[DUMP_KEY] || [];
}
async function saveDumpItems(items) {
  _cache[DUMP_KEY] = items;
  const setter = window.storageSet || ((k, v) => { localStorage.setItem(k, JSON.stringify(v)); return Promise.resolve(); });
  await setter(DUMP_KEY, items);
}

function getDumpText() {
  const text = document.getElementById('dump-textarea').value || '';
  return text.split('\n').map(l => l.trim()).filter(Boolean);
}

function setDumpEditor(text) {
  const el = document.getElementById('dump-textarea');
  el.value = text || '';
  updateDumpLineNumbers();
}

function updateDumpLineNumbers() {
  const ta = document.getElementById('dump-textarea');
  const nums = document.getElementById('dump-line-numbers');
  if (!ta || !nums) return;
  const count = Math.max(1, (ta.value || '').split('\n').length);
  nums.innerHTML = Array.from({ length: count }, (_, i) => `<div>${i + 1}.</div>`).join('');
  autoGrowDump();
}

function autoGrowDump() {
  const ta = document.getElementById('dump-textarea');
  const nums = document.getElementById('dump-line-numbers');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  if (nums) nums.style.height = ta.style.height;
}

function showDumpToast(msg) {
  const toast = document.getElementById('dump-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2000);
}

async function parseDump() {
  const lines = getDumpText();
  if (!lines.length) {
    showDumpToast('Введите текст');
    return;
  }

  const existing = loadDumpItems();
  const newItems = lines.map(line => ({
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    text: line,
    done: false,
  }));
  const all = [...existing, ...newItems];

  // 1) Сразу обновляем интерфейс (синхронно)
  _cache[DUMP_KEY] = all;
  document.getElementById('dump-textarea').value = '';
  updateDumpLineNumbers();
  renderDump();
  showDumpToast(`Добавлено ${newItems.length} пунктов`);

  // 2) Затем сохраняем в хранилище (асинхронно)
  try {
    await saveDumpItems(all);
    await saveDraft('');
  } catch (e) {
    console.error('Ошибка сохранения выгрузки', e);
  }
}

async function saveDraft(text) {
  const setter = window.storageSet || ((k, v) => { localStorage.setItem(k, JSON.stringify(v)); return Promise.resolve(); });
  await setter(DUMP_DRAFT_KEY, text);
}

async function loadDraft() {
  const getter = window.storageGet || ((k) => Promise.resolve(JSON.parse(localStorage.getItem(k))));
  return (await getter(DUMP_DRAFT_KEY)) || '';
}

function initDumpEditor() {
  const el = document.getElementById('dump-textarea');
  if (!el) return;
  loadDraft().then(text => {
    el.value = (text && text.trim()) ? text : '';
    updateDumpLineNumbers();
  });
}

function renderDump() {
  const col = document.getElementById('dump-items-col');
  const items = loadDumpItems();

  if (!items.length) {
    col.innerHTML = '<div class="dump-empty-hint">Список пуст</div>';
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
          <div class="dump-item-number">${idx + 1}.</div>
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
  const filtered = loadDumpItems().filter(i => i.id !== id);
  _cache[DUMP_KEY] = filtered;
  renderDump();
  try {
    await saveDumpItems(filtered);
  } catch (e) {
    console.error('Ошибка удаления пункта', e);
  }
}

async function doClearDump() {
  _cache[DUMP_KEY] = [];
  renderDump();
  showDumpToast('Список очищен');
  try {
    await saveDumpItems([]);
  } catch (e) {
    console.error('Ошибка очистки выгрузки', e);
  }
}

function clearDump() {
  const tg = window.Telegram?.WebApp;
  if (tg?.showConfirm) {
    tg.showConfirm('Очистить весь список выгрузки?', (ok) => {
      if (ok) doClearDump();
    });
  } else if (confirm('Очистить весь список выгрузки?')) {
    doClearDump();
  }
}

document.getElementById('dump-parse-btn').addEventListener('click', async () => {
  await parseDump();
});

document.getElementById('dump-textarea').addEventListener('input', () => {
  saveDraft(document.getElementById('dump-textarea').value);
  updateDumpLineNumbers();
});

document.getElementById('dump-textarea').addEventListener('scroll', () => {
  const ta = document.getElementById('dump-textarea');
  const nums = document.getElementById('dump-line-numbers');
  if (nums) nums.scrollTop = ta.scrollTop;
});

document.getElementById('dump-textarea').addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    document.getElementById('dump-parse-btn').click();
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

document.getElementById('open-life-area-manager').addEventListener('click', openLifeAreaManager);
document.getElementById('life-area-manager-close').addEventListener('click', closeLifeAreaManager);
document.getElementById('life-area-manager-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeLifeAreaManager();
});
document.getElementById('life-area-add-btn').addEventListener('click', addLifeArea);
document.getElementById('life-area-new-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addLifeArea();
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
