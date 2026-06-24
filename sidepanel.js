let promts = [];
let notes = []; 
let makros = [];
let deletedPromts = [];
let recentColors = [];
let collapsedGroups = {};
let collapsedNoteGroups = {};
let collapsedSessions = {}; 
let savedSessions = [];
let groupMetadata = {}; 
let tabColors = {};
let tabOrder = ['prompts', 'sessions', 'notes', 'makros'];
let isRecording = false;
let stepPlaybackState = null;

const tabNames = {
    'prompts': 'Promts',
    'sessions': 'Sessions',
    'notes': 'Notizen',
    'makros': 'Makros'
};

const providerIcons = {
    'ChatGPT': '✧',
    'Gemini': '✦',
    'Claude': '⚛',
    'Copilot': '✵',
    'Perplexity': '◈',
    'DeepL': '⚲',
    'none': ''
};

let currentEditorTodos = [];

function loadData() {
    chrome.storage.sync.get({ 
        promts: [], 
        notes: [], 
        makros: [],
        deletedPromts: [], 
        recentColors: [], 
        groupMetadata: {},
        savedSessions: [],
        tabColors: {},
        tabOrder: ['prompts', 'sessions', 'notes', 'makros']
    }, (res) => {
        promts = res.promts || [];
        notes = res.notes || [];
        makros = res.makros || [];
        deletedPromts = res.deletedPromts || [];
        recentColors = res.recentColors || [];
        groupMetadata = res.groupMetadata || {};
        savedSessions = res.savedSessions || [];
        tabColors = res.tabColors || {};
        tabOrder = res.tabOrder || ['prompts', 'sessions', 'notes', 'makros'];
        
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
        renderTrash();
        renderRecentColors();
        renderSessions();
        populateGroupDropdowns();
        checkSyncStatus();
    });
}

function renderTabsNavigation() {
    const navContainer = document.getElementById('tabsNavContainer');
    if (!navContainer) return;

    const activeBtn = navContainer.querySelector('.tab-btn.active');
    const activeTabKey = activeBtn ? activeBtn.dataset.tab : 'prompts';

    navContainer.innerHTML = tabOrder.map(key => {
        return `<button id="nav${key.charAt(0).toUpperCase() + key.slice(1)}" class="tab-btn ${activeTabKey === key ? 'active' : ''}" data-tab="${key}">${tabNames[key] || key}</button>`;
    }).join('');
}

function applyTabColors() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        const tabKey = btn.dataset.tab;
        if (tabColors[tabKey]) {
            btn.style.setProperty('background-color', tabColors[tabKey] + '33', 'important');
            btn.style.setProperty('border-top', `3px solid ${tabColors[tabKey]}`, 'important');
        } else {
            btn.style.removeProperty('background-color');
            btn.style.removeProperty('border-top');
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
    if (!pSelect || !nSelect) return;
    
    const uniqueGroups = new Set();
    promts.forEach(p => { if (p.group && p.group.trim() !== "") uniqueGroups.add(p.group); });
    notes.forEach(n => { if (n.group && n.group.trim() !== "") uniqueGroups.add(n.group); });
    Object.keys(groupMetadata).forEach(g => uniqueGroups.add(g));
    
    let baseHtml = '<option value="">-- Keine Gruppe gewählt --</option>';
    uniqueGroups.forEach(gName => {
        baseHtml += `<option value="${gName}">${gName}</option>`;
    });
    baseHtml += '<option value="__NEW_GROUP__">[+ Neue Gruppe erstellen]</option>';
    
    pSelect.innerHTML = baseHtml;
    nSelect.innerHTML = baseHtml;
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
    Object.keys(groups).forEach(gName => {
        const isCollapsed = collapsedGroups[gName] || false;
        const meta = groupMetadata[gName] || { color: '#ff8c00', icon: '📁' };
        let totalCount = groups[gName] ? groups[gName].length : 0;

        html += `
            <div class="group-container" style="border-top: 2px solid ${meta.color}">
                <div class="group-header" data-group="${gName}" style="color: ${meta.color};">
                    <div class="group-title-wrapper">
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
    const icon = providerIcons[p.provider] !== undefined ? providerIcons[p.provider] : '⚬';
    const showIcon = icon !== '';
    return `
        <div class="prompt-card" style="border-left: 3px solid ${p.color || '#ff8c00'}">
            <div class="card-header">
                <div class="prompt-info" data-action="copy-insert" data-index="${i}">
                    ${showIcon ? `<span class="provider-icon" title="${p.provider === 'none' ? 'Kein Anbieter' : (p.provider || 'Anbieter')}">${icon}</span>` : ''}
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
    Object.keys(groups).forEach(gName => {
        const isCollapsed = collapsedNoteGroups[gName] || false;
        const meta = groupMetadata[gName] || { color: '#ff8c00', icon: '📁' };
        let totalCount = groups[gName].length;

        html += `
            <div class="group-container" style="border-top: 2px solid ${meta.color}">
                <div class="group-header" data-notegroup="${gName}" style="color: ${meta.color};">
                    <div class="group-title-wrapper">
                        <span>${meta.icon} ${gName}</span>
                    </div>
                    <div class="group-right-wrapper">
                        <span class="badge">${totalCount}</span>
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

    return `
        <div class="note-card" style="border-left: 3px solid ${tileColor}; background: rgba(0,0,0,0.15);">
            <div class="card-header">
                <div class="note-info" data-note-action="toggle-view" data-index="${i}">
                    <span class="note-title" style="font-weight:bold; color:${tileColor};">${n.pinned ? '📌 ' : ''}${n.title || 'Unbenannte Notiz'}</span>
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
        return `
            <div class="makro-card" style="border-left: 3px solid ${m.color || '#ff8c00'}">
                <div class="card-header">
                    <div class="makro-info" data-makro-action="run" data-index="${i}" title="Makro abspielen">
                        <span style="color: #4caf50; font-size:14px;">▶</span>
                        <span class="makro-title" style="font-weight:600;">${m.title || 'Unbenanntes Makro'}</span>
                        <span style="font-size:10px; opacity:0.5;">(${stepsCount} Schritte)${(m.repeat && m.repeat > 1) ? ` <span style="color:#ff8c00;">${m.repeat}×</span>` : ''}</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn-icon" data-makro-action="step" data-index="${i}" title="Einzelschritt-Wiedergabe">▶|</button>
                        <button class="btn-icon" data-makro-action="toggle-json" data-index="${i}" title="JSON Code anzeigen">👁</button>
                        <button class="btn-icon" data-makro-action="edit" data-index="${i}" title="Bearbeiten">✎</button>
                        <button class="btn-icon" data-makro-action="delete" data-index="${i}" title="Löschen">✕</button>
                    </div>
                </div>
                <div id="makro-content-${i}" class="content-box" style="font-family: monospace; font-size:11px; max-height:150px; overflow-y:auto;">${JSON.stringify(m.steps, null, 2)}</div>
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
    ['recentColorsPrompt', 'recentColorsGroup', 'recentColorsNote', 'recentColorsMakro'].forEach(id => {
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
    const target = e.target.closest('[data-makro-action]');
    if (!target) return;

    const action = target.dataset.makroAction;
    const i = parseInt(target.dataset.index);
    const m = makros[i];

    if (action === 'toggle-json') {
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

            document.getElementById('mainContainer').style.display = 'none';
            document.getElementById('makroInputGroup').style.display = 'flex';
            renderRecentColors();
        }
    }
    else if (action === 'run') {
        if (m && m.steps) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) return;
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: ({ stepsList, repeat }) => {
                        const showClickIndicator = (x, y) => {
                            const dot = document.createElement('div');
                            dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:24px;height:24px;border-radius:50%;background:rgba(255,140,0,0.6);border:2px solid #ff8c00;transform:translate(-50%,-50%) scale(0);animation:_mkRipple 0.55s ease forwards;pointer-events:none;z-index:999999;`;
                            const st = document.createElement('style');
                            st.textContent = `@keyframes _mkRipple{0%{transform:translate(-50%,-50%) scale(0);opacity:1}100%{transform:translate(-50%,-50%) scale(2.8);opacity:0}}`;
                            document.head.appendChild(st);
                            document.body.appendChild(dot);
                            setTimeout(() => { dot.remove(); st.remove(); }, 600);
                        };
                        const executeAction = (step, attempt) => {
                            if (step.type === 'click' && step._px !== undefined) {
                                // Koordinaten als primäre Methode für Klicks
                                window.scrollTo({ top: step._py - window.innerHeight / 2, behavior: 'instant' });
                                const vx = step._px - window.scrollX;
                                const vy = step._py - window.scrollY;
                                let el = document.elementFromPoint(vx, vy);
                                const originalEl = el;
                                // Walk up max 5 levels to find a proper clickable ancestor
                                let candidate = el;
                                for (let d = 0; d < 5 && candidate && candidate !== document.body; d++) {
                                    const tag = candidate.tagName.toLowerCase();
                                    const role = (candidate.getAttribute && candidate.getAttribute('role')) || '';
                                    if (['button','a','input','select','label'].includes(tag) ||
                                        role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') {
                                        el = candidate; break;
                                    }
                                    candidate = candidate.parentElement;
                                }
                                // Fall back to original element if no proper clickable found
                                if (!el || el === document.body) el = originalEl;
                                if (!el) {
                                    if (attempt < 3) setTimeout(() => executeAction(step, attempt + 1), 300);
                                    return;
                                }
                                el.focus();
                                // Klick immer in die Mitte des gefundenen Elements
                                const rect = el.getBoundingClientRect();
                                const cx = rect.left + rect.width / 2;
                                const cy = rect.top + rect.height / 2;
                                // Indikator immer exakt auf der getroffenen Mitte zeigen
                                showClickIndicator(cx, cy);
                                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
                                el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
                                el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
                            } else if (step.type === 'type') {
                                // Selektor primär, Koordinaten als Fallback
                                let el = null;
                                try { el = document.querySelector(step.target); } catch (e) {}
                                if (!el && step._px !== undefined) {
                                    window.scrollTo({ top: step._py - window.innerHeight / 2, behavior: 'instant' });
                                    el = document.elementFromPoint(step._px - window.scrollX, step._py - window.scrollY);
                                }
                                if (!el) {
                                    if (attempt < 3) setTimeout(() => executeAction(step, attempt + 1), 300);
                                    return;
                                }
                                el.focus();
                                if (el.isContentEditable || el.tagName === 'DIV') {
                                    document.execCommand('selectAll', false, null);
                                    document.execCommand('insertText', false, step.value);
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                } else {
                                    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
                                    if (nativeSetter && nativeSetter.set) {
                                        nativeSetter.set.call(el, step.value);
                                    } else {
                                        el.value = step.value;
                                    }
                                    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: step.value }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }
                        };
                        const stepDelay = 700;
                        const pauseDelay = 900;
                        for (let r = 0; r < repeat; r++) {
                            const runOffset = r * (stepsList.length * stepDelay + pauseDelay);
                            stepsList.forEach((step, i) => {
                                setTimeout(() => executeAction(step, 0), runOffset + i * stepDelay);
                            });
                        }
                    },
                    args: [{ stepsList: m.steps, repeat: m.repeat || 1 }]
                });
            });
        }
    }
});

// Live Aufnahme-Logik für Makros
document.getElementById('recordMakroBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
            alert("Kein aktiver Tab für eine Aufnahme gefunden.");
            return;
        }
        
        isRecording = !isRecording;
        const btn = document.getElementById('recordMakroBtn');
        
        if (isRecording) {
            btn.innerHTML = '<span class="record-dot"></span> ⏹ Stoppen';
            btn.classList.add('recording');

            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: () => {
                    sessionStorage.setItem('_makroSteps', JSON.stringify([]));

                    // Visuelles Feedback: CSS in Seite injizieren
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
                            // Echtes klickbares Element finden (z.B. Button statt span darin)
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
                            // Mitte des erkannten Elements speichern
                            const rect = target.getBoundingClientRect();
                            const px = Math.round(rect.left + rect.width / 2 + window.scrollX);
                            const py = Math.round(rect.top + rect.height / 2 + window.scrollY);
                            let steps = JSON.parse(sessionStorage.getItem('_makroSteps') || '[]');
                            steps.push({ type: 'click', target: path, _px: px, _py: py });
                            sessionStorage.setItem('_makroSteps', JSON.stringify(steps));
                            // Grüner Flash als Bestätigung auf dem erkannten Element
                            e.target.classList.remove('_makro-hover');
                            target.classList.add('_makro-recorded');
                            setTimeout(() => target.classList.remove('_makro-recorded'), 800);
                        } catch (err) {}
                    };

                    window._makroChangeHandler = (e) => {
                        try {
                            const path = getPath(e.target);
                            let steps = JSON.parse(sessionStorage.getItem('_makroSteps') || '[]');
                            steps.push({ type: 'type', target: path, value: e.target.value || e.target.innerText });
                            sessionStorage.setItem('_makroSteps', JSON.stringify(steps));
                            e.target.classList.add('_makro-recorded');
                            setTimeout(() => e.target.classList.remove('_makro-recorded'), 800);
                        } catch (err) {}
                    };

                    document.addEventListener('mouseover', window._makroHoverHandler, { capture: true });
                    document.addEventListener('mouseout', window._makroMouseOutHandler, { capture: true });
                    document.addEventListener('click', window._makroClickHandler, { capture: true });
                    document.addEventListener('change', window._makroChangeHandler, { capture: true });
                }
            });
        } else {
            btn.innerHTML = '<span class="record-dot"></span> Aufnahme';
            btn.classList.remove('recording');

            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: () => {
                    let steps = [];
                    try {
                        steps = JSON.parse(sessionStorage.getItem('_makroSteps') || '[]');
                        sessionStorage.removeItem('_makroSteps');
                    } catch (e) {}

                    if (window._makroClickHandler) document.removeEventListener('click', window._makroClickHandler, { capture: true });
                    if (window._makroChangeHandler) document.removeEventListener('change', window._makroChangeHandler, { capture: true });
                    if (window._makroHoverHandler) document.removeEventListener('mouseover', window._makroHoverHandler, { capture: true });
                    if (window._makroMouseOutHandler) document.removeEventListener('mouseout', window._makroMouseOutHandler, { capture: true });

                    delete window._makroClickHandler;
                    delete window._makroChangeHandler;
                    delete window._makroHoverHandler;
                    delete window._makroMouseOutHandler;

                    // Injiziertes CSS entfernen
                    const s = document.getElementById('_makroStyle');
                    if (s) s.remove();
                    document.querySelectorAll('._makro-hover, ._makro-recorded').forEach(el => {
                        el.classList.remove('_makro-hover', '_makro-recorded');
                    });

                    return steps;
                }
            }, (results) => {
                if (results && results[0] && results[0].result && results[0].result.length > 0) {
                    const recordedSteps = results[0].result;
                    const mName = prompt("Makro-Aufnahme erfolgreich! Name eingeben:", `Makro vom ${new Date().toLocaleTimeString()}`);
                    if (mName !== null) {
                        const newMakro = {
                            title: mName.trim() || "Aufgenommenes Makro",
                            steps: recordedSteps,
                            color: "#ff8c00"
                        };
                        makros.push(newMakro);
                        chrome.storage.sync.set({ makros }, renderMakros);
                    }
                } else {
                    alert("Es wurden keine Klicks oder Eingaben während der Aufnahme registriert.");
                }
            });
        }
    });
});

function closeMakroEditMode() {
    document.getElementById('makroInputGroup').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('editMakroIndex').value = "";
    document.getElementById('makroTitleInput').value = '';
    document.getElementById('makroStepsInput').value = '';
    document.getElementById('makroRepeatInput').value = '1';
    document.getElementById('showStepsOnPageBtn').style.display = 'flex';
    document.getElementById('applyPageEditsBtn').style.display = 'none';
    document.getElementById('cancelPageEditsBtn').style.display = 'none';
}

document.getElementById('cancelMakroBtn').addEventListener('click', closeMakroEditMode);

function openStepPlayback(i) {
    const m = makros[i];
    if (!m || !m.steps || m.steps.length === 0) return;
    stepPlaybackState = { makro: m, stepIndex: 0, repeat: m.repeat || 1, currentRun: 0 };
    document.getElementById('stepPlaybackTitle').textContent = m.title || 'Makro';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('stepPlaybackPanel').style.display = 'flex';
    renderStepPanel();
}

function renderStepPanel() {
    if (!stepPlaybackState) return;
    const { makro, stepIndex, repeat, currentRun } = stepPlaybackState;
    const totalSteps = makro.steps.length;
    const step = makro.steps[stepIndex];
    const runLabel = repeat > 1 ? ` (Durchlauf ${currentRun + 1}/${repeat})` : '';
    document.getElementById('stepPlaybackCounter').textContent = `Schritt ${stepIndex + 1} / ${totalSteps}${runLabel}`;
    const desc = step.type === 'click'
        ? `🖱 Klick\nZiel: ${step.target}\nPosition: x=${step._px}, y=${step._py}`
        : `⌨ Text eingeben\nZiel: ${step.target}\nWert: "${step.value}"`;
    document.getElementById('stepPlaybackDesc').textContent = desc;
    // Edit fields
    if (step.type === 'click') {
        document.getElementById('stepEditClick').style.display = 'flex';
        document.getElementById('stepEditType').style.display = 'none';
        document.getElementById('stepEditPx').value = step._px || '';
        document.getElementById('stepEditPy').value = step._py || '';
    } else {
        document.getElementById('stepEditClick').style.display = 'none';
        document.getElementById('stepEditType').style.display = 'flex';
        document.getElementById('stepEditValue').value = step.value || '';
    }
    const saveBtn = document.getElementById('stepEditSaveBtn');
    saveBtn.textContent = '💾 Schritt speichern';
}

function advanceStep() {
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
}

function closeStepPanel() {
    stepPlaybackState = null;
    document.getElementById('stepPlaybackPanel').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
}

document.getElementById('stepPlaybackAbortBtn').addEventListener('click', closeStepPanel);
document.getElementById('stepPlaybackSkipBtn').addEventListener('click', advanceStep);
document.getElementById('stepPlaybackRunBtn').addEventListener('click', () => {
    if (!stepPlaybackState) return;
    const step = stepPlaybackState.makro.steps[stepPlaybackState.stepIndex];
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { advanceStep(); return; }
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (step) => {
                const showClickIndicator = (x, y) => {
                    const dot = document.createElement('div');
                    dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:24px;height:24px;border-radius:50%;background:rgba(255,140,0,0.6);border:2px solid #ff8c00;transform:translate(-50%,-50%) scale(0);animation:_mkRipple 0.55s ease forwards;pointer-events:none;z-index:999999;`;
                    const st = document.createElement('style');
                    st.textContent = `@keyframes _mkRipple{0%{transform:translate(-50%,-50%) scale(0);opacity:1}100%{transform:translate(-50%,-50%) scale(2.8);opacity:0}}`;
                    document.head.appendChild(st);
                    document.body.appendChild(dot);
                    setTimeout(() => { dot.remove(); st.remove(); }, 600);
                };
                if (step.type === 'click' && step._px !== undefined) {
                    window.scrollTo({ top: step._py - window.innerHeight / 2, behavior: 'instant' });
                    const vx = step._px - window.scrollX, vy = step._py - window.scrollY;
                    let el = document.elementFromPoint(vx, vy);
                    const originalEl = el;
                    let candidate = el;
                    for (let d = 0; d < 5 && candidate && candidate !== document.body; d++) {
                        const tag = candidate.tagName.toLowerCase(), role = (candidate.getAttribute && candidate.getAttribute('role')) || '';
                        if (['button','a','input','select','label'].includes(tag) || role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') { el = candidate; break; }
                        candidate = candidate.parentElement;
                    }
                    if (!el || el === document.body) el = originalEl;
                    if (!el) return;
                    el.focus();
                    const rect = el.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    showClickIndicator(cx, cy);
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
                    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
                    el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
                } else if (step.type === 'type') {
                    let el = null;
                    try { el = document.querySelector(step.target); } catch(e) {}
                    if (!el && step._px !== undefined) {
                        window.scrollTo({ top: step._py - window.innerHeight / 2, behavior: 'instant' });
                        el = document.elementFromPoint(step._px - window.scrollX, step._py - window.scrollY);
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
                }
            },
            args: [step]
        });
        advanceStep();
    });
});

document.getElementById('stepEditSaveBtn').addEventListener('click', () => {
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
    }
    chrome.storage.sync.set({ makros }, () => {
        const btn = document.getElementById('stepEditSaveBtn');
        btn.textContent = '✓ Gespeichert!';
        setTimeout(() => { if (btn) btn.textContent = '💾 Schritt speichern'; }, 1500);
    });
});

// Page-Overlay: Schritte auf Seite anzeigen und bearbeiten
document.getElementById('showStepsOnPageBtn').addEventListener('click', () => {
    let steps = [];
    try { steps = JSON.parse(document.getElementById('makroStepsInput').value); } catch(e) { alert('Ungültiges JSON in Aktionen'); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (steps) => {
                document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle').forEach(el => el.remove());
                sessionStorage.setItem('_makroEditSteps', JSON.stringify(steps));
                const style = document.createElement('style');
                style.id = '_makroEditStyle';
                style.textContent = `
                    ._makroEditMarker{position:absolute;z-index:999998;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#fff;cursor:grab;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.5);border:2px solid rgba(255,255,255,0.5);}
                    ._makroEditMarker:active{cursor:grabbing;}
                    ._makroEditMarker._click{background:#ff8c00;}
                    ._makroEditMarker._type{background:#2196f3;}
                    #_makroEditPanel{position:fixed;z-index:999999;background:#1e1e1e;border:1px solid #555;border-radius:8px;padding:12px;min-width:210px;box-shadow:0 4px 16px rgba(0,0,0,0.7);font-family:system-ui;font-size:12px;color:#e0e0e0;}
                    #_makroEditPanel label{display:block;font-size:10px;opacity:.6;margin-top:6px;}
                    #_makroEditPanel input,#_makroEditPanel textarea{width:100%;background:#252525;border:1px solid #444;color:#e0e0e0;border-radius:4px;padding:4px;font-size:12px;box-sizing:border-box;margin:2px 0;}
                    #_makroEditPanel button{background:rgba(255,140,0,.2);border:1px solid rgba(255,140,0,.4);color:#ff8c00;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:11px;margin:4px 2px 0;}
                `;
                document.head.appendChild(style);
                steps.forEach((step, idx) => {
                    if (step._px === undefined || step._py === undefined) return;
                    const marker = document.createElement('div');
                    marker.className = `_makroEditMarker ${step.type === 'click' ? '_click' : '_type'}`;
                    marker.textContent = idx + 1;
                    marker.style.left = (step._px - 13) + 'px';
                    marker.style.top = (step._py - 13) + 'px';
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
                                stps[idx]._px = nl + 13; stps[idx]._py = nt + 13;
                                sessionStorage.setItem('_makroEditSteps', JSON.stringify(stps));
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
                        } else {
                            panel.innerHTML = `<b>⌨ Schritt ${idx+1}: Text</b><label>Ziel:</label><input type="text" id="_ep_target" value="${(s.target||'').replace(/"/g,'&quot;')}"><label>Wert:</label><textarea id="_ep_value" rows="2">${(s.value||'').replace(/</g,'&lt;')}</textarea><div><button id="_ep_save">💾 Speichern</button><button id="_ep_close">✕</button></div>`;
                        }
                        document.body.appendChild(panel);
                        document.getElementById('_ep_close').addEventListener('click', () => panel.remove());
                        document.getElementById('_ep_save').addEventListener('click', () => {
                            const stps2 = JSON.parse(sessionStorage.getItem('_makroEditSteps') || '[]');
                            if (s.type === 'click') {
                                stps2[idx]._px = parseInt(document.getElementById('_ep_px').value) || stps2[idx]._px;
                                stps2[idx]._py = parseInt(document.getElementById('_ep_py').value) || stps2[idx]._py;
                                marker.style.left = (stps2[idx]._px - 13) + 'px';
                                marker.style.top = (stps2[idx]._py - 13) + 'px';
                            } else {
                                stps2[idx].target = document.getElementById('_ep_target').value;
                                stps2[idx].value = document.getElementById('_ep_value').value;
                            }
                            sessionStorage.setItem('_makroEditSteps', JSON.stringify(stps2));
                            panel.remove();
                        });
                    });
                    document.body.appendChild(marker);
                });
            },
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
                document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle').forEach(el => el.remove());
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
                    document.querySelectorAll('._makroEditMarker, #_makroEditPanel, #_makroEditStyle').forEach(el => el.remove());
                }
            });
        }
    });
    document.getElementById('showStepsOnPageBtn').style.display = 'flex';
    document.getElementById('applyPageEditsBtn').style.display = 'none';
    document.getElementById('cancelPageEditsBtn').style.display = 'none';
});

document.getElementById('saveMakroBtn').addEventListener('click', () => {
    const i = document.getElementById('editMakroIndex').value;
    const selectedColor = document.getElementById('makroColor').value;
    let parsedSteps = [];
    
    try {
        parsedSteps = JSON.parse(document.getElementById('makroStepsInput').value);
    } catch (err) {
        alert("Fehler im JSON-Format der Schritte. Bitte überprüfe die Syntax.");
        return;
    }

    const newMakro = {
        title: document.getElementById('makroTitleInput').value,
        steps: parsedSteps,
        color: selectedColor,
        repeat: Math.max(1, parseInt(document.getElementById('makroRepeatInput').value) || 1)
    };

    if (i !== "") {
        makros[parseInt(i)] = newMakro;
    } else {
        makros.push(newMakro);
    }

    updateRecentColors(selectedColor);
    chrome.storage.sync.set({ makros }, () => {
        closeMakroEditMode();
        renderMakros();
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
        document.getElementById('groupAiProvider').value = meta.groupProvider || 'default';
        
        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('groupEditorGroup').style.display = 'flex';
        renderRecentColors();
        return;
    }

    const groupHeader = e.target.closest('.group-header');
    if (groupHeader && groupHeader.dataset.group) {
        const gName = groupHeader.dataset.group;
        collapsedGroups[gName] = !collapsedGroups[gName];
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
        collapsedNoteGroups[gName] = !collapsedNoteGroups[gName];
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

            document.getElementById('mainContainer').style.display = 'none';
            document.getElementById('noteInputGroup').style.display = 'flex';
            renderRecentColors();
        }
    }
}
document.getElementById('pinnedNotesList').addEventListener('click', handleNotesViewClicks);
document.getElementById('notesList').addEventListener('click', handleNotesViewClicks);

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
}

document.getElementById('cancelNoteBtn').addEventListener('click', closeNoteEditMode);

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
        todos: currentEditorTodos
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
    }
    groupMetadata[newName] = { color, icon, groupProvider };
    updateRecentColors(color);
    chrome.storage.sync.set({ promts, notes, groupMetadata }, () => {
        closeGroupEditMode();
    });
});

document.getElementById('cancelGroupBtn').addEventListener('click', closeGroupEditMode);

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
    document.getElementById('shortcutInput').value = '';
    document.getElementById('groupInput').value = '';
    document.getElementById('groupInput').style.display = 'none';
    document.getElementById('groupSelectOptions').value = '';
}

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
            const totalBackup = {
                K_SIDEBAR_BACKUP_VERSION: "1.0.16",
                timestamp: Date.now(),
                syncStorage: syncData
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
                    chrome.storage.sync.clear(() => {
                        chrome.storage.sync.set(syncToSet, () => {
                            alert("System-Backup erfolgreich eingespielt!");
                            document.getElementById('backupOverlay').style.display = 'none';
                            document.getElementById('mainContainer').style.display = 'block';
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

// Kontextmenü-Trigger für Rechtsklick auf Reiter
document.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) {
        e.preventDefault();
        const menu = document.getElementById('tabContextMenu');
        const key = btn.dataset.tab;
        
        let x = e.clientX;
        let y = e.clientY;
        
        if (x + 150 > window.innerWidth) x = window.innerWidth - 160;
        if (y + 130 > window.innerHeight) y = window.innerHeight - 140;
        
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';
        menu.dataset.activeKey = key;
        
        document.getElementById('tabColorPicker').value = tabColors[key] || '#ff8c00';
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

loadData();