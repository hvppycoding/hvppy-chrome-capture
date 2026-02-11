// Service worker: handles extension icon click, tab capture, and file download

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (err) {
    console.error('Failed to inject content script:', err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureTab') {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'download') {
    const sanitized = message.pageTitle
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = sanitized
      ? `${sanitized}_${timestamp}.png`
      : `capture_${timestamp}.png`;

    chrome.downloads.download({
      url: message.dataUrl,
      filename: filename,
      saveAs: false
    })
      .then(() => sendResponse({ status: 'ok' }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
