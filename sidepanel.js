let promts = [];
let notes = [];
let makros = [];
let bookmarks = [];
let deletedPromts = [];
let recentColors = [];
let collapsedGroups = {};
let collapsedNoteGroups = {};
let collapsedBookmarkGroups = {};
let collapsedSessions = {};
let savedSessions = [];
let groupMetadata = {};
let bookmarkGroupMetadata = {};
let tabColors = {};
let tabTextColors = {};
let tabIcons = {};
let tabIconOnly = {};
let tabLabels = {};
let tabCustomIcons = {};
let customProviders = [];
let groupOrder = [];
let noteGroupOrder = [];
let bookmarkGroupOrder = [];
let tabOrder = ['prompts', 'sessions', 'notes', 'makros', 'bookmarks'];
let isRecording = false;
let stepPlaybackState = null;
let recordingTabId = null;
let recordingBuffer = [];
let preRunMakroIdx = null;
let recordingMethod = 2;
let runningMakroState = null;
// M4: verfolgt Tabs, die während einer Aufnahme besucht werden, damit Tab-/Seitenwechsel
// als switchTab/newTab-Schritte aufgezeichnet und bei der Wiedergabe reproduziert werden können.
let recordingTabIndexMap = {};
let recordingNextTabIndex = 0;
let recordingCreatedTabIds = new Set();

function updatePlaybackBar() {
    const bar = document.getElementById('makroPlaybackBar');
    const counter = document.getElementById('makroPlaybackCounter');
    const pauseBtn = document.getElementById('makroPlaybackPauseBtn');
    const titleEl = document.getElementById('makroPlaybackTitle');
    const fill = document.getElementById('makroPlaybackProgressFill');
    if (!runningMakroState) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';
    const cur = (runningMakroState.current || 0) + 1;
    const tot = runningMakroState.repeat || 1;
    const paused = runningMakroState.paused;
    counter.textContent = cur + ' / ' + tot;
    pauseBtn.textContent = paused ? '▶' : '⏸';
    if (titleEl) titleEl.textContent = (paused ? '⏸ ' : '⏵ ') + (runningMakroState.title || 'Makro');
    if (fill) fill.style.width = Math.round(((cur - 1) / tot) * 100) + '%';
}

const tabNames = {
    'prompts': 'Promts',
    'sessions': 'Sessions',
    'notes': 'Notizen',
    'makros': 'Makros',
    'bookmarks': 'Lesezeichen'
};

const providerIcons = {
    'ChatGPT': '✧',
    'Gemini': '✦',
    'Claude': '⚛',
    'Copilot': '✵',
    'Perplexity': '◈',
    'DeepL': '⚲',
    'Grok': '𝕏',
    'Humata': '📄',
    'Grammarly': '✓',
    'DeepSeek': '🐳',
    'DataLab': '📊',
    'Google Antigravity': '🪐',
    'Cursor': '▲',
    'GitHub Copilot': '🐙',
    'Nano Banana': '🍌',
    'ChatGPT-Image-2.0': '🖼️',
    'NotebookLM': '📓',
    'none': ''
};

function getEffectiveProviderIcons() {
    const merged = Object.assign({}, providerIcons);
    customProviders.forEach(cp => { merged[cp.name] = cp.icon; });
    return merged;
}

let currentEditorTodos = [];

const _versionLabel = document.getElementById('addonVersionLabel');
if (_versionLabel) _versionLabel.textContent = 'v' + chrome.runtime.getManifest().version;

function loadData() {
    chrome.storage.sync.get({
        promts: [],
        notes: [],
        makros: [],
        bookmarks: [],
        deletedPromts: [],
        recentColors: [],
        groupMetadata: {},
        bookmarkGroupMetadata: {},
        savedSessions: [],
        tabColors: {},
        tabTextColors: {},
        tabIcons: {},
        tabIconOnly: {},
        tabLabels: {},
        tabOrder: ['prompts', 'sessions', 'notes', 'makros', 'bookmarks'],
        customProviders: [],
        groupOrder: [],
        noteGroupOrder: [],
        bookmarkGroupOrder: []
    }, (res) => {
        promts = res.promts || [];
        notes = res.notes || [];
        makros = res.makros || [];
        bookmarks = res.bookmarks || [];
        deletedPromts = res.deletedPromts || [];
        recentColors = res.recentColors || [];
        groupMetadata = res.groupMetadata || {};
        bookmarkGroupMetadata = res.bookmarkGroupMetadata || {};
        savedSessions = res.savedSessions || [];
        tabColors = res.tabColors || {};
        tabTextColors = res.tabTextColors || {};
        tabIcons = res.tabIcons || {};
        tabIconOnly = res.tabIconOnly || {};
        tabLabels = res.tabLabels || {};
        tabOrder = res.tabOrder || ['prompts', 'sessions', 'notes', 'makros', 'bookmarks'];
        customProviders = res.customProviders || [];
        groupOrder = res.groupOrder || [];
        noteGroupOrder = res.noteGroupOrder || [];
        bookmarkGroupOrder = res.bookmarkGroupOrder || [];

        if (!tabOrder.includes('bookmarks')) {
            tabOrder.push('bookmarks');
            chrome.storage.sync.set({ tabOrder });
        }

        // Migration: bestehende Lesezeichen-Gruppen (früher in gemeinsamer groupMetadata) nach bookmarkGroupMetadata übernehmen
        let bgmMigrated = false;
        bookmarks.forEach(b => {
            if (b.group && b.group.trim() !== "" && !bookmarkGroupMetadata[b.group] && groupMetadata[b.group]) {
                bookmarkGroupMetadata[b.group] = Object.assign({}, groupMetadata[b.group]);
                bgmMigrated = true;
            }
        });
        if (bgmMigrated) chrome.storage.sync.set({ bookmarkGroupMetadata });

        savedSessions.forEach((_, idx) => {
            if (collapsedSessions[idx] === undefined) {
                collapsedSessions[idx] = true;
            }
        });

        renderTabsNavigation();
        applyTabColors();
        render();
        renderNotes();
        renderMakros();
        renderBookmarks();
        renderTrash();
        renderRecentColors();
        renderSessions();
        populateGroupDropdowns();
        populateProviderDropdowns();
        checkSyncStatus();
        initGroupDragDrop(document.getElementById('promptList'), false);
        initGroupDragDrop(document.getElementById('notesList'), true);
        initGroupDragDrop(document.getElementById('bookmarksList'), 'bookmark');
        initBookmarkItemDragDrop(document.getElementById('bookmarksList'));

        chrome.storage.local.get({ tabCustomIcons: {} }, (localRes) => {
            tabCustomIcons = localRes.tabCustomIcons || {};
            renderTabsNavigation();
            applyTabColors();
        });
    });
}

function renderTabsNavigation() {
    const navContainer = document.getElementById('tabsNavContainer');
    if (!navContainer) return;

    const activeBtn = navContainer.querySelector('.tab-btn.active');
    const activeTabKey = activeBtn ? activeBtn.dataset.tab : 'prompts';

    navContainer.innerHTML = tabOrder.map(key => {
        const label = tabLabels[key] || tabNames[key] || key;
        const customIcon = tabCustomIcons[key] || '';
        const emojiIcon = tabIcons[key] || '';
        const iconOnly = !!tabIconOnly[key];
        const iconHtml = customIcon
            ? `<img src="${customIcon}" style="height:14px; width:14px; object-fit:contain; vertical-align:middle;">`
            : (emojiIcon || '');
        const hasIcon = !!(customIcon || emojiIcon);
        const displayText = (iconOnly && hasIcon) ? iconHtml : (hasIcon ? iconHtml + ' ' + label : label);
        return `<button id="nav${key.charAt(0).toUpperCase() + key.slice(1)}" class="tab-btn ${activeTabKey === key ? 'active' : ''}" data-tab="${key}" title="${label}">${displayText}</button>`;
    }).join('');
}

function applyTabColors() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const tabKey = btn.dataset.tab;
        if (tabColors[tabKey]) {
            btn.style.setProperty('background-color', tabColors[tabKey], 'important');
            btn.style.setProperty('border-top', `3px solid ${tabColors[tabKey]}`, 'important');
            btn.style.setProperty('--tab-glow-color', tabColors[tabKey]);
        } else {
            btn.style.removeProperty('background-color');
            btn.style.removeProperty('border-top');
            btn.style.removeProperty('--tab-glow-color');
        }
        if (tabTextColors[tabKey]) {
            btn.style.setProperty('color', tabTextColors[tabKey], 'important');
        } else {
            btn.style.removeProperty('color');
        }
    });
}

function checkSyncStatus() {
    const statusBox = document.getElementById('syncStatusText');
    if (!statusBox) return;
    
    try {
        chrome.storage.sync.getBytesInUse(null, (bytes) => {
            if (chrome.runtime.lastError) {
                statusBox.innerText = "❌ Synchronisierung inaktiv (Account fehlt oder Offline)";
                statusBox.style.color = "#cf6679";
            } else {
                statusBox.innerText = "✅ Aktiv";
                statusBox.style.color = "#4caf50";
            }
        });
    } catch (e) {
        statusBox.innerText = "❌ Fehler";
        statusBox.style.color = "#cf6679";
    }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
        loadData();
    }
});

function populateGroupDropdowns() {
    const pSelect = document.getElementById('groupSelectOptions');
    const nSelect = document.getElementById('noteGroupSelectOptions');
    const bSelect = document.getElementById('bookmarkGroupSelectOptions');
    if (!pSelect || !nSelect) return;

    const uniqueGroups = new Set();
    promts.forEach(p => { if (p.group && p.group.trim() !== "") uniqueGroups.add(p.group); });
    notes.forEach(n => { if (n.group && n.group.trim() !== "") uniqueGroups.add(n.group); });
    Object.keys(groupMetadata).forEach(g => uniqueGroups.add(g));

    const buildOptions = (names) => {
        let html = '<option value="">Keine</option>';
        names.sort((a, b) => a.localeCompare(b, 'de')).forEach(gName => {
            html += `<option value="${gName}">${gName}</option>`;
        });
        html += '<option value="__NEW_GROUP__">[+ Neue Gruppe erstellen]</option>';
        return html;
    };

    const baseHtml = buildOptions(Array.from(uniqueGroups));
    pSelect.innerHTML = baseHtml;
    nSelect.innerHTML = baseHtml;

    if (bSelect) {
        const uniqueBookmarkGroups = new Set();
        bookmarks.forEach(b => { if (b.group && b.group.trim() !== "") uniqueBookmarkGroups.add(b.group); });
        Object.keys(bookmarkGroupMetadata).forEach(g => uniqueBookmarkGroups.add(g));
        bSelect.innerHTML = buildOptions(Array.from(uniqueBookmarkGroups));
    }
}

function sortGroupNames(names, orderArray) {
    if (!orderArray || orderArray.length === 0) return names;
    const inOrder = orderArray.filter(n => names.includes(n));
    const rest = names.filter(n => !orderArray.includes(n));
    return [...inOrder, ...rest];
}

function populateProviderDropdowns() {
    const effectiveIcons = getEffectiveProviderIcons();
    const defaultProviders = ['none', 'ChatGPT', 'Gemini', 'Claude', 'Copilot', 'Perplexity', 'DeepL', 'Grok', 'Humata', 'Grammarly', 'DeepSeek', 'DataLab', 'Google Antigravity', 'Cursor', 'GitHub Copilot', 'Nano Banana', 'ChatGPT-Image-2.0', 'NotebookLM'];
    const sortedNames = [...defaultProviders.filter(n => n !== 'none'), ...customProviders.map(cp => cp.name)]
        .sort((a, b) => a.localeCompare(b, 'de'));
    const allNames = ['none', ...sortedNames];

    const buildOptions = (includeDefault) => {
        let html = '';
        if (includeDefault) html += '<option value="default">Gruppen-Anbieter (Standard)</option>';
        allNames.forEach(name => {
            if (name === 'none') {
                html += '<option value="none">Keins</option>';
            } else {
                const ico = effectiveIcons[name] || '';
                html += `<option value="${name}">${ico ? ico + ' ' : ''}${name}</option>`;
            }
        });
        return html;
    };

    const prov = document.getElementById('aiProvider');
    const gProv = document.getElementById('groupAiProvider');
    if (prov) prov.innerHTML = buildOptions(false);
    if (gProv) gProv.innerHTML = buildOptions(true);
    renderCustomProviderList();
}

function renderCustomProviderList() {
    const container = document.getElementById('customProviderList');
    if (!container) return;
    if (customProviders.length === 0) {
        container.innerHTML = '<p style="font-size:11px;opacity:0.5;margin:0;">Keine eigenen Anbieter.</p>';
        return;
    }
    container.innerHTML = customProviders.map((cp, i) => `
        <div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
            <span style="font-size:16px;min-width:24px;">${cp.icon}</span>
            <span style="flex:1;font-size:12px;">${cp.name}</span>
            <button class="group-edit-btn remove-custom-provider" data-index="${i}"
                    style="color:#cf6679;" title="Entfernen">✕</button>
        </div>
    `).join('');
}

function initGroupDragDrop(containerEl, isNotes) {
    if (!containerEl) return;
    let dragSrcName = null;

    containerEl.addEventListener('dragstart', (e) => {
        if (e.target.closest('.bookmark-card[draggable]')) return; // verschachtelte Lesezeichen-Karte -> initBookmarkItemDragDrop übernimmt
        const gc = e.target.closest('.group-container[draggable]');
        if (!gc) return;
        dragSrcName = gc.dataset.groupname;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => { gc.style.opacity = '0.5'; }, 0);
    });

    containerEl.addEventListener('dragend', (e) => {
        const gc = e.target.closest('.group-container[draggable]');
        if (gc) gc.style.opacity = '';
        containerEl.querySelectorAll('.group-container[draggable]').forEach(el => {
            el.style.outline = '';
        });
        dragSrcName = null;
    });

    containerEl.addEventListener('dragover', (e) => {
        if (!dragSrcName) return; // kein interner Gruppen-Drag aktiv -> externen Import-Listener nicht stören
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const gc = e.target.closest('.group-container[draggable]');
        if (gc && gc.dataset.groupname !== dragSrcName) {
            gc.style.outline = '2px dashed var(--accent, #ff8c00)';
        }
    });

    containerEl.addEventListener('dragleave', (e) => {
        const gc = e.target.closest('.group-container[draggable]');
        if (gc) gc.style.outline = '';
    });

    containerEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const gc = e.target.closest('.group-container[draggable]');
        if (!gc || !dragSrcName) return;
        gc.style.outline = '';
        const targetName = gc.dataset.groupname;
        if (targetName === dragSrcName) return;

        const allRendered = Array.from(
            containerEl.querySelectorAll('.group-container[draggable]')
        ).map(el => el.dataset.groupname);

        let newOrder = [...allRendered];
        const fromIdx = newOrder.indexOf(dragSrcName);
        const toIdx = newOrder.indexOf(targetName);
        if (fromIdx === -1 || toIdx === -1) return;
        newOrder.splice(fromIdx, 1);
        newOrder.splice(toIdx, 0, dragSrcName);

        if (isNotes === 'bookmark') {
            bookmarkGroupOrder = newOrder;
            chrome.storage.sync.set({ bookmarkGroupOrder }, renderBookmarks);
        } else if (isNotes) {
            noteGroupOrder = newOrder;
            chrome.storage.sync.set({ noteGroupOrder }, renderNotes);
        } else {
            groupOrder = newOrder;
            chrome.storage.sync.set({ groupOrder }, render);
        }
    });
}

// Einzelne Lesezeichen innerhalb derselben Gruppe (bzw. innerhalb der Gruppenlosen) per
// Drag & Drop umsortieren. Nutzt dasselbe dropEffect-Guard-Muster wie initGroupDragDrop,
// damit der externe Lesezeichen-Import (dragover auf #bookmarksView) nicht gestört wird.
function initBookmarkItemDragDrop(containerEl) {
    if (!containerEl) return;
    let dragSrcIndex = null;

    containerEl.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.bookmark-card[draggable]');
        if (!card) return;
        dragSrcIndex = parseInt(card.dataset.bookmarkIndex, 10);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => { card.style.opacity = '0.5'; }, 0);
    });

    containerEl.addEventListener('dragend', (e) => {
        const card = e.target.closest('.bookmark-card[draggable]');
        if (card) card.style.opacity = '';
        containerEl.querySelectorAll('.bookmark-card[draggable]').forEach(el => { el.style.outline = ''; });
        dragSrcIndex = null;
    });

    containerEl.addEventListener('dragover', (e) => {
        if (dragSrcIndex === null) return; // kein interner Karten-Drag aktiv -> externen Import-Listener nicht stören
        const card = e.target.closest('.bookmark-card[draggable]');
        if (!card) return;
        const targetIndex = parseInt(card.dataset.bookmarkIndex, 10);
        if ((bookmarks[targetIndex] && bookmarks[targetIndex].group) !== (bookmarks[dragSrcIndex] && bookmarks[dragSrcIndex].group)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (targetIndex !== dragSrcIndex) card.style.outline = '2px dashed var(--accent, #ff8c00)';
    });

    containerEl.addEventListener('dragleave', (e) => {
        const card = e.target.closest('.bookmark-card[draggable]');
        if (card) card.style.outline = '';
    });

    containerEl.addEventListener('drop', (e) => {
        const card = e.target.closest('.bookmark-card[draggable]');
        if (!card || dragSrcIndex === null) return;
        const targetIndex = parseInt(card.dataset.bookmarkIndex, 10);
        card.style.outline = '';
        if (targetIndex === dragSrcIndex) return;
        if ((bookmarks[targetIndex] && bookmarks[targetIndex].group) !== (bookmarks[dragSrcIndex] && bookmarks[dragSrcIndex].group)) return;
        e.preventDefault();

        const targetBookmark = bookmarks[targetIndex];
        const [moved] = bookmarks.splice(dragSrcIndex, 1);
        const newTargetIndex = bookmarks.indexOf(targetBookmark);
        bookmarks.splice(newTargetIndex, 0, moved);
        dragSrcIndex = null;
        chrome.storage.sync.set({ bookmarks }, renderBookmarks);
    });
}

function handleDropdownChange(selectId, inputId) {
    const select = document.getElementById(selectId);
    const textInput = document.getElementById(inputId);
    if (!select || !textInput) return;
    
    select.addEventListener('change', (e) => {
        if (e.target.value === '__NEW_GROUP__') {
            textInput.style.display = 'block';
            textInput.focus();
        } else {
            textInput.style.display = 'none';
            textInput.value = '';
        }
    });
}
handleDropdownChange('groupSelectOptions', 'groupInput');
handleDropdownChange('noteGroupSelectOptions', 'noteGroupInput');
handleDropdownChange('bookmarkGroupSelectOptions', 'bookmarkGroupInput');

function render() {
    const pList = document.getElementById('promptList');
    if (!pList) return;
    
    const groups = {};
    const unassigned = [];
    
    promts.forEach((p, i) => {
        if (p.group && p.group.trim() !== "") {
            if (!groups[p.group]) groups[p.group] = [];
            groups[p.group].push({ item: p, index: i });
        } else {
            unassigned.push({ item: p, index: i });
        }
    });

    let html = "";
    sortGroupNames(Object.keys(groups), groupOrder).forEach(gName => {
        const isCollapsed = (gName in collapsedGroups) ? collapsedGroups[gName] : true;
        const meta = groupMetadata[gName] || { color: '#ff8c00', icon: '📁' };
        let totalCount = groups[gName] ? groups[gName].length : 0;

        html += `
            <div class="group-container" draggable="true" data-groupname="${gName}" style="border-top: 2px solid ${meta.color}">
                <div class="group-header" data-group="${gName}" style="color: ${meta.color};">
                    <div class="group-title-wrapper">
                        <span class="drag-handle" title="Verschieben">⠿</span>
                        <span>${meta.icon} ${gName}</span>
                    </div>
                    <div class="group-right-wrapper">
                        <span class="badge">${totalCount}</span>
                        <button class="group-edit-btn" data-action="edit-group" data-groupname="${gName}" title="Gruppe bearbeiten">✎</button>
                        <span style="font-size:10px; padding-left:4px;">${isCollapsed ? '►' : '▼'}</span>
                    </div>
                </div>
                <div class="group-content" style="display: ${isCollapsed ? 'none' : 'flex'};">
                    ${groups[gName].map(gItem => getCardHtml(gItem.item, gItem.index)).join('')}
                </div>
            </div>
        `;
    });

    if (unassigned.length > 0) {
        html += unassigned.map(uItem => getCardHtml(uItem.item, uItem.index)).join('');
    }
    
    if (html === "") {
        html = '<p style="font-size:12px; opacity:0.5; margin:0;">Keine Prompts vorhanden.</p>';
    }
    pList.innerHTML = html;
}

function getCardHtml(p, i) {
    const icons = getEffectiveProviderIcons();
    const icon = icons[p.provider] !== undefined ? icons[p.provider] : '⚬';
    const showIcon = icon !== '';
    return `
        <div class="prompt-card" style="border-left: 3px solid ${p.color || '#ff8c00'}">
            <div class="card-header">
                <div class="prompt-info" data-action="copy-insert" data-index="${i}">
                    ${showIcon ? `<span class="provider-icon" title="${p.provider === 'none' ? 'Keins' : (p.provider || 'Anbieter')}">${icon}</span>` : ''}
                    <span class="prompt-title">${p.title || 'Unbenannt'}</span>
                </div>
                <div class="card-actions">
                    <button class="btn-icon" data-action="toggle" data-index="${i}" title="Vorschau">👁</button>
                    <button class="btn-icon" data-action="edit" data-index="${i}" title="Bearbeiten">✎</button>
                    <button class="btn-icon" data-action="delete" data-index="${i}" title="Löschen">✕</button>
                </div>
            </div>
            <div id="content-${i}" class="content-box">${p.text || ''}</div>
        </div>
    `;
}

function renderNotes() {
    const pinnedList = document.getElementById('pinnedNotesList');
    const notesList = document.getElementById('notesList');
    if (!notesList || !pinnedList) return;

    const pinnedNotes = [];
    const unpinnedNotes = [];

    notes.forEach((n, i) => {
        if (n.pinned) pinnedNotes.push({ item: n, index: i });
        else unpinnedNotes.push({ item: n, index: i });
    });

    if (pinnedNotes.length > 0) {
        document.getElementById('pinnedNotesSection').style.display = 'block';
        pinnedList.innerHTML = pinnedNotes.map(nItem => getNoteCardHtml(nItem.item, nItem.index)).join('');
    } else {
        document.getElementById('pinnedNotesSection').style.display = 'none';
    }

    const groups = {};
    const unassigned = [];

    unpinnedNotes.forEach(nObj => {
        if (nObj.item.group && nObj.item.group.trim() !== "") {
            if (!groups[nObj.item.group]) groups[nObj.item.group] = [];
            groups[nObj.item.group].push(nObj);
        } else {
            unassigned.push(nObj);
        }
    });

    let html = "";
    sortGroupNames(Object.keys(groups), noteGroupOrder).forEach(gName => {
        const isCollapsed = (gName in collapsedNoteGroups) ? collapsedNoteGroups[gName] : true;
        const meta = groupMetadata[gName] || { color: '#ff8c00', icon: '📁' };
        let totalCount = groups[gName].length;

        html += `
            <div class="group-container" draggable="true" data-groupname="${gName}" style="border-top: 2px solid ${meta.color}">
                <div class="group-header" data-notegroup="${gName}" style="color: ${meta.color};">
                    <div class="group-title-wrapper">
                        <span class="drag-handle" title="Verschieben">⠿</span>
                        <span>${meta.icon} ${gName}</span>
                    </div>
                    <div class="group-right-wrapper">
                        <span class="badge">${totalCount}</span>
                        <button class="group-edit-btn" data-notegroupedit="${gName}" title="Gruppe bearbeiten">✎</button>
                        <span style="font-size:10px; padding-left:4px;">${isCollapsed ? '►' : '▼'}</span>
                    </div>
                </div>
                <div class="group-content" style="display: ${isCollapsed ? 'none' : 'flex'};">
                    ${groups[gName].map(nObj => getNoteCardHtml(nObj.item, nObj.index)).join('')}
                </div>
            </div>
        `;
    });

    if (unassigned.length > 0) {
        html += unassigned.map(nObj => getNoteCardHtml(nObj.item, nObj.index)).join('');
    } else if (html === "" && pinnedNotes.length === 0) {
        html = '<p style="font-size:12px; opacity:0.5; margin:0;">Keine Notizen vorhanden.</p>';
    }

    notesList.innerHTML = html;
}

function getNoteCardHtml(n, i) {
    let todoHtml = "";
    if (n.todos && n.todos.length > 0) {
        todoHtml = `<div class="note-todo-list-render">` + n.todos.map((todo, tIdx) => `
            <div class="note-todo-item-render ${todo.done ? 'done' : ''}">
                <input type="checkbox" class="note-card-todo-check" data-note-idx="${i}" data-todo-idx="${tIdx}" ${todo.done ? 'checked' : ''}>
                <span>${todo.text}</span>
            </div>
        `).join('') + `</div>`;
    }

    const tileColor = n.color || '#ff8c00';

    const noteCardEl = document.createElement('div');
    noteCardEl.className = 'note-card';
    noteCardEl.style.cssText = `border-left: 3px solid ${tileColor}; background: rgba(0,0,0,0.15);`;
    noteCardEl.innerHTML = `
            <div class="card-header">
                <div class="note-info" data-note-action="toggle-view" data-index="${i}">
                    <span class="note-title" style="font-weight:bold; color:${tileColor}; cursor:pointer;" data-note-copy-idx="${i}">${n.pinned ? '📌 ' : ''}${n.icon ? '<span class="note-card-icon">' + n.icon + '</span> ' : ''}${n.title || 'Unbenannte Notiz'}</span>
                </div>
                <div class="card-actions">
                    <button class="btn-icon" data-note-action="toggle-view" data-index="${i}" title="Vorschau">👁</button>
                    <button class="btn-icon" data-note-action="edit" data-index="${i}" title="Bearbeiten">✎</button>
                    <button class="btn-icon" data-note-action="delete" data-index="${i}" title="Löschen">✕</button>
                </div>
            </div>
            <div id="note-content-${i}" class="content-box" style="display:none; background:rgba(0,0,0,0.3);">
                <div style="white-space: pre-wrap;">${n.text || ''}</div>
                ${todoHtml}
            </div>
    `;
    return noteCardEl.outerHTML;
}

function renderBookmarks() {
    const bList = document.getElementById('bookmarksList');
    if (!bList) return;

    const groups = {};
    const unassigned = [];

    bookmarks.forEach((b, i) => {
        if (b.group && b.group.trim() !== "") {
            if (!groups[b.group]) groups[b.group] = [];
            groups[b.group].push({ item: b, index: i });
        } else {
            unassigned.push({ item: b, index: i });
        }
    });

    let html = "";
    sortGroupNames(Object.keys(groups), bookmarkGroupOrder).forEach(gName => {
        const isCollapsed = (gName in collapsedBookmarkGroups) ? collapsedBookmarkGroups[gName] : true;
        const meta = bookmarkGroupMetadata[gName] || { color: '#ff8c00', icon: '🔖' };
        let totalCount = groups[gName].length;

        html += `
            <div class="group-container" draggable="true" data-groupname="${gName}" style="border-top: 2px solid ${meta.color}">
                <div class="group-header" data-bookmarkgroup="${gName}" style="color: ${meta.color};">
                    <div class="group-title-wrapper">
                        <span class="drag-handle" title="Verschieben">⠿</span>
                        <span>${meta.icon} ${gName}</span>
                    </div>
                    <div class="group-right-wrapper">
                        <span class="badge">${totalCount}</span>
                        <button class="group-edit-btn" data-bookmarkgroupedit="${gName}" title="Gruppe bearbeiten">✎</button>
                        <span style="font-size:10px; padding-left:4px;">${isCollapsed ? '►' : '▼'}</span>
                    </div>
                </div>
                <div class="group-content" style="display: ${isCollapsed ? 'none' : 'flex'};">
                    ${groups[gName].map(bObj => getBookmarkCardHtml(bObj.item, bObj.index)).join('')}
                </div>
            </div>
        `;
    });

    if (unassigned.length > 0) {
        html += unassigned.map(bObj => getBookmarkCardHtml(bObj.item, bObj.index)).join('');
    } else if (html === "") {
        html = '<p style="font-size:12px; opacity:0.5; margin:0;">Keine Lesezeichen vorhanden.</p>';
    }

    bList.innerHTML = html;
}

function faviconUrl(pageUrl) {
    try {
        const u = new URL(chrome.runtime.getURL('/_favicon/'));
        u.searchParams.set('pageUrl', pageUrl);
        u.searchParams.set('size', '32');
        return u.toString();
    } catch (e) {
        return '';
    }
}

function getBookmarkCardHtml(b, i) {
    const favicon = b.url ? faviconUrl(b.url) : '';
    return `
        <div class="bookmark-card" draggable="true" data-bookmark-index="${i}" style="border-left: 3px solid ${b.color || '#ff8c00'}">
            <div class="card-header">
                <div class="prompt-info" data-bookmark-action="open" data-index="${i}" title="In neuem Tab öffnen">
                    <span class="bookmark-favicon-wrap" style="display:inline-flex; width:16px; height:16px; align-items:center; justify-content:center; flex-shrink:0;">${favicon ? `<img class="bookmark-favicon" src="${favicon}" data-fallback="🔖" style="width:14px; height:14px; object-fit:contain;">` : '🔖'}</span>
                    <span class="prompt-title">${b.title || 'Unbenanntes Lesezeichen'}</span>
                </div>
                <div class="card-actions">
                    <button class="btn-icon" data-bookmark-action="toggle" data-index="${i}" title="Vorschau">👁</button>
                    <button class="btn-icon" data-bookmark-action="edit" data-index="${i}" title="Bearbeiten">✎</button>
                    <button class="btn-icon" data-bookmark-action="delete" data-index="${i}" title="Löschen">✕</button>
                </div>
            </div>
            <div id="bookmark-content-${i}" class="content-box">${b.url || ''}</div>
        </div>
    `;
}

function renderMakros() {
    const mList = document.getElementById('makrosList');
    if (!mList) return;

    if (makros.length === 0) {
        mList.innerHTML = '<p style="font-size:12px; opacity:0.5; margin:0;">Keine Makros vorhanden.</p>';
        return;
    }

    mList.innerHTML = makros.map((m, i) => {
        const stepsCount = m.steps ? m.steps.length : 0;
        const stepIcon = (s) => ({ click:'🖱', type:'⌨', wait:'⏱', waitForReload:'🔄', navigate:'🌐', scroll:'🔃', keypress:'⌨', select:'☰', doubleclick:'🖱🖱', rightclick:'🖱❯', hover:'↗', switchTab:'⇄', newTab:'🗗', mousemovepath:'↝' }[s.type] || '▸');
        const stepDesc = (s) => {
            if (s.type === 'click') return `Klick @ (${s._px},${s._py})`;
            if (s.type === 'type') return `Text: "${(s.value||'').slice(0,28)}"`;
            if (s.type === 'wait') return `Pause ${s.duration||1000}ms`;
            if (s.type === 'waitForReload') return `Reload warten (max ${s.timeout||10000}ms)`;
            if (s.type === 'navigate') return `→ ${(s.url||'').slice(0,35)}`;
            if (s.type === 'scroll') return s.selector ? `Scroll zu ${s.selector}` : `Scroll (${s.x||0},${s.y||0})`;
            if (s.type === 'keypress') return `Taste: ${(s.modifiers||[]).join('+')}${s.modifiers?.length?'+':''}${s.key}`;
            if (s.type === 'select') return `Auswahl: ${s.selector} = "${s.value}"`;
            if (s.type === 'doubleclick') return `Doppelklick: ${s.selector||`(${s._px},${s._py})`}`;
            if (s.type === 'rightclick') return `Rechtsklick: ${s.selector||`(${s._px},${s._py})`}`;
            if (s.type === 'hover') return `Hover: ${s.selector||`(${s._px},${s._py})`}`;
            return s.type;
        };
        const stepsHtml = (m.steps || []).map((s, j) => `
            <div class="makro-step-item" draggable="true" data-makro-idx="${i}" data-step-idx="${j}" title="Klicken zum Hervorheben auf Seite">
                <span class="drag-handle">⠿</span>
                <span>${stepIcon(s)}</span>
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${stepDesc(s)}</span>
            </div>
        `).join('');
        return `
            <div class="makro-card" style="border-left: 3px solid ${m.color || '#ff8c00'}">
                <div class="card-header">
                    <div class="makro-info" data-makro-action="run" data-index="${i}" title="Makro abspielen">
                        <span style="color: #4caf50; font-size:12px;">▶</span>
                        <span class="makro-title" style="font-weight:600;">${m.title || 'Unbenanntes Makro'}</span>
                        <span style="font-size:10px; opacity:0.5;">(${stepsCount} Schritte)${(m.repeat && m.repeat > 1) ? ` <span style="color:#ff8c00;">${m.repeat}×</span>` : ''}${m.domain ? ` <span title="Aufgenommen auf ${m.domain}">🌐</span>` : ''}${m.method === 1 ? ` <span style="color:#4caf50; font-weight:700; font-size:9px; background:rgba(76,175,80,0.15); padding:1px 4px; border-radius:3px;">M1</span>` : ''}</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn-icon" data-makro-action="step" data-index="${i}" title="Einzelschritt-Wiedergabe">▶|</button>
                        <button class="btn-icon" data-makro-action="toggle-steps" data-index="${i}" title="Schritte anzeigen">👁</button>
                        <button class="btn-icon" data-makro-action="edit" data-index="${i}" title="Bearbeiten">✎</button>
                        <button class="btn-icon" data-makro-action="delete" data-index="${i}" title="Löschen">✕</button>
                    </div>
                </div>
                <div id="makro-content-${i}" class="content-box" style="display:none; padding:4px;">${stepsHtml}</div>
            </div>
        `;
    }).join('');
}

function renderTrash() {
    const tList = document.getElementById('trashList');
    if (!tList) return;

    if (deletedPromts.length === 0) {
        tList.innerHTML = '<p style="font-size:12px; opacity:0.5; margin:0;">Der Papierkorb ist leer.</p>';
        return;
    }

    tList.innerHTML = deletedPromts.map((p, i) => `
        <div class="trash-card" style="border-left: 3px solid #555;">
            <div class="card-header">
                <div class="prompt-info">
                    <span class="prompt-title">${p.title || 'Unbenannt'}</span>
                </div>
                <div class="card-actions">
                    <button class="btn-icon" data-action="restore" data-index="${i}" title="Wiederherstellen">↶</button>
                    <button class="btn-icon" data-action="perma-delete" data-index="${i}" title="Endgültig löschen">✕</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderRecentColors() {
    ['recentColorsPrompt', 'recentColorsGroup', 'recentColorsNote', 'recentColorsMakro', 'recentColorsBookmark'].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = recentColors.map(c => `
            <div class="color-dot" style="background-color: ${c};" data-color="${c}"></div>
        `).join('');
    });
}

function updateRecentColors(color) {
    if (!color) return;
    recentColors = recentColors.filter(c => c !== color);
    recentColors.unshift(color);
    if (recentColors.length > 10) recentColors.pop();
    chrome.storage.sync.set({ recentColors });
}

function renderSessions() {
    const sList = document.getElementById('sessionList');
    if (!sList) return;

    if (savedSessions.length === 0) {
        sList.innerHTML = '<p style="font-size:12px; opacity:0.5;">Keine gespeicherten Sessions vorhanden.</p>';
        return;
    }

    sList.innerHTML = savedSessions.map((s, sIdx) => {
        const isCollapsed = collapsedSessions[sIdx] !== false;
        let totalTabsCount = 0;
        if (s.windows) {
            s.windows.forEach(w => { if(w.tabs) totalTabsCount += w.tabs.length; });
        } else if (s.tabs) {
            totalTabsCount = s.tabs.length;
        }

        let flatTabsHtml = "";
        let globalTabIdx = 1;

        if (s.windows && s.windows.length > 0) {
            s.windows.forEach((win, winIdx) => {
                flatTabsHtml += `
                    <div class="session-window-group">
                        <div class="session-window-header">Fenster ${winIdx + 1} (${win.tabs ? win.tabs.length : 0} Tabs)</div>
                `;
                if (win.tabs && win.tabs.length > 0) {
                    win.tabs.forEach((t, tIdx) => {
                        flatTabsHtml += getSessionTabItemHtml(t, sIdx, globalTabIdx - 1, globalTabIdx, true, winIdx, tIdx);
                        globalTabIdx++;
                    });
                } else {
                    flatTabsHtml += '<p style="font-size:11px; opacity:0.4; margin:0; padding:4px;">Keine Tabs.</p>';
                }
                flatTabsHtml += `</div>`;
            });
        } else if (s.tabs && s.tabs.length > 0) {
            flatTabsHtml += `<div class="session-window-group"><div class="session-window-header">Fenster 1</div>`;
            s.tabs.forEach((t, tIdx) => {
                flatTabsHtml += getSessionTabItemHtml(t, sIdx, tIdx, globalTabIdx, false);
                globalTabIdx++;
            });
            flatTabsHtml += `</div>`;
        } else {
            flatTabsHtml = '<p style="font-size:11px; opacity:0.4; margin:0; padding:4px;">Keine Tabs.</p>';
        }

        return `
            <div class="session-card" data-session-index="${sIdx}">
                <div class="session-header-block">
                    <div class="session-title-row" data-session-action="toggle-collapse">
                        <div class="session-title">
                            <span>${s.name || 'Unbenannte Session'}</span>
                            <span class="session-meta">(${totalTabsCount} Tabs)</span>
                            <span style="font-size:10px; padding-left:4px;">${isCollapsed ? '►' : '▼'}</span>
                        </div>
                    </div>
                    <div class="session-actions-sub">
                        <button class="btn-icon" data-session-action="update-current" title="Mit aktuellen Browser-Tabs überschreiben">🔄</button>
                        <button class="btn-icon" data-session-action="restore-all" title="Wiederherstellen">📂</button>
                        <button class="btn-icon" data-session-action="rename" title="Session umbenennen">✎</button>
                        <button class="btn-icon session-delete-btn-right" data-session-action="delete" title="Session löschen">✕</button>
                    </div>
                </div>
                <div class="session-tabs-list" id="session-tabs-${sIdx}" style="display: ${isCollapsed ? 'none' : 'flex'};">
                    ${flatTabsHtml}
                </div>
            </div>
        `;
    }).join('');
}

function getSessionTabItemHtml(t, sIdx, flatIdx, displayNum, isMultiWin = false, winIdx = 0, tIdx = 0) {
    const dataAttrs = isMultiWin 
        ? `data-multi-win="true" data-win-idx="${winIdx}" data-t-idx="${tIdx}"`
        : `data-multi-win="false" data-tab-index="${flatIdx}"`;

    // Falls die URL komplett leer ist (neuer Tab ohne Adresse) zeigen wir einen Fallback-Text an
    const displayUrl = t.url || "about:blank";
    const displayTitle = t.title || "Neuer Tab";

    return `
        <div class="session-tab-item">
            <a href="${displayUrl}" target="_blank" class="session-tab-link" title="${displayTitle || displayUrl}">${displayNum}. ${displayTitle}</a>
            <div class="tab-item-actions">
                <button class="group-edit-btn" data-session-action="rename-tab" ${dataAttrs} title="Seite umbenennen">✎</button>
                <button class="group-edit-btn" data-session-action="move-up" ${dataAttrs} title="Nach oben">▲</button>
                <button class="group-edit-btn" data-session-action="move-down" ${dataAttrs} title="Nach unten">▼</button>
                <button class="group-edit-btn" style="color:#cf6679;" data-session-action="remove-tab" ${dataAttrs} title="Tab entfernen">✕</button>
            </div>
        </div>
    `;
}

function insertTextIntoPage(text) {
    chrome.runtime.sendMessage({ action: "executeInsertion", text: text });
}

// Event-Handling für Makros
document.getElementById('makrosList').addEventListener('click', (e) => {
    // Step-Hervorhebung auf Seite (Klick auf eine Schritt-Zeile)
    const stepItem = e.target.closest('.makro-step-item');
    if (stepItem && !e.target.closest('[data-makro-action]') && !e.target.classList.contains('drag-handle')) {
        const mi = parseInt(stepItem.dataset.makroIdx);
        const si = parseInt(stepItem.dataset.stepIdx);
        const step = makros[mi]?.steps?.[si];
        if (step && step._px !== undefined) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) return;
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: (px, py) => {
                        window.scrollTo({ top: py - window.innerHeight / 2, behavior: 'smooth' });
                        const vx = px - window.scrollX, vy = py - window.scrollY;
                        const el = document.elementFromPoint(vx, vy);
                        if (!el) return;
                        const orig = el.style.outline;
                        el.style.outline = '3px solid #ff8c00';
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => { el.style.outline = orig; }, 1500);
                    },
                    args: [step._px, step._py]
                });
            });
        }
        return;
    }

    const target = e.target.closest('[data-makro-action]');
    if (!target) return;

    const action = target.dataset.makroAction;
    const i = parseInt(target.dataset.index);
    const m = makros[i];

    if (action === 'toggle-steps') {
        const el = document.getElementById(`makro-content-${i}`);
        if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
    }
    else if (action === 'step') {
        openStepPlayback(i);
    }
    else if (action === 'delete') {
        makros.splice(i, 1);
        chrome.storage.sync.set({ makros }, renderMakros);
    }
    else if (action === 'edit') {
        if (m) {
            document.getElementById('editMakroIndex').value = i;
            document.getElementById('makroTitleInput').value = m.title || '';
            document.getElementById('makroStepsInput').value = JSON.stringify(m.steps, null, 2);
            document.getElementById('makroColor').value = m.color || '#ff8c00';
            document.getElementById('makroRepeatInput').value = m.repeat || 1;
            const sd = (m.speedDelay !== undefined) ? m.speedDelay : 700;
            const speedActive = sd > 0;
            document.getElementById('makroSpeedToggle').checked = speedActive;
            document.getElementById('makroSpeedInput').value = speedActive ? sd : 700;
            document.getElementById('makroSpeedRow').style.display = speedActive ? 'flex' : 'none';
            document.getElementById('makroAskRepeatInput').checked = !!m.askRepeatBeforePlay;
            document.getElementById('makroScrollToStartInput').checked = !!m.scrollToStart;
            document.getElementById('makroScrollToEndInput').checked = !!m.scrollToEnd;
            document.getElementById('makroLockScrollInput').checked = !!m.lockScroll;
            const mMethod = m.method || 2;
            document.getElementById('makroMethodInput').value = mMethod;
            ['1','2','3','4'].forEach(n => document.getElementById('methodBtn' + n).classList.remove('active'));
            document.getElementById('methodBtn' + mMethod).classList.add('active');
            document.getElementById('makroRepeatDelayInput').value = m.repeatDelay || 0;
            document.getElementById('makroWaitReloadInput').checked = !!m.waitReloadBetweenRepeats;

            document.getElementById('mainContainer').style.display = 'none';
            document.getElementById('makroInputGroup').style.display = 'flex';
            renderRecentColors();
            // Zahlen-Markierungen automatisch auf der Seite anzeigen
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) return;
                chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: injectEditMarkersFunc, args: [m.steps] });
                document.getElementById('showStepsOnPageBtn').style.display = 'none';
                document.getElementById('applyPageEditsBtn').style.display = 'flex';
                document.getElementById('cancelPageEditsBtn').style.display = 'flex';
            });
        }
    }
    else if (action === 'run') {
        if (m && m.steps) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) return;
                if (m.domain) {
                    let currentDomain = '';
                    try { currentDomain = new URL(tabs[0].url).hostname; } catch(e) {}
                    if (currentDomain && m.domain !== currentDomain) {
                        const ok = confirm(`⚠️ Dieses Makro wurde auf „${m.domain}" aufgenommen.\nAktueller Tab: „${currentDomain}".\nTrotzdem ausführen?`);
                        if (!ok) return;
                    }
                }
                if (m.askRepeatBeforePlay) {
                    document.getElementById('makroRepeatAskInput').value = m.repeat || 1;
                    document.getElementById('mainContainer').style.display = 'none';
                    document.getElementById('makroRepeatAskDialog').style.display = 'block';
                    window._pendingPlayTabId = tabs[0].id;
                    window._pendingPlayMakro = m;
                    return;
                }
                playMakroFull(tabs[0].id, m, m.steps);
            });
        }
    }
});

// Drag & Drop für Schritt-Reihenfolge in Makro-Karte
let stepDragSrc = null;
document.getElementById('makrosList').addEventListener('dragstart', (e) => {
    const item = e.target.closest('.makro-step-item');
    if (!item) return;
    stepDragSrc = { mi: parseInt(item.dataset.makroIdx), si: parseInt(item.dataset.stepIdx) };
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { item.style.opacity = '0.5'; }, 0);
});
document.getElementById('makrosList').addEventListener('dragend', (e) => {
    const item = e.target.closest('.makro-step-item');
    if (item) item.style.opacity = '';
    stepDragSrc = null;
});
document.getElementById('makrosList').addEventListener('dragover', (e) => {
    const item = e.target.closest('.makro-step-item');
    if (item && stepDragSrc) { e.preventDefault(); item.style.outline = '2px dashed var(--accent, #ff8c00)'; }
});
document.getElementById('makrosList').addEventListener('dragleave', (e) => {
    const item = e.target.closest('.makro-step-item');
    if (item) item.style.outline = '';
});
document.getElementById('makrosList').addEventListener('drop', (e) => {
    const item = e.target.closest('.makro-step-item');
    if (!item || !stepDragSrc) return;
    item.style.outline = '';
    const mi = parseInt(item.dataset.makroIdx);
    const si = parseInt(item.dataset.stepIdx);
    if (mi !== stepDragSrc.mi || si === stepDragSrc.si) return;
    const steps = makros[mi].steps;
    const moved = steps.splice(stepDragSrc.si, 1)[0];
    steps.splice(si, 0, moved);
    chrome.storage.sync.set({ makros }, renderMakros);
});

// Recorder-Injektion (wird bei Start und nach jedem Reload/Navigation neu aufgerufen)
function injectRecorder(tabId) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: (method) => {
            if (window._makroRecordingActive) return;
            window._makroRecordingActive = true;
            window._makroRecordingMethod = method;

            // Schritte werden über chrome.storage.session statt per chrome.runtime.sendMessage
            // übertragen: reine Schreibzugriffe mit eigenem Schlüssel (kein Read-Modify-Write,
            // also race-frei) werden vom Browser-Prozess auch dann noch zugestellt, wenn der
            // auslösende Klick sofort zu einer Navigation/Unload führt - sendMessage kann in
            // diesem Fall die Nachricht verlieren, bevor sie beim Sidepanel ankommt.
            window._makroSendStep = (step) => {
                try {
                    const key = '_makroStep_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                    chrome.storage.session.set({ [key]: step });
                } catch(e) {}
            };

            const style = document.createElement('style');
            style.id = '_makroStyle';
            style.textContent = `
                ._makro-hover { outline: 2px dashed #ff8c00 !important; outline-offset: 3px !important; cursor: crosshair !important; }
                ._makro-recorded { outline: 3px solid #4caf50 !important; outline-offset: 3px !important; }
                @keyframes _makroFlash { 0%,100%{opacity:1} 50%{opacity:0.4} }
                ._makro-recorded { animation: _makroFlash 0.4s ease 2; }
            `;
            document.head.appendChild(style);

            const getPath = (el) => {
                if (!el) return '*';
                if (el.id) return `#${CSS.escape(el.id)}`;
                if (el.dataset && el.dataset.testid) return `[data-testid="${el.dataset.testid}"]`;
                if (el.getAttribute && el.getAttribute('aria-label')) return `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute('aria-label')}"]`;
                if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
                if (el.getAttribute && el.getAttribute('placeholder')) return `${el.tagName.toLowerCase()}[placeholder="${el.getAttribute('placeholder')}"]`;
                const tag = el.tagName ? el.tagName.toLowerCase() : '*';
                if (el.parentElement) {
                    const siblings = Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName);
                    if (siblings.length > 1) {
                        const idx = siblings.indexOf(el) + 1;
                        return `${tag}:nth-of-type(${idx})`;
                    }
                }
                return tag;
            };

            window._makroHoverHandler = (e) => {
                document.querySelectorAll('._makro-hover').forEach(el => el.classList.remove('_makro-hover'));
                e.target.classList.add('_makro-hover');
            };
            window._makroMouseOutHandler = (e) => {
                e.target.classList.remove('_makro-hover');
            };

            window._makroClickHandler = (e) => {
                try {
                    let target = e.target;
                    let candidate = e.target;
                    for (let d = 0; d < 5 && candidate && candidate !== document.body; d++) {
                        const tag = candidate.tagName.toLowerCase();
                        const role = (candidate.getAttribute && candidate.getAttribute('role')) || '';
                        if (['button','a','input','select','label'].includes(tag) ||
                            role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') {
                            target = candidate; break;
                        }
                        candidate = candidate.parentElement;
                    }
                    const path = getPath(target);
                    const rect = target.getBoundingClientRect();
                    const px = Math.round(rect.left + rect.width / 2 + window.scrollX);
                    const py = Math.round(rect.top + rect.height / 2 + window.scrollY);
                    window._makroSendStep({ type: 'click', target: path, _px: px, _py: py });
                    e.target.classList.remove('_makro-hover');
                    target.classList.add('_makro-recorded');
                    setTimeout(() => target.classList.remove('_makro-recorded'), 800);
                } catch (err) {}
            };

            window._makroChangeHandler = (e) => {
                try {
                    const path = getPath(e.target);
                    window._makroSendStep({ type: 'type', target: path, value: e.target.value || e.target.innerText });
                    e.target.classList.add('_makro-recorded');
                    setTimeout(() => e.target.classList.remove('_makro-recorded'), 800);
                } catch (err) {}
            };

            document.addEventListener('mouseover', window._makroHoverHandler, { capture: true });
            document.addEventListener('mouseout', window._makroMouseOutHandler, { capture: true });
            document.addEventListener('click', window._makroClickHandler, { capture: true });
            document.addEventListener('change', window._makroChangeHandler, { capture: true });

            if (method === 3 || method === 1) {
                // M3/M1: click als {selector, _px, _py} speichern (statt {target, _px, _py})
                // Überschreibe den Standard-click-Handler für M3 um selector-Feld korrekt zu setzen
                if (method === 3) {
                    document.removeEventListener('click', window._makroClickHandler, { capture: true });
                    window._makroClickHandler = (e) => {
                        try {
                            let target = e.target;
                            let candidate = e.target;
                            for (let d = 0; d < 5 && candidate && candidate !== document.body; d++) {
                                const tag = candidate.tagName.toLowerCase();
                                const role = (candidate.getAttribute && candidate.getAttribute('role')) || '';
                                if (['button','a','input','select','label'].includes(tag) ||
                                    role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') {
                                    target = candidate; break;
                                }
                                candidate = candidate.parentElement;
                            }
                            const path = getPath(target);
                            const rect = target.getBoundingClientRect();
                            const px = Math.round(rect.left + rect.width / 2 + window.scrollX);
                            const py = Math.round(rect.top + rect.height / 2 + window.scrollY);
                            window._makroSendStep({ type: 'click', selector: path, _px: px, _py: py });
                            e.target.classList.remove('_makro-hover');
                            target.classList.add('_makro-recorded');
                            setTimeout(() => target.classList.remove('_makro-recorded'), 800);
                        } catch (err) {}
                    };
                    document.addEventListener('click', window._makroClickHandler, { capture: true });
                }
            }
            if (method === 1 || method === 3) {
                // M1: dblclick
                window._makroDblClickHandler = (e) => {
                    try {
                        let t = e.target;
                        const path = getPath(t);
                        const rect = t.getBoundingClientRect();
                        const px = Math.round(rect.left + rect.width / 2 + window.scrollX);
                        const py = Math.round(rect.top + rect.height / 2 + window.scrollY);
                        window._makroSendStep({ type: 'doubleclick', selector: path, _px: px, _py: py });
                    } catch(err) {}
                };
                // M1: rightclick
                window._makroContextHandler = (e) => {
                    try {
                        e.preventDefault();
                        const path = getPath(e.target);
                        const rect = e.target.getBoundingClientRect();
                        const px = Math.round(rect.left + rect.width / 2 + window.scrollX);
                        const py = Math.round(rect.top + rect.height / 2 + window.scrollY);
                        window._makroSendStep({ type: 'rightclick', selector: path, _px: px, _py: py });
                    } catch(err) {}
                };
                // M1: scroll (debounced)
                let _scrollTimer = null;
                let _lastScrollX = window.scrollX, _lastScrollY = window.scrollY;
                window._makroScrollHandler = () => {
                    clearTimeout(_scrollTimer);
                    _scrollTimer = setTimeout(() => {
                        const dx = Math.abs(window.scrollX - _lastScrollX);
                        const dy = Math.abs(window.scrollY - _lastScrollY);
                        if (dx > 50 || dy > 50) {
                            window._makroSendStep({ type: 'scroll', x: Math.round(window.scrollX), y: Math.round(window.scrollY) });
                            _lastScrollX = window.scrollX; _lastScrollY = window.scrollY;
                        }
                    }, 500);
                };
                // M1: change on <select> → recorded as 'select' type (override change handler's 'type')
                // The existing _makroChangeHandler already covers this but we want 'select' type for select elements
                // So we add a separate handler that fires first for select elements
                window._makroSelectHandler = (e) => {
                    if (e.target.tagName !== 'SELECT') return;
                    try {
                        const path = getPath(e.target);
                        window._makroSendStep({ type: 'select', selector: path, value: e.target.value });
                        e.target.classList.add('_makro-recorded');
                        setTimeout(() => e.target.classList.remove('_makro-recorded'), 800);
                        e.stopPropagation(); // prevent generic change handler from also firing
                    } catch(err) {}
                };
                document.addEventListener('dblclick', window._makroDblClickHandler, { capture: true });
                document.addEventListener('contextmenu', window._makroContextHandler, { capture: true });
                document.addEventListener('scroll', window._makroScrollHandler, { capture: true, passive: true });
                document.addEventListener('change', window._makroSelectHandler, { capture: true });
            }
            // Alle Methoden: jede Tastatureingabe aufzeichnen, exakt wie eingegeben (nur reine
            // Modifier-Tastendrücke ohne weitere Taste werden übersprungen).
            window._makroKeyHandler = (e) => {
                try {
                    const pureModifier = ['Shift','Control','Alt','Meta','CapsLock'].includes(e.key);
                    if (pureModifier) return;
                    const modifiers = [];
                    if (e.ctrlKey) modifiers.push('ctrl');
                    if (e.shiftKey) modifiers.push('shift');
                    if (e.altKey) modifiers.push('alt');
                    window._makroSendStep({ type: 'keypress', key: e.key, modifiers });
                } catch(err) {}
            };
            document.addEventListener('keydown', window._makroKeyHandler, { capture: true });
            if (method === 4) {
                // M4: Mausbewegungen 1:1 aufzeichnen (throttled 40ms)
                let _m4LastSend = 0;
                let _m4Points = [];
                let _m4StartT = Date.now();
                window._makroMoveHandler = (e) => {
                    const now = Date.now();
                    if (now - _m4LastSend < 40) return;
                    _m4LastSend = now;
                    const px = Math.round(e.clientX + window.scrollX);
                    const py = Math.round(e.clientY + window.scrollY);
                    _m4Points.push({ x: px, y: py, t: now - _m4StartT });
                };
                // Bei Klick: aktuelle Punkte als mousemovepath-Schritt senden, dann click-Schritt
                document.removeEventListener('click', window._makroClickHandler, { capture: true });
                window._makroClickHandler = (e) => {
                    try {
                        const px = Math.round(e.clientX + window.scrollX);
                        const py = Math.round(e.clientY + window.scrollY);
                        const now = Date.now();
                        _m4Points.push({ x: px, y: py, t: now - _m4StartT });
                        if (_m4Points.length > 1) {
                            window._makroSendStep({ type: 'mousemovepath', points: _m4Points.slice() });
                        }
                        _m4Points = [];
                        _m4StartT = Date.now();
                        window._makroSendStep({ type: 'click', selector: '', _px: px, _py: py });
                        e.target.classList.add('_makro-recorded');
                        setTimeout(() => e.target.classList.remove('_makro-recorded'), 800);
                    } catch(err) {}
                };
                document.addEventListener('mousemove', window._makroMoveHandler, { capture: true, passive: true });
                document.addEventListener('click', window._makroClickHandler, { capture: true });
            }
        },
        args: [recordingMethod]
    });
}

// Schritte aus dem injizierten Recorder puffern: window._makroSendStep (im Recorder) schreibt
// jeden Schritt unter einem eigenen Schlüssel in chrome.storage.session; hier abholen und
// wieder entfernen, sobald er im recordingBuffer gelandet ist.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !isRecording) return;
    const consumedKeys = [];
    Object.keys(changes).forEach(key => {
        if (!key.startsWith('_makroStep_')) return;
        if (changes[key].newValue !== undefined) recordingBuffer.push(changes[key].newValue);
        consumedKeys.push(key);
    });
    if (consumedKeys.length) chrome.storage.session.remove(consumedKeys);
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg._makroStepPosUpdate) {
        // Nur die Felder des aktuell angezeigten Schritts aktualisieren
        const upd = msg._makroStepPosUpdate;
        if (upd.idx === undefined || (stepPlaybackState && upd.idx === stepPlaybackState.stepIndex)) {
            document.getElementById('stepEditPx').value = upd.px;
            document.getElementById('stepEditPy').value = upd.py;
        }
    }
});

// Nach Reload/Navigation Recorder neu injizieren (Puffer bleibt erhalten)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (isRecording && tabId === recordingTabId) {
        if (changeInfo.status === 'loading' && changeInfo.url) {
            // Navigation erkannt → waitForReload-Schritt einfügen
            recordingBuffer.push({ type: 'waitForReload', timeout: 10000 });
        }
        if (changeInfo.status === 'complete') {
            injectRecorder(tabId);
        }
    }
    // Wiedergabe: auf vollständiges Neuladen zwischen Wiederholungen warten
    if (runningMakroState && tabId === (runningMakroState.currentTabId || runningMakroState.tabId) && changeInfo.status === 'complete') {
        runningMakroState.reloadSeen = true;
        if (runningMakroState.awaitingReload) {
            runningMakroState.awaitingReload = false;
            if (runningMakroState.fallbackTimer) { clearTimeout(runningMakroState.fallbackTimer); runningMakroState.fallbackTimer = null; }
            setTimeout(runMakroIteration, runningMakroState.repeatDelay);
        }
    }
});

// M4: neuen Tab während der Aufnahme merken (wird bei Aktivierung als 'newTab' erkannt)
chrome.tabs.onCreated.addListener((tab) => {
    if (isRecording && recordingMethod === 4) {
        recordingCreatedTabIds.add(tab.id);
    }
});

// M4: Tab-/Seitenwechsel während der Aufnahme als switchTab/newTab-Schritt aufzeichnen,
// damit die komplette Session (auch über mehrere Tabs hinweg) 1:1 wiedergegeben werden kann.
chrome.tabs.onActivated.addListener(({ tabId }) => {
    if (!isRecording || recordingMethod !== 4 || tabId === recordingTabId) return;
    let tabIndex = recordingTabIndexMap[tabId];
    const isNewTab = tabIndex === undefined && recordingCreatedTabIds.has(tabId);
    if (tabIndex === undefined) {
        tabIndex = recordingNextTabIndex++;
        recordingTabIndexMap[tabId] = tabIndex;
    }
    const afterStepQueued = () => {
        recordingTabId = tabId;
        injectRecorder(tabId);
    };
    if (isNewTab) {
        chrome.tabs.get(tabId, (tab) => {
            recordingBuffer.push({ type: 'newTab', tabIndex, url: (tab && tab.url) || 'about:blank' });
            afterStepQueued();
        });
    } else {
        recordingBuffer.push({ type: 'switchTab', tabIndex });
        afterStepQueued();
    }
});

// Method-Toggle im Editor
['1','2','3','4'].forEach(n => {
    document.getElementById('methodBtn' + n).addEventListener('click', () => {
        ['1','2','3','4'].forEach(m => document.getElementById('methodBtn' + m).classList.remove('active'));
        document.getElementById('methodBtn' + n).classList.add('active');
        document.getElementById('makroMethodInput').value = n;
    });
});

// Aufnahme-Dialog Method-Toggle
['1','2','3','4'].forEach(n => {
    document.getElementById('dialogMethodBtn' + n).addEventListener('click', () => {
        ['1','2','3','4'].forEach(m => document.getElementById('dialogMethodBtn' + m).classList.remove('active'));
        document.getElementById('dialogMethodBtn' + n).classList.add('active');
        recordingMethod = parseInt(n);
    });
});

document.getElementById('cancelRecordDialogBtn').addEventListener('click', () => {
    document.getElementById('recordMethodDialog').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
});

document.getElementById('startRecordBtn').addEventListener('click', () => {
    document.getElementById('recordMethodDialog').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { alert("Kein aktiver Tab für eine Aufnahme gefunden."); return; }
        isRecording = true;
        const btn = document.getElementById('recordMakroBtn');
        btn.innerHTML = '<span class="record-dot"></span> ⏹ Stoppen';
        btn.classList.add('recording');
        recordingTabId = tabs[0].id;
        recordingBuffer = [];
        recordingTabIndexMap = { [recordingTabId]: 0 };
        recordingNextTabIndex = 1;
        recordingCreatedTabIds = new Set();
        document.getElementById('recordingWaitBar').style.display = 'flex';
        injectRecorder(recordingTabId);
    });
});

// Wartezeit während Aufnahme einfügen
document.getElementById('insertWaitBtn').addEventListener('click', () => {
    if (!isRecording) return;
    const dur = parseInt(document.getElementById('insertWaitDuration').value) || 1000;
    recordingBuffer.push({ type: 'wait', duration: dur });
});
document.getElementById('insertReloadBtn').addEventListener('click', () => {
    if (!isRecording) return;
    recordingBuffer.push({ type: 'waitForReload', timeout: 10000 });
});

// Schritt im Editor einfügen
document.getElementById('addWaitStepBtn').addEventListener('click', () => {
    const dur = parseInt(document.getElementById('addWaitStepDuration').value) || 1000;
    const ta = document.getElementById('makroStepsInput');
    let steps = [];
    try { steps = JSON.parse(ta.value || '[]'); } catch(e) { steps = []; }
    steps.push({ type: 'wait', duration: dur });
    ta.value = JSON.stringify(steps, null, 2);
});
document.getElementById('addReloadStepBtn').addEventListener('click', () => {
    const ta = document.getElementById('makroStepsInput');
    let steps = [];
    try { steps = JSON.parse(ta.value || '[]'); } catch(e) { steps = []; }
    steps.push({ type: 'waitForReload', timeout: 10000 });
    ta.value = JSON.stringify(steps, null, 2);
});

// Live Aufnahme-Logik für Makros
document.getElementById('recordMakroBtn').addEventListener('click', () => {
    if (!isRecording) {
        // Zeige Methoden-Dialog statt sofort zu starten
        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('recordMethodDialog').style.display = 'flex';
        return;
    }
    // Stoppen
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;

        // Letzte, noch nicht abgeholte Schritte aus chrome.storage.session nachziehen, bevor
        // isRecording auf false gesetzt wird (sonst würde der storage.onChanged-Listener sie
        // ignorieren, weil er isRecording prüft).
        chrome.storage.session.get(null, (all) => {
            const pendingKeys = Object.keys(all || {}).filter(k => k.startsWith('_makroStep_')).sort();
            pendingKeys.forEach(k => recordingBuffer.push(all[k]));
            if (pendingKeys.length) chrome.storage.session.remove(pendingKeys);

            isRecording = false;
            const btn = document.getElementById('recordMakroBtn');
            btn.innerHTML = '<span class="record-dot"></span> REC';
            btn.classList.remove('recording');
            document.getElementById('recordingWaitBar').style.display = 'none';

            // M4: Recorder auch in allen anderen während der Aufnahme besuchten Tabs entfernen
            // (best-effort, da einzelne Tabs zwischenzeitlich geschlossen worden sein können).
            Object.keys(recordingTabIndexMap).map(Number).filter(id => id !== tabs[0].id).forEach(otherTabId => {
                chrome.scripting.executeScript({ target: { tabId: otherTabId }, func: cleanupMakroRecorderListeners }).catch(() => {});
            });

            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: cleanupMakroRecorderListeners
            }, () => {
                const recordedSteps = recordingBuffer;
                recordingTabId = null;
                recordingBuffer = [];
                if (recordedSteps.length > 0) {
                    const mName = prompt("Makro-Aufnahme erfolgreich! Name eingeben:", `Makro vom ${new Date().toLocaleTimeString()}`);
                    if (mName !== null) {
                        let recDomain = '';
                        try { recDomain = tabs[0] ? new URL(tabs[0].url).hostname : ''; } catch(e) {}
                        const newMakro = {
                            title: mName.trim() || "Aufgenommenes Makro",
                            steps: recordedSteps,
                            color: "#ff8c00",
                            speedDelay: 700,
                            scrollToEnd: true,
                            domain: recDomain,
                            method: recordingMethod
                        };
                        makros.push(newMakro);
                        chrome.storage.sync.set({ makros }, renderMakros);
                    }
                } else {
                    alert("Es wurden keine Klicks oder Eingaben während der Aufnahme registriert.");
                }
            });
        });
    });
});

function cleanupMakroRecorderListeners() {
    delete window._makroSendStep;
    if (window._makroClickHandler) document.removeEventListener('click', window._makroClickHandler, { capture: true });
    if (window._makroChangeHandler) document.removeEventListener('change', window._makroChangeHandler, { capture: true });
    if (window._makroHoverHandler) document.removeEventListener('mouseover', window._makroHoverHandler, { capture: true });
    if (window._makroMouseOutHandler) document.removeEventListener('mouseout', window._makroMouseOutHandler, { capture: true });
    if (window._makroDblClickHandler) document.removeEventListener('dblclick', window._makroDblClickHandler, { capture: true });
    if (window._makroContextHandler) document.removeEventListener('contextmenu', window._makroContextHandler, { capture: true });
    if (window._makroKeyHandler) document.removeEventListener('keydown', window._makroKeyHandler, { capture: true });
    if (window._makroScrollHandler) document.removeEventListener('scroll', window._makroScrollHandler, { capture: true });
    if (window._makroSelectHandler) document.removeEventListener('change', window._makroSelectHandler, { capture: true });
    if (window._makroMoveHandler) document.removeEventListener('mousemove', window._makroMoveHandler, { capture: true });

    delete window._makroClickHandler; delete window._makroChangeHandler;
    delete window._makroHoverHandler; delete window._makroMouseOutHandler;
    delete window._makroDblClickHandler; delete window._makroContextHandler;
    delete window._makroKeyHandler; delete window._makroScrollHandler;
    delete window._makroSelectHandler; delete window._makroMoveHandler;
    delete window._makroRecordingActive; delete window._makroRecordingMethod;

    const s = document.getElementById('_makroStyle');
    if (s) s.remove();
    document.querySelectorAll('._makro-hover, ._makro-recorded').forEach(el => {
        el.classList.remove('_makro-hover', '_makro-recorded');
    });
}

function closeMakroEditMode() {
    document.getElementById('makroInputGroup').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('editMakroIndex').value = "";
    document.getElementById('makroTitleInput').value = '';
    document.getElementById('makroStepsInput').value = '';
    document.getElementById('makroRepeatInput').value = '1';
    document.getElementById('makroRepeatDelayInput').value = '0';
    document.getElementById('makroWaitReloadInput').checked = false;
    document.getElementById('makroSpeedToggle').checked = true;
    document.getElementById('makroSpeedInput').value = '700';
    document.getElementById('makroSpeedRow').style.display = 'flex';
    document.getElementById('makroAskRepeatInput').checked = false;
    document.getElementById('makroScrollToStartInput').checked = false;
    document.getElementById('makroScrollToEndInput').checked = true;
    document.getElementById('makroLockScrollInput').checked = false;
    document.getElementById('showStepsOnPageBtn').style.display = 'flex';
    document.getElementById('applyPageEditsBtn').style.display = 'none';
    document.getElementById('cancelPageEditsBtn').style.display = 'none';
    document.getElementById('makroMethodInput').value = '2';
    document.getElementById('methodBtn2').classList.add('active');
    document.getElementById('methodBtn1').classList.remove('active');
    // Markierungen von der Seite entfernen
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
                sessionStorage.removeItem('_makroEditSteps');
                if (window._makroMarkerScrollHandler) { window.removeEventListener('scroll', window._makroMarkerScrollHandler); delete window._makroMarkerScrollHandler; }
                document.querySelectorAll('#_makroMarkerContainer').forEach(c => { if(c._makroMutObs) c._makroMutObs.disconnect(); if(c._makroDialogObs) c._makroDialogObs.disconnect(); try{c.hidePopover();}catch(e){} });
                document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle, #_makroMarkerContainer').forEach(el => el.remove());
            }
        });
    });
}

document.getElementById('cancelMakroBtn').addEventListener('click', closeMakroEditMode);

document.getElementById('makroSpeedToggle').addEventListener('change', (e) => {
    document.getElementById('makroSpeedRow').style.display = e.target.checked ? 'flex' : 'none';
});

function openStepPlayback(i) {
    const m = makros[i];
    if (!m || !m.steps || m.steps.length === 0) return;
    const doOpen = () => {
        stepPlaybackState = { makro: m, stepIndex: 0, repeat: m.repeat || 1, currentRun: 0 };
        document.getElementById('stepPlaybackTitle').textContent = m.title || 'Makro';
        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('stepPlaybackPanel').style.display = 'flex';
        renderStepPanel();
        showStepMarkers();
    };
    if (m.domain) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && m.domain) {
                let currentDomain = '';
                try { currentDomain = new URL(tabs[0].url).hostname; } catch(e) {}
                if (currentDomain && m.domain !== currentDomain) {
                    const ok = confirm(`⚠️ Dieses Makro wurde auf „${m.domain}" aufgenommen.\nAktueller Tab: „${currentDomain}".\nTrotzdem ausführen?`);
                    if (!ok) return;
                }
            }
            doOpen();
        });
    } else {
        doOpen();
    }
}

function renderStepPanel() {
    if (!stepPlaybackState) return;
    const { makro, stepIndex, repeat, currentRun } = stepPlaybackState;
    const totalSteps = makro.steps.length;
    const step = makro.steps[stepIndex];
    const runLabel = repeat > 1 ? ` (Durchlauf ${currentRun + 1}/${repeat})` : '';
    document.getElementById('stepPlaybackCounter').textContent = `Schritt ${stepIndex + 1} / ${totalSteps}${runLabel}`;

    const typeLabels = { click:'🖱 Klick', type:'⌨ Text eingeben', wait:'⏱ Pause', waitForReload:'🔄 Warten auf Reload', navigate:'🌐 Navigation', scroll:'🔃 Scrollen', keypress:'⌨ Tastendruck', select:'☰ Dropdown-Auswahl', doubleclick:'🖱🖱 Doppelklick', rightclick:'🖱❯ Rechtsklick', hover:'↗ Hover', switchTab:'⇄ Tab wechseln', newTab:'🗗 Neuer Tab', mousemovepath:'↝ Mausbewegung' };
    let desc = typeLabels[step.type] || step.type;
    if (step.type === 'click') desc += `\nZiel: ${step.target||''}\nPosition: x=${step._px}, y=${step._py}`;
    else if (step.type === 'type') desc += `\nZiel: ${step.target||''}\nWert: "${step.value||''}"`;
    else if (step.type === 'wait') desc += `\nDauer: ${step.duration||1000}ms`;
    else if (step.type === 'waitForReload') desc += `\nMax. Wartezeit: ${step.timeout||10000}ms`;
    else if (step.type === 'navigate') desc += `\nURL: ${step.url||''}`;
    else if (step.type === 'scroll') desc += step.selector ? `\nSelektor: ${step.selector}` : `\nPosition: x=${step.x||0}, y=${step.y||0}`;
    else if (step.type === 'keypress') desc += `\nTaste: ${(step.modifiers||[]).join('+')}${step.modifiers?.length?'+':''}${step.key||''}`;
    else if (step.type === 'select') desc += `\nSelektor: ${step.selector||''}\nWert: ${step.value||''}`;
    else if (['doubleclick','rightclick','hover'].includes(step.type)) desc += step.selector ? `\nSelektor: ${step.selector}` : `\nPosition: x=${step._px}, y=${step._py}`;
    else if (step.type === 'newTab') desc += `\nURL: ${step.url||''}`;
    document.getElementById('stepPlaybackDesc').textContent = desc;

    // Hide all edit panels
    ['stepEditClick','stepEditType','stepEditWait','stepEditWaitReload','stepEditNavigate','stepEditScroll','stepEditKeypress','stepEditSelect','stepEditSelectorOnly'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    document.getElementById('showStepOnPageBtn').style.display = 'none';

    if (step.type === 'click') {
        document.getElementById('stepEditClick').style.display = 'flex';
        document.getElementById('stepEditPx').value = step._px || '';
        document.getElementById('stepEditPy').value = step._py || '';
    } else if (step.type === 'type') {
        document.getElementById('stepEditType').style.display = 'flex';
        document.getElementById('stepEditValue').value = step.value || '';
    } else if (step.type === 'wait') {
        document.getElementById('stepEditWait').style.display = 'flex';
        document.getElementById('stepEditWaitDuration').value = step.duration || 1000;
    } else if (step.type === 'waitForReload') {
        document.getElementById('stepEditWaitReload').style.display = 'flex';
        document.getElementById('stepEditReloadTimeout').value = step.timeout || 10000;
    } else if (step.type === 'navigate') {
        document.getElementById('stepEditNavigate').style.display = 'flex';
        document.getElementById('stepEditUrl').value = step.url || '';
    } else if (step.type === 'scroll') {
        document.getElementById('stepEditScroll').style.display = 'flex';
        document.getElementById('stepEditScrollSelector').value = step.selector || '';
        document.getElementById('stepEditScrollX').value = step.x || '';
        document.getElementById('stepEditScrollY').value = step.y || '';
    } else if (step.type === 'keypress') {
        document.getElementById('stepEditKeypress').style.display = 'flex';
        document.getElementById('stepEditKey').value = step.key || '';
        document.getElementById('stepEditModCtrl').checked = (step.modifiers||[]).includes('ctrl');
        document.getElementById('stepEditModShift').checked = (step.modifiers||[]).includes('shift');
        document.getElementById('stepEditModAlt').checked = (step.modifiers||[]).includes('alt');
    } else if (step.type === 'select') {
        document.getElementById('stepEditSelect').style.display = 'flex';
        document.getElementById('stepEditSelectSelector').value = step.selector || '';
        document.getElementById('stepEditSelectValue').value = step.value || '';
    } else if (['doubleclick','rightclick','hover'].includes(step.type)) {
        document.getElementById('stepEditSelectorOnly').style.display = 'flex';
        document.getElementById('stepEditSelector').value = step.selector || '';
    }
    document.getElementById('stepEditSaveBtn').textContent = '💾 Schritt speichern';
}

// Zeigt alle nummerierten Markierungen für das aktuelle Makro auf der Seite an
function showStepMarkers() {
    if (!stepPlaybackState) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: injectEditMarkersFunc, args: [stepPlaybackState.makro.steps] });
    });
}

// Liest verschobene Marker-Positionen von der Seite und übernimmt sie in die Schritte
function syncMarkerPositions(cb) {
    if (!stepPlaybackState) { if (cb) cb(); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { if (cb) cb(); return; }
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => JSON.parse(sessionStorage.getItem('_makroEditSteps') || 'null')
        }, (results) => {
            const updated = results?.[0]?.result;
            if (updated && stepPlaybackState) {
                updated.forEach((s, idx) => {
                    const target = stepPlaybackState.makro.steps[idx];
                    if (s && target && s._px !== undefined) {
                        target._px = s._px;
                        target._py = s._py;
                    }
                });
                chrome.storage.sync.set({ makros });
            }
            if (cb) cb();
        });
    });
}

function advanceStep() {
    if (!stepPlaybackState) return;
    syncMarkerPositions(() => {
        if (!stepPlaybackState) return;
        const { makro, repeat } = stepPlaybackState;
        stepPlaybackState.stepIndex++;
        if (stepPlaybackState.stepIndex >= makro.steps.length) {
            stepPlaybackState.stepIndex = 0;
            stepPlaybackState.currentRun++;
            if (stepPlaybackState.currentRun >= repeat) {
                closeStepPanel();
                return;
            }
        }
        renderStepPanel();
        showStepMarkers();
    });
}

function closeStepPanel() {
    stepPlaybackState = null;
    document.getElementById('stepPlaybackPanel').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('showStepOnPageBtn').style.display = 'none';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
                if (window._makroMarkerScrollHandler) { window.removeEventListener('scroll', window._makroMarkerScrollHandler); delete window._makroMarkerScrollHandler; }
                document.querySelectorAll('#_makroMarkerContainer').forEach(c => { if(c._makroMutObs) c._makroMutObs.disconnect(); if(c._makroDialogObs) c._makroDialogObs.disconnect(); try{c.hidePopover();}catch(e){} });
                document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle, #_makroMarkerContainer').forEach(el => el.remove());
            }
        });
    });
}

document.getElementById('stepPlaybackAbortBtn').addEventListener('click', closeStepPanel);
document.getElementById('stepPlaybackSkipBtn').addEventListener('click', advanceStep);
document.getElementById('stepPlaybackRunBtn').addEventListener('click', () => {
    if (!stepPlaybackState) return;
    const step = stepPlaybackState.makro.steps[stepPlaybackState.stepIndex];
    // Apply edits from input fields
    if (step.type === 'click') {
        const newPx = parseInt(document.getElementById('stepEditPx').value);
        const newPy = parseInt(document.getElementById('stepEditPy').value);
        if (!isNaN(newPx)) step._px = newPx;
        if (!isNaN(newPy)) step._py = newPy;
    } else if (step.type === 'type') {
        step.value = document.getElementById('stepEditValue').value;
    } else if (step.type === 'wait') {
        const dur = parseInt(document.getElementById('stepEditWaitDuration').value);
        if (!isNaN(dur)) step.duration = dur;
        document.getElementById('stepPlaybackDesc').textContent = `⏱ Warte ${step.duration||1000}ms…`;
        setTimeout(() => { chrome.storage.sync.set({ makros }); advanceStep(); }, step.duration || 1000);
        return;
    } else if (step.type === 'waitForReload') {
        document.getElementById('stepPlaybackDesc').textContent = '🔄 Warte auf Seitenneuladen…';
        chrome.storage.sync.set({ makros });
        advanceStep();
        return;
    } else if (step.type === 'navigate') {
        step.url = document.getElementById('stepEditUrl').value || step.url;
    } else if (step.type === 'scroll') {
        step.selector = document.getElementById('stepEditScrollSelector').value;
        step.x = parseInt(document.getElementById('stepEditScrollX').value) || step.x || 0;
        step.y = parseInt(document.getElementById('stepEditScrollY').value) || step.y || 0;
    } else if (step.type === 'keypress') {
        step.key = document.getElementById('stepEditKey').value || step.key;
        const mods = [];
        if (document.getElementById('stepEditModCtrl').checked) mods.push('ctrl');
        if (document.getElementById('stepEditModShift').checked) mods.push('shift');
        if (document.getElementById('stepEditModAlt').checked) mods.push('alt');
        step.modifiers = mods;
    } else if (step.type === 'select') {
        step.selector = document.getElementById('stepEditSelectSelector').value || step.selector;
        step.value = document.getElementById('stepEditSelectValue').value;
    } else if (['doubleclick','rightclick','hover'].includes(step.type)) {
        step.selector = document.getElementById('stepEditSelector').value || step.selector;
    }
    // Remove any page marker before executing
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: () => { document.querySelectorAll('#_makroMarkerContainer').forEach(c => { if(c._makroMutObs) c._makroMutObs.disconnect(); if(c._makroDialogObs) c._makroDialogObs.disconnect(); try{c.hidePopover();}catch(e){} }); document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle, #_makroMarkerContainer').forEach(el => el.remove()); }
            });
        }
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { advanceStep(); return; }
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (step) => {
                const showClickIndicator = (x, y) => {
                    const dot = document.createElement('div');
                    dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:24px;height:24px;border-radius:50%;background:rgba(255,140,0,0.6);border:2px solid #ff8c00;transform:translate(-50%,-50%) scale(0);animation:_mkRipple 0.55s ease forwards;pointer-events:none;z-index:2147483647;inset:auto;margin:0;`;
                    const st = document.createElement('style');
                    st.textContent = `@keyframes _mkRipple{0%{transform:translate(-50%,-50%) scale(0);opacity:1}100%{transform:translate(-50%,-50%) scale(2.8);opacity:0}}`;
                    document.head.appendChild(st);
                    try { dot.setAttribute('popover','manual'); document.documentElement.appendChild(dot); dot.showPopover(); }
                    catch(e) { document.documentElement.appendChild(dot); }
                    setTimeout(() => { dot.remove(); st.remove(); }, 600);
                };
                const findTopClickable = (vx, vy) => {
                    const els = document.elementsFromPoint(vx, vy);
                    const top = els.find(e => {
                        const cs = window.getComputedStyle(e);
                        return cs.pointerEvents !== 'none' && cs.visibility !== 'hidden' && cs.display !== 'none'
                            && e !== document.documentElement && e !== document.body;
                    }) || els[0];
                    if (!top) return null;
                    let candidate = top;
                    for (let d = 0; d < 5 && candidate && candidate !== document.body; d++) {
                        const tag = candidate.tagName.toLowerCase();
                        const role = (candidate.getAttribute && candidate.getAttribute('role')) || '';
                        if (['button','a','input','select','label'].includes(tag) ||
                            role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') {
                            return candidate;
                        }
                        candidate = candidate.parentElement;
                    }
                    return top;
                };
                const findEl = (step) => {
                    if (step.selector) { try { return document.querySelector(step.selector); } catch(e) {} }
                    if (step._px !== undefined) {
                        window.scrollTo({ top: step._py - window.innerHeight / 2, behavior: 'instant' });
                        return findTopClickable(step._px - window.scrollX, step._py - window.scrollY);
                    }
                    return null;
                };
                if (step.type === 'click' && step._px !== undefined) {
                    window.scrollTo({ top: step._py - window.innerHeight / 2, behavior: 'instant' });
                    const vx = step._px - window.scrollX, vy = step._py - window.scrollY;
                    const el = findTopClickable(vx, vy);
                    if (!el) return;
                    el.focus();
                    const rect = el.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
                    showClickIndicator(cx, cy);
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
                    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
                    el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
                    try { el.click(); } catch(e2) {}
                } else if (step.type === 'type') {
                    let el = null;
                    try { el = document.querySelector(step.target); } catch(e) {}
                    if (!el && step._px !== undefined) {
                        window.scrollTo({ top: step._py - window.innerHeight / 2, behavior: 'instant' });
                        el = findTopClickable(step._px - window.scrollX, step._py - window.scrollY);
                    }
                    if (!el) return;
                    el.focus();
                    if (el.isContentEditable || el.tagName === 'DIV') {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, step.value);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
                        if (nativeSetter && nativeSetter.set) nativeSetter.set.call(el, step.value); else el.value = step.value;
                        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: step.value }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } else if (step.type === 'navigate') {
                    if (step.url) window.location.href = step.url;
                } else if (step.type === 'scroll') {
                    if (step.selector) {
                        const el = document.querySelector(step.selector);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        window.scrollTo({ top: step.y || 0, left: step.x || 0, behavior: 'smooth' });
                    }
                } else if (step.type === 'keypress') {
                    document.dispatchEvent(new KeyboardEvent('keydown', {
                        key: step.key, bubbles: true, composed: true,
                        ctrlKey: (step.modifiers||[]).includes('ctrl'),
                        shiftKey: (step.modifiers||[]).includes('shift'),
                        altKey: (step.modifiers||[]).includes('alt')
                    }));
                } else if (step.type === 'select') {
                    const el = step.selector ? document.querySelector(step.selector) : null;
                    if (el) { el.value = step.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
                } else if (step.type === 'doubleclick') {
                    const el = findEl(step);
                    if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true }));
                } else if (step.type === 'rightclick') {
                    const el = findEl(step);
                    if (el) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true }));
                } else if (step.type === 'hover') {
                    const el = findEl(step);
                    if (el) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
                }
            },
            args: [step]
        });
        chrome.storage.sync.set({ makros });
        advanceStep();
    });
});

document.getElementById('stepEditSaveBtn').addEventListener('click', () => {
    if (!stepPlaybackState) return;
    // Zuerst alle (auch verschobene) Marker-Positionen übernehmen
    syncMarkerPositions(() => {
    if (!stepPlaybackState) return;
    const { makro, stepIndex } = stepPlaybackState;
    const step = makro.steps[stepIndex];
    if (step.type === 'click') {
        const px = parseInt(document.getElementById('stepEditPx').value);
        const py = parseInt(document.getElementById('stepEditPy').value);
        if (!isNaN(px)) step._px = px;
        if (!isNaN(py)) step._py = py;
    } else if (step.type === 'type') {
        step.value = document.getElementById('stepEditValue').value;
    } else if (step.type === 'wait') {
        step.duration = parseInt(document.getElementById('stepEditWaitDuration').value) || 1000;
    } else if (step.type === 'waitForReload') {
        step.timeout = parseInt(document.getElementById('stepEditReloadTimeout').value) || 10000;
    } else if (step.type === 'navigate') {
        step.url = document.getElementById('stepEditUrl').value;
    } else if (step.type === 'scroll') {
        step.selector = document.getElementById('stepEditScrollSelector').value;
        step.x = parseInt(document.getElementById('stepEditScrollX').value) || 0;
        step.y = parseInt(document.getElementById('stepEditScrollY').value) || 0;
    } else if (step.type === 'keypress') {
        step.key = document.getElementById('stepEditKey').value;
        const mods = [];
        if (document.getElementById('stepEditModCtrl').checked) mods.push('ctrl');
        if (document.getElementById('stepEditModShift').checked) mods.push('shift');
        if (document.getElementById('stepEditModAlt').checked) mods.push('alt');
        step.modifiers = mods;
    } else if (step.type === 'select') {
        step.selector = document.getElementById('stepEditSelectSelector').value;
        step.value = document.getElementById('stepEditSelectValue').value;
    } else if (['doubleclick','rightclick','hover'].includes(step.type)) {
        step.selector = document.getElementById('stepEditSelector').value;
    }
    chrome.storage.sync.set({ makros }, () => {
        const btn = document.getElementById('stepEditSaveBtn');
        btn.textContent = '✓ Gespeichert!';
        setTimeout(() => { if (btn) btn.textContent = '💾 Schritt speichern'; }, 1500);
    });
    });
});

// Page-Overlay: Schritte auf Seite anzeigen und bearbeiten
function injectEditMarkersFunc(steps) {
    document.querySelectorAll('#_makroMarkerContainer').forEach(c => { if(c._makroMutObs) c._makroMutObs.disconnect(); if(c._makroDialogObs) c._makroDialogObs.disconnect(); try{c.hidePopover();}catch(e){} });
    document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle, #_makroMarkerContainer').forEach(el => el.remove());
    sessionStorage.setItem('_makroEditSteps', JSON.stringify(steps));
    const style = document.createElement('style');
    style.id = '_makroEditStyle';
    style.textContent = `
        ._makroEditMarker{position:fixed;z-index:2147483647;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#fff;cursor:grab;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.5);border:2px solid rgba(255,255,255,0.5);}
        ._makroEditMarker:active{cursor:grabbing;}
        ._makroEditMarker._click{background:#ff8c00;}
        ._makroEditMarker._type{background:#2196f3;}
        ._makroEditMarker._wait{background:#9c27b0;}
        ._makroEditMarker._nav{background:#4caf50;}
        #_makroEditPanel{position:fixed;z-index:2147483647;background:#1e1e1e;border:1px solid #555;border-radius:8px;padding:12px;min-width:210px;box-shadow:0 4px 16px rgba(0,0,0,0.7);font-family:system-ui;font-size:12px;color:#e0e0e0;}
        #_makroEditPanel label{display:block;font-size:10px;opacity:.6;margin-top:6px;}
        #_makroEditPanel input,#_makroEditPanel textarea{width:100%;background:#252525;border:1px solid #444;color:#e0e0e0;border-radius:4px;padding:4px;font-size:12px;box-sizing:border-box;margin:2px 0;}
        #_makroEditPanel button{background:rgba(255,140,0,.2);border:1px solid rgba(255,140,0,.4);color:#ff8c00;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:11px;margin:4px 2px 0;}
    `;
    document.head.appendChild(style);

    // Converts page coords to viewport coords for fixed positioning
    const toViewport = (px, py) => ({ vx: px - window.scrollX - 13, vy: py - window.scrollY - 13 });

    const markerEls = [];
    steps.forEach((step, idx) => {
        if (step._px === undefined || step._py === undefined) return;
        const marker = document.createElement('div');
        const cls = step.type === 'click' ? '_click' : step.type === 'type' ? '_type' : step.type === 'wait' || step.type === 'waitForReload' ? '_wait' : '_nav';
        marker.className = `_makroEditMarker ${cls}`;
        marker.textContent = idx + 1;
        marker.dataset.idx = idx;
        const vp = toViewport(step._px, step._py);
        marker.style.left = vp.vx + 'px';
        marker.style.top = vp.vy + 'px';
        markerEls.push(marker);

        let isDragging = false, startX, startY, startLeft, startTop;
        marker.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = false;
            startX = e.clientX; startY = e.clientY;
            startLeft = parseInt(marker.style.left); startTop = parseInt(marker.style.top);
            const onMove = (me) => {
                if (!isDragging && (Math.abs(me.clientX - startX) > 3 || Math.abs(me.clientY - startY) > 3)) isDragging = true;
                if (isDragging) {
                    const nl = startLeft + (me.clientX - startX);
                    const nt = startTop + (me.clientY - startY);
                    marker.style.left = nl + 'px'; marker.style.top = nt + 'px';
                    const stps = JSON.parse(sessionStorage.getItem('_makroEditSteps') || '[]');
                    const npx = nl + 13 + window.scrollX;
                    const npy = nt + 13 + window.scrollY;
                    stps[idx]._px = npx;
                    stps[idx]._py = npy;
                    sessionStorage.setItem('_makroEditSteps', JSON.stringify(stps));
                    try { chrome.runtime.sendMessage({ _makroStepPosUpdate: { idx, px: npx, py: npy } }); } catch(e) {}
                }
            };
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        marker.addEventListener('click', (e) => {
            if (isDragging) { isDragging = false; return; }
            const existing = document.getElementById('_makroEditPanel');
            if (existing) existing.remove();
            const stps = JSON.parse(sessionStorage.getItem('_makroEditSteps') || '[]');
            const s = stps[idx];
            const panel = document.createElement('div');
            panel.id = '_makroEditPanel';
            panel.style.left = Math.min(e.clientX + 12, window.innerWidth - 230) + 'px';
            panel.style.top = Math.min(e.clientY + 12, window.innerHeight - 160) + 'px';
            if (s.type === 'click') {
                panel.innerHTML = `<b>🖱 Schritt ${idx+1}: Klick</b><label>X:</label><input type="number" id="_ep_px" value="${s._px}"><label>Y:</label><input type="number" id="_ep_py" value="${s._py}"><div><button id="_ep_save">💾 Speichern</button><button id="_ep_close">✕</button></div>`;
            } else if (s.type === 'type') {
                panel.innerHTML = `<b>⌨ Schritt ${idx+1}: Text</b><label>Ziel:</label><input type="text" id="_ep_target" value="${(s.target||'').replace(/"/g,'&quot;')}"><label>Wert:</label><textarea id="_ep_value" rows="2">${(s.value||'').replace(/</g,'&lt;')}</textarea><div><button id="_ep_save">💾 Speichern</button><button id="_ep_close">✕</button></div>`;
            } else {
                panel.innerHTML = `<b>Schritt ${idx+1}: ${s.type}</b><div style="opacity:.7;font-size:11px;margin-top:4px;">${JSON.stringify(s,null,1).replace(/</g,'&lt;')}</div><div><button id="_ep_close">✕</button></div>`;
            }
            document.body.appendChild(panel);
            document.getElementById('_ep_close').addEventListener('click', () => panel.remove());
            const saveBtn = document.getElementById('_ep_save');
            if (saveBtn) saveBtn.addEventListener('click', () => {
                const stps2 = JSON.parse(sessionStorage.getItem('_makroEditSteps') || '[]');
                if (s.type === 'click') {
                    stps2[idx]._px = parseInt(document.getElementById('_ep_px').value) || stps2[idx]._px;
                    stps2[idx]._py = parseInt(document.getElementById('_ep_py').value) || stps2[idx]._py;
                    const nvp = toViewport(stps2[idx]._px, stps2[idx]._py);
                    marker.style.left = nvp.vx + 'px';
                    marker.style.top = nvp.vy + 'px';
                } else if (s.type === 'type') {
                    stps2[idx].target = document.getElementById('_ep_target').value;
                    stps2[idx].value = document.getElementById('_ep_value').value;
                }
                sessionStorage.setItem('_makroEditSteps', JSON.stringify(stps2));
                panel.remove();
            });
        });
        document.body.appendChild(marker);
    });

    // Container im Browser Top Layer platzieren (Popover API) → über nativen <dialog showModal()>
    const container = document.createElement('div');
    container.id = '_makroMarkerContainer';
    container.setAttribute('popover', 'manual');
    container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:transparent;border:none;padding:0;margin:0;max-width:100vw;max-height:100vh;overflow:visible;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(container);
    try { container.showPopover(); } catch(e) {}

    // MutationObserver: Container im Top Layer re-promoten wenn neues Element erscheint
    const _repromote = () => {
        try { container.hidePopover(); container.showPopover(); } catch(e) {
            if (document.body.lastElementChild !== container) document.body.appendChild(container);
        }
    };
    const _obs = new MutationObserver(_repromote);
    _obs.observe(document.body, { childList: true });
    container._makroMutObs = _obs;
    // Zweiter Observer: feuert wenn <dialog> via showModal() das 'open'-Attribut erhält
    const _dialogObs = new MutationObserver(_repromote);
    _dialogObs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal'] });
    container._makroDialogObs = _dialogObs;

    // Update fixed-position markers on scroll
    const updateMarkers = () => {
        const stps = JSON.parse(sessionStorage.getItem('_makroEditSteps') || '[]');
        markerEls.forEach(m => {
            const i = parseInt(m.dataset.idx);
            const s = stps[i];
            if (s && s._px !== undefined) {
                m.style.left = (s._px - window.scrollX - 13) + 'px';
                m.style.top  = (s._py - window.scrollY - 13) + 'px';
            }
        });
    };
    window._makroMarkerScrollHandler = updateMarkers;
    window.addEventListener('scroll', updateMarkers, { passive: true });
}

document.getElementById('showStepsOnPageBtn').addEventListener('click', () => {
    let steps = [];
    try { steps = JSON.parse(document.getElementById('makroStepsInput').value); } catch(e) { alert('Ungültiges JSON in Aktionen'); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: injectEditMarkersFunc,
            args: [steps]
        });
        document.getElementById('showStepsOnPageBtn').style.display = 'none';
        document.getElementById('applyPageEditsBtn').style.display = 'flex';
        document.getElementById('cancelPageEditsBtn').style.display = 'flex';
    });
});

document.getElementById('applyPageEditsBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
                const steps = JSON.parse(sessionStorage.getItem('_makroEditSteps') || '[]');
                sessionStorage.removeItem('_makroEditSteps');
                if (window._makroMarkerScrollHandler) { window.removeEventListener('scroll', window._makroMarkerScrollHandler); delete window._makroMarkerScrollHandler; }
                document.querySelectorAll('#_makroMarkerContainer').forEach(c => { if(c._makroMutObs) c._makroMutObs.disconnect(); if(c._makroDialogObs) c._makroDialogObs.disconnect(); try{c.hidePopover();}catch(e){} });
                document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle, #_makroMarkerContainer').forEach(el => el.remove());
                return steps;
            }
        }, (results) => {
            if (results && results[0] && results[0].result) {
                document.getElementById('makroStepsInput').value = JSON.stringify(results[0].result, null, 2);
            }
            document.getElementById('showStepsOnPageBtn').style.display = 'flex';
            document.getElementById('applyPageEditsBtn').style.display = 'none';
            document.getElementById('cancelPageEditsBtn').style.display = 'none';
        });
    });
});

document.getElementById('cancelPageEditsBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: () => {
                    sessionStorage.removeItem('_makroEditSteps');
                    if (window._makroMarkerScrollHandler) { window.removeEventListener('scroll', window._makroMarkerScrollHandler); delete window._makroMarkerScrollHandler; }
                    document.querySelectorAll('#_makroMarkerContainer').forEach(c => { if(c._makroMutObs) c._makroMutObs.disconnect(); if(c._makroDialogObs) c._makroDialogObs.disconnect(); try{c.hidePopover();}catch(e){} });
                    document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle, #_makroMarkerContainer').forEach(el => el.remove());
                }
            });
        }
    });
    document.getElementById('showStepsOnPageBtn').style.display = 'flex';
    document.getElementById('applyPageEditsBtn').style.display = 'none';
    document.getElementById('cancelPageEditsBtn').style.display = 'none';
});

// Eine einzelne Makro-Iteration im Tab ausführen (eine injizierte Funktion)
function injectOneRun({ stepsList, speedDelay }) {
    function showClickRipple(vx, vy) {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:' + (vx-18) + 'px;top:' + (vy-18) + 'px;width:36px;height:36px;border-radius:50%;border:3px solid #ff8c00;pointer-events:none;z-index:2147483647;animation:_makroRipple 0.5s ease-out forwards;';
        if (!document.getElementById('_makroRippleStyle')) {
            const s = document.createElement('style');
            s.id = '_makroRippleStyle';
            s.textContent = '@keyframes _makroRipple{0%{transform:scale(0.3);opacity:1}100%{transform:scale(1.5);opacity:0}}';
            document.head.appendChild(s);
        }
        // Im bestehenden Top-Layer-Container einbetten, sonst eigenen Popover erstellen
        const host = document.getElementById('_makroMarkerContainer') || (() => {
            const h = document.createElement('div');
            h.setAttribute('popover', 'manual');
            h.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;background:transparent;border:none;padding:0;margin:0;overflow:visible;pointer-events:none;';
            document.body.appendChild(h);
            try { h.showPopover(); } catch(e) {}
            setTimeout(() => { try{h.hidePopover();}catch(e){} h.remove(); }, 700);
            return h;
        })();
        host.appendChild(d);
        setTimeout(() => d.remove(), 600);
    }
    const showClickIndicator = (x, y) => {
        const dot = document.createElement('div');
        dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:24px;height:24px;border-radius:50%;background:rgba(255,140,0,0.6);border:2px solid #ff8c00;transform:translate(-50%,-50%) scale(0);animation:_mkRipple 0.55s ease forwards;pointer-events:none;z-index:2147483647;inset:auto;margin:0;`;
        const st = document.createElement('style');
        st.textContent = `@keyframes _mkRipple{0%{transform:translate(-50%,-50%) scale(0);opacity:1}100%{transform:translate(-50%,-50%) scale(2.8);opacity:0}}`;
        document.head.appendChild(st);
        try { dot.setAttribute('popover','manual'); document.documentElement.appendChild(dot); dot.showPopover(); }
        catch(e) { document.documentElement.appendChild(dot); }
        setTimeout(() => { dot.remove(); st.remove(); }, 600);
    };
    const showKeyIndicator = (label) => {
        const cur = document.getElementById('_makroCursor');
        const x = cur ? parseFloat(cur.style.left) || 40 : 40;
        const y = cur ? parseFloat(cur.style.top) || 40 : 40;
        const pill = document.createElement('div');
        pill.textContent = '⌨ ' + label;
        pill.style.cssText = `position:fixed;left:${x}px;top:${y - 28}px;transform:translate(-50%,0);background:#ff8c00;color:#111;font:600 11px system-ui,sans-serif;padding:3px 8px;border-radius:12px;pointer-events:none;z-index:2147483647;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35);animation:_mkKeyFade 0.9s ease forwards;`;
        if (!document.getElementById('_makroKeyStyle')) {
            const st = document.createElement('style');
            st.id = '_makroKeyStyle';
            st.textContent = `@keyframes _mkKeyFade{0%{opacity:0;transform:translate(-50%,4px)}15%{opacity:1;transform:translate(-50%,0)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-6px)}}`;
            document.head.appendChild(st);
        }
        document.body.appendChild(pill);
        setTimeout(() => pill.remove(), 900);
    };
    const findTopClickable = (vx, vy) => {
        const els = document.elementsFromPoint(vx, vy);
        const top = els.find(e => {
            const cs = window.getComputedStyle(e);
            return cs.pointerEvents !== 'none' && cs.visibility !== 'hidden' && cs.display !== 'none'
                && e !== document.documentElement && e !== document.body;
        }) || els[0];
        if (!top) return null;
        let candidate = top;
        for (let d = 0; d < 5 && candidate && candidate !== document.body; d++) {
            const tag = candidate.tagName.toLowerCase();
            const role = (candidate.getAttribute && candidate.getAttribute('role')) || '';
            if (['button','a','input','select','label'].includes(tag) ||
                role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') {
                return candidate;
            }
            candidate = candidate.parentElement;
        }
        return top;
    };
    // Animierter Maus-Cursor
    function getCursor() {
        let cur = document.getElementById('_makroCursor');
        if (!cur) {
            const host = document.getElementById('_makroMarkerContainer') || document.body;
            cur = document.createElement('div');
            cur.id = '_makroCursor';
            cur.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;width:20px;height:20px;transition:left 0.12s ease,top 0.12s ease;transform:translate(-3px,-2px);';
            cur.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><polygon points="3,2 3,17 7,13 10,19 12,18 9,12 15,12" fill="white" stroke="#333" stroke-width="1.5" stroke-linejoin="round"/></svg>';
            host.appendChild(cur);
        }
        return cur;
    }
    function moveCursorTo(vx, vy) {
        const cur = getCursor();
        cur.style.left = vx + 'px';
        cur.style.top = vy + 'px';
    }
    // Nur scrollen, wenn das Ziel tatsächlich außerhalb des sichtbaren Bereichs liegt, und
    // dabei CSS scroll-behavior:smooth kurzzeitig ausschalten, damit der direkt danach
    // ausgelesene window.scrollY-Wert bereits aktuell ist (sonst landen Klicks daneben).
    function ensureVisible(py) {
        if (!py || py <= 0) return;
        const margin = 40;
        if (py >= window.scrollY + margin && py <= window.scrollY + window.innerHeight - margin) return;
        const prevBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo({ top: py - window.innerHeight / 2, behavior: 'instant' });
        document.documentElement.style.scrollBehavior = prevBehavior;
    }
    const findEl = (step) => {
        const sel = step.selector || step.target;
        if (sel) { try { const found = document.querySelector(sel); if (found) return found; } catch(e) {} }
        if (step._px !== undefined) {
            ensureVisible(step._py);
            const vx = (step._px || 0) - window.scrollX;
            const vy = (step._py || 0) - window.scrollY;
            return findTopClickable(vx, vy);
        }
        return null;
    };
    const executeAction = (step, attempt) => {
        if (step.type === 'click' && step._px !== undefined) {
            ensureVisible(step._py);
            const vx = (step._px || 0) - window.scrollX;
            const vy = (step._py || 0) - window.scrollY;
            moveCursorTo(vx, vy);
            const el = findTopClickable(vx, vy);
            if (!el) { if (attempt < 3) setTimeout(() => executeAction(step, attempt + 1), 300); return; }
            el.focus();
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
            showClickIndicator(cx, cy);
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, clientX: vx, clientY: vy, pageX: step._px, pageY: step._py }));
            el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, composed: true, clientX: vx, clientY: vy, pageX: step._px, pageY: step._py }));
            el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, composed: true, clientX: vx, clientY: vy, pageX: step._px, pageY: step._py }));
            try { el.click(); } catch(e2) {}
            showClickRipple(vx, vy);
        } else if (step.type === 'type') {
            let el = null;
            try { el = document.querySelector(step.target); } catch (e) {}
            if (!el && step._px !== undefined) {
                ensureVisible(step._py);
                const vx = (step._px || 0) - window.scrollX;
                const vy = (step._py || 0) - window.scrollY;
                el = findTopClickable(vx, vy);
            }
            if (!el) { if (attempt < 3) setTimeout(() => executeAction(step, attempt + 1), 300); return; }
            el.focus();
            if (el.isContentEditable || el.tagName === 'DIV') {
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, step.value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
                if (nativeSetter && nativeSetter.set) nativeSetter.set.call(el, step.value); else el.value = step.value;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: step.value }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else if (step.type === 'navigate') {
            if (step.url) window.location.href = step.url;
        } else if (step.type === 'scroll') {
            if (step.selector) { const el = document.querySelector(step.selector); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            else { window.scrollTo({ top: step.y || 0, left: step.x || 0, behavior: 'smooth' }); }
        } else if (step.type === 'keypress') {
            const label = (step.modifiers||[]).concat(step.key || '').join('+');
            showKeyIndicator(label);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true, composed: true, ctrlKey: (step.modifiers||[]).includes('ctrl'), shiftKey: (step.modifiers||[]).includes('shift'), altKey: (step.modifiers||[]).includes('alt') }));
        } else if (step.type === 'select') {
            const el = step.selector ? document.querySelector(step.selector) : null;
            if (el) { el.value = step.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
        } else if (step.type === 'doubleclick') {
            const vx = (step._px || 0) - window.scrollX;
            const vy = (step._py || 0) - window.scrollY;
            moveCursorTo(vx, vy);
            const el = findEl(step); if (el) { el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, clientX: vx, clientY: vy })); showClickRipple(vx, vy); }
        } else if (step.type === 'rightclick') {
            const vx = (step._px || 0) - window.scrollX;
            const vy = (step._py || 0) - window.scrollY;
            moveCursorTo(vx, vy);
            const el = findEl(step); if (el) { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: vx, clientY: vy })); showClickRipple(vx, vy); }
        } else if (step.type === 'hover') {
            const vx = (step._px || 0) - window.scrollX;
            const vy = (step._py || 0) - window.scrollY;
            moveCursorTo(vx, vy);
            const el = findEl(step); if (el) { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true, clientX: vx, clientY: vy })); showClickRipple(vx, vy); }
        }
    };
    const stepDelay = (speedDelay !== undefined && speedDelay !== null) ? speedDelay : 700;
    let cumOffset = 0;
    stepsList.forEach((step) => {
        const delay = cumOffset;
        if (step.type === 'wait') { cumOffset += stepDelay + (step.duration || 1000); return; }
        if (step.type === 'waitForReload') { cumOffset += stepDelay; return; }
        if (step.type === 'mousemovepath') {
            // M4: Mausbewegungen abspielen
            const pts = step.points || [];
            const base = cumOffset;
            pts.forEach(pt => {
                setTimeout(() => {
                    const vx = pt.x - window.scrollX;
                    const vy = pt.y - window.scrollY;
                    moveCursorTo(vx, vy);
                    // Echtes mousemove-Event dispatchen, damit hover-abhängige Seiten-Logik
                    // (Dropdowns, Slider, Canvas etc.) wie bei der Aufnahme reagiert.
                    const target = document.elementFromPoint(vx, vy) || document.body;
                    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, composed: true, clientX: vx, clientY: vy }));
                }, base + (pt.t || 0));
            });
            cumOffset += stepDelay + (pts.length > 0 ? pts[pts.length - 1].t || 0 : 0);
            return;
        }
        cumOffset += stepDelay;
        setTimeout(() => executeAction(step, 0), delay);
    });
    // Cursor nach Abschluss entfernen
    setTimeout(() => { const c = document.getElementById('_makroCursor'); if (c) c.remove(); }, cumOffset + 300);
}

// Geschätzte Dauer einer Iteration (für Sidebar-Timing)
function makroIterationDuration(steps, stepDelay) {
    return steps.reduce((acc, s) => {
        if (s.type === 'mousemovepath') return acc + stepDelay + (s.points && s.points.length ? s.points[s.points.length-1].t || 0 : 0);
        return acc + stepDelay + (s.type === 'wait' ? (s.duration || 1000) : 0);
    }, 0) + 400;
}

// Startet die vollständige Wiedergabe (Wiederholungen werden vom Sidebar gesteuert)
function playMakroFull(tabId, m, steps, overrideRepeat) {
    if (runningMakroState && runningMakroState.fallbackTimer) clearTimeout(runningMakroState.fallbackTimer);
    runningMakroState = {
        tabId,
        steps: steps || m.steps,
        stepDelay: (m.speedDelay !== undefined && m.speedDelay !== null) ? m.speedDelay : 700,
        repeat: Math.max(1, overrideRepeat || m.repeat || 1),
        current: 0,
        repeatDelay: Math.max(0, m.repeatDelay || 0),
        waitReload: !!m.waitReloadBetweenRepeats,
        awaitingReload: false,
        reloadSeen: false,
        fallbackTimer: null,
        paused: false,
        scrollToStart: !!m.scrollToStart,
        scrollToEnd: !!m.scrollToEnd,
        lockScroll: !!m.lockScroll,
        title: m.title || 'Makro'
    };
    updatePlaybackBar();
    runMakroIteration();
}

// M4: teilt eine Schrittliste an switchTab/newTab-Grenzen in pro-Tab-Segmente auf, damit
// eine Aufnahme, die über mehrere Tabs/Seiten hinweg lief, beim Abspielen denselben
// Tab-/Seitenwechseln folgen kann (Segmente ohne Tab-Wechsel ergeben genau 1 Segment,
// Verhalten bleibt für M1-M3-Makros dadurch unverändert).
function splitStepsIntoTabSegments(steps) {
    const segments = [{ tabIndex: 0, enterStep: null, steps: [] }];
    (steps || []).forEach(s => {
        if (s.type === 'switchTab' || s.type === 'newTab') {
            segments.push({ tabIndex: s.tabIndex, enterStep: s, steps: [] });
        } else {
            segments[segments.length - 1].steps.push(s);
        }
    });
    return segments;
}

function waitForTabComplete(tabId, cb) {
    let done = false;
    const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(listener); clearTimeout(fallback); cb(); };
    const listener = (id, changeInfo) => { if (id === tabId && changeInfo.status === 'complete') finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    const fallback = setTimeout(finish, 8000);
}

function runMakroIteration() {
    const st = runningMakroState;
    if (!st) return;
    updatePlaybackBar();
    st.reloadSeen = false;
    st.tabRuntimeMap = { 0: st.tabId };
    st.currentTabId = st.tabId;
    runMakroSegment(splitStepsIntoTabSegments(st.steps || []), 0);
}

function runMakroSegment(segments, segIdx) {
    const st = runningMakroState;
    if (!st) return;
    if (segIdx >= segments.length) { setTimeout(afterMakroIteration, 0); return; }
    const seg = segments[segIdx];

    const runOnTab = (tabId) => {
        st.currentTabId = tabId;
        if (st.scrollToStart && segIdx === 0 && st.current === 0) {
            const firstClickStep = (seg.steps || []).find(s => ['click','doubleclick','rightclick','hover'].includes(s.type) && s._py > 0);
            if (firstClickStep) {
                chrome.scripting.executeScript({ target: { tabId }, func: (py) => { window.scrollTo({ top: py - window.innerHeight/2, behavior: 'smooth' }); }, args: [firstClickStep._py] });
            }
        }
        const _runSteps = () => chrome.scripting.executeScript({
            target: { tabId },
            func: injectOneRun,
            args: [{ stepsList: seg.steps, speedDelay: st.stepDelay }]
        });
        if (st.lockScroll) {
            chrome.scripting.executeScript({
                target: { tabId },
                func: () => { document.documentElement.style.overflow='hidden'; document.body.style.overflow='hidden'; }
            }).then(_runSteps);
        } else {
            _runSteps();
        }
        const dur = makroIterationDuration(seg.steps, st.stepDelay);
        setTimeout(() => runMakroSegment(segments, segIdx + 1), dur);
    };

    if (!seg.enterStep) { runOnTab(st.tabRuntimeMap[seg.tabIndex] !== undefined ? st.tabRuntimeMap[seg.tabIndex] : st.tabId); return; }

    if (seg.enterStep.type === 'newTab') {
        chrome.tabs.create({ url: seg.enterStep.url || 'about:blank' }, (newTab) => {
            st.tabRuntimeMap[seg.enterStep.tabIndex] = newTab.id;
            waitForTabComplete(newTab.id, () => runOnTab(newTab.id));
        });
    } else {
        const targetId = st.tabRuntimeMap[seg.enterStep.tabIndex] !== undefined ? st.tabRuntimeMap[seg.enterStep.tabIndex] : st.tabId;
        chrome.tabs.update(targetId, { active: true }, () => runOnTab(targetId));
    }
}

function afterMakroIteration() {
    const st = runningMakroState;
    if (!st) return;
    st.current++;
    if (st.current >= st.repeat) {
        const endTabId = st.currentTabId || st.tabId;
        if (st.lockScroll) {
            chrome.scripting.executeScript({ target: { tabId: endTabId }, func: () => { document.documentElement.style.overflow=''; document.body.style.overflow=''; }});
        }
        if (st.scrollToEnd) {
            const steps = st.steps || [];
            let lastClickStep = null;
            for (let i = steps.length-1; i >= 0; i--) { if (['click','doubleclick','rightclick','hover'].includes(steps[i].type) && steps[i]._py !== undefined) { lastClickStep = steps[i]; break; } }
            if (lastClickStep) {
                chrome.scripting.executeScript({ target: { tabId: endTabId }, func: (py) => { window.scrollTo({ top: py - window.innerHeight/2, behavior: 'smooth' }); }, args: [lastClickStep._py] });
            }
        }
        runningMakroState = null;
        updatePlaybackBar();
        return;
    }
    if (st.paused) {
        updatePlaybackBar();
        return;
    }
    if (st.waitReload) {
        if (st.reloadSeen) {
            // Seite wurde während der Iteration bereits neu geladen → direkt weiter (nach repeatDelay)
            setTimeout(runMakroIteration, st.repeatDelay);
        } else {
            st.awaitingReload = true;
            st.fallbackTimer = setTimeout(() => {
                if (runningMakroState && runningMakroState.awaitingReload) {
                    runningMakroState.awaitingReload = false;
                    runningMakroState.fallbackTimer = null;
                    setTimeout(runMakroIteration, runningMakroState.repeatDelay);
                }
            }, 15000);
        }
    } else {
        setTimeout(runMakroIteration, st.repeatDelay);
    }
}

document.getElementById('showStepOnPageBtn').addEventListener('click', () => {
    if (!stepPlaybackState) return;
    const step = stepPlaybackState.makro.steps[stepPlaybackState.stepIndex];
    if (!step || step._px === undefined) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (px, py, stepIdx) => {
                if (window._makroMarkerScrollHandler) { window.removeEventListener('scroll', window._makroMarkerScrollHandler); delete window._makroMarkerScrollHandler; }
                document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle').forEach(el => el.remove());
                const style = document.createElement('style');
                style.id = '_makroEditStyle';
                style.textContent = `
                    ._makroEditMarker{position:fixed;z-index:2147483647;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#fff;cursor:grab;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.5);border:2px solid rgba(255,255,255,0.5);}
                    ._makroEditMarker:active{cursor:grabbing;}
                    ._makroEditMarker._click{background:#ff8c00;}
                `;
                document.head.appendChild(style);
                const marker = document.createElement('div');
                marker.className = '_makroEditMarker _click';
                marker.textContent = stepIdx + 1;
                // page coords → viewport coords for fixed positioning
                let vpx = px - window.scrollX - 13;
                let vpy = py - window.scrollY - 13;
                marker.style.left = vpx + 'px';
                marker.style.top = vpy + 'px';
                let isDragging = false, startX, startY, startLeft, startTop;
                marker.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    isDragging = false;
                    startX = e.clientX; startY = e.clientY;
                    startLeft = parseInt(marker.style.left); startTop = parseInt(marker.style.top);
                    const onMove = (me) => {
                        if (!isDragging && (Math.abs(me.clientX - startX) > 3 || Math.abs(me.clientY - startY) > 3)) isDragging = true;
                        if (isDragging) {
                            marker.style.left = (startLeft + (me.clientX - startX)) + 'px';
                            marker.style.top = (startTop + (me.clientY - startY)) + 'px';
                        }
                    };
                    const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        if (isDragging) {
                            // Convert viewport back to page coords
                            const newPx = parseInt(marker.style.left) + 13 + window.scrollX;
                            const newPy = parseInt(marker.style.top) + 13 + window.scrollY;
                            chrome.runtime.sendMessage({ _makroStepPosUpdate: { px: newPx, py: newPy } });
                        }
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
                document.body.appendChild(marker);
                // Keep marker visible on scroll
                window._makroMarkerScrollHandler = () => {
                    marker.style.left = (px - window.scrollX - 13) + 'px';
                    marker.style.top  = (py - window.scrollY - 13) + 'px';
                };
                window.addEventListener('scroll', window._makroMarkerScrollHandler, { passive: true });
                window.scrollTo({ top: py - window.innerHeight / 2, behavior: 'smooth' });
            },
            args: [step._px, step._py, stepPlaybackState.stepIndex]
        });
    });
});

document.getElementById('makroPlaybackPauseBtn').addEventListener('click', () => {
    if (!runningMakroState) return;
    if (runningMakroState.paused) {
        runningMakroState.paused = false;
        updatePlaybackBar();
        runMakroIteration();
    } else {
        runningMakroState.paused = true;
        updatePlaybackBar();
    }
});
document.getElementById('makroPlaybackStopBtn').addEventListener('click', () => {
    if (runningMakroState) {
        const tabId = runningMakroState.tabId;
        const shouldUnlock = runningMakroState.lockScroll;
        if (runningMakroState.fallbackTimer) clearTimeout(runningMakroState.fallbackTimer);
        runningMakroState = null;
        updatePlaybackBar();
        if (shouldUnlock) {
            chrome.scripting.executeScript({ target: { tabId }, func: () => {
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
            }});
        }
    }
});

document.getElementById('cancelRepeatAskBtn').addEventListener('click', () => {
    document.getElementById('makroRepeatAskDialog').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    window._pendingPlayTabId = null;
    window._pendingPlayMakro = null;
});
document.getElementById('confirmRepeatAskBtn').addEventListener('click', () => {
    const tabId = window._pendingPlayTabId;
    const m = window._pendingPlayMakro;
    const overrideRepeat = Math.max(1, parseInt(document.getElementById('makroRepeatAskInput').value) || 1);
    document.getElementById('makroRepeatAskDialog').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    window._pendingPlayTabId = null;
    window._pendingPlayMakro = null;
    if (tabId && m) playMakroFull(tabId, m, m.steps, overrideRepeat);
});

document.getElementById('saveMakroBtn').addEventListener('click', () => {
    const editIdx = document.getElementById('editMakroIndex').value;
    const selectedColor = document.getElementById('makroColor').value;
    let parsedSteps = [];

    try {
        parsedSteps = JSON.parse(document.getElementById('makroStepsInput').value);
    } catch (err) {
        alert("Fehler im JSON-Format der Schritte. Bitte überprüfe die Syntax.");
        return;
    }

    const finishSave = (steps) => {
        const existingDomain = (editIdx !== '' && makros[parseInt(editIdx)]) ? (makros[parseInt(editIdx)].domain || '') : '';
        const newMakro = {
            title: document.getElementById('makroTitleInput').value,
            steps: steps,
            color: selectedColor,
            repeat: Math.max(1, parseInt(document.getElementById('makroRepeatInput').value) || 1),
            repeatDelay: Math.max(0, parseInt(document.getElementById('makroRepeatDelayInput').value) || 0),
            waitReloadBetweenRepeats: document.getElementById('makroWaitReloadInput').checked,
            speedDelay: document.getElementById('makroSpeedToggle').checked ? Math.max(0, parseInt(document.getElementById('makroSpeedInput').value) || 0) : 0,
            askRepeatBeforePlay: document.getElementById('makroAskRepeatInput').checked,
            scrollToStart: document.getElementById('makroScrollToStartInput').checked,
            scrollToEnd: document.getElementById('makroScrollToEndInput').checked,
            lockScroll: document.getElementById('makroLockScrollInput').checked,
            domain: existingDomain,
            method: parseInt(document.getElementById('makroMethodInput').value) || 2
        };

        if (editIdx !== "") {
            makros[parseInt(editIdx)] = newMakro;
        } else {
            makros.push(newMakro);
        }

        updateRecentColors(selectedColor);
        chrome.storage.sync.set({ makros }, () => {
            closeMakroEditMode();
            renderMakros();
        });
    };

    // Verschobene Marker-Positionen von der Seite übernehmen (falls vorhanden)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { finishSave(parsedSteps); return; }
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => JSON.parse(sessionStorage.getItem('_makroEditSteps') || 'null')
        }, (results) => {
            const marked = results?.[0]?.result;
            if (Array.isArray(marked)) {
                parsedSteps.forEach((s, idx) => {
                    if (marked[idx] && marked[idx]._px !== undefined) {
                        s._px = marked[idx]._px;
                        s._py = marked[idx]._py;
                    }
                });
            }
            finishSave(parsedSteps);
        });
    });
});

// Global Event delegation und Klicks
document.addEventListener('click', (e) => {
    if (!e.target.closest('#tabContextMenu')) {
        document.getElementById('tabContextMenu').style.display = 'none';
    }

    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-view').forEach(v => v.style.display = 'none');
        
        tabBtn.classList.add('active');
        const viewId = tabBtn.dataset.tab + 'View';
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.style.display = 'flex';
        return;
    }
});

document.getElementById('promptList').addEventListener('click', (e) => {
    const editGroupBtn = e.target.closest('[data-action="edit-group"]');
    if (editGroupBtn) {
        e.stopPropagation();
        const oldName = editGroupBtn.dataset.groupname;
        const meta = groupMetadata[oldName] || { color: '#ff8c00', icon: '📁', groupProvider: 'default' };
        
        document.getElementById('editGroupOldName').value = oldName;
        document.getElementById('groupTitleInput').value = oldName;
        document.getElementById('groupIconInput').value = meta.icon;
        document.getElementById('groupColorInput').value = meta.color;
        populateProviderDropdowns();
        document.getElementById('groupAiProvider').value = meta.groupProvider || 'default';

        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('groupEditorGroup').style.display = 'flex';
        renderRecentColors();
        return;
    }

    const groupHeader = e.target.closest('.group-header');
    if (groupHeader && groupHeader.dataset.group) {
        const gName = groupHeader.dataset.group;
        const cur = (gName in collapsedGroups) ? collapsedGroups[gName] : true;
        collapsedGroups[gName] = !cur;
        render();
        return;
    }

    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const i = parseInt(target.dataset.index);

    if (action === 'toggle') {
        const el = document.getElementById(`content-${i}`);
        if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
    } 
    else if (action === 'copy-insert') {
        const p = promts[i];
        if (p && p.text) insertTextIntoPage(p.text);
    } 
    else if (action === 'edit') {
        const p = promts[i];
        if (p) {
            document.getElementById('editIndex').value = i;
            document.getElementById('titleInput').value = p.title || '';
            document.getElementById('textInput').value = p.text || '';
            document.getElementById('promptColor').value = p.color || '#ff8c00';
            document.getElementById('shortcutInput').value = p.shortcut || '';
            populateProviderDropdowns();
            document.getElementById('aiProvider').value = p.provider || 'ChatGPT';
            populateGroupDropdowns();
            
            const textInput = document.getElementById('groupInput');
            if (p.group && p.group.trim() !== "") {
                document.getElementById('groupSelectOptions').value = p.group;
            } else {
                document.getElementById('groupSelectOptions').value = '';
            }
            textInput.style.display = 'none';
            textInput.value = '';
            
            document.getElementById('mainContainer').style.display = 'none';
            document.getElementById('inputGroup').style.display = 'flex';
            autoResizeTextInput();
            renderRecentColors();
        }
    } 
    else if (action === 'delete') {
        const removed = promts.splice(i, 1)[0];
        deletedPromts.push(removed);
        chrome.storage.sync.set({ promts, deletedPromts });
    }
});

function handleNotesViewClicks(e) {
    const groupHeader = e.target.closest('.group-header');
    if (groupHeader && groupHeader.dataset.notegroup) {
        const gName = groupHeader.dataset.notegroup;
        const cur = (gName in collapsedNoteGroups) ? collapsedNoteGroups[gName] : true;
        collapsedNoteGroups[gName] = !cur;
        renderNotes();
        return;
    }

    if (e.target.classList.contains('note-card-todo-check')) {
        const nIdx = parseInt(e.target.dataset.noteIdx);
        const tIdx = parseInt(e.target.dataset.todoIdx);
        if (notes[nIdx] && notes[nIdx].todos && notes[nIdx].todos[tIdx]) {
            notes[nIdx].todos[tIdx].done = e.target.checked;
            chrome.storage.sync.set({ notes });
        }
        return;
    }

    const target = e.target.closest('[data-note-action]');
    if (!target) return;
    const action = target.dataset.noteAction;
    const i = parseInt(target.dataset.index);

    if (action === 'toggle-view') {
        const el = document.getElementById(`note-content-${i}`);
        if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
    }
    else if (action === 'delete') {
        notes.splice(i, 1);
        chrome.storage.sync.set({ notes });
    }
    else if (action === 'edit') {
        const n = notes[i];
        if (n) {
            document.getElementById('editNoteIndex').value = i;
            document.getElementById('noteTitleInput').value = n.title || '';
            document.getElementById('noteTextInput').value = n.text || '';
            document.getElementById('noteColor').value = n.color || '#ff8c00';
            document.getElementById('notePinnedInput').checked = n.pinned || false;
            currentEditorTodos = JSON.parse(JSON.stringify(n.todos || []));
            renderEditorTodos();

            populateGroupDropdowns();
            const textInput = document.getElementById('noteGroupInput');
            if (n.group && n.group.trim() !== "") {
                document.getElementById('noteGroupSelectOptions').value = n.group;
            } else {
                document.getElementById('noteGroupSelectOptions').value = '';
            }
            textInput.style.display = 'none';
            textInput.value = '';

            document.getElementById('noteIconInput').value = n.icon || '';
            document.getElementById('mainContainer').style.display = 'none';
            document.getElementById('noteInputGroup').style.display = 'flex';
            renderRecentColors();
        }
    }
}
document.getElementById('pinnedNotesList').addEventListener('click', handleNotesViewClicks);
document.getElementById('notesList').addEventListener('click', handleNotesViewClicks);

// Note-Gruppen bearbeiten: Icon/Farbe via Popup
document.getElementById('notesList').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-notegroupedit]');
    if (!editBtn) return;
    e.stopPropagation();
    const gName = editBtn.dataset.notegroupedit;
    const meta = groupMetadata[gName] || { color: '#ff8c00', icon: '📁' };
    document.getElementById('editNoteGroupName').value = gName;
    document.getElementById('noteGroupIconInput').value = meta.icon || '📁';
    document.getElementById('noteGroupColorInput').value = meta.color || '#ff8c00';
    const popup = document.getElementById('noteGroupEditPopup');
    const rect = editBtn.getBoundingClientRect();
    popup.style.display = 'block';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = Math.max(4, rect.left - 180) + 'px';
});
document.getElementById('noteGroupIconPick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-icon]');
    if (btn) document.getElementById('noteGroupIconInput').value = btn.dataset.icon;
});
document.getElementById('cancelNoteGroupBtn').addEventListener('click', () => {
    document.getElementById('noteGroupEditPopup').style.display = 'none';
});
document.getElementById('saveNoteGroupBtn').addEventListener('click', () => {
    const gName = document.getElementById('editNoteGroupName').value;
    if (!gName) return;
    groupMetadata[gName] = {
        ...(groupMetadata[gName] || {}),
        icon: document.getElementById('noteGroupIconInput').value || '📁',
        color: document.getElementById('noteGroupColorInput').value || '#ff8c00'
    };
    chrome.storage.sync.set({ groupMetadata }, () => {
        document.getElementById('noteGroupEditPopup').style.display = 'none';
        renderNotes();
    });
});

function openBookmarkEditor(i) {
    const b = bookmarks[i];
    if (!b) return;
    document.getElementById('editBookmarkIndex').value = i;
    document.getElementById('bookmarkTitleInput').value = b.title || '';
    document.getElementById('bookmarkUrlInput').value = b.url || '';
    document.getElementById('bookmarkColor').value = b.color || '#ff8c00';

    populateGroupDropdowns();
    const textInput = document.getElementById('bookmarkGroupInput');
    if (b.group && b.group.trim() !== "") {
        document.getElementById('bookmarkGroupSelectOptions').value = b.group;
    } else {
        document.getElementById('bookmarkGroupSelectOptions').value = '';
    }
    textInput.style.display = 'none';
    textInput.value = '';

    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('bookmarkInputGroup').style.display = 'flex';
    renderRecentColors();
}

function openBookmarkEditorForCurrentPage() {
    document.getElementById('editBookmarkIndex').value = "";
    document.getElementById('bookmarkTitleInput').value = '';
    document.getElementById('bookmarkUrlInput').value = '';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('bookmarkInputGroup').style.display = 'flex';
    populateGroupDropdowns();
    renderRecentColors();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url) {
            document.getElementById('bookmarkTitleInput').value = tabs[0].title || '';
            document.getElementById('bookmarkUrlInput').value = tabs[0].url || '';
        }
    });
}

function handleBookmarksViewClicks(e) {
    const groupHeader = e.target.closest('.group-header');
    if (groupHeader && groupHeader.dataset.bookmarkgroup) {
        const gName = groupHeader.dataset.bookmarkgroup;
        const cur = (gName in collapsedBookmarkGroups) ? collapsedBookmarkGroups[gName] : true;
        collapsedBookmarkGroups[gName] = !cur;
        renderBookmarks();
        return;
    }

    const target = e.target.closest('[data-bookmark-action]');
    if (!target) return;
    const action = target.dataset.bookmarkAction;
    const i = parseInt(target.dataset.index);

    if (action === 'open') {
        const b = bookmarks[i];
        if (b && b.url) {
            let url = b.url.trim();
            if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
            chrome.tabs.create({ url });
        }
    }
    else if (action === 'toggle') {
        const el = document.getElementById(`bookmark-content-${i}`);
        if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
    }
    else if (action === 'delete') {
        bookmarks.splice(i, 1);
        chrome.storage.sync.set({ bookmarks }, renderBookmarks);
    }
    else if (action === 'edit') {
        openBookmarkEditor(i);
    }
}
document.getElementById('bookmarksList').addEventListener('click', handleBookmarksViewClicks);

// Favicon-Fallback: bei Ladefehler durch Emoji ersetzen (error-Events bubblen nicht -> capture:true)
document.getElementById('bookmarksList').addEventListener('error', (e) => {
    const img = e.target;
    if (img.classList && img.classList.contains('bookmark-favicon')) {
        const wrap = img.parentElement;
        if (wrap) wrap.textContent = img.dataset.fallback || '🔖';
    }
}, true);

// Lesezeichen-Gruppen bearbeiten: Icon/Farbe via Popup
document.getElementById('bookmarksList').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-bookmarkgroupedit]');
    if (!editBtn) return;
    e.stopPropagation();
    const gName = editBtn.dataset.bookmarkgroupedit;
    const meta = bookmarkGroupMetadata[gName] || { color: '#ff8c00', icon: '🔖' };
    document.getElementById('editBookmarkGroupName').value = gName;
    document.getElementById('bookmarkGroupIconInput').value = meta.icon || '🔖';
    document.getElementById('bookmarkGroupColorInput').value = meta.color || '#ff8c00';
    const popup = document.getElementById('bookmarkGroupEditPopup');
    const rect = editBtn.getBoundingClientRect();
    popup.style.display = 'block';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = Math.max(4, rect.left - 180) + 'px';
});
document.getElementById('bookmarkGroupIconPick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-icon]');
    if (btn) document.getElementById('bookmarkGroupIconInput').value = btn.dataset.icon;
});
document.getElementById('cancelBookmarkGroupBtn').addEventListener('click', () => {
    document.getElementById('bookmarkGroupEditPopup').style.display = 'none';
});
document.getElementById('sortBookmarkGroupBtn').addEventListener('click', () => {
    const gName = document.getElementById('editBookmarkGroupName').value;
    if (gName) sortBookmarksInScope(gName);
});
document.getElementById('saveBookmarkGroupBtn').addEventListener('click', () => {
    const gName = document.getElementById('editBookmarkGroupName').value;
    if (!gName) return;
    bookmarkGroupMetadata[gName] = {
        ...(bookmarkGroupMetadata[gName] || {}),
        icon: document.getElementById('bookmarkGroupIconInput').value || '🔖',
        color: document.getElementById('bookmarkGroupColorInput').value || '#ff8c00'
    };
    chrome.storage.sync.set({ bookmarkGroupMetadata }, () => {
        document.getElementById('bookmarkGroupEditPopup').style.display = 'none';
        renderBookmarks();
    });
});

function closeBookmarkEditMode() {
    document.getElementById('bookmarkInputGroup').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('editBookmarkIndex').value = "";
    document.getElementById('bookmarkTitleInput').value = '';
    document.getElementById('bookmarkUrlInput').value = '';
    document.getElementById('bookmarkGroupInput').value = '';
    document.getElementById('bookmarkGroupInput').style.display = 'none';
    document.getElementById('bookmarkGroupSelectOptions').value = '';
}

document.getElementById('cancelBookmarkBtn').addEventListener('click', closeBookmarkEditMode);

document.getElementById('saveBookmarkBtn').addEventListener('click', () => {
    const i = document.getElementById('editBookmarkIndex').value;
    const selectedColor = document.getElementById('bookmarkColor').value;

    let finalGroup = '';
    const dropdownValue = document.getElementById('bookmarkGroupSelectOptions').value;
    if (dropdownValue === '__NEW_GROUP__') {
        finalGroup = document.getElementById('bookmarkGroupInput').value.trim();
    } else {
        finalGroup = dropdownValue;
    }

    const newBookmark = {
        title: document.getElementById('bookmarkTitleInput').value,
        url: document.getElementById('bookmarkUrlInput').value.trim(),
        color: selectedColor,
        group: finalGroup
    };

    if (i !== "") {
        bookmarks[parseInt(i)] = newBookmark;
    } else {
        bookmarks.push(newBookmark);
    }

    updateRecentColors(selectedColor);
    chrome.storage.sync.set({ bookmarks }, () => {
        closeBookmarkEditMode();
        renderBookmarks();
    });
});

document.getElementById('addBookmarkToggleBtn').addEventListener('click', openBookmarkEditorForCurrentPage);

// Ordner-Import über die chrome.bookmarks-API (zuverlässiger Weg neben Drag & Drop, das für
// Ordner keine verwertbaren Drag-Daten liefert - siehe importBookmarkFolderBtn-Handler unten).
function renderBookmarkFolderPicker(nodes, depth) {
    let html = '';
    (nodes || []).forEach(node => {
        if (node.children) {
            const childCount = node.children.filter(c => c.url).length;
            html += `<button class="btn-icon-elegant bookmark-folder-item" data-folder-id="${node.id}" style="width:100%; text-align:left; margin-left:${depth * 14}px; margin-bottom:4px;">📁 ${node.title || 'Ordner'} <span style="opacity:0.5; font-size:11px;">(${childCount})</span></button>`;
            html += renderBookmarkFolderPicker(node.children, depth + 1);
        }
    });
    return html;
}

document.getElementById('importBookmarkFolderBtn').addEventListener('click', () => {
    chrome.bookmarks.getTree((tree) => {
        document.getElementById('bookmarkFolderPickerList').innerHTML = renderBookmarkFolderPicker(tree, 0) || '<p style="font-size:12px; opacity:0.5;">Keine Ordner gefunden.</p>';
        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('bookmarkFolderPickerOverlay').style.display = 'flex';
    });
});

document.getElementById('closeBookmarkFolderPickerBtn').addEventListener('click', () => {
    document.getElementById('bookmarkFolderPickerOverlay').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
});

document.getElementById('bookmarkFolderPickerList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-folder-id]');
    if (!btn) return;
    const folderId = btn.dataset.folderId;
    const folderName = btn.textContent.replace(/\(\d+\)$/, '').replace('📁', '').trim();
    chrome.bookmarks.getChildren(folderId, (children) => {
        const links = (children || []).filter(c => c.url);
        if (links.length === 0) { alert('Dieser Ordner enthält keine Lesezeichen.'); return; }
        const groupName = folderName || 'Importierter Ordner';
        links.forEach(c => bookmarks.push({ title: c.title || c.url, url: c.url, color: '#ff8c00', group: groupName }));
        if (!bookmarkGroupMetadata[groupName]) bookmarkGroupMetadata[groupName] = { color: '#ff8c00', icon: '📁' };
        chrome.storage.sync.set({ bookmarks, bookmarkGroupMetadata }, () => {
            renderBookmarks();
            document.getElementById('bookmarkFolderPickerOverlay').style.display = 'none';
            document.getElementById('mainContainer').style.display = 'block';
        });
    });
});

// Lesezeichen sortieren: entweder alle ohne Gruppe (Header-Button) oder alle innerhalb einer
// bestimmten Gruppe (Button im Gruppen-Bearbeiten-Popup, siehe saveBookmarkGroupBtn-Bereich).
function sortBookmarksInScope(groupName) {
    const scoped = [];
    bookmarks.forEach((b, i) => { if ((b.group || '') === (groupName || '')) scoped.push({ b, i }); });
    if (scoped.length < 2) return;
    const sortedItems = scoped.map(s => s.b).slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    scoped.forEach((s, idx) => { bookmarks[s.i] = sortedItems[idx]; });
    chrome.storage.sync.set({ bookmarks }, renderBookmarks);
}

document.getElementById('sortBookmarksBtn').addEventListener('click', () => sortBookmarksInScope(''));

document.getElementById('searchBookmarksInput').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('.bookmark-card').forEach(card => {
        const title = card.querySelector('.prompt-title').innerText.toLowerCase();
        const url = card.querySelector('.content-box').innerText.toLowerCase();
        card.style.display = (title.includes(query) || url.includes(query)) ? 'block' : 'none';
    });
});

// Lesezeichen per Drag & Drop importieren (einzelne Links, mehrere Links oder ganze Ordner aus der Lesezeichenleiste)
// Listener hängen am gesamten Tab-Bereich (#bookmarksView), nicht nur an der (bei wenigen
// Einträgen sehr kleinen) #bookmarksList, damit auch ein Drop im "leeren" Bereich unterhalb
// der Liste erkannt wird und nicht die Browser-Standardaktion (Link in neuem Tab öffnen) greift.
const bookmarksViewEl = document.getElementById('bookmarksView');
bookmarksViewEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    bookmarksViewEl.classList.add('bookmarks-dropzone-active');
});
bookmarksViewEl.addEventListener('dragleave', (e) => {
    if (!bookmarksViewEl.contains(e.relatedTarget)) {
        bookmarksViewEl.classList.remove('bookmarks-dropzone-active');
    }
});
bookmarksViewEl.addEventListener('drop', (e) => {
    e.preventDefault();
    bookmarksViewEl.classList.remove('bookmarks-dropzone-active');

    const links = [];
    const seenUrls = new Set();
    const addLink = (group, url, title) => {
        if (!url) return;
        url = url.trim();
        if (!url || seenUrls.has(url)) return;
        seenUrls.add(url);
        links.push({ group: group || '', title: (title || '').trim() || url, url });
    };

    // Chrome-Lesezeichen-HTML (Netscape-Bookmark-Format): <h3>Ordnername</h3> gefolgt von <a>-Links.
    // Verlinkte <h3>/<a>-Elemente in Dokumentreihenfolge durchlaufen: jeder Link gehört zum zuletzt
    // gesehenen <h3> (= seinem unmittelbaren Ordner), so werden auch verschachtelte Ordner korrekt zugeordnet.
    const html = e.dataTransfer.getData('text/html');
    if (html) {
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            let currentGroup = '';
            doc.querySelectorAll('h3, a[href]').forEach(el => {
                if (el.tagName === 'H3') {
                    currentGroup = (el.textContent || '').trim();
                } else {
                    addLink(currentGroup, el.getAttribute('href'), el.textContent);
                }
            });
        } catch (err) {}
    }

    if (links.length === 0) {
        const uriList = e.dataTransfer.getData('text/uri-list');
        if (uriList) {
            uriList.split(/\r?\n/).forEach(line => {
                if (line && !line.startsWith('#')) addLink('', line, '');
            });
        }
    }

    if (links.length === 0) {
        const plain = e.dataTransfer.getData('text/plain');
        if (plain) addLink('', plain, '');
    }

    if (links.length === 0) return;

    // Mehrere Links ohne erkannte Ordner-Gruppe (z.B. wenn Chrome beim Ordner-Drag nur
    // text/uri-list ohne Ordnernamen liefert) -> Nutzer nach einem Gruppennamen fragen,
    // damit der Ordner trotzdem als Gruppe importiert wird statt ungruppiert zu landen.
    if (links.length > 1 && links.every(l => !l.group)) {
        const folderGroup = prompt(`${links.length} Lesezeichen erkannt. Als Gruppe importieren unter dem Namen:`, 'Importierter Ordner');
        if (folderGroup && folderGroup.trim()) {
            links.forEach(l => { l.group = folderGroup.trim(); });
        }
    }

    const newGroupNames = new Set();
    links.forEach(l => {
        if (l.group && !bookmarkGroupMetadata[l.group]) newGroupNames.add(l.group);
        bookmarks.push({ title: l.title, url: l.url, color: '#ff8c00', group: l.group });
    });
    newGroupNames.forEach(gName => {
        bookmarkGroupMetadata[gName] = { color: '#ff8c00', icon: '🔖' };
    });
    chrome.storage.sync.set({ bookmarks, bookmarkGroupMetadata }, renderBookmarks);
});

// Clipboard-Copy via Event-Delegation (Listener muss auf dem DOM-Element sein, nicht auf outerHTML)
document.getElementById('notesList').addEventListener('click', (e) => {
    const titleEl = e.target.closest('[data-note-copy-idx]');
    if (!titleEl) return;
    e.stopPropagation();
    const i = parseInt(titleEl.dataset.noteCopyIdx);
    const n = notes[i];
    if (!n) return;
    let content = n.text || '';
    if (n.todos && n.todos.length)
        content += '\n' + n.todos.map(t => (t.done ? '✓ ' : '○ ') + t.text).join('\n');
    navigator.clipboard.writeText(content).then(() => {
        const orig = titleEl.innerHTML;
        titleEl.innerHTML = '✓ Kopiert';
        setTimeout(() => { titleEl.innerHTML = orig; }, 1200);
    }).catch(() => {});
});

function renderEditorTodos() {
    const listEl = document.getElementById('editorTodoList');
    if (!listEl) return;
    listEl.innerHTML = currentEditorTodos.map((t, idx) => `
        <div class="input-row" style="gap:5px;">
            <input type="checkbox" id="edit-todo-cb-${idx}" ${t.done ? 'checked' : ''}>
            <input type="text" value="${t.text}" id="edit-todo-txt-${idx}" style="flex:1; padding:6px;">
            <button class="group-edit-btn remove-editor-todo" data-index="${idx}" style="color:#cf6679;">✕</button>
        </div>
    `).join('');

    currentEditorTodos.forEach((_, idx) => {
        document.getElementById(`edit-todo-cb-${idx}`).addEventListener('change', (e) => {
            currentEditorTodos[idx].done = e.target.checked;
        });
        document.getElementById(`edit-todo-txt-${idx}`).addEventListener('input', (e) => {
            currentEditorTodos[idx].text = e.target.value;
        });
    });
}

document.getElementById('editorTodoList').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-editor-todo')) {
        const idx = parseInt(e.target.dataset.index);
        currentEditorTodos.splice(idx, 1);
        renderEditorTodos();
    }
});

document.getElementById('addTodoItemBtn').addEventListener('click', () => {
    const input = document.getElementById('newTodoItemInput');
    const text = input.value.trim();
    if (text) {
        currentEditorTodos.push({ text, done: false });
        input.value = '';
        renderEditorTodos();
    }
});

function closeNoteEditMode() {
    document.getElementById('noteInputGroup').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('editNoteIndex').value = "";
    document.getElementById('noteTitleInput').value = '';
    document.getElementById('noteTextInput').value = '';
    document.getElementById('noteGroupInput').value = '';
    document.getElementById('noteGroupInput').style.display = 'none';
    document.getElementById('noteGroupSelectOptions').value = '';
    currentEditorTodos = [];
    document.getElementById('noteIconInput').value = '';
}

document.getElementById('cancelNoteBtn').addEventListener('click', closeNoteEditMode);

document.getElementById('noteIconQuickPick').addEventListener('click', (e) => {
    const btn = e.target.closest('.note-icon-pick');
    if (btn) document.getElementById('noteIconInput').value = btn.dataset.icon;
});

document.getElementById('saveNoteBtn').addEventListener('click', () => {
    const i = document.getElementById('editNoteIndex').value;
    const selectedColor = document.getElementById('noteColor').value;
    const pinned = document.getElementById('notePinnedInput').checked;
    
    let finalGroup = '';
    const dropdownValue = document.getElementById('noteGroupSelectOptions').value;
    if (dropdownValue === '__NEW_GROUP__') {
        finalGroup = document.getElementById('noteGroupInput').value.trim();
    } else {
        finalGroup = dropdownValue;
    }

    const newNote = {
        title: document.getElementById('noteTitleInput').value,
        text: document.getElementById('noteTextInput').value,
        color: selectedColor,
        pinned: pinned,
        group: finalGroup,
        todos: currentEditorTodos,
        icon: document.getElementById('noteIconInput').value.trim()
    };

    if (i !== "") {
        notes[parseInt(i)] = newNote;
    } else {
        notes.push(newNote);
    }

    updateRecentColors(selectedColor);
    chrome.storage.sync.set({ notes }, () => {
        closeNoteEditMode();
    });
});

document.getElementById('addNoteToggleBtn').addEventListener('click', () => {
    document.getElementById('editNoteIndex').value = "";
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('noteInputGroup').style.display = 'flex';
    currentEditorTodos = [];
    renderEditorTodos();
    populateGroupDropdowns();
    renderRecentColors();
});

document.getElementById('sessionsView').addEventListener('click', (e) => {
    const target = e.target.closest('[data-session-action]');
    if (!target) return;

    const action = target.dataset.sessionAction; 
    const card = e.target.closest('.session-card');
    if (!card) return;
    const sIdx = parseInt(card.dataset.sessionIndex);
    const session = savedSessions[sIdx];

    if (action === 'toggle-collapse') {
        collapsedSessions[sIdx] = !collapsedSessions[sIdx];
        renderSessions();
        return;
    }
    if (action === 'restore-all') {
        if (session) {
            let totalTabs = 0;
            if (session.windows) session.windows.forEach(w => { totalTabs += (w.tabs || []).length; });
            else if (session.tabs) totalTabs = session.tabs.length;
            const popup = document.getElementById('sessionRestorePopup');
            document.getElementById('sessionRestorePopupInfo').textContent =
                `„${session.name || 'Unbenannte Session'}" mit ${totalTabs} Tab(s) wiederherstellen.`;
            popup.dataset.sessionIdx = sIdx;
            popup.style.display = 'flex';
        }
        return;
    }
    if (action === 'rename') {
        const newName = prompt("Sitzungs-Name ändern:", session.name || "");
        if (newName !== null) {
            session.name = newName.trim() || "Unbenannte Session";
            chrome.storage.sync.set({ savedSessions });
        }
        return;
    }
    if (action === 'delete') {
        if (confirm("Sitzung wirklich löschen?")) {
            savedSessions.splice(sIdx, 1);
            delete collapsedSessions[sIdx];
            chrome.storage.sync.set({ savedSessions });
        }
        return;
    }
    if (action === 'update-current') {
        chrome.windows.getAll({ populate: true }, (windows) => {
            const savedWindows = [];
            windows.forEach((win) => {
                // Filter entfernt: Speichert alle Seiten, inklusive leerer Tabs und Sonderseiten (chrome://)
                const validTabs = win.tabs.map(t => {
                    let oldTitle = t.title || t.url || "Neuer Tab";
                    if (session.windows) {
                        for (const ow of session.windows) {
                            if (ow.tabs) {
                                const found = ow.tabs.find(ot => ot.url === t.url);
                                if (found) { oldTitle = found.title; break; }
                            }
                        }
                    } else if (session.tabs) {
                        const found = session.tabs.find(ot => ot.url === t.url);
                        if (found) oldTitle = found.title;
                    }
                    return { title: oldTitle, url: t.url || "" };
                });
                if (validTabs.length > 0) {
                    savedWindows.push({
                        tabs: validTabs,
                        width: win.width,
                        height: win.height,
                        top: win.top,
                        left: win.left
                    });
                }
            });
            if (savedWindows.length === 0) {
                alert("Keine sicherbaren Tabs geöffnet.");
                return;
            }
            session.windows = savedWindows;
            if (session.tabs) delete session.tabs;
            chrome.storage.sync.set({ savedSessions }, () => { 
                alert("Session erfolgreich für alle geöffneten Fenster aktualisiert!");
            });
        });
        return;
    }

    const isMultiWin = target.dataset.multiWin === "true";
    let targetTabsArr = [];
    let tIdx = 0;

    if (isMultiWin) {
        const wIdx = parseInt(target.dataset.winIdx);
        tIdx = parseInt(target.dataset.tIdx);
        if (session.windows && session.windows[wIdx]) {
            targetTabsArr = session.windows[wIdx].tabs || [];
        }
    } else {
        tIdx = parseInt(target.dataset.tabIndex);
        targetTabsArr = session.tabs || [];
    }

    if (action === 'rename-tab') {
        if (targetTabsArr[tIdx]) {
            const currentTab = targetTabsArr[tIdx];
            const newTabTitle = prompt(`Seiten-Titel ändern für:\nURL: ${currentTab.url || "Neuer Tab"}\n\nAktueller Titel:`, currentTab.title || "");
            if (newTabTitle !== null) {
                currentTab.title = newTabTitle.trim() || currentTab.url || "Neuer Tab";
                chrome.storage.sync.set({ savedSessions });
            }
        }
    }
    else if (action === 'remove-tab') {
        if (targetTabsArr) {
            targetTabsArr.splice(tIdx, 1);
            if (isMultiWin && targetTabsArr.length === 0) {
                const wIdx = parseInt(target.dataset.winIdx);
                session.windows.splice(wIdx, 1);
            }
            chrome.storage.sync.set({ savedSessions });
        }
    }
    else if (action === 'move-up') {
        if (tIdx > 0) {
            const temp = targetTabsArr[tIdx];
            targetTabsArr[tIdx] = targetTabsArr[tIdx - 1];
            targetTabsArr[tIdx - 1] = temp;
            chrome.storage.sync.set({ savedSessions });
        }
    }
    else if (action === 'move-down') {
        if (tIdx < targetTabsArr.length - 1) {
            const temp = targetTabsArr[tIdx];
            targetTabsArr[tIdx] = targetTabsArr[tIdx + 1];
            targetTabsArr[tIdx + 1] = temp;
            chrome.storage.sync.set({ savedSessions });
        }
    }
});

function doSessionRestore(openInNew) {
    const popup = document.getElementById('sessionRestorePopup');
    const sIdx = parseInt(popup.dataset.sessionIdx);
    popup.style.display = 'none';
    const session = savedSessions[sIdx];
    if (!session) return;
    if (session.windows && session.windows.length > 0) {
        session.windows.forEach((win, winIdx) => {
            if (win.tabs && win.tabs.length > 0) {
                if (!openInNew && winIdx === 0) {
                    win.tabs.forEach(t => chrome.tabs.create({ url: t.url || "about:blank" }));
                } else {
                    const createData = { url: win.tabs.map(t => t.url || "about:blank") };
                    if (win.width && win.height) {
                        createData.width = win.width;
                        createData.height = win.height;
                        createData.top = win.top;
                        createData.left = win.left;
                    }
                    chrome.windows.create(createData);
                }
            }
        });
    } else if (session.tabs && session.tabs.length > 0) {
        if (!openInNew) {
            session.tabs.forEach(t => chrome.tabs.create({ url: t.url || "about:blank" }));
        } else {
            const createData = { url: session.tabs.map(t => t.url || "about:blank") };
            if (session.width && session.height) {
                createData.width = session.width;
                createData.height = session.height;
                createData.top = session.top;
                createData.left = session.left;
            }
            chrome.windows.create(createData);
        }
    }
}

document.getElementById('restoreNewWindowBtn').addEventListener('click', () => doSessionRestore(true));
document.getElementById('restoreCurrentWindowBtn').addEventListener('click', () => doSessionRestore(false));
document.getElementById('restoreCancelBtn').addEventListener('click', () => {
    document.getElementById('sessionRestorePopup').style.display = 'none';
});

function closeGroupEditMode() {
    document.getElementById('groupEditorGroup').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('editGroupOldName').value = "";
    document.getElementById('groupTitleInput').value = "";
}

document.getElementById('saveGroupBtn').addEventListener('click', () => {
    const oldName = document.getElementById('editGroupOldName').value;
    const newName = document.getElementById('groupTitleInput').value.trim();
    const icon = document.getElementById('groupIconInput').value || '📁';
    const color = document.getElementById('groupColorInput').value;
    const groupProvider = document.getElementById('groupAiProvider').value || 'default';

    if (!newName) {
        alert("Gruppenname darf nicht leer sein.");
        return;
    }
    if (oldName && oldName !== newName) {
        promts.forEach(p => { if (p.group === oldName) p.group = newName; });
        notes.forEach(n => { if (n.group === oldName) n.group = newName; });
        if (groupMetadata[oldName]) delete groupMetadata[oldName];
        const goIdx = groupOrder.indexOf(oldName);
        if (goIdx !== -1) groupOrder[goIdx] = newName;
        const ngoIdx = noteGroupOrder.indexOf(oldName);
        if (ngoIdx !== -1) noteGroupOrder[ngoIdx] = newName;
    }
    groupMetadata[newName] = { color, icon, groupProvider };
    updateRecentColors(color);
    chrome.storage.sync.set({ promts, notes, groupMetadata, groupOrder, noteGroupOrder }, () => {
        closeGroupEditMode();
    });
});

document.getElementById('cancelGroupBtn').addEventListener('click', closeGroupEditMode);

document.getElementById('groupIconQuickPick').addEventListener('click', (e) => {
    const btn = e.target.closest('.group-icon-pick');
    if (btn) document.getElementById('groupIconInput').value = btn.dataset.icon;
});

document.getElementById('addCustomProviderBtn').addEventListener('click', () => {
    const nameIn = document.getElementById('customProviderNameInput');
    const iconIn = document.getElementById('customProviderIconInput');
    const name = nameIn.value.trim();
    const icon = iconIn.value.trim() || '⚬';
    if (!name) return;
    if (customProviders.some(cp => cp.name === name)) {
        alert('Ein Anbieter mit diesem Namen existiert bereits.');
        return;
    }
    customProviders.push({ name, icon });
    nameIn.value = '';
    iconIn.value = '';
    chrome.storage.sync.set({ customProviders }, populateProviderDropdowns);
});

document.getElementById('customProviderList').addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-custom-provider');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);
    customProviders.splice(idx, 1);
    chrome.storage.sync.set({ customProviders }, populateProviderDropdowns);
});

document.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot[data-color]');
    if (!dot) return;
    
    if (document.getElementById('inputGroup').style.display === 'flex') {
        document.getElementById('promptColor').value = dot.dataset.color;
    } else if (document.getElementById('groupEditorGroup').style.display === 'flex') {
        document.getElementById('groupColorInput').value = dot.dataset.color;
    } else if (document.getElementById('noteInputGroup').style.display === 'flex') {
        document.getElementById('noteColor').value = dot.dataset.color;
    } else if (document.getElementById('makroInputGroup').style.display === 'flex') {
        document.getElementById('makroColor').value = dot.dataset.color;
    } else if (document.getElementById('bookmarkInputGroup').style.display === 'flex') {
        document.getElementById('bookmarkColor').value = dot.dataset.color;
    }
});

document.getElementById('trashList').addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const i = parseInt(target.dataset.index);

    if (action === 'restore') {
        const restored = deletedPromts.splice(i, 1)[0];
        promts.push(restored);
        chrome.storage.sync.set({ promts, deletedPromts });
    } 
    else if (action === 'perma-delete') {
        deletedPromts.splice(i, 1);
        chrome.storage.sync.set({ deletedPromts });
    }
});

function closeEditMode() {
    document.getElementById('inputGroup').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('editIndex').value = "";
    document.getElementById('titleInput').value = '';
    document.getElementById('textInput').value = '';
    autoResizeTextInput();
    document.getElementById('shortcutInput').value = '';
    document.getElementById('groupInput').value = '';
    document.getElementById('groupInput').style.display = 'none';
    document.getElementById('groupSelectOptions').value = '';
}

// Prompt-Text-Feld: Höhe an Inhalt anpassen (leer = doppelte Standardhöhe)
function autoResizeTextInput() {
    const el = document.getElementById('textInput');
    if (!el) return;
    if (!el.value) {
        el.style.height = '200px';
    } else {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }
}
document.getElementById('textInput').addEventListener('input', autoResizeTextInput);

// Shortcut per Tastendruck aufnehmen statt manuell eintippen
document.getElementById('shortcutInput').addEventListener('keydown', (e) => {
    e.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    e.target.value = parts.join('+');
});

document.getElementById('clearShortcutBtn').addEventListener('click', () => {
    document.getElementById('shortcutInput').value = '';
});

document.getElementById('saveBtn').addEventListener('click', () => {
    const i = document.getElementById('editIndex').value;
    const selectedColor = document.getElementById('promptColor').value;
    
    let finalGroup = '';
    const dropdownValue = document.getElementById('groupSelectOptions').value;
    if (dropdownValue === '__NEW_GROUP__') {
        finalGroup = document.getElementById('groupInput').value.trim();
    } else {
        finalGroup = dropdownValue;
    }
    
    const newP = {
        title: document.getElementById('titleInput').value,
        text: document.getElementById('textInput').value,
        color: selectedColor,
        shortcut: document.getElementById('shortcutInput').value,
        provider: document.getElementById('aiProvider').value,
        group: finalGroup
    };

    if (i !== "") {
        promts[parseInt(i)] = newP;
    } else {
        promts.push(newP);
    }

    updateRecentColors(selectedColor);
    chrome.storage.sync.set({ promts }, () => {
        closeEditMode();
    });
});

document.getElementById('cancelBtn').addEventListener('click', closeEditMode);

document.getElementById('searchInput').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('#promptList .prompt-card').forEach(card => {
        const title = card.querySelector('.prompt-title').innerText.toLowerCase();
        const content = card.querySelector('.content-box').innerText.toLowerCase();
        card.style.display = (title.includes(query) || content.includes(query)) ? 'block' : 'none';
    });
});

document.getElementById('searchNotesInput').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('.note-card').forEach(card => {
        const title = card.querySelector('.note-title').innerText.toLowerCase();
        const content = card.querySelector('.content-box').innerText.toLowerCase();
        card.style.display = (title.includes(query) || content.includes(query)) ? 'block' : 'none';
    });
});

document.getElementById('searchMakrosInput').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('.makro-card').forEach(card => {
        const title = card.querySelector('.makro-title').innerText.toLowerCase();
        card.style.display = title.includes(query) ? 'block' : 'none';
    });
});

document.getElementById('addToggleBtn').addEventListener('click', () => {
    document.getElementById('editIndex').value = "";
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('inputGroup').style.display = 'flex';
    populateGroupDropdowns();
    renderRecentColors();
    autoResizeTextInput();
});

document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.dataset.theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
});

document.getElementById('trashToggleBtn').addEventListener('click', () => {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('trashOverlay').style.display = 'flex';
});

document.getElementById('closeTrashBtn').addEventListener('click', () => {
    document.getElementById('trashOverlay').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
});

document.getElementById('emptyTrashBtn').addEventListener('click', () => {
    if(confirm("Möchtest du den Papierkorb unwiderruflich leeren?")) {
        deletedPromts = [];
        chrome.storage.sync.set({ deletedPromts });
    }
});

document.getElementById('backupToggleBtn').addEventListener('click', () => {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('backupOverlay').style.display = 'flex';
    checkSyncStatus();
});

document.getElementById('closeBackupBtn').addEventListener('click', () => {
    document.getElementById('backupOverlay').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
});

document.getElementById('btnExecuteBackupExport').addEventListener('click', () => {
    if(confirm("Möchtest du jetzt ein vollständiges Backup erstellen und den Speicherort festlegen?")) {
        chrome.storage.sync.get(null, (syncData) => {
            chrome.storage.local.get({ tabCustomIcons: {} }, (localData) => {
                const totalBackup = {
                    K_SIDEBAR_BACKUP_VERSION: "1.0.16",
                    timestamp: Date.now(),
                    syncStorage: syncData,
                    localStorage: { tabCustomIcons: localData.tabCustomIcons || {} }
                };
                const blob = new Blob([JSON.stringify(totalBackup, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                chrome.downloads.download({
                    url: url,
                    filename: `k_sidebar_full_backup_${new Date().toISOString().slice(0,10)}.json`,
                    saveAs: true
                }, () => {
                    URL.revokeObjectURL(url);
                });
            });
        });
    }
});

document.getElementById('btnExecuteBackupImport').addEventListener('click', () => {
    document.getElementById('backupFileInput').click();
});

document.getElementById('backupFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const backup = JSON.parse(event.target.result);
            if (backup && backup.syncStorage) {
                if (confirm("Achtung! Das Einspielen überschreibt alle aktuellen Daten. Fortfahren?")) {
                    const syncToSet = backup.syncStorage || {};
                    const localToSet = (backup.localStorage && backup.localStorage.tabCustomIcons) ? backup.localStorage : { tabCustomIcons: {} };
                    chrome.storage.sync.clear(() => {
                        chrome.storage.sync.set(syncToSet, () => {
                            chrome.storage.local.set(localToSet, () => {
                                alert("System-Backup erfolgreich eingespielt!");
                                document.getElementById('backupOverlay').style.display = 'none';
                                document.getElementById('mainContainer').style.display = 'block';
                            });
                        });
                    });
                }
            } else {
                alert("Ungültiges Backup-Format.");
            }
        } catch (err) {
            alert("Fehler beim Lesen der Backup-Datei.");
        }
    };
    reader.readAsText(file);
});

document.getElementById('saveCurrentSessionBtn').addEventListener('click', () => {
    chrome.windows.getAll({ populate: true }, (windows) => {
        const savedWindows = [];
        windows.forEach((win) => {
            // Filter entfernt: Speichert absolut jeden Tab ab, auch leere und chrome:// Seiten
            const validTabs = win.tabs.map(t => ({
                title: t.title || t.url || "Neuer Tab",
                url: t.url || ""
            }));
            if (validTabs.length > 0) {
                savedWindows.push({
                    tabs: validTabs,
                    width: win.width,
                    height: win.height,
                    top: win.top,
                    left: win.left
                });
            }
        });
        if (savedWindows.length === 0) {
            alert("Keine sicherbaren Tabs in geöffneten Fenstern gefunden.");
            return;
        }
        const dateStr = new Date().toLocaleString('de-DE', { hour12: false });
        const sessionName = prompt("Name für diese All-Window Session eingeben:", `Sitzung vom ${dateStr}`);
        if (sessionName !== null) {
            const newSession = {
                name: sessionName.trim() || `Sitzung vom ${dateStr}`,
                windows: savedWindows,
                timestamp: Date.now()
            };
            savedSessions.unshift(newSession);
            const updatedCollapsed = { 0: true };
            Object.keys(collapsedSessions).forEach(k => {
                updatedCollapsed[parseInt(k) + 1] = collapsedSessions[k];
            });
            collapsedSessions = updatedCollapsed;
            chrome.storage.sync.set({ savedSessions });
        }
    });
});

// Kontextmenü-Trigger für Rechtsklick auf Prompts, Notizen, Lesezeichen und Gruppen
document.addEventListener('contextmenu', (e) => {
    const promptCard = e.target.closest('.prompt-card');
    const noteCard = e.target.closest('.note-card');
    const bookmarkCard = e.target.closest('.bookmark-card');
    const groupHeader = e.target.closest('.group-header[data-group]');
    const noteGroupHeader = e.target.closest('.group-header[data-notegroup]');
    const bookmarkGroupHeader = e.target.closest('.group-header[data-bookmarkgroup]');

    if (promptCard || noteCard || bookmarkCard || groupHeader || noteGroupHeader || bookmarkGroupHeader) {
        e.preventDefault();
        document.getElementById('tabContextMenu').style.display = 'none';
        document.getElementById('promptContextMenu').style.display = 'none';
        document.getElementById('noteContextMenu').style.display = 'none';
        document.getElementById('bookmarkContextMenu').style.display = 'none';
        document.getElementById('groupContextMenu').style.display = 'none';

        const positionMenu = (menu) => {
            menu.style.visibility = 'hidden';
            menu.style.left = '0px';
            menu.style.top = '0px';
            menu.style.display = 'block';
            requestAnimationFrame(() => {
                const rect = menu.getBoundingClientRect();
                let x = Math.min(e.clientX, window.innerWidth - rect.width - 5);
                let y = Math.min(e.clientY, window.innerHeight - rect.height - 5);
                x = Math.max(5, x);
                y = Math.max(5, y);
                menu.style.left = x + 'px';
                menu.style.top = y + 'px';
                menu.style.visibility = 'visible';
            });
        };

        if (promptCard) {
            const actionEl = promptCard.querySelector('[data-index]');
            const idx = actionEl ? parseInt(actionEl.dataset.index) : -1;
            const menu = document.getElementById('promptContextMenu');
            positionMenu(menu);
            menu.dataset.index = idx;
        } else if (noteCard) {
            const actionEl = noteCard.querySelector('[data-index]');
            const idx = actionEl ? parseInt(actionEl.dataset.index) : -1;
            const menu = document.getElementById('noteContextMenu');
            positionMenu(menu);
            menu.dataset.index = idx;
        } else if (bookmarkCard) {
            const actionEl = bookmarkCard.querySelector('[data-index]');
            const idx = actionEl ? parseInt(actionEl.dataset.index) : -1;
            const menu = document.getElementById('bookmarkContextMenu');
            positionMenu(menu);
            menu.dataset.index = idx;
        } else if (groupHeader) {
            const menu = document.getElementById('groupContextMenu');
            positionMenu(menu);
            menu.dataset.group = groupHeader.dataset.group;
            menu.dataset.type = 'prompt';
            document.getElementById('ctxDuplicateGroup').style.display = 'block';
        } else if (noteGroupHeader) {
            const menu = document.getElementById('groupContextMenu');
            positionMenu(menu);
            menu.dataset.group = noteGroupHeader.dataset.notegroup;
            menu.dataset.type = 'note';
            document.getElementById('ctxDuplicateGroup').style.display = 'none';
        } else if (bookmarkGroupHeader) {
            const menu = document.getElementById('groupContextMenu');
            positionMenu(menu);
            menu.dataset.group = bookmarkGroupHeader.dataset.bookmarkgroup;
            menu.dataset.type = 'bookmark';
            document.getElementById('ctxDuplicateGroup').style.display = 'none';
        }
        return;
    }
});

document.getElementById('ctxMovePromptUp').addEventListener('click', () => {
    const menu = document.getElementById('promptContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || idx <= 0) return;
    [promts[idx - 1], promts[idx]] = [promts[idx], promts[idx - 1]];
    chrome.storage.sync.set({ promts }, render);
});

document.getElementById('ctxMovePromptDown').addEventListener('click', () => {
    const menu = document.getElementById('promptContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || idx >= promts.length - 1) return;
    [promts[idx], promts[idx + 1]] = [promts[idx + 1], promts[idx]];
    chrome.storage.sync.set({ promts }, render);
});

document.getElementById('ctxDuplicatePrompt').addEventListener('click', () => {
    const menu = document.getElementById('promptContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || !promts[idx]) return;
    const orig = promts[idx];
    const copy = Object.assign({}, orig, { title: orig.title + ' (Kopie)' });
    promts.splice(idx + 1, 0, copy);
    chrome.storage.sync.set({ promts }, render);
});

document.getElementById('ctxDuplicateGroup').addEventListener('click', () => {
    const menu = document.getElementById('groupContextMenu');
    const gName = menu.dataset.group;
    menu.style.display = 'none';
    if (!gName || menu.dataset.type === 'note') return;
    let newName = gName + ' (Kopie)';
    let counter = 2;
    while (promts.some(p => p.group === newName) || groupMetadata[newName]) {
        newName = gName + ` (Kopie ${counter++})`;
    }
    // Gruppe-Metadaten kopieren
    if (groupMetadata[gName]) {
        groupMetadata[newName] = Object.assign({}, groupMetadata[gName]);
    }
    // Alle Prompts der Gruppe kopieren
    const groupPrompts = promts.filter(p => p.group === gName);
    const copies = groupPrompts.map(p => Object.assign({}, p, { title: p.title + ' (Kopie)', group: newName }));
    // Kopien direkt nach dem letzten Prompt der Originalgruppe einfügen
    const lastIdx = promts.reduce((acc, p, i) => p.group === gName ? i : acc, -1);
    promts.splice(lastIdx + 1, 0, ...copies);
    groupOrder.push(newName);
    chrome.storage.sync.set({ promts, groupMetadata, groupOrder }, render);
});

document.getElementById('ctxRenamePrompt').addEventListener('click', () => {
    const menu = document.getElementById('promptContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || !promts[idx]) return;
    const newTitle = prompt('Neuer Titel:', promts[idx].title || '');
    if (newTitle === null) return;
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    promts[idx].title = trimmed;
    chrome.storage.sync.set({ promts }, render);
});

document.getElementById('ctxDeletePrompt').addEventListener('click', () => {
    const menu = document.getElementById('promptContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || !promts[idx]) return;
    const removed = promts.splice(idx, 1)[0];
    deletedPromts.push(removed);
    chrome.storage.sync.set({ promts, deletedPromts }, render);
});

document.getElementById('ctxRenameNote').addEventListener('click', () => {
    const menu = document.getElementById('noteContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || !notes[idx]) return;
    const newTitle = prompt('Neuer Titel:', notes[idx].title || '');
    if (newTitle === null) return;
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    notes[idx].title = trimmed;
    chrome.storage.sync.set({ notes }, renderNotes);
});

document.getElementById('ctxDeleteNote').addEventListener('click', () => {
    const menu = document.getElementById('noteContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || !notes[idx]) return;
    notes.splice(idx, 1);
    chrome.storage.sync.set({ notes }, renderNotes);
});

document.getElementById('ctxAddCurrentPageBookmark').addEventListener('click', () => {
    document.getElementById('bookmarkContextMenu').style.display = 'none';
    openBookmarkEditorForCurrentPage();
});

document.getElementById('ctxEditBookmark').addEventListener('click', () => {
    const menu = document.getElementById('bookmarkContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || !bookmarks[idx]) return;
    openBookmarkEditor(idx);
});

document.getElementById('ctxDeleteBookmark').addEventListener('click', () => {
    const menu = document.getElementById('bookmarkContextMenu');
    const idx = parseInt(menu.dataset.index);
    menu.style.display = 'none';
    if (isNaN(idx) || !bookmarks[idx]) return;
    bookmarks.splice(idx, 1);
    chrome.storage.sync.set({ bookmarks }, renderBookmarks);
});

document.getElementById('ctxMoveGroupUp').addEventListener('click', () => {
    const menu = document.getElementById('groupContextMenu');
    const gName = menu.dataset.group;
    const type = menu.dataset.type;
    menu.style.display = 'none';
    if (!gName) return;
    if (type === 'prompt') {
        const idx = groupOrder.indexOf(gName);
        if (idx > 0) { [groupOrder[idx - 1], groupOrder[idx]] = [groupOrder[idx], groupOrder[idx - 1]]; chrome.storage.sync.set({ groupOrder }, renderPromts); }
    } else if (type === 'note') {
        const idx = noteGroupOrder.indexOf(gName);
        if (idx > 0) { [noteGroupOrder[idx - 1], noteGroupOrder[idx]] = [noteGroupOrder[idx], noteGroupOrder[idx - 1]]; chrome.storage.sync.set({ noteGroupOrder }, renderNotes); }
    } else if (type === 'bookmark') {
        const idx = bookmarkGroupOrder.indexOf(gName);
        if (idx > 0) { [bookmarkGroupOrder[idx - 1], bookmarkGroupOrder[idx]] = [bookmarkGroupOrder[idx], bookmarkGroupOrder[idx - 1]]; chrome.storage.sync.set({ bookmarkGroupOrder }, renderBookmarks); }
    }
});

document.getElementById('ctxMoveGroupDown').addEventListener('click', () => {
    const menu = document.getElementById('groupContextMenu');
    const gName = menu.dataset.group;
    const type = menu.dataset.type;
    menu.style.display = 'none';
    if (!gName) return;
    if (type === 'prompt') {
        const idx = groupOrder.indexOf(gName);
        if (idx >= 0 && idx < groupOrder.length - 1) { [groupOrder[idx], groupOrder[idx + 1]] = [groupOrder[idx + 1], groupOrder[idx]]; chrome.storage.sync.set({ groupOrder }, renderPromts); }
    } else if (type === 'note') {
        const idx = noteGroupOrder.indexOf(gName);
        if (idx >= 0 && idx < noteGroupOrder.length - 1) { [noteGroupOrder[idx], noteGroupOrder[idx + 1]] = [noteGroupOrder[idx + 1], noteGroupOrder[idx]]; chrome.storage.sync.set({ noteGroupOrder }, renderNotes); }
    } else if (type === 'bookmark') {
        const idx = bookmarkGroupOrder.indexOf(gName);
        if (idx >= 0 && idx < bookmarkGroupOrder.length - 1) { [bookmarkGroupOrder[idx], bookmarkGroupOrder[idx + 1]] = [bookmarkGroupOrder[idx + 1], bookmarkGroupOrder[idx]]; chrome.storage.sync.set({ bookmarkGroupOrder }, renderBookmarks); }
    }
});

document.getElementById('ctxRenameGroup').addEventListener('click', () => {
    const menu = document.getElementById('groupContextMenu');
    const gName = menu.dataset.group;
    const type = menu.dataset.type || 'prompt';
    menu.style.display = 'none';
    if (!gName) return;
    const newName = prompt('Neuer Gruppenname:', gName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === gName) return;
    if (type === 'bookmark') {
        if (bookmarkGroupMetadata[gName]) {
            bookmarkGroupMetadata[trimmed] = bookmarkGroupMetadata[gName];
            delete bookmarkGroupMetadata[gName];
        }
        bookmarks.forEach(b => { if (b.group === gName) b.group = trimmed; });
        const oi = bookmarkGroupOrder.indexOf(gName);
        if (oi !== -1) bookmarkGroupOrder[oi] = trimmed;
        chrome.storage.sync.set({ bookmarks, bookmarkGroupMetadata, bookmarkGroupOrder }, renderBookmarks);
        return;
    }
    if (groupMetadata[gName]) {
        groupMetadata[trimmed] = groupMetadata[gName];
        delete groupMetadata[gName];
    }
    if (type === 'note') {
        notes.forEach(n => { if (n.group === gName) n.group = trimmed; });
        const oi = noteGroupOrder.indexOf(gName);
        if (oi !== -1) noteGroupOrder[oi] = trimmed;
        chrome.storage.sync.set({ notes, groupMetadata, noteGroupOrder }, renderNotes);
    } else {
        promts.forEach(p => { if (p.group === gName) p.group = trimmed; });
        const oi = groupOrder.indexOf(gName);
        if (oi !== -1) groupOrder[oi] = trimmed;
        chrome.storage.sync.set({ promts, groupMetadata, groupOrder }, render);
    }
});

document.getElementById('ctxDeleteGroup').addEventListener('click', () => {
    const menu = document.getElementById('groupContextMenu');
    const gName = menu.dataset.group;
    const type = menu.dataset.type || 'prompt';
    menu.style.display = 'none';
    if (!gName) return;
    window._pendingDeleteGroup = { gName, type };
    document.getElementById('groupDeletePopupInfo').textContent = `Gruppe "${gName}" wirklich löschen?`;
    document.getElementById('groupDeletePopup').style.display = 'flex';
});

function finishGroupDelete(alsoDeleteItems) {
    const pending = window._pendingDeleteGroup;
    document.getElementById('groupDeletePopup').style.display = 'none';
    window._pendingDeleteGroup = null;
    if (!pending) return;
    const { gName, type } = pending;
    if (type === 'bookmark') {
        delete bookmarkGroupMetadata[gName];
        if (alsoDeleteItems) {
            bookmarks = bookmarks.filter(b => b.group !== gName);
        } else {
            bookmarks.forEach(b => { if (b.group === gName) b.group = ''; });
        }
        bookmarkGroupOrder = bookmarkGroupOrder.filter(g => g !== gName);
        chrome.storage.sync.set({ bookmarks, bookmarkGroupMetadata, bookmarkGroupOrder }, renderBookmarks);
        return;
    }
    delete groupMetadata[gName];
    if (type === 'note') {
        if (alsoDeleteItems) {
            notes = notes.filter(n => n.group !== gName);
        } else {
            notes.forEach(n => { if (n.group === gName) n.group = ''; });
        }
        noteGroupOrder = noteGroupOrder.filter(g => g !== gName);
        chrome.storage.sync.set({ notes, groupMetadata, noteGroupOrder }, renderNotes);
    } else {
        if (alsoDeleteItems) {
            const removedPrompts = promts.filter(p => p.group === gName);
            deletedPromts.push(...removedPrompts);
            promts = promts.filter(p => p.group !== gName);
        } else {
            promts.forEach(p => { if (p.group === gName) p.group = ''; });
        }
        groupOrder = groupOrder.filter(g => g !== gName);
        chrome.storage.sync.set({ promts, deletedPromts, groupMetadata, groupOrder }, render);
    }
}

document.getElementById('groupDeleteAllBtn').addEventListener('click', () => finishGroupDelete(true));
document.getElementById('groupDeleteKeepItemsBtn').addEventListener('click', () => finishGroupDelete(false));
document.getElementById('groupDeleteCancelBtn').addEventListener('click', () => {
    document.getElementById('groupDeletePopup').style.display = 'none';
    window._pendingDeleteGroup = null;
});

// Kontextmenü-Trigger für Rechtsklick auf Reiter
document.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) {
        e.preventDefault();
        document.getElementById('promptContextMenu').style.display = 'none';
        document.getElementById('groupContextMenu').style.display = 'none';
        const menu = document.getElementById('tabContextMenu');
        const key = btn.dataset.tab;

        menu.dataset.activeKey = key;
        document.getElementById('tabColorPicker').value = tabColors[key] || '#ff8c00';
        document.getElementById('tabRenameInput').value = tabLabels[key] || tabNames[key] || key;
        document.getElementById('tabIconInput').value = tabIcons[key] || '';
        document.getElementById('tabIconOnlyInput').checked = !!tabIconOnly[key];
        // Alle Sektionen beim Öffnen einklappen
        document.getElementById('tabColorSection').style.display = 'none';
        document.getElementById('tabTextColorSection').style.display = 'none';
        document.getElementById('tabIconSection').style.display = 'none';

        // Menü zunächst unsichtbar positionieren, um die tatsächliche Größe zu messen,
        // damit es garantiert im sichtbaren Bereich bleibt (unabhängig vom Inhalt)
        menu.style.visibility = 'hidden';
        menu.style.left = '0px';
        menu.style.top = '0px';
        menu.style.display = 'block';
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            let x = Math.min(e.clientX, window.innerWidth - rect.width - 5);
            let y = Math.min(e.clientY, window.innerHeight - rect.height - 5);
            x = Math.max(5, x);
            y = Math.max(5, y);
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.visibility = 'visible';
        });
    }
});

document.getElementById('tabColorPicker').addEventListener('input', (e) => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (key) {
        tabColors[key] = e.target.value;
        chrome.storage.sync.set({ tabColors });
        applyTabColors();
    }
});

document.getElementById('resetTabColorBtn').addEventListener('click', () => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (key) {
        delete tabColors[key];
        chrome.storage.sync.set({ tabColors });
        applyTabColors();
        document.getElementById('tabContextMenu').style.display = 'none';
    }
});

document.getElementById('tabRenameApplyBtn').addEventListener('click', () => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    const newLabel = document.getElementById('tabRenameInput').value.trim();
    if (!newLabel || newLabel === (tabNames[key] || key)) {
        delete tabLabels[key];
    } else {
        tabLabels[key] = newLabel;
    }
    chrome.storage.sync.set({ tabLabels }, () => {
        renderTabsNavigation();
        applyTabColors();
        document.getElementById('tabContextMenu').style.display = 'none';
    });
});

document.getElementById('tabIconInput').addEventListener('input', (e) => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    const icon = e.target.value.trim();
    if (icon) tabIcons[key] = icon; else delete tabIcons[key];
    delete tabCustomIcons[key];
    chrome.storage.sync.set({ tabIcons }, () => {
        chrome.storage.local.set({ tabCustomIcons }, () => {
            renderTabsNavigation();
            applyTabColors();
        });
    });
});

document.getElementById('tabIconQuickPick').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-icon-pick');
    if (!btn) return;
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    tabIcons[key] = btn.dataset.icon;
    delete tabCustomIcons[key];
    document.getElementById('tabIconInput').value = btn.dataset.icon;
    chrome.storage.sync.set({ tabIcons }, () => {
        chrome.storage.local.set({ tabCustomIcons }, () => {
            renderTabsNavigation();
            applyTabColors();
        });
    });
});

document.getElementById('tabIconUploadBtn').addEventListener('click', () => {
    document.getElementById('tabIconFileInput').click();
});

document.getElementById('tabIconFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        tabCustomIcons[key] = event.target.result;
        delete tabIcons[key];
        document.getElementById('tabIconInput').value = '';
        chrome.storage.local.set({ tabCustomIcons }, () => {
            chrome.storage.sync.set({ tabIcons }, () => {
                renderTabsNavigation();
                applyTabColors();
            });
        });
    };
    reader.readAsDataURL(file);
});

document.getElementById('tabIconClearBtn').addEventListener('click', () => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    delete tabIcons[key];
    delete tabCustomIcons[key];
    document.getElementById('tabIconInput').value = '';
    chrome.storage.sync.set({ tabIcons }, () => {
        chrome.storage.local.set({ tabCustomIcons }, () => {
            renderTabsNavigation();
            applyTabColors();
        });
    });
});

document.getElementById('tabIconOnlyInput').addEventListener('change', (e) => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    if (e.target.checked) tabIconOnly[key] = true; else delete tabIconOnly[key];
    chrome.storage.sync.set({ tabIconOnly }, () => {
        renderTabsNavigation();
        applyTabColors();
    });
});

document.getElementById('moveTabLeftBtn').addEventListener('click', () => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    const index = tabOrder.indexOf(key);
    if (index > 0) {
        tabOrder[index] = tabOrder[index - 1];
        tabOrder[index - 1] = key;
        chrome.storage.sync.set({ tabOrder }, () => {
            renderTabsNavigation();
            applyTabColors();
            document.getElementById('tabContextMenu').style.display = 'none';
        });
    }
});

document.getElementById('moveTabRightBtn').addEventListener('click', () => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    const index = tabOrder.indexOf(key);
    if (index !== -1 && index < tabOrder.length - 1) {
        tabOrder[index] = tabOrder[index + 1];
        tabOrder[index + 1] = key;
        chrome.storage.sync.set({ tabOrder }, () => {
            renderTabsNavigation();
            applyTabColors();
            document.getElementById('tabContextMenu').style.display = 'none';
        });
    }
});

// Tab-Kontextmenü: Toggle-Sektionen
function makeTabSectionToggle(btnId, sectionId) {
    document.getElementById(btnId).addEventListener('click', (e) => {
        e.stopPropagation();
        const sec = document.getElementById(sectionId);
        sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
    });
}
makeTabSectionToggle('tabColorSectionToggle', 'tabColorSection');
makeTabSectionToggle('tabTextColorSectionToggle', 'tabTextColorSection');
makeTabSectionToggle('tabIconSectionToggle', 'tabIconSection');

// 64-Farben-Palette für Schriftfarbe (lazy init)
const TAB_TEXT_COLORS_64 = [
    '#000000','#1a1a1a','#333333','#4d4d4d','#666666','#808080','#b3b3b3','#ffffff',
    '#ff0000','#ff4d00','#ff9900','#ffcc00','#ffff00','#99cc00','#00cc00','#00cc99',
    '#00ccff','#0099ff','#0000ff','#6600cc','#cc00cc','#ff0099','#ff6699','#ff99cc',
    '#cc0000','#cc3300','#cc6600','#cc9900','#999900','#336600','#006600','#006633',
    '#006699','#003399','#000099','#330099','#660066','#990033','#993300','#996633',
    '#ff6666','#ff9966','#ffcc66','#ffff66','#ccff66','#66ff66','#66ffcc','#66ffff',
    '#66ccff','#6699ff','#6666ff','#9966ff','#ff66ff','#ff66cc','#ffcccc','#ffd9b3',
    '#ffe0b3','#fff5cc','#ffffcc','#e6ffcc','#ccffcc','#ccffe6','#ccffff','#cce6ff',
];
let _tabTextColorPickerInited = false;
function initTabTextColorPicker() {
    if (_tabTextColorPickerInited) return;
    _tabTextColorPickerInited = true;
    const grid = document.getElementById('tabTextColorPicker64');
    grid.innerHTML = TAB_TEXT_COLORS_64.map(c =>
        `<button class="tab-text-color-swatch" data-color="${c}" style="background:${c}; width:22px; height:22px; border-radius:3px; border:1px solid rgba(128,128,128,0.3); cursor:pointer;" title="${c}"></button>`
    ).join('');
    grid.addEventListener('click', (e) => {
        const sw = e.target.closest('.tab-text-color-swatch');
        if (!sw) return;
        const key = document.getElementById('tabContextMenu').dataset.activeKey;
        if (!key) return;
        tabTextColors[key] = sw.dataset.color;
        chrome.storage.sync.set({ tabTextColors });
        applyTabColors();
    });
}
document.getElementById('tabTextColorSectionToggle').addEventListener('click', initTabTextColorPicker, { once: true });

document.getElementById('resetTabTextColorBtn').addEventListener('click', () => {
    const key = document.getElementById('tabContextMenu').dataset.activeKey;
    if (!key) return;
    delete tabTextColors[key];
    chrome.storage.sync.set({ tabTextColors });
    applyTabColors();
    document.getElementById('tabContextMenu').style.display = 'none';
});

document.addEventListener('click', () => {
    document.getElementById('promptContextMenu').style.display = 'none';
    document.getElementById('noteContextMenu').style.display = 'none';
    document.getElementById('bookmarkContextMenu').style.display = 'none';
    document.getElementById('groupContextMenu').style.display = 'none';
});

// Browser-Tab umbenennen
let _renameTabId = null;
let _renameTabUrl = null;

document.getElementById('renameTabBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        _renameTabId = tabs[0].id;
        _renameTabUrl = tabs[0].url || null;
        chrome.storage.sync.get({ tabTitleOverrides: {} }, ({ tabTitleOverrides }) => {
            const saved = _renameTabUrl && tabTitleOverrides[_renameTabUrl];
            document.getElementById('renameTabInput').value = saved || tabs[0].title || '';
            const overlay = document.getElementById('renameTabOverlay');
            overlay.style.display = 'block';
            document.getElementById('renameTabInput').focus();
            document.getElementById('renameTabInput').select();
        });
    });
});

function applyRenameTab() {
    const newTitle = document.getElementById('renameTabInput').value.trim();
    if (!newTitle || _renameTabId === null) {
        document.getElementById('renameTabOverlay').style.display = 'none';
        return;
    }
    chrome.scripting.executeScript({
        target: { tabId: _renameTabId },
        func: (t) => { document.title = t; },
        args: [newTitle]
    });
    if (_renameTabUrl) {
        chrome.storage.sync.get({ tabTitleOverrides: {} }, ({ tabTitleOverrides }) => {
            tabTitleOverrides[_renameTabUrl] = newTitle;
            chrome.storage.sync.set({ tabTitleOverrides });
        });
    }
    document.getElementById('renameTabOverlay').style.display = 'none';
    _renameTabId = null;
    _renameTabUrl = null;
}

function resetRenameTab() {
    if (!_renameTabUrl) { document.getElementById('renameTabOverlay').style.display = 'none'; return; }
    chrome.storage.sync.get({ tabTitleOverrides: {} }, ({ tabTitleOverrides }) => {
        delete tabTitleOverrides[_renameTabUrl];
        chrome.storage.sync.set({ tabTitleOverrides });
        if (_renameTabId !== null) chrome.tabs.reload(_renameTabId);
        document.getElementById('renameTabOverlay').style.display = 'none';
        _renameTabId = null;
        _renameTabUrl = null;
    });
}

document.getElementById('renameTabApplyBtn').addEventListener('click', applyRenameTab);
document.getElementById('renameTabResetBtn').addEventListener('click', resetRenameTab);

document.getElementById('renameTabCancelBtn').addEventListener('click', () => {
    document.getElementById('renameTabOverlay').style.display = 'none';
    _renameTabId = null;
    _renameTabUrl = null;
});

document.getElementById('renameTabInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyRenameTab();
    if (e.key === 'Escape') {
        document.getElementById('renameTabOverlay').style.display = 'none';
        _renameTabId = null;
        _renameTabUrl = null;
    }
});

loadData();