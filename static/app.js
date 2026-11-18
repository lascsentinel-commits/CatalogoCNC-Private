// Estado de la aplicación
let catalogData = []; // Colecciones completas
let selectedCollection = 'ambar';
let showOnlyIgnored = false;
let statusFilter = 'all'; // 'all' | 'pending' | 'updated'
let searchQuery = '';
let openFolders = new Set(); // IDs de carpetas desplegadas
let cartItems = {}; // { file_id: { file, design, qty: 1 } }
let activePasteDesignId = null;

// Elementos DOM
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const btnRefresh = document.getElementById('btnRefresh');
const btnSyncWindows = document.getElementById('btnSyncWindows');
const btnToggleIgnored = document.getElementById('btnToggleIgnored');
const ignoredCount = document.getElementById('ignoredCount');
const btnToggleCart = document.getElementById('btnToggleCart');
const cartDrawer = document.getElementById('cartDrawer');
const btnCloseDrawer = document.getElementById('btnCloseDrawer');
const cartItemsList = document.getElementById('cartItemsList');
const cartEmptyState = document.getElementById('cartEmptyState');
const cartCount = document.getElementById('cartCount');
const drawerItemCount = document.getElementById('drawerItemCount');
const totalPiecesCount = document.getElementById('totalPiecesCount');
const btnClearCart = document.getElementById('btnClearCart');
const btnCopyClipboard = document.getElementById('btnCopyClipboard');
const btnDownloadTxt = document.getElementById('btnDownloadTxt');
const toast = document.getElementById('toast');

// Secciones principales
const heroAmbar = document.getElementById('heroAmbar');
const heroGuissel = document.getElementById('heroGuissel');
const tabOtros = document.getElementById('tabOtros');
const currentCollectionTitle = document.getElementById('currentCollectionTitle');
const currentFoldersCount = document.getElementById('currentFoldersCount');
const foldersList = document.getElementById('foldersList');

// Estadísticas y filtros Rojo/Verde
const statFolders = document.getElementById('statFolders');
const statDesigns = document.getElementById('statDesigns');
const statPending = document.getElementById('statPending');
const statReady = document.getElementById('statReady');
const statAmbarFolders = document.getElementById('statAmbarFolders');
const statAmbarDesigns = document.getElementById('statAmbarDesigns');
const statGuisselFolders = document.getElementById('statGuisselFolders');
const statGuisselDesigns = document.getElementById('statGuisselDesigns');

const btnFilterAll = document.getElementById('btnFilterAll');
const btnFilterPending = document.getElementById('btnFilterPending');
const btnFilterReady = document.getElementById('btnFilterReady');
const countFilterAll = document.getElementById('countFilterAll');
const countFilterPending = document.getElementById('countFilterPending');
const countFilterReady = document.getElementById('countFilterReady');

document.addEventListener('DOMContentLoaded', () => {
  loadSavedCart();
  fetchCollections();
  setupEventListeners();
});

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setupEventListeners() {
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    searchQuery = e.target.value.trim();
    clearSearch.style.display = searchQuery ? 'block' : 'none';
    debounceTimer = setTimeout(() => {
      renderCurrentView();
    }, 250);
  });

  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearch.style.display = 'none';
    renderCurrentView();
  });

  btnRefresh.addEventListener('click', async () => {
    showToast('Re-escaneando carpetas, archivos y fotos...');
    btnRefresh.disabled = true;
    try {
      await fetch('/api/refresh-index', { method: 'POST' });
      await fetchCollections();
      showToast('¡Catálogo actualizado!');
    } catch (e) {
      showToast('Error al refrescar catálogo');
    } finally {
      btnRefresh.disabled = false;
    }
  });

  if (btnSyncWindows) {
    btnSyncWindows.addEventListener('click', syncWindowsPreviews);
  }

  btnToggleIgnored.addEventListener('click', () => {
    showOnlyIgnored = !showOnlyIgnored;
    btnToggleIgnored.classList.toggle('active', showOnlyIgnored);
    btnToggleIgnored.textContent = showOnlyIgnored ? '🔙 Ver Catálogo Activo' : `🗑️ Descartados (${ignoredCount.textContent})`;
    renderCurrentView();
  });

  btnToggleCart.addEventListener('click', () => cartDrawer.classList.toggle('open'));
  btnCloseDrawer.addEventListener('click', () => cartDrawer.classList.remove('open'));
  btnClearCart.addEventListener('click', clearCart);
  btnCopyClipboard.addEventListener('click', copyCartToClipboard);
  btnDownloadTxt.addEventListener('click', downloadCartTxt);

  // Escuchar pegado global Ctrl + V
  window.addEventListener('paste', handleGlobalPaste);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.preview-thumb-box')) {
      clearActivePasteBox();
    }
  });
}

function setStatusFilter(mode) {
  statusFilter = mode;
  btnFilterAll.classList.toggle('active', mode === 'all');
  btnFilterPending.classList.toggle('active', mode === 'pending');
  btnFilterReady.classList.toggle('active', mode === 'updated');
  renderCurrentView();
}

// Cargar colecciones desde el backend
async function fetchCollections() {
  try {
    const res = await fetch('/api/collections?filter_type=all');
    const data = await res.json();
    catalogData = data.collections || [];

    const totalPending = data.pending_designs_count ?? 0;
    const totalReady = data.updated_designs_count ?? 0;

    statFolders.textContent = `Carpetas: ${data.total_folders}`;
    statDesigns.textContent = `Diseños: ${data.total_designs}`;
    statPending.textContent = `🔴 Faltan: ${totalPending}`;
    statReady.textContent = `🟢 Listos: ${totalReady}`;
    ignoredCount.textContent = data.ignored_folders_count ?? 0;

    countFilterAll.textContent = totalPending + totalReady;
    countFilterPending.textContent = totalPending;
    countFilterReady.textContent = totalReady;

    const ambarCol = catalogData.find(c => c.id === 'ambar');
    if (ambarCol) {
      statAmbarFolders.textContent = `📁 ${ambarCol.folders_count} Formas`;
      statAmbarDesigns.textContent = `📐 ${ambarCol.total_designs} Diseños`;
    }

    const guisselCol = catalogData.find(c => c.id === 'guissel');
    if (guisselCol) {
      statGuisselFolders.textContent = `📁 ${guisselCol.folders_count} Formas`;
      statGuisselDesigns.textContent = `📐 ${guisselCol.total_designs} Diseños`;
    }

    renderCurrentView();
  } catch (e) {
    foldersList.innerHTML = `<div class="empty-state"><p>Error cargando catálogo: ${escapeHtml(e.message)}</p></div>`;
  }
}

function selectCollection(colId) {
  selectedCollection = colId;
  heroAmbar.classList.toggle('active', colId === 'ambar');
  heroGuissel.classList.toggle('active', colId === 'guissel');
  tabOtros.classList.toggle('active', colId === 'otros');
  renderCurrentView();
}

function getFilteredDesignsForFolder(folder) {
  const q = searchQuery ? searchQuery.toLowerCase() : '';
  return (folder.designs || []).filter(d => {
    const matchIgnored = showOnlyIgnored ? d.is_ignored : !d.is_ignored;
    if (!matchIgnored) return false;

    if (statusFilter === 'pending' && d.is_updated) return false;
    if (statusFilter === 'updated' && !d.is_updated) return false;

    if (q) {
      const mFolder = folder.name.toLowerCase().includes(q);
      const mName = d.name.toLowerCase().includes(q);
      const mBroca = (d.available_brocas || []).some(b => b.toLowerCase().includes(q));
      const mDim = (d.available_dimensions || []).some(dm => dm.toLowerCase().includes(q));
      const mFile = (d.variants || []).some(fi => fi.name.toLowerCase().includes(q));
      if (!(mFolder || mName || mBroca || mDim || mFile)) return false;
    }
    return true;
  });
}

function renderCurrentView() {
  const currentCol = catalogData.find(c => c.id === selectedCollection);
  if (!currentCol) {
    foldersList.innerHTML = '<div class="empty-state"><p>Colección no encontrada</p></div>';
    return;
  }

  let statusLabel = '';
  if (statusFilter === 'pending') statusLabel = ' · 🔴 Solo Faltantes de Imagen';
  if (statusFilter === 'updated') statusLabel = ' · 🟢 Solo Listos con Foto Real';

  currentCollectionTitle.textContent = (showOnlyIgnored
    ? `Carpetas Descartadas de ${currentCol.title}`
    : `Formas y Diseños de ${currentCol.title}`) + statusLabel;

  // Actualizar contadores específicos de la colección actual en la barra de filtros
  let colAll = 0;
  let colPending = 0;
  let colReady = 0;
  currentCol.folders.forEach(f => {
    if (showOnlyIgnored ? !f.is_ignored : f.is_ignored) return;
    (f.designs || []).forEach(d => {
      if (showOnlyIgnored ? !d.is_ignored : d.is_ignored) return;
      colAll++;
      if (d.is_updated) colReady++;
      else colPending++;
    });
  });
  countFilterAll.textContent = colAll;
  countFilterPending.textContent = colPending;
  countFilterReady.textContent = colReady;

  const folders = currentCol.folders.filter(f => {
    if (showOnlyIgnored ? !f.is_ignored : f.is_ignored) return false;
    const filtered = getFilteredDesignsForFolder(f);
    if (filtered.length === 0) return false;
    return true;
  });

  currentFoldersCount.textContent = `${folders.length} formas / carpetas mostradas`;

  if (folders.length === 0) {
    let emptyMsg = 'No se encontraron carpetas con esos criterios.';
    if (statusFilter === 'pending') emptyMsg = '🎉 ¡Excelente! No falta ninguna imagen real en esta colección.';
    if (showOnlyIgnored) emptyMsg = 'No hay carpetas descartadas aquí.';
    foldersList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>${emptyMsg}</p>
      </div>
    `;
    return;
  }

  foldersList.innerHTML = '';

  folders.forEach(folder => {
    const matchingDesigns = getFilteredDesignsForFolder(folder);
    const isOpen = openFolders.has(folder.folder_id) || Boolean(searchQuery) || statusFilter !== 'all';

    const readyInFolder = (folder.designs || []).filter(d => !d.is_ignored && d.is_updated).length;
    const pendingInFolder = (folder.designs || []).filter(d => !d.is_ignored && !d.is_updated).length;

    const wrapper = document.createElement('div');
    wrapper.className = 'folder-card-wrapper';
    wrapper.id = `folder-wrap-${folder.folder_id}`;

    const header = document.createElement('div');
    header.className = 'folder-card-header';
    header.innerHTML = `
      <div class="folder-info-left" onclick="toggleFolderAccordion('${folder.folder_id}')">
        <div class="folder-icon-box">📁</div>
        <div class="folder-title-stack">
          <div class="folder-title-line">
            <span class="folder-name-title">${escapeHtml(folder.name)}</span>
            <span class="folder-designs-badge">${matchingDesigns.length} diseño(s) · ${folder.total_files} archivos</span>
          </div>
          <div class="folder-progress-badges">
            <span class="badge-ready-count">🟢 ${readyInFolder} Listo(s)</span>
            <span class="badge-pending-count">🔴 ${pendingInFolder} Falta(n)</span>
          </div>
        </div>
      </div>
      <div class="folder-actions-right">
        <button class="btn-secondary btn-sm" onclick="openFolderById('${folder.folder_id}', event)" title="Abrir carpeta contenedora">
          📂 Abrir Carpeta
        </button>
        <button class="btn-expand-folder" id="btn-exp-${folder.folder_id}" onclick="toggleFolderAccordion('${folder.folder_id}')">
          ${isOpen ? 'Ocultar ▲' : 'Ver Modelos ▼'}
        </button>
        <button class="btn-danger-outline" onclick="toggleFolderDiscard('${folder.folder_id}', event)" title="Eliminar del catálogo (no del computador)">
          ${folder.is_ignored ? '🔄 Restaurar' : '🗑️ Descartar'}
        </button>
      </div>
    `;

    const accordion = document.createElement('div');
    accordion.className = `folder-models-accordion ${isOpen ? 'open' : ''}`;
    accordion.id = `accordion-${folder.folder_id}`;

    if (isOpen) {
      renderFolderDesigns(folder, accordion, matchingDesigns);
    }

    wrapper.appendChild(header);
    wrapper.appendChild(accordion);
    foldersList.appendChild(wrapper);
  });
}

function toggleFolderAccordion(folderId) {
  const accordion = document.getElementById(`accordion-${folderId}`);
  const btn = document.getElementById(`btn-exp-${folderId}`);

  if (openFolders.has(folderId)) {
    openFolders.delete(folderId);
    if (accordion) accordion.classList.remove('open');
    if (btn) btn.innerHTML = 'Ver Modelos ▼';
  } else {
    openFolders.add(folderId);
    if (accordion) {
      accordion.classList.add('open');
      if (accordion.children.length === 0) {
        const folder = findFolderById(folderId);
        if (folder) renderFolderDesigns(folder, accordion, getFilteredDesignsForFolder(folder));
      }
    }
    if (btn) btn.innerHTML = 'Ocultar ▲';
  }
}

function renderFolderDesigns(folder, container, prefilteredDesigns) {
  container.innerHTML = '';

  const activeDesigns = prefilteredDesigns || getFilteredDesignsForFolder(folder);

  if (activeDesigns.length === 0) {
    container.innerHTML = '<small style="color:var(--text-dim); padding:10px;">No hay modelos disponibles con este filtro en esta carpeta.</small>';
    return;
  }

  activeDesigns.forEach(design => {
    const isReady = Boolean(design.is_updated);
    const statusClass = isReady ? 'card-status-ready' : 'card-status-pending';

    const card = document.createElement('div');
    card.className = `design-model-card ${statusClass} ${isDesignSelected(design) ? 'selected' : ''}`;
    card.id = `model-card-${design.id}`;

    const defaultVariant = design.primary_file || design.variants[0];

    const initialPhoto = (defaultVariant && defaultVariant.has_real_photo && defaultVariant.photo_path)
      ? defaultVariant.photo_path
      : (design.has_real_photo && design.photo_path ? design.photo_path : null);

    let thumbInner = '';
    let hintText = '';
    if (initialPhoto) {
      thumbInner = `
        <img src="/api/image?path=${encodeURIComponent(initialPhoto)}&t=${Date.now()}" alt="${escapeHtml(design.name)}" loading="lazy">
        <span class="thumb-tag tag-photo">📷 FOTO</span>
      `;
      hintText = isReady ? 'Foto real guardada (Ctrl+V cambia)' : 'Foto preliminar (Confirma o pega real)';
    } else if (defaultVariant && defaultVariant.has_gcode) {
      thumbInner = `
        <img src="/api/preview-svg?path=${encodeURIComponent(defaultVariant.path)}" alt="Vector Gcode" loading="lazy">
        <span class="thumb-tag tag-vector">📐 VECTOR</span>
      `;
      hintText = 'Solo vector G-code (Falta foto real)';
    } else {
      thumbInner = `
        <span style="font-size: 2rem;">📐</span>
        <span class="thumb-tag">SIN FOTO</span>
      `;
      hintText = 'Sin vista previa (Falta foto real)';
    }

    const isBoxActive = (activePasteDesignId === design.id);
    const thumbHtml = `
      <div class="preview-thumb-box ${isBoxActive ? 'paste-active' : ''}"
           id="thumb-box-${design.id}"
           onclick="selectBoxForPaste('${design.id}', event)"
           title="Haz clic aquí y presiona Ctrl + V para pegar captura real">
        ${thumbInner}
        ${isBoxActive ? '<div class="paste-overlay-hint">📋 Pega con Ctrl + V</div>' : ''}
      </div>
    `;

    let brocasHtml = '';
    if (design.available_brocas && design.available_brocas.length > 0) {
      brocasHtml = `
        <div class="broca-pills-row">
          <span class="pills-label">Brocas:</span>
          ${design.available_brocas.map(b => `<span class="pill-broca">🔧 ${escapeHtml(b)}</span>`).join('')}
        </div>
      `;
    }

    let dimsHtml = '';
    if (design.available_dimensions && design.available_dimensions.length > 0) {
      dimsHtml = `
        <div class="dims-pills-row">
          <span class="pills-label">Medidas:</span>
          ${design.available_dimensions.map(d => `<span class="pill-dim">📏 ${escapeHtml(d)}</span>`).join('')}
        </div>
      `;
    }

    const selectOptions = (design.variants || []).map(v => {
      const label = `${v.broca} | ${v.dim_label} | ${v.name}`;
      const isPhoto = (v.has_real_photo && v.photo_path) ? '1' : '0';
      const pPath = v.photo_path || '';
      return `<option value="${v.file_id}" data-path="${escapeHtml(v.path)}" data-folder="${escapeHtml(v.folder_path || '')}" data-hasphoto="${isPhoto}" data-photopath="${escapeHtml(pPath)}" data-fileid="${v.file_id}" data-name="${escapeHtml(v.name)}">${escapeHtml(label)}</option>`;
    }).join('');

    const statusBanner = isReady
      ? `<span class="status-pill-ready">🟢 LISTO · IMAGEN REAL ACTUALIZADA</span>`
      : `<span class="status-pill-pending">🔴 FALTA ACTUALIZAR IMAGEN REAL</span>`;

    card.innerHTML = `
      <div class="model-left">
        <input type="checkbox" class="model-checkbox" title="Seleccionar para corte" ${isDesignSelected(design) ? 'checked' : ''} onchange="toggleDesignSelection('${design.id}')">
        <div class="model-details">
          <div class="model-status-banner-row">
            ${statusBanner}
            <button class="btn-status-toggle ${isReady ? 'btn-mark-pending' : 'btn-mark-ready'}"
                    onclick="toggleDesignUpdated('${design.id}', ${!isReady})"
                    title="Cambiar estado visual rojo/verde manualmente">
              ${isReady ? '⏳ Marcar Pendiente (Rojo)' : '✅ Marcar Listo (Verde)'}
            </button>
          </div>

          <div class="model-title-row">
            <span class="model-title">${escapeHtml(design.name)}</span>
            <button class="btn-inline-rename" onclick="renameDesignFolder('${design.id}')" title="Cambiar nombre de la carpeta del diseño">
              ✏️ Renombrar Diseño
            </button>
          </div>

          ${brocasHtml}
          ${dimsHtml}

          <div class="variant-picker-row">
            <label style="font-size:0.75rem; color:var(--text-dim); font-weight:600; white-space:nowrap;">Archivo de corte:</label>
            <select class="variant-select" id="select-var-${design.id}" onchange="changeDesignPreview('${design.id}', this)">
              ${selectOptions}
            </select>
            <button class="btn-inline-rename" onclick="renameSelectedVariantFile('${design.id}')" title="Cambiar el nombre real del archivo .nc o .c2d seleccionado">
              ✏️ Renombrar Archivo
            </button>
          </div>

          <div class="model-actions-row">
            <button class="btn-primary btn-sm" onclick="openSelectedVariantInUGS('${design.id}')">
              🚀 Abrir con UGS
            </button>
            <button class="btn-secondary btn-sm" onclick="triggerScreenCapture('${design.id}')" title="Tomar captura y asignar imagen real">
              📸 Capturar / Pegar
            </button>
            <button class="btn-secondary btn-sm" onclick="openSelectedVariantFolder('${design.id}')" title="Abrir carpeta contenedora y seleccionar archivo">
              📁 Abrir Carpeta
            </button>
            <button class="btn-text-danger btn-sm" onclick="toggleDesignDiscard('${design.id}')" title="Descartar este diseño individual">
              🗑️ Descartar
            </button>
          </div>
        </div>
      </div>
      <div class="model-right">
        ${thumbHtml}
        <small id="thumb-hint-${design.id}" style="color:var(--text-dim); font-size:0.7rem; text-align:center;">
          ${hintText}
        </small>
      </div>
    `;

    container.appendChild(card);
  });
}

function findFolderById(folderId) {
  for (const col of catalogData) {
    const f = col.folders.find(x => x.folder_id === folderId);
    if (f) return f;
  }
  return null;
}

function findDesignById(designId) {
  for (const col of catalogData) {
    for (const f of col.folders) {
      const d = f.designs.find(x => x.id === designId);
      if (d) return d;
    }
  }
  return null;
}

function getSelectedVariantMeta(designId) {
  const selectEl = document.getElementById(`select-var-${designId}`);
  const design = findDesignById(designId);
  if (selectEl && selectEl.selectedIndex >= 0) {
    const opt = selectEl.options[selectEl.selectedIndex];
    return {
      fileId: opt.dataset.fileid || null,
      filePath: opt.dataset.path || null,
      folderPath: opt.dataset.folder || (design ? design.folder_path : null),
      fileName: opt.dataset.name || opt.textContent,
    };
  }
  if (design && design.primary_file) {
    return {
      fileId: design.primary_file.file_id,
      filePath: design.primary_file.path,
      folderPath: design.primary_file.folder_path || design.folder_path,
      fileName: design.primary_file.name,
    };
  }
  return { fileId: null, filePath: null, folderPath: design ? design.folder_path : null, fileName: '' };
}

async function renameSelectedVariantFile(designId) {
  const meta = getSelectedVariantMeta(designId);
  if (!meta.filePath) {
    showToast('No hay archivo seleccionado para renombrar');
    return;
  }
  const currentName = meta.fileName || meta.filePath.split(/[/\\]/).pop();
  const nextName = window.prompt(
    `Escribe el nuevo nombre para el archivo:\n(${currentName})\n(Se conservará automáticamente la extensión si no la escribes)`,
    currentName
  );
  if (!nextName || nextName.trim() === currentName) return;

  try {
    const res = await fetch('/api/rename-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: meta.filePath,
        new_name: nextName.trim(),
        design_id: designId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al renombrar');
    showToast(`✅ Archivo renombrado a: ${data.new_name}`);
    await fetchCollections();
  } catch (e) {
    showToast(`❌ ${e.message}`);
  }
}

async function renameDesignFolder(designId) {
  const design = findDesignById(designId);
  if (!design || !design.folder_path) {
    showToast('No se encontró la carpeta del diseño');
    return;
  }
  const currentFolderName = design.folder_path.split(/[/\\]/).pop() || design.name;
  const nextName = window.prompt(
    `Escribe el nuevo nombre para la carpeta del diseño:\n(${currentFolderName})`,
    currentFolderName
  );
  if (!nextName || nextName.trim() === currentFolderName) return;

  try {
    const res = await fetch('/api/rename-design-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder_path: design.folder_path,
        new_name: nextName.trim(),
        design_id: designId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al renombrar carpeta');
    showToast(`✅ Carpeta renombrada a: ${data.new_name}`);
    await fetchCollections();
  } catch (e) {
    showToast(`❌ ${e.message}`);
  }
}

async function toggleDesignUpdated(designId, targetState) {
  try {
    const res = await fetch('/api/toggle-design-updated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design_id: designId, force_state: targetState }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error cambiando estado');
    showToast(data.is_updated ? '🟢 Marcado como LISTO (Verde)' : '🔴 Marcado como PENDIENTE (Rojo)');
    await fetchCollections();
  } catch (e) {
    showToast(`❌ ${e.message}`);
  }
}

async function syncWindowsPreviews() {
  showToast('Sincronizando imágenes reales a las carpetas de diseño...');
  if (btnSyncWindows) btnSyncWindows.disabled = true;
  try {
    const res = await fetch('/api/sync-windows-previews', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || '¡Fotos sincronizadas para Windows Explorer!');
    await fetchCollections();
  } catch (e) {
    showToast('Error sincronizando imágenes');
  } finally {
    if (btnSyncWindows) btnSyncWindows.disabled = false;
  }
}

async function toggleFolderDiscard(folderId, event) {
  if (event) event.stopPropagation();

  const el = document.getElementById(`folder-wrap-${folderId}`);
  if (el) {
    el.style.transition = 'all 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    setTimeout(() => el.remove(), 250);
  }

  showToast('Carpeta descartada del catálogo (sin tocar tus archivos)');

  try {
    const res = await fetch('/api/toggle-folder-ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId }),
    });
    const data = await res.json();
    ignoredCount.textContent = parseInt(ignoredCount.textContent || 0, 10) + (data.is_ignored ? 1 : -1);
    await fetchCollections();
  } catch (e) {
    showToast('Error al descartar carpeta');
  }
}

async function toggleDesignDiscard(designId) {
  const el = document.getElementById(`model-card-${designId}`);
  if (el) {
    el.style.transition = 'all 0.2s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }

  showToast('Diseño descartado del catálogo');

  try {
    await fetch('/api/toggle-design-ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design_id: designId }),
    });
    await fetchCollections();
  } catch (e) {
    showToast('Error al descartar diseño');
  }
}

function changeDesignPreview(designId, selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  if (!opt) return;

  const filePath = opt.dataset.path;
  const photoPath = opt.dataset.photopath;
  const hasPhoto = opt.dataset.hasphoto === '1';

  const box = document.getElementById(`thumb-box-${designId}`);
  const hintEl = document.getElementById(`thumb-hint-${designId}`);
  if (!box) return;

  if (hasPhoto && photoPath) {
    box.innerHTML = `
      <img src="/api/image?path=${encodeURIComponent(photoPath)}&t=${Date.now()}" alt="Foto del corte" loading="lazy">
      <span class="thumb-tag tag-photo">📷 FOTO</span>
    `;
    if (hintEl) hintEl.textContent = 'Foto real asignada (Ctrl+V cambia)';
  } else if (filePath) {
    box.innerHTML = `
      <img src="/api/preview-svg?path=${encodeURIComponent(filePath)}" alt="Vector Gcode" loading="lazy">
      <span class="thumb-tag tag-vector">📐 VECTOR</span>
    `;
    if (hintEl) hintEl.textContent = 'Solo vector G-code (Falta foto real)';
  }
}

function openSelectedVariantInUGS(designId) {
  const meta = getSelectedVariantMeta(designId);
  if (meta.filePath) {
    showToast(`Abriendo archivo en UGS: ${meta.fileName || meta.filePath.split(/[/\\]/).pop()}`);
    openInUGS(meta.filePath);
  } else {
    showToast('No se encontró archivo de corte para abrir');
  }
}

function openSelectedVariantFolder(designId) {
  const meta = getSelectedVariantMeta(designId);
  if (meta.folderPath || meta.filePath) {
    openFolder(meta.folderPath, meta.filePath);
  } else {
    showToast('No se encontró la carpeta contenedora');
  }
}

function openFolderById(folderId, event) {
  if (event) event.stopPropagation();
  const folder = findFolderById(folderId);
  if (folder && folder.folder_path) {
    openFolder(folder.folder_path, null);
  } else if (folder && folder.designs && folder.designs[0]) {
    openFolder(folder.designs[0].folder_path, null);
  } else {
    showToast('Carpeta no encontrada');
  }
}

function getSelectedVariantFileId(designId) {
  const selectEl = document.getElementById(`select-var-${designId}`);
  if (selectEl && selectEl.selectedIndex >= 0) {
    return selectEl.options[selectEl.selectedIndex].dataset.fileid || null;
  }
  return null;
}

function selectBoxForPaste(designId, event) {
  if (event) event.stopPropagation();
  clearActivePasteBox();
  activePasteDesignId = designId;

  const box = document.getElementById(`thumb-box-${designId}`);
  if (box) {
    box.classList.add('paste-active');
    const hint = document.createElement('div');
    hint.className = 'paste-overlay-hint';
    hint.id = `hint-${designId}`;
    hint.innerHTML = '📋 ¡Presiona Ctrl + V ahora!';
    box.appendChild(hint);
  }
  showToast('Cuadro seleccionado: presiona Ctrl + V para pegar la captura real');
}

function clearActivePasteBox() {
  if (activePasteDesignId) {
    const box = document.getElementById(`thumb-box-${activePasteDesignId}`);
    if (box) {
      box.classList.remove('paste-active');
      const hint = document.getElementById(`hint-${activePasteDesignId}`);
      if (hint) hint.remove();
    }
    activePasteDesignId = null;
  }
}

function handleGlobalPaste(e) {
  if (!activePasteDesignId) return;

  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const index in items) {
    const item = items[index];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = async function(event) {
        uploadBase64Capture(event.target.result, activePasteDesignId);
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
      break;
    }
  }
}

async function uploadBase64Capture(base64Data, designId) {
  showToast('Guardando foto real y sincronizando con la carpeta...');
  const meta = getSelectedVariantMeta(designId);
  try {
    const res = await fetch('/api/save-clipboard-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        design_id: designId,
        file_id: meta.fileId,
        folder_path: meta.folderPath,
        file_path: meta.filePath,
        image_base64: base64Data,
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('🟢 ¡Foto real guardada en catálogo y carpeta (Listo para Windows Explorer)!');
      clearActivePasteBox();
      await fetchCollections();
    }
  } catch (e) {
    showToast('Error guardando captura');
  }
}

async function triggerScreenCapture(designId) {
  const meta = getSelectedVariantMeta(designId);
  selectBoxForPaste(designId);
  showToast('Abriendo herramienta de recorte...');
  try {
    const res = await fetch('/api/trigger-screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        design_id: designId,
        file_id: meta.fileId,
        folder_path: meta.folderPath,
        file_path: meta.filePath,
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('🟢 ¡Captura guardada en catálogo y carpeta!');
      clearActivePasteBox();
      await fetchCollections();
    } else if (data.windows_snip) {
      showToast(data.message);
    } else {
      showToast(data.message || 'Recorta y presiona Ctrl + V sobre la imagen');
    }
  } catch (e) {
    showToast('Recorta con Win+Shift+S y presiona Ctrl + V en el cuadro');
  }
}

async function openInUGS(filePath) {
  showToast('Abriendo en Universal Gcode Sender...');
  try {
    const res = await fetch('/api/open-ugs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath }),
    });
    const data = await res.json();
    showToast(data.message || 'Abierto en UGS');
  } catch (e) {
    showToast('Error al abrir UGS');
  }
}

async function openFolder(folderPath, filePath) {
  try {
    const res = await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath, file_path: filePath || null }),
    });
    const data = await res.json();
    showToast(data.message || 'Carpeta abierta');
  } catch (e) {
    showToast('Error al abrir carpeta');
  }
}

// Carrito de Corte con selección de variante
function toggleDesignSelection(designId) {
  const design = findDesignById(designId);
  if (!design) return;

  const selectEl = document.getElementById(`select-var-${designId}`);
  const selectedFileId = selectEl ? selectEl.value : (design.primary_file ? design.primary_file.file_id : null);
  const selectedVariant = design.variants.find(v => v.file_id === selectedFileId) || design.variants[0];

  if (!selectedVariant) return;

  if (cartItems[selectedVariant.file_id]) {
    delete cartItems[selectedVariant.file_id];
  } else {
    cartItems[selectedVariant.file_id] = {
      file: selectedVariant,
      design: design,
      qty: 1,
    };
  }

  saveCart();
  updateCartUI();
  updateCardSelectionStatus(designId);
}

function isDesignSelected(design) {
  if (!design.variants) return false;
  return design.variants.some(v => Boolean(cartItems[v.file_id]));
}

function updateCardSelectionStatus(designId) {
  const card = document.getElementById(`model-card-${designId}`);
  const design = findDesignById(designId);
  if (card && design) {
    card.classList.toggle('selected', isDesignSelected(design));
  }
}

function clearCart() {
  cartItems = {};
  saveCart();
  updateCartUI();
  renderCurrentView();
  showToast('Lista vaciada');
}

function updateCartUI() {
  const keys = Object.keys(cartItems);
  const count = keys.length;
  cartCount.textContent = count;
  drawerItemCount.textContent = `${count} seleccionados`;

  if (count === 0) {
    cartEmptyState.style.display = 'flex';
    cartItemsList.innerHTML = '';
    totalPiecesCount.textContent = '0';
    return;
  }

  cartEmptyState.style.display = 'none';
  cartItemsList.innerHTML = '';

  let totalPieces = 0;
  keys.forEach(fileId => {
    const item = cartItems[fileId];
    totalPieces += parseInt(item.qty || 1, 10);

    const row = document.createElement('div');
    row.className = 'cart-item-row';
    const dims = item.file.dim_label || 'Medida estándar';

    let thumbSrc = '/static/favicon.png';
    if (item.design.has_real_photo) {
      thumbSrc = `/api/image?path=${encodeURIComponent(item.design.photo_path)}`;
    } else if (item.file.has_gcode) {
      thumbSrc = `/api/preview-svg?path=${encodeURIComponent(item.file.path)}`;
    }

    row.innerHTML = `
      <img src="${thumbSrc}" class="cart-item-thumb" alt="Thumb">
      <div class="cart-item-info">
        <span class="cart-item-title">${escapeHtml(item.design.name)}</span>
        <span class="cart-item-sub">[${escapeHtml(item.file.broca)}] ${escapeHtml(item.file.name)} (${escapeHtml(dims)})</span>
      </div>
      <div class="cart-item-qty">
        <label style="font-size:0.75rem; color:var(--text-dim);">Cant:</label>
        <input type="number" min="1" max="999" value="${item.qty || 1}" onchange="updateItemQty('${fileId}', this.value)">
        <button class="btn-icon" onclick="removeCartItem('${fileId}')" title="Quitar">✕</button>
      </div>
    `;
    cartItemsList.appendChild(row);
  });

  totalPiecesCount.textContent = totalPieces;
}

function updateItemQty(fileId, val) {
  const q = Math.max(1, parseInt(val, 10) || 1);
  if (cartItems[fileId]) {
    cartItems[fileId].qty = q;
    saveCart();
    updateCartUI();
  }
}

function removeCartItem(fileId) {
  delete cartItems[fileId];
  saveCart();
  updateCartUI();
  renderCurrentView();
}

function saveCart() {
  localStorage.setItem('catalogo_cnc_cart', JSON.stringify(cartItems));
}

function loadSavedCart() {
  try {
    const saved = localStorage.getItem('catalogo_cnc_cart');
    if (saved) cartItems = JSON.parse(saved);
  } catch (e) {
    cartItems = {};
  }
  updateCartUI();
}

function copyCartToClipboard() {
  const keys = Object.keys(cartItems);
  if (keys.length === 0) {
    showToast('No hay diseños seleccionados para copiar');
    return;
  }

  let text = '===========================================\n';
  text += '       LISTA DE CORTE CNC SELECCIONADA      \n';
  text += '===========================================\n\n';

  let totalPcs = 0;
  keys.forEach((fileId, idx) => {
    const item = cartItems[fileId];
    const qty = item.qty || 1;
    totalPcs += parseInt(qty, 10);
    const dims = item.file.dim_label || 'Medida estándar';

    text += `${idx + 1}. [Cant: ${qty}] ${item.design.name}\n`;
    text += `   Broca: ${item.file.broca}\n`;
    text += `   Medidas: ${dims}\n`;
    text += `   Archivo: ${item.file.name}\n`;
    text += `   Ruta: ${item.file.path}\n\n`;
  });

  text += '-------------------------------------------\n';
  text += `TOTAL DISEÑOS: ${keys.length} | TOTAL PIEZAS A CORTAR: ${totalPcs}\n`;
  text += '===========================================\n';

  navigator.clipboard.writeText(text).then(() => {
    showToast(`¡Lista copiada al portapapeles! (${totalPcs} piezas)`);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('¡Lista copiada al portapapeles!');
  });
}

function downloadCartTxt() {
  const keys = Object.keys(cartItems);
  if (keys.length === 0) {
    showToast('No hay diseños seleccionados para descargar');
    return;
  }

  let text = 'LISTA DE CORTE CNC\n==================\n\n';
  keys.forEach((fileId, idx) => {
    const item = cartItems[fileId];
    text += `${idx + 1}. [Cant: ${item.qty || 1}] ${item.design.name} [Broca: ${item.file.broca}] (${item.file.dim_label})\n`;
    text += `   Archivo: ${item.file.name}\n   Ruta: ${item.file.path}\n\n`;
  });

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lista_corte_cnc_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

let toastTimeout;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3200);
}
