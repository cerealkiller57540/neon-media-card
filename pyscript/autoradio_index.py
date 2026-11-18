"""
Index de la bibliothèque musicale pour custom:autoradio-card.

Le navigateur ne peut parcourir /media qu'un dossier à la fois (media_source/browse_media),
ce qui plafonne la carte à 80 dossiers / 1000 titres. Ce script parcourt le disque côté
serveur et écrit un seul fichier que la carte charge d'un coup :
  /config/www/autoradio-card/index.json (+ .gz, servi compressé par HA si le navigateur l'accepte)
Il régénère aussi la liste des préréglages d'égaliseur (eq/index.json) : HTTP ne liste pas un dossier.

Format (v1) : {"v":1, "root": id media-source de ROOT_DIR, "generated": ISO, "count": n,
  "dirs": [chemins relatifs à ROOT_DIR, "" = racine], "t": [[i_dir, nom_fichier], …],
  "lists": [[i_dir, nom.m3u], …], "img": {"i_dir": nom de l'image du dossier}}
"img" est facultatif (ajouté après coup, toujours v1) : pochette de repli quand le MP3 n'en a pas.
Identifiant d'un titre = root + "/" + dirs[i] + "/" + nom (sans segment vide) : c'est
l'identifiant que media_source/browse_media donnerait, la carte le signe à la lecture.
Pas de tags ID3 ici : lire 20 000 fichiers sur un partage réseau chaque nuit coûterait cher.
"""

import gzip
import json
import os
import re
import time

ROOT_DIR = "/media"
ROOT_ID = "media-source://media_source/local"
OUT = "/config/www/autoradio-card/index.json"
EQ_DIR = "/config/www/autoradio-card/eq"

AUDIO_EXT = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav", ".webm"}
LIST_EXT = {".m3u", ".m3u8"}
# Image de dossier, par ordre de préférence (Windows Media Player écrit AlbumArt_{GUID}_Large/Small.jpg).
COVER_RE = [re.compile(p, re.I) for p in (r"^cover\.(jpe?g|png|webp)$", r"^folder\.(jpe?g|png|webp)$",
            r"^front\.(jpe?g|png|webp)$", r"^albumart_.*_large\.jpe?g$", r"^albumartsmall\.jpe?g$", r"^albumart.*\.jpe?g$")]
# Mêmes exclusions que media-source.js : dossiers système Windows/Synology et dossiers cachés.
JUNK_DIR = re.compile(r"^(\$RECYCLE\.BIN|System Volume Information|@eaDir|#recycle|#snapshot|\..*)$", re.I)


@pyscript_executor
def _build_index():
    # Fonction native (thread) : open() et os.* y sont permis, et ce helper doit y vivre,
    # une fonction pyscript ordinaire n'étant pas appelable depuis ce thread.
    def _atomic(path, data, mode="w"):
        tmp = path + ".tmp"
        with open(tmp, mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
            f.write(data)
        os.replace(tmp, path)

    t0 = time.time()
    dirs, tracks, lists, imgs, errors = [], [], [], {}, 0
    stack = [""]
    while stack:
        rel = stack.pop()
        try:
            with os.scandir(os.path.join(ROOT_DIR, rel) if rel else ROOT_DIR) as it:
                entries = list(it)
        except OSError:
            errors += 1
            continue
        files, subs, pics = [], [], []
        for e in entries:
            try:
                if e.is_dir(follow_symlinks=False):
                    if not JUNK_DIR.match(e.name):
                        subs.append(e.name)
                elif e.is_file(follow_symlinks=False):
                    ext = os.path.splitext(e.name)[1].lower()
                    if ext in AUDIO_EXT or ext in LIST_EXT:
                        files.append((ext in LIST_EXT, e.name))
                    elif ext in (".jpg", ".jpeg", ".png", ".webp"):
                        pics.append(e.name)
            except OSError:
                errors += 1
        if files:
            di = len(dirs)
            dirs.append(rel)
            for is_list, name in sorted(files, key=lambda f: f[1].lower()):
                (lists if is_list else tracks).append([di, name])
            for rx in COVER_RE:
                hit = sorted([p for p in pics if rx.match(p)], key=str.lower)
                if hit:
                    imgs[str(di)] = hit[0]
                    break
        # Pile : sous-dossiers empilés à l'envers pour sortir en ordre alphabétique (album par album).
        for name in sorted(subs, key=str.lower, reverse=True):
            stack.append(rel + "/" + name if rel else name)
    doc = {
        "v": 1,
        "root": ROOT_ID,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "count": len(tracks),
        "dirs": dirs,
        "t": tracks,
        "lists": lists,
        "img": imgs,
    }
    raw = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # .gz d'abord : HA sert le .gz s'il existe, il ne doit jamais être plus vieux que le .json.
    _atomic(OUT + ".gz", gzip.compress(raw.encode("utf-8"), 6), "wb")
    _atomic(OUT, raw)

    feq = 0
    if os.path.isdir(EQ_DIR):
        names = sorted([n for n in os.listdir(EQ_DIR) if n.lower().endswith(".feq")], key=str.lower)
        feq = len(names)
        _atomic(os.path.join(EQ_DIR, "index.json"), json.dumps(names, ensure_ascii=False, indent=0))
    return {"tracks": len(tracks), "dirs": len(dirs), "lists": len(lists), "covers": len(imgs), "feq": feq,
            "errors": errors, "bytes": len(raw), "seconds": round(time.time() - t0, 1)}


async def _run(origin):
    try:
        r = await _build_index()
    except Exception as e:
        log.error(f"autoradio_index ({origin}) : {e}")
        state.set("sensor.autoradio_index", "erreur", {"friendly_name": "Autoradio : index", "error": str(e)[:200]})
        return
    log.info(f"autoradio_index ({origin}) : {r}")
    attrs = {"friendly_name": "Autoradio : index", "unit_of_measurement": "titres", "icon": "mdi:music-box-multiple",
             "origin": origin, "updated": time.strftime("%Y-%m-%d %H:%M:%S")}
    attrs.update(r)
    state.set("sensor.autoradio_index", r["tracks"], attrs)


@time_trigger("cron(30 4 * * *)")
async def autoradio_index_nightly():
    await _run("nuit")


@time_trigger("startup")
def autoradio_index_startup():
    # Laisser le partage réseau se monter avant de parcourir /media.
    task.sleep(120)
    _run("démarrage")


@service
async def autoradio_index():
    """Régénère l'index de la bibliothèque et la liste des préréglages .feq de autoradio-card."""
    await _run("service")
