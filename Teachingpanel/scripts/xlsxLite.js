// xlsxLite.js —— 极简 .xlsx 生成器（零依赖）：只写、不读；支持多工作表、列宽、冻结表头、单元格样式、同一格内多种颜色的文字
// 全局命名空间：window.XlsxLite
//
// XlsxLite.build(sheets) -> Uint8Array
//   sheets: [{ name, cols: [列宽（字符数）], freeze: 冻结的行数, rows: [[cell, ...], ...], merges: ['A1:G1'] }]
//   cell:   null | 字符串 | 数字 | { v: 字符串或数字, runs: [{ t, color, bold }], s: 样式 }
//   样式 s: { bold, color: 'RRGGBB', fill: 'RRGGBB', align: 'left'|'center'|'right', size, border: true, signed: true（数字显示为 +2 / -0.5 / 0）, wrap }
// 为什么不用 SheetJS：整个库约 900 KB，而这里只需要「写几张带颜色的表」。
// .xlsx = ZIP 包里的几份 XML；ZIP 用「仅存储、不压缩」方式手写（文件很小，不值得带压缩库）。

(function () {
    'use strict';

    const xml = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    // ---------- ZIP（stored） ----------
    let crcTable = null;
    function crc32(bytes) {
        if (!crcTable) {
            crcTable = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                crcTable[i] = c >>> 0;
            }
        }
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function zip(files) {
        const enc = new TextEncoder();
        const parts = [];
        const central = [];
        let offset = 0;
        const header = (sig, size) => { const b = new Uint8Array(size); const v = new DataView(b.buffer); v.setUint32(0, sig, true); return { b, v }; };
        files.forEach((f) => {
            const name = enc.encode(f.name);
            const data = enc.encode(f.text);
            const crc = crc32(data);
            const local = header(0x04034b50, 30);
            local.v.setUint16(4, 20, true);            // version needed
            local.v.setUint16(6, 0x0800, true);        // UTF-8 文件名
            local.v.setUint16(8, 0, true);             // stored
            local.v.setUint16(10, 0, true); local.v.setUint16(12, 0x21, true);   // 时间 00:00，日期 1980-01-01
            local.v.setUint32(14, crc, true);
            local.v.setUint32(18, data.length, true);
            local.v.setUint32(22, data.length, true);
            local.v.setUint16(26, name.length, true);
            parts.push(local.b, name, data);
            const cd = header(0x02014b50, 46);
            cd.v.setUint16(4, 20, true); cd.v.setUint16(6, 20, true);
            cd.v.setUint16(8, 0x0800, true);
            cd.v.setUint16(12, 0, true); cd.v.setUint16(14, 0x21, true);
            cd.v.setUint32(16, crc, true);
            cd.v.setUint32(20, data.length, true);
            cd.v.setUint32(24, data.length, true);
            cd.v.setUint16(28, name.length, true);
            cd.v.setUint32(42, offset, true);
            central.push(cd.b, name);
            offset += 30 + name.length + data.length;
        });
        const cdSize = central.reduce((n, b) => n + b.length, 0);
        const end = header(0x06054b50, 22);
        end.v.setUint16(8, files.length, true);
        end.v.setUint16(10, files.length, true);
        end.v.setUint32(12, cdSize, true);
        end.v.setUint32(16, offset, true);
        const all = parts.concat(central, [end.b]);
        const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
        let at = 0;
        all.forEach((b) => { out.set(b, at); at += b.length; });
        return out;
    }

    // ---------- 样式表 ----------
    function styleBook() {
        const fonts = ['<font><sz val="11"/><name val="微软雅黑"/></font>'];
        const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
        const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
        const index = new Map();
        const intern = (list, item) => { let i = list.indexOf(item); if (i < 0) { list.push(item); i = list.length - 1; } return i; };
        function id(s) {
            if (!s) return 0;
            const key = JSON.stringify(s);
            if (index.has(key)) return index.get(key);
            const font = intern(fonts, `<font>${s.bold ? '<b/>' : ''}<sz val="${s.size || 11}"/>${s.color ? `<color rgb="FF${s.color}"/>` : ''}<name val="微软雅黑"/></font>`);
            const fill = s.fill ? intern(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
            const align = (s.align || s.wrap) ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''} vertical="center"${s.wrap ? ' wrapText="1"' : ''}/>` : '<alignment vertical="center"/>';
            xfs.push(`<xf numFmtId="${s.signed ? 164 : 0}" fontId="${font}" fillId="${fill}" borderId="${s.border ? 1 : 0}" xfId="0" applyFont="1"${fill ? ' applyFill="1"' : ''}${s.border ? ' applyBorder="1"' : ''}${s.signed ? ' applyNumberFormat="1"' : ''} applyAlignment="1">${align}</xf>`);
            index.set(key, xfs.length - 1);
            return xfs.length - 1;
        }
        function toXml() {
            const side = (n) => `<${n} style="thin"><color rgb="FFD9D9D9"/></${n}>`;
            return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                '<numFmts count="1"><numFmt numFmtId="164" formatCode="+General;-General;0"/></numFmts>' +
                `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
                `<fills count="${fills.length}">${fills.join('')}</fills>` +
                `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border></borders>` +
                '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
                `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
                '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
                '</styleSheet>';
        }
        return { id, toXml };
    }

    function colName(i) {
        let s = '';
        for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
        return s;
    }

    function sheetXml(sheet, styles) {
        const rows = (sheet.rows || []).map((row, r) => {
            const cells = row.map((cell, c) => {
                if (cell == null || cell === '') return '';
                const ref = colName(c) + (r + 1);
                const obj = typeof cell === 'object' ? cell : { v: cell };
                const s = styles.id(obj.s);
                const sAttr = s ? ` s="${s}"` : '';
                if (obj.runs) {
                    const runs = obj.runs.filter((x) => x.t !== '' && x.t != null).map((x) =>
                        `<r><rPr>${x.bold ? '<b/>' : ''}<sz val="11"/>${x.color ? `<color rgb="FF${x.color}"/>` : ''}<rFont val="微软雅黑"/></rPr><t xml:space="preserve">${xml(x.t)}</t></r>`).join('');
                    return runs ? `<c r="${ref}"${sAttr} t="inlineStr"><is>${runs}</is></c>` : (s ? `<c r="${ref}"${sAttr}/>` : '');
                }
                if (typeof obj.v === 'number' && Number.isFinite(obj.v)) return `<c r="${ref}"${sAttr}><v>${obj.v}</v></c>`;
                if (obj.v == null || obj.v === '') return s ? `<c r="${ref}"${sAttr}/>` : '';
                return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xml(obj.v)}</t></is></c>`;
            }).join('');
            return `<row r="${r + 1}">${cells}</row>`;
        }).join('');
        const cols = (sheet.cols || []).length
            ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
        const view = sheet.freeze
            ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
        const merges = (sheet.merges || []).length
            ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}<sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${rows}</sheetData>${merges}</worksheet>`;
    }

    // 工作表名：不能含 \ / ? * [ ] :，最长 31 个字符，不能重复
    function sheetNames(sheets) {
        const used = new Set();
        return sheets.map((s, i) => {
            let name = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`;
            while (used.has(name)) name = name.slice(0, 28) + '_' + (i + 1);
            used.add(name);
            return name;
        });
    }

    function build(sheets) {
        const styles = styleBook();
        const names = sheetNames(sheets);
        const sheetFiles = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s, styles) }));
        const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        const files = [
            { name: '[Content_Types].xml', text: head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
                '</Types>' },
            { name: '_rels/.rels', text: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
            { name: 'xl/workbook.xml', text: head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
                names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
            { name: 'xl/_rels/workbook.xml.rels', text: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
                `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
            { name: 'xl/styles.xml', text: styles.toXml() }
        ].concat(sheetFiles);
        return zip(files);
    }

    window.XlsxLite = { build };
})();
