// Fichiers servis par HA (« Mes médias », stockage réseau d'usage Média) :
// parcours par media_source/browse_media, URL signées par media_source/resolve_media
// (signature valable 24 h, d'où une résolution par dossier chargé).
// Le son passe par le navigateur (Web Audio : égaliseur, visus), donc l'URL doit
// être de la même origine que HA. Une URL externe (serveur DLNA du NAS, etc.)
// n'envoie en général pas d'en-tête CORS : Web Audio n'en tirerait que du silence,
// et une page https refuse en plus une URL http.

const MAX_TRACKS = 1000;
const RESOLVE_BATCH = 16;

// HA classe les listes de lecture (.m3u, .pls) en audio : ce ne sont pas des pistes.
const PLAYLIST_RE = /\.(m3u8?|pls|xspf|wpl|cue)$/i;
const PLAYLIST_MIME = /mpegurl|scpls|x-ms-wpl|xspf/i;
const isAudio = (c) =>
  c.can_play &&
  (c.media_class === "music" || String(c.media_content_type || "").startsWith("audio/")) &&
  !PLAYLIST_RE.test(c.title || "") &&
  !PLAYLIST_MIME.test(c.media_content_type || "");

// Dossiers système des partages Windows et Synology, et dossiers cachés.
const JUNK_DIR = /^(\$RECYCLE\.BIN|System Volume Information|@eaDir|#recycle|#snapshot|\..*)$/i;
const isFolder = (c) => c.can_expand && !JUNK_DIR.test(c.title || "");
// Seules les listes m3u/m3u8 sont chargées (format le plus courant, texte ligne à ligne).
const isM3u = (c) => c.can_play && /\.m3u8?$/i.test(c.title || "");

const signedUrl = async (hass, id) => {
  const r = await hass.callWS({ type: "media_source/resolve_media", media_content_id: id });
  return new URL(typeof hass.hassUrl === "function" ? hass.hassUrl(r.url) : r.url, location.href).href;
};

export async function browseFolder(hass, id) {
  const r = await hass.callWS({ type: "media_source/browse_media", media_content_id: id });
  const kids = r.children || [];
  const audio = kids.filter(isAudio);
  return {
    id: r.media_content_id || id,
    title: r.title || "",
    folders: kids.filter(isFolder),
    lists: kids.filter(isM3u),
    items: audio.slice(0, MAX_TRACKS),
    truncated: audio.length > MAX_TRACKS,
  };
}

// Dossiers proposés par l'éditeur : les sources de médias de HA, puis `depth` niveaux
// de sous-dossiers (un stockage réseau d'usage Média apparaît dans « Mes médias »).
export async function listFolders(hass, depth = 2, max = 300) {
  const out = [];
  const walk = async (id, label, level) => {
    if (out.length >= max) return;
    let r;
    try {
      r = await hass.callWS({ type: "media_source/browse_media", media_content_id: id });
    } catch (e) {
      return;
    }
    const kids = (r.children || []).filter(isFolder);
    for (const c of kids) {
      if (out.length >= max) return;
      const name = label ? label + " / " + c.title : c.title;
      out.push({ id: c.media_content_id, title: name });
      if (level < depth) await walk(c.media_content_id, name, level + 1);
    }
  };
  await walk("media-source://media_source", "", 0);
  return out;
}

// Liste m3u -> { tracks: [{ id, title, duration }], skipped }. Les chemins sont relatifs
// au dossier de la liste ; un chemin absolu (C:\\…, /…, http:…) ne correspond à aucun
// fichier de HA et est écarté. Les pistes ne sont pas signées ici : une liste de
// 20 000 entrées ferait autant d'appels resolve_media (voir lazyResolver).
export async function loadM3u(hass, id) {
  const buf = await (await fetch(await signedUrl(hass, id))).arrayBuffer();
  let txt;
  try {
    txt = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    txt = new TextDecoder("windows-1252").decode(buf); // .m3u écrit par un lecteur Windows
  }
  const base = id.split("/").slice(0, -1); // media-source:, "", media_source, local, …
  const tracks = [];
  let info = null;
  let skipped = 0;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = /^#EXTINF:\s*(-?[\d.]+)[^,]*,(.*)$/.exec(line);
      if (m) info = { duration: Number(m[1]), title: m[2].trim() };
      continue;
    }
    const rel = line.replace(/\\/g, "/");
    if (/^([a-z][\w+.-]*:|\/)/i.test(rel)) {
      skipped++;
      info = null;
      continue;
    }
    const parts = base.slice();
    for (const seg of rel.split("/")) {
      if (seg === "..") {
        if (parts.length > 4) parts.pop();
      } else if (seg && seg !== ".") parts.push(seg);
    }
    const name = parts[parts.length - 1].replace(/\.[^.]+$/, "");
    tracks.push({ id: parts.join("/"), title: (info && info.title) || name, duration: info && info.duration > 0 ? info.duration : null });
    info = null;
  }
  return { tracks, skipped };
}

// URL media-source:// -> URL signée, au moment de lire la piste (signature valable 24 h).
export function lazyResolver(getHass) {
  const cache = new Map();
  return async (url) => {
    if (!url.startsWith("media-source://")) return url;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < 20 * 3600e3) return hit.url;
    const signed = await signedUrl(getHass(), url);
    cache.set(url, { url: signed, at: Date.now() });
    return signed;
  };
}

// -> { tracks: [{ url, title }], foreign: nombre d'URL hors de HA écartées } ou null si abandon.
export async function resolveTracks(hass, items, isDead) {
  const tracks = [];
  let foreign = 0;
  for (let i = 0; i < items.length; i += RESOLVE_BATCH) {
    const part = await Promise.all(items.slice(i, i + RESOLVE_BATCH).map(async (it) => {
      try {
        const r = await hass.callWS({ type: "media_source/resolve_media", media_content_id: it.media_content_id });
        const url = new URL(typeof hass.hassUrl === "function" ? hass.hassUrl(r.url) : r.url, location.href);
        if (url.origin !== location.origin) {
          foreign++;
          return null;
        }
        return { url: url.href, title: it.title };
      } catch (e) {
        console.warn("neon-media-card: resolve_media", it.media_content_id, e);
        return null;
      }
    }));
    if (isDead()) return null;
    for (const t of part) if (t) tracks.push(t);
  }
  return { tracks, foreign };
}
