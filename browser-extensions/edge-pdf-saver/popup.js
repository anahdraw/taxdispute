import {
  dedupeCandidates,
  derivePdfFilename,
  isLikelyPdfUrl
} from "./shared.js";

const elements = {
  scanButton: document.querySelector("#scan-button"),
  saveAs: document.querySelector("#save-as"),
  status: document.querySelector("#status"),
  resultsSection: document.querySelector("#results-section"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  printButton: document.querySelector("#print-button"),
  resultCount: document.querySelector("#result-count"),
  toggleAll: document.querySelector("#toggle-all"),
  list: document.querySelector("#pdf-list"),
  downloadButton: document.querySelector("#download-button")
};

let candidates = [];
let activeTab = null;

elements.scanButton.addEventListener("click", scanActiveTab);
elements.toggleAll.addEventListener("click", toggleAll);
elements.downloadButton.addEventListener("click", downloadSelected);
elements.printButton.addEventListener("click", printActivePage);
elements.saveAs.addEventListener("change", () => {
  chrome.storage.local.set({ saveAs: elements.saveAs.checked });
});
elements.list.addEventListener("change", updateSelectionState);

initialize();

async function initialize() {
  const settings = await chrome.storage.local.get({ saveAs: false });
  elements.saveAs.checked = Boolean(settings.saveAs);
  await scanActiveTab();
}

async function scanActiveTab() {
  setBusy(true);
  showStatus("Memindai halaman aktif…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) throw new Error("Tab aktif tidak dapat dibaca.");
    activeTab = { id: tab.id, url: tab.url, title: tab.title || "" };

    const fromTab = [];
    if (isLikelyPdfUrl(tab.url)) {
      fromTab.push({ url: tab.url, title: tab.title || "PDF aktif", source: "Tab aktif" });
    }

    let fromPage = [];
    try {
      const injection = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: collectPdfCandidatesFromPage
      });
      fromPage = injection.flatMap((result) => result.result || []);
    } catch (error) {
      if (fromTab.length === 0) throw error;
    }

    candidates = dedupeCandidates(
      [...fromTab, ...fromPage].filter((item) => item.explicitPdf || isLikelyPdfUrl(item.url, tab.url)),
      tab.url
    );

    renderCandidates();
    if (candidates.length > 0) {
      showStatus(`${candidates.length} PDF siap dipilih.`, "success");
    } else if (isEbookHtmlPage(tab)) {
      showStatus("E-book HTML terdeteksi. Gunakan cetak PDF untuk konten yang dapat Anda akses.", "success");
    } else {
      showStatus("Tidak ada URL PDF langsung. Halaman dapat dicetak melalui dialog Edge.");
    }
  } catch (error) {
    candidates = [];
    renderCandidates();
    showStatus(humanizeScanError(error), "error");
  } finally {
    setBusy(false);
  }
}

function collectPdfCandidatesFromPage() {
  const found = [];
  const seen = new Set();

  function add(rawUrl, title, source, explicitPdf = false) {
    if (!rawUrl || typeof rawUrl !== "string") return;
    let url;
    try {
      url = new URL(rawUrl, document.baseURI);
    } catch {
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    if (seen.has(url.href)) return;
    seen.add(url.href);
    found.push({ url: url.href, title: title || "", source, explicitPdf });
  }

  const looksLikePdf = (rawUrl) => {
    try {
      const url = new URL(rawUrl, document.baseURI);
      if (/\.pdf$/i.test(url.pathname)) return true;
      return ["filename", "file", "name", "download", "attachment", "url", "src"].some((key) =>
        /\.pdf$/i.test(url.searchParams.get(key) || "")
      );
    } catch {
      return false;
    }
  };

  if (document.contentType === "application/pdf" || looksLikePdf(location.href)) {
    add(location.href, document.title, "Dokumen aktif", true);
  }

  for (const anchor of document.querySelectorAll("a[href]")) {
    const type = (anchor.getAttribute("type") || "").toLowerCase();
    const downloadName = anchor.getAttribute("download") || "";
    const explicitPdf = type.includes("application/pdf") || /\.pdf$/i.test(downloadName);
    if (explicitPdf || looksLikePdf(anchor.href)) {
      add(anchor.href, anchor.textContent?.trim() || anchor.getAttribute("title"), "Tautan", explicitPdf);
    }
  }

  const embeddedSelectors = [
    ["iframe[src]", "src", "Iframe"],
    ["embed[src]", "src", "Embed"],
    ["object[data]", "data", "Object"],
    ["source[src]", "src", "Resource"]
  ];

  for (const [selector, attribute, source] of embeddedSelectors) {
    for (const node of document.querySelectorAll(selector)) {
      const rawUrl = node.getAttribute(attribute);
      const type = (node.getAttribute("type") || "").toLowerCase();
      const explicitPdf = type.includes("application/pdf");
      if (explicitPdf || looksLikePdf(rawUrl)) {
        add(rawUrl, node.getAttribute("title") || document.title, source, explicitPdf);
      }
    }
  }

  if (globalThis.performance?.getEntriesByType) {
    for (const entry of performance.getEntriesByType("resource")) {
      if (looksLikePdf(entry.name)) add(entry.name, "", "Resource halaman", false);
    }
  }

  return found;
}

function renderCandidates() {
  elements.list.replaceChildren();
  const hasCandidates = candidates.length > 0;
  elements.resultsSection.hidden = !hasCandidates;
  elements.emptyState.hidden = hasCandidates;
  elements.resultCount.textContent = `${candidates.length} PDF ditemukan`;

  candidates.forEach((candidate, index) => {
    const label = document.createElement("label");
    label.className = "pdf-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.index = String(index);
    checkbox.setAttribute("aria-label", `Pilih ${derivePdfFilename(candidate, index)}`);

    const details = document.createElement("span");
    const filename = document.createElement("span");
    filename.className = "pdf-name";
    filename.textContent = derivePdfFilename(candidate, index);

    const meta = document.createElement("span");
    meta.className = "pdf-meta";
    meta.textContent = `${candidate.source} · ${new URL(candidate.url).hostname}`;

    const url = document.createElement("span");
    url.className = "pdf-url";
    url.textContent = candidate.url;
    url.title = candidate.url;

    details.append(filename, meta, url);
    label.append(checkbox, details);
    elements.list.append(label);
  });

  if (!hasCandidates) renderEmptyState();

  updateSelectionState();
}

function renderEmptyState() {
  const isEbook = isEbookHtmlPage(activeTab);
  elements.emptyTitle.textContent = isEbook
    ? "E-book berbentuk halaman HTML"
    : "Belum ada berkas PDF terdeteksi";
  elements.emptyDescription.textContent = isEbook
    ? "Situs tidak memberikan URL PDF. Anda dapat menyimpan bagian e-book yang tampil dan memang dapat diakses oleh akun Anda."
    : "Halaman ini mungkin berupa dokumen HTML. Simpan tampilan yang dapat diakses melalui dialog cetak Edge.";
  elements.printButton.textContent = isEbook
    ? "Cetak e-book yang terlihat"
    : "Cetak halaman ke PDF";
}

function isEbookHtmlPage(tab) {
  if (!tab?.url) return false;
  try {
    const url = new URL(tab.url);
    return /\/(?:ebooks?|books?|publications?)\//i.test(url.pathname) || /e-?book/i.test(tab.title || "");
  } catch {
    return false;
  }
}

function toggleAll() {
  const checkboxes = [...elements.list.querySelectorAll('input[type="checkbox"]')];
  const shouldSelect = checkboxes.some((checkbox) => !checkbox.checked);
  checkboxes.forEach((checkbox) => {
    checkbox.checked = shouldSelect;
  });
  updateSelectionState();
}

function updateSelectionState() {
  const checkboxes = [...elements.list.querySelectorAll('input[type="checkbox"]')];
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  elements.downloadButton.disabled = selectedCount === 0;
  elements.downloadButton.textContent = selectedCount > 0
    ? `Unduh ${selectedCount} PDF`
    : "Unduh pilihan";
  elements.toggleAll.textContent = checkboxes.length > 0 && selectedCount === checkboxes.length
    ? "Batalkan semua"
    : "Pilih semua";
}

async function downloadSelected() {
  const selected = [...elements.list.querySelectorAll('input[type="checkbox"]:checked')]
    .map((checkbox) => candidates[Number(checkbox.dataset.index)])
    .filter(Boolean);

  if (selected.length === 0) return;
  setBusy(true);
  showStatus(`Memulai ${selected.length} unduhan…`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_PDFS",
      items: selected,
      saveAs: elements.saveAs.checked
    });

    if (!response?.ok) throw new Error(response?.error || "Unduhan gagal dimulai.");
    if (response.failed > 0) {
      showStatus(`${response.succeeded} berhasil dimulai, ${response.failed} gagal. Periksa izin situs atau URL.`, "error");
    } else {
      showStatus(`${response.succeeded} unduhan dimulai. Cek folder Downloads/PDF Saver.`, "success");
    }
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function printActivePage() {
  if (!activeTab?.id) {
    showStatus("Tab aktif tidak tersedia. Pindai ulang halaman.", "error");
    return;
  }

  setBusy(true);
  showStatus("Membuka dialog cetak Edge…");

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => window.print()
    });
    showStatus("Dialog cetak dibuka. Pilih Save as PDF untuk menyimpan.", "success");
  } catch (error) {
    showStatus(humanizeScanError(error), "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  elements.scanButton.disabled = isBusy;
  elements.printButton.disabled = isBusy;
  if (isBusy) elements.downloadButton.disabled = true;
  else updateSelectionState();
}

function showStatus(message, kind = "info") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function humanizeScanError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Cannot access|The extensions gallery cannot be scripted|chrome:\/\/|edge:\/\//i.test(message)) {
    return "Halaman internal Edge tidak dapat dipindai. Buka halaman web atau URL PDF biasa.";
  }
  return `Tidak dapat memindai halaman: ${message}`;
}
