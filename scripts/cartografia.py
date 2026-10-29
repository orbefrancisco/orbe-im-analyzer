#!/usr/bin/env python3
"""
Prepara la cartografía de República Dominicana para la aplicación.

Entradas (descargadas de geoBoundaries, gbOpen, en GitHub):
  .tmp/adm1.geojson, .tmp/adm1-meta.json  — 32 provincias (ISO 3166-2 DO-01..DO-32), fuente Natural Earth, dominio público
  .tmp/adm2.geojson, .tmp/adm2-meta.json  — 155 municipios, fuente Caribbean GeoPortal, CC BY 4.0

Salidas:
  web/data/rd-provincias.json  — contornos provinciales (lon, lat con 4 decimales ≈ 11 m)
  web/data/rd-municipios.json  — municipios: nombre, provincia (por centroide), centroide y contornos simplificados

Uso: python3 -I scripts/cartografia.py
Los archivos de entrada se tratan solo como datos (json); no se ejecuta nada de ellos.
"""
import datetime
import hashlib
import json
import math
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[1]
TMP = RAIZ / ".tmp"
OUT = RAIZ / "web" / "data"

URL_BASE = "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/DOM/"

# Nombres oficiales por código ISO 3166-2 (coinciden con la codificación provincial de la ONE).
PROVINCIAS = {
    "DO-01": "Distrito Nacional", "DO-02": "Azua", "DO-03": "Bahoruco", "DO-04": "Barahona",
    "DO-05": "Dajabón", "DO-06": "Duarte", "DO-07": "Elías Piña", "DO-08": "El Seibo",
    "DO-09": "Espaillat", "DO-10": "Independencia", "DO-11": "La Altagracia", "DO-12": "La Romana",
    "DO-13": "La Vega", "DO-14": "María Trinidad Sánchez", "DO-15": "Monte Cristi", "DO-16": "Pedernales",
    "DO-17": "Peravia", "DO-18": "Puerto Plata", "DO-19": "Hermanas Mirabal", "DO-20": "Samaná",
    "DO-21": "San Cristóbal", "DO-22": "San Juan", "DO-23": "San Pedro de Macorís", "DO-24": "Sánchez Ramírez",
    "DO-25": "Santiago", "DO-26": "Santiago Rodríguez", "DO-27": "Valverde", "DO-28": "Monseñor Nouel",
    "DO-29": "Monte Plata", "DO-30": "Hato Mayor", "DO-31": "San José de Ocoa", "DO-32": "Santo Domingo",
}
# Nombres de la fuente que difieren del oficial (antiguos o abreviados).
ALIAS = {"La Estrelleta": "Elías Piña", "Hermanas": "Hermanas Mirabal", "El Seybo": "El Seibo"}


def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def polygons(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    raise ValueError("geometría no admitida: %s" % geom["type"])


def dp(points, tol):
    """Douglas-Peucker (iterativo) sobre una lista de [lon, lat]."""
    if len(points) < 4:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def ring_out(ring, tol):
    r = dp(ring, tol) if tol else ring
    if len(r) < 4:
        r = ring
    out = [[round(x, 4), round(y, 4)] for x, y in r]
    dedup = [out[0]]
    for p in out[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if dedup[0] != dedup[-1]:
        dedup.append(dedup[0])
    return dedup


def area_centroid(ring):
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        c = x1 * y2 - x2 * y1
        a += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    a *= 0.5
    if abs(a) < 1e-12:
        return ring[0], 0.0
    return [cx / (6 * a), cy / (6 * a)], abs(a)


def in_ring(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def in_polys(pt, polys):
    for poly in polys:
        if in_ring(pt, poly[0]) and not any(in_ring(pt, h) for h in poly[1:]):
            return True
    return False


def main():
    fuentes = []
    for nivel in ("adm1", "adm2"):
        g, m = TMP / ("%s.geojson" % nivel), TMP / ("%s-meta.json" % nivel)
        if not g.exists() or not m.exists():
            sys.exit("Faltan %s y %s (descárguelos de %s)" % (g, m, URL_BASE))
        meta = json.loads(m.read_text(encoding="utf-8"))
        fuentes.append({
            "nivel": nivel.upper(),
            "archivo": URL_BASE + ("%s/geoBoundaries-DOM-%s_simplified.geojson" % (nivel.upper(), nivel.upper())),
            "sha256": sha256(g),
            "boundaryID": meta.get("boundaryID"),
            "fuenteOriginal": meta.get("boundarySource"),
            "licencia": meta.get("boundaryLicense"),
            "año": meta.get("boundaryYear"),
            "unidades": meta.get("admUnitCount"),
        })
    adm1 = json.loads((TMP / "adm1.geojson").read_text(encoding="utf-8"))
    adm2 = json.loads((TMP / "adm2.geojson").read_text(encoding="utf-8"))

    provs = []
    vistos = set()
    for f in adm1["features"]:
        p = f["properties"]
        iso = p["shapeISO"]
        nombre_fuente = p["shapeName"].strip()
        oficial = PROVINCIAS.get(iso)
        if not oficial:
            sys.exit("Código ISO inesperado: %s" % iso)
        if ALIAS.get(nombre_fuente, nombre_fuente) != oficial:
            sys.exit("Nombre de %s no coincide: fuente «%s», oficial «%s»" % (iso, nombre_fuente, oficial))
        vistos.add(iso)
        polys = [[ring_out(r, 0) for r in poly] for poly in polygons(f["geometry"])]
        provs.append({"id": iso, "nombre": oficial, "nombreFuente": nombre_fuente, "poligonos": polys, "_raw": polygons(f["geometry"])})
    if vistos != set(PROVINCIAS):
        sys.exit("Faltan provincias: %s" % sorted(set(PROVINCIAS) - vistos))

    munis = []
    sin_prov = []
    for i, f in enumerate(adm2["features"]):
        nombre = " ".join(f["properties"]["shapeName"].split())
        raw = polygons(f["geometry"])
        # centroide del anillo exterior de mayor área
        best_c, best_a = None, -1
        for poly in raw:
            c, a = area_centroid(poly[0])
            if a > best_a:
                best_c, best_a = c, a
        prov = next((p["id"] for p in provs if in_polys(best_c, p["_raw"])), None)
        metodo = "centroide"
        if prov is None:
            # el centroide cae fuera de los contornos provinciales gruesos: se asigna la provincia más próxima
            def dist(p):
                return min(math.hypot(best_c[0] - x, best_c[1] - y) for poly in p["_raw"] for x, y in poly[0])
            prov = min(provs, key=dist)["id"]
            metodo = "proximidad"
            sin_prov.append(nombre)
        polys = [[ring_out(r, 0.0015) for r in poly] for poly in raw]
        munis.append({
            "id": "M%03d" % (i + 1), "nombre": nombre, "provincia": prov, "asignacionProvincia": metodo,
            "centroide": [round(best_c[0], 5), round(best_c[1], 5)], "poligonos": polys,
        })

    for p in provs:
        del p["_raw"]
    hoy = datetime.date.today().isoformat()
    OUT.mkdir(parents=True, exist_ok=True)
    comun = {
        "generado": hoy,
        "procesado": "scripts/cartografia.py: coordenadas redondeadas a 4 decimales; municipios simplificados (Douglas-Peucker 0.0015°); provincia del municipio por centroide",
        "fuentes": fuentes,
        "atribucion": "geoBoundaries (Runfola et al., 2020, PLoS ONE 15(4): e0231866); provincias: Natural Earth (dominio público); municipios: Caribbean GeoPortal (CC BY 4.0).",
        "advertencia": "Cartografía de referencia para visualización. No es la cartografía oficial de la ONE; los contornos provinciales (escala 1:10 000 000) son aproximados cerca de los límites.",
    }
    (OUT / "rd-provincias.json").write_text(json.dumps({**comun, "provincias": provs}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "rd-municipios.json").write_text(json.dumps({**comun, "municipios": munis}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    por_prov = {}
    for m in munis:
        por_prov[m["provincia"]] = por_prov.get(m["provincia"], 0) + 1
    print("provincias:", len(provs), "· municipios:", len(munis), "· asignados por proximidad:", sin_prov)
    print("municipios por provincia:", {PROVINCIAS[k]: v for k, v in sorted(por_prov.items())})
    for n in ("rd-provincias.json", "rd-municipios.json"):
        print(n, (OUT / n).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
