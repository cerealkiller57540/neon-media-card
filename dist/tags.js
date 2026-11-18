// autoradio-card — lecture des tags d'un fichier audio par requêtes Range (seul le début du fichier
// voyage) : ID3v2.2/2.3/2.4 des MP3 et blocs de métadonnées FLAC. Renvoie titre, artiste, album
// et la pochette intégrée (APIC / PICTURE), de préférence la face avant (type 3).

const FIRST = 65536; // la plupart des tags tiennent dedans : une seule requête
const MAX_TAG = 4 << 20; // au-delà, pochette démesurée : on garde les textes, pas l'image

async function range(url, a, b, signal) {
  const r = await fetch(url, { headers: { Range: "bytes=" + a + "-" + b }, signal });
  if (r.status !== 206) { r.body?.cancel(); throw new Error("Range refused (" + r.status + ")"); } // 200 = fichier entier : on n'en veut pas
  return new Uint8Array(await r.arrayBuffer());
}

const td = (enc) => new TextDecoder(enc);
function text(b, enc) {
  let s;
  if (enc === 1) {
    const be = b[0] === 0xfe && b[1] === 0xff;
    s = td(be ? "utf-16be" : "utf-16le").decode(b[0] === 0xff || be ? b.subarray(2) : b);
  } else if (enc === 2) s = td("utf-16be").decode(b);
  else if (enc === 3) s = td("utf-8").decode(b);
  else s = td("latin1").decode(b);
  return s.split("\0")[0].trim();
}

// Fin d'une chaîne terminée par un nul (deux octets alignés en UTF-16).
function zend(b, p, enc) {
  if (enc === 1 || enc === 2) {
    for (; p + 1 < b.length; p += 2) if (!b[p] && !b[p + 1]) return p;
    return b.length;
  }
  const i = b.indexOf(0, p);
  return i < 0 ? b.length : i;
}

function unsync(b) {
  const o = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    o[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0) i++;
  }
  return o.subarray(0, n);
}

const ss = (b, p) => (b[p] << 21) | (b[p + 1] << 14) | (b[p + 2] << 7) | b[p + 3];
const be32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const le32 = (b, p) => b[p] + (b[p + 1] << 8) + (b[p + 2] << 16) + ((b[p + 3] << 24) >>> 0);

function sniff(d) {
  if (d[0] === 0xff && d[1] === 0xd8) return "image/jpeg";
  if (d[0] === 0x89 && d[1] === 0x50) return "image/png";
  if (d[0] === 0x52 && d[1] === 0x49 && d[8] === 0x57) return "image/webp";
  if (d[0] === 0x47 && d[1] === 0x49) return "image/gif";
  return "";
}

const TXT = { TIT2: "title", TPE1: "artist", TALB: "album", TT2: "title", TP1: "artist", TAL: "album" };

function parseId3(tag, ver, out) {
  const v2 = ver === 2, hl = v2 ? 6 : 10;
  let p = 0, best = -1;
  while (p + hl <= tag.length) {
    const id = String.fromCharCode(...tag.subarray(p, p + (v2 ? 3 : 4)));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // remplissage
    const size = v2 ? (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5] : ver === 4 ? ss(tag, p + 4) : be32(tag, p + 4);
    const fl = v2 ? 0 : tag[p + 9];
    let d = tag.subarray(p + hl, p + hl + size);
    p += hl + size;
    if (ver === 4) {
      if (fl & 0x01) d = d.subarray(4); // indicateur de longueur
      if (fl & 0x02) d = unsync(d);
    }
    if (!d.length) continue;
    const f = TXT[id];
    if (f) { if (!out[f]) out[f] = text(d.subarray(1), d[0]); continue; }
    if (id !== "APIC" && id !== "PIC") continue;
    const enc = d[0];
    let q;
    if (id === "PIC") q = 4;
    else q = d.indexOf(0, 1) + 1;
    if (q <= 0 || q >= d.length) continue;
    const type = d[q];
    q = zend(d, q + 1, enc) + (enc === 1 || enc === 2 ? 2 : 1);
    const data = d.subarray(q), mime = sniff(data);
    if (!mime) continue;
    const rank = type === 3 ? 2 : type === 0 ? 1 : 0;
    if (rank > best) { best = rank; out.pic = { mime, data: data.slice() }; }
  }
}

async function readId3(url, head, signal) {
  const ver = head[3], flags = head[5];
  const size = ss(head, 6);
  let tag;
  if (10 + size <= head.length) tag = head.subarray(10, 10 + size);
  else if (size <= MAX_TAG) {
    const rest = await range(url, head.length, 10 + size - 1, signal);
    tag = new Uint8Array(size);
    tag.set(head.subarray(10));
    tag.set(rest, head.length - 10);
  } else tag = head.subarray(10); // tag géant : on lit ce qu'on a (les textes viennent en premier en général)
  if (ver < 4 && flags & 0x80) tag = unsync(tag);
  if (flags & 0x40) tag = tag.subarray(ver === 4 ? ss(tag, 0) : be32(tag, 0) + 4);
  const out = {};
  parseId3(tag, ver, out);
  return out;
}

async function readFlac(url, head, signal) {
  let buf = head, base = 0;
  const get = async (a, n) => {
    if (a - base + n <= buf.length && a >= base) return buf.subarray(a - base, a - base + n);
    if (n > MAX_TAG) return null;
    buf = await range(url, a, a + Math.max(n, FIRST) - 1, signal);
    base = a;
    return buf.subarray(0, n);
  };
  const out = {};
  let p = 4;
  for (let k = 0; k < 64; k++) {
    const h = await get(p, 4);
    if (!h || h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4 || type === 6) {
      const d = await get(p + 4, len);
      if (d && type === 4) {
        let q = 4 + le32(d, 0);
        const n = le32(d, q);
        q += 4;
        for (let i = 0; i < n && q + 4 <= d.length; i++) {
          const l = le32(d, q), s = td("utf-8").decode(d.subarray(q + 4, q + 4 + l));
          q += 4 + l;
          const e = s.indexOf("="), key = s.slice(0, e).toUpperCase(), val = s.slice(e + 1).trim();
          const f = key === "TITLE" ? "title" : key === "ARTIST" ? "artist" : key === "ALBUM" ? "album" : "";
          if (f && !out[f] && val) out[f] = val;
        }
      } else if (d && type === 6) {
        const pt = be32(d, 0);
        let q = 4;
        q += 4 + be32(d, q); // type MIME
        q += 4 + be32(d, q); // description
        q += 16;
        const dl = be32(d, q), data = d.subarray(q + 4, q + 4 + dl), mime = sniff(data);
        if (mime && (!out.pic || pt === 3)) out.pic = { mime, data: data.slice() };
      }
    }
    p += 4 + len;
    if (last) break;
  }
  return out;
}

// {title?, artist?, album?, pic?: {mime, data}} ou null (pas de tag lisible, autre origine, Range refusé).
export async function readTags(url, signal) {
  try {
    const head = await range(url, 0, FIRST - 1, signal);
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return await readId3(url, head, signal);
    if (head[0] === 0x66 && head[1] === 0x4c && head[2] === 0x61 && head[3] === 0x43) return await readFlac(url, head, signal);
  } catch (e) {
    if (e.name !== "AbortError") console.debug("autoradio-card: tags", e.message || e);
  }
  return null;
}
