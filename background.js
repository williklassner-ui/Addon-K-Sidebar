if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("SidePanel Fehler:", error));
} else {
  console.log("Mobilgerät oder SidePanel nicht unterstützt. Nutze Popup-Modus.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "executeInsertion" && message.text) {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ success: false, error: "Kein aktiver Tab gefunden." });
        return;
      }

      // Verhindert Injektionen auf chrome:// Seiten, die den Permission-Fehler erzeugen
      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:"))) {
        sendResponse({ success: false, error: "Injektion auf dieser Seite nicht erlaubt." });
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (textToInsert) => {
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

            if (!targetEl) return false;

            targetEl.focus();

            if (targetEl.tagName === 'TEXTAREA' || targetEl.tagName === 'INPUT') {
              const start = targetEl.selectionStart || 0;
              const end = targetEl.selectionEnd || 0;
              const val = targetEl.value;
              targetEl.value = val.slice(0, start) + textToInsert + val.slice(end);
              targetEl.selectionStart = targetEl.selectionEnd = start + textToInsert.length;

              targetEl.dispatchEvent(new Event('input', { bubbles: true }));
              targetEl.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
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
              return true;
            }
            return false;
          },
          args: [message.text]
        });
        sendResponse({ success: true });
      } catch (err) {
        console.error("Injektionsfehler im Service Worker:", err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true; // Hält den Nachrichtenkanal für asynchrone sendResponse offen
  }
});
