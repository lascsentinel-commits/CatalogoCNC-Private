// Estado de la aplicación
let catalogData = []; // Colecciones completas
let selectedCollection = 'ambar';
let showOnlyIgnored = false;
let searchQuery = '';
let openFolders = new Set(); // IDs de carpetas desplegadas
let cartItems = {}; // { file_id: { file, design, qty: 1 } }
let activePasteDesignId = null;

// Elementos DOM
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const btnRefresh = document.getElementById('btnRefresh');
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

// Estadísticas
const statFolders = document.getElementById('statFolders');
const statDesigns = document.getElementById('statDesigns');
const statAmbarFolders = document.getElementById('statAmbarFolders');
const statAmbarDesigns = document.getElementById('statAmbarDesigns');
const statGuisselFolders = document.getElementById('statGuisselFolders');
const statGuisselDesigns = document.getElementById('statGuisselDesigns');

document.addEventListener('DOMContentLoaded', () => {
  loadSavedCart();
  fetchCollections();
  setupEventListeners();
});

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
    showToast('Re-escaneando y unificando diseños...');
    btnRefresh.disabled = true;
    try {
      await fetch('/api/refresh-index', { method: 'POST' });
      await fetchCollections();
      showToast('¡Catálogo actualizado!');
    } catch (e) {
      showToast('Error al refrescar');
    } finally {
      btnRefresh.disabled = false;
    }
  });

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

// Cargar colecciones desde el backend
async function fetchCollections() {
  try {
    const res = await fetch('/api/collections?filter_type=all');
    const data = await res.json();
    catalogData = data.collections;

    statFolders.textContent = `Carpetas: ${data.total_folders}`;
    statDesigns.textContent = `Diseños: ${data.total_designs}`;
    ignoredCount.textContent = data.ignored_folders_count;

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
    foldersList.innerHTML = `<div class="empty-state"><p>Error cargando catálogo: ${e.message}</p></div>`;
  }
}

function selectCollection(colId) {
  selectedCollection = colId;
  heroAmbar.classList.toggle('active', colId === 'ambar');
  heroGuissel.classList.toggle('active', colId === 'guissel');
  tabOtros.classList.toggle('active', colId === 'otros');
  renderCurrentView();
}

function renderCurrentView() {
  const currentCol = catalogData.find(c => c.id === selectedCollection);
  if (!currentCol) {
    foldersList.innerHTML = '<div class="empty-state"><p>Colección no encontrada</p></div>';
    return;
  }

  currentCollectionTitle.textContent = showOnlyIgnored ? 
    `Carpetas Descartadas de ${currentCol.title}` : 
    `Formas y Diseños de ${currentCol.title}`;

  let folders = currentCol.folders.filter(f => showOnlyIgnored ? f.is_ignored : !f.is_ignored);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    folders = folders.filter(f => {
      const matchName = f.name.toLowerCase().includes(q);
      const matchDesign = f.designs.some(d => 
        d.name.toLowerCase().includes(q) || 
        d.available_brocas.some(b => b.toLowerCase().includes(q)) ||
        d.available_dimensions.some(dm => dm.toLowerCase().includes(q)) ||
        d.variants.some(fi => fi.name.toLowerCase().includes(q))
      );
      return matchName || matchDesign;
    });
  }

  currentFoldersCount.textContent = `${folders.length} formas / carpetas disponibles`;

  if (folders.length === 0) {
    foldersList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>${showOnlyIgnored ? 'No hay carpetas descartadas aquí.' : 'No se encontraron carpetas con ese nombre.'}</p>
      </div>
    `;
    return;
  }

  foldersList.innerHTML = '';

  folders.forEach(folder => {
    const isOpen = openFolders.has(folder.folder_id) || Boolean(searchQuery);
    const wrapper = document.createElement('div');
    wrapper.className = 'folder-card-wrapper';
    wrapper.id = `folder-wrap-${folder.folder_id}`;

    const header = document.createElement('div');
    header.className = 'folder-card-header';
    header.innerHTML = `
      <div class="folder-info-left" onclick="toggleFolderAccordion('${folder.folder_id}')">
        <div class="folder-icon-box">📁</div>
        <div>
          <span class="folder-name-title">${folder.name}</span>
          <span class="folder-designs-badge">${folder.designs_count} diseño(s) unificado(s) · ${folder.total_files} archivos</span>
        </div>
      </div>
      <div class="folder-actions-right">
        <button class="btn-expand-folder" id="btn-exp-${folder.folder_id}" onclick="toggleFolderAccordion('${folder.folder_id}')">
          ${isOpen ? 'Ocultar / Recoger ▲' : 'Ver Modelos ▼'}
        </button>
        <button class="btn-danger-outline" onclick="toggleFolderDiscard('${folder.folder_id}', event)" title="Eliminar del catálogo (no del computador)">
          ${folder.is_ignored ? '🔄 Restaurar' : '🗑️ Descartar Carpeta'}
        </button>
      </div>
    `;

    const accordion = document.createElement('div');
    accordion.className = `folder-models-accordion ${isOpen ? 'open' : ''}`;
    accordion.id = `accordion-${folder.folder_id}`;

    if (isOpen) {
      renderFolderDesigns(folder, accordion);
    }

    wrapper.appendChild(header);
    wrapper.appendChild(accordion);
    foldersList.appendChild(wrapper);
  });
}

// Alternar Desplegar / Recoger (Ocultar)
function toggleFolderAccordion(folderId) {
  const accordion = document.getElementById(`accordion-${folderId}`);
  const btn = document.getElementById(`btn-exp-${folderId}`);
  
  if (openFolders.has(folderId)) {
    // RECOGER / OCULTAR
    openFolders.delete(folderId);
    if (accordion) accordion.classList.remove('open');
    if (btn) btn.innerHTML = 'Ver Modelos ▼';
  } else {
    // DESPLEGAR
    openFolders.add(folderId);
    if (accordion) {
      accordion.classList.add('open');
      if (accordion.children.length === 0) {
        const folder = findFolderById(folderId);
        if (folder) renderFolderDesigns(folder, accordion);
      }
    }
    if (btn) btn.innerHTML = 'Ocultar / Recoger ▲';
  }
}

// Renderizar Diseños Unificados (Nivel 3)
function renderFolderDesigns(folder, container) {
  container.innerHTML = '';

  const activeDesigns = folder.designs.filter(d => showOnlyIgnored ? d.is_ignored : !d.is_ignored);

  if (activeDesigns.length === 0) {
    container.innerHTML = '<small style="color:var(--text-dim); padding:10px;">No hay modelos disponibles en esta carpeta.</small>';
    return;
  }

  activeDesigns.forEach(design => {
    const card = document.createElement('div');
    card.className = `design-model-card ${isDesignSelected(design) ? 'selected' : ''}`;
    card.id = `model-card-${design.id}`;

    // Archivo de corte por defecto / inicial
    const defaultVariant = design.primary_file || design.variants[0];

    // Determinar la foto o vector para la vista previa inicial
    let initialPhoto = (defaultVariant && defaultVariant.has_real_photo && defaultVariant.photo_path) 
      ? defaultVariant.photo_path 
      : (design.has_real_photo && design.photo_path ? design.photo_path : null);

    let thumbInner = '';
    let hintText = '';
    if (initialPhoto) {
      thumbInner = `
        <img src="/api/image?path=${encodeURIComponent(initialPhoto)}" alt="${design.name}" loading="lazy">
        <span class="thumb-tag tag-photo">📷 FOTO</span>
      `;
      hintText = 'Foto asignada (Ctrl+V cambia)';
    } else if (defaultVariant && defaultVariant.has_gcode) {
      thumbInner = `
        <img src="/api/preview-svg?path=${encodeURIComponent(defaultVariant.path)}" alt="Vector Gcode" loading="lazy">
        <span class="thumb-tag tag-vector">📐 VECTOR</span>
      `;
      hintText = 'Vector Top-Down (Ctrl+V foto)';
    } else {
      thumbInner = `
        <span style="font-size: 2rem;">📐</span>
        <span class="thumb-tag">SIN FOTO</span>
      `;
      hintText = 'Sin vista previa';
    }

    const isBoxActive = (activePasteDesignId === design.id);
    const thumbHtml = `
      <div class="preview-thumb-box ${isBoxActive ? 'paste-active' : ''}" 
           id="thumb-box-${design.id}" 
           onclick="selectBoxForPaste('${design.id}', event)" 
           title="Haz clic aquí y presiona Ctrl + V para pegar captura de UGS">
        ${thumbInner}
        ${isBoxActive ? '<div class="paste-overlay-hint">📋 Pega con Ctrl + V</div>' : ''}
      </div>
    `;

    // Badges de Brocas disponibles
    let brocasHtml = '';
    if (design.available_brocas && design.available_brocas.length > 0) {
      brocasHtml = `
        <div class="broca-pills-row">
          <span class="pills-label">Brocas:</span>
          ${design.available_brocas.map(b => `<span class="pill-broca">🔧 ${b}</span>`).join('')}
        </div>
      `;
    }

    // Badges de Medidas disponibles
    let dimsHtml = '';
    if (design.available_dimensions && design.available_dimensions.length > 0) {
      dimsHtml = `
        <div class="dims-pills-row">
          <span class="pills-label">Medidas:</span>
          ${design.available_dimensions.map(d => `<span class="pill-dim">📏 ${d}</span>`).join('')}
        </div>
      `;
    }

    // Selector de variantes (para cambiar vista previa y abrir en UGS)
    let selectOptions = design.variants.map((v, i) => {
      const label = `${v.broca} | ${v.dim_label} | ${v.name}`;
      const isPhoto = (v.has_real_photo && v.photo_path) ? '1' : '0';
      const pPath = v.photo_path || '';
      return `<option value="${v.file_id}" data-path="${v.path}" data-hasphoto="${isPhoto}" data-photopath="${pPath}" data-fileid="${v.file_id}" data-name="${v.name}">${label}</option>`;
    }).join('');

    card.innerHTML = `
      <div class="model-left">
        <input type="checkbox" class="model-checkbox" title="Seleccionar para corte" ${isDesignSelected(design) ? 'checked' : ''} onchange="toggleDesignSelection('${design.id}')">
        <div class="model-details">
          <span class="model-title">${design.name}</span>
          ${brocasHtml}
          ${dimsHtml}

          <div class="variant-picker-row">
            <label style="font-size:0.75rem; color:var(--text-dim); font-weight:600;">Archivo de corte:</label>
            <select class="variant-select" id="select-var-${design.id}" onchange="changeDesignPreview('${design.id}', this)">
              ${selectOptions}
            </select>
          </div>

          <div class="model-actions-row">
            <button class="btn-primary btn-sm" onclick="openSelectedVariantInUGS('${design.id}')">
              🚀 Abrir con UGS
            </button>
            <button class="btn-secondary btn-sm" onclick="triggerScreenCapture('${design.id}')" title="Tomar captura de pantalla de UGS">
              📸 Recortar Captura
            </button>
            <button class="btn-secondary btn-sm" onclick="openFolder('${design.folder_path}')" title="Abrir carpeta">
              📁 Carpeta
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

// Descartar Carpeta con respuesta visual INMEDIATA (0 ms)
async function toggleFolderDiscard(folderId, event) {
  if (event) event.stopPropagation();

  // Ocultar de inmediato el elemento del DOM con animación
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
      body: JSON.stringify({ folder_id: folderId })
    });
    const data = await res.json();
    ignoredCount.textContent = parseInt(ignoredCount.textContent || 0) + (data.is_ignored ? 1 : -1);
    await fetchCollections();
  } catch (e) {
    showToast('Error al descartar carpeta');
  }
}

// Descartar Diseño individual con respuesta visual inmediata
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
      body: JSON.stringify({ design_id: designId })
    });
    await fetchCollections();
  } catch (e) {
    showToast('Error al descartar diseño');
  }
}

// Cambiar la vista previa al elegir otra variante de broca/medida
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
      <img src="/api/image?path=${encodeURIComponent(photoPath)}" alt="Foto del corte" loading="lazy">
      <span class="thumb-tag tag-photo">📷 FOTO</span>
    `;
    if (hintEl) hintEl.textContent = 'Foto asignada (Ctrl+V cambia)';
  } else if (filePath) {
    box.innerHTML = `
      <img src="/api/preview-svg?path=${encodeURIComponent(filePath)}" alt="Vector Gcode" loading="lazy">
      <span class="thumb-tag tag-vector">📐 VECTOR</span>
    `;
    if (hintEl) hintEl.textContent = 'Vector Top-Down (Ctrl+V foto)';
  }
}

function openSelectedVariantInUGS(designId) {
  const selectEl = document.getElementById(`select-var-${designId}`);
  let filePath = null;
  let fileName = '';
  if (selectEl && selectEl.selectedIndex >= 0) {
    const opt = selectEl.options[selectEl.selectedIndex];
    filePath = opt.dataset.path;
    fileName = opt.dataset.name || opt.textContent;
  }
  if (!filePath) {
    const design = findDesignById(designId);
    if (design && design.primary_file) {
      filePath = design.primary_file.path;
      fileName = design.primary_file.name;
    }
  }
  if (filePath) {
    showToast(`Abriendo archivo en UGS: ${fileName || filePath.split('/').pop()}`);
    openInUGS(filePath);
  } else {
    showToast('No se encontró archivo de corte para abrir');
  }
}

function getSelectedVariantFileId(designId) {
  const selectEl = document.getElementById(`select-var-${designId}`);
  if (selectEl && selectEl.selectedIndex >= 0) {
    return selectEl.options[selectEl.selectedIndex].dataset.fileid || null;
  }
  return null;
}

// Foco en cuadro de imagen para pegar con Ctrl + V
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
  showToast('Cuadro seleccionado: presiona Ctrl + V para pegar la captura');
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
  for (let index in items) {
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
  showToast('Guardando captura pegada...');
  const fileId = getSelectedVariantFileId(designId);
  try {
    const res = await fetch('/api/save-clipboard-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        design_id: designId,
        file_id: fileId,
        image_base64: base64Data
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('¡Foto asignada exitosamente al modelo y archivo de corte!');
      clearActivePasteBox();
      await fetchCollections();
    }
  } catch (e) {
    showToast('Error guardando captura');
  }
}

async function triggerScreenCapture(designId) {
  showToast('Haz clic y arrastra un recuadro para recortar la captura de UGS...');
  const fileId = getSelectedVariantFileId(designId);
  try {
    const res = await fetch('/api/trigger-screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        design_id: designId,
        file_id: fileId
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('¡Captura guardada y asignada al corte!');
      await fetchCollections();
    } else {
      showToast(data.message || 'Captura no guardada');
    }
  } catch (e) {
    showToast('Error al capturar pantalla');
  }
}

async function openInUGS(filePath) {
  showToast('Abriendo en Universal Gcode Sender...');
  try {
    const res = await fetch('/api/open-ugs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });
    const data = await res.json();
    showToast(data.message || 'Abierto en UGS');
  } catch (e) {
    showToast('Error al abrir UGS');
  }
}

async function openFolder(folderPath) {
  try {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath })
    });
    showToast('Carpeta abierta en Thunar');
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
      qty: 1
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
        <span class="cart-item-title">${item.design.name}</span>
        <span class="cart-item-sub">[${item.file.broca}] ${item.file.name} (${dims})</span>
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
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
}
