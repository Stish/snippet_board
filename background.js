async function configurePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  configurePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
});

chrome.action.onClicked.addListener(async (tab) => {
  const windowId = tab?.windowId;
  if (windowId === undefined) {
    return;
  }

  await chrome.sidePanel.open({ windowId });
});
