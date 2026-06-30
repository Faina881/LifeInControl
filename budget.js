// ===== BUDGET MODULE =====
const BUDGET_KEY = 'dashboard_budget';

function loadBudget() {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    return raw ? JSON.parse(raw) : { startDay: 1, income: 0, categories: [], transactions: [] };
  } catch { return { startDay: 1, income: 0, categories: [], transactions: [] }; }
}

function saveBudget(data) {
  localStorage.setItem(BUDGET_KEY, JSON.stringify(data));
  if (window.storageSet) window.storageSet(BUDGET_KEY, data);
}

// ===== PERIOD HELPERS =====
function getBudgetPeriod(startDay) {
  const now = new Date();
  const day = now.getDate();
  let periodStart, periodEnd;
  if (day >= startDay) {
    periodStart = new Date(now.getFullYear(), now.getMonth(), startDay);
    periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, startDay - 1);
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth() - 1, startDay);
    periodEnd   = new Date(now.getFullYear(), now.getMonth(), startDay - 1);
  }
  return { periodStart, periodEnd };
}

function fmtBudgetDate(d) {
  return d.getDate().toString().padStart(2,'0') + '.' + (d.getMonth()+1).toString().padStart(2,'0') + '.' + d.getFullYear();
}

function inPeriod(dateStr, periodStart, periodEnd) {
  const d = new Date(dateStr);
  return d >= periodStart && d <= periodEnd;
}

function fmt(n) {
  return Number(n).toLocaleString('ru-RU');
}

// ===== INIT =====
function initBudgetPanel() {
  // Заполнить select дней
  const sel = document.getElementById('budget-start-day');
  if (sel && !sel.options.length) {
    for (let i = 1; i <= 31; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i + ' число';
      sel.appendChild(opt);
    }
  }

  const data = loadBudget();
  if (sel) sel.value = data.startDay;
  const incEl = document.getElementById('budget-income');
  if (incEl) incEl.value = data.income || '';

  renderBudgetPeriodLabel(data.startDay);
  renderBudgetSummary(data);
  renderBudgetCatList(data);
  renderBudgetTxCatSelect(data);
  renderBudgetTxList(data);
}

// ===== SETTERS =====
window.budgetSetStartDay = function(val) {
  const data = loadBudget();
  data.startDay = parseInt(val) || 1;
  saveBudget(data);
  renderBudgetPeriodLabel(data.startDay);
  renderBudgetSummary(data);
  renderBudgetCatList(data);
  renderBudgetTxList(data);
};

window.budgetSetIncome = function(val) {
  const data = loadBudget();
  data.income = parseFloat(val) || 0;
  saveBudget(data);
  renderBudgetSummary(data);
};

// ===== CATEGORIES =====
window.budgetAddCategory = function() {
  const nameEl  = document.getElementById('budget-new-cat');
  const limitEl = document.getElementById('budget-new-limit');
  const name  = nameEl?.value.trim();
  const limit = parseFloat(limitEl?.value) || 0;
  if (!name) { nameEl?.focus(); return; }
  const data = loadBudget();
  data.categories.push({ id: Date.now().toString(36), name, limit });
  saveBudget(data);
  nameEl.value = '';
  limitEl.value = '';
  renderBudgetCatList(data);
  renderBudgetTxCatSelect(data);
  renderBudgetSummary(data);
};

window.budgetDeleteCategory = function(id) {
  const data = loadBudget();
  data.categories = data.categories.filter(c => c.id !== id);
  data.transactions = data.transactions.filter(t => t.catId !== id);
  saveBudget(data);
  renderBudgetCatList(data);
  renderBudgetTxCatSelect(data);
  renderBudgetSummary(data);
  renderBudgetTxList(data);
};

window.budgetUpdateLimit = function(id, val) {
  const data = loadBudget();
  const cat = data.categories.find(c => c.id === id);
  if (cat) cat.limit = parseFloat(val) || 0;
  saveBudget(data);
  renderBudgetCatList(data);
  renderBudgetSummary(data);
};

window.budgetUpdateCatName = function(id, val) {
  const data = loadBudget();
  const cat = data.categories.find(c => c.id === id);
  if (cat) cat.name = val;
  saveBudget(data);
  renderBudgetTxCatSelect(data);
};

// ===== TRANSACTIONS =====
window.budgetAddTransaction = function() {
  const catEl    = document.getElementById('budget-tx-cat');
  const descEl   = document.getElementById('budget-tx-desc');
  const amountEl = document.getElementById('budget-tx-amount');
  const catId  = catEl?.value;
  const desc   = descEl?.value.trim();
  const amount = parseFloat(amountEl?.value) || 0;
  if (!catId || amount <= 0) return;
  const data = loadBudget();
  data.transactions.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    catId,
    desc,
    amount,
    date: new Date().toISOString().slice(0,10)
  });
  saveBudget(data);
  descEl.value = '';
  amountEl.value = '';
  renderBudgetCatList(data);
  renderBudgetSummary(data);
  renderBudgetTxList(data);
};

window.budgetDeleteTransaction = function(id) {
  const data = loadBudget();
  data.transactions = data.transactions.filter(t => t.id !== id);
  saveBudget(data);
  renderBudgetCatList(data);
  renderBudgetSummary(data);
  renderBudgetTxList(data);
};

// ===== RENDER =====
function renderBudgetPeriodLabel(startDay) {
  const el = document.getElementById('budget-period-label');
  if (!el) return;
  const { periodStart, periodEnd } = getBudgetPeriod(startDay);
  el.textContent = fmtBudgetDate(periodStart) + ' — ' + fmtBudgetDate(periodEnd);
}

function getSpentByPeriod(data, catId) {
  const { periodStart, periodEnd } = getBudgetPeriod(data.startDay);
  return data.transactions
    .filter(t => t.catId === catId && inPeriod(t.date, periodStart, periodEnd))
    .reduce((s, t) => s + t.amount, 0);
}

function renderBudgetSummary(data) {
  const el = document.getElementById('budget-summary');
  if (!el) return;
  const { periodStart, periodEnd } = getBudgetPeriod(data.startDay);
  const totalSpent = data.transactions
    .filter(t => inPeriod(t.date, periodStart, periodEnd))
    .reduce((s, t) => s + t.amount, 0);
  const totalLimit = data.categories.reduce((s, c) => s + (c.limit || 0), 0);
  const income = data.income || 0;
  const free = income - totalSpent;
  const pct = income > 0 ? Math.min(100, Math.round(totalSpent / income * 100)) : 0;
  const cls = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';

  el.innerHTML = `
    <div class="bsum-card">
      <div class="bsum-label">Доход</div>
      <div class="bsum-value">${fmt(income)} ₽</div>
    </div>
    <div class="bsum-card">
      <div class="bsum-label">Потрачено</div>
      <div class="bsum-value ${cls}">${fmt(totalSpent)} ₽</div>
    </div>
    <div class="bsum-card">
      <div class="bsum-label">Свободно</div>
      <div class="bsum-value ${free < 0 ? 'danger' : ''}">${fmt(free)} ₽</div>
    </div>
    <div class="bsum-card">
      <div class="bsum-label">Лимиты</div>
      <div class="bsum-value">${fmt(totalLimit)} ₽</div>
    </div>
    <div class="bsum-bar-wrap">
      <div class="bsum-bar">
        <div class="bsum-bar-fill ${cls}" style="width:${pct}%"></div>
      </div>
      <span class="bsum-pct">${pct}%</span>
    </div>
  `;
}

function renderBudgetCatList(data) {
  const el = document.getElementById('budget-cat-list');
  if (!el) return;
  if (!data.categories.length) {
    el.innerHTML = '<div class="budget-empty">Добавь первую статью расходов</div>';
    return;
  }
  el.innerHTML = data.categories.map(cat => {
    const spent = getSpentByPeriod(data, cat.id);
    const limit = cat.limit || 0;
    const rest  = limit - spent;
    const pct   = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
    const cls   = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
    return `
    <div class="budget-cat-row" data-id="${cat.id}">
      <input class="budget-cat-name-input" value="${escHtml(cat.name)}"
        onchange="budgetUpdateCatName('${cat.id}', this.value)"
        onblur="budgetUpdateCatName('${cat.id}', this.value)" />
      <div class="budget-cat-limit-cell">
        <input type="number" class="budget-cat-limit-input" value="${limit || ''}"
          placeholder="0" onchange="budgetUpdateLimit('${cat.id}', this.value)" />
        <span class="budget-currency">₽</span>
      </div>
      <div class="budget-cat-spent ${cls}">${fmt(spent)} ₽</div>
      <div class="budget-cat-rest ${rest < 0 ? 'danger' : ''}">${fmt(rest)} ₽</div>
      <div class="budget-cat-bar-wrap">
        <div class="budget-cat-bar"><div class="budget-cat-bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>
      <button class="budget-del-btn" onclick="budgetDeleteCategory('${cat.id}')" title="Удалить">✕</button>
    </div>`;
  }).join('');
}

function renderBudgetTxCatSelect(data) {
  const el = document.getElementById('budget-tx-cat');
  if (!el) return;
  const val = el.value;
  el.innerHTML = data.categories.length
    ? data.categories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')
    : '<option value="">— нет статей —</option>';
  if (val) el.value = val;
}

function renderBudgetTxList(data) {
  const el = document.getElementById('budget-tx-list');
  if (!el) return;
  const { periodStart, periodEnd } = getBudgetPeriod(data.startDay);
  const txs = data.transactions.filter(t => inPeriod(t.date, periodStart, periodEnd));
  if (!txs.length) {
    el.innerHTML = '<div class="budget-empty">Расходов за период нет</div>';
    return;
  }
  const catMap = Object.fromEntries(data.categories.map(c => [c.id, c.name]));
  el.innerHTML = txs.map(t => `
    <div class="budget-tx-row">
      <span class="budget-tx-date">${t.date.slice(8,10)}.${t.date.slice(5,7)}</span>
      <span class="budget-tx-cat-name">${escHtml(catMap[t.catId] || '—')}</span>
      <span class="budget-tx-desc">${escHtml(t.desc || '')}</span>
      <span class="budget-tx-amount">${fmt(t.amount)} ₽</span>
      <button class="budget-del-btn" onclick="budgetDeleteTransaction('${t.id}')" title="Удалить">✕</button>
    </div>
  `).join('');
}

// ===== EXPOSE INIT =====
window.initBudgetPanel = initBudgetPanel;
