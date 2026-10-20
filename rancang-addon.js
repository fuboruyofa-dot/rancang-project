/* =====================================================================
   RANCANG ADD-ON v3  (tempel SEBELUM </body>, sesudah script utama)
   - Dokumen proposal disusun dari satu model (IR) -> HTML/PDF dan Word .docx asli
   - .docx mengikuti template: kop di semua halaman, sampul, daftar isi bernomor,
     penomoran 1. / 1.1 / 1.1.1, tabel, gambar, footer + nomor halaman
   - Generate dokumen penuh dengan AI (urut, konteks antar-section, penanda [PERLU DIISI])
   ===================================================================== */
(function () {
'use strict';

/* ---------- 1. Teks ringan (markdown subset) ---------- */
const GAP_RE = /\[PERLU DIISI[^\]]*\]/g;
function parseMd(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n'), out = []; let i = 0, m;
  const isTbl = l => /^\s*\|.*\|\s*$/.test(l), isUl = l => /^\s*[-*•]\s+/.test(l), isOl = l => /^\s*\d+[.)]\s+/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if ((m = l.match(/^\s*#{1,2}\s+(.+)$/))) { out.push({k: 'h2', text: m[1].trim()}); i++; continue; }
    if ((m = l.match(/^\s*#{3,6}\s+(.+)$/))) { out.push({k: 'h3', text: m[1].trim()}); i++; continue; }
    if (isTbl(l)) { const rows = []; while (i < lines.length && isTbl(lines[i])) { const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim()); if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells); i++; } if (rows.length) out.push({k: 'table', head: rows[0], rows: rows.slice(1), align: rows[0].map(() => 'l')}); continue; }
    if (isUl(l)) { const items = []; while (i < lines.length && isUl(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '').trim()); i++; } out.push({k: 'ul', items}); continue; }
    if (isOl(l)) { const items = []; while (i < lines.length && isOl(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim()); i++; } out.push({k: 'ol', items}); continue; }
    out.push({k: 'p', text: l.trim()}); i++;
  }
  return out;
}
/* inline: **tebal**, *miring*, [PERLU DIISI: ...] */
function inlineTokens(s) {
  const out = []; let last = 0, m; const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[PERLU DIISI[^\]]*\])/g; s = String(s || '');
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({t: s.slice(last, m.index)});
    const x = m[0];
    if (x.startsWith('**')) out.push({t: x.slice(2, -2), b: true}); else if (x.startsWith('[')) out.push({t: x, gap: true}); else out.push({t: x.slice(1, -1), i: true});
    last = m.index + x.length;
  }
  if (last < s.length) out.push({t: s.slice(last)});
  return out.length ? out : [{t: ''}];
}
const inlineHtml = s => inlineTokens(s).map(t => { let h = esc(t.t); if (t.b) h = `<b>${h}</b>`; if (t.i) h = `<i>${h}</i>`; if (t.gap) h = `<mark class="gap">${h}</mark>`; return h; }).join('');
window.txt2html = function (t) { return parseMd(t).map(n => n.k === 'p' ? `<p>${inlineHtml(n.text)}</p>` : n.k === 'ul' ? `<ul>${n.items.map(x => `<li>${inlineHtml(x)}</li>`).join('')}</ul>` : n.k === 'ol' ? `<ol class="l">${n.items.map(x => `<li>${inlineHtml(x)}</li>`).join('')}</ol>` : `<p><b>${inlineHtml(n.text || '')}</b></p>`).join(''); };

/* ---------- 2. Model dokumen (IR) ---------- */
function docIR(snap, c) {
  const out = [];
  c.sections.filter(s => s.enabled).forEach(s => {
    const o = s.opts || {};
    out.push({k: 'h1', text: String(s.title).toUpperCase()});
    out.push(...parseMd(s.text));
    if (s.key === 'background') {
      snap.study.docs.filter(d => (o.docs || []).includes(d.id)).forEach(d => { out.push({k: 'h2', text: d.title}); out.push(...parseMd(d.content)); });
    } else if (s.key === 'design_parameter') {
      if (o.lists) [['Persyaratan desain', snap.study.requirements], ['Batasan desain', snap.study.constraints], ['Fitur alat', snap.study.features]].forEach(([t, a]) => { if (a && a.length) { out.push({k: 'h4', text: t}); out.push({k: 'ol', items: a}); } });
      snap.design.categories.filter(cat => (o.cats || []).includes(cat.name)).forEach(cat => {
        out.push({k: 'h2', text: cat.name});
        if (cat.docs.length) out.push({k: 'ul', items: cat.docs.map(d => `${d.title} (v${d.version})${d.notes ? ' – ' + d.notes : ''}`)});
        if (cat.components.length) out.push({k: 'table', head: ['Komponen', 'Spesifikasi', 'Jumlah'], rows: cat.components.map(i => [i.name, i.spec || '-', `${i.qty} ${i.unit || ''}`.trim()]), widths: [32, 48, 20], align: ['l', 'l', 'r']});
      });
    } else if (s.key === 'timeline') {
      if (o.chart) out.push({k: 'chart'});
      if (o.table && snap.timeline.length) { const tw = snap.timeline.reduce((a, t) => a + t.weight, 0) || 1;
        out.push({k: 'table', head: ['Kegiatan', 'PIC', 'Mulai', 'Selesai', 'Bobot %'], rows: snap.timeline.map(t => [(t.group ? t.group + ' › ' : '') + t.name, t.pic || '-', fmtDate(t.start_date), fmtDate(t.end_date), (t.weight / tw * 100).toFixed(2).replace('.', ',')]), widths: [40, 20, 14, 14, 12], align: ['l', 'l', 'l', 'l', 'r']}); }
    } else if (s.key === 'deliverables') {
      const sys = snap.rab.systems.filter(x => (o.systems || []).includes(x.id));
      if (o.rab && sys.length && snap.rab.items.length) { out.push({k: 'h2', text: 'Rancangan Anggaran Biaya'}); out.push({k: 'rab', sys, items: snap.rab.items}); }
      if (o.comparison && sys.length > 1) { out.push({k: 'h2', text: 'Komparasi Sistem'}); sys.forEach(x => out.push({k: 'sysbox', sys: x})); }
    } else if (s.key === 'references' && o.attachments) {
      const files = snap.design.categories.flatMap(cat => cat.docs.filter(d => d.file_name).map(d => `${cat.name}: ${d.title} (${d.file_name})`));
      if (files.length) { out.push({k: 'h4', text: 'Lampiran dokumen teknis'}); out.push({k: 'ul', items: files}); }
    }
    (s.images || []).forEach(i => out.push({k: 'figure', ref: i.ref, caption: i.caption}));
  });
  return out;
}
const idr = v => v ? Number(v).toLocaleString('id-ID') : '';

/* ---------- 3. Render HTML (preview & cetak PDF) ---------- */
function irHtml(nodes, ctx) {
  let n = 0, sub = 0, s3 = 0, fig = 0;
  const imgOf = ref => ctx.imgSrc(ref), snap = ctx.snap;
  return nodes.map(x => {
    switch (x.k) {
      case 'h1': n++; sub = 0; s3 = 0; return `<h2 class="sh">${n}. ${esc(x.text)}</h2>`;
      case 'h2': sub++; s3 = 0; return `<h3 class="ss">${n}.${sub} ${inlineHtml(x.text)}</h3>`;
      case 'h3': s3++; return `<h4 class="s3">${n}.${sub}.${s3} ${inlineHtml(x.text)}</h4>`;
      case 'h4': return `<h4>${inlineHtml(x.text)}</h4>`;
      case 'p': return `<p>${inlineHtml(x.text)}</p>`;
      case 'ul': return `<ul>${x.items.map(t => `<li>${inlineHtml(t)}</li>`).join('')}</ul>`;
      case 'ol': return `<ol class="l">${x.items.map(t => `<li>${inlineHtml(t)}</li>`).join('')}</ol>`;
      case 'table': { const w = x.widths || x.head.map(() => 100 / x.head.length); return `<table class="dt"><tr>${x.head.map((h, i) => `<th style="width:${w[i]}%" class="${x.align[i] === 'r' ? 'r' : ''}">${inlineHtml(h)}</th>`).join('')}</tr>${x.rows.map(r => `<tr>${r.map((c, i) => `<td class="${x.align[i] === 'r' ? 'r' : ''}">${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`; }
      case 'chart': return ctx.chartHTML ? `<div class="chart">${ctx.chartHTML}</div>` : '';
      case 'figure': { const src = imgOf(x.ref); if (!src) return ''; const im = snap.images.find(y => y.id === x.ref); fig++; return `<figure><img src="${src}"${ctx.imgAttr || ''} alt=""><figcaption>Gambar ${fig}. ${esc(x.caption || (im ? im.label : ''))}</figcaption></figure>`; }
      case 'rab': { const sys = x.sys, cols = 2 + sys.length * 2, grp = [...new Set(x.items.map(i => i.category))], w1 = Math.max(18, 100 - 12 - sys.length * 24);
        return `<p class="note">Nilai dalam Rupiah.</p><table class="dt rabt"><tr><th rowspan="2" style="width:${w1}%">Komponen</th><th rowspan="2" class="r" style="width:12%">Harga satuan</th>${sys.map(s => `<th colspan="2">${esc(s.name)}${s.is_selected ? ' ✓' : ''}</th>`).join('')}</tr><tr>${sys.map(() => '<th class="r" style="width:6%">Jml</th><th class="r" style="width:18%">Total</th>').join('')}</tr>
        ${grp.map(g => `<tr class="g"><td colspan="${cols}">${esc(g)}</td></tr>${x.items.filter(i => i.category === g).map(i => `<tr><td>${esc(i.name)}${i.spec ? `<br><small>${esc(i.spec)}</small>` : ''}</td><td class="r">${idr(i.price)}</td>${sys.map(s => { const q = i.qty[s.id] || 0; return `<td class="r">${q ? q + (i.unit ? ' ' + esc(i.unit) : '') : ''}</td><td class="r">${idr(q * i.price)}</td>`; }).join('')}</tr>`).join('')}`).join('')}
        <tr class="tot"><td colspan="2">TOTAL ANGGARAN</td>${sys.map(s => `<td></td><td class="r">${idr(s.total)}</td>`).join('')}</tr></table>`; }
      case 'sysbox': { const s = x.sys; return `<div class="sys"><b>${esc(s.name)}</b>${s.is_selected ? ' (dipilih)' : ''} – ${rupiah(s.total)}${s.description ? `<p>${esc(s.description)}</p>` : ''}${s.images.map(r => { const src = imgOf(r); return src ? `<figure><img src="${src}"${ctx.imgAttr ? ' width="300"' : ''} alt=""></figure>` : ''; }).join('')}${s.pros ? `<p><b>Kelebihan:</b> ${esc(s.pros)}</p>` : ''}${s.cons ? `<p><b>Kekurangan:</b> ${esc(s.cons)}</p>` : ''}</div>`; }
      default: return '';
    }
  }).join('');
}

/* ---------- 4. Render DOCX asli ---------- */
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const xe = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const TW = 9648;  // lebar teks (Letter 12240 - kiri 1152 - kanan 1440)
function R(text, o = {}) { return `<w:r><w:rPr>${o.b ? '<w:b/><w:bCs/>' : ''}${o.i ? '<w:i/><w:iCs/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ''}${o.hl ? '<w:highlight w:val="yellow"/>' : ''}${o.u ? '<w:u w:val="single"/>' : ''}</w:rPr><w:t xml:space="preserve">${xe(text)}</w:t></w:r>`; }
const runsOf = (s, base = {}) => inlineTokens(s).map(t => R(t.t, {...base, b: base.b || t.b, i: base.i || t.i, hl: t.gap})).join('');
function P(inner, o = {}) {
  const num = o.num ? `<w:numPr><w:ilvl w:val="${o.num[1]}"/><w:numId w:val="${o.num[0]}"/></w:numPr>` : '';
  const bdr = o.bottom ? `<w:pBdr><w:bottom w:val="single" w:sz="${o.bottom}" w:space="1" w:color="000000"/></w:pBdr>` : '';
  const tabs = o.tabs ? `<w:tabs>${o.tabs.map(t => `<w:tab w:val="${t[0]}" w:pos="${t[1]}"/>`).join('')}</w:tabs>` : '';
  const sp = (o.before != null || o.after != null || o.line) ? `<w:spacing${o.before != null ? ` w:before="${o.before}"` : ''}${o.after != null ? ` w:after="${o.after}"` : ''}${o.line ? ` w:line="${o.line}" w:lineRule="auto"` : ''}/>` : '';
  const ind = o.left != null ? `<w:ind w:left="${o.left}"${o.hanging ? ` w:hanging="${o.hanging}"` : ''}/>` : '';
  return `<w:p><w:pPr>${o.keepNext ? '<w:keepNext/>' : ''}${o.pb ? '<w:pageBreakBefore/>' : ''}${num}${bdr}${tabs}${sp}${ind}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}</w:pPr>${inner}</w:p>`;
}
function bytesOf(dataUrl) { const b64 = dataUrl.split(',')[1] || '', bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function imgSize(u) {
  if (u[0] === 0x89 && u[1] === 0x50) return {w: (u[16] << 24 | u[17] << 16 | u[18] << 8 | u[19]) >>> 0, h: (u[20] << 24 | u[21] << 16 | u[22] << 8 | u[23]) >>> 0, ext: 'png'};
  if (u[0] === 0xFF && u[1] === 0xD8) { let i = 2; while (i < u.length) { if (u[i] !== 0xFF) { i++; continue; } const mk = u[i + 1]; if (mk >= 0xC0 && mk <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(mk)) return {h: u[i + 5] << 8 | u[i + 6], w: u[i + 7] << 8 | u[i + 8], ext: 'jpeg'}; i += 2 + (u[i + 2] << 8 | u[i + 3]); } }
  return null;
}
async function toPngIfNeeded(dataUrl) {
  if (/^data:image\/(png|jpeg|jpg);/.test(dataUrl)) return dataUrl;
  return new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); res(c.toDataURL('image/png')); }; im.onerror = () => res(null); im.src = dataUrl; });
}
const EMU = 914400;
function ensureJSZip() {
  if (window.JSZip) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = res; s.onerror = () => rej(new Error('Pustaka JSZip gagal dimuat. Pastikan perangkat terhubung ke internet.')); document.head.appendChild(s); });
}

async function buildDocx(pr) {
  await ensureJSZip();
  const snap = pr.source_snapshot, c = propContent(pr), set = tplSettings(), m = c.meta || {};
  const media = [], docRels = [], hdrRels = []; let relN = 20, picN = 0;
  const addImage = async (dataUrl, rels) => {
    if (!dataUrl) return null; dataUrl = await toPngIfNeeded(dataUrl); if (!dataUrl) return null;
    const u = bytesOf(dataUrl), sz = imgSize(u); if (!sz || !sz.w || !sz.h) return null;
    const name = `image${media.length + 1}.${sz.ext === 'jpeg' ? 'jpeg' : 'png'}`; media.push({name, u});
    const id = 'rId' + (++relN); rels.push({id, target: 'media/' + name}); return {id, w: sz.w, h: sz.h};
  };
  const drawing = (im, maxWIn, maxHIn) => {
    let w = im.w / 96, h = im.h / 96; const k = Math.min(1, maxWIn / w, maxHIn / h); w *= k; h *= k;
    const cx = Math.round(w * EMU), cy = Math.round(h * EMU), id = ++picN;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${im.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  /* gambar yang dipakai dokumen */
  const nodes = docIR(snap, c), imgs = {};
  const refs = new Set(); nodes.forEach(n => { if (n.k === 'figure') refs.add(n.ref); if (n.k === 'sysbox') n.sys.images.forEach(r => refs.add(r)); });
  for (const ref of refs) { const im = snap.images.find(x => x.id === ref); if (!im) continue; try { const d = await toDataURL(im.path); if (d) imgs[ref] = await addImage(d, docRels); } catch (e) {} }
  const model = schedModel(snap.timeline); let chart = null;
  if (model && nodes.some(n => n.k === 'chart')) { const png = await svgToPng(inlineSvg(scurveSVG(model))); if (png) chart = await addImage(png, docRels); }
  const kop = await addImage(set.kop_image || set.logo, hdrRels), cover = await addImage(set.cover_image, docRels);

  /* --- tabel --- */
  const border = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders>';
  const TC = (w, inner, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.vm ? `<w:vMerge${o.vm === 'restart' ? ' w:val="restart"' : ''}/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
  const cellP = (text, o = {}) => P(runsOf(text, {b: o.b, sz: o.sz || 18}), {jc: o.jc || 'left', before: 20, after: 20});
  const TBL = (grid, rows) => `<w:tbl><w:tblPr><w:tblW w:w="${grid.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${border}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid.map(g => `<w:gridCol w:w="${g}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>` + P('', {after: 80});
  const HEAD = 'B8CCE4', GRP = 'EEF2F9';
  const simpleTable = x => { const tot = x.widths ? 100 : x.head.length, w = (x.widths || x.head.map(() => 1)).map(v => Math.round(v / (x.widths ? 100 : x.head.length) * TW)); w[w.length - 1] += TW - w.reduce((a, b) => a + b, 0);
    const jc = i => x.align[i] === 'r' ? 'right' : 'left';
    return TBL(w, `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${x.head.map((h, i) => TC(w[i], cellP(h, {b: true, jc: 'center'}), {fill: HEAD})).join('')}</w:tr>` + x.rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((cx, i) => TC(w[i], cellP(cx, {jc: jc(i)}))).join('')}</w:tr>`).join('')); };
  const rabTable = x => {
    const sys = x.sys, per = [440, 880], priceW = 900, nameW = Math.max(1700, TW - priceW - sys.length * (per[0] + per[1]));
    const grid = [nameW, priceW, ...sys.flatMap(() => per)], sc = 16, grp = [...new Set(x.items.map(i => i.category))];
    const cp = (t, o = {}) => P(runsOf(t, {b: o.b, sz: sc}), {jc: o.jc || 'left', before: 10, after: 10});
    const h1 = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${TC(nameW, cp('Komponen', {b: true, jc: 'center'}), {fill: HEAD, vm: 'restart'})}${TC(priceW, cp('Harga satuan', {b: true, jc: 'center'}), {fill: HEAD, vm: 'restart'})}${sys.map(s => TC(per[0] + per[1], cp(s.name + (s.is_selected ? ' ✓' : ''), {b: true, jc: 'center'}), {fill: HEAD, span: 2})).join('')}</w:tr>`;
    const h2 = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${TC(nameW, P('', {after: 0}), {fill: HEAD, vm: 'cont'})}${TC(priceW, P('', {after: 0}), {fill: HEAD, vm: 'cont'})}${sys.map(() => TC(per[0], cp('Jml', {b: true, jc: 'center'}), {fill: HEAD}) + TC(per[1], cp('Total', {b: true, jc: 'center'}), {fill: HEAD})).join('')}</w:tr>`;
    const body = grp.map(g => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${TC(grid.reduce((a, b) => a + b, 0), cp(g, {b: true}), {fill: GRP, span: grid.length})}</w:tr>` + x.items.filter(i => i.category === g).map(i =>
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>${TC(nameW, P(runsOf(i.name, {sz: sc}), {before: 10, after: 10}) + (i.spec ? P(runsOf(i.spec, {sz: 13, color: '555555'}), {before: 0, after: 10}) : ''))}${TC(priceW, cp(idr(i.price), {jc: 'right'}))}${sys.map(s => { const q = i.qty[s.id] || 0; return TC(per[0], cp(q ? String(q) : '', {jc: 'right'})) + TC(per[1], cp(idr(q * i.price), {jc: 'right'})); }).join('')}</w:tr>`).join('')).join('');
    const tot = `<w:tr><w:trPr><w:cantSplit/></w:trPr>${TC(nameW + priceW, cp('TOTAL ANGGARAN', {b: true}), {fill: GRP, span: 2})}${sys.map(s => TC(per[0], cp('', {}), {fill: GRP}) + TC(per[1], cp(idr(s.total), {b: true, jc: 'right'}), {fill: GRP})).join('')}</w:tr>`;
    return P(runsOf('Nilai dalam Rupiah.', {i: true, sz: 16}), {before: 0, after: 40}) + TBL(grid, h1 + h2 + body + tot);
  };

  /* --- isi dokumen --- */
  let body = '', figN = 0; const BODY = {left: 720, jc: 'both', line: 264, after: 120};
  let listId = 10; const numDefs = [];
  const en = c.sections.filter(s => s.enabled);
  /* sampul */
  body += P(R(set.doc_title || 'PROJECT PLAN DOCUMENT', {b: true, sz: 40}), {bottom: 24, after: 120, line: 240});
  body += P(R(snap.project.name, {sz: 32}), {after: 240, line: 240});
  if (cover) body += P(drawing(cover, 4.2, 3.6), {jc: 'center', after: 240});
  const metaCell = (inner, w) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
  const noB = '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>';
  body += `<w:tbl><w:tblPr><w:tblW w:w="${TW}" w:type="dxa"/>${noB}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4300"/><w:gridCol w:w="5348"/></w:tblGrid>`
    + `<w:tr>${metaCell(P(R('Prepared by:', {sz: 28}), {jc: 'right', after: 0}), 4300)}${metaCell(P(R('  ' + (m.prepared_by || ''), {sz: 28, u: true}), {after: 0}) + (m.prepared_role ? P(R('  (' + m.prepared_role + ')', {sz: 28}), {after: 0}) : ''), 5348)}</w:tr>`
    + `<w:tr>${metaCell(P('', {after: 0}), 4300)}${metaCell(P('', {after: 0}), 5348)}</w:tr>`
    + `<w:tr>${metaCell(P(R('Reviewed by:', {sz: 28}), {jc: 'right', after: 0}), 4300)}${metaCell(P(R('  ' + (m.reviewed_by || ''), {sz: 28, u: true}), {after: 0}), 5348)}</w:tr></w:tbl>`;
  body += P('', {after: 360});
  body += P(R('CONTENTS:', {b: true, sz: 24}), {jc: 'center', after: 120});
  en.forEach(s => { body += P(R(String(s.title).toUpperCase(), {b: true, sz: 24}), {num: [2, 0], after: 60, line: 240}); });
  body += P('', {after: 0, pb: true});
  /* isi */
  body += P(R(set.doc_title || 'PROJECT PLAN DOCUMENT', {b: true, sz: 36}), {after: 160, line: 240});
  const list = (items, kind) => { let id = 3; if (kind === 'ol') { id = ++listId; numDefs.push(id); } return items.map(t => P(runsOf(t), {num: [id, 0], jc: 'both', line: 264, after: 60})).join('') + P('', {after: 40}); };
  nodes.forEach(x => {
    switch (x.k) {
      case 'h1': body += P(R(x.text, {b: true, sz: 32, u: true}), {num: [1, 0], keepNext: true, before: 240, after: 120, line: 240}); break;
      case 'h2': body += P(runsOf(x.text, {b: true, sz: 28}), {num: [1, 1], keepNext: true, before: 160, after: 100, line: 240}); break;
      case 'h3': body += P(runsOf(x.text, {b: true, sz: 24}), {num: [1, 2], keepNext: true, before: 120, after: 80, line: 240}); break;
      case 'h4': body += P(runsOf(x.text, {b: true}), {left: 720, keepNext: true, before: 120, after: 60}); break;
      case 'p': body += P(runsOf(x.text), BODY); break;
      case 'ul': body += list(x.items, 'ul'); break;
      case 'ol': body += list(x.items, 'ol'); break;
      case 'table': body += simpleTable(x); break;
      case 'rab': body += rabTable(x); break;
      case 'chart': if (chart) body += P(drawing(chart, 6.2, 3.4), {jc: 'center', after: 120}); break;
      case 'figure': { const im = imgs[x.ref]; if (!im) break; const src = snap.images.find(y => y.id === x.ref); figN++; body += P(drawing(im, 5.4, 3.8), {jc: 'center', keepNext: true, after: 40}) + P(R(`Gambar ${figN}. ${x.caption || (src ? src.label : '')}`, {i: true, sz: 18}), {jc: 'center', after: 160}); break; }
      case 'sysbox': { const s = x.sys; body += P(R(s.name + (s.is_selected ? ' (dipilih)' : ''), {b: true}) + R(' – ' + rupiah(s.total)), {left: 720, keepNext: true, before: 100, after: 60});
        if (s.description) body += P(runsOf(s.description), BODY);
        s.images.forEach(r => { const im = imgs[r]; if (im) body += P(drawing(im, 3.6, 2.8), {jc: 'center', after: 60}); });
        if (s.pros) body += P(R('Kelebihan: ', {b: true}) + runsOf(s.pros), BODY); if (s.cons) body += P(R('Kekurangan: ', {b: true}) + runsOf(s.cons), BODY); break; }
    }
  });
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1152" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

  /* header & footer */
  let hdrInner;
  if (kop) hdrInner = P(drawing(kop, 6.7, 1.0), {after: 0, bottom: 6}); else hdrInner = P(R(set.company || '', {b: true, sz: 18}), {after: 0}) + P(R(set.tagline || '', {sz: 18}), {after: 0, bottom: 6});
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${hdrInner}</w:hdr>`;
  const fld = (t) => `<w:r><w:rPr><w:color w:val="555555"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:fldChar w:fldCharType="${t}"/></w:r>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${P(R((set.footer || '') + (set.footer ? '  ·  ' : '') + snap.project.project_no + ' · ' + snap.project.name, {sz: 16, color: '555555'}) + '<w:r><w:tab/></w:r>' + R('Halaman ', {sz: 16, color: '555555'}) + fld('begin') + '<w:r><w:rPr><w:color w:val="555555"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' + fld('separate') + R('1', {sz: 16, color: '555555'}) + fld('end'), {tabs: [['right', TW]], after: 0, bottom: 0})}</w:ftr>`.replace('<w:pBdr><w:bottom w:val="single" w:sz="0" w:space="1" w:color="000000"/></w:pBdr>', '');
  /* penomoran */
  const lvl = (i, fmt, text, left, hang, extra = '') => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="${hang}"/></w:pPr>${extra}</w:lvl>`;
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'decimal', '%1.', 720, 360, '<w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>')}${lvl(1, 'decimal', '%1.%2', 1080, 720, '<w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>')}${lvl(2, 'decimal', '%1.%2.%3', 1440, 900, '<w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>')}</w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl(0, 'decimal', '%1.', 720, 360, '<w:rPr><w:b/></w:rPr>')}</w:abstractNum>
  <w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, 'bullet', '•', 1080, 360)}${lvl(1, 'bullet', '–', 1440, 360)}</w:abstractNum>
  <w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, 'decimal', '%1.', 1080, 360)}${lvl(1, 'lowerLetter', '%2.', 1440, 360)}</w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
  ${numDefs.map(id => `<w:num w:numId="${id}"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="id-ID" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rIdSty', 'styles', 'styles.xml')}${rel('rIdNum', 'numbering', 'numbering.xml')}${rel('rIdSet', 'settings', 'settings.xml')}${rel('rIdHdr', 'header', 'header1.xml')}${rel('rIdFtr', 'footer', 'footer1.xml')}${docRels.map(r => rel(r.id, 'image', r.target)).join('')}</Relationships>`;
  const hdrRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hdrRels.map(r => rel(r.id, 'image', r.target)).join('')}</Relationships>`;
  const ctXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(pr.title)}</dc:title><dc:creator>${xe(m.prepared_by || 'Rancang')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', ctXml); zip.file('_rels/.rels', rootRels); zip.file('docProps/core.xml', core);
  zip.file('word/document.xml', documentXml); zip.file('word/styles.xml', stylesXml); zip.file('word/numbering.xml', numberingXml); zip.file('word/settings.xml', settingsXml);
  zip.file('word/header1.xml', headerXml); zip.file('word/footer1.xml', footerXml); zip.file('word/_rels/document.xml.rels', docRelsXml); zip.file('word/_rels/header1.xml.rels', hdrRelsXml);
  media.forEach(mm => zip.file('word/media/' + mm.name, mm.u));
  return zip.generateAsync({type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
window.buildDocx = buildDocx; window.docIR = docIR; window.parseMd = parseMd;

/* ---------- 5. renderProposal (HTML) berbasis IR ---------- */
window.renderProposal = async function (pr, mode) {
  const snap = pr.source_snapshot, c = propContent(pr), set = tplSettings(), nodes = docIR(snap, c), map = {};
  const refs = new Set(); nodes.forEach(n => { if (n.k === 'figure') refs.add(n.ref); if (n.k === 'sysbox') n.sys.images.forEach(r => refs.add(r)); });
  for (const ref of refs) { const im = snap.images.find(x => x.id === ref); if (im) try { map[ref] = await toDataURL(im.path); } catch (e) {} }
  const model = schedModel(snap.timeline), chartHTML = model ? inlineSvg(scurveSVG(model)) : '';
  const kop = set.kop_image || set.logo, en = c.sections.filter(s => s.enabled), m = c.meta || {};
  const header = kop ? `<table class="hdr"><tr><td><img class="kop" src="${kop}" alt=""></td></tr></table>` : `<table class="hdr"><tr><td class="co"><b>${esc(set.company)}</b><br>${esc(set.tagline)}</td></tr></table>`;
  const footer = `<table class="ftr"><tr><td>${esc(set.footer)}</td><td style="text-align:right">${esc(snap.project.project_no)} · ${esc(snap.project.name)}</td></tr></table>`;
  const cover = `<div class="cover"><h1>${esc(set.doc_title)}</h1><div class="rule"></div><p class="subt">${esc(snap.project.name)}</p>${set.cover_image ? `<div class="cimg"><img src="${set.cover_image}" alt=""></div>` : ''}
    <div class="meta"><p>Prepared by: <u>${esc(m.prepared_by || '')}</u>${m.prepared_role ? `<br>(${esc(m.prepared_role)})` : ''}</p><p>Reviewed by: <u>${esc(m.reviewed_by || '')}</u></p></div>
    <h3>CONTENTS:</h3><ol>${en.map(s => `<li>${esc(String(s.title).toUpperCase())}</li>`).join('')}</ol></div>`;
  const body = irHtml(nodes, {imgSrc: r => map[r] || '', chartHTML, snap});
  return {html: `${header}${cover}<div style="page-break-before:always"></div><div class="titlebar">${esc(set.doc_title)}</div>${body}${footer}`, parts: [], set, header, footer};
};

/* ---------- 6. AI: dokumen penuh ---------- */
const AI_ORDER = ['background', 'design_parameter', 'timeline', 'deliverables', 'executive_summary'];
A.aiText = async function (proposalId, section, draft, context) {
  if (!LIVE) throw new Error('demo');
  const {data, error} = await sb.functions.invoke('generate-proposal', {body: {proposal_id: proposalId, section, draft, context}});
  if (error) { let msg = error.message; try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {} throw new Error(msg); }
  if (data && data.error) throw new Error(data.error); return data;
};
const gapCount = c => c.sections.reduce((a, s) => a + ((String(s.text || '').match(GAP_RE) || []).length), 0);
const clip = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n) + '…' : t; };
async function freshSnapshot(pr) { if (typeof ensureAll === 'function') await ensureAll(); const snap = buildSource(S.pd); pr.source_snapshot = snap; await A.update('proposals', pr.id, {source_snapshot: snap}); return snap; }
ACT.aiDoc = async function () {
  const pr = curProp(); if (!pr) return;
  toast('Menyegarkan data sumber…'); await freshSnapshot(pr);
  const c0 = propContent(pr), keys = AI_ORDER.filter(k => secOf(c0, k) && secOf(c0, k).enabled), res = {}; let fails = 0, last = '', demo = false;
  for (const [i, key] of keys.entries()) {
    toast(`AI menulis ${i + 1}/${keys.length}: ${secOf(c0, key).title}…`);
    const context = Object.entries(res).map(([k, t]) => `### ${(secOf(c0, k) || {}).title}\n${clip(t, 1800)}`).join('\n\n');
    try { const r = await A.aiText(pr.id, key, secOf(propContent(pr), key).text, context); if (r && r.text) { res[key] = r.text; await saveProp(pr, c => { secOf(c, key).text = r.text; }); } else fails++; }
    catch (e) { fails++; last = (e && e.message) || ''; if (last === 'demo') { demo = true; break; } }
  }
  const n = Object.keys(res).length, gaps = gapCount(propContent(pr));
  if (n) toast(`AI selesai menulis ${n} section${fails ? `, ${fails} gagal` : ''}.${gaps ? ` ${gaps} bagian perlu dilengkapi (ditandai kuning).` : ''} Periksa sebelum dikirim review.`);
  else toast(demo ? 'Mode demo tidak memakai AI. Gunakan "Isi otomatis semua teks".' : 'AI gagal: ' + (last || 'tidak diketahui'), true);
};
ACT.aiAll = ACT.aiDoc;
ACT.aiSec = async function (el) {
  const pr = curProp(), key = el.dataset.key; toast('Menyegarkan data sumber…'); await freshSnapshot(pr);
  const c = propContent(pr), others = c.sections.filter(s => s.key !== key && s.enabled && String(s.text || '').trim()).map(s => `### ${s.title}\n${clip(s.text, 1500)}`).join('\n\n');
  try { const r = await A.aiText(pr.id, key, secOf(c, key).text, others); if (!r || !r.text) throw new Error('Respons kosong'); await saveProp(pr, cc => { secOf(cc, key).text = r.text; }, 'Draft AI selesai. Periksa sebelum dikirim review.'); }
  catch (e) { toast(e && e.message === 'demo' ? 'Mode demo tidak memakai AI. Gunakan "Isi otomatis dari data".' : 'AI gagal: ' + ((e && e.message) || ''), true); }
};

/* ---------- 7. Unduh Word (.docx) & preview ---------- */
ACT.dlDocx = async function () {
  const pr = curProp(); toast('Menyusun file Word (.docx)…');
  const blob = await buildDocx(pr); saveBlob(`${(pr.source_snapshot.project || {}).project_no || 'proposal'}-proposal.docx`, blob);
};
ACT.dlWord = ACT.dlDocx;
ACT.previewDoc = async function () {
  const pr = curProp(); toast('Menyiapkan dokumen…'); const r = await renderProposal(pr, 'view');
  return openModal({title: 'Dokumen proposal', wide: true, noFooter: true, printable: true, body: `<style>${DOC_CSS}</style><div class="docv sheetdoc">${r.html}</div><div class="noprint" style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" class="btn" data-act="closeModal">Tutup</button><button type="button" class="btn" data-act="dlDocx">Unduh Word (.docx)</button><button type="button" class="btn primary" data-act="printSheet">Cetak / simpan PDF</button></div>`});
};

/* ---------- 8. Editor: tombol & info tambahan ---------- */
const _propEditor = window.propEditor;
window.propEditor = function (pr) {
  let h = _propEditor(pr); const c = propContent(pr), editable = canEdit() && ['draft', 'in_review'].includes(pr.status), gaps = gapCount(c);
  h = h.replace('<button class="btn sm" data-act="previewDoc">Preview dokumen</button>', `${editable ? '<button class="btn sm primary" data-act="aiDoc">Generate dokumen dengan AI</button>' : ''}<button class="btn sm" data-act="previewDoc">Preview dokumen</button><button class="btn sm" data-act="dlDocx">Unduh Word (.docx)</button>`);
  h = h.replace('<button class="btn sm primary" data-act="aiAll">Tulis semua dengan AI</button>', '');
  h = h.replace('<div class="flow">', `${gaps ? `<p class="gapnote">⚠ ${gaps} bagian perlu dilengkapi. Cari tanda kuning <mark class="gap">[PERLU DIISI: …]</mark> di teks, isi datanya di project lalu klik "Segarkan data sumber", atau ketik langsung.</p>` : ''}<p class="hint" style="margin-bottom:10px">Format teks: <code>## Sub-judul</code> · <code>- daftar</code> · <code>1. daftar bernomor</code> · <code>**tebal**</code> · tabel dengan <code>| kolom | kolom |</code>. Sub-judul otomatis bernomor (mis. 2.1).</p><div class="flow">`);
  return h;
};
const st = document.createElement('style');
st.textContent = `mark.gap{background:#fde68a;color:#78350f;padding:0 3px;border-radius:3px}.gapnote{background:#fffbeb;border:1px solid #fcd34d;color:#78350f;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:13px}
.hint code{background:var(--lav);padding:1px 5px;border-radius:5px;font-size:12px}
.docv.sheetdoc h2.sh{font-size:16pt;text-decoration:underline}.docv.sheetdoc h3.ss{font-size:14pt}.docv.sheetdoc h4.s3{font-size:12pt}.docv.sheetdoc .titlebar{font-size:18pt;font-weight:bold;margin:0 0 10px}
.docv.sheetdoc mark.gap{background:#fde68a;color:#78350f}`;
document.head.appendChild(st);
})();
