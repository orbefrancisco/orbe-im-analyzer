# Orbe IM Analyzer

Analizador científico de intermodulación radioeléctrica para monitoreo del espectro (banda FM 88–108 MHz por defecto, configurable).

Aplicación web **local-first**: todo el cálculo se hace en el navegador, sin servidores externos ni dependencias en tiempo de ejecución. El motor matemático está escrito en TypeScript y separado por completo de la interfaz.

> Criterio fundamental: **producto matemáticamente posible ≠ señal observada ≠ producto de intermodulación experimentalmente confirmado.**

## Ejecutar localmente

Los módulos ES y el Web Worker necesitan servirse por HTTP (no funcionan abriendo `index.html` con `file://`):

```bash
cd Apps/Orbe_IM_Analyzer
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
# abrir http://127.0.0.1:8080/
```

(o `npm run serve`). El JavaScript compilado ya está en `web/js/`; no hace falta compilar para usar la aplicación.

### Compilar y probar

```bash
npm install          # instala TypeScript (única dependencia, solo de desarrollo)
npm test             # compila la app (y regenera sw.js) y las pruebas, y ejecuta las 56 pruebas
node scripts/demo.mjs                       # demostración del caso obligatorio en consola
python3 -I tests/reference/brute_force.py   # referencia independiente (Python, fracciones exactas)
python3 -I tests/ui/capturas.py             # capturas con Chrome sin ventana (requiere Chrome)
```

## Secciones

| Sección | Qué hace |
|---|---|
| **Calculadora** | Frecuencias escritas a mano, cálculo inmediato, tabla clásica de dos tonos, comparación rápida con señales observadas. |
| **Analizador de banda** | Lista completa de emisoras (manual, CSV, Excel), selección de generadores, alcance configurable, estimación exacta del espacio de búsqueda, cálculo exhaustivo en un Web Worker con progreso y cancelación. |
| **Auditoría espectral** | Importación de mediciones (exportaciones CSV/XLSX de SCORPIO u otros analizadores) y de trazas de espectro, comparación con tolerancia, clases A–D, todas las hipótesis por señal, evidencias, confirmación, probabilidad de coincidencia fortuita. |
| **Laboratorio RF** | Pruebas de atenuación: variación, pendiente, comparación con IM3/IM5/IM7 y con la hipótesis concreta (Σ\|mᵢ\|·ΔPᵢ), incertidumbres, medidas censuradas por ruido y evaluación de seis mecanismos. |
| **Método y limitaciones** | Documentación científica dentro de la aplicación. |

## Motor matemático (`src/engine/`)

- **Representación exacta**: frecuencias como enteros en hercios (resolución 1 Hz), convertidas desde texto con aritmética decimal entera (`freq.ts`). 89.30 MHz = 89 300 000 Hz exactos; las sumas Σ mᵢfᵢ son exactas.
- **Enumeración general** (`enumerate.ts`): todos los vectores m ∈ ℤᴺ con orden nominal Σ|mᵢ| en [mín, máx] y como mucho T generadores no nulos; un representante por par ±m; poda conservadora por intervalo de salida; almacén compacto en arreglos tipados.
- **Complejidad** (`combinatorics.ts`): conteo exacto previo, Σₖ C(N,k)·2ᵏ⁻¹·Σₛ C(s−1,k−1), con sugerencias de reducción. Si se agota el presupuesto o el límite de combinaciones, el resultado se marca **INCOMPLETO — NO EXHAUSTIVO**.
- **Agrupación** (`results.ts`): combinaciones con frecuencia idéntica se agrupan sin descartar ninguna; filtros por orden, emisoras, tipo, banda y generador.
- **Comparación** (`match.ts`, `classify.ts`): coincidencias enteras inclusivas, todas las hipótesis por señal, fracción de banda cubierta (probabilidad de coincidencia fortuita) y clasificación A/B/C/D con requisitos explícitos.
- **Laboratorio** (`lab.ts`): modelo de pequeña señal ΔP_IM = Σ|mᵢ|·ΔPᵢ, incertidumbres con k = 2, discriminación lineal/no lineal, imagen y media FI, selectividad, saturación.
- **E/S** (`csv.ts`, `importers.ts`, `zip.ts`, `xlsx.ts`, `export.ts`, `project.ts`): CSV RFC 4180, lector/escritor XLSX propio, JSON trazable, informe de auditoría en Markdown, SHA-256 de los archivos importados.

## Formatos de importación

Cualquier tabla CSV/TSV/XLSX con una columna de frecuencia. Las columnas se detectan por la cabecera (Frecuencia/Freq/Frequency [MHz|kHz|Hz], Nivel/Level [dBm|dBµV], Emisora/Nombre, Fecha, Hora, Equipo, Observaciones, Clasificación). La unidad se toma de la cabecera, de la elección del usuario o, en último caso, se infiere y se avisa. Cada fila rechazada se informa con su número. El formato nativo de SCORPIO no es público: exporte desde SCORPIO a CSV o Excel.

## Exportación

CSV de productos, CSV de todas las combinaciones, CSV de coincidencias, Excel con hojas separadas (Parámetros, Generadores, Productos, Combinaciones, Observadas, Coincidencias, Laboratorio, Limitaciones), JSON trazable (`orbe-im-analyzer/analisis@1`: fecha, versión del algoritmo, parámetros, completitud, fuentes con SHA-256, cada combinación con sus coeficientes por identificador de generador) e informe de auditoría. El JSON de análisis puede reimportarse para reproducir el cálculo.

## Validación

- 46 pruebas del motor (`tests/*.test.ts`): caso obligatorio IM3–IM9, fórmulas de 2, 3 y 4 tonos, comparación con un enumerador ingenuo (producto cartesiano completo), conteo exacto de nodos, duplicados exactos, precisión numérica, bordes de banda, filtros, control de complejidad, coincidencias a ±10 / ±9.999 kHz, clases A–D, laboratorio, CSV/XLSX/ZIP/JSON e importaciones malformadas.
- Referencia independiente en Python con `fractions.Fraction` y producto cartesiano completo (`tests/reference/brute_force.py`), comparada caso por caso.
- 7 pruebas de humo de la interfaz compilada sobre un DOM mínimo en Node y 3 de coherencia de la PWA (`tests/ui/`).

## Página web e instalación (PWA)

Dirección: **https://orbefrancisco.github.io/orbe-im-analyzer/**

Es una PWA: en el celular, «Añadir a pantalla de inicio» / «Instalar aplicación»; en la computadora, el botón de instalar de Chrome/Edge o el botón «Instalar aplicación» de la cabecera. Una vez abierta, funciona sin conexión con la copia guardada (`web/sw.js`: red primero y, si no hay red o tarda más de 3 s, la copia). Cuando se publica una versión nueva aparece el botón «Versión nueva: recargar»; no se recarga sola para no perder un análisis en curso.

`web/sw.js` lo genera `scripts/sw.mjs` al compilar: lista todos los archivos de `web/` y su `VERSION` es la huella SHA-256 del contenido, de modo que cualquier cambio publica una versión nueva. Los iconos se regeneran con `python3 -I scripts/iconos.py`.

Publicación: el flujo `.github/workflows/pages.yml` compila, ejecuta todas las pruebas y, solo si pasan, publica `web/` en GitHub Pages en cada `git push` a `main`. El repositorio debe ser público para usar Pages gratis; solo contiene código y el ejemplo, nunca las mediciones del usuario (los proyectos viven en el almacenamiento local de cada navegador).

## Limitaciones

Véanse la sección «Método y limitaciones» de la aplicación y `LIMITATIONS` en `src/engine/export.ts`. En resumen: el orden es nominal (los órdenes n+2, n+4… contribuyen a la misma frecuencia); calculable no implica detectable; coincidir no es confirmar; las pendientes de atenuación solo valen en pequeña señal y con el atenuador antes de la no linealidad; fuera del alcance configurado puede haber otras explicaciones.
