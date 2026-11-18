# Catálogo CNC (`.nc` / `.c2d`) + Integración Nativa Explorador de Windows & UGS

Catálogo visual para diseños CNC (`.nc`, `.gcode`, `.c2d`, `.dxf`) con control de avance **Rojo / Verde**, renombrado de archivos y carpetas, apertura directa de carpeta y extensión nativa del Explorador de Windows.

---

## Novedades Principales

### 1. Catálogo Web Renovado
- **Separación visual en ROJO y VERDE:**
  - `🔴 FALTA ACTUALIZAR IMAGEN REAL` (borde y etiqueta roja) para diseños sin foto definitiva o solo con vector G-code.
  - `🟢 LISTO · IMAGEN REAL ACTUALIZADA` (borde y etiqueta verde) para diseños ya actualizados.
  - Barra superior con filtros instantáneos: **Todos**, **🔴 Faltan Imagen** y **🟢 Listos con Foto**, además de contadores por cada carpeta y botón manual **✅ Marcar Listo / ⏳ Marcar Pendiente**.
- **Renombrar archivos y carpetas:** botones **✏️ Renombrar Diseño** y **✏️ Renombrar Archivo** conservando extensión, capturas y estado.
- **Abrir carpeta contenedora:** botón **📁 Abrir Carpeta** (en Windows abre `explorer.exe /select` dejando seleccionado exactamente el archivo `.nc`/`.c2d`).
- **Sincronizar fotos a Windows Explorer:** al pegar una captura (`Ctrl+V`) o presionar **🖼️ Sincronizar Explorer**, la foto real se guarda directamente en la carpeta del diseño (`<archivo>.png`, `preview.png`, `folder.jpg`) para que **no necesites abrir esta web nunca más al navegar tus carpetas en Windows**.

### 2. Integración Nativa para Explorador de Windows (`windows_explorer_integration/`)
Sin necesitar tener el catálogo web encendido:
- **Botón en Clic Derecho (`Abrir directo en UGS`):** aparece al hacer clic derecho sobre archivos `.nc`, `.c2d`, `.gcode`, `.ngc`, `.tap`.
- **Panel de Vista Previa (`Alt + P`):** al seleccionar cualquier `.nc` o `.c2d` en el Explorador de Windows, muestra su foto real guardada en la carpeta (o su trazado vectorial G-code en tiempo real indicando si falta la foto).
- **Miniaturas en Iconos Muy Grandes:** cuando pones la vista del Explorador en *Iconos muy grandes / Grandes*, cada archivo `.nc` y `.c2d` muestra la foto real directamente en su icono.

---

## Instalación Rápida en Windows 10 / 11

### Para el usuario
1. Clona o descarga este repositorio en tu PC con Windows.
2. Haz doble clic en `windows_explorer_integration\INSTALAR_EN_WINDOWS.bat` y acepta los permisos de Administrador.
3. Para abrir el catálogo web y terminar de actualizar/asignar fotos, haz doble clic en `INICIAR_CATALOGO_WINDOWS.bat`.

### Prompt directo para tu Agente Antigravity en Windows
Pégale este mensaje a tu Antigravity en Windows junto con la URL de este repositorio:

```text
Clona este repositorio de CatalogoCNC en mi Windows, verifica que Python tenga fastapi, uvicorn y pillow, ejecuta windows_explorer_integration\INSTALAR_EN_WINDOWS.bat para compilar CncShellExtension.dll y registrar en el Explorador de Windows:
1) el clic derecho "Abrir directo en UGS" para .nc/.c2d,
2) el Panel de Vista Previa (Alt+P), y
3) las miniaturas en Iconos Muy Grandes.
Luego sincroniza las capturas a mi carpeta de diseños CNC y levanta INICIAR_CATALOGO_WINDOWS.bat en http://localhost:8090 para probarlo juntos.
```
