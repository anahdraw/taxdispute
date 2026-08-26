import { derivePdfFilename } from "./shared.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "DOWNLOAD_PDFS") return false;

  downloadPdfs(message.items, Boolean(message.saveAs))
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function downloadPdfs(items, saveAs) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Tidak ada PDF yang dipilih.");
  }

  const results = [];

  for (const [index, item] of items.entries()) {
    try {
      const downloadId = await chrome.downloads.download({
        url: item.url,
        filename: `PDF Saver/${derivePdfFilename(item, index)}`,
        conflictAction: "uniquify",
        saveAs: saveAs && items.length === 1
      });
      results.push({ url: item.url, downloadId, ok: true });
    } catch (error) {
      results.push({
        url: item.url,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    total: results.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results
  };
}
