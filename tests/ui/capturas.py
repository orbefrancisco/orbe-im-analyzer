#!/usr/bin/env python3
"""
Capturas de pantalla de la interfaz con Chrome sin ventana (fuera del sandbox de Claude).

Uso (desde la carpeta del proyecto):
    python3 -I tests/ui/capturas.py

Levanta un servidor local en 127.0.0.1, abre cada sección en Chrome headless,
guarda PNG en .tmp/capturas/ y vuelca el DOM final para comprobar textos clave.
"""
import functools
import http.server
import os
import pathlib
import socketserver
import subprocess
import sys
import threading

RAIZ = pathlib.Path(__file__).resolve().parents[2]
WEB = RAIZ / "web"
SALIDA = RAIZ / ".tmp" / "capturas"
CHROME = os.environ.get("CHROME", "google-chrome")


def servidor():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def chrome(args):
    perfil = RAIZ / ".tmp" / "chrome-perfil"
    base = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--user-data-dir=%s" % perfil, "--virtual-time-budget=4000"]
    return subprocess.run(base + args, capture_output=True, text=True, timeout=90)


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    httpd = servidor()
    url = "http://127.0.0.1:%d/" % httpd.server_address[1]
    ok = True
    for nombre, tamano in [("calculadora", "1400,2200"), ("calculadora-movil", "420,2600"), ("metodo", "1200,1800")]:
        destino = SALIDA / ("%s.png" % nombre)
        frag = nombre.split("-")[0]
        r = chrome(["--window-size=%s" % tamano, "--screenshot=%s" % destino, url + "#" + frag])
        print(("OK   " if destino.exists() else "FALLO") + " %s %s" % (destino, r.stderr.strip()[-200:] if not destino.exists() else ""))
        ok &= destino.exists()
    dom = chrome(["--dump-dom", url + "#calculadora"]).stdout
    for texto in ["89.860", "88.740", "3(89.30) − 2(89.58)", "EXHAUSTIVO", "-10.000"]:
        presente = texto in dom
        ok &= presente
        print("%s texto «%s» en el DOM" % ("OK   " if presente else "FALLO", texto))
    httpd.shutdown()
    print("TODO CORRECTO" if ok else "HAY FALLOS")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
