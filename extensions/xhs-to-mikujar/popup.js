const bar = document.getElementById("bar");
const statusEl = document.getElementById("status");

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || "";
}

document.getElementById("openOpts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

const port = chrome.runtime.connect({ name: "clip-save" });

port.onMessage.addListener((msg) => {
  if (msg.type === "progress") {
    bar.hidden = false;
    bar.value = typeof msg.value === "number" ? msg.value : 0;
    if (msg.text) setStatus(msg.text);
    return;
  }
  if (msg.type === "done") {
    bar.hidden = false;
    bar.value = msg.ok ? 100 : bar.value;
    setStatus(msg.message || (msg.ok ? "完成" : "失败"), msg.ok ? "ok" : "err");
    return;
  }
});

port.onDisconnect.addListener(() => {
  if (!statusEl.classList.contains("ok") && !statusEl.classList.contains("err")) {
    setStatus("连接已断开（后台可能仍在处理）", "err");
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.id) {
    setStatus("无法获取当前标签页", "err");
    return;
  }
  const u = tab.url || "";
  const okXhs = /xiaohongshu\.com/i.test(u);
  const okBili = /bilibili\.com\/video\//i.test(u);
  if (!okXhs && !okBili) {
    bar.hidden = true;
    setStatus(
      "请在小红书笔记详情页，或哔哩哔哩投稿页 (…bilibili.com/video/…) 打开后再点扩展图标。",
      "err"
    );
    return;
  }
  setStatus("开始处理…");
  bar.hidden = false;
  bar.value = 0;
  port.postMessage({ type: "start", tabId: tab.id });
});
