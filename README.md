# ObsidIAn · Visor orbital de Marte y planificador de rutas

**ObsidIAn** es una aplicación web progresiva (PWA) 2D/3D para explorar el **Cráter Jezero (Marte)** con fuentes reales de la NASA (MOLA DEM, HRSC, THEMIS IR, Viking, MOC, MRO CTX 5 m y HiRISE 25 cm), planificar rutas evitando pendientes, exportar informes (GeoJSON, GPX, KML, CSV, PNG, PDF, TXT) y simular la telemetría de rovers marcianos (*Perseverance* y *Curiosity*) tanto **con conexión como sin conexión a internet**.

## Ejecutar en local

```bash
npm install
npm run dev
```

Abre `http://localhost:3000` en tu navegador.

## Compilar para producción

```bash
npm run build
```

La compilación optimizada (con Service Worker offline y manifiesto PWA) se genera en `dist/`.

## Publicar gratis en GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `ObsidIAn`) y sube todos los archivos de este proyecto (`git push` o subiendo el contenido del `.zip`).
2. En tu repositorio ve a **Settings → Pages**.
3. En **Source**, selecciona **GitHub Actions**.
4. GitHub ejecutará automáticamente `.github/workflows/deploy.yml` y publicará **ObsidIAn** con soporte de instalación PWA y descarga offline.

## Fuentes y límites de los datos

**Datos NASA** (servidos por NASA Solar System Treks, `trek.nasa.gov`): MOLA, MOLA+HRSC, Viking MDIM 2.1, MOC, THEMIS día/noche, TES albedo y HiRISE 25 cm (solo Jezero). HRSC es de ESA/DLR.

**Datos de misión NASA en servidor de terceros:** la capa CTX 5 m se sirve desde Esri (`astro.arcgis.com`); el mosaico es de Dickson et al. (2018).

**Cálculos propios de la app, no datos NASA:**
- *Ajuste morfológico de Jezero* (`jezeroRelief` en `js/dem.js`): modelo geométrico de borde, delta y valles sumado a MOLA. Para usar solo MOLA, abre la app con `?relieve=mola`.
- *Rovers*: perfiles, velocidad, energía y deslizamiento son una simulación con parámetros estimados, no telemetría. Las variantes «Oro Kapton» y «Nocturno LED» son ficticias.
- *Puntos de interés*: coordenadas transcritas a mano, sin verificar frente a la fuente oficial.

**Calidad de la elevación:** la cota sale de un mosaico MOLA de 8 bits (≈1,3 km por píxel, ≈115 m por nivel de gris). Las pendientes son orientativas y no sirven para decidir el tránsito de un vehículo real.

La procedencia está centralizada en `js/sources.js`; pantalla e informes leen de ahí.
