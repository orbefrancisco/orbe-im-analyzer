#!/usr/bin/env python3
"""
Referencia independiente para Orbe IM Analyzer.

Recalcula los productos de intermodulación con aritmética racional exacta
(fractions.Fraction a partir del texto decimal) y un producto cartesiano
completo de coeficientes en [-K, K]^N, sin poda ni optimización alguna, y
compara el resultado con el que produjo el motor TypeScript.

Uso:
    python3 -I brute_force.py --check casos.json   # compara con el motor
    python3 -I brute_force.py --demo               # imprime el caso obligatorio
"""
import itertools
import json
import sys
from fractions import Fraction

MHZ = Fraction(10) ** 6


def mhz_to_hz(text):
    """Texto decimal en MHz -> Fraction en Hz (exacto)."""
    return Fraction(text) * MHZ


def fmt_mhz(hz):
    """Hz enteros -> texto exacto en MHz con 3 decimales mínimos."""
    s = "%d.%06d" % (hz // 10**6, hz % 10**6)
    return s.rstrip("0") if len(s.rstrip("0").split(".")[1]) >= 3 else s[: s.index(".") + 4]


def products(freqs_mhz, max_order, max_tones, harmonics, lo_mhz, hi_mhz, min_order=2):
    f = [mhz_to_hz(x) for x in freqs_mhz]
    lo, hi = mhz_to_hz(lo_mhz), mhz_to_hz(hi_mhz)
    n = len(f)
    out = []
    for m in itertools.product(range(-max_order, max_order + 1), repeat=n):
        order = sum(abs(c) for c in m)
        tones = sum(1 for c in m if c)
        if order < min_order or order > max_order or tones == 0 or tones > max_tones:
            continue
        if not harmonics and tones == 1:
            continue
        s = sum(c * fi for c, fi in zip(m, f))
        if s <= 0:  # representante con suma positiva; descarta -m y la continua
            continue
        if s < lo or s > hi:
            continue
        # el motor cuantiza a 1 Hz; aquí exigimos que el valor exacto sea entero
        if s.denominator != 1:
            raise ValueError("frecuencia no entera en Hz: %s" % s)
        out.append((int(s), tuple(m)))
    return sorted(out)


def check(path):
    cases = json.load(open(path, encoding="utf-8"))
    ok = True
    for c in cases:
        ref = products(c["freqs"], c["maxOrder"], c["maxTones"], c["harmonics"], c["range"][0], c["range"][1])
        got = sorted((int(p[0]), tuple(p[1])) for p in c["products"])
        same = ref == got
        ok &= same
        print("%-60s ref=%6d motor=%6d  %s" % (c["name"], len(ref), len(got), "OK" if same else "DIFERENCIA"))
        if not same:
            print("  solo en referencia:", sorted(set(ref) - set(got))[:10])
            print("  solo en motor:     ", sorted(set(got) - set(ref))[:10])
    print("TODOS LOS CASOS COINCIDEN" if ok else "HAY DIFERENCIAS")
    return 0 if ok else 1


def demo():
    res = products(["89.30", "89.58"], 9, 2, True, "88", "108")
    print("f1 = 89.30 MHz, f2 = 89.58 MHz, banda 88-108 MHz, orden <= 9")
    for hz, m in res:
        order = sum(abs(c) for c in m)
        print("  IM%d  %s MHz   m = %s" % (order, fmt_mhz(hz), m))
    s = mhz_to_hz("89.30") + mhz_to_hz("89.58") - mhz_to_hz("90.10")
    print("f1 + f2 - f3 = %s MHz" % fmt_mhz(int(s)))
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--check":
        sys.exit(check(sys.argv[2]))
    sys.exit(demo())
