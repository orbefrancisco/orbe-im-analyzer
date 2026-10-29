#!/usr/bin/env python3
"""
Genera los iconos de la PWA (PNG) sin bibliotecas externas: fondo azul marino,
tres portadoras (barras altas) y productos de intermodulación (barras bajas)
alrededor, sobre una línea base. Supermuestreo 4x para suavizar bordes.

Uso: python3 -I scripts/iconos.py   (escribe en web/)
"""
import pathlib
import struct
import zlib

WEB = pathlib.Path(__file__).resolve().parents[1] / "web"
FONDO = (11, 26, 51)        # #0B1A33
PORTADORA = (240, 239, 236)  # tinta clara
PRODUCTO = (57, 135, 229)    # azul serie 1 (oscuro)
BASE = (137, 135, 129)


def png(path, w, h, pixels):
    raw = b"".join(b"\x00" + bytes(pixels[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(data)


def figura(u, v, maskable):
    """Color en coordenadas normalizadas (0..1) o None si transparente."""
    # zona segura: el icono maskable se dibuja más pequeño (80 %)
    s = 0.62 if maskable else 0.78
    x = (u - 0.5) / s + 0.5
    y = (v - 0.5) / s + 0.5
    if not maskable:
        # cuadrado redondeado
        r = 0.18
        dx = max(abs(u - 0.5) - (0.5 - r), 0)
        dy = max(abs(v - 0.5) - (0.5 - r), 0)
        if dx * dx + dy * dy > r * r:
            return None
    base_y = 0.80
    if base_y <= y <= base_y + 0.035 and 0.08 <= x <= 0.92:
        return BASE
    barras = [
        (0.20, 0.42, PRODUCTO), (0.30, 0.15, PORTADORA), (0.40, 0.25, PORTADORA),
        (0.50, 0.55, PRODUCTO), (0.62, 0.10, PORTADORA), (0.74, 0.50, PRODUCTO), (0.84, 0.62, PRODUCTO),
    ]
    for cx, top, col in barras:
        ancho = 0.035 if col is PORTADORA else 0.028
        if abs(x - cx) <= ancho and top <= y < base_y:
            return col
        # marcador redondo sobre cada producto teórico
        if col is PRODUCTO and (x - cx) ** 2 + (y - (top - 0.06)) ** 2 <= 0.045 ** 2:
            return col
    return FONDO


def render(size, maskable=False, ss=4):
    px = bytearray(size * size * 4)
    n = ss * ss
    for j in range(size):
        for i in range(size):
            acc = [0, 0, 0, 0]
            for sj in range(ss):
                for si in range(ss):
                    c = figura((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size, maskable)
                    if c is not None:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            k = (j * size + i) * 4
            a = acc[3] / n
            if a:
                cov = acc[3] / 255
                px[k:k + 4] = bytes((round(acc[0] / cov), round(acc[1] / cov), round(acc[2] / cov), round(a)))
    return px


def svg():
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="18" fill="#0B1A33"/>
<g transform="translate(11 11) scale(.78)">
<rect x="8" y="80" width="84" height="3.5" fill="#898781"/>
<g fill="#F0EFEC"><rect x="26.5" y="15" width="7" height="65"/><rect x="36.5" y="25" width="7" height="55"/><rect x="58.5" y="10" width="7" height="70"/></g>
<g fill="#3987E5"><rect x="17.2" y="42" width="5.6" height="38"/><circle cx="20" cy="36" r="4.5"/><rect x="47.2" y="55" width="5.6" height="25"/><circle cx="50" cy="49" r="4.5"/>
<rect x="71.2" y="50" width="5.6" height="30"/><circle cx="74" cy="44" r="4.5"/><rect x="81.2" y="62" width="5.6" height="18"/><circle cx="84" cy="56" r="4.5"/></g>
</g></svg>
"""


if __name__ == "__main__":
    for nombre, tam, mask in [("icono-192.png", 192, False), ("icono-512.png", 512, False), ("icono-maskable-512.png", 512, True)]:
        png(WEB / nombre, tam, tam, render(tam, mask, ss=3 if tam > 200 else 4))
        print("escrito", WEB / nombre)
    (WEB / "icono.svg").write_text(svg(), encoding="utf-8")
    print("escrito", WEB / "icono.svg")
