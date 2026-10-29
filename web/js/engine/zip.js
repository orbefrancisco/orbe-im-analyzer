/**
 * ZIP mínimo para leer y escribir libros .xlsx sin bibliotecas externas.
 *  · Escritura: método 0 (almacenado), CRC-32 correcto.
 *  · Lectura: métodos 0 y 8 (deflate). La descompresión deflate se inyecta
 *    (DecompressionStream en el navegador, zlib en Node) para no depender del entorno.
 */
import { crc32, utf8Decode, utf8Encode } from './bytes.js';
function dosDateTime(d) {
    const y = Math.max(1980, d.getFullYear());
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
        date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}
export function writeZip(entries, when = new Date()) {
    const { time, date } = dosDateTime(when);
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
        const name = utf8Encode(e.name);
        const crc = crc32(e.data);
        const lh = new Uint8Array(30 + name.length);
        const v = new DataView(lh.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0x0800, true); // nombres en UTF-8
        v.setUint16(8, 0, true);
        v.setUint16(10, time, true);
        v.setUint16(12, date, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, e.data.length, true);
        v.setUint32(22, e.data.length, true);
        v.setUint16(26, name.length, true);
        v.setUint16(28, 0, true);
        lh.set(name, 30);
        chunks.push(lh, e.data);
        const ch = new Uint8Array(46 + name.length);
        const c = new DataView(ch.buffer);
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true);
        c.setUint16(12, time, true);
        c.setUint16(14, date, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, e.data.length, true);
        c.setUint32(24, e.data.length, true);
        c.setUint16(28, name.length, true);
        c.setUint32(42, offset, true);
        ch.set(name, 46);
        central.push(ch);
        offset += lh.length + e.data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const a of all) {
        out.set(a, p);
        p += a.length;
    }
    return out;
}
export async function readZip(buf, inflateRaw) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (v.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('No es un archivo ZIP/XLSX válido (falta el directorio central).');
    const n = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const out = new Map();
    for (let k = 0; k < n; k++) {
        if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50)
            throw new Error('Directorio central ZIP corrupto.');
        const method = v.getUint16(p + 10, true);
        const crc = v.getUint32(p + 16, true);
        const csize = v.getUint32(p + 20, true);
        const usize = v.getUint32(p + 24, true);
        const nl = v.getUint16(p + 28, true);
        const xl = v.getUint16(p + 30, true);
        const cl = v.getUint16(p + 32, true);
        const lo = v.getUint32(p + 42, true);
        const name = utf8Decode(buf.subarray(p + 46, p + 46 + nl));
        p += 46 + nl + xl + cl;
        if (v.getUint32(lo, true) !== 0x04034b50)
            throw new Error(`Cabecera local ZIP corrupta en «${name}».`);
        const lnl = v.getUint16(lo + 26, true);
        const lxl = v.getUint16(lo + 28, true);
        const start = lo + 30 + lnl + lxl;
        const raw = buf.subarray(start, start + csize);
        let data;
        if (method === 0)
            data = raw.slice();
        else if (method === 8) {
            if (!inflateRaw)
                throw new Error('Este entorno no puede descomprimir deflate.');
            data = await inflateRaw(raw);
        }
        else
            throw new Error(`Método de compresión ZIP no admitido (${method}) en «${name}».`);
        if (data.length !== usize || crc32(data) !== crc)
            throw new Error(`Comprobación CRC fallida en «${name}».`);
        out.set(name, data);
    }
    return out;
}
