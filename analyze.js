// ===== VAULT ANALYZER =====

const STOP_WORDS = new Set([
  'и','в','на','с','по','для','что','это','как','из','от','до','не','но','а','к','о','за','же',
  'то','или','так','был','быть','все','при','уже','если','он','она','они','мы','вы','я','его','её',
  'их','нас','вас','меня','мне','мой','моя','мои','свой','своя','свои','этот','эта','эти','тот',
  'та','те','такой','такая','такие','который','которая','которые','когда','где','там','тут','здесь',
  'очень','более','менее','можно','нужно','надо','есть','нет','да','бы','ли','же','ведь','даже',
  'просто','только','ещё','еще','чтобы','потому','что','также','тоже','этом','этого','него','её',
  'ним','них','им','ней','ему','ей','под','над','без','через','после','перед','во','со','об','про'
]);

const CATEGORY_KEYWORDS = {
  '💡 Идеи': ['идея','идеи','придумал','хочу','мечта','концепция','план','замысел','хотел','хотелось','бы','предлагаю'],
  '🎯 Цели': ['цель','цели','достичь','достигнуть','хочу','буду','планирую','стремлюсь','мечтаю','к','стать','получить'],
  '📚 Обучение': ['учиться','изучить','курс','книга','книги','читать','прочитал','урок','лекция','знания','обучение','навык'],
  '💼 Работа': ['работа','проект','задача','клиент','деньги','зарплата','бизнес','компания','встреча','дедлайн','карьера'],
  '🏃 Здоровье': ['здоровье','спорт','тренировка','бег','питание','диета','сон','отдых','врач','вес','физическая'],
  '💰 Финансы': ['деньги','бюджет','расходы','доходы','инвестиции','накопления','кредит','долг','финансы','копить'],
  '🧠 Саморазвитие': ['развитие','рост','привычка','дисциплина','мотивация','медитация','осознанность','психология'],
  '🌍 Путешествия': ['путешествие','поездка','страна','город','отпуск','виза','билеты','маршрут','тур','поехать'],
  '👥 Люди': ['друг','семья','отношения','общение','знакомый','коллега','партнёр','команда','люди','встреча'],
  '✅ Задачи': ['сделать','выполнить','закончить','завершить','начать','напомни','todo','нужно','важно','срочно'],
};

document.getElementById('obs-analyze').addEventListener('click', () => {
  if (!getVaultHandle()) return;
  openAnalyzeModal();
});

document.getElementById('analyze-modal-close').addEventListener('click', closeAnalyzeModal);
document.getElementById('analyze-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAnalyzeModal();
});

function openAnalyzeModal() {
  const overlay = document.getElementById('analyze-modal-overlay');
  const body = document.getElementById('analyze-body');
  body.innerHTML = '<div class="analyze-loading"><span class="analyze-spinner"></span> Читаю заметки...</div>';
  overlay.classList.remove('hidden');
  setTimeout(() => runAnalysis(), 80);
}

function closeAnalyzeModal() {
  document.getElementById('analyze-modal-overlay').classList.add('hidden');
}

async function runAnalysis() {
  const body = document.getElementById('analyze-body');
  try {
    const notes = await collectAllNotes(getVaultHandle());
    if (notes.length === 0) {
      body.innerHTML = '<div class="analyze-empty">Заметок не найдено. Добавь хотя бы одну .md заметку.</div>';
      return;
    }
    const result = analyzeNotes(notes);
    body.innerHTML = renderAnalysis(result, notes);
  } catch (e) {
    body.innerHTML = `<div class="analyze-empty">Ошибка анализа: ${e.message}</div>`;
  }
}

// ===== COLLECT ALL .md FILES RECURSIVELY =====
async function collectAllNotes(dirHandle, path = '') {
  const notes = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue;
    if (handle.kind === 'directory') {
      const sub = await collectAllNotes(handle, path + name + '/');
      notes.push(...sub);
    } else if (name.endsWith('.md')) {
      const file = await handle.getFile();
      const content = await file.text();
      notes.push({ name: name.replace('.md', ''), path: path + name, content, size: file.size, modified: file.lastModified });
    }
  }
  return notes;
}

// ===== CORE ANALYSIS =====
function analyzeNotes(notes) {
  const wordFreq = {};
  const tagFreq = {};
  const categories = {};
  const links = [];
  let totalWords = 0;

  for (const note of notes) {
    const text = note.content.toLowerCase();

    // Теги (#тег)
    const tagMatches = note.content.match(/#[\wа-яё]+/gi) || [];
    tagMatches.forEach(t => {
      const tag = t.toLowerCase();
      tagFreq[tag] = (tagFreq[tag] || 0) + 1;
    });

    // Внутренние ссылки [[заметка]]
    const linkMatches = note.content.match(/\[\[([^\]]+)\]\]/g) || [];
    linkMatches.forEach(l => {
      const target = l.replace(/\[\[|\]\]/g, '').split('|')[0].trim();
      links.push({ from: note.name, to: target });
    });

    // Частота слов
    const words = text.replace(/[^а-яёa-z\s]/gi, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
    totalWords += words.length;
    words.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });

    // Категории
    const matched = [];
    for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = kws.filter(kw => text.includes(kw)).length;
      if (score > 0) matched.push({ cat, score });
    }
    matched.sort((a, b) => b.score - a.score);
    if (matched.length > 0) {
      const cat = matched[0].cat;
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(note.name);
    } else {
      if (!categories['📁 Разное']) categories['📁 Разное'] = [];
      categories['📁 Разное'].push(note.name);
    }
  }

  // Топ слов
  const topWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  // Топ тегов
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  // Самые связанные заметки
  const linkCount = {};
  links.forEach(l => { linkCount[l.from] = (linkCount[l.from] || 0) + 1; });
  const mostLinked = Object.entries(linkCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Недавно изменённые
  const recent = [...notes].sort((a, b) => b.modified - a.modified).slice(0, 5);

  // Самые большие заметки
  const biggest = [...notes].sort((a, b) => b.size - a.size).slice(0, 5);

  // Предложение структуры папок
  const suggestedStructure = Object.keys(categories)
    .filter(c => categories[c].length > 0)
    .sort((a, b) => categories[b].length - categories[a].length);

  return { categories, topWords, topTags, mostLinked, recent, biggest, suggestedStructure, totalWords, links };
}

// ===== RENDER RESULTS =====
function renderAnalysis(r, notes) {
  const totalNotes = notes.length;
  const totalLinks = r.links.length;
  const totalTags = Object.keys({}).length;
  const catCount = Object.keys(r.categories).length;

  return `
    <div class="analyze-content">

      <!-- STATS -->
      <div class="analyze-stats">
        <div class="analyze-stat">
          <span class="analyze-stat-num">${totalNotes}</span>
          <span class="analyze-stat-label">заметок</span>
        </div>
        <div class="analyze-stat">
          <span class="analyze-stat-num">${r.totalWords.toLocaleString('ru')}</span>
          <span class="analyze-stat-label">слов всего</span>
        </div>
        <div class="analyze-stat">
          <span class="analyze-stat-num">${totalLinks}</span>
          <span class="analyze-stat-label">связей</span>
        </div>
        <div class="analyze-stat">
          <span class="analyze-stat-num">${catCount}</span>
          <span class="analyze-stat-label">категорий</span>
        </div>
      </div>

      <!-- SUGGESTED STRUCTURE -->
      <div class="analyze-section">
        <div class="analyze-section-title">📂 Предложенная структура папок</div>
        <div class="analyze-hint">На основе содержимого заметок — рекомендую организовать vault так:</div>
        <div class="analyze-structure">
          ${r.suggestedStructure.map(cat => `
            <div class="analyze-folder">
              <div class="analyze-folder-header">
                <span>${cat}</span>
                <span class="analyze-folder-count">${r.categories[cat].length} заметок</span>
              </div>
              <div class="analyze-folder-notes">
                ${r.categories[cat].slice(0, 6).map(n => `<span class="analyze-note-chip">📄 ${escA(n)}</span>`).join('')}
                ${r.categories[cat].length > 6 ? `<span class="analyze-note-chip muted">+${r.categories[cat].length - 6} ещё</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- TOP WORDS -->
      <div class="analyze-section">
        <div class="analyze-section-title">🔤 Ключевые темы (по частоте слов)</div>
        <div class="analyze-words">
          ${r.topWords.map((w, i) => {
            const maxCount = r.topWords[0].count;
            const pct = Math.round((w.count / maxCount) * 100);
            const size = 0.78 + (pct / 100) * 0.6;
            const opacity = 0.5 + (pct / 100) * 0.5;
            return `<span class="analyze-word" style="font-size:${size.toFixed(2)}rem;opacity:${opacity.toFixed(2)}" title="${w.count} упоминаний">${escA(w.word)}</span>`;
          }).join('')}
        </div>
      </div>

      <!-- TAGS -->
      ${r.topTags.length > 0 ? `
      <div class="analyze-section">
        <div class="analyze-section-title">🏷️ Популярные теги</div>
        <div class="analyze-tags">
          ${r.topTags.map(t => `
            <span class="analyze-tag">${escA(t.tag)} <span class="analyze-tag-count">${t.count}</span></span>
          `).join('')}
        </div>
      </div>` : ''}

      <!-- RECENT -->
      <div class="analyze-two-col">
        <div class="analyze-section">
          <div class="analyze-section-title">🕐 Недавно изменены</div>
          <div class="analyze-list">
            ${r.recent.map(n => `
              <div class="analyze-list-item">
                <span>📄 ${escA(n.name)}</span>
                <span class="analyze-list-meta">${new Date(n.modified).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="analyze-section">
          <div class="analyze-section-title">📏 Самые большие</div>
          <div class="analyze-list">
            ${r.biggest.map(n => `
              <div class="analyze-list-item">
                <span>📄 ${escA(n.name)}</span>
                <span class="analyze-list-meta">${(n.size / 1024).toFixed(1)} КБ</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- MOST LINKED -->
      ${r.mostLinked.length > 0 ? `
      <div class="analyze-section">
        <div class="analyze-section-title">🔗 Самые связанные заметки</div>
        <div class="analyze-list">
          ${r.mostLinked.map(([name, count]) => `
            <div class="analyze-list-item">
              <span>📄 ${escA(name)}</span>
              <span class="analyze-list-meta">${count} ссылок</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

    </div>
  `;
}

function escA(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
