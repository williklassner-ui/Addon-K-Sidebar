chrome.storage.sync.get({ prompts: [] }, (result) => {
  let prompts = result.prompts;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.prompts) {
      prompts = changes.prompts.newValue;
    }
  });

  // 'true' am Ende aktiviert die Capturing-Phase, um ChatGPT/Gemini zuvorzukommen
  document.addEventListener('keydown', (e) => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) return;
    } catch (err) {
      return; // Verhindert Fehler, falls der Extension-Kontext sich aktualisiert hat
    }

    const keyName = e.key.toLowerCase();

    for (const p of prompts) {
      if (p.shortcut && p.shortcut.trim() !== '') {
        const keys = p.shortcut.toLowerCase().replace(/\s+/g, '').split('+');

        let match = true;
        if (keys.includes('alt') && !e.altKey) match = false;
        if (keys.includes('ctrl') && !e.ctrlKey) match = false;
        if (keys.includes('shift') && !e.shiftKey) match = false;

        const mainKey = keys.find(k => k !== 'alt' && k !== 'ctrl' && k !== 'shift');
        if (mainKey && mainKey !== keyName) match = false;

        if (match && keys.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation(); // Verhindert absolut jede Weiterleitung an die Website
          e.stopPropagation();

          // Führt das Einfügen absolut synchron im exakt selben Moment aus
          insertTextDirectly(p.text);
          return;
        }
      }
    }
  }, true);
});

function markdownToHtml(md) {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (must be before inline code)
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  // Unordered lists
  html = html.replace(/^[*\-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs and line breaks
  const lines = html.split('\n');
  const result = [];
  for (const line of lines) {
    if (/^<(h[1-3]|pre|ul|li)/.test(line.trim())) {
      result.push(line);
    } else if (line.trim() === '') {
      result.push('<br>');
    } else {
      result.push(line + '<br>');
    }
  }
  return result.join('');
}

// Synchrone Einfüge-Logik direkt im Seitenkontext (identisch zur Funktionsweise beim Klick)
function insertTextDirectly(textToInsert) {
  const aiSelectors = [
    'div[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    '.ProseMirror',
    '#prompt-textarea',
    '.rich-textarea-wrapper div[contenteditable]',
    'g-textarea textarea',
    'textarea'
  ];

  let targetEl = null;
  const activeEl = document.activeElement;

  if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT' || activeEl.isContentEditable)) {
    targetEl = activeEl;
  } else {
    for (const selector of aiSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          targetEl = el;
          break;
        }
      }
      if (targetEl) break;
    }
  }

  if (!targetEl) {
    targetEl = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
  }

  if (!targetEl) return;

  targetEl.focus();

  if (targetEl.tagName === 'TEXTAREA' || targetEl.tagName === 'INPUT') {
    const start = targetEl.selectionStart || 0;
    const end = targetEl.selectionEnd || 0;
    const val = targetEl.value;
    targetEl.value = val.slice(0, start) + textToInsert + val.slice(end);
    targetEl.selectionStart = targetEl.selectionEnd = start + textToInsert.length;

    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    targetEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  else if (targetEl.isContentEditable) {
    const htmlContent = markdownToHtml(textToInsert);
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', textToInsert);
    dataTransfer.setData('text/html', htmlContent);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });

    targetEl.dispatchEvent(pasteEvent);

    if (!pasteEvent.defaultPrevented) {
      document.execCommand('insertHTML', false, htmlContent);
    }

    targetEl.dispatchEvent(new Event('textInput', { bubbles: true }));
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
