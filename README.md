# file_transfer

Transfiere archivos entre macOS y dispositivos Android vía USB con una interfaz nativa construida con **Tauri 2** (Rust + TypeScript/Vite).

## Características

- **Explorador dual** — Navega archivos locales (macOS) y remotos (Android) en paneles paralelos
- **Push / Pull** — Copia archivos en ambas direcciones con barra de progreso en tiempo real
- **Operaciones de archivos** — Crea, renombra y elimina carpetas/archivos en ambos lados
- **Selección múltiple** — Selecciona varios archivos para copiar o eliminar
- **Rutas editables** — Navegación por breadcrumbs o escritura manual de ruta
- **Espacio en disco** — Muestra almacenamiento disponible local y remotamente
- **Overlay de ayuda** — Guía paso a paso para activar depuración USB en Android

## Requisitos

- **macOS**
- **Android** con **depuración USB** habilitada
- **ADB** (`adb` debe estar disponible en el `PATH` o se detecta automáticamente en `~/Library/Android/sdk/platform-tools/`)

## Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd file_transfer

# Instalar dependencias del frontend
npm install

# Compilar y ejecutar en modo desarrollo
npm run tauri dev
```

Para generar un binario:

```bash
npm run tauri build
```

## Desarrollo

### Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | TypeScript, Vite 6 |
| Backend | Rust con Tauri 2 y Tokio |
| Comunicación | IPC via `@tauri-apps/api/core` |
| Eventos en tiempo real | Eventos Tauri para progreso de transferencias |

### Estructura del proyecto

```
src/
├── main.ts          # Punto de entrada
├── types.ts         # Interfaces compartidas
├── state.ts         # Estado global y referencias DOM
├── ui.ts            # Utilidades de UI (formateo, breadcrumbs, discos)
├── local.ts         # Explorador de archivos local
├── remote.ts        # Explorador de archivos remoto (Android)
├── devices.ts       # Detección y selección de dispositivos
├── transfers.ts     # Push / Pull con barra de progreso
├── modals.ts        # Diálogos modales (confirm, rename, create)
└── styles.css       # Estilos completos

src-tauri/src/
├── lib.rs           # Registro de comandos
├── types.rs         # Structs compartidos (ProgressPayload, Device, etc.)
├── adb.rs           # Conexión ADB (dispositivos, connect, pair, tcpip)
├── fs.rs            # Operaciones de archivos (list, create, delete, rename)
├── transfer.rs      # Push / Pull con parseo de progreso
└── disks.rs         # Información de almacenamiento (df)
```
