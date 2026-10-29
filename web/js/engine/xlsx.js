/**
 * Lectura y escritura de libros Excel (.xlsx, Office Open XML) sin bibliotecas.
 * Escritura: hojas con cadenas en línea y números. Lectura: cadenas
 * compartidas, cadenas en línea, números, booleanos y fechas seriales.
 */
import { utf8Decode, utf8Encode } from './bytes.js';
import { readZip, writeZip } from './zip.js';
export function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
        if (e === 'amp')
            return '&';
        if (e === 'lt')
            return '<';
        if (e === 'gt')
            return '>';
        if (e === 'quot')
            return '"';
        if (e === 'apos')
            return "'";
        if (e[1] === 'x')
            return String.fromCodePoint(parseInt(e.slice(2), 16));
        return String.fromCodePoint(parseInt(e.slice(1), 10));
    });
}
export function escapeXml(s) {
    return s
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** Analizador XML suficiente para los archivos de OOXML (sin DTD). */
export function parseXml(xml) {
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) {
            top.text += m[1];
            continue;
        }
        if (m[6] !== undefined) {
            top.text += decodeEntities(m[6]);
            continue;
        }
        if (!m[3])
            continue; // comentario o instrucción
        const name = m[3].includes(':') ? m[3].split(':').pop() : m[3];
        if (m[2] === '/') {
            if (stack.length > 1)
                stack.pop();
            continue;
        }
        const attrs = {};
        const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = ar.exec(m[4] || '')))
            attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
        const node = { name, attrs, children: [], text: '' };
        top.children.push(node);
        if (m[5] !== '/')
            stack.push(node);
    }
    return root;
}
function find(n, name) {
    return n.children.find((c) => c.name === name);
}
function findAll(n, name) {
    const out = [];
    const walk = (x) => { for (const c of x.children) {
        if (c.name === name)
            out.push(c);
        walk(c);
    } };
    walk(n);
    return out;
}
function allText(n) {
    // texto de <t> (ignorando <rPh>, fonética)
    if (n.name === 't')
        return n.text;
    if (n.name === 'rPh')
        return '';
    return n.children.map(allText).join('');
}
// ---------------------------------------------------------------- escritura
export function colName(i) {
    let s = '';
    i++;
    while (i > 0) {
        const r = (i - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        i = Math.floor((i - 1) / 26);
    }
    return s;
}
export function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref);
    if (!m)
        return -1;
    let n = 0;
    for (const ch of m[1])
        n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}
export function sanitizeSheetName(name, used) {
    let s = name.replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
    let base = s, k = 2;
    while (used.has(s.toLowerCase())) {
        const suf = ` (${k++})`;
        s = base.slice(0, 31 - suf.length) + suf;
    }
    used.add(s.toLowerCase());
    return s;
}
function sheetXml(rows) {
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'];
    rows.forEach((r, ri) => {
        out.push(`<row r="${ri + 1}">`);
        r.forEach((v, ci) => {
            if (v === null || v === undefined || v === '')
                return;
            const ref = colName(ci) + (ri + 1);
            const style = ri === 0 ? ' s="1"' : '';
            if (typeof v === 'number' && Number.isFinite(v))
                out.push(`<c r="${ref}"${style}><v>${String(v)}</v></c>`);
            else if (typeof v === 'boolean')
                out.push(`<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`);
            else
                out.push(`<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`);
        });
        out.push('</row>');
    });
    out.push('</sheetData></worksheet>');
    return out.join('');
}
export function writeXlsx(sheets, when = new Date()) {
    const used = new Set();
    const names = sheets.map((s) => sanitizeSheetName(s.name, used));
    const enc = (s) => utf8Encode(s);
    const entries = [
        {
            name: '[Content_Types].xml',
            data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
        },
        {
            name: '_rels/.rels',
            data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
        },
        {
            name: 'xl/workbook.xml',
            data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
        },
        {
            name: 'xl/_rels/workbook.xml.rels',
            data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
        },
        {
            name: 'xl/styles.xml',
            data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`),
        },
        ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.rows)) })),
    ];
    return writeZip(entries, when);
}
/** Fecha serial de Excel (sistema 1900) → ISO 8601. */
export function excelSerialToISO(serial) {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().replace('.000Z', 'Z');
}
export async function readXlsx(buf, inflateRaw) {
    const files = await readZip(buf, inflateRaw);
    const get = (p) => {
        const d = files.get(p);
        return d ? utf8Decode(d) : null;
    };
    const wbXml = get('xl/workbook.xml');
    if (!wbXml)
        throw new Error('El archivo no contiene xl/workbook.xml: no es un libro .xlsx.');
    const wb = parseXml(wbXml);
    const relsXml = get('xl/_rels/workbook.xml.rels');
    const rels = new Map();
    if (relsXml)
        for (const r of findAll(parseXml(relsXml), 'Relationship'))
            rels.set(r.attrs.Id, r.attrs.Target);
    const sstXml = get('xl/sharedStrings.xml');
    const sst = sstXml ? findAll(parseXml(sstXml), 'si').map(allText) : [];
    const sheets = [];
    for (const sh of findAll(wb, 'sheet')) {
        const rid = sh.attrs['r:id'] ?? sh.attrs.id;
        let target = rels.get(rid) ?? '';
        if (target.startsWith('/'))
            target = target.slice(1);
        else
            target = 'xl/' + target.replace(/^\.\//, '');
        const xml = get(target);
        if (!xml)
            continue;
        const doc = parseXml(xml);
        const data = findAll(doc, 'sheetData')[0];
        const rows = [];
        if (data) {
            for (const r of data.children.filter((c) => c.name === 'row')) {
                const ri = r.attrs.r ? parseInt(r.attrs.r, 10) - 1 : rows.length;
                const row = [];
                let next = 0;
                for (const c of r.children.filter((x) => x.name === 'c')) {
                    const ci = c.attrs.r ? colIndex(c.attrs.r) : next;
                    next = ci + 1;
                    const t = c.attrs.t ?? 'n';
                    const v = find(c, 'v')?.text ?? '';
                    let val = '';
                    if (t === 's')
                        val = sst[parseInt(v, 10)] ?? '';
                    else if (t === 'inlineStr')
                        val = allText(find(c, 'is') ?? { name: '', attrs: {}, children: [], text: '' });
                    else if (t === 'b')
                        val = v === '1' ? 'TRUE' : 'FALSE';
                    else
                        val = v;
                    while (row.length < ci)
                        row.push('');
                    row[ci] = val;
                }
                while (rows.length < ri)
                    rows.push([]);
                rows[ri] = row;
            }
        }
        sheets.push({ name: sh.attrs.name ?? `Hoja ${sheets.length + 1}`, rows });
    }
    return sheets;
}
