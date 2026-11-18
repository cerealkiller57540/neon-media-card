"""
Pochette de secours pour custom:autoradio-card, cherchée sur Discogs.

La carte appelle pyscript.autoradio_cover(artist, album, title) avec return_response
quand un titre n'a ni image intégrée (APIC/PICTURE) ni image de dossier.
Le jeton est celui de l'intégration Discogs de HA, relu dans core.config_entries :
il reste côté serveur, la carte ne le voit jamais.

Cache disque (COVERS) : une pochette trouvée y reste ; pour en corriger une, retirer sa clé
« artiste|album » du fichier. Un échec est retenu RETRY_MISS secondes, pour ne pas
reposer la même question à chaque titre de l'album (Discogs : 60 requêtes/min).
"""

import json
import os
import time

ENTRIES = "/config/.storage/core.config_entries"
COVERS = "/config/autoradio_covers.json"
UA = "HomeAssistant-autoradio-card/1.0"
TIMEOUT = 10
RETRY_MISS = 30 * 86400
MIN_GAP = 1.1  # secondes entre deux requêtes Discogs
_gap = {"last": 0}


@pyscript_executor
def _lookup(artist, album, title, gap):
    import json
    import os
    import time
    import urllib.parse
    import urllib.request

    key = (artist.strip().lower() + "|" + (album or title or "").strip().lower())[:300]
    try:
        with open(COVERS, encoding="utf-8") as f:
            cache = json.load(f)
    except Exception:
        cache = {}
    hit = cache.get(key)
    if hit and (hit.get("url") or time.time() - hit.get("t", 0) < RETRY_MISS):
        return {"url": hit.get("url", ""), "cached": True}

    with open(ENTRIES, encoding="utf-8") as f:
        token = next((e["data"].get("token") for e in json.load(f)["data"]["entries"] if e["domain"] == "discogs"), None)
    # Sans intégration Discogs : pas de jeton, donc pas de pochette, sans rien journaliser à chaque titre.
    if not token:
        return {"url": ""}

    def norm(x):
        return "".join([ch for ch in x.lower() if ch.isalnum()])

    # Discogs renvoie des homonymes et des compilations : le titre du résultat
    # (« Artiste - Album ») doit contenir l'album cherché, ou l'artiste à défaut d'album.
    must = norm(album or artist)

    def search(params):
        wait = MIN_GAP - (time.time() - gap["last"])
        if wait > 0:
            time.sleep(wait)
        gap["last"] = time.time()
        params["per_page"] = "5"
        req = urllib.request.Request(
            "https://api.discogs.com/database/search?" + urllib.parse.urlencode(params),
            headers={"Authorization": "Discogs token=" + token, "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            res = json.load(r).get("results", [])
        for x in res:
            u = x.get("cover_image") or ""
            if u and "spacer.gif" not in u and must in norm(x.get("title", "")):
                return u
        return ""

    # master = pochette de référence de l'album ; release en repli (pressages sans master)
    if album:
        tries = [{"type": "master", "artist": artist, "release_title": album},
                 {"type": "release", "artist": artist, "release_title": album}]
    else:
        tries = [{"type": "release", "artist": artist, "track": title}]
    url = ""
    for p in tries:
        url = search(p)
        if url:
            break

    cache[key] = {"url": url, "t": int(time.time())}
    tmp = COVERS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    os.replace(tmp, COVERS)
    return {"url": url, "cached": False}


@service(supports_response="only")
def autoradio_cover(artist="", album="", title=""):
    """yaml
name: Autoradio, pochette Discogs
description: Cherche la pochette d'un album sur Discogs (jeton de l'intégration Discogs), avec cache.
fields:
  artist: {description: Artiste, example: IAMX, required: true, selector: {text: {}}}
  album: {description: Album (sinon on cherche par titre), example: Alive In New Light, selector: {text: {}}}
  title: {description: Titre du morceau, selector: {text: {}}}
"""
    if not artist or not (album or title):
        return {"url": ""}
    try:
        return _lookup(artist, album, title, _gap)
    except Exception as e:
        log.warning(f"autoradio_cover {artist!r} / {album or title!r} : {e}")
        return {"url": "", "error": str(e)[:200]}
