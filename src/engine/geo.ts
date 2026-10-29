/**
 * Geometría geográfica mínima: punto en polígono, distancias y localización
 * administrativa de un punto. Opera sobre la cartografía de web/data/.
 */

export type Ring = [number, number][]; // [lon, lat]
export type Polygon = Ring[]; // anillo exterior + huecos

export interface ProvinceGeo {
  id: string; // ISO 3166-2, p. ej. «DO-01»
  nombre: string;
  nombreFuente: string;
  poligonos: Polygon[];
}

export interface MunicipalityGeo {
  id: string;
  nombre: string;
  provincia: string;
  asignacionProvincia: string;
  centroide: [number, number];
  poligonos: Polygon[];
}

export interface CartoSource {
  nivel: string;
  archivo: string;
  sha256: string;
  boundaryID: string;
  fuenteOriginal: string;
  licencia: string;
  año: string;
  unidades: string;
}

export interface Cartography {
  provincias: ProvinceGeo[];
  municipios: MunicipalityGeo[];
  fuentes: CartoSource[];
  atribucion: string;
  advertencia: string;
}

export function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

export function inPolygons(lon: number, lat: number, polys: Polygon[]): boolean {
  return polys.some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)));
}

/** Distancia de círculo máximo (km), radio medio terrestre 6371.0088 km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Located {
  provinceId: string | null;
  municipalityId: string | null;
  /** «municipio» si el punto cae en un polígono municipal; «provincia» si solo en el provincial. */
  method: 'municipio' | 'provincia' | 'ninguno';
}

/**
 * Localiza un punto. Se prefiere el polígono municipal (más detallado); la
 * provincia es la del municipio. Si no cae en ningún municipio, se usa el
 * contorno provincial.
 */
export function locate(c: Cartography, lat: number, lon: number): Located {
  const m = c.municipios.find((x) => inPolygons(lon, lat, x.poligonos));
  if (m) return { provinceId: m.provincia, municipalityId: m.id, method: 'municipio' };
  const p = c.provincias.find((x) => inPolygons(lon, lat, x.poligonos));
  if (p) return { provinceId: p.id, municipalityId: null, method: 'provincia' };
  return { provinceId: null, municipalityId: null, method: 'ninguno' };
}

export function validateCartography(c: unknown): string[] {
  const e: string[] = [];
  const o = c as Cartography;
  if (!o || !Array.isArray(o.provincias)) return ['Cartografía sin provincias.'];
  const ids = new Set<string>();
  for (const p of o.provincias) {
    if (!/^DO-\d{2}$/.test(p.id)) e.push(`Código de provincia no válido: ${p.id}`);
    ids.add(p.id);
    for (const poly of p.poligonos) for (const ring of poly) for (const pt of ring) {
      if (!(pt[0] > -73 && pt[0] < -67 && pt[1] > 17 && pt[1] < 21)) { e.push(`Coordenada fuera de La Española en ${p.id}`); break; }
    }
  }
  if (ids.size !== 32) e.push(`Se esperaban 32 divisiones (31 provincias y el Distrito Nacional); hay ${ids.size}.`);
  for (const m of o.municipios ?? []) if (!ids.has(m.provincia)) e.push(`Municipio ${m.nombre} con provincia desconocida ${m.provincia}`);
  return e;
}
