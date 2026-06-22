"use strict";

/* ============================================================
   ArUco / AprilTag / QR  生成 & スキャナ
   OpenCV.js + Three.js (AR重畳 & 3Dワールドビュー) / PWA
   ============================================================ */

const DICT_ENUM = {
  "4-50": 0, "4-100": 1, "4-250": 2, "4-1000": 3,
  "5-50": 4, "5-100": 5, "5-250": 6, "5-1000": 7,
  "6-50": 8, "6-100": 9, "6-250": 10, "6-1000": 11,
  "7-50": 12, "7-100": 13, "7-250": 14, "7-1000": 15,
  "aruco-orig": 16,
  "april-16h5": 17, "april-25h9": 18, "april-36h10": 19, "april-36h11": 20,
};
const ALL_DICTS = ["4-1000", "5-1000", "6-1000", "7-1000"];
// 自動モードで走査するタグ種別（ArUco 各サイズ + AprilTag 全ファミリー）
const AUTO_TAG_KEYS = ["4-1000", "5-1000", "6-1000", "7-1000", "april-16h5", "april-25h9", "april-36h10", "april-36h11"];
const PROC_MAX_WIDTH = 800;
const PROC_MAX_WIDTH_CODE = 1280; // QR / バーコード検出用（高解像度寄り）
const HFOV_DEG = 60;
const LOCK_LOST_FRAMES = 45;
const WORLD_CELL_MM = 50;   // 3D ワールドビューのグリッド 1 マス (mm)
const WORLD_GRID_Y = -150;  // グリッドの高さ (mm)

let cvReady = false;
const els = {};
const dictCache = {}, detectorCache = {}, dictMetaCache = {};

/* ============================================================ i18n */
let lang = "ja";
function t(key, params) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) || (STRINGS.en && STRINGS.en[key]) || key;
  if (params) for (const k in params) s = s.replaceAll("{" + k + "}", params[k]);
  return s;
}
function detectBrowserLang() {
  for (const c of (navigator.languages || [navigator.language || "en"])) {
    const base = c.toLowerCase().split("-")[0];
    if (STRINGS[base]) return base;
  }
  return "en";
}
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  if (cvReady) { updateGenVisibility(); generateMarker(); if (batchState) renderBatchInfo(); }
  if (els.modelTabs && models.length) { renderModelTabs(); renderModelBody(); }
  if (els.stage) applyStageLayout();
  renderLog(); renderLicenses(); renderAbout(); applyTooltips(); renderShortcuts();
}
function initLang() {
  const saved = localStorage.getItem("aruco.lang");
  lang = (saved && STRINGS[saved]) ? saved : detectBrowserLang();
  els.lang.innerHTML = "";
  Object.keys(STRINGS).forEach((code) => {
    const o = document.createElement("option"); o.value = code; o.textContent = STRINGS[code]["lang.name"];
    els.lang.appendChild(o);
  });
  els.lang.value = lang;
  els.lang.addEventListener("change", () => { lang = els.lang.value; localStorage.setItem("aruco.lang", lang); applyI18n(); });
  applyI18n();
}

/* ============================================================ テーマ */
let mqlDark = null;
function applyTheme(mode) {
  const resolved = mode === "system" ? ((mqlDark && mqlDark.matches) ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.getElementById("meta-theme");
  if (meta) { const c = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(); if (c) meta.content = c; }
  // 3D ワールド背景が「テーマに合わせる」のときは追従
  if (typeof worldReady !== "undefined" && worldReady && els.worldBg && (els.worldBg.value === "auto")) setWorldBackground("auto");
}
function initTheme() {
  mqlDark = window.matchMedia("(prefers-color-scheme: dark)");
  const saved = localStorage.getItem("aruco.theme") || "system";
  els.theme.value = saved; applyTheme(saved);
  els.theme.addEventListener("change", () => { localStorage.setItem("aruco.theme", els.theme.value); applyTheme(els.theme.value); });
  mqlDark.addEventListener("change", () => { if (els.theme.value === "system") applyTheme("system"); });
}

/* ============================================================ ログ / トースト */
let logEntries = [], unread = 0, toastTimer = null;
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function setStatusDot(level, text) {
  if (!els.statusDot) return;
  els.statusDot.className = "status-dot " + (level || "info"); els.statusDot.title = text || "";
}
function logMsg(level, text) {
  logEntries.push({ t: new Date(), level, text });
  if (logEntries.length > 200) logEntries.shift();
  setStatusDot(level, text);
  if (level === "error" || level === "warn") showToast(level, text);
  if (els.logPanel && !els.logPanel.hidden) renderLog();
  else if (level === "error" || level === "warn") { unread++; updateLogBadge(); }
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)("[ArUco]", text);
}
function updateLogBadge() {
  if (!els.logBadge) return;
  if (unread > 0) { els.logBadge.hidden = false; els.logBadge.textContent = unread; } else els.logBadge.hidden = true;
}
function renderLog() {
  if (!els.logList) return;
  if (logEntries.length === 0) { els.logList.innerHTML = `<p class="empty">${t("log.empty")}</p>`; return; }
  els.logList.innerHTML = logEntries.slice().reverse().map((e) =>
    `<div class="log-row ${e.level}"><span class="log-time">${e.t.toLocaleTimeString()}</span><span class="log-text">${escapeHtml(e.text)}</span></div>`).join("");
}
function togglePanel(panel, force) {
  const show = (force !== undefined) ? force : panel.hidden;
  panel.hidden = !show;
  return show;
}
function showToast(level, text) {
  if (!els.toast) return;
  els.toast.className = "toast " + (level || "info"); els.toast.textContent = text; els.toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4500);
}

/* ============================================================ ライセンス */
const LICENSES_HTML = `
<p><strong>Libraries</strong></p>
<ul>
  <li>OpenCV.js — Apache License 2.0</li>
  <li>Three.js — MIT License</li>
  <li>JSZip — MIT / GPLv3</li>
  <li>qrcode-generator — MIT License</li>
  <li>JsBarcode — MIT License</li>
</ul>
<p><strong>Markers / Codes</strong></p>
<ul>
  <li><b>ArUco</b> — provided by OpenCV (BSD / Apache-2.0). Generated markers are free to use.</li>
  <li><b>AprilTag</b> — tag families © AprilRobotics / University of Michigan, BSD 2-Clause. Generated tags are free to use.</li>
  <li><b>QR Code</b> — &ldquo;QR Code&rdquo; is a registered trademark of <b>DENSO WAVE INCORPORATED</b>. The QR Code specification (ISO/IEC&nbsp;18004) is open and royalty-free; images you generate can be used freely. The trademark applies to the name, not to your generated images.</li>
</ul>`;
function renderLicenses() { if (els.licList) els.licList.innerHTML = LICENSES_HTML; }

/* ============================================================ このアプリについて */
function renderAbout() {
  if (!els.aboutList) return;
  const site = "https://akichika.github.io/2DMarkerTool", repo = "https://github.com/akichika/2DMarkerTool", x = "https://x.com/akichika";
  els.aboutList.innerHTML =
    `<p class="about-name"><strong>2DMarkerTool</strong></p>` +
    `<p class="about-desc">${escapeHtml(t("subtitle"))}</p>` +
    `<p><strong>${t("about.site")}</strong><br><a href="${site}" target="_blank" rel="noopener">${site}</a></p>` +
    `<p><strong>${t("about.repo")}</strong><br><a href="${repo}" target="_blank" rel="noopener">${repo}</a></p>` +
    `<p class="hint">${escapeHtml(t("about.note"))}</p>` +
    `<p><strong>${t("about.credit")}</strong><br>© akichika &nbsp; <a href="${x}" target="_blank" rel="noopener">${x}</a></p>` +
    `<hr class="about-hr" />` +
    `<p><strong>${t("about.oss")}</strong></p>` + LICENSES_HTML;
}

/* ============================================================ 起動 */
window.onOpenCvReady = function () {
  cvReady = true;
  logMsg("ready", t("status.ready"));
  els.genBtn.disabled = false; els.genBatchBtn.disabled = false; els.scanStart.disabled = false;
  updateGenVisibility(); generateMarker(); enumerateCameras();
};
window.onOpenCvError = function () { logMsg("error", t("status.error")); };

document.addEventListener("DOMContentLoaded", () => {
  cacheEls(); initTheme(); initLang(); renderLicenses(); bindUI(); initPWA();
  initModels(); initStage(); probeDeviceOrient();
  setStatusDot("loading", t("status.loading")); logMsg("loading", t("status.loading"));
  if (window.cv && cv.Mat && !cvReady) window.onOpenCvReady();
});

function cacheEls() {
  const id = (x) => document.getElementById(x);
  els.statusDot = id("status-dot"); els.lang = id("lang"); els.theme = id("theme"); els.installBtn = id("install-btn");
  els.logBtn = id("log-btn"); els.logBadge = id("log-badge"); els.logPanel = id("log-panel");
  els.logList = id("log-list"); els.logClear = id("log-clear"); els.logClose = id("log-close"); els.toast = id("toast");
  els.licBtn = id("lic-btn"); els.licPanel = id("lic-panel"); els.licList = id("lic-list"); els.licClose = id("lic-close");
  els.kbdBtn = id("kbd-btn"); els.kbdPanel = id("kbd-panel"); els.kbdList = id("kbd-list"); els.kbdClose = id("kbd-close");
  els.aboutBtn = id("about-btn"); els.aboutPanel = id("about-panel"); els.aboutClose = id("about-close"); els.aboutList = id("about-list");
  els.mirrorToggle = id("mirror-toggle"); els.videoWrap = document.querySelector(".video-wrap");
  els.adjustBtn = id("adjust-btn"); els.adjustPanel = id("adjust-panel");
  els.autoAdjust = id("auto-adjust"); els.adjBright = id("adj-bright"); els.adjContrast = id("adj-contrast"); els.adjReset = id("adj-reset");
  // 生成
  els.genType = id("gen-type"); els.genDict = id("gen-dict"); els.genCount = id("gen-count");
  els.genApril = id("gen-april"); els.genQrText = id("gen-qr-text"); els.genQrEc = id("gen-qr-ec");
  els.genBcFormat = id("gen-bc-format"); els.genBcText = id("gen-bc-text");
  els.genSize = id("gen-size"); els.genBorder = id("gen-border");
  els.genId = id("gen-id"); els.genBtn = id("gen-btn"); els.genCanvas = id("gen-canvas");
  els.genDownloadPng = id("gen-download-png"); els.genDownloadSvg = id("gen-download-svg");
  els.genPrint = id("gen-print"); els.genLabel = id("gen-label"); els.genIp = id("gen-ip");
  els.genList = id("gen-list"); els.genListLabel = id("gen-list-label"); els.genListHint = id("gen-list-hint");
  els.genBatchFormat = id("gen-batch-format"); els.genBatchBtn = id("gen-batch-btn");
  els.genBatchZip = id("gen-batch-zip"); els.genBatchPrint = id("gen-batch-print");
  els.genBatchInfo = id("gen-batch-info"); els.genGrid = id("gen-grid");
  // スキャン
  els.scanDict = id("scan-dict"); els.displayMode = id("display-mode");
  els.fillModeCtrl = id("fill-mode-ctrl"); els.fillMode = id("fill-mode");
  els.fillColorCtrl = id("fill-color-ctrl"); els.fillColor = id("fill-color");
  els.markerLenCtrl = id("marker-len-ctrl"); els.markerLen = id("marker-len");
  els.scanCamera = id("scan-camera"); els.scanStart = id("scan-start"); els.scanStop = id("scan-stop");
  els.worldToggle = id("world-toggle"); els.worldCanvas = id("world-canvas");
  els.worldDeviceBtn = id("world-device-btn"); els.worldScaleCap = id("world-scale-cap");
  els.worldBg = id("world-bg"); els.worldBgFile = id("world-bg-file");
  els.worldCamHeight = id("world-cam-height"); els.worldCamDist = id("world-cam-dist"); els.worldReset = id("world-reset");
  els.video = id("video"); els.overlay = id("overlay"); els.threeCanvas = id("three-canvas");
  els.detectList = id("detect-list"); els.detectCount = id("detect-count");
  els.lockIndicator = id("lock-indicator"); els.fps = id("fps"); els.listOrientBtn = id("list-orient-btn");
  // ステージ / レイアウト
  els.stage = id("stage"); els.stagePanels = id("stage-panels"); els.stageTabs = id("stage-tabs"); els.layoutSeg = id("layout-seg"); els.stageBar = id("stage-bar");
  els.worldPanel = document.querySelector('.stage-panel[data-panel="world"]');
  // 3D モデル
  els.modelPanel = document.querySelector('.stage-panel[data-panel="model"]');
  els.modelToggle = id("model-toggle"); els.modelTabs = id("model-tabs"); els.modelBodies = id("model-bodies");
}

function bindUI() {
  document.querySelectorAll(".tab").forEach((tb) => tb.addEventListener("click", () => switchTab(tb.dataset.tab)));
  els.genType.addEventListener("change", () => { updateGenVisibility(); if (cvReady) generateMarker(); });
  ["genDict", "genCount", "genBorder", "genApril", "genQrEc", "genBcFormat"].forEach((k) =>
    els[k].addEventListener("change", () => { if (cvReady) { if (k === "genDict") updateGenVisibility(); generateMarker(); } }));
  ["genSize", "genId", "genQrText", "genBcText"].forEach((k) => {
    els[k].addEventListener("input", () => { if (cvReady) generateMarker(); });
    els[k].addEventListener("change", () => { if (cvReady) generateMarker(); });
  });
  els.genBtn.addEventListener("click", generateMarker);
  els.genDownloadPng.addEventListener("click", downloadPng);
  els.genDownloadSvg.addEventListener("click", downloadSvg);
  els.genPrint.addEventListener("click", printMarker);
  els.genBatchBtn.addEventListener("click", generateBatch);
  els.genBatchZip.addEventListener("click", downloadBatchZip);
  els.genBatchPrint.addEventListener("click", printBatchSheet);

  els.scanStart.addEventListener("click", startScan);
  els.scanStop.addEventListener("click", stopScan);
  els.scanDict.addEventListener("change", () => { lockedKeys = null; lostFrames = 0; updateLockIndicator(); });
  els.displayMode.addEventListener("change", onDisplayModeChange);
  els.fillMode.addEventListener("change", onDisplayModeChange);
  els.markerLen.addEventListener("change", () => { objMarkerLen = null; rebuildThreePool(); rebuildWorldPool(); applyAllModelTransforms(); updateWorldScaleCaption(); });
  els.worldToggle.addEventListener("change", onWorldToggle);
  els.worldDeviceBtn.addEventListener("click", onWorldDeviceToggle);
  els.worldBg.addEventListener("change", onWorldBgChange);
  els.worldBgFile.addEventListener("change", onWorldBgFile);
  els.worldCamHeight.addEventListener("input", applyWorldCam);
  els.worldCamDist.addEventListener("input", applyWorldCam);
  els.worldReset.addEventListener("click", resetWorldCam);
  window.addEventListener("orientationchange", () => { screenOrient = (screen.orientation && screen.orientation.angle) || window.orientation || 0; });

  // レイアウト（横/縦/タブ・並べ替え・タブ切替）
  els.layoutSeg.addEventListener("click", (e) => { const b = e.target.closest("button[data-layout]"); if (b) setStageLayout(b.dataset.layout); });
  els.stagePanels.addEventListener("click", (e) => { const b = e.target.closest("button[data-move]"); if (b) movePanel(b.dataset.move); });
  els.stageTabs.addEventListener("click", (e) => { const b = e.target.closest("button[data-panel]"); if (b) selectStagePanel(b.dataset.panel); });
  els.listOrientBtn.addEventListener("click", toggleListOrient);

  // 3D モデル
  els.modelToggle.addEventListener("change", onModelToggle);
  els.modelTabs.addEventListener("click", (e) => {
    if (e.target.closest("[data-madd]")) { addModel(); return; }
    const tab = e.target.closest("[data-mtab]"); if (tab) { activeModel = +tab.dataset.mtab; renderModelTabs(); renderModelBody(); }
  });
  els.modelBodies.addEventListener("click", (e) => {
    if (e.target.closest("[data-mremove]")) { removeModel(activeModel); return; }
    if (e.target.closest("[data-mtexclear]")) { clearModelTexture(models[activeModel]); renderModelBody(); afterModelChange(); return; }
    const sh = e.target.closest("[data-mshape]");
    if (sh) { const m = models[activeModel]; m.source = "primitive"; m.shape = sh.dataset.mshape; rebuildFromSource(m); renderModelTabs(); renderModelBody(); afterModelChange(); return; }
    const sm = e.target.closest("[data-msample]");
    if (sm) { const m = models[activeModel]; m.source = "sample"; m.sampleId = sm.dataset.msample; rebuildFromSource(m); renderModelTabs(); renderModelBody(); afterModelChange(); return; }
  });
  els.modelBodies.addEventListener("change", onModelField);
  els.modelBodies.addEventListener("input", onModelField);

  els.logBtn.addEventListener("click", () => { togglePanel(els.logPanel) && (unread = 0, updateLogBadge(), renderLog()); });
  els.logClose.addEventListener("click", () => togglePanel(els.logPanel, false));
  els.logClear.addEventListener("click", () => { logEntries = []; unread = 0; updateLogBadge(); renderLog(); });
  els.licBtn.addEventListener("click", () => togglePanel(els.licPanel));
  els.licClose.addEventListener("click", () => togglePanel(els.licPanel, false));
  els.kbdBtn.addEventListener("click", () => { renderShortcuts(); togglePanel(els.kbdPanel); });
  els.kbdClose.addEventListener("click", () => togglePanel(els.kbdPanel, false));
  els.aboutBtn.addEventListener("click", () => { renderAbout(); togglePanel(els.aboutPanel); });
  els.aboutClose.addEventListener("click", () => togglePanel(els.aboutPanel, false));
  els.mirrorToggle.addEventListener("change", onMirrorChange);
  els.adjustBtn.addEventListener("click", () => { els.adjustPanel.hidden = !els.adjustPanel.hidden; });
  els.autoAdjust.addEventListener("change", onAdjustChange);
  els.adjBright.addEventListener("input", onAdjustChange);
  els.adjContrast.addEventListener("input", onAdjustChange);
  els.adjReset.addEventListener("click", resetAdjust);
  window.addEventListener("resize", () => { syncPaneHeights(); resizeWorld(); });
  els.video.addEventListener("loadedmetadata", syncPaneHeights);
  els.video.addEventListener("resize", syncPaneHeights);
  window.addEventListener("keydown", onKey);
}

function onMirrorChange() {
  if (els.videoWrap) els.videoWrap.classList.toggle("mirror", els.mirrorToggle.checked);
}

/* ---------- キーボードショートカット ---------- */
const SHORTCUTS = [
  ["G", "tab.generate"], ["S", "tab.scan"], ["Space / Enter", "kbd.startstop"],
  ["1 / 2 / 3", "kbd.modes"], ["M", "scan.mirror"], ["W", "scan.worldView"],
  ["D", "kbd.downloadPng"], ["L", "log.button"], ["?", "kbd.title"],
];
function renderShortcuts() {
  if (!els.kbdList) return;
  els.kbdList.innerHTML = SHORTCUTS.map(([k, key]) =>
    `<div class="kbd-row"><kbd>${k}</kbd><span>${escapeHtml(t(key))}</span></div>`).join("");
}
function setDisplayMode(v) { els.displayMode.value = v; onDisplayModeChange(); }
function onKey(e) {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || e.metaKey || e.ctrlKey || e.altKey) return;
  const scanActive = document.getElementById("tab-scan").classList.contains("active");
  switch (e.key) {
    case "g": case "G": switchTab("generate"); break;
    case "s": case "S": switchTab("scan"); break;
    case "l": case "L": if (togglePanel(els.logPanel)) { unread = 0; updateLogBadge(); renderLog(); } break;
    case "?": renderShortcuts(); togglePanel(els.kbdPanel); break;
    case "m": case "M": if (scanActive) { els.mirrorToggle.checked = !els.mirrorToggle.checked; onMirrorChange(); } break;
    case "w": case "W": if (scanActive) { els.worldToggle.checked = !els.worldToggle.checked; onWorldToggle(); } break;
    case "d": case "D": if (!scanActive && !els.genDownloadPng.disabled) downloadPng(); break;
    case "1": if (scanActive) setDisplayMode("2d"); break;
    case "2": if (scanActive) setDisplayMode("fill"); break;
    case "3": if (scanActive) setDisplayMode("3d"); break;
    case " ": case "Enter":
      if (scanActive) { e.preventDefault(); if (scanning) stopScan(); else startScan(); } break;
  }
}

/* ---------- ツールチップ ---------- */
const TIP_KEYS = {
  "scan-start": "scan.start", "scan-stop": "scan.stop", "gen-btn": "gen.generate",
  "gen-print": "gen.print", "log-btn": "log.button", "kbd-btn": "kbd.title",
  "install-btn": "install",
};
const TIP_SHORTCUT = { "scan-start": "Space", "scan-stop": "Space", "gen-btn": "", "log-btn": "L", "kbd-btn": "?" };
function applyTooltips() {
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    let s = t(el.getAttribute("data-i18n-title"));
    const sc = TIP_SHORTCUT[el.id];
    if (sc) s += ` (${sc})`;
    el.title = s; el.setAttribute("aria-label", s);
  });
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((tb) => tb.classList.toggle("active", tb.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  if (name !== "scan") stopScan();
}
function setStatus() {}

/* ============================================================ PWA */
let deferredPrompt = null;
function initPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(() => logMsg("info", t("msg.offlineReady"))).catch((e) => logMsg("warn", "ServiceWorker: " + e.message));
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; if (els.installBtn) els.installBtn.hidden = false; });
  window.addEventListener("appinstalled", () => { if (els.installBtn) els.installBtn.hidden = true; logMsg("info", t("msg.installed")); });
  if (els.installBtn) els.installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; els.installBtn.hidden = true;
  });
}

/* ============================================================ 辞書 / 検出器 / メタ */
function getDictionary(key) {
  if (!dictCache[key]) dictCache[key] = cv.getPredefinedDictionary(DICT_ENUM[key]);
  return dictCache[key];
}
function getDetector(key) {
  if (!detectorCache[key]) {
    const dict = getDictionary(key);
    const params = new cv.aruco_DetectorParameters();
    let det;
    try { det = new cv.aruco_ArucoDetector(dict, params, new cv.aruco_RefineParameters(10, 3, true)); }
    catch (e) { det = new cv.aruco_ArucoDetector(dict, params); }
    detectorCache[key] = det;
  }
  return detectorCache[key];
}
// {markerSize, count}
function dictMeta(key) {
  if (!dictMetaCache[key]) {
    const d = getDictionary(key);
    dictMetaCache[key] = { markerSize: d.markerSize, count: (d.bytesList ? d.bytesList.rows : 1000) };
  }
  return dictMetaCache[key];
}

/* ============================================================ 種類 / キー */
function genType() { return els.genType.value; } // aruco | apriltag | qr
function currentTagKey() {
  const ty = genType();
  if (ty === "apriltag") return els.genApril.value;
  if (els.genDict.value === "aruco-orig") return "aruco-orig";
  return els.genDict.value + "-" + els.genCount.value;
}
function currentSize() { return Math.max(50, Math.min(2000, parseInt(els.genSize.value, 10) || 300)); }
function currentQuiet() { return els.genBorder.checked; }

function dictLabelFor(key) {
  if (key === "qr") return "QR";
  if (key === "aruco-orig") return "ArUco ORIGINAL";
  if (key.startsWith("april-")) return "AprilTag " + key.slice(6);
  const c = key.split("-")[0]; return `ArUco ${c}×${c}`;
}
function ipNoteFor(key) {
  if (key === "qr") return t("ip.qr");
  if (key.startsWith("april-")) return t("ip.apriltag");
  return "";
}

function updateGenVisibility() {
  const ty = genType();
  document.querySelectorAll(".gt-aruco").forEach((e) => e.hidden = ty !== "aruco");
  document.querySelectorAll(".gt-apriltag").forEach((e) => e.hidden = ty !== "apriltag");
  document.querySelectorAll(".gt-qr").forEach((e) => e.hidden = ty !== "qr");
  document.querySelectorAll(".gt-barcode").forEach((e) => e.hidden = ty !== "barcode");
  // ORIGINAL は count 不要
  if (ty === "aruco" && els.genDict.value === "aruco-orig") els.genCount.parentElement.hidden = true;
  // ID は tag のみ
  if (els.genId.parentElement) els.genId.parentElement.hidden = (ty === "qr" || ty === "barcode");
  // 一括リストのラベル
  if (ty === "qr" || ty === "barcode") {
    els.genListLabel.textContent = t(ty === "barcode" ? "gen.bcList" : "gen.textList");
    els.genListHint.textContent = t(ty === "barcode" ? "gen.bcListHint" : "gen.textListHint");
  } else {
    els.genListLabel.textContent = t("gen.idList"); els.genListHint.textContent = t("gen.idListHint");
  }
}

/* ============================================================ バーコード生成（JsBarcode） */
function barcodeOpts(format, quiet, height) {
  return { format, displayValue: true, margin: quiet ? 10 : 4, height: height || 90, width: 2, background: "#ffffff", lineColor: "#000000", fontSize: 16 };
}
function renderBarcodeToCanvas(canvas, value, format, quiet, height) {
  if (typeof JsBarcode === "undefined") return false;
  let ok = true;
  try { JsBarcode(canvas, String(value), Object.assign(barcodeOpts(format, quiet, height), { valid: (v) => { ok = v; } })); }
  catch (e) { ok = false; }
  return ok;
}
function buildBarcodeSvg(value, format, quiet, height) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  try { JsBarcode(svg, String(value), Object.assign(barcodeOpts(format, quiet, height), { xmlDocument: document })); }
  catch (e) {}
  return new XMLSerializer().serializeToString(svg);
}

/* ============================================================ QR 生成（共通ヘルパ） */
function qrModel(text, ec) {
  const qr = qrcode(0, ec || "M"); qr.addData(text || " "); qr.make(); return qr;
}
function renderQrToCanvas(canvas, text, ec, size, quiet) {
  const qr = qrModel(text, ec);
  const n = qr.getModuleCount(), q = quiet ? 4 : 0, grid = n + 2 * q;
  const scale = Math.max(1, Math.floor(size / grid));
  const px = scale * grid;
  canvas.width = px; canvas.height = px;
  const x = canvas.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, px, px); x.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) x.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
}
function buildQrSvg(text, ec, px, quiet) {
  const qr = qrModel(text, ec);
  const n = qr.getModuleCount(), q = quiet ? 4 : 0, grid = n + 2 * q;
  let rects = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rects += `<rect x="${c + q}" y="${r + q}" width="1" height="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">` +
    `<rect width="${grid}" height="${grid}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

/* ============================================================ Tag(ArUco/AprilTag) 生成ヘルパ */
function renderTagToCanvas(canvas, key, id, size, quiet) {
  const dict = getDictionary(key), cell = dictMeta(key).markerSize;
  const total = cell + 2, q = quiet ? 1 : 0, grid = total + 2 * q;
  const modulePx = Math.max(1, Math.round(size / grid));
  const mat = new cv.Mat();
  dict.generateImageMarker(id, modulePx * total, mat, 1);
  if (q > 0) {
    const out = new cv.Mat(), b = modulePx * q;
    cv.copyMakeBorder(mat, out, b, b, b, b, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    cv.imshow(canvas, out); out.delete();
  } else cv.imshow(canvas, mat);
  mat.delete();
}
function tagBits(key, id) {
  const dict = getDictionary(key), cell = dictMeta(key).markerSize, total = cell + 2, scale = 10;
  const mat = new cv.Mat(); dict.generateImageMarker(id, total * scale, mat, 1);
  const bits = [];
  for (let r = 0; r < total; r++) { const row = []; for (let c = 0; c < total; c++) row.push(mat.ucharAt(r * scale + (scale >> 1), c * scale + (scale >> 1)) < 128); bits.push(row); }
  mat.delete(); return { bits, total };
}
function buildTagSvg(key, id, px, quiet) {
  const { bits, total } = tagBits(key, id);
  const q = quiet ? 1 : 0, grid = total + 2 * q;
  let rects = "";
  for (let r = 0; r < total; r++) for (let c = 0; c < total; c++) if (bits[r][c]) rects += `<rect x="${c + q}" y="${r + q}" width="1" height="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">` +
    `<rect width="${grid}" height="${grid}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

/* ============================================================ 生成 — 単一 */
function clampId() {
  const max = dictMeta(currentTagKey()).count;
  let v = parseInt(els.genId.value, 10);
  if (isNaN(v) || v < 0) v = 0; if (v > max - 1) v = max - 1;
  if (String(v) !== els.genId.value) els.genId.value = v; els.genId.max = max - 1;
  return v;
}
function sanitizeName(s) { return (s || "qr").replace(/[^\w.-]+/g, "_").slice(0, 40) || "qr"; }
function generateMarker() {
  if (!cvReady) return;
  try {
    const ty = genType(), size = currentSize(), quiet = currentQuiet();
    if (ty === "qr") {
      const text = els.genQrText.value || " ", ec = els.genQrEc.value;
      renderQrToCanvas(els.genCanvas, text, ec, size, quiet);
      els.genLabel.textContent = t("gen.labelQr", { ec, size });
      els.genCanvas.dataset.kind = "qr"; els.genCanvas.dataset.text = text; els.genCanvas.dataset.ec = ec;
      els.genCanvas.dataset.basename = "qr_" + sanitizeName(text);
      els.genIp.textContent = ipNoteFor("qr");
    } else if (ty === "barcode") {
      const value = els.genBcText.value || "0", format = els.genBcFormat.value;
      const ok = renderBarcodeToCanvas(els.genCanvas, value, format, quiet);
      els.genCanvas.dataset.kind = "barcode"; els.genCanvas.dataset.value = value; els.genCanvas.dataset.format = format;
      els.genCanvas.dataset.basename = "barcode_" + format + "_" + sanitizeName(value);
      els.genIp.textContent = "";
      if (!ok) { els.genLabel.textContent = t("gen.bcInvalid", { fmt: format }); els.genDownloadPng.disabled = els.genDownloadSvg.disabled = els.genPrint.disabled = true; return; }
      els.genLabel.textContent = t("gen.bcLabel", { fmt: format });
    } else {
      const key = currentTagKey(), id = clampId();
      renderTagToCanvas(els.genCanvas, key, id, size, quiet);
      els.genLabel.textContent = `${dictLabelFor(key)} / ID ${id} / ${size}×${size}px`;
      els.genCanvas.dataset.kind = "tag"; els.genCanvas.dataset.key = key; els.genCanvas.dataset.id = id;
      els.genCanvas.dataset.basename = (key.startsWith("april-") ? "apriltag_" + key.slice(6) : "aruco_" + key) + "_id" + id;
      els.genIp.textContent = ipNoteFor(key);
    }
    els.genDownloadPng.disabled = els.genDownloadSvg.disabled = els.genPrint.disabled = false;
  } catch (e) { logMsg("error", "generate: " + (e.message || e)); }
}
function currentSingleSvg(px) {
  const kind = els.genCanvas.dataset.kind;
  if (kind === "qr") return buildQrSvg(els.genCanvas.dataset.text, els.genCanvas.dataset.ec, px, currentQuiet());
  if (kind === "barcode") return buildBarcodeSvg(els.genCanvas.dataset.value, els.genCanvas.dataset.format, currentQuiet());
  return buildTagSvg(els.genCanvas.dataset.key, +els.genCanvas.dataset.id, px, currentQuiet());
}
function downloadPng() {
  const a = document.createElement("a");
  a.download = (els.genCanvas.dataset.basename || "code") + ".png"; a.href = els.genCanvas.toDataURL("image/png"); a.click();
}
function downloadSvg() {
  const blob = new Blob([currentSingleSvg(currentSize())], { type: "image/svg+xml" });
  const a = document.createElement("a"); a.download = (els.genCanvas.dataset.basename || "code") + ".svg";
  a.href = URL.createObjectURL(blob); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function printMarker() {
  const note = els.genIp.textContent;
  printImages([{ label: "", svg: currentSingleSvg(300) }], els.genLabel.textContent, note);
}

/* ============================================================ 生成 — 一括 */
function parseTagList(str, max) {
  const ids = new Set();
  str.split(/[,\n]/).forEach((part) => {
    part = part.trim(); if (!part) return;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (a > b)[a, b] = [b, a]; for (let i = a; i <= b; i++) ids.add(i); }
    else if (/^\d+$/.test(part)) ids.add(+part);
  });
  return [...ids].filter((i) => i >= 0 && i < max).sort((a, b) => a - b);
}
function parseTextList(str) {
  return str.split("\n").map((s) => s.trim()).filter((s) => s.length).slice(0, 500);
}
let batchState = null;
function renderBatchInfo() {
  if (!batchState) return;
  if (batchState.type === "qr") els.genBatchInfo.textContent = t("gen.batchInfoQr", { n: batchState.items.length });
  else if (batchState.type === "barcode") els.genBatchInfo.textContent = t("gen.batchInfoBc", { n: batchState.items.length });
  else els.genBatchInfo.textContent = t("gen.batchInfo", { dict: dictLabelFor(batchState.key), n: batchState.items.length, from: batchState.items[0], to: batchState.items[batchState.items.length - 1] });
}
function generateBatch() {
  if (!cvReady) return;
  const ty = genType(), quiet = currentQuiet(), size = currentSize();
  els.genGrid.innerHTML = "";
  if (ty === "qr") {
    const items = parseTextList(els.genList.value);
    if (!items.length) { els.genBatchInfo.textContent = t("gen.batchNoneQr"); els.genBatchZip.disabled = els.genBatchPrint.disabled = true; batchState = null; return; }
    batchState = { type: "qr", ec: els.genQrEc.value, items, quiet, size };
    const frag = document.createDocumentFragment();
    items.forEach((txt, i) => { const d = document.createElement("div"); d.className = "grid-item"; d.innerHTML = buildQrSvg(txt, batchState.ec, 110, quiet) + `<span>${escapeHtml(txt).slice(0, 24)}</span>`; frag.appendChild(d); });
    els.genGrid.appendChild(frag);
  } else if (ty === "barcode") {
    const all = parseTextList(els.genList.value), format = els.genBcFormat.value;
    const items = all.filter((v) => renderBarcodeToCanvas(document.createElement("canvas"), v, format, quiet, 40));
    if (!items.length) { els.genBatchInfo.textContent = t("gen.batchNoneBc"); els.genBatchZip.disabled = els.genBatchPrint.disabled = true; batchState = null; return; }
    batchState = { type: "barcode", format, items, quiet, size };
    const frag = document.createDocumentFragment();
    items.forEach((v) => { const d = document.createElement("div"); d.className = "grid-item"; d.innerHTML = buildBarcodeSvg(v, format, quiet, 60) + `<span>${escapeHtml(v).slice(0, 24)}</span>`; frag.appendChild(d); });
    els.genGrid.appendChild(frag);
  } else {
    const key = currentTagKey(), max = dictMeta(key).count;
    const items = parseTagList(els.genList.value, max);
    if (!items.length) { els.genBatchInfo.textContent = t("gen.batchNone", { max: max - 1 }); els.genBatchZip.disabled = els.genBatchPrint.disabled = true; batchState = null; return; }
    if (items.length > 500) { els.genBatchInfo.textContent = t("gen.batchLimit"); return; }
    batchState = { type: "tag", key, items, quiet, size };
    const frag = document.createDocumentFragment();
    items.forEach((id) => { const d = document.createElement("div"); d.className = "grid-item"; d.innerHTML = buildTagSvg(key, id, 110, quiet) + `<span>ID ${id}</span>`; frag.appendChild(d); });
    els.genGrid.appendChild(frag);
  }
  renderBatchInfo();
  els.genBatchZip.disabled = els.genBatchPrint.disabled = false;
}
function batchPngBlob(item) {
  const c = document.createElement("canvas");
  if (batchState.type === "qr") renderQrToCanvas(c, item, batchState.ec, batchState.size, batchState.quiet);
  else if (batchState.type === "barcode") renderBarcodeToCanvas(c, item, batchState.format, batchState.quiet);
  else renderTagToCanvas(c, batchState.key, item, batchState.size, batchState.quiet);
  return new Promise((res) => c.toBlob(res, "image/png"));
}
function batchSvg(item) {
  if (batchState.type === "qr") return buildQrSvg(item, batchState.ec, batchState.size, batchState.quiet);
  if (batchState.type === "barcode") return buildBarcodeSvg(item, batchState.format, batchState.quiet);
  return buildTagSvg(batchState.key, item, batchState.size, batchState.quiet);
}
function batchBaseName(item, i) {
  if (batchState.type === "qr") return "qr_" + sanitizeName(item) + "_" + i;
  if (batchState.type === "barcode") return "barcode_" + batchState.format + "_" + sanitizeName(item) + "_" + i;
  return (batchState.key.startsWith("april-") ? "apriltag_" + batchState.key.slice(6) : "aruco_" + batchState.key) + "_id" + item;
}
async function downloadBatchZip() {
  if (!batchState) return;
  if (typeof JSZip === "undefined") { logMsg("error", t("gen.batchNoZip")); return; }
  const fmt = els.genBatchFormat.value;
  els.genBatchZip.disabled = true;
  els.genBatchInfo.textContent = t("gen.batchZipping", { n: batchState.items.length, fmt: fmt.toUpperCase() });
  const zip = new JSZip(), folder = zip.folder("codes");
  for (let i = 0; i < batchState.items.length; i++) {
    const item = batchState.items[i], name = batchBaseName(item, i) + "." + fmt;
    if (fmt === "svg") folder.file(name, batchSvg(item)); else folder.file(name, await batchPngBlob(item));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a"); a.download = "codes.zip"; a.href = URL.createObjectURL(blob); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  renderBatchInfo(); els.genBatchZip.disabled = false;
}
function printBatchSheet() {
  if (!batchState) return;
  const ty = batchState.type;
  const note = ty === "qr" ? t("ip.qr") : (ty === "tag" && batchState.key.startsWith("april-") ? t("ip.apriltag") : "");
  const items = batchState.items.map((item) => ({
    label: ty === "qr" || ty === "barcode" ? String(item).slice(0, 24) : ("ID " + item),
    svg: ty === "qr" ? buildQrSvg(item, batchState.ec, 150, batchState.quiet)
      : ty === "barcode" ? buildBarcodeSvg(item, batchState.format, batchState.quiet, 80)
      : buildTagSvg(batchState.key, item, 150, batchState.quiet),
  }));
  const kind = ty === "qr" ? "QR" : ty === "barcode" ? ("Barcode " + batchState.format) : dictLabelFor(batchState.key);
  printImages(items, t("gen.batchInfoPrint", { kind, n: batchState.items.length }), note);
}
function printImages(items, title, note) {
  const w = window.open("", "_blank");
  const cards = items.map((it) => `<figure>${it.svg}<figcaption>${escapeHtml(it.label)}</figcaption></figure>`).join("");
  const site = "https://akichika.github.io/2DMarkerTool";
  const head = title ? `<h2 class="ttl">${escapeHtml(title)}</h2>` : "";
  const ipNote = note ? `<p class="ipnote">${escapeHtml(note)}</p>` : "";
  const credit = `<p class="credit"><strong>2DMarkerTool</strong> &nbsp;·&nbsp; ${site} &nbsp;·&nbsp; © akichika</p>`;
  w.document.write(`<html><head><title>${escapeHtml(title || "2DMarkerTool")}</title>
    <style>body{font-family:sans-serif;margin:16px;color:#111}.ttl{font-size:14px;margin:0 0 12px}
    .grid{display:flex;flex-wrap:wrap;gap:18px}figure{margin:0;text-align:center}figure svg{display:block;border:1px solid #ddd}
    figcaption{font-size:12px;margin-top:4px;word-break:break-all;max-width:180px}
    .ipnote{font-size:10px;color:#666;margin-top:16px}.credit{font-size:10px;color:#888;margin-top:6px;border-top:1px solid #ddd;padding-top:6px}</style></head>
    <body>${head}<div class="grid">${cards}</div>${ipNote}${credit}<script>window.onload=function(){window.print();}<\/script></body></html>`);
  w.document.close();
}

/* ============================================================ カメラ認識 */
let stream = null, rafId = null, processing = false, scanning = false;
let procCanvas = null, procCtx = null, qrDetector = null, barcodeDetector = null;
let matFrame = null, matGray = null, matSmall = null;
let lastTime = performance.now(), fpsAccum = 0, fpsCount = 0;
// 認識処理のスロットリング（ワールド操作中・デバイス姿勢追従中は ~10Hz に落とす）
let worldInteracting = false, detMinMs = 0, lastProcTime = 0;
const SLOW_HZ_MS = 100; // ~10Hz
function updateDetThrottle() { detMinMs = (worldInteracting || deviceFollow) ? SLOW_HZ_MS : 0; }
let lockedKeys = null, lostFrames = 0;
let scanFrame = 0, lastQR = [], lastBC = [], lastQRf = -99, lastBCf = -99;

function onDisplayModeChange() {
  const mode = els.displayMode.value;
  els.threeCanvas.style.display = mode === "3d" ? "block" : "none";
  const need3d = mode === "3d" || els.worldToggle.checked;
  els.markerLenCtrl.hidden = !need3d;
  els.fillModeCtrl.hidden = mode !== "fill";
  els.fillColorCtrl.hidden = !(mode === "fill" && els.fillMode.value === "custom");
  if (mode === "3d") initThree();
  if (els.overlay && mode !== "3d") els.overlay.getContext("2d").clearRect(0, 0, els.overlay.width, els.overlay.height);
  if (els.stage) applyStageLayout();
}

async function enumerateCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const prev = els.scanCamera.value; els.scanCamera.innerHTML = "";
    if (!cams.length) { const o = document.createElement("option"); o.textContent = t("scan.noCamera"); els.scanCamera.appendChild(o); return; }
    cams.forEach((c, i) => { const o = document.createElement("option"); o.value = c.deviceId; o.textContent = c.label || t("scan.cameraN", { n: i + 1 }); els.scanCamera.appendChild(o); });
    if (prev) els.scanCamera.value = prev;
  } catch (e) {}
}
function waitForVideoReady(video) {
  return new Promise((resolve) => {
    if (video.videoWidth > 0 && video.readyState >= 2) return resolve();
    const on = () => { if (video.videoWidth > 0 && video.readyState >= 2) { ["loadedmetadata", "loadeddata", "canplay"].forEach((e) => video.removeEventListener(e, on)); resolve(); } };
    ["loadedmetadata", "loadeddata", "canplay"].forEach((e) => video.addEventListener(e, on));
  });
}
async function startScan() {
  if (!cvReady) return;
  stopScan();
  const constraints = { audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" } };
  const sel = els.scanCamera.value; if (sel) constraints.video.deviceId = { exact: sel };
  try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
  catch (e) { logMsg("error", t("status.cameraError", { msg: e.message })); return; }
  els.video.srcObject = stream;
  try { await els.video.play(); } catch (e) {}
  await waitForVideoReady(els.video); await enumerateCameras();
  applyCameraTuning(); applyVideoFilter();
  setupMats(); scanning = true; lockedKeys = null; lostFrames = 0; scanFrame = 0; lastQR = []; lastBC = []; lastQRf = -99; lastBCf = -99;
  onDisplayModeChange();
  els.scanStart.disabled = true; els.scanStop.disabled = false; updateLockIndicator();
  syncPaneHeights(); requestAnimationFrame(syncPaneHeights);
  logMsg("ready", t("status.scanning", { w: els.video.videoWidth, h: els.video.videoHeight }));
  lastTime = performance.now(); loop();
}
function setupMats() {
  const w = els.video.videoWidth, h = els.video.videoHeight;
  els.overlay.width = w; els.overlay.height = h; els.threeCanvas.width = w; els.threeCanvas.height = h;
  [matFrame, matGray, matSmall, matBar, matEnh].forEach((m) => m && m.delete()); matSmall = matBar = matEnh = null;
  matFrame = new cv.Mat(h, w, cv.CV_8UC4); matGray = new cv.Mat();
  procCanvas = document.createElement("canvas"); procCanvas.width = w; procCanvas.height = h;
  procCtx = procCanvas.getContext("2d", { willReadFrequently: true });
  if (!qrDetector) qrDetector = new cv.QRCodeDetector();
  setupCamMatrix(w, h);
  if (threeReady) resizeThree(w, h);
}
function stopScan() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null; processing = false; scanning = false;
  worldInteracting = false; updateDetThrottle();
  if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; }
  if (els.video) els.video.srcObject = null;
  [matFrame, matGray, matSmall, matBar, matEnh].forEach((m) => m && m.delete());
  matFrame = matGray = matSmall = matBar = matEnh = null; procCanvas = procCtx = null;
  if (els.overlay) els.overlay.getContext("2d").clearRect(0, 0, els.overlay.width, els.overlay.height);
  if (threeReady && threeRenderer) threeRenderer.clear();
  if (els.scanStart) els.scanStart.disabled = false;
  if (els.scanStop) els.scanStop.disabled = true;
  if (els.detectList) { els.detectList.innerHTML = `<p class="empty">${t("scan.none")}</p>`; els.detectCount.textContent = "0"; }
  if (els.lockIndicator) els.lockIndicator.hidden = true;
}
function loop() {
  rafId = requestAnimationFrame(loop);
  if (processing || !procCtx || els.video.readyState < 2) return;
  // スロットリング: 操作中/デバイス追従中は ~10Hz に制限（3Dの操作を滑らかに）
  if (detMinMs) { const tnow = performance.now(); if (tnow - lastProcTime < detMinMs) return; lastProcTime = tnow; }
  if (matFrame.cols !== els.video.videoWidth || matFrame.rows !== els.video.videoHeight) { if (els.video.videoWidth > 0) setupMats(); else return; }
  processing = true;
  try { processFrame(); } catch (e) { console.error(e); }
  processing = false;
  const now = performance.now(), dt = now - lastTime; lastTime = now;
  fpsAccum += dt; fpsCount++;
  if (fpsAccum >= 500) { els.fps.textContent = (1000 / (fpsAccum / fpsCount)).toFixed(0); fpsAccum = 0; fpsCount = 0; }
}

// 文字列→色シード
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

/* ---------- 明るさ・コントラスト調整（自動 or 手動スライダー） ---------- */
const ENH_DARK_MEAN = 110;       // 自動: 平均輝度がこの値未満なら補正
let claheObj = null, matEnh = null;
function adjustIsAuto() { return !els.autoAdjust || els.autoAdjust.checked; }
function enhanceForDetect(src) {
  if (adjustIsAuto()) {
    // 自動: 暗いときのみ CLAHE + 増感
    let mean; try { mean = cv.mean(src)[0]; } catch (e) { return src; }
    if (mean >= ENH_DARK_MEAN) return src;
    if (!matEnh) matEnh = new cv.Mat();
    try {
      if (!claheObj) { try { claheObj = new cv.CLAHE(2.5, new cv.Size(8, 8)); } catch (e) { claheObj = null; } }
      if (claheObj) claheObj.apply(src, matEnh); else cv.equalizeHist(src, matEnh);
      if (mean < 55) cv.convertScaleAbs(matEnh, matEnh, 1.5, 18);
      return matEnh;
    } catch (e) { return src; }
  }
  // 手動: 明るさ(beta) / コントラスト(alpha)
  const alpha = (parseFloat(els.adjContrast && els.adjContrast.value) || 100) / 100;
  const beta = parseFloat(els.adjBright && els.adjBright.value) || 0;
  if (Math.abs(alpha - 1) < 0.01 && Math.abs(beta) < 1) return src;
  if (!matEnh) matEnh = new cv.Mat();
  try { cv.convertScaleAbs(src, matEnh, alpha, beta); return matEnh; } catch (e) { return src; }
}
// 表示映像にも同じ補正を反映（視覚フィードバック。検出は OpenCV 側で処理）
function applyVideoFilter() {
  if (!els.video) return;
  if (adjustIsAuto()) { els.video.style.filter = ""; }
  else {
    const a = (parseFloat(els.adjContrast.value) || 100) / 100, b = parseFloat(els.adjBright.value) || 0;
    els.video.style.filter = `contrast(${a}) brightness(${(1 + b / 255).toFixed(3)})`;
  }
  if (els.adjBright) els.adjBright.disabled = adjustIsAuto();
  if (els.adjContrast) els.adjContrast.disabled = adjustIsAuto();
}
function onAdjustChange() { applyVideoFilter(); }
function resetAdjust() { if (els.adjBright) els.adjBright.value = 0; if (els.adjContrast) els.adjContrast.value = 100; applyVideoFilter(); }
// カメラ側の露出/シャッター/ホワイトバランスを可能な範囲で自動調整（端末依存・ベストエフォート）
function applyCameraTuning() {
  try {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities || !track.applyConstraints) return;
    const caps = track.getCapabilities() || {}, adv = [];
    const has = (c, v) => c && c.includes && c.includes(v);
    if (has(caps.exposureMode, "continuous")) adv.push({ exposureMode: "continuous" });
    if (has(caps.focusMode, "continuous")) adv.push({ focusMode: "continuous" });
    if (has(caps.whiteBalanceMode, "continuous")) adv.push({ whiteBalanceMode: "continuous" });
    if (caps.exposureCompensation && typeof caps.exposureCompensation.max === "number") adv.push({ exposureCompensation: caps.exposureCompensation.max });
    if (caps.brightness && typeof caps.brightness.max === "number") { const b = caps.brightness; adv.push({ brightness: Math.round((b.max + (b.value != null ? b.value : b.min)) / 2) }); }
    if (caps.iso && typeof caps.iso.max === "number") { const s = caps.iso; adv.push({ iso: Math.round(Math.min(s.max, (s.max + (s.value != null ? s.value : s.min)) / 2)) }); }
    if (adv.length) track.applyConstraints({ advanced: adv }).then(() => logMsg("info", t("msg.camTuned"))).catch(() => {});
  } catch (e) {}
}

// 指定上限幅に縮小し、明るさ/コントラスト補正を施した検出用グレイ画像を返す
function makeDetInput(cap) {
  let inp = matGray, sc = 1;
  if (matGray.cols > cap) {
    sc = matGray.cols / cap;
    if (!matSmall) matSmall = new cv.Mat();
    cv.resize(matGray, matSmall, new cv.Size(cap, Math.round(matGray.rows / sc)), 0, 0, cv.INTER_AREA);
    inp = matSmall;
  }
  return { inp: enhanceForDetect(inp), sc };
}
function processFrame() {
  const w = matFrame.cols, h = matFrame.rows;
  procCtx.drawImage(els.video, 0, 0, w, h);
  matFrame.data.set(procCtx.getImageData(0, 0, w, h).data);
  cv.cvtColor(matFrame, matGray, cv.COLOR_RGBA2GRAY);

  const sel = els.scanDict.value;
  const auto = (sel === "AUTO" || sel === "AUTOLOCK" || sel === "ALL");
  let results = [];
  if (auto) {
    scanFrame++;
    // タグ: ロック済みはその種別のみ、未ロックは半分ずつ走査して負荷分散
    const tg = makeDetInput(PROC_MAX_WIDTH);
    results = detectTags(tg.inp, tg.sc, sel);
    // QR / バーコードは重いので交互に実行し、結果は数フレーム保持（高速化）
    const cd = makeDetInput(PROC_MAX_WIDTH_CODE);
    if (scanFrame % 2 === 0) { lastQR = detectQR(cd.inp, cd.sc); lastQRf = scanFrame; }
    else { lastBC = detectBarcode(cd.inp, cd.sc); lastBCf = scanFrame; }
    if (scanFrame - lastQRf <= 3) results = results.concat(lastQR);
    if (scanFrame - lastBCf <= 3) results = results.concat(lastBC);
  } else if (sel === "QR") {
    const cd = makeDetInput(PROC_MAX_WIDTH_CODE); results = detectQR(cd.inp, cd.sc);
  } else if (sel === "BARCODE") {
    const cd = makeDetInput(PROC_MAX_WIDTH_CODE); results = detectBarcode(cd.inp, cd.sc);
  } else {
    const tg = makeDetInput(PROC_MAX_WIDTH); results = detectTags(tg.inp, tg.sc, sel);
  }

  const dmode = els.displayMode.value;
  const needPose = dmode === "3d" || els.worldToggle.checked;
  const poses = needPose ? results.map((r) => estimatePose(r)) : null;
  draw(results, poses, dmode);
  if (dmode === "3d") render3D(results, poses);
  if (els.worldToggle.checked) renderWorld(results, poses);
  updateInfoPanel(results, poses);
}

function detectTags(detInput, scale, sel) {
  let keys;
  if (sel === "AUTO" || sel === "AUTOLOCK") {
    if (lockedKeys && lockedKeys.length) keys = lockedKeys;
    else keys = (scanFrame % 2 === 0) ? AUTO_TAG_KEYS.slice(0, 4) : AUTO_TAG_KEYS.slice(4); // 未ロック: ArUco/AprilTag を交互に
  } else if (sel === "ALL") keys = AUTO_TAG_KEYS;
  else keys = [sel];
  const results = [];
  for (const key of keys) {
    const det = getDetector(key);
    const corners = new cv.MatVector(), ids = new cv.Mat(), rejected = new cv.MatVector();
    try {
      det.detectMarkers(detInput, corners, ids, rejected);
      for (let i = 0; i < ids.rows; i++) {
        const c = corners.get(i).data32F, idv = ids.intAt(i, 0);
        results.push({ id: idv, idText: "ID " + idv, seed: idv, dict: key, dictLabel: dictLabelFor(key),
          pts: ptsFrom(c, scale) });
      }
    } finally { corners.delete(); ids.delete(); rejected.delete(); }
  }
  if (sel === "AUTO" || sel === "AUTOLOCK") {
    if (results.length) { const found = [...new Set(results.map((r) => r.dict))]; if (!lockedKeys || lockedKeys.join() !== found.join()) { lockedKeys = found; updateLockIndicator(); } lostFrames = 0; }
    else if (lockedKeys) { if (++lostFrames > LOCK_LOST_FRAMES) { lockedKeys = null; lostFrames = 0; updateLockIndicator(); } }
  }
  return results;
}
function pushQr(results, text, d, off, scale, i) {
  const arr = [{ x: d[off] * scale, y: d[off + 1] * scale }, { x: d[off + 2] * scale, y: d[off + 3] * scale },
    { x: d[off + 4] * scale, y: d[off + 5] * scale }, { x: d[off + 6] * scale, y: d[off + 7] * scale }];
  results.push({ id: text || t("scan.qrUnknown"), idText: text || t("scan.qrUnknown"), seed: hashStr(text || String(i)), dict: "qr", dictLabel: "QR", isQr: true, pts: arr });
}
function detectQR(detInput, scale) {
  const results = [];
  const pts = new cv.Mat();
  try {
    if (qrDetector.detectMulti(detInput, pts) && pts.rows > 0) {
      const d = pts.data32F;
      for (let i = 0; i < pts.rows; i++) {
        const off = i * 8;
        const quad = cv.matFromArray(1, 4, cv.CV_32FC2, [d[off], d[off + 1], d[off + 2], d[off + 3], d[off + 4], d[off + 5], d[off + 6], d[off + 7]]);
        let text = "";
        try { const st = new cv.Mat(); text = qrDetector.decode(detInput, quad, st); st.delete(); } catch (e) {}
        quad.delete();
        pushQr(results, text, d, off, scale, i);
      }
    }
    // フォールバック: detectMulti が失敗しても単一 QR を検出・復号できる場合がある
    if (!results.length) {
      const p1 = new cv.Mat(), st = new cv.Mat();
      try {
        const text = qrDetector.detectAndDecode(detInput, p1, st);
        if (p1.rows > 0 && p1.data32F && p1.data32F.length >= 8) pushQr(results, text, p1.data32F, 0, scale, 0);
      } catch (e) {}
      p1.delete(); st.delete();
    }
  } catch (e) { /* ignore */ } finally { pts.delete(); }
  return results;
}
function ptsFrom(c, scale) {
  return [{ x: c[0] * scale, y: c[1] * scale }, { x: c[2] * scale, y: c[3] * scale }, { x: c[4] * scale, y: c[5] * scale }, { x: c[6] * scale, y: c[7] * scale }];
}
// 4点を [左上, 右上, 右下, 左下] に並べ替え
function orderQuad(p) {
  const bySum = [...p].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...p].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]]; // TL, TR, BR, BL
}
// 1D バーコード（JAN/EAN/UPC 等）
let matBar = null;
function detectBarcode(detInput, scale) {
  const results = [];
  if (!barcodeDetector) { try { barcodeDetector = new cv.barcode_BarcodeDetector(); } catch (e) { return results; } }
  // わずかに平滑化するとシャープなエッジでも検出・復号が安定する（実写は元々平滑）
  if (!matBar) matBar = new cv.Mat();
  cv.GaussianBlur(detInput, matBar, new cv.Size(3, 3), 0);
  const src = matBar;
  const pts = new cv.Mat();
  try {
    if (barcodeDetector.detect(src, pts) && pts.rows > 0 && pts.data32F) {
      const d = pts.data32F;
      let text = "";
      try { text = barcodeDetector.detectAndDecode(src) || ""; } catch (e) {}
      for (let i = 0; i < pts.rows; i++) {
        const off = i * 8;
        const ord = orderQuad([
          { x: d[off], y: d[off + 1] }, { x: d[off + 2], y: d[off + 3] },
          { x: d[off + 4], y: d[off + 5] }, { x: d[off + 6], y: d[off + 7] },
        ]);
        const arr = ord.map((q) => ({ x: q.x * scale, y: q.y * scale }));
        const label = (i === 0 && text) ? text : t("scan.barcodeUnknown");
        results.push({ id: label, idText: label, seed: hashStr(label || String(i)), dict: "barcode", dictLabel: t("scan.barcodeLabel"), isBarcode: true, pts: arr });
      }
    }
  } catch (e) { /* ignore */ } finally { pts.delete(); }
  return results;
}

function updateLockIndicator() {
  if (!els.lockIndicator) return;
  if ((els.scanDict.value !== "AUTO" && els.scanDict.value !== "AUTOLOCK") || !scanning) { els.lockIndicator.hidden = true; return; }
  els.lockIndicator.hidden = false;
  if (lockedKeys && lockedKeys.length) {
    const names = lockedKeys.map((k) => dictLabelFor(k)).join(", ");
    els.lockIndicator.textContent = t("scan.locked", { dicts: names }); els.lockIndicator.classList.add("on");
  } else { els.lockIndicator.textContent = t("scan.lockSearching"); els.lockIndicator.classList.remove("on"); }
}

/* ---------- 描画 ---------- */
function colorFor(seed) {
  if (els.fillMode.value === "custom") { const hex = els.fillColor.value; return { solid: hex, soft: hexToRgba(hex, 0.5) }; }
  const h = (seed * 47) % 360; return { solid: `hsl(${h},85%,55%)`, soft: `hsla(${h},85%,55%,0.5)` };
}
function hexToRgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function draw(results, poses, mode) {
  const ctx = els.overlay.getContext("2d");
  const W = els.overlay.width;
  ctx.clearRect(0, 0, W, els.overlay.height);
  const base = W;
  const mir = els.mirrorToggle.checked;
  const MX = mir ? (x) => W - x : (x) => x;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const r0 of results) {
    // 左右反転時は X 座標を反転（文字は読める向きのまま重畳）
    const p = mir ? r0.pts.map((q) => ({ x: W - q.x, y: q.y })) : r0.pts;
    const r = r0;
    const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4, cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
    const side = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    const lw = Math.max(2, base / 320), dot = Math.max(3, lw * 1.7);
    if (mode === "fill") {
      const col = colorFor(r.seed);
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath();
      ctx.fillStyle = col.soft; ctx.fill(); ctx.strokeStyle = col.solid; ctx.lineWidth = lw * 1.4; ctx.stroke();
      drawBigLabel(ctx, r, cx, cy, side, base);
    } else if (mode === "2d") {
      ctx.strokeStyle = "#2dd36f"; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath(); ctx.stroke();
      const label = r.idText.length > 16 ? r.idText.slice(0, 16) + "…" : r.idText;
      ctx.font = `bold ${Math.max(16, base / 40)}px sans-serif`;
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(cx - w / 2, cy - 42, w, 30);
      ctx.fillStyle = "#2dd36f"; ctx.fillText(label, cx, cy - 27);
    }
    ctx.lineWidth = Math.max(2, base / 320);
    ctx.fillStyle = "#ff5d5d"; ctx.beginPath(); ctx.arc(p[0].x, p[0].y, dot, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#16d0ff"; ctx.beginPath(); ctx.arc(cx, cy, dot, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#16d0ff"; ctx.lineWidth = Math.max(1, base / 600);
    const cr = dot * 2.4;
    ctx.beginPath(); ctx.moveTo(cx - cr, cy); ctx.lineTo(cx + cr, cy); ctx.moveTo(cx, cy - cr); ctx.lineTo(cx, cy + cr); ctx.stroke();
  }
}
function drawBigLabel(ctx, r, cx, cy, side, base) {
  const longText = r.isQr || r.isBarcode;
  let txt = longText ? (r.idText.length > 12 ? r.idText.slice(0, 12) + "…" : r.idText) : String(r.id);
  let fs = Math.max(18, Math.min(side * (longText ? 0.18 : 0.55), base * 0.4));
  ctx.font = `900 ${fs}px sans-serif`;
  ctx.lineWidth = Math.max(3, fs * 0.14); ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(txt, cx, cy); ctx.fillStyle = "#fff"; ctx.fillText(txt, cx, cy);
}

function updateInfoPanel(results, poses) {
  els.detectCount.textContent = results.length;
  if (!results.length) { els.detectList.innerHTML = `<p class="empty">${t("scan.none")}</p>`; return; }
  const order = results.map((r, i) => i);
  order.sort((a, b) => (results[a].seed - results[b].seed));
  const W = els.overlay.width, mir = els.mirrorToggle.checked, MX = mir ? (x) => W - x : (x) => x;
  els.detectList.innerHTML = order.map((i) => {
    const r = results[i];
    const cx = MX((r.pts[0].x + r.pts[1].x + r.pts[2].x + r.pts[3].x) / 4), cy = (r.pts[0].y + r.pts[1].y + r.pts[2].y + r.pts[3].y) / 4;
    const tl = { x: MX(r.pts[0].x), y: r.pts[0].y }, side = Math.hypot(r.pts[0].x - r.pts[1].x, r.pts[0].y - r.pts[1].y);
    let dist = (poses && poses[i]) ? `<div class="meta">${t("scan.distance")}: ${(poses[i].dist / 10).toFixed(1)} cm</div>` : "";
    const isCode = r.isQr || r.isBarcode;
    const head = isCode ? r.dictLabel : r.idText;
    const sub = isCode ? "" : ` <span class="meta">${escapeHtml(r.dictLabel)}</span>`;
    const decoded = isCode ? `<div class="decoded">${t("scan.decoded")}: <span class="decoded-text">${escapeHtml(r.idText)}</span></div>` : "";
    return `<div class="detect-item">
      <div><span class="id">${escapeHtml(head)}</span>${sub}</div>${decoded}
      <div class="meta">${t("scan.center")} (${cx.toFixed(0)}, ${cy.toFixed(0)})</div>
      <div class="meta">${t("scan.topLeft")} (${tl.x.toFixed(0)}, ${tl.y.toFixed(0)}) ／ ${t("scan.side")} ${side.toFixed(0)}px</div>${dist}</div>`;
  }).join("");
}

/* ============================================================ 姿勢推定 */
let camMat = null, distCoeffs = null, objPts = null, objMarkerLen = null;
function setupCamMatrix(w, h) {
  const F = 0.5 * w / Math.tan(HFOV_DEG * Math.PI / 360);
  if (camMat) camMat.delete();
  camMat = cv.matFromArray(3, 3, cv.CV_64F, [F, 0, w / 2, 0, F, h / 2, 0, 0, 1]);
  if (!distCoeffs) distCoeffs = cv.matFromArray(5, 1, cv.CV_64F, [0, 0, 0, 0, 0]);
}
function ensureObjPts() {
  const s = Math.max(1, parseFloat(els.markerLen.value) || 50);
  if (objPts && objMarkerLen === s) return;
  if (objPts) objPts.delete();
  const h = s / 2; objPts = cv.matFromArray(4, 1, cv.CV_32FC3, [-h, h, 0, h, h, 0, h, -h, 0, -h, -h, 0]); objMarkerLen = s;
}
function estimatePose(r) {
  if (!camMat) return null;
  // バーコードは縦横比が一定でないため、検出した枠の比率から矩形の物体点を作る
  let objMat = objPts, ownObj = false, flag;
  if (r.isBarcode) {
    const s = Math.max(1, parseFloat(els.markerLen.value) || 50);
    const wpx = Math.hypot(r.pts[1].x - r.pts[0].x, r.pts[1].y - r.pts[0].y);
    const hpx = Math.hypot(r.pts[2].x - r.pts[1].x, r.pts[2].y - r.pts[1].y);
    let ar = hpx / Math.max(1, wpx); if (!isFinite(ar) || ar <= 0) ar = 0.4;
    const hw = s / 2, hh = s * ar / 2;
    objMat = cv.matFromArray(4, 1, cv.CV_32FC3, [-hw, hh, 0, hw, hh, 0, hw, -hh, 0, -hw, -hh, 0]); ownObj = true;
    flag = (typeof cv.SOLVEPNP_IPPE !== "undefined") ? cv.SOLVEPNP_IPPE : 0;
  } else {
    ensureObjPts(); objMat = objPts;
    flag = (typeof cv.SOLVEPNP_IPPE_SQUARE !== "undefined") ? cv.SOLVEPNP_IPPE_SQUARE : 0;
  }
  const img = cv.matFromArray(4, 1, cv.CV_32FC2, [r.pts[0].x, r.pts[0].y, r.pts[1].x, r.pts[1].y, r.pts[2].x, r.pts[2].y, r.pts[3].x, r.pts[3].y]);
  const rvec = new cv.Mat(), tvec = new cv.Mat(), R = new cv.Mat();
  let out = null;
  try {
    if (cv.solvePnP(objMat, img, camMat, distCoeffs, rvec, tvec, false, flag)) {
      cv.Rodrigues(rvec, R);
      const Rm = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Rm.push(R.doubleAt(i, j));
      const tx = tvec.doubleAt(0, 0), ty = tvec.doubleAt(1, 0), tz = tvec.doubleAt(2, 0);
      out = { R: Rm, t: [tx, ty, tz], dist: Math.hypot(tx, ty, tz) };
    }
  } catch (e) {}
  [img, rvec, tvec, R].forEach((m) => m.delete());
  if (ownObj) objMat.delete();
  return out;
}

/* ============================================================ Three.js AR重畳 */
let threeReady = false, threeRenderer = null, threeScene = null, threeCam = null, threePool = [];
function initThree() {
  if (threeReady || typeof THREE === "undefined") { if (threeReady) syncThreeCam(); return; }
  threeRenderer = new THREE.WebGLRenderer({ canvas: els.threeCanvas, alpha: true, antialias: true });
  threeRenderer.setClearColor(0x000000, 0);
  threeScene = new THREE.Scene();
  threeCam = new THREE.PerspectiveCamera(40, 1, 1, 100000);
  threeScene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(1, 1, 2); threeScene.add(dir);
  threeReady = true;
  if (matFrame) resizeThree(matFrame.cols, matFrame.rows);
  rebuildThreePool();
}
function resizeThree(w, h) { if (threeReady) { threeRenderer.setSize(w, h, false); syncThreeCam(); } }
function syncThreeCam() {
  if (!threeReady || !matFrame) return;
  const w = matFrame.cols, h = matFrame.rows, F = 0.5 * w / Math.tan(HFOV_DEG * Math.PI / 360);
  threeCam.fov = 2 * Math.atan(0.5 * h / F) * 180 / Math.PI; threeCam.aspect = w / h; threeCam.updateProjectionMatrix();
}
function makeMarkerObj(s, color) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false;
  g.add(new THREE.AxesHelper(s));
  const box = new THREE.BoxGeometry(s, s, s);
  const cube = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: color || 0x2dd36f, transparent: true, opacity: 0.18 }));
  cube.position.z = s / 2; g.add(cube);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: color || 0x2dd36f }));
  edges.position.z = s / 2; g.add(edges);
  return g;
}
function rebuildThreePool() { if (threeReady) { threePool.forEach((o) => threeScene.remove(o)); threePool = []; } }
function poseMatrix(obj, pose) {
  const R = pose.R, tt = pose.t;
  obj.matrix.set(R[0], R[1], R[2], tt[0], -R[3], -R[4], -R[5], -tt[1], -R[6], -R[7], -R[8], -tt[2], 0, 0, 0, 1);
}
function render3D(results, poses) {
  if (!threeReady) return;
  const s = Math.max(1, parseFloat(els.markerLen.value) || 50);
  let used = 0;
  for (let i = 0; i < results.length; i++) {
    const pose = poses[i]; if (!pose) continue;
    if (modelForId(results[i].id)) continue; // モデル表示するIDは姿勢ボックスを省略
    let obj = threePool[used]; if (!obj) { obj = makeMarkerObj(s); threeScene.add(obj); threePool[used] = obj; }
    poseMatrix(obj, pose); obj.visible = true; used++;
  }
  for (let i = used; i < threePool.length; i++) threePool[i].visible = false;
  renderModels(threeScene, results, poses, "arObj");
  threeRenderer.render(threeScene, threeCam);
}

/* ============================================================ 3D ワールドビュー（OrbitControls） */
let worldReady = false, worldRenderer = null, worldScene = null, worldCam = null, worldControls = null, worldPool = [];
function onWorldToggle() {
  const on = els.worldToggle.checked;
  if (els.worldPanel) els.worldPanel.hidden = !on;
  onDisplayModeChange();
  applyStageLayout();
  if (on) {
    initWorld(); resizeWorld(); updateWorldScaleCaption();
    updateDeviceBtnVisibility();
    renderWorldStatic();
  } else if (deviceFollow) stopDeviceFollow();
}

/* ============================================================ ステージ柔軟レイアウト */
const STAGE_KEYS = ["camera", "list", "world", "model"];
let stageLayout = "row", stageOrder = ["camera", "list", "world", "model"], activeStagePanel = "camera";
function need3d() { return els.displayMode.value === "3d" || els.worldToggle.checked; }
function panelEl(k) { return document.querySelector(`.stage-panel[data-panel="${k}"]`); }
function initStage() {
  stageLayout = localStorage.getItem("aruco.layout") || "row";
  const savedBg = localStorage.getItem("aruco.worldbg"); if (savedBg && els.worldBg) els.worldBg.value = savedBg;
  listOrient = localStorage.getItem("aruco.listorient") || "vertical";
  applyListOrient();
  applyStageLayout();
}
let listOrient = "vertical";
function applyListOrient() {
  const horiz = listOrient === "horizontal";
  els.detectList.classList.toggle("horizontal", horiz);
  const use = els.listOrientBtn && els.listOrientBtn.querySelector("use");
  if (use) use.setAttribute("href", horiz ? "#i-cols" : "#i-rows");
}
function toggleListOrient() { listOrient = (listOrient === "horizontal") ? "vertical" : "horizontal"; localStorage.setItem("aruco.listorient", listOrient); applyListOrient(); }
function visiblePanels() {
  return stageOrder.filter((k) => {
    if (k === "world") return els.worldToggle.checked;
    if (k === "model") return need3d();
    return true;
  });
}
function setStageLayout(layout) { stageLayout = layout; localStorage.setItem("aruco.layout", layout); applyStageLayout(); }
function movePanel(spec) {
  const [key, dStr] = spec.split(":"); const i = stageOrder.indexOf(key), j = i + parseInt(dStr, 10);
  if (i < 0 || j < 0 || j >= stageOrder.length) return;
  [stageOrder[i], stageOrder[j]] = [stageOrder[j], stageOrder[i]];
  applyStageLayout();
}
function selectStagePanel(key) { activeStagePanel = key; applyStageLayout(); }
function applyStageLayout() {
  if (!els.stage) return;
  els.stage.dataset.layout = stageLayout;
  if (els.worldPanel) els.worldPanel.hidden = !els.worldToggle.checked;
  if (els.modelPanel) els.modelPanel.hidden = !need3d();
  els.layoutSeg.querySelectorAll("button[data-layout]").forEach((b) => b.classList.toggle("active", b.dataset.layout === stageLayout));
  STAGE_KEYS.forEach((k) => { const p = panelEl(k); if (p) p.style.order = stageOrder.indexOf(k); });
  const vis = visiblePanels(), tabs = stageLayout === "tabs";
  els.stageTabs.hidden = !tabs;
  if (els.stageBar) els.stageBar.hidden = !tabs;
  if (tabs && vis.indexOf(activeStagePanel) < 0) activeStagePanel = vis[0] || "camera";
  if (tabs) renderStageTabs(vis);
  STAGE_KEYS.forEach((k) => {
    const p = panelEl(k); if (!p) return;
    if (vis.indexOf(k) < 0) { p.style.display = "none"; return; }
    p.style.display = (tabs && k !== activeStagePanel) ? "none" : "";
  });
  requestAnimationFrame(() => { syncPaneHeights(); resizeWorld(); if (threeReady && matFrame) resizeThree(matFrame.cols, matFrame.rows); });
}
// 各ペインの高さをカメラ（映像）基準にそろえる
function syncPaneHeights() {
  if (!els.stage) return;
  let h = (els.video && els.video.clientHeight) || 0;
  if (!h || h < 80) h = (els.videoWrap && els.videoWrap.clientHeight) || 0;
  if (!h || h < 80) h = 360; // カメラ未起動時の既定
  h = Math.max(220, Math.min(560, Math.round(h)));
  els.stage.style.setProperty("--pane-h", h + "px");
}
function renderStageTabs(vis) {
  const label = { camera: t("panel.camera"), list: t("scan.results"), world: t("scan.worldView"), model: t("model.title") };
  els.stageTabs.innerHTML = vis.map((k) => `<button type="button" data-panel="${k}" class="${k === activeStagePanel ? "active" : ""}">${escapeHtml(label[k])}</button>`).join("");
}

/* ============================================================ 3D モデル（マーカー上に表示） */
let models = [], activeModel = 0, modelSeq = 0, modelsEnabled = true;
const SHAPES = [["cube", "model.shapeCube"], ["sphere", "model.shapeSphere"], ["cylinder", "model.shapeCylinder"], ["cone", "model.shapeCone"], ["tetra", "model.shapeTetra"], ["octa", "model.shapeOcta"], ["torus", "model.shapeTorus"]];
const SHAPE_KEY = Object.fromEntries(SHAPES);
const SAMPLES = [["house", "model.sampleHouse"], ["tree", "model.sampleTree"], ["arrow", "model.sampleArrow"], ["rocket", "model.sampleRocket"]];
const SAMPLE_KEY = Object.fromEntries(SAMPLES);
function seedHex(seed) { const h = (Math.abs(seed | 0) * 47) % 360; const c = new THREE.Color(); c.setHSL(h / 360, 0.62, 0.55); return "#" + c.getHexString(); }
function primColor(m) { return m.colorAuto ? seedHex(m.id) : (m.color || "#8fd6a8"); }
function initModels() {
  if (els.modelToggle) modelsEnabled = els.modelToggle.checked;
  if (!models.length) addModel(false);
  renderModelTabs(); renderModelBody();
}
function onModelToggle() {
  modelsEnabled = els.modelToggle.checked;
  if (!modelsEnabled) models.forEach((m) => { if (m.arObj) m.arObj.visible = false; if (m.worldObj) m.worldObj.visible = false; });
  if (!scanning && els.worldToggle.checked) renderWorldStatic();
}
function addModel(render) {
  const m = { key: ++modelSeq, source: "primitive", shape: "cube", sampleId: "house", color: "#8fd6a8", colorAuto: true, id: 0, name: "", url: null, texUrl: null, texture: null, scale: 1, rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0, template: null, baseFoot: 1, status: "", arObj: null, worldObj: null };
  models.push(m); activeModel = models.length - 1;
  rebuildFromSource(m); // 既定はプリミティブ（立方体・自動色）を即表示
  if (render !== false) { renderModelTabs(); renderModelBody(); }
}
function removeModel(idx) {
  const m = models[idx]; if (m) { if (m.url) URL.revokeObjectURL(m.url); if (m.texUrl) URL.revokeObjectURL(m.texUrl); disposeModelInstances(m); }
  models.splice(idx, 1);
  if (!models.length) addModel(false);
  if (activeModel >= models.length) activeModel = models.length - 1;
  renderModelTabs(); renderModelBody();
}
function modelTabLabel(m, i) {
  if (m.source === "file") return m.name ? m.name.slice(0, 14) : t("model.item") + " " + (i + 1);
  if (m.source === "sample") return t(SAMPLE_KEY[m.sampleId] || "model.sampleHouse");
  return t(SHAPE_KEY[m.shape] || "model.shapeCube");
}
function renderModelTabs() {
  if (!els.modelTabs) return;
  els.modelTabs.innerHTML = models.map((m, i) =>
    `<button type="button" data-mtab="${i}" class="${i === activeModel ? "active" : ""}"><svg class="ic"><use href="#i-cube"/></svg>${escapeHtml(modelTabLabel(m, i))}</button>`
  ).join("") + `<button type="button" class="model-add" data-madd="1" title="${escapeHtml(t("model.add"))}"><svg class="ic"><use href="#i-plus"/></svg></button>`;
}
function renderModelBody() {
  if (!els.modelBodies) return;
  const m = models[activeModel]; if (!m) { els.modelBodies.innerHTML = ""; return; }
  const isPrim = m.source === "primitive";
  const colorRow = isPrim ? `
        <label>${t("model.color")}
          <select data-mfield="colorMode">
            <option value="auto" ${m.colorAuto ? "selected" : ""}>${escapeHtml(t("model.colorAuto"))}</option>
            <option value="custom" ${!m.colorAuto ? "selected" : ""}>${escapeHtml(t("model.colorCustom"))}</option>
          </select>
        </label>
        <label class="model-colpick" ${m.colorAuto ? "hidden" : ""}>${t("model.pickColor")}<input type="color" data-mfield="color" value="${m.color}" /></label>
        <label>${t("model.texture")}<input type="file" data-mfield="texfile" accept="image/*" /></label>
        ${m.texture ? `<button type="button" class="mini" data-mtexclear="1">${escapeHtml(t("model.texClear"))}</button>` : ""}` : "";
  const primBtns = SHAPES.map(([v, k]) => `<button type="button" data-mshape="${v}" class="ms-item ${isPrim && m.shape === v ? "active" : ""}"><svg class="ic"><use href="#i-cube"/></svg>${escapeHtml(t(k))}</button>`).join("");
  const sampleBtns = SAMPLES.map(([v, k]) => `<button type="button" data-msample="${v}" class="ms-item ${m.source === "sample" && m.sampleId === v ? "active" : ""}"><svg class="ic"><use href="#i-cube"/></svg>${escapeHtml(t(k))}</button>`).join("");
  els.modelBodies.innerHTML = `
    <div class="model-body active">
      <div class="model-layout">
        <div class="model-settings">
          <div class="model-row">
            <label>${t("model.target")}<input type="number" data-mfield="id" min="0" value="${m.id}" /></label>
            ${colorRow}
            <button type="button" class="iconbtn" data-mremove="1" title="${escapeHtml(t("model.remove"))}"><svg class="ic"><use href="#i-trash"/></svg></button>
          </div>
          <p class="model-status">${escapeHtml(m.status || t("model.primitiveReady"))}</p>
          <details class="model-details">
            <summary>${escapeHtml(t("model.details"))}</summary>
            <div class="model-row"><label>${t("model.scale")}<input type="number" data-mfield="scale" step="0.05" min="0.01" value="${m.scale}" /></label></div>
            <div class="model-row">
              <span class="model-grp"><span class="hint">${t("model.rotation")} (°)</span><span class="num3">
                <input type="number" data-mfield="rx" step="5" value="${m.rx}" title="X" />
                <input type="number" data-mfield="ry" step="5" value="${m.ry}" title="Y" />
                <input type="number" data-mfield="rz" step="5" value="${m.rz}" title="Z" /></span></span>
            </div>
            <div class="model-row">
              <span class="model-grp"><span class="hint">${t("model.position")} (mm)</span><span class="num3">
                <input type="number" data-mfield="tx" step="1" value="${m.tx}" title="X" />
                <input type="number" data-mfield="ty" step="1" value="${m.ty}" title="Y" />
                <input type="number" data-mfield="tz" step="1" value="${m.tz}" title="Z" /></span></span>
            </div>
          </details>
        </div>
        <div class="model-samples">
          <canvas id="model-preview" class="model-preview"></canvas>
          <div class="ms-group-title">${t("model.primitives")}</div>
          <div class="ms-grid">${primBtns}</div>
          <div class="ms-group-title">${t("model.samples")}</div>
          <div class="ms-grid">${sampleBtns}</div>
          <div class="ms-group-title">${t("model.srcFile")}</div>
          <label class="ms-file">${escapeHtml(t("model.file"))}<input type="file" data-mfield="file" accept=".glb,.gltf,.obj" /></label>
        </div>
      </div>
    </div>`;
  updateModelPreview();
}
/* ---- 選択中モデルのライブ3Dプレビュー ---- */
let mpRenderer = null, mpScene = null, mpCam = null, mpHolder = null, mpRAF = null, mpRot = 0, mpCanvas = null;
function ensureModelPreview() {
  const canvas = document.getElementById("model-preview"); if (!canvas || typeof THREE === "undefined") return false;
  if (!mpScene) {
    mpScene = new THREE.Scene();
    mpCam = new THREE.PerspectiveCamera(40, 1, 0.01, 1000); mpCam.up.set(0, 0, 1);
    mpScene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(1, 2, 1.5); mpScene.add(dl);
    mpHolder = new THREE.Group(); mpScene.add(mpHolder);
  }
  if (mpCanvas !== canvas) { if (mpRenderer) mpRenderer.dispose(); mpRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true }); mpRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); mpCanvas = canvas; }
  return true;
}
function updateModelPreview() {
  if (!ensureModelPreview()) return;
  while (mpHolder.children.length) mpHolder.remove(mpHolder.children[0]);
  const m = models[activeModel];
  if (m && m.template) {
    const obj = m.template.clone(true);
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sph = box.getBoundingSphere(new THREE.Sphere());
    obj.position.sub(c); mpHolder.add(obj);
    const r = sph.radius || 1, d = (r / Math.sin(40 * Math.PI / 360)) * 1.3;
    mpCam.position.set(d * 0.65, -d * 0.95, d * 0.6); mpCam.lookAt(0, 0, 0);
  }
  startMpLoop();
}
function startMpLoop() {
  if (mpRAF) return;
  const tick = () => {
    mpRAF = requestAnimationFrame(tick);
    if (!mpRenderer || !mpCanvas || mpCanvas.offsetParent === null) return; // 非表示時は描画しない
    const w = mpCanvas.clientWidth || 180, h = mpCanvas.clientHeight || 150;
    if (mpCanvas.width !== w || mpCanvas.height !== h) { mpRenderer.setSize(w, h, false); mpCam.aspect = w / h; mpCam.updateProjectionMatrix(); }
    mpRot += 0.012; if (mpHolder) mpHolder.rotation.z = mpRot;
    mpRenderer.render(mpScene, mpCam);
  };
  tick();
}
function afterModelChange() { applyAllModelTransforms(); updateModelPreview(); if (!scanning && els.worldToggle.checked) renderWorldStatic(); }
function onModelField(e) {
  const el = e.target.closest("[data-mfield]"); if (!el) return;
  const m = models[activeModel]; if (!m) return;
  const f = el.dataset.mfield;
  if (f === "file") { const file = el.files && el.files[0]; if (file) loadModelFile(m, file); return; }
  if (f === "texfile") { const file = el.files && el.files[0]; if (file) setModelTexture(m, file); return; }
  if (f === "colorMode") { m.colorAuto = (el.value === "auto"); rebuildFromSource(m); renderModelBody(); afterModelChange(); return; }
  if (f === "color") { m.color = el.value; m.colorAuto = false; rebuildFromSource(m); afterModelChange(); return; }
  if (f === "id") { m.id = parseInt(el.value, 10) || 0; if (m.colorAuto && m.source !== "file") rebuildFromSource(m); }
  else m[f] = parseFloat(el.value) || 0;
  afterModelChange();
}
/* ---- プリミティブ / サンプル ---- */
function makeStdMat(colorHex, texture) {
  return new THREE.MeshStandardMaterial({ color: texture ? 0xffffff : new THREE.Color(colorHex), map: texture || null, metalness: 0.1, roughness: 0.7 });
}
// 正四面体：底面を水平（マーカー面）に、底面三角形の頂点の1つを +X 方向へ
function makeTetraGeometry() {
  const r = 0.62, yb = 0, ya = 1.0, s = Math.sin(Math.PI * 2 / 3) * r, cc = Math.cos(Math.PI * 2 / 3) * r;
  const v0 = [r, yb, 0], v1 = [cc, yb, s], v2 = [cc, yb, -s], ap = [0, ya, 0];
  const tris = [v0, v2, v1, /*底*/ v0, v1, ap, v1, v2, ap, v2, v0, ap];
  const pos = []; tris.forEach((p) => pos.push(p[0], p[1], p[2]));
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function makePrimitive(shape, texture, colorHex) {
  let geo;
  switch (shape) {
    case "sphere": geo = new THREE.SphereGeometry(0.5, 32, 16); break;
    case "cylinder": geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
    case "cone": geo = new THREE.ConeGeometry(0.5, 1, 32); break;
    case "tetra": geo = makeTetraGeometry(); break;
    case "octa": geo = new THREE.OctahedronGeometry(0.62); break;
    case "torus": geo = new THREE.TorusGeometry(0.38, 0.16, 18, 36); break;
    default: geo = new THREE.BoxGeometry(1, 1, 1);
  }
  return new THREE.Mesh(geo, makeStdMat(colorHex, texture));
}
// 手続き生成のサンプル3Dモデル（オフライン・外部ファイル不要）
function makeSampleModel(id, colorHex) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), metalness: 0.1, roughness: 0.7 });
  if (id === "tree") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 16), mat("#8a5a2b")); trunk.position.y = 0.25; g.add(trunk);
    const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 16), mat("#2e9e54")); f1.position.y = 0.75; g.add(f1);
    const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.55, 16), mat("#37b863")); f2.position.y = 1.05; g.add(f2);
  } else if (id === "arrow") {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 16), mat(colorHex)); shaft.position.y = 0.35; g.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 20), mat(colorHex)); head.position.y = 0.9; g.add(head);
  } else if (id === "rocket") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.8, 24), mat("#dfe6ef")); body.position.y = 0.5; g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 24), mat(colorHex)); nose.position.y = 1.1; g.add(nose);
    for (let i = 0; i < 3; i++) { const fin = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4), mat(colorHex)); const a = i * Math.PI * 2 / 3; fin.position.set(Math.cos(a) * 0.28, 0.18, Math.sin(a) * 0.28); g.add(fin); }
  } else { // house
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), mat(colorHex)); body.position.y = 0.3; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.45, 4), mat("#b5483a")); roof.position.y = 0.82; roof.rotation.y = Math.PI / 4; g.add(roof);
  }
  return g;
}
function rebuildFromSource(m) {
  if (typeof THREE === "undefined") return;
  if (m.source === "file") return; // ファイルは loadModelFile 側で構築
  disposeModelInstances(m);
  try {
    const obj = m.source === "sample" ? makeSampleModel(m.sampleId, primColor(m)) : makePrimitive(m.shape, m.texture, primColor(m));
    m.template = normalizeModel(obj, m); m.status = t("model.primitiveReady");
  } catch (e) { m.template = null; m.status = t("model.error", { msg: e.message || e }); }
}
function setModelTexture(m, file) {
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, (tex) => {
    if (typeof THREE.sRGBEncoding !== "undefined") tex.encoding = THREE.sRGBEncoding;
    if (m.texUrl) URL.revokeObjectURL(m.texUrl);
    m.texUrl = url; m.texture = tex; m.source = "primitive"; rebuildFromSource(m); renderModelTabs(); renderModelBody(); afterModelChange();
  }, null, () => { URL.revokeObjectURL(url); logMsg("warn", "texture load failed"); });
}
function clearModelTexture(m) {
  if (m.texture) { m.texture.dispose && m.texture.dispose(); m.texture = null; }
  if (m.texUrl) { URL.revokeObjectURL(m.texUrl); m.texUrl = null; }
  rebuildFromSource(m);
}
/* ---- ファイル読み込み（glTF/GLB・OBJ） ---- */
function loadModelFile(m, file) {
  if (m.url) URL.revokeObjectURL(m.url);
  disposeModelInstances(m);
  m.source = "file"; m.template = null; m.name = file.name; m.url = URL.createObjectURL(file);
  m.status = t("model.loading"); renderModelTabs(); renderModelBody();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const done = (obj) => {
    try { m.template = normalizeModel(obj, m); m.status = t("model.loaded", { name: file.name.slice(0, 24) }); logMsg("info", t("model.loaded", { name: file.name })); }
    catch (e) { m.template = null; m.status = t("model.error", { msg: e.message || e }); }
    renderModelTabs(); renderModelBody();
  };
  const fail = (e) => { m.template = null; m.status = t("model.error", { msg: (e && e.message) || "error" }); renderModelBody(); logMsg("warn", "model: " + ((e && e.message) || e)); };
  try {
    if (ext === "obj") {
      if (typeof THREE.OBJLoader === "undefined") return fail({ message: "OBJLoader N/A" });
      new THREE.OBJLoader().load(m.url, done, null, fail);
    } else {
      if (typeof THREE.GLTFLoader === "undefined") return fail({ message: "GLTFLoader N/A" });
      new THREE.GLTFLoader().load(m.url, (g) => done(g.scene || (g.scenes && g.scenes[0])), null, fail);
    }
  } catch (e) { fail(e); }
}
function normalizeModel(obj, m) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -center.y, -center.z);     // 原点中心（Y-up）
  const wrap = new THREE.Group(); wrap.add(obj);
  wrap.rotation.x = Math.PI / 2;                          // Y-up → Z-up（マーカー法線方向）
  wrap.position.z = size.y / 2;                           // 底面をマーカー平面(z=0)へ
  m.baseFoot = Math.max(size.x, size.z, 1e-3);
  return wrap;
}
function makeModelInstance(m) {
  const holder = new THREE.Group(); holder.matrixAutoUpdate = false;
  const inner = new THREE.Group(); inner.add(m.template.clone(true));
  holder.add(inner); holder.userData.inner = inner; return holder;
}
function applyModelTransform(holder, m) {
  const inner = holder.userData.inner; if (!inner) return;
  const s = Math.max(1, parseFloat(els.markerLen.value) || 50);
  inner.scale.setScalar((s / m.baseFoot) * (m.scale || 1));
  inner.position.set(m.tx, m.ty, m.tz);
  inner.rotation.set(m.rx * Math.PI / 180, m.ry * Math.PI / 180, m.rz * Math.PI / 180);
}
function applyAllModelTransforms() { models.forEach((m) => { if (m.arObj) applyModelTransform(m.arObj, m); if (m.worldObj) applyModelTransform(m.worldObj, m); }); }
function disposeModelInstances(m) { ["arObj", "worldObj"].forEach((p) => { if (m[p]) { if (m[p].parent) m[p].parent.remove(m[p]); m[p] = null; } }); }
function modelForId(id) { if (!modelsEnabled || typeof id !== "number") return null; for (const m of models) if (m.template && m.id === id) return m; return null; }
function renderModels(scene, results, poses, prop) {
  if (!modelsEnabled) { for (const m of models) if (m[prop]) m[prop].visible = false; return; }
  for (const m of models) {
    if (!m.template) { if (m[prop]) m[prop].visible = false; continue; }
    let pose = null;
    for (let i = 0; i < results.length; i++) { if (results[i].id === m.id && poses && poses[i]) { pose = poses[i]; break; } }
    if (!m[prop]) { m[prop] = makeModelInstance(m); scene.add(m[prop]); applyModelTransform(m[prop], m); }
    if (pose) { applyModelTransform(m[prop], m); poseMatrix(m[prop], pose); m[prop].visible = true; }
    else m[prop].visible = false;
  }
}

/* ============================================================ 3D ワールド背景 */
function makeGradientTexture(stops) {
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, 16, 256);
  return new THREE.CanvasTexture(c);
}
function themeBgColor() {
  const th = document.documentElement.getAttribute("data-theme");
  if (th === "light") return 0xeef2f8;
  if (th === "hc") return 0x000000;
  return 0x10141c; // dark
}
function setWorldBackground(kind) {
  if (!worldReady) return;
  let bg;
  switch (kind) {
    case "light": bg = new THREE.Color(0xeef2f8); break;
    case "dark": bg = new THREE.Color(0x10141c); break;
    case "sky": bg = makeGradientTexture([[0, "#bcd9ff"], [0.55, "#7fb0f0"], [1, "#eaf4ff"]]); break;
    case "auto": default: bg = new THREE.Color(themeBgColor());
  }
  worldScene.background = bg;
  renderWorldStatic();
}
function onWorldBgChange() {
  const v = els.worldBg.value;
  if (v === "custom") { els.worldBgFile.click(); return; }
  localStorage.setItem("aruco.worldbg", v); setWorldBackground(v);
}
function onWorldBgFile() {
  const f = els.worldBgFile.files && els.worldBgFile.files[0]; if (!f || !worldReady) return;
  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (tex) => { worldScene.background = tex; renderWorldStatic(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, null, () => URL.revokeObjectURL(url));
}
function updateWorldScaleCaption() {
  if (els.worldScaleCap) els.worldScaleCap.textContent = t("scan.worldScale", { cell: WORLD_CELL_MM, len: Math.round(parseFloat(els.markerLen.value) || 50) });
}
function initWorld() {
  if (worldReady || typeof THREE === "undefined") return;
  worldRenderer = new THREE.WebGLRenderer({ canvas: els.worldCanvas, antialias: true });
  worldRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  worldScene = new THREE.Scene();
  worldScene.background = new THREE.Color(themeBgColor());
  worldCam = new THREE.PerspectiveCamera(50, 1, 1, 100000);
  worldCam.position.set(320, 260, 260);
  worldScene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dl = new THREE.DirectionalLight(0xffffff, 0.5); dl.position.set(1, 2, 1); worldScene.add(dl);
  const grid = new THREE.GridHelper(WORLD_CELL_MM * 20, 20, 0x666666, 0x333344); grid.position.y = WORLD_GRID_Y; worldScene.add(grid);
  // デバイスカメラ表現（原点・-Z方向）
  worldScene.add(makeCameraGizmo());
  // スケールバー・軸ラベル
  worldScene.add(makeScaleBar(100));
  worldScene.add(axisLabel("X", 95, 0, 0, 0xff5555));
  worldScene.add(axisLabel("Y", 0, 95, 0, 0x55dd55));
  worldScene.add(axisLabel("Z", 0, 0, 95, 0x5599ff));
  worldControls = new THREE.OrbitControls(worldCam, worldRenderer.domElement);
  worldControls.target.set(0, 0, -250); worldControls.enableDamping = true; worldControls.update();
  worldControls.addEventListener("change", () => { if (!scanning) worldRenderer.render(worldScene, worldCam); });
  // 視点操作中は認識処理を ~10Hz に落とす
  worldControls.addEventListener("start", () => { worldInteracting = true; updateDetThrottle(); });
  worldControls.addEventListener("end", () => { worldInteracting = false; updateDetThrottle(); });
  worldReady = true;
  setWorldBackground((els.worldBg && els.worldBg.value) || localStorage.getItem("aruco.worldbg") || "auto");
}
function makeCameraGizmo() {
  const g = new THREE.Group();
  g.add(new THREE.AxesHelper(80));
  const D = 160, hw = D * Math.tan(HFOV_DEG * Math.PI / 360), hh = hw * 0.6;
  const c = [[hw, hh, -D], [-hw, hh, -D], [-hw, -hh, -D], [hw, -hh, -D]];
  const pts = [];
  c.forEach((p) => { pts.push(0, 0, 0, p[0], p[1], p[2]); });
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; pts.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x16d0ff })));
  const body = new THREE.Mesh(new THREE.BoxGeometry(40, 28, 18), new THREE.MeshBasicMaterial({ color: 0x16d0ff, transparent: true, opacity: 0.25 }));
  body.position.z = 12; g.add(body);
  return g;
}
function makeWorldMarker(s, color) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false;
  g.add(new THREE.AxesHelper(s * 0.9));
  const geo = new THREE.PlaneGeometry(s, s);
  const plate = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  g.add(plate);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
  g.add(edges);
  const label = makeTextSprite(""); label.position.set(0, s * 0.62, 0); label.userData.isLabel = true; g.add(label);
  return g;
}
function rebuildWorldPool() { if (worldReady) { worldPool.forEach((o) => worldScene.remove(o)); worldPool = []; } }
function resizeWorld() {
  if (!worldReady || !els.worldToggle.checked || (els.worldPanel && els.worldPanel.hidden)) return;
  const wrap = els.worldCanvas.parentElement;
  if (!wrap || !wrap.clientWidth) return;
  const w = wrap.clientWidth || 600, h = wrap.clientHeight || 360;
  worldRenderer.setSize(w, h, false); worldCam.aspect = w / h; worldCam.updateProjectionMatrix();
  renderWorldStatic();
}
function renderWorldStatic() { if (worldReady) { if (deviceFollow) applyDeviceCamera(); else worldControls.update(); worldRenderer.render(worldScene, worldCam); } }
// カメラの高さ・距離スライダーを反映（現在の方位角は維持）
function applyWorldCam() {
  if (!worldReady || deviceFollow) return;
  const T = worldControls.target;
  const dx = worldCam.position.x - T.x, dz = worldCam.position.z - T.z;
  let az = Math.atan2(dx, dz); if (!isFinite(az)) az = 0.7;
  const dist = parseFloat(els.worldCamDist.value) || 520, hgt = parseFloat(els.worldCamHeight.value) || 260;
  const horiz = Math.sqrt(Math.max(1, dist * dist - hgt * hgt));
  worldCam.position.set(T.x + horiz * Math.sin(az), T.y + hgt, T.z + horiz * Math.cos(az));
  worldCam.lookAt(T); worldControls.update(); renderWorldStatic();
}
function resetWorldCam() {
  if (!worldReady) return;
  if (deviceFollow) stopDeviceFollow();
  worldControls.target.set(0, 0, -250);
  if (els.worldCamHeight) els.worldCamHeight.value = 260;
  if (els.worldCamDist) els.worldCamDist.value = 520;
  const T = worldControls.target; worldCam.position.set(T.x + 300, T.y + 260, T.z + 300);
  worldCam.lookAt(T); worldControls.update(); renderWorldStatic();
}
// デバイス姿勢センサー対応チェック（対応時のみ追従ボタンを表示）
let deviceOrientSupported = false;
function updateDeviceBtnVisibility() { if (els.worldDeviceBtn) els.worldDeviceBtn.hidden = !deviceOrientSupported; }
function probeDeviceOrient() {
  if (!("DeviceOrientationEvent" in window)) { deviceOrientSupported = false; updateDeviceBtnVisibility(); return; }
  if (typeof DeviceOrientationEvent.requestPermission === "function") { deviceOrientSupported = true; updateDeviceBtnVisibility(); return; } // iOS（許可制）
  const onceHandler = (e) => { if (e && e.alpha != null) { deviceOrientSupported = true; updateDeviceBtnVisibility(); window.removeEventListener("deviceorientation", onceHandler); } };
  window.addEventListener("deviceorientation", onceHandler);
  setTimeout(() => { window.removeEventListener("deviceorientation", onceHandler); updateDeviceBtnVisibility(); }, 1500);
}
function seedColor(seed) { const h = (seed * 47) % 360; const c = new THREE.Color(); c.setHSL(h / 360, 0.7, 0.55); return c; }
function renderWorld(results, poses) {
  if (!worldReady) { initWorld(); resizeWorld(); }
  if (!worldReady) return;
  const s = Math.max(1, parseFloat(els.markerLen.value) || 50);
  let used = 0;
  for (let i = 0; i < results.length; i++) {
    const pose = poses && poses[i]; if (!pose) continue;
    let obj = worldPool[used];
    if (!obj) { obj = makeWorldMarker(s, 0xffffff); worldScene.add(obj); worldPool[used] = obj; }
    const col = seedColor(results[i].seed);
    obj.children.forEach((ch) => { if (ch.userData && ch.userData.isLabel) setSpriteText(ch, `${results[i].idText.slice(0, 8)} · ${(pose.dist / 10).toFixed(0)}cm`); else if (ch.material && ch.material.color) ch.material.color.copy(col); });
    poseMatrix(obj, pose); obj.visible = true; used++;
  }
  for (let i = used; i < worldPool.length; i++) worldPool[i].visible = false;
  renderModels(worldScene, results, poses, "worldObj");
  if (deviceFollow) applyDeviceCamera(); else worldControls.update();
  worldRenderer.render(worldScene, worldCam);
}

/* ---------- ラベル（スプライト：常にカメラ正対・座布団は文字ギリギリ） ---------- */
function makeTextSprite(text, opts) {
  opts = opts || {};
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  sp.userData = { worldH: opts.worldH || 22, color: opts.color || "#ffffff", text: undefined };
  setSpriteText(sp, text || "");
  return sp;
}
function setSpriteText(sp, text) {
  if (sp.userData.text === text) return; sp.userData.text = text;
  if (!text) { sp.visible = false; return; }
  const ud = sp.userData, dpr = 3, fp = 44, padX = 5, padY = 3;
  const mc = document.createElement("canvas"), mx = mc.getContext("2d");
  mx.font = `bold ${fp}px sans-serif`;
  const tw = Math.ceil(mx.measureText(text).width);
  const w = tw + padX * 2, h = Math.ceil(fp * 1.04) + padY * 2;   // 文字ギリギリ（余白最小）
  const c = document.createElement("canvas"); c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext("2d"); x.scale(dpr, dpr);
  x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(0, 0, w, h);          // 控えめな座布団
  x.font = `bold ${fp}px sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillStyle = ud.color; x.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  if (sp.material.map) sp.material.map.dispose();
  sp.material.map = tex; sp.material.needsUpdate = true;
  sp.scale.set(ud.worldH * (w / h), ud.worldH, 1);                  // アスペクト維持（潰れない）
  sp.visible = true;
}
function axisLabel(text, x, y, z, color) {
  const sp = makeTextSprite(text, { worldH: 26, color: "#" + (color >>> 0).toString(16).padStart(6, "0").slice(-6) });
  sp.position.set(x, y, z);
  return sp;
}
function makeScaleBar(len) {
  const g = new THREE.Group(); const y = WORLD_GRID_Y + 2, z = 0;
  const pts = [0, y, z, len, y, z, 0, y - 8, z, 0, y + 8, z, len, y - 8, z, len, y + 8, z];
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffcc33 })));
  const sp = makeTextSprite(len + " mm", { worldH: 20, color: "#ffcc33" }); sp.position.set(len / 2, y + 18, z); g.add(sp);
  return g;
}

/* ============================================================ デバイス姿勢追従 */
let deviceFollow = false, deviceQuat = null, screenOrient = 0;
const _zee = new THREE.Vector3(0, 0, 1), _euler = new THREE.Euler(), _q0 = new THREE.Quaternion(),
  _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function onWorldDeviceToggle() {
  if (deviceFollow) { stopDeviceFollow(); return; }
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    D.requestPermission().then((p) => { if (p === "granted") startDeviceFollow(); else logMsg("warn", t("msg.deviceDenied")); }).catch(() => logMsg("warn", t("msg.deviceDenied")));
  } else startDeviceFollow();
}
function startDeviceFollow() {
  deviceFollow = true; updateDetThrottle();
  els.worldDeviceBtn.classList.add("on"); els.worldDeviceBtn.textContent = t("scan.followingDevice");
  if (worldControls) worldControls.enabled = false;
  screenOrient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  window.__gotDO = false;
  window.addEventListener("deviceorientation", onDeviceOrientation, true);
  setTimeout(() => { if (deviceFollow && !window.__gotDO) logMsg("warn", t("msg.noDeviceOrientation")); }, 1500);
}
function stopDeviceFollow() {
  deviceFollow = false; updateDetThrottle();
  els.worldDeviceBtn.classList.remove("on"); els.worldDeviceBtn.textContent = t("scan.followDevice");
  window.removeEventListener("deviceorientation", onDeviceOrientation, true);
  if (worldControls) worldControls.enabled = true;
}
let lastDOt = 0;
function onDeviceOrientation(e) {
  if (e.alpha == null) return; window.__gotDO = true;
  const now = performance.now(); if (now - lastDOt < SLOW_HZ_MS) return; lastDOt = now; // 姿勢サンプリングも ~10Hz
  const a = e.alpha * Math.PI / 180, b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180, o = screenOrient * Math.PI / 180;
  if (!deviceQuat) deviceQuat = new THREE.Quaternion();
  _euler.set(b, a, -g, "YXZ");
  deviceQuat.setFromEuler(_euler);
  deviceQuat.multiply(_q1);
  deviceQuat.multiply(_q0.setFromAxisAngle(_zee, -o));
  if (!scanning) renderWorldStatic();
}
function applyDeviceCamera() {
  if (!worldReady || !deviceQuat) return;
  const r = worldCam.position.distanceTo(worldControls.target) || 500;
  worldCam.quaternion.copy(deviceQuat);
  const back = _zee.clone().applyQuaternion(deviceQuat);
  worldCam.position.copy(worldControls.target).addScaledVector(back, r);
}
