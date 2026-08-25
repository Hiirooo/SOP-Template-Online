(() => {
  "use strict";

  const STORAGE_KEY = "sop-studio-document-v2";
  const MAX_HISTORY = 60;
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 1.5;
  const SNAP_SIZE = 8;

  const refs = {
    viewport: document.getElementById("viewport"),
    canvasStage: document.getElementById("canvasStage"),
    zoomLayer: document.getElementById("zoomLayer"),
    paper: document.getElementById("paper"),
    workspace: document.getElementById("workspace"),
    nodeLayer: document.getElementById("nodeLayer"),
    edgeLayer: document.getElementById("edgeLayer"),
    edges: document.getElementById("edges"),
    edgeHandles: document.getElementById("edgeHandles"),
    toast: document.getElementById("toast"),
    statusText: document.getElementById("statusText"),
    saveIndicator: document.getElementById("saveIndicator"),
    saveLabel: document.getElementById("saveLabel"),
    documentName: document.getElementById("documentName"),
    zoomValue: document.getElementById("zoomValue"),
    selectionBadge: document.getElementById("selectionBadge"),
    exportMenu: document.getElementById("exportMenu"),
    projectFile: document.getElementById("projectFile"),
    exportOverlay: document.getElementById("exportOverlay"),
    exportStatus: document.getElementById("exportStatus"),
    propText: document.getElementById("propText"),
    propStroke: document.getElementById("propStroke"),
    propFill: document.getElementById("propFill"),
    propFontSize: document.getElementById("propFontSize"),
    propWeight: document.getElementById("propWeight"),
    edgeLabel: document.getElementById("edgeLabel"),
    edgeStroke: document.getElementById("edgeStroke"),
    edgeStyle: document.getElementById("edgeStyle")
  };

  const state = {
    nodes: [],
    edges: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    connectMode: false,
    connectSourceId: null,
    zoom: 0.75,
    snap: true,
    grid: true,
    history: [],
    future: [],
    dragging: null,
    resizing: null,
    movingEdge: null,
    panning: null,
    spacePressed: false,
    activeRow: null,
    activeCell: null,
    toastTimer: null,
    saveTimer: null,
    resizeFrame: null
  };

  const boundEditables = new WeakSet();
  const boundTables = new WeakSet();
  let exampleSnapshot = null;

  function uid(prefix) {
    const value = window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapValue(value) {
    return state.snap ? Math.round(value / SNAP_SIZE) * SNAP_SIZE : value;
  }

  function table() {
    return document.getElementById("sopTable");
  }

  function tbody() {
    return document.getElementById("sopBody");
  }

  function actorCount() {
    return document.querySelectorAll("#detailHeaderRow .actor-header").length;
  }

  function cleanElementHTML(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(".active-row, .active-cell, .drag-over").forEach(el => {
      el.classList.remove("active-row", "active-cell", "drag-over");
    });
    clone.querySelectorAll("[contenteditable]").forEach(el => {
      el.removeAttribute("data-before-edit");
    });
    return clone.innerHTML;
  }

  function cleanOuterHTML(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(".active-row, .active-cell, .drag-over").forEach(el => {
      el.classList.remove("active-row", "active-cell", "drag-over");
    });
    return clone.outerHTML;
  }

  function captureSnapshot() {
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      documentName: refs.documentName.value.trim() || "Dokumen SOP",
      nodes: deepCopy(state.nodes),
      edges: deepCopy(state.edges),
      paperHeaderHTML: cleanElementHTML(document.querySelector(".paper-header")),
      metaHTML: cleanElementHTML(document.getElementById("documentMeta")),
      tableHTML: cleanOuterHTML(table()),
      noteHTML: cleanElementHTML(document.querySelector(".paper-note")),
      view: {
        zoom: state.zoom,
        snap: state.snap,
        grid: state.grid
      }
    };
  }

  function sanitizeHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    template.content.querySelectorAll("script, iframe, object, embed, link, style, meta, base").forEach(el => el.remove());
    template.content.querySelectorAll("*").forEach(el => {
      [...el.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith("on") || name === "srcdoc" || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
          el.removeAttribute(attribute.name);
        }
      });
    });
    return template.innerHTML;
  }

  function normalizeNode(node, index) {
    const allowed = new Set(["start", "process", "decision", "document", "text"]);
    const type = allowed.has(node?.type) ? node.type : "process";
    const defaults = nodeDefaults(type);
    return {
      id: typeof node?.id === "string" ? node.id : uid("node"),
      type,
      x: Number.isFinite(Number(node?.x)) ? Math.max(0, Number(node.x)) : 80 + index * 20,
      y: Number.isFinite(Number(node?.y)) ? Math.max(0, Number(node.y)) : 80 + index * 20,
      w: clamp(Number(node?.w) || defaults.w, 70, 420),
      h: clamp(Number(node?.h) || defaults.h, 38, 280),
      text: String(node?.text ?? defaults.text).slice(0, 500),
      stroke: validColor(node?.stroke) ? node.stroke : defaults.stroke,
      fill: validColor(node?.fill) || node?.fill === "transparent" ? node.fill : defaults.fill,
      fontSize: clamp(Number(node?.fontSize) || 14, 9, 36),
      fontWeight: [400, 500, 600, 700].includes(Number(node?.fontWeight)) ? Number(node.fontWeight) : 600,
      z: Number.isFinite(Number(node?.z)) ? Number(node.z) : index + 1
    };
  }

  function normalizeEdges(edges, nodes) {
    const ids = new Set(nodes.map(node => node.id));
    return (Array.isArray(edges) ? edges : [])
      .filter(edge => ids.has(edge?.source) && ids.has(edge?.target) && edge.source !== edge.target)
      .map(edge => ({
        id: typeof edge.id === "string" ? edge.id : uid("edge"),
        source: edge.source,
        target: edge.target,
        bendX: Number.isFinite(Number(edge.bendX)) ? Number(edge.bendX) : null,
        label: String(edge.label || "").slice(0, 120),
        stroke: validColor(edge.stroke) ? edge.stroke : "#163b65",
        style: edge.style === "dashed" ? "dashed" : "solid"
      }));
  }

  function validColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""));
  }

  function restoreSnapshot(snapshot, options = {}) {
    if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges) || !snapshot.tableHTML) {
      throw new Error("Format dokumen tidak valid.");
    }

    const nodes = snapshot.nodes.map(normalizeNode);
    const edges = normalizeEdges(snapshot.edges, nodes);

    state.nodes = nodes;
    state.edges = edges;
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    state.connectMode = false;
    state.connectSourceId = null;
    state.activeRow = null;
    state.activeCell = null;

    if (snapshot.paperHeaderHTML) {
      document.querySelector(".paper-header").innerHTML = sanitizeHTML(snapshot.paperHeaderHTML);
    }
    if (snapshot.metaHTML) {
      document.getElementById("documentMeta").innerHTML = sanitizeHTML(snapshot.metaHTML);
    }

    const safeTable = sanitizeHTML(snapshot.tableHTML);
    const holder = document.createElement("div");
    holder.innerHTML = safeTable;
    const importedTable = holder.querySelector("table#sopTable");
    if (!importedTable || !importedTable.querySelector("tbody")) {
      throw new Error("Struktur tabel SOP tidak ditemukan.");
    }
    table().replaceWith(importedTable);
    importedTable.querySelector("tbody").id = "sopBody";

    if (snapshot.noteHTML) {
      document.querySelector(".paper-note").innerHTML = sanitizeHTML(snapshot.noteHTML);
    }

    refs.documentName.value = String(snapshot.documentName || "Dokumen SOP").slice(0, 120);
    state.snap = snapshot.view?.snap !== false;
    state.grid = snapshot.view?.grid !== false;

    bindEditablePersistence();
    bindTableInteractions();
    renumberRows();
    renderAll();
    setZoom(Number(snapshot.view?.zoom) || state.zoom, false);
    syncModeButtons();

    if (!options.keepHistory) {
      state.history = [];
      state.future = [];
    }
  }

  function pushPastSnapshot(snapshot) {
    state.history.push(snapshot);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
  }

  function checkpoint() {
    pushPastSnapshot(captureSnapshot());
  }

  function undo() {
    if (!state.history.length) {
      flash("Tidak ada perubahan yang dapat diurungkan.");
      return;
    }
    const current = captureSnapshot();
    const previous = state.history.pop();
    state.future.push(current);
    restoreSnapshot(previous, { keepHistory: true });
    markDirty();
    setStatus("Perubahan terakhir diurungkan");
  }

  function redo() {
    if (!state.future.length) {
      flash("Tidak ada perubahan yang dapat diulangi.");
      return;
    }
    const current = captureSnapshot();
    const next = state.future.pop();
    state.history.push(current);
    restoreSnapshot(next, { keepHistory: true });
    markDirty();
    setStatus("Perubahan diterapkan kembali");
  }

  function setStatus(message) {
    refs.statusText.textContent = message;
  }

  function flash(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => refs.toast.classList.remove("show"), 2600);
  }

  function markDirty() {
    refs.saveIndicator.classList.add("pending");
    refs.saveLabel.textContent = "Menyimpan…";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveLocal(false), 500);
  }

  function saveLocal(showMessage = true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(captureSnapshot()));
      refs.saveIndicator.classList.remove("pending");
      refs.saveLabel.textContent = "Tersimpan otomatis";
      if (showMessage) flash("Dokumen tersimpan di browser ini.");
    } catch (error) {
      console.error(error);
      refs.saveLabel.textContent = "Gagal menyimpan";
      flash("Penyimpanan browser penuh atau tidak tersedia.");
    }
  }

  function loadSavedDocument() {
    let raw = localStorage.getItem(STORAGE_KEY);
    let legacy = false;
    if (!raw) {
      raw = localStorage.getItem("sop-flowchart-editor");
      legacy = Boolean(raw);
    }
    if (!raw) return false;
    try {
      let data = JSON.parse(raw);
      if (legacy) {
        const migrated = captureSnapshot();
        migrated.nodes = Array.isArray(data.nodes) ? data.nodes : [];
        migrated.edges = Array.isArray(data.edges) ? data.edges : [];
        migrated.tableHTML = data.tableHTML || migrated.tableHTML;
        migrated.noteHTML = data.noteHTML || migrated.noteHTML;
        if (data.titleHTML) {
          const header = document.querySelector(".paper-header").cloneNode(true);
          header.querySelector(".paper-title").innerHTML = sanitizeHTML(data.titleHTML);
          migrated.paperHeaderHTML = header.innerHTML;
        }
        data = migrated;
      }
      restoreSnapshot(data);
      refs.saveIndicator.classList.remove("pending");
      refs.saveLabel.textContent = "Tersimpan otomatis";
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(captureSnapshot()));
        flash("Dokumen dari editor lama berhasil dimigrasikan.");
      }
      return true;
    } catch (error) {
      console.error(error);
      localStorage.removeItem(STORAGE_KEY);
      flash("Simpanan lama tidak dapat dibaca; template contoh dimuat.");
      return false;
    }
  }

  function nodeDefaults(type) {
    const presets = {
      start: { w: 150, h: 58, text: "Mulai / Selesai", stroke: "#1d4ed8", fill: "#ffffff" },
      process: { w: 150, h: 64, text: "Proses", stroke: "#15803d", fill: "#ffffff" },
      decision: { w: 118, h: 118, text: "Keputusan?", stroke: "#dc2626", fill: "#ffffff" },
      document: { w: 158, h: 72, text: "Dokumen", stroke: "#b45309", fill: "#fffbeb" },
      text: { w: 170, h: 48, text: "Teks keterangan", stroke: "#163b65", fill: "transparent" }
    };
    return presets[type] || presets.process;
  }

  function getWorkspacePoint(clientX, clientY) {
    const rect = refs.workspace.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / state.zoom,
      y: (clientY - rect.top) / state.zoom
    };
  }

  function cellCenter(cell) {
    const cellRect = cell.getBoundingClientRect();
    const workspaceRect = refs.workspace.getBoundingClientRect();
    return {
      x: (cellRect.left - workspaceRect.left + cellRect.width / 2) / state.zoom,
      y: (cellRect.top - workspaceRect.top + cellRect.height / 2) / state.zoom
    };
  }

  function visibleCanvasCenter() {
    const viewportRect = refs.viewport.getBoundingClientRect();
    const workspaceRect = refs.workspace.getBoundingClientRect();
    return {
      x: (viewportRect.left + viewportRect.width / 2 - workspaceRect.left) / state.zoom,
      y: (viewportRect.top + viewportRect.height / 2 - workspaceRect.top) / state.zoom
    };
  }

  function addNode(type, requestedPoint = null) {
    const defaults = nodeDefaults(type);
    const point = requestedPoint || (state.activeCell ? cellCenter(state.activeCell) : visibleCanvasCenter());
    const highestZ = Math.max(0, ...state.nodes.map(node => node.z || 0));

    checkpoint();
    const node = normalizeNode({
      id: uid("node"),
      type,
      x: snapValue(Math.max(12, point.x - defaults.w / 2)),
      y: snapValue(Math.max(12, point.y - defaults.h / 2)),
      w: defaults.w,
      h: defaults.h,
      text: defaults.text,
      stroke: defaults.stroke,
      fill: defaults.fill,
      fontSize: type === "decision" ? 13 : 14,
      fontWeight: 600,
      z: highestZ + 1
    }, state.nodes.length);
    state.nodes.push(node);
    selectNode(node.id);
    markDirty();
    setStatus(`${labelForType(type)} ditambahkan`);
  }

  function labelForType(type) {
    return ({ start: "Mulai / Selesai", process: "Proses", decision: "Keputusan", document: "Dokumen", text: "Teks" })[type] || "Objek";
  }

  function renderNodes() {
    refs.nodeLayer.innerHTML = "";
    [...state.nodes].sort((a, b) => (a.z || 0) - (b.z || 0)).forEach(node => {
      const element = document.createElement("div");
      element.className = `flow-node ${node.type}`;
      if (state.selectedNodeId === node.id) element.classList.add("selected");
      if (state.connectSourceId === node.id) element.classList.add("connect-source");
      element.dataset.id = node.id;
      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;
      element.style.width = `${node.w}px`;
      element.style.height = `${node.h}px`;
      element.style.zIndex = String(node.z || 1);
      element.style.setProperty("--node-stroke", node.stroke);
      element.style.setProperty("--node-fill", node.fill);
      element.style.setProperty("--node-font-size", `${node.fontSize}px`);
      element.style.setProperty("--node-font-weight", String(node.fontWeight));

      const shell = document.createElement("div");
      shell.className = "node-shell";
      const label = document.createElement("div");
      label.className = "node-label";
      label.textContent = node.text;
      shell.appendChild(label);

      const resize = document.createElement("span");
      resize.className = "resize-handle";
      resize.dataset.html2canvasIgnore = "true";
      resize.addEventListener("pointerdown", onResizePointerDown);

      element.append(shell, resize);
      element.addEventListener("pointerdown", onNodePointerDown);
      element.addEventListener("dblclick", beginInlineEdit);
      refs.nodeLayer.appendChild(element);
    });
  }

  function beginInlineEdit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (state.connectMode) return;

    const element = event.currentTarget;
    const node = state.nodes.find(item => item.id === element.dataset.id);
    const label = element.querySelector(".node-label");
    if (!node || !label) return;

    const before = captureSnapshot();
    element.classList.add("inline-editing");
    label.contentEditable = "true";
    label.spellcheck = false;
    label.focus();

    const range = document.createRange();
    range.selectNodeContents(label);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    let finished = false;
    function finish(commit) {
      if (finished) return;
      finished = true;
      const next = label.innerText.trim();
      label.contentEditable = "false";
      element.classList.remove("inline-editing");
      if (commit && next !== node.text) {
        pushPastSnapshot(before);
        node.text = next || "Tanpa teks";
        markDirty();
      }
      renderAll();
    }

    label.addEventListener("keydown", ev => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        label.textContent = node.text;
        finish(false);
      }
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
      }
    });
    label.addEventListener("blur", () => finish(true), { once: true });
  }

  function nodeCenter(node) {
    return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  }

  function boundaryPoint(node, toward) {
    const center = nodeCenter(node);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    if (!dx && !dy) return center;

    if (node.type === "start") {
      const rx = node.w / 2;
      const ry = node.h / 2;
      const factor = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
      return { x: center.x + dx * factor, y: center.y + dy * factor };
    }

    if (node.type === "decision") {
      const rx = node.w / 2;
      const ry = node.h / 2;
      const denominator = Math.abs(dx) / rx + Math.abs(dy) / ry || 1;
      return { x: center.x + dx / denominator, y: center.y + dy / denominator };
    }

    const horizontal = dx === 0 ? Infinity : (node.w / 2) / Math.abs(dx);
    const vertical = dy === 0 ? Infinity : (node.h / 2) / Math.abs(dy);
    const scale = Math.min(horizontal, vertical);
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }

  function edgeGeometry(edge) {
    const source = state.nodes.find(node => node.id === edge.source);
    const target = state.nodes.find(node => node.id === edge.target);
    if (!source || !target) return null;

    const sourceCenter = nodeCenter(source);
    const targetCenter = nodeCenter(target);
    const start = boundaryPoint(source, targetCenter);
    const end = boundaryPoint(target, sourceCenter);
    let bendX = Number.isFinite(Number(edge.bendX)) ? Number(edge.bendX) : (start.x + end.x) / 2;
    if (Math.abs(start.x - end.x) < 18 && !Number.isFinite(Number(edge.bendX))) {
      bendX = start.x + 42;
    }

    return {
      start,
      end,
      bendX,
      points: [[start.x, start.y], [bendX, start.y], [bendX, end.y], [end.x, end.y]]
    };
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function renderEdges() {
    refs.edges.innerHTML = "";
    refs.edgeHandles.innerHTML = "";

    state.edges.forEach(edge => {
      const geometry = edgeGeometry(edge);
      if (!geometry) return;
      const points = geometry.points.map(point => point.join(",")).join(" ");
      const group = svgElement("g", { "data-id": edge.id });
      const hit = svgElement("polyline", { points, class: "edge-hit" });
      hit.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();
        selectEdge(edge.id);
      });

      const classes = ["edge-path", edge.style === "dashed" ? "dashed" : ""];
      if (state.selectedEdgeId === edge.id) classes.push("selected");
      const path = svgElement("polyline", {
        points,
        class: classes.filter(Boolean).join(" "),
        stroke: edge.stroke || "#163b65"
      });

      group.append(hit, path);
      if (edge.label) {
        const sameLevel = Math.abs(geometry.start.y - geometry.end.y) < 12;
        const label = svgElement("text", {
          class: "edge-label",
          x: geometry.bendX + 7,
          y: sameLevel ? geometry.start.y - 8 : (geometry.start.y + geometry.end.y) / 2 - 7
        });
        label.textContent = edge.label;
        group.appendChild(label);
      }
      refs.edges.appendChild(group);

      if (state.selectedEdgeId === edge.id) {
        const handle = svgElement("g", { class: "edge-handle", "data-id": edge.id });
        const cy = (geometry.start.y + geometry.end.y) / 2;
        handle.appendChild(svgElement("circle", { cx: geometry.bendX, cy, r: 7 }));
        handle.addEventListener("pointerdown", onEdgeHandlePointerDown);
        refs.edgeHandles.appendChild(handle);
      }
    });
  }

  function renderAll() {
    updateWorkspaceSize();
    renderEdges();
    renderNodes();
    syncInspector();
    syncModeButtons();
    syncSummary();
    requestAnimationFrame(() => {
      updateWorkspaceSize();
      syncStageSize();
    });
  }

  function updateWorkspaceSize() {
    cancelAnimationFrame(state.resizeFrame);
    state.resizeFrame = requestAnimationFrame(() => {
      const currentTable = table();
      const furthestNode = state.nodes.reduce((max, node) => Math.max(max, node.y + node.h + 48), 0);
      const width = Math.max(currentTable.scrollWidth, state.nodes.reduce((max, node) => Math.max(max, node.x + node.w + 48), 0));
      const height = Math.max(680, currentTable.scrollHeight, furthestNode);
      refs.workspace.style.width = `${width}px`;
      refs.workspace.style.height = `${height}px`;
      refs.edgeLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
      refs.edgeLayer.setAttribute("width", String(width));
      refs.edgeLayer.setAttribute("height", String(height));
    });
  }

  function syncStageSize() {
    const width = refs.paper.scrollWidth * state.zoom + 76;
    const height = refs.paper.scrollHeight * state.zoom + 76;
    refs.canvasStage.style.width = `${Math.max(refs.viewport.clientWidth, width)}px`;
    refs.canvasStage.style.height = `${Math.max(refs.viewport.clientHeight, height)}px`;
  }

  function setZoom(value, mark = true) {
    state.zoom = clamp(Number(value) || 1, MIN_ZOOM, MAX_ZOOM);
    refs.zoomLayer.style.transform = `scale(${state.zoom})`;
    refs.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    syncStageSize();
    if (mark) markDirty();
  }

  function fitZoom() {
    const availableWidth = Math.max(300, refs.viewport.clientWidth - 84);
    const availableHeight = Math.max(260, refs.viewport.clientHeight - 84);
    const fit = Math.min(1, availableWidth / refs.paper.scrollWidth, availableHeight / refs.paper.scrollHeight);
    setZoom(fit);
    refs.viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }

  function selectNode(id) {
    state.selectedNodeId = id;
    state.selectedEdgeId = null;
    renderAll();
  }

  function selectEdge(id) {
    state.selectedEdgeId = id;
    state.selectedNodeId = null;
    renderAll();
  }

  function clearSelection() {
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    state.connectSourceId = null;
    renderAll();
  }

  function onNodePointerDown(event) {
    if (event.button !== 0 || event.target.closest(".resize-handle") || event.target.isContentEditable) return;
    event.preventDefault();
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    const node = state.nodes.find(item => item.id === id);
    if (!node) return;

    if (state.connectMode) {
      handleConnectionClick(id);
      return;
    }

    state.selectedNodeId = id;
    state.selectedEdgeId = null;
    const point = getWorkspacePoint(event.clientX, event.clientY);
    state.dragging = {
      id,
      startX: point.x,
      startY: point.y,
      originX: node.x,
      originY: node.y,
      before: captureSnapshot(),
      moved: false
    };
    renderAll();
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onResizePointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const holder = event.currentTarget.closest(".flow-node");
    const node = state.nodes.find(item => item.id === holder?.dataset.id);
    if (!node) return;
    const point = getWorkspacePoint(event.clientX, event.clientY);
    state.resizing = {
      id: node.id,
      startX: point.x,
      startY: point.y,
      originW: node.w,
      originH: node.h,
      before: captureSnapshot(),
      moved: false
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onEdgeHandlePointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    selectEdge(id);
    state.movingEdge = { id, before: captureSnapshot(), moved: false };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onPointerMove(event) {
    const point = getWorkspacePoint(event.clientX, event.clientY);

    if (state.dragging) {
      const node = state.nodes.find(item => item.id === state.dragging.id);
      if (!node) return;
      const maxX = Math.max(0, refs.workspace.clientWidth - node.w);
      node.x = clamp(snapValue(state.dragging.originX + point.x - state.dragging.startX), 0, maxX);
      node.y = Math.max(0, snapValue(state.dragging.originY + point.y - state.dragging.startY));
      state.dragging.moved = true;
      renderNodes();
      renderEdges();
      updateWorkspaceSize();
      return;
    }

    if (state.resizing) {
      const node = state.nodes.find(item => item.id === state.resizing.id);
      if (!node) return;
      node.w = clamp(snapValue(state.resizing.originW + point.x - state.resizing.startX), 70, 420);
      node.h = clamp(snapValue(state.resizing.originH + point.y - state.resizing.startY), 38, 280);
      state.resizing.moved = true;
      renderNodes();
      renderEdges();
      updateWorkspaceSize();
      return;
    }

    if (state.movingEdge) {
      const edge = state.edges.find(item => item.id === state.movingEdge.id);
      if (!edge) return;
      edge.bendX = snapValue(point.x);
      state.movingEdge.moved = true;
      renderEdges();
    }
  }

  function onPointerUp() {
    const operation = state.dragging || state.resizing || state.movingEdge;
    if (operation?.moved) {
      pushPastSnapshot(operation.before);
      markDirty();
      setStatus("Posisi diagram diperbarui");
    }
    state.dragging = null;
    state.resizing = null;
    state.movingEdge = null;
    document.removeEventListener("pointermove", onPointerMove);
    renderAll();
  }

  function handleConnectionClick(id) {
    if (!state.connectSourceId) {
      state.connectSourceId = id;
      state.selectedNodeId = id;
      setStatus("Pilih objek tujuan konektor");
      renderAll();
      return;
    }

    if (state.connectSourceId === id) {
      state.connectSourceId = null;
      setStatus("Pilih objek awal konektor");
      renderAll();
      return;
    }

    checkpoint();
    const source = state.nodes.find(node => node.id === state.connectSourceId);
    const target = state.nodes.find(node => node.id === id);
    const sourceCenter = nodeCenter(source);
    const targetCenter = nodeCenter(target);
    const edge = {
      id: uid("edge"),
      source: source.id,
      target: target.id,
      bendX: snapValue((sourceCenter.x + targetCenter.x) / 2),
      label: "",
      stroke: "#163b65",
      style: "solid"
    };
    state.edges.push(edge);
    state.selectedEdgeId = edge.id;
    state.selectedNodeId = null;
    state.connectSourceId = null;
    state.connectMode = false;
    markDirty();
    setStatus("Konektor berhasil dibuat");
    flash("Konektor dibuat. Klik garis untuk menambahkan label atau mengubah jalurnya.");
    renderAll();
  }

  function toggleConnect(force) {
    state.connectMode = typeof force === "boolean" ? force : !state.connectMode;
    state.connectSourceId = null;
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    setStatus(state.connectMode ? "Mode konektor aktif — pilih objek awal" : "Mode pilih aktif");
    syncModeButtons();
    renderAll();
  }

  function syncModeButtons() {
    const connectButtons = [document.getElementById("btnConnect"), document.getElementById("btnConnectPalette")];
    connectButtons.forEach(button => button?.classList.toggle("active", state.connectMode));
    document.getElementById("btnSelectMode").classList.toggle("active", !state.connectMode);
    document.getElementById("btnGrid").setAttribute("aria-pressed", String(state.grid));
    document.getElementById("btnSnap").setAttribute("aria-pressed", String(state.snap));
    refs.canvasStage.classList.toggle("grid-off", !state.grid);
  }

  function deleteSelected() {
    if (!state.selectedNodeId && !state.selectedEdgeId) {
      flash("Pilih objek atau konektor yang ingin dihapus.");
      return;
    }
    checkpoint();
    if (state.selectedNodeId) {
      const id = state.selectedNodeId;
      state.nodes = state.nodes.filter(node => node.id !== id);
      state.edges = state.edges.filter(edge => edge.source !== id && edge.target !== id);
    } else {
      state.edges = state.edges.filter(edge => edge.id !== state.selectedEdgeId);
    }
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    markDirty();
    renderAll();
    flash("Pilihan dihapus.");
  }

  function duplicateSelected() {
    const node = state.nodes.find(item => item.id === state.selectedNodeId);
    if (!node) {
      flash("Pilih objek yang ingin diduplikat.");
      return;
    }
    checkpoint();
    const highestZ = Math.max(0, ...state.nodes.map(item => item.z || 0));
    const copy = { ...deepCopy(node), id: uid("node"), x: node.x + 24, y: node.y + 24, z: highestZ + 1 };
    state.nodes.push(copy);
    state.selectedNodeId = copy.id;
    markDirty();
    renderAll();
    flash("Objek diduplikat.");
  }

  function changeLayer(direction) {
    const node = state.nodes.find(item => item.id === state.selectedNodeId);
    if (!node) return;
    checkpoint();
    if (direction === "front") {
      node.z = Math.max(0, ...state.nodes.map(item => item.z || 0)) + 1;
    } else {
      node.z = Math.min(0, ...state.nodes.map(item => item.z || 0)) - 1;
    }
    markDirty();
    renderAll();
  }

  function syncInspector() {
    const node = state.nodes.find(item => item.id === state.selectedNodeId);
    const edge = state.edges.find(item => item.id === state.selectedEdgeId);
    const nodeControls = [refs.propText, refs.propStroke, refs.propFill, refs.propFontSize, refs.propWeight, document.getElementById("btnApplyProps"), document.getElementById("btnBringFront"), document.getElementById("btnSendBack")];
    const edgeControls = [refs.edgeLabel, refs.edgeStroke, refs.edgeStyle, document.getElementById("btnApplyEdge")];

    nodeControls.forEach(control => { control.disabled = !node; });
    edgeControls.forEach(control => { control.disabled = !edge; });

    if (node) {
      refs.selectionBadge.textContent = labelForType(node.type);
      refs.selectionBadge.classList.add("active");
      refs.propText.value = node.text;
      refs.propStroke.value = validColor(node.stroke) ? node.stroke : "#163b65";
      refs.propFill.value = validColor(node.fill) ? node.fill : "#ffffff";
      refs.propFontSize.value = String(node.fontSize);
      refs.propWeight.value = String(node.fontWeight);
    } else if (edge) {
      refs.selectionBadge.textContent = "Konektor";
      refs.selectionBadge.classList.add("active");
      refs.edgeLabel.value = edge.label || "";
      refs.edgeStroke.value = validColor(edge.stroke) ? edge.stroke : "#163b65";
      refs.edgeStyle.value = edge.style || "solid";
    } else {
      refs.selectionBadge.textContent = "Tidak ada pilihan";
      refs.selectionBadge.classList.remove("active");
      refs.propText.value = "";
      refs.edgeLabel.value = "";
    }
  }

  function applyNodeProperties() {
    const node = state.nodes.find(item => item.id === state.selectedNodeId);
    if (!node) return;
    checkpoint();
    node.text = refs.propText.value.trim() || "Tanpa teks";
    node.stroke = refs.propStroke.value;
    node.fill = node.type === "text" ? "transparent" : refs.propFill.value;
    node.fontSize = clamp(Number(refs.propFontSize.value) || 14, 9, 36);
    node.fontWeight = Number(refs.propWeight.value) || 600;
    markDirty();
    renderAll();
    flash("Properti objek diperbarui.");
  }

  function applyEdgeProperties() {
    const edge = state.edges.find(item => item.id === state.selectedEdgeId);
    if (!edge) return;
    checkpoint();
    edge.label = refs.edgeLabel.value.trim();
    edge.stroke = refs.edgeStroke.value;
    edge.style = refs.edgeStyle.value === "dashed" ? "dashed" : "solid";
    markDirty();
    renderAll();
    flash("Properti konektor diperbarui.");
  }

  function syncSummary() {
    document.getElementById("summaryNodes").textContent = String(state.nodes.length);
    document.getElementById("summaryEdges").textContent = String(state.edges.length);
    document.getElementById("summaryRows").textContent = String(tbody().rows.length);
    document.getElementById("summaryActors").textContent = String(actorCount());
  }

  function makeRowHTML(number) {
    const actorCells = Array.from({ length: actorCount() }, () => '<td class="flow-cell"></td>').join("");
    return `
      <td class="row-number">${number}</td>
      <td class="editable-cell" contenteditable="true">Ketik uraian kegiatan…</td>
      ${actorCells}
      <td class="editable-cell" contenteditable="true">Kelengkapan</td>
      <td class="editable-cell" contenteditable="true">… menit</td>
      <td class="editable-cell" contenteditable="true">Output kegiatan</td>
      <td class="editable-cell" contenteditable="true">Keterangan</td>
    `;
  }

  function addRow() {
    checkpoint();
    const row = document.createElement("tr");
    row.innerHTML = makeRowHTML(tbody().rows.length + 1);
    tbody().appendChild(row);
    bindEditablePersistence();
    setActiveRow(row);
    markDirty();
    renderAll();
    flash("Baris kegiatan ditambahkan.");
  }

  function deleteActiveRow() {
    if (!state.activeRow || !state.activeRow.isConnected) {
      flash("Klik salah satu baris SOP terlebih dahulu.");
      return;
    }
    if (tbody().rows.length <= 1) {
      flash("Dokumen harus memiliki minimal satu baris kegiatan.");
      return;
    }
    checkpoint();
    state.activeRow.remove();
    state.activeRow = null;
    state.activeCell = null;
    renumberRows();
    markDirty();
    renderAll();
    flash("Baris aktif dihapus.");
  }

  function addActor() {
    const count = actorCount();
    if (count >= 8) {
      flash("Maksimal delapan kolom pelaksana.");
      return;
    }
    checkpoint();
    const colgroup = table().querySelector("colgroup");
    const newCol = document.createElement("col");
    newCol.dataset.actorCol = "";
    newCol.style.width = "150px";
    colgroup.insertBefore(newCol, colgroup.children[colgroup.children.length - 4]);

    const header = document.createElement("th");
    header.className = "actor-header";
    header.contentEditable = "true";
    header.spellcheck = false;
    header.textContent = `Pelaksana ${count + 1}`;
    const detailRow = document.getElementById("detailHeaderRow");
    detailRow.insertBefore(header, detailRow.children[detailRow.children.length - 3]);

    [...tbody().rows].forEach(row => {
      const cell = document.createElement("td");
      cell.className = "flow-cell";
      row.insertBefore(cell, row.children[row.children.length - 4]);
    });
    document.getElementById("actorGroupHeader").colSpan = count + 1;
    bindEditablePersistence();
    markDirty();
    renderAll();
    flash("Kolom pelaksana ditambahkan.");
  }

  function removeActor() {
    const count = actorCount();
    if (count <= 1) {
      flash("Tabel harus memiliki minimal satu pelaksana.");
      return;
    }
    checkpoint();
    const actorColumns = table().querySelectorAll("col[data-actor-col]");
    actorColumns[actorColumns.length - 1].remove();
    const actorHeaders = document.querySelectorAll("#detailHeaderRow .actor-header");
    actorHeaders[actorHeaders.length - 1].remove();
    [...tbody().rows].forEach(row => row.children[2 + count - 1].remove());
    document.getElementById("actorGroupHeader").colSpan = count - 1;
    state.activeCell = null;
    markDirty();
    renderAll();
    flash("Kolom pelaksana terakhir dihapus.");
  }

  function renumberRows() {
    [...tbody().rows].forEach((row, index) => {
      const numberCell = row.querySelector(".row-number");
      if (numberCell) numberCell.textContent = String(index + 1);
    });
  }

  function setActiveRow(row) {
    table().querySelectorAll("tbody tr.active-row").forEach(item => item.classList.remove("active-row"));
    state.activeRow = row || null;
    state.activeRow?.classList.add("active-row");
  }

  function setActiveCell(cell) {
    table().querySelectorAll(".flow-cell.active-cell").forEach(item => item.classList.remove("active-cell"));
    state.activeCell = cell || null;
    state.activeCell?.classList.add("active-cell");
    if (cell) setStatus("Sel pelaksana aktif — bentuk baru akan ditempatkan di sini");
  }

  function placeSelectedInCell() {
    const node = state.nodes.find(item => item.id === state.selectedNodeId);
    if (!node || !state.activeCell || !state.activeCell.isConnected) {
      flash("Pilih objek diagram dan satu sel pelaksana.");
      return;
    }
    checkpoint();
    const center = cellCenter(state.activeCell);
    node.x = snapValue(center.x - node.w / 2);
    node.y = snapValue(center.y - node.h / 2);
    markDirty();
    renderAll();
    flash("Objek diposisikan ke sel aktif.");
  }

  function imageFileToDataURL(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Pilih berkas gambar PNG, JPG, atau WebP."));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error("Ukuran logo maksimal 5 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Berkas logo tidak dapat dibaca."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Format gambar tidak didukung."));
        image.onload = () => {
          const maxSize = 420;
          const ratio = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
          const context = canvas.getContext("2d");
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadLogo(file) {
    if (!file) return;
    try {
      const dataURL = await imageFileToDataURL(file);
      checkpoint();
      const holder = document.querySelector(".logo-placeholder");
      holder.classList.add("has-image");
      holder.contentEditable = "false";
      holder.innerHTML = "";
      const image = document.createElement("img");
      image.src = dataURL;
      image.alt = "Logo instansi";
      holder.appendChild(image);
      markDirty();
      renderAll();
      flash("Logo berhasil ditambahkan.");
    } catch (error) {
      console.error(error);
      flash(error.message || "Logo gagal ditambahkan.");
    } finally {
      document.getElementById("logoFile").value = "";
    }
  }

  function removeLogo() {
    const holder = document.querySelector(".logo-placeholder");
    if (!holder.querySelector("img")) {
      flash("Belum ada logo yang diunggah.");
      return;
    }
    checkpoint();
    holder.classList.remove("has-image");
    holder.contentEditable = "true";
    holder.textContent = "LOGO";
    bindEditablePersistence();
    markDirty();
    renderAll();
  }

  function beginPan(event) {
    const eligible = event.button === 1 || (event.button === 0 && state.spacePressed);
    if (!eligible) return;
    event.preventDefault();
    state.panning = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: refs.viewport.scrollLeft,
      scrollTop: refs.viewport.scrollTop
    };
    refs.viewport.classList.add("panning");
    document.addEventListener("pointermove", movePan);
    document.addEventListener("pointerup", endPan, { once: true });
  }

  function movePan(event) {
    if (!state.panning) return;
    refs.viewport.scrollLeft = state.panning.scrollLeft - (event.clientX - state.panning.startX);
    refs.viewport.scrollTop = state.panning.scrollTop - (event.clientY - state.panning.startY);
  }

  function endPan() {
    state.panning = null;
    refs.viewport.classList.remove("panning");
    document.removeEventListener("pointermove", movePan);
  }

  function bindTableInteractions() {
    const currentTable = table();
    if (boundTables.has(currentTable)) return;
    boundTables.add(currentTable);

    currentTable.addEventListener("click", event => {
      const row = event.target.closest("tbody tr");
      if (row) setActiveRow(row);
      const cell = event.target.closest(".flow-cell");
      if (cell) setActiveCell(cell);
    });

    currentTable.addEventListener("dblclick", event => {
      const cell = event.target.closest(".flow-cell");
      if (!cell) return;
      setActiveCell(cell);
      addNode("process", cellCenter(cell));
    });

    currentTable.addEventListener("dragover", event => {
      if (!event.dataTransfer.types.includes("application/x-sop-node")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const cell = event.target.closest(".flow-cell");
      currentTable.querySelectorAll(".drag-over").forEach(item => item.classList.remove("drag-over"));
      cell?.classList.add("drag-over");
    });

    currentTable.addEventListener("dragleave", event => {
      event.target.closest(".flow-cell")?.classList.remove("drag-over");
    });

    currentTable.addEventListener("drop", event => {
      const type = event.dataTransfer.getData("application/x-sop-node");
      if (!type) return;
      event.preventDefault();
      currentTable.querySelectorAll(".drag-over").forEach(item => item.classList.remove("drag-over"));
      const cell = event.target.closest(".flow-cell");
      if (cell) {
        setActiveCell(cell);
        addNode(type, cellCenter(cell));
      } else {
        addNode(type, getWorkspacePoint(event.clientX, event.clientY));
      }
    });
  }

  function bindEditablePersistence() {
    refs.paper.querySelectorAll('[contenteditable="true"]').forEach(element => {
      if (boundEditables.has(element)) return;
      boundEditables.add(element);
      element.addEventListener("focus", () => {
        element.__beforeHTML = element.innerHTML;
        element.__beforeSnapshot = captureSnapshot();
      });
      element.addEventListener("input", () => {
        refs.saveIndicator.classList.add("pending");
        refs.saveLabel.textContent = "Perubahan belum disimpan";
      });
      element.addEventListener("blur", () => {
        if (element.__beforeHTML !== element.innerHTML) {
          pushPastSnapshot(element.__beforeSnapshot);
          markDirty();
          updateWorkspaceSize();
        }
      });
    });
  }

  function createBlankDocument() {
    if (!window.confirm("Buat dokumen baru? Anda masih dapat membatalkannya dengan Undo selama halaman ini tetap terbuka.")) return;
    checkpoint();
    state.nodes = [];
    state.edges = [];
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    refs.documentName.value = "SOP Baru";
    const logoHolder = document.querySelector(".logo-placeholder");
    logoHolder.classList.remove("has-image");
    logoHolder.contentEditable = "true";
    logoHolder.textContent = "LOGO";
    document.querySelector(".institution-copy").innerHTML = "<strong>NAMA INSTANSI / ORGANISASI</strong><span>Unit kerja atau bagian</span>";
    document.querySelector(".paper-title").innerHTML = "<h1>PROSEDUR OPERASIONAL STANDAR (SOP)</h1><h2>JUDUL PROSEDUR</h2>";
    document.getElementById("documentMeta").innerHTML = `
      <div><span>Nomor SOP</span><b contenteditable="true">—</b></div>
      <div><span>Tanggal pembuatan</span><b contenteditable="true">—</b></div>
      <div><span>Tanggal efektif</span><b contenteditable="true">—</b></div>
      <div><span>Disahkan oleh</span><b contenteditable="true">—</b></div>`;
    tbody().innerHTML = "";
    for (let index = 1; index <= 3; index += 1) {
      const row = document.createElement("tr");
      row.innerHTML = makeRowHTML(index);
      tbody().appendChild(row);
    }
    document.querySelector(".paper-note").innerHTML = "<b>Catatan:</b> Tambahkan ketentuan atau penjelasan tambahan di sini.";
    state.activeRow = null;
    state.activeCell = null;
    bindEditablePersistence();
    markDirty();
    renderAll();
    flash("Dokumen baru siap digunakan.");
  }

  function loadExample() {
    if (!window.confirm("Ganti isi dokumen dengan contoh SOP pengelolaan rilis berita?")) return;
    const current = captureSnapshot();
    restoreSnapshot(exampleSnapshot, { keepHistory: true });
    pushPastSnapshot(current);
    markDirty();
    flash("Template contoh dimuat.");
  }

  function slugify(value) {
    return String(value || "dokumen-sop")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "dokumen-sop";
  }

  function downloadBlob(blob, filename) {
    if (typeof window.saveAs === "function") {
      window.saveAs(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportProject() {
    const data = JSON.stringify(captureSnapshot(), null, 2);
    downloadBlob(new Blob([data], { type: "application/json;charset=utf-8" }), `${slugify(refs.documentName.value)}.sop.json`);
    refs.exportMenu.open = false;
    flash("Cadangan proyek berhasil dibuat.");
  }

  async function importProject(file) {
    if (!file) return;
    try {
      const raw = await file.text();
      const imported = JSON.parse(raw);
      const current = captureSnapshot();
      restoreSnapshot(imported, { keepHistory: true });
      pushPastSnapshot(current);
      markDirty();
      flash("Proyek berhasil diimpor.");
    } catch (error) {
      console.error(error);
      flash(`Gagal mengimpor proyek: ${error.message}`);
    } finally {
      refs.projectFile.value = "";
      refs.exportMenu.open = false;
    }
  }

  function setExportBusy(show, message = "Menyiapkan dokumen…") {
    refs.exportStatus.textContent = message;
    refs.exportOverlay.classList.toggle("show", show);
    refs.exportOverlay.setAttribute("aria-hidden", String(!show));
  }

  async function capturePaperCanvas() {
    if (typeof window.html2canvas !== "function") {
      throw new Error("Modul ekspor gambar gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.");
    }
    bindEditablePersistence();
    updateWorkspaceSize();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.fonts?.ready) await document.fonts.ready;

    const longestSide = Math.max(refs.paper.scrollWidth, refs.paper.scrollHeight);
    const scale = clamp(12000 / longestSide, 1, 2);
    return window.html2canvas(refs.paper, {
      backgroundColor: "#ffffff",
      scale,
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      width: refs.paper.scrollWidth,
      height: refs.paper.scrollHeight,
      windowWidth: refs.paper.scrollWidth,
      windowHeight: refs.paper.scrollHeight,
      onclone: clonedDocument => {
        clonedDocument.querySelectorAll(".selected, .connect-source, .active-row, .active-cell, .drag-over").forEach(element => {
          element.classList.remove("selected", "connect-source", "active-row", "active-cell", "drag-over");
        });
        clonedDocument.querySelectorAll(".resize-handle, #edgeHandles").forEach(element => element.remove());
        clonedDocument.querySelectorAll("[contenteditable]").forEach(element => element.removeAttribute("contenteditable"));
      }
    });
  }

  function canvasToBlob(canvas, type = "image/png", quality = 1) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Gagal membuat berkas gambar.")), type, quality);
    });
  }

  async function exportPNG() {
    refs.exportMenu.open = false;
    setExportBusy(true, "Membuat PNG resolusi tinggi…");
    try {
      const canvas = await capturePaperCanvas();
      const blob = await canvasToBlob(canvas);
      downloadBlob(blob, `${slugify(refs.documentName.value)}.png`);
      flash("PNG berhasil diekspor.");
    } catch (error) {
      console.error(error);
      flash(error.message || "Ekspor PNG gagal.");
    } finally {
      setExportBusy(false);
    }
  }

  async function sliceCanvasForDocument(canvas) {
    const pageRatio = 1.46;
    const sourcePageHeight = Math.max(1, Math.floor(canvas.width / pageRatio));
    const slices = [];
    for (let y = 0; y < canvas.height; y += sourcePageHeight) {
      const height = Math.min(sourcePageHeight, canvas.height - y);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = height;
      const context = pageCanvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(canvas, 0, y, canvas.width, height, 0, 0, canvas.width, height);
      const blob = await canvasToBlob(pageCanvas);
      slices.push({
        data: new Uint8Array(await blob.arrayBuffer()),
        width: 980,
        height: Math.max(1, Math.round(980 * height / canvas.width))
      });
    }
    return slices;
  }

  function docxTableRows(docxApi) {
    const { TableRow, TableCell, Paragraph, TextRun, WidthType, ShadingType, VerticalAlign } = docxApi;
    const headerRow = table().tHead.rows[0];
    const detailRow = table().tHead.rows[1];
    const headers = [
      "No.",
      headerRow.cells[1]?.innerText.trim() || "Kegiatan",
      ...[...detailRow.cells].map(cell => cell.innerText.trim()),
      headerRow.cells[headerRow.cells.length - 1]?.innerText.trim() || "Keterangan"
    ];
    const bodyRows = [...tbody().rows].map(row => [...row.cells].map(cell => cell.innerText.trim()));
    const rows = [headers, ...bodyRows];
    const count = headers.length;

    return rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      children: row.map((text, cellIndex) => {
        let width = 64 / Math.max(1, count - 3);
        if (cellIndex === 0) width = 3;
        if (cellIndex === 1) width = 20;
        if (cellIndex === count - 1) width = 13;
        const lines = String(text || " ").split(/\n+/);
        return new TableCell({
          width: { size: width, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          shading: rowIndex === 0 ? { fill: "DCE6F1", type: ShadingType.CLEAR } : undefined,
          margins: { top: 45, bottom: 45, left: 55, right: 55 },
          children: lines.map(line => new Paragraph({
            children: [new TextRun({ text: line || " ", bold: rowIndex === 0, size: rowIndex === 0 ? 14 : 13, font: "Arial" })],
            spacing: { after: 0 },
            alignment: cellIndex === 0 || rowIndex === 0 ? docxApi.AlignmentType.CENTER : docxApi.AlignmentType.LEFT
          }))
        });
      })
    }));
  }

  async function exportDOCX() {
    refs.exportMenu.open = false;
    setExportBusy(true, "Menyusun dokumen Word…");
    try {
      if (!window.docx) throw new Error("Modul Word gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.");
      const canvas = await capturePaperCanvas();
      const pages = await sliceCanvasForDocument(canvas);
      const {
        Document, Packer, Paragraph, TextRun, ImageRun, Table, WidthType,
        AlignmentType, PageOrientation, PageBreak, TableLayoutType
      } = window.docx;

      const visualChildren = [];
      pages.forEach((page, index) => {
        if (index > 0) visualChildren.push(new Paragraph({ children: [new PageBreak()] }));
        visualChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ data: page.data, transformation: { width: page.width, height: page.height } })]
        }));
      });

      visualChildren.push(new Paragraph({ children: [new PageBreak()] }));
      visualChildren.push(new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: "Data SOP (dapat diedit)", bold: true, size: 24, font: "Arial", color: "173F69" })]
      }));
      visualChildren.push(new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: "Tabel berikut disertakan sebagai data teks agar isi SOP tetap dapat diperbarui di Microsoft Word.", size: 17, font: "Arial", color: "475569" })]
      }));
      visualChildren.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: docxTableRows(window.docx)
      }));
      visualChildren.push(new Paragraph({
        spacing: { before: 140 },
        children: [new TextRun({ text: document.querySelector(".paper-note").innerText.trim(), size: 16, font: "Arial", color: "334155" })]
      }));

      const documentFile = new Document({
        creator: "SOP Studio",
        title: refs.documentName.value.trim() || "Dokumen SOP",
        description: "Dokumen SOP yang diekspor dari SOP Studio",
        styles: {
          default: {
            document: {
              run: { font: "Arial", size: 18 },
              paragraph: { spacing: { after: 80 } }
            }
          }
        },
        sections: [{
          properties: {
            page: {
              size: { width: 16838, height: 11906, orientation: PageOrientation.LANDSCAPE },
              margin: { top: 360, right: 360, bottom: 360, left: 360 }
            }
          },
          children: visualChildren
        }]
      });
      const blob = await Packer.toBlob(documentFile);
      downloadBlob(blob, `${slugify(refs.documentName.value)}.docx`);
      flash("DOCX berhasil diekspor.");
    } catch (error) {
      console.error(error);
      flash(error.message || "Ekspor DOCX gagal.");
    } finally {
      setExportBusy(false);
    }
  }

  function printDocument() {
    refs.exportMenu.open = false;
    const scale = Math.min(1, 1040 / refs.paper.scrollWidth);
    refs.paper.style.setProperty("--print-zoom", String(scale));
    window.print();
  }

  function seedExampleFlow() {
    state.nodes = [
      normalizeNode({ id: "example-1", type: "start", x: 380, y: 124, w: 142, h: 56, text: "Mulai / Input bahan", stroke: "#1d4ed8", fill: "#ffffff", z: 1 }, 0),
      normalizeNode({ id: "example-2", type: "process", x: 535, y: 248, w: 142, h: 60, text: "Verifikasi & olah", stroke: "#15803d", fill: "#ffffff", z: 2 }, 1),
      normalizeNode({ id: "example-3", type: "decision", x: 700, y: 356, w: 112, h: 112, text: "Sesuai?", stroke: "#dc2626", fill: "#ffffff", z: 3 }, 2),
      normalizeNode({ id: "example-4", type: "process", x: 850, y: 508, w: 142, h: 60, text: "Pemeriksaan akhir", stroke: "#7c3aed", fill: "#ffffff", z: 4 }, 3),
      normalizeNode({ id: "example-5", type: "decision", x: 865, y: 620, w: 112, h: 112, text: "Disetujui?", stroke: "#7c3aed", fill: "#ffffff", z: 5 }, 4),
      normalizeNode({ id: "example-6", type: "document", x: 1018, y: 768, w: 154, h: 70, text: "Publikasi & arsip", stroke: "#b45309", fill: "#fffbeb", z: 6 }, 5)
    ];
    state.edges = normalizeEdges([
      { id: "example-e1", source: "example-1", target: "example-2", bendX: 580, stroke: "#163b65" },
      { id: "example-e2", source: "example-2", target: "example-3", bendX: 690, stroke: "#163b65" },
      { id: "example-e3", source: "example-3", target: "example-2", bendX: 610, label: "Revisi", stroke: "#b91c1c", style: "dashed" },
      { id: "example-e4", source: "example-3", target: "example-4", bendX: 830, label: "Sesuai", stroke: "#166534" },
      { id: "example-e5", source: "example-4", target: "example-5", bendX: 930, stroke: "#163b65" },
      { id: "example-e6", source: "example-5", target: "example-4", bendX: 815, label: "Revisi", stroke: "#b91c1c", style: "dashed" },
      { id: "example-e7", source: "example-5", target: "example-6", bendX: 1005, label: "Disetujui", stroke: "#166534" }
    ], state.nodes);
  }

  function bindEvents() {
    document.querySelectorAll("[data-add-node]").forEach(button => {
      button.addEventListener("click", () => addNode(button.dataset.addNode));
      button.addEventListener("dragstart", event => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sop-node", button.dataset.addNode);
        event.dataTransfer.setData("text/plain", button.dataset.addNode);
      });
    });

    document.getElementById("btnConnectPalette").addEventListener("click", () => toggleConnect());
    document.getElementById("btnConnect").addEventListener("click", () => toggleConnect());
    document.getElementById("btnSelectMode").addEventListener("click", () => toggleConnect(false));
    document.getElementById("btnDelete").addEventListener("click", deleteSelected);
    document.getElementById("btnDuplicate").addEventListener("click", duplicateSelected);
    document.getElementById("btnApplyProps").addEventListener("click", applyNodeProperties);
    document.getElementById("btnApplyEdge").addEventListener("click", applyEdgeProperties);
    document.getElementById("btnBringFront").addEventListener("click", () => changeLayer("front"));
    document.getElementById("btnSendBack").addEventListener("click", () => changeLayer("back"));

    document.getElementById("btnAddRow").addEventListener("click", addRow);
    document.getElementById("btnDeleteRow").addEventListener("click", deleteActiveRow);
    document.getElementById("btnAddActor").addEventListener("click", addActor);
    document.getElementById("btnRemoveActor").addEventListener("click", removeActor);
    document.getElementById("btnPlaceInCell").addEventListener("click", placeSelectedInCell);
    document.getElementById("btnUploadLogo").addEventListener("click", () => document.getElementById("logoFile").click());
    document.getElementById("btnRemoveLogo").addEventListener("click", removeLogo);
    document.getElementById("logoFile").addEventListener("change", event => uploadLogo(event.target.files[0]));

    document.getElementById("btnUndo").addEventListener("click", undo);
    document.getElementById("btnRedo").addEventListener("click", redo);
    document.getElementById("btnSave").addEventListener("click", () => saveLocal(true));
    document.getElementById("btnNew").addEventListener("click", createBlankDocument);
    document.getElementById("btnLoadExample").addEventListener("click", loadExample);

    document.getElementById("zoomIn").addEventListener("click", () => setZoom(state.zoom + 0.1));
    document.getElementById("zoomOut").addEventListener("click", () => setZoom(state.zoom - 0.1));
    document.getElementById("zoomReset").addEventListener("click", () => setZoom(1));
    document.getElementById("zoomFit").addEventListener("click", fitZoom);
    document.getElementById("btnGrid").addEventListener("click", () => {
      state.grid = !state.grid;
      syncModeButtons();
      markDirty();
    });
    document.getElementById("btnSnap").addEventListener("click", () => {
      state.snap = !state.snap;
      syncModeButtons();
      markDirty();
    });

    document.getElementById("btnExportProject").addEventListener("click", exportProject);
    document.getElementById("btnImportProject").addEventListener("click", () => refs.projectFile.click());
    refs.projectFile.addEventListener("change", () => importProject(refs.projectFile.files[0]));
    document.getElementById("btnExportPng").addEventListener("click", exportPNG);
    document.getElementById("btnExportDocx").addEventListener("click", exportDOCX);
    document.getElementById("btnPrint").addEventListener("click", printDocument);

    refs.documentName.addEventListener("focus", () => {
      refs.documentName.__beforeValue = refs.documentName.value;
      refs.documentName.__beforeSnapshot = captureSnapshot();
    });
    refs.documentName.addEventListener("input", () => {
      refs.saveIndicator.classList.add("pending");
      refs.saveLabel.textContent = "Perubahan belum disimpan";
    });
    refs.documentName.addEventListener("blur", () => {
      if (refs.documentName.__beforeValue !== refs.documentName.value) {
        pushPastSnapshot(refs.documentName.__beforeSnapshot);
        markDirty();
      }
    });

    refs.workspace.addEventListener("pointerdown", event => {
      if (event.target === refs.workspace || event.target === refs.nodeLayer || event.target === refs.edgeLayer) clearSelection();
    });
    refs.viewport.addEventListener("pointerdown", beginPan);
    refs.viewport.addEventListener("wheel", event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(state.zoom + (event.deltaY < 0 ? 0.08 : -0.08));
    }, { passive: false });
    refs.workspace.addEventListener("dragover", event => {
      if (event.dataTransfer.types.includes("application/x-sop-node")) event.preventDefault();
    });
    refs.workspace.addEventListener("drop", event => {
      if (event.target.closest("#sopTable")) return;
      const type = event.dataTransfer.getData("application/x-sop-node");
      if (!type) return;
      event.preventDefault();
      addNode(type, getWorkspacePoint(event.clientX, event.clientY));
    });

    document.addEventListener("click", event => {
      if (!refs.exportMenu.contains(event.target)) refs.exportMenu.open = false;
    });

    document.addEventListener("keydown", event => {
      const target = event.target;
      const tag = (target.tagName || "").toLowerCase();
      const typing = target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveLocal(true);
        return;
      }
      if (modifier && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((modifier && event.key.toLowerCase() === "y") || (modifier && event.shiftKey && event.key.toLowerCase() === "z")) {
        event.preventDefault();
        redo();
        return;
      }
      if (!typing && modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (!typing && event.key.toLowerCase() === "c") {
        event.preventDefault();
        toggleConnect(true);
        return;
      }
      if (!typing && event.key.toLowerCase() === "v") {
        event.preventDefault();
        toggleConnect(false);
        return;
      }
      if (event.key === "Escape") {
        if (state.connectMode) toggleConnect(false);
        else clearSelection();
      }
      if (!typing && event.code === "Space") {
        event.preventDefault();
        state.spacePressed = true;
        refs.viewport.classList.add("pan-ready");
      }
    });

    document.addEventListener("keyup", event => {
      if (event.code !== "Space") return;
      state.spacePressed = false;
      refs.viewport.classList.remove("pan-ready");
      if (state.panning) endPan();
    });

    window.addEventListener("resize", () => {
      updateWorkspaceSize();
      syncStageSize();
    });
    window.addEventListener("beforeunload", () => saveLocal(false));

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => {
        updateWorkspaceSize();
        syncStageSize();
      });
      observer.observe(refs.paper);
    }
  }

  function init() {
    seedExampleFlow();
    bindEvents();
    bindEditablePersistence();
    bindTableInteractions();
    renderAll();
    setZoom(0.75, false);
    exampleSnapshot = captureSnapshot();

    const restored = loadSavedDocument();
    if (!restored) {
      renderAll();
      saveLocal(false);
    }
    setStatus(restored ? "Dokumen terakhir dipulihkan" : "Siap mengedit — template contoh dimuat");
  }

  init();
})();
