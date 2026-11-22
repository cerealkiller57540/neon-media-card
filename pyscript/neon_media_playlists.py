"""
Playlists de custom:neon-media-card, gardées côté HA pour être les mêmes sur tous les appareils.

pyscript.neon_media_playlists(op, ...) avec return_response :
  op="get"                      -> {"lists": [...]}
  op="put",  list={id, name, rev, tracks}  -> {"ok": True, "list": ...} ou {"ok": False, "list": <version en place>}
  op="delete", id=...           -> {"ok": True}
  op="radios_get"               -> {"radios": {rev, items} ou None}
  op="radios_put", radios={rev, items} -> {"ok": True, "radios": ...} ou {"ok": False, "radios": <version en place>}
Un favori radio = [id, url, titre, sous-titre, image] (id media-source:// ou http(s)://).
Une liste = {id, name, rev, tracks: [[media_id, titre, artiste, album], ...]}.
rev par liste : un appareil qui écrit sur une version périmée reçoit la version en place
au lieu d'écraser la modification faite ailleurs.
"""

import threading

STORE = "/config/neon_media_playlists.json"
MAX_LISTS = 100
MAX_TRACKS = 2000
MAX_TEXT = 300
MAX_RADIOS = 200
_lock = threading.Lock()


@pyscript_executor
def _run(op, data, lock):
    import json
    import os

    def load():
        try:
            with open(STORE, encoding="utf-8") as f:
                v = json.load(f)
            if not isinstance(v, dict):
                return {"lists": []}
            # le dict entier est conservé : save() réécrit tout le fichier, y compris les radios
            if not isinstance(v.get("lists"), list):
                v["lists"] = []
            return v
        except FileNotFoundError:
            return {"lists": []}

    def save(doc):
        tmp = STORE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, STORE)

    def text(x):
        return str(x or "")[:MAX_TEXT]

    with lock:
        doc = load()
        lists = doc["lists"]
        if op == "radios_get":
            return {"radios": doc.get("radios")}
        if op == "radios_put":
            r = data.get("radios")
            if not isinstance(r, dict) or not isinstance(r.get("items"), list):
                return {"ok": False, "error": "radios invalides"}
            items = []
            for t in r["items"]:
                if isinstance(t, list) and t and isinstance(t[0], str) and t[0].startswith(
                        ("media-source://", "http://", "https://")):
                    url = t[1] if len(t) > 1 and isinstance(t[1], str) and t[1].startswith(("http://", "https://")) else ""
                    img = t[4] if len(t) > 4 and isinstance(t[4], str) and t[4].startswith(("http://", "https://")) else ""
                    items.append([t[0][:1000], url[:1000], text(t[2] if len(t) > 2 else ""),
                                  text(t[3] if len(t) > 3 else ""), img[:1000]])
            if len(items) > MAX_RADIOS:
                return {"ok": False, "error": "plus de " + str(MAX_RADIOS) + " radios"}
            cur = doc.get("radios")
            cur_rev = cur.get("rev") if isinstance(cur, dict) else None
            if cur_rev != r.get("rev"):
                return {"ok": False, "radios": cur}
            new = {"rev": (cur_rev or 0) + 1, "items": items}
            doc["radios"] = new
            save(doc)
            return {"ok": True, "radios": new}
        if op == "get":
            return {"lists": lists}
        if op == "delete":
            doc["lists"] = [x for x in lists if x.get("id") != data.get("id")]
            save(doc)
            return {"ok": True}
        if op != "put":
            return {"ok": False, "error": "op inconnue : " + str(op)}

        lst = data.get("list")
        if not isinstance(lst, dict) or not isinstance(lst.get("id"), str) or not lst["id"]:
            return {"ok": False, "error": "liste invalide"}
        tracks = []
        for t in lst.get("tracks") or []:
            if isinstance(t, list) and t and isinstance(t[0], str) and t[0].startswith("media-source://"):
                tracks.append([t[0][:1000]] + [text(t[i]) if i < len(t) else "" for i in (1, 2, 3)])
        if len(tracks) > MAX_TRACKS:
            return {"ok": False, "error": "plus de " + str(MAX_TRACKS) + " titres"}
        cur = next((x for x in lists if x.get("id") == lst["id"]), None)
        if cur is not None and cur.get("rev") != lst.get("rev"):
            return {"ok": False, "list": cur}
        if cur is None and len(lists) >= MAX_LISTS:
            return {"ok": False, "error": "plus de " + str(MAX_LISTS) + " listes"}
        new = {"id": lst["id"][:64], "name": text(lst.get("name")).strip()[:80] or "Sans nom",
               "rev": (cur.get("rev", 0) if cur else 0) + 1, "tracks": tracks}
        if cur is None:
            lists.append(new)
        else:
            lists[lists.index(cur)] = new
        save(doc)
        return {"ok": True, "list": new}


@service(supports_response="only")
def neon_media_playlists(op="get", id=None, list=None, radios=None):
    """yaml
name: Playlists de Neon Media
description: Lit, enregistre ou supprime les playlists de custom:neon-media-card.
fields:
  op:
    description: get, put, delete, radios_get ou radios_put
    example: get
  id:
    description: identifiant de la liste (delete)
  list:
    description: la liste complète {id, name, rev, tracks} (put)
  radios:
    description: favoris radio {rev, items} (radios_put)
"""
    try:
        return _run(op, {"id": id, "list": list, "radios": radios}, _lock)
    except Exception as e:
        log.warning("neon_media_playlists %s : %s", op, e)
        return {"ok": False, "error": str(e)}
