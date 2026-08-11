(() => {
  "use strict";

  const workspace = document.getElementById("workspace");
  const nodeLayer = document.getElementById("nodeLayer");
  const edgeLayer = document.getElementById("edgeLayer");
  const edgesGroup = document.getElementById("edges");
  const handlesGroup = document.getElementById("edgeHandles");
  const sopBody = document.getElementById("sopBody");
  const zoomLayer = document.getElementById("zoomLayer");
  const viewport = document.getElementById("viewport");
  const statusText = document.getElementById("statusText");
  const toast = document.getElementById("toast");

  const propText = document.getElementById("propText");
  const propStroke = document.getElementById("propStroke");
  const propFill = document.getElementById("propFill");
  const propFontSize = document.getElementById("propFontSize");
  const propWeight = document.getElementById("propWeight");
  const edgeLabel = document.getElementById("edgeLabel");
  const zoomValue = document.getElementById("zoomValue");

  const state = {
    nodes: [],
    edges: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    connectMode: false,
    connectSourceId: null,
    zoom: 1,
    history: [],
    future: [],
    dragging: null,
    resizing: null,
    movingEdgeId: null,
    saveTimer: null
  };

  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  function flash(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function setStatus(message) {
    statusText.textContent = message;
  }

  function getWorkspacePoint(clientX, clientY) {
    const rect = workspace.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / state.zoom,
      y: (clientY - rect.top) / state.zoom
    };
  }

  function snapshotData() {
    return {
      nodes: JSON.parse(JSON.stringify(state.nodes)),
      edges: JSON.parse(JSON.stringify(state.edges)),
      tableHTML: document.getElementById("sopTable").outerHTML,
      titleHTML: document.querySelector(".paper-title").innerHTML,
      noteHTML: document.querySelector(".paper-note").innerHTML
    };
  }

  function pushHistory() {
    const snap = snapshotData();
    state.history.push(snap);
    if (state.history.length > 50) state.history.shift();
    state.future.length = 0;
  }

  function restoreSnapshot(snap) {
    if (!snap) return;

    state.nodes = JSON.parse(JSON.stringify(snap.nodes || []));
    state.edges = JSON.parse(JSON.stringify(snap.edges || []));

    const existing = document.getElementById("sopTable");
    const wrap = document.createElement("div");
    wrap.innerHTML = snap.tableHTML;
    existing.replaceWith(wrap.firstElementChild);

    document.querySelector(".paper-title").innerHTML = snap.titleHTML;
    document.querySelector(".paper-note").innerHTML = snap.noteHTML;

    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    renderAll();
    bindEditablePersistence();
  }

  function undo() {
    if (!state.history.length) return flash("Belum ada riwayat untuk Undo.");
    const current = snapshotData();
    state.future.push(current);
    const previous = state.history.pop();
    restoreSnapshot(previous);
    flash("Undo");
  }

  function redo() {
    if (!state.future.length) return flash("Belum ada riwayat untuk Redo.");
    const current = snapshotData();
    state.history.push(current);
    const next = state.future.pop();
    restoreSnapshot(next);
    flash("Redo");
  }

  function defaultNode(type) {
    const base = {
      id: uid("node"),
      type,
      x: 390 + Math.random() * 160,
      y: 120 + Math.random() * 220,
      w: 145,
      h: 64,
      text: "Proses",
      stroke: "#143b8f",
      fill: "#ffffff",
      fontSize: 16,
      fontWeight: 600
    };

    if (type === "start") {
      base.text = "Mulai";
      base.stroke = "#1746e0";
    }

    if (type === "decision") {
      base.text = "Pemeriksaan\n& ACC";
      base.w = 122;
      base.h = 122;
      base.stroke = "#6d28d9";
    }

    if (type === "text") {
      base.text = "Label";
      base.w = 100;
      base.h = 36;
      base.stroke = "transparent";
      base.fill = "transparent";
      base.fontWeight = 700;
    }

    return base;
  }

  function addNode(type) {
    pushHistory();
    const node = defaultNode(type);
    state.nodes.push(node);
    renderAll();
    selectNode(node.id);
    flash("Objek flowchart ditambahkan.");
  }

  function renderAll() {
    renderNodes();
    renderEdges();
    syncPropertyPanel();
    updateWorkspaceHeight();
  }

  function updateWorkspaceHeight() {
    const table = document.getElementById("sopTable");
    const h = table.offsetHeight;
    workspace.style.minHeight = `${h}px`;
    edgeLayer.setAttribute("viewBox", `0 0 ${workspace.scrollWidth} ${Math.max(h, workspace.scrollHeight)}`);
  }

  function renderNodes() {
    nodeLayer.innerHTML = "";

    state.nodes.forEach(node => {
      const el = document.createElement("div");
      el.className = `flow-node ${node.type}${state.selectedNodeId === node.id ? " selected" : ""}${state.connectSourceId === node.id ? " connect-source" : ""}`;
      el.dataset.id = node.id;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.style.width = `${node.w}px`;
      el.style.height = `${node.h}px`;
      el.style.borderColor = node.stroke;
      el.style.background = node.fill;
      el.style.fontSize = `${node.fontSize}px`;
      el.style.fontWeight = node.fontWeight;

      const text = document.createElement("div");
      text.className = "node-text";
      text.textContent = node.text;
      el.appendChild(text);

      const resize = document.createElement("span");
      resize.className = "resize-handle";
      resize.title = "Ubah ukuran";
      el.appendChild(resize);

      el.addEventListener("pointerdown", onNodePointerDown);
      el.addEventListener("dblclick", onNodeDoubleClick);
      resize.addEventListener("pointerdown", onResizePointerDown);

      nodeLayer.appendChild(el);
    });
  }

  function nodeCenter(node) {
    return {
      x: node.x + node.w / 2,
      y: node.y + node.h / 2
    };
  }

  function nodeBoundaryPoint(node, toward) {
    const c = nodeCenter(node);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;

    if (node.type === "decision") {
      const rx = node.w / 2;
      const ry = node.h / 2;
      const denom = Math.abs(dx) / rx + Math.abs(dy) / ry || 1;
      return { x: c.x + dx / denom, y: c.y + dy / denom };
    }

    const hw = node.w / 2;
    const hh = node.h / 2;
    const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
    const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
    const scale = Math.min(sx, sy);

    return {
      x: c.x + dx * scale,
      y: c.y + dy * scale
    };
  }

  function edgePoints(edge) {
    const source = state.nodes.find(n => n.id === edge.source);
    const target = state.nodes.find(n => n.id === edge.target);
    if (!source || !target) return null;

    const sc = nodeCenter(source);
    const tc = nodeCenter(target);
    const start = nodeBoundaryPoint(source, tc);
    const end = nodeBoundaryPoint(target, sc);

    let bendX = Number.isFinite(edge.bendX) ? edge.bendX : (start.x + end.x) / 2;

    if (Math.abs(start.x - end.x) < 20) {
      bendX = start.x + 34;
    }

    return {
      start,
      end,
      bendX,
      points: [
        [start.x, start.y],
        [bendX, start.y],
        [bendX, end.y],
        [end.x, end.y]
      ]
    };
  }

  function renderEdges() {
    edgesGroup.innerHTML = "";
    handlesGroup.innerHTML = "";

    state.edges.forEach(edge => {
      const p = edgePoints(edge);
      if (!p) return;

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.dataset.id = edge.id;

      const pointsString = p.points.map(pt => pt.join(",")).join(" ");

      const clickPath = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      clickPath.setAttribute("points", pointsString);
      clickPath.setAttribute("class", "edge-click-target");
      clickPath.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        selectEdge(edge.id);
      });
      group.appendChild(clickPath);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      path.setAttribute("points", pointsString);
      path.setAttribute("class", `edge-path${state.selectedEdgeId === edge.id ? " selected" : ""}`);
      path.setAttribute("stroke", edge.stroke || "#143b8f");
      group.appendChild(path);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "edge-label");
      label.setAttribute("x", p.bendX + 8);
      label.setAttribute("y", (p.start.y + p.end.y) / 2 - 8);
      label.textContent = edge.label || "";
      group.appendChild(label);

      edgesGroup.appendChild(group);

      if (state.selectedEdgeId === edge.id) {
        const h = document.createElementNS("http://www.w3.org/2000/svg", "g");
        h.setAttribute("class", "edge-handle");
        h.dataset.id = edge.id;
        const cy = (p.start.y + p.end.y) / 2;

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", p.bendX);
        circle.setAttribute("cy", cy);
        circle.setAttribute("r", 7);
        h.appendChild(circle);

        h.addEventListener("pointerdown", onEdgeHandlePointerDown);
        handlesGroup.appendChild(h);
      }
    });
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

  function onNodePointerDown(ev) {
    if (ev.target.classList.contains("resize-handle")) return;

    const id = ev.currentTarget.dataset.id;
    const node = state.nodes.find(n => n.id === id);
    if (!node) return;

    if (state.connectMode) {
      ev.preventDefault();
      ev.stopPropagation();

      if (!state.connectSourceId) {
        state.connectSourceId = id;
        setStatus("Pilih objek tujuan panah");
        renderNodes();
        return;
      }

      if (state.connectSourceId === id) {
        state.connectSourceId = null;
        setStatus("Pilih objek awal");
        renderNodes();
        return;
      }

      pushHistory();
      const source = state.nodes.find(n => n.id === state.connectSourceId);
      const target = node;
      const sc = nodeCenter(source);
      const tc = nodeCenter(target);

      state.edges.push({
        id: uid("edge"),
        source: source.id,
        target: target.id,
        bendX: (sc.x + tc.x) / 2,
        label: "",
        stroke: "#143b8f"
      });

      state.connectMode = false;
      state.connectSourceId = null;
      setStatus("Panah berhasil dibuat");
      renderAll();
      flash("Panah dibuat. Klik panah untuk mengatur jalurnya.");
      return;
    }

    pushHistory();
    selectNode(id);

    const point = getWorkspacePoint(ev.clientX, ev.clientY);
    state.dragging = {
      id,
      startX: point.x,
      startY: point.y,
      originX: node.x,
      originY: node.y
    };

    ev.currentTarget.setPointerCapture(ev.pointerId);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onNodeDoubleClick(ev) {
    ev.stopPropagation();
    const id = ev.currentTarget.dataset.id;
    const node = state.nodes.find(n => n.id === id);
    if (!node) return;

    const current = node.text;
    const next = window.prompt("Ubah teks objek:", current);
    if (next === null) return;

    pushHistory();
    node.text = next;
    renderAll();
  }

  function onResizePointerDown(ev) {
    ev.stopPropagation();
    const holder = ev.currentTarget.closest(".flow-node");
    const id = holder.dataset.id;
    const node = state.nodes.find(n => n.id === id);
    if (!node) return;

    pushHistory();
    const point = getWorkspacePoint(ev.clientX, ev.clientY);

    state.resizing = {
      id,
      startX: point.x,
      startY: point.y,
      originW: node.w,
      originH: node.h
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onEdgeHandlePointerDown(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    const id = ev.currentTarget.dataset.id;
    selectEdge(id);
    pushHistory();
    state.movingEdgeId = id;

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onPointerMove(ev) {
    const point = getWorkspacePoint(ev.clientX, ev.clientY);

    if (state.dragging) {
      const node = state.nodes.find(n => n.id === state.dragging.id);
      if (!node) return;

      node.x = Math.max(0, state.dragging.originX + (point.x - state.dragging.startX));
      node.y = Math.max(0, state.dragging.originY + (point.y - state.dragging.startY));
      renderAll();
      return;
    }

    if (state.resizing) {
      const node = state.nodes.find(n => n.id === state.resizing.id);
      if (!node) return;

      node.w = clamp(state.resizing.originW + (point.x - state.resizing.startX), 100, 320);
      node.h = clamp(state.resizing.originH + (point.y - state.resizing.startY), 48, 220);
      renderAll();
      return;
    }

    if (state.movingEdgeId) {
      const edge = state.edges.find(e => e.id === state.movingEdgeId);
      if (!edge) return;

      edge.bendX = point.x;
      renderEdges();
    }
  }

  function onPointerUp() {
    state.dragging = null;
    state.resizing = null;
    state.movingEdgeId = null;
    document.removeEventListener("pointermove", onPointerMove);
    scheduleAutosave();
  }

  function toggleConnect() {
    state.connectMode = !state.connectMode;
    state.connectSourceId = null;
    state.selectedNodeId = null;
    state.selectedEdgeId = null;

    const btn = document.getElementById("btnConnect");
    btn.classList.toggle("primary", state.connectMode);

    if (state.connectMode) {
      setStatus("Mode panah aktif — klik objek awal");
      flash("Klik objek awal, lalu objek tujuan.");
    } else {
      setStatus("Mode panah dibatalkan");
    }

    renderAll();
  }

  function deleteSelected() {
    if (!state.selectedNodeId && !state.selectedEdgeId) {
      flash("Pilih objek atau panah yang ingin dihapus.");
      return;
    }

    pushHistory();

    if (state.selectedNodeId) {
      const id = state.selectedNodeId;
      state.nodes = state.nodes.filter(n => n.id !== id);
      state.edges = state.edges.filter(e => e.source !== id && e.target !== id);
      state.selectedNodeId = null;
    } else if (state.selectedEdgeId) {
      state.edges = state.edges.filter(e => e.id !== state.selectedEdgeId);
      state.selectedEdgeId = null;
    }

    renderAll();
    flash("Objek dihapus.");
  }

  function syncPropertyPanel() {
    const node = state.nodes.find(n => n.id === state.selectedNodeId);
    const edge = state.edges.find(e => e.id === state.selectedEdgeId);

    if (node) {
      propText.value = node.text;
      propStroke.value = colorForInput(node.stroke, "#143b8f");
      propFill.value = colorForInput(node.fill, "#ffffff");
      propFontSize.value = node.fontSize;
      propWeight.value = String(node.fontWeight);
      edgeLabel.value = "";
    } else if (edge) {
      propText.value = "";
      propStroke.value = colorForInput(edge.stroke, "#143b8f");
      propFill.value = "#ffffff";
      edgeLabel.value = edge.label || "";
    } else {
      propText.value = "";
      edgeLabel.value = "";
    }
  }

  function colorForInput(color, fallback) {
    return /^#[0-9a-f]{6}$/i.test(color || "") ? color : fallback;
  }

  function applyProperties() {
    const node = state.nodes.find(n => n.id === state.selectedNodeId);
    const edge = state.edges.find(e => e.id === state.selectedEdgeId);

    if (!node && !edge) {
      flash("Pilih objek atau panah terlebih dahulu.");
      return;
    }

    pushHistory();

    if (node) {
      node.text = propText.value.trim() || node.text;
      node.stroke = propStroke.value;
      node.fill = node.type === "text" ? "transparent" : propFill.value;
      node.fontSize = Number(propFontSize.value) || 16;
      node.fontWeight = Number(propWeight.value) || 600;
    }

    if (edge) {
      edge.stroke = propStroke.value;
    }

    renderAll();
    flash("Properti diterapkan.");
  }

  function applyEdgeLabel() {
    const edge = state.edges.find(e => e.id === state.selectedEdgeId);
    if (!edge) {
      flash("Pilih panah terlebih dahulu.");
      return;
    }

    pushHistory();
    edge.label = edgeLabel.value.trim();
    renderAll();
    flash("Label panah diperbarui.");
  }

  function addRow() {
    pushHistory();

    const body = document.getElementById("sopBody");
    const tr = document.createElement("tr");
    const rowNumber = body.children.length + 1;

    tr.innerHTML = `
      <td class="row-number">${rowNumber}</td>
      <td class="editable-cell" contenteditable="true">Ketik uraian kegiatan...</td>
      <td class="flow-cell"></td>
      <td class="flow-cell"></td>
      <td class="flow-cell"></td>
      <td class="flow-cell"></td>
      <td class="flow-cell"></td>
      <td class="editable-cell" contenteditable="true">• Kelengkapan</td>
      <td class="editable-cell" contenteditable="true">Maks. ... menit</td>
      <td class="editable-cell" contenteditable="true">Output</td>
      <td class="editable-cell" contenteditable="true">Keterangan</td>
    `;

    body.appendChild(tr);
    bindEditablePersistence();
    updateWorkspaceHeight();
    flash(`Baris ${rowNumber} ditambahkan.`);
  }

  function serializeDocument() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      nodes: state.nodes,
      edges: state.edges,
      tableHTML: document.getElementById("sopTable").outerHTML,
      titleHTML: document.querySelector(".paper-title").innerHTML,
      noteHTML: document.querySelector(".paper-note").innerHTML
    };
  }

  function saveLocal(showToast = true) {
    try {
      localStorage.setItem("sop-flowchart-editor", JSON.stringify(serializeDocument()));
      if (showToast) flash("Dokumen tersimpan di browser.");
    } catch (error) {
      console.error(error);
      flash("Gagal menyimpan dokumen.");
    }
  }

  function loadLocal() {
    const raw = localStorage.getItem("sop-flowchart-editor");
    if (!raw) {
      flash("Belum ada dokumen tersimpan.");
      return;
    }

    try {
      pushHistory();
      const data = JSON.parse(raw);
      restoreSnapshot(data);
      flash("Dokumen berhasil dimuat.");
    } catch (error) {
      console.error(error);
      flash("Data simpanan tidak dapat dibaca.");
    }
  }

  function scheduleAutosave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveLocal(false), 350);
  }

  function setZoom(next) {
    state.zoom = clamp(next, 0.45, 1.6);
    zoomLayer.style.transform = `scale(${state.zoom})`;
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;

    // Make the scrollable area follow the scaled paper.
    zoomLayer.style.marginRight = `${(state.zoom - 1) * zoomLayer.offsetWidth}px`;
    zoomLayer.style.marginBottom = `${(state.zoom - 1) * zoomLayer.offsetHeight}px`;
  }

  function bindEditablePersistence() {
    document.querySelectorAll('[contenteditable="true"]').forEach(el => {
      if (el.dataset.persistBound) return;
      el.dataset.persistBound = "1";
      el.addEventListener("focus", () => {
        el.dataset.beforeEdit = el.innerHTML;
      });
      el.addEventListener("blur", () => {
        if (el.dataset.beforeEdit !== el.innerHTML) {
          state.history.push({
            ...snapshotData(),
            tableHTML: document.getElementById("sopTable").outerHTML
          });
          if (state.history.length > 50) state.history.shift();
          scheduleAutosave();
        }
        updateWorkspaceHeight();
      });
    });
  }

  function seedDemoFlow() {
    state.nodes = [
      {
        id: "n1", type: "start", x: 385, y: 112, w: 145, h: 64,
        text: "Mulai /\nInput Rilis Mentah", stroke: "#1d4ed8", fill: "#ffffff", fontSize: 15, fontWeight: 600
      },
      {
        id: "n2", type: "process", x: 548, y: 250, w: 145, h: 64,
        text: "Olah Rilis", stroke: "#15803d", fill: "#ffffff", fontSize: 16, fontWeight: 600
      },
      {
        id: "n3", type: "decision", x: 725, y: 380, w: 122, h: 122,
        text: "Pemeriksaan\n& ACC", stroke: "#dc2626", fill: "#ffffff", fontSize: 15, fontWeight: 600
      },
      {
        id: "n4", type: "process", x: 548, y: 555, w: 145, h: 64,
        text: "Kirim ke\nKepala Biro", stroke: "#15803d", fill: "#ffffff", fontSize: 15, fontWeight: 600
      },
      {
        id: "n5", type: "process", x: 895, y: 575, w: 145, h: 64,
        text: "Pemeriksaan\nRilis", stroke: "#7c3aed", fill: "#ffffff", fontSize: 14, fontWeight: 600
      },
      {
        id: "n6", type: "decision", x: 900, y: 690, w: 122, h: 122,
        text: "Pemeriksaan\n& ACC Akhir", stroke: "#7c3aed", fill: "#ffffff", fontSize: 14, fontWeight: 600
      },
      {
        id: "n7", type: "process", x: 1085, y: 828, w: 145, h: 64,
        text: "Publikasi &\nDistribusi", stroke: "#ef4444", fill: "#ffffff", fontSize: 15, fontWeight: 600
      }
    ];

    state.edges = [
      { id: "e1", source: "n1", target: "n2", bendX: 620, label: "", stroke: "#143b8f" },
      { id: "e2", source: "n2", target: "n3", bendX: 730, label: "", stroke: "#143b8f" },
      { id: "e3", source: "n3", target: "n2", bendX: 610, label: "Revisi", stroke: "#143b8f" },
      { id: "e4", source: "n3", target: "n4", bendX: 720, label: "ACC", stroke: "#143b8f" },
      { id: "e5", source: "n4", target: "n5", bendX: 800, label: "", stroke: "#143b8f" },
      { id: "e6", source: "n5", target: "n6", bendX: 970, label: "", stroke: "#143b8f" },
      { id: "e7", source: "n6", target: "n4", bendX: 620, label: "Revisi", stroke: "#143b8f" },
      { id: "e8", source: "n6", target: "n7", bendX: 1045, label: "ACC", stroke: "#143b8f" }
    ];
  }

  function bindEvents() {
    document.querySelectorAll("[data-add-node]").forEach(btn => {
      btn.addEventListener("click", () => addNode(btn.dataset.addNode));
    });

    document.getElementById("btnConnect").addEventListener("click", toggleConnect);
    document.getElementById("btnDelete").addEventListener("click", deleteSelected);
    document.getElementById("btnApplyProps").addEventListener("click", applyProperties);
    document.getElementById("btnApplyEdgeLabel").addEventListener("click", applyEdgeLabel);
    document.getElementById("btnAddRow").addEventListener("click", addRow);
    document.getElementById("btnSave").addEventListener("click", () => saveLocal(true));
    document.getElementById("btnLoad").addEventListener("click", loadLocal);
    document.getElementById("btnPrint").addEventListener("click", () => window.print());

    document.getElementById("btnUndo").addEventListener("click", undo);
    document.getElementById("btnRedo").addEventListener("click", redo);

    document.getElementById("zoomIn").addEventListener("click", () => setZoom(state.zoom + .1));
    document.getElementById("zoomOut").addEventListener("click", () => setZoom(state.zoom - .1));
    document.getElementById("zoomReset").addEventListener("click", () => setZoom(1));

    workspace.addEventListener("pointerdown", (ev) => {
      if (ev.target === workspace || ev.target.classList.contains("flow-cell")) {
        clearSelection();
      }
    });

    document.addEventListener("keydown", (ev) => {
      const tag = (ev.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || ev.target.isContentEditable;

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        undo();
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        redo();
        return;
      }

      if (!typing && (ev.key === "Delete" || ev.key === "Backspace")) {
        ev.preventDefault();
        deleteSelected();
      }

      if (ev.key === "Escape" && state.connectMode) {
        toggleConnect();
      }
    });

    window.addEventListener("resize", updateWorkspaceHeight);

    const observer = new ResizeObserver(updateWorkspaceHeight);
    observer.observe(document.getElementById("sopTable"));
  }

  function init() {
    seedDemoFlow();
    bindEvents();
    bindEditablePersistence();
    renderAll();
    setZoom(0.78);
    setStatus("Siap mengedit — contoh flowchart sudah dimuat");
  }

  init();
})();
