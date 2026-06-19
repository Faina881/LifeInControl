// ===== OBSIDIAN INTEGRATION =====
// Uses File System Access API (Chrome/Edge only)

let vaultHandle = null;
let vaultName = '';

function getVaultHandle() { return vaultHandle; }

const obsPanel      = document.getElementById('obsidian-panel');
const obsBrowser    = document.getElementById('obs-browser');
const obsVaultName  = document.getElementById('obs-vault-name');
const obsNewNoteBtn = document.getElementById('obs-new-note');
const obsModalOverlay = document.getElementById('obs-modal-overlay');

function closeObsidianTab() {
  obsPanel.classList.add('hidden');
  document.querySelector('.main').style.display = '';
}

// ===== CONNECT VAULT =====
async function connectVault() {
  if (!('showDirectoryPicker' in window)) {
    alert('Твой браузер не поддерживает File System Access API.\nИспользуй Chrome или Edge.');
    return;
  }
  try {
    vaultHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    vaultName = vaultHandle.name;
    obsVaultName.textContent = '🟣 ' + vaultName;
    obsNewNoteBtn.classList.remove('hidden');
    document.getElementById('obs-analyze').classList.remove('hidden');
    await renderVault();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

document.getElementById('obs-connect').addEventListener('click', connectVault);
document.getElementById('obs-connect-big').addEventListener('click', connectVault);

// ===== RENDER VAULT TREE =====
async function renderVault() {
  obsBrowser.innerHTML = '<div class="obs-folder-tree" id="obs-tree"></div>';
  const tree = document.getElementById('obs-tree');
  await renderDir(vaultHandle, tree, 0);
}

async function renderDir(dirHandle, container, depth) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue;
    entries.push({ name, handle });
  }

  entries.sort((a, b) => {
    const aDir = a.handle.kind === 'directory';
    const bDir = b.handle.kind === 'directory';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru');
  });

  for (const { name, handle } of entries) {
    if (handle.kind === 'directory') {
      const folder = document.createElement('div');
      folder.className = 'obs-folder';

      const header = document.createElement('div');
      header.className = 'obs-folder-header';
      header.innerHTML = `<span>📁</span><span>${escObs(name)}</span>`;

      const children = document.createElement('div');
      children.className = 'obs-folder-children';
      children.style.display = 'none';

      let loaded = false;
      header.addEventListener('click', async () => {
        if (!loaded) {
          await renderDir(handle, children, depth + 1);
          loaded = true;
        }
        const isOpen = children.style.display !== 'none';
        children.style.display = isOpen ? 'none' : '';
        header.querySelector('span:first-child').textContent = isOpen ? '📁' : '📂';
      });

      folder.appendChild(header);
      folder.appendChild(children);
      container.appendChild(folder);
    } else if (name.endsWith('.md')) {
      const file = document.createElement('div');
      file.className = 'obs-file';

      const fileInfo = await handle.getFile();
      const date = new Date(fileInfo.lastModified).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'short'
      });

      file.innerHTML = `
        <div class="obs-file-name"><span>📄</span><span>${escObs(name.replace('.md', ''))}</span></div>
        <span class="obs-file-date">${date}</span>
      `;
      file.addEventListener('click', () => openNote(handle, name));
      container.appendChild(file);
    }
  }
}

// ===== OPEN NOTE =====
async function openNote(fileHandle, fileName) {
  const file = await fileHandle.getFile();
  let rawContent = await file.text();
  let isEditing = false;
  let unsaved = false;

  function getDate() {
    return new Date(file.lastModified).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  function getWordCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text);
    }
    return `<pre>${escObs(text)}</pre>`;
  }

  function buildView() {
    obsBrowser.innerHTML = `
      <div class="obs-note-view">
        <div class="obs-note-topbar">
          <button class="obs-note-back" id="obs-back">← Назад</button>
          <div class="obs-note-toolbar">
            <span class="obs-note-wordcount" id="obs-wordcount">${getWordCount(rawContent)} слов</span>
            <button class="obs-toolbar-btn ${isEditing ? 'active' : ''}" id="obs-toggle-edit">
              ${isEditing ? '👁 Просмотр' : '✎ Редактировать'}
            </button>
            <button class="obs-toolbar-btn obs-save-btn ${unsaved ? '' : 'hidden'}" id="obs-save">💾 Сохранить</button>
          </div>
        </div>
        <div class="obs-note-meta">
          <span>📅 ${getDate()}</span>
        </div>
        <div class="obs-note-title">${escObs(fileName.replace('.md', ''))}</div>
        ${isEditing
          ? `<textarea class="obs-editor" id="obs-editor-area">${escObs(rawContent)}</textarea>`
          : `<div class="obs-note-body obs-markdown" id="obs-preview">${renderMarkdown(rawContent)}</div>`
        }
      </div>
    `;

    document.getElementById('obs-back').addEventListener('click', async () => {
      if (unsaved) {
        if (!confirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
      }
      renderVault();
    });

    document.getElementById('obs-toggle-edit').addEventListener('click', () => {
      if (isEditing) {
        const area = document.getElementById('obs-editor-area');
        rawContent = area.value;
      }
      isEditing = !isEditing;
      buildView();
      if (isEditing) {
        const area = document.getElementById('obs-editor-area');
        area.focus();
        area.addEventListener('input', () => {
          unsaved = true;
          const wc = document.getElementById('obs-wordcount');
          if (wc) wc.textContent = area.value.trim().split(/\s+/).filter(Boolean).length + ' слов';
          const saveBtn = document.getElementById('obs-save');
          if (saveBtn) saveBtn.classList.remove('hidden');
        });
      }
    });

    const saveBtn = document.getElementById('obs-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const area = document.getElementById('obs-editor-area');
        if (area) rawContent = area.value;
        await saveNote();
      });
    }

    if (isEditing) {
      const area = document.getElementById('obs-editor-area');
      if (area) {
        area.addEventListener('input', () => {
          unsaved = true;
          const wc = document.getElementById('obs-wordcount');
          if (wc) wc.textContent = area.value.trim().split(/\s+/).filter(Boolean).length + ' слов';
          const saveBtn = document.getElementById('obs-save');
          if (saveBtn) saveBtn.classList.remove('hidden');
        });
        area.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            rawContent = area.value;
            saveNote();
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const start = area.selectionStart;
            const end = area.selectionEnd;
            area.value = area.value.substring(0, start) + '  ' + area.value.substring(end);
            area.selectionStart = area.selectionEnd = start + 2;
          }
        });
      }
    }
  }

  async function saveNote() {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(rawContent);
      await writable.close();
      unsaved = false;
      isEditing = false;
      buildView();
    } catch (e) {
      alert('Ошибка сохранения: ' + e.message);
    }
  }

  buildView();
}

// ===== CREATE NEW NOTE =====
obsNewNoteBtn.addEventListener('click', () => {
  document.getElementById('obs-input-name').value = '';
  document.getElementById('obs-input-content').value = '';
  obsModalOverlay.classList.remove('hidden');
  document.getElementById('obs-input-name').focus();
});

document.getElementById('obs-modal-close').addEventListener('click', closeObsModal);
document.getElementById('obs-modal-cancel').addEventListener('click', closeObsModal);
document.getElementById('obs-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeObsModal();
});

document.getElementById('obs-modal-save').addEventListener('click', createNote);

function closeObsModal() {
  obsModalOverlay.classList.add('hidden');
}

async function createNote() {
  if (!vaultHandle) return;

  let name = document.getElementById('obs-input-name').value.trim();
  const content = document.getElementById('obs-input-content').value;

  if (!name) {
    document.getElementById('obs-input-name').focus();
    document.getElementById('obs-input-name').style.borderColor = 'var(--danger)';
    setTimeout(() => document.getElementById('obs-input-name').style.borderColor = '', 1000);
    return;
  }

  if (!name.endsWith('.md')) name += '.md';

  try {
    const fileHandle = await vaultHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    closeObsModal();
    await renderVault();
  } catch (e) {
    alert('Ошибка при создании файла: ' + e.message);
  }
}

function escObs(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
