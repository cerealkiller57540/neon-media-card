// neon-media-card : façade d'autoradio double DIN, écran WebGL (aurore + spectre LED) sous du verre HTML.
// Sources : dossier de médias HA et DLNA lus par le navigateur (vrai spectre via AnalyserNode),
// Spotify piloté par son media_player (le son sort ailleurs : spectre simulé).
const VERSION = "0.18.1";
const TAG = "neon-media-card";
const OLD_TAG = "autoradio-card"; // nom jusqu'à la 0.16 : alias du type et reprise des réglages par appareil
const MODULE_URL = new URL(import.meta.url);
// HACS sert le module depuis /hacsfiles/, mais pyscript écrit index.json et eq/ dans www/neon-media-card (/local/).
const DATA_BASE = MODULE_URL.pathname.startsWith("/hacsfiles/") ? "/local/neon-media-card/" : new URL(".", MODULE_URL).pathname;
// Les clés localStorage dérivent de TAG : celles de l'ancien nom sont recopiées une fois.
try {
  for (const k of [".play", ".eq", ".sink", ".set"]) {
    const v = localStorage.getItem(OLD_TAG + k);
    if (v !== null && localStorage.getItem(TAG + k) === null) localStorage.setItem(TAG + k, v);
  }
} catch (e) { /* stockage bloqué */ }
const Q = MODULE_URL.search; // ?hacstag=… propagé aux sous-fichiers pour casser le cache avec la card

// Valeurs réglées à l'œil au banc d'essai (ha-card-preview-bench, 2026-11-17) : ne pas les rechoisir au jugé.
const LOOK = { hue: 217, hue2: 272, vivid: 0, glow: 0.8, glass: 0.12, blur: 18, aurora: 0.6, text: 1.0 };
const RANGES = {
  hue: [0, 360, 1], glow: [0, 1.5, 0.05], glass: [0, 0.4, 0.01],
  blur: [0, 40, 1], aurora: [0, 1.5, 0.05], text: [0.7, 1.4, 0.05], hue2: [0, 360, 1], vivid: [0, 1, 0.05],
};
const THEMES = ["graphite", "anthracite", "silver", "black"];
// Polices : [clé, famille, graisses]. Fichiers woff2 latin de Google Fonts inchangés (SIL OFL 1.1), font-<clé>.woff2 à côté du module,
// déclarés dans le document (un @font-face dans un shadow root ne charge rien) et téléchargés seulement à l'usage.
const SYS_FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const FONTS = [["system", "Système", ""], ["orbitron", "Orbitron", "400 700"], ["exo2", "Exo 2", "400 700"], ["saira", "Saira", "400 700"],
  ["oxanium", "Oxanium", "400 700"], ["jura", "Jura", "400 700"], ["sharetechmono", "Share Tech Mono", "400"]];
const FONT_IDS = FONTS.map((f) => f[0]);
const DETACH_MS = 60000;
// Cartes construites : HA recree l'element a chaque retour sur la vue ; la nouvelle reprend celle qui joue encore.
const LIVE = new Set();
// Carte qui tient les gestionnaires Media Session (globaux a la page) : seule elle peut les retirer.
let MS_OWNER = null;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

let msMod = null;
const mediaSource = () => (msMod ||= import(new URL("media-source.js" + Q, MODULE_URL).href));
let tgMod = null;
const tagsMod = () => (tgMod ||= import(new URL("tags.js" + Q, MODULE_URL).href));
const TAG_CACHE = 60; // titres dont on garde tags et pochette (object URL) en mémoire
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
const fmt = (s) => (Number.isFinite(s) && s >= 0 ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "--:--");

const I = {
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/>',
  back: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10.5a5 5 0 0 1 0 10H12"/>',
  volup: '<path d="M3.5 9.5H7L11.5 5.5v13L7 14.5H3.5z"/><path d="M15.5 12h5M18 9.5v5"/>',
  voldn: '<path d="M3.5 9.5H7L11.5 5.5v13L7 14.5H3.5z"/><path d="M15.5 12h5"/>',
  mp3: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  spotify: '<circle cx="12" cy="12" r="9.5"/><path d="M7.2 9.4c3.2-1 6.8-.6 9.6.9M7.8 12.6c2.6-.7 5.4-.4 7.6.8M8.5 15.5c2-.5 4.1-.3 5.8.6"/>',
  dlna: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v5M12 12.5 6.6 17.2M12 12.5l5.4 4.7"/>',
  lists: '<path d="M3 6h13M3 11h13M3 16h8"/><circle cx="16.5" cy="18" r="2.5"/><path d="M19 18V8.5l2.5-1"/>',
  eq: '<path d="M5 4v16M12 4v16M19 4v16"/><rect x="3" y="13" width="4" height="3" rx="1"/><rect x="10" y="7" width="4" height="3" rx="1"/><rect x="17" y="10.5" width="4" height="3" rx="1"/>',
  out: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="7" r="1.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  prev: '<path d="M6 5v14" stroke-width="2.4"/><path d="M19 5 9 12l10 7z" fill="currentColor" stroke="none"/>',
  next: '<path d="M18 5v14" stroke-width="2.4"/><path d="M5 5l10 7-10 7z" fill="currentColor" stroke="none"/>',
  play: '<path d="M7.5 4.5v15l12.5-7.5z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  shuffle: '<path d="M3 7h3.5c4 0 6 10 10 10H21M3 17h3.5c1.7 0 3-1.8 4-4M14 7.5c.8-.3 1.6-.5 2.5-.5H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M7 21l-3-3 3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  grip: '<path d="M7 7h10M7 12h10M7 17h10"/>',
  radio: '<rect x="3" y="8.5" width="18" height="12" rx="2"/><path d="M7 8.5 17 3.5"/><circle cx="15.5" cy="14.5" r="3"/><path d="M6.5 12.5h3M6.5 16h3"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z"/>',
};
const svg = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[k] + "</svg>";
const COLL = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
// Recherche insensible à la casse et aux accents.
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Langue de l'interface : celle du profil HA (hass.locale), repli sur la page tant que hass n'est pas arrivé.
// Les textes sont écrits en français dans le code ; hors français, EN les remplace (texte absent = français).
let LANG = String(document.documentElement.lang || navigator.language || "en").toLowerCase();
const setLang = (h) => { const l = h?.locale?.language || h?.language; if (l) LANG = String(l).toLowerCase(); };
const isFr = () => LANG.startsWith("fr");
const LOC = () => (isFr() ? "fr-FR" : LANG);
const tx = (s) => (isFr() || s == null ? s : EN[s] ?? s);
const EN = {
  "après ": "after ",
  "jamais": "never",
  "coupé": "off",
  "Marche / arrêt": "Power",
  "Accueil": "Home",
  "Retour": "Back",
  "Égaliseur": "Equalizer",
  "Sorties": "Outputs",
  "Réglages": "Settings",
  "Plat": "Flat",
  "Classique": "Classical",
  "Électro": "Electro",
  "Basses+": "Bass+",
  "Voix": "Vocal",
  "Origine": "Original",
  "Boréale": "Boreal",
  "Glace": "Ice",
  "Coucher": "Sunset",
  "Braise": "Ember",
  "Ambre": "Amber",
  "Améthyste": "Amethyst",
  "Teinte": "Hue",
  "Seconde teinte": "Second hue",
  "Éclat des couleurs": "Color vividness",
  "Halo": "Glow",
  "Opacité du verre": "Glass opacity",
  "Flou du verre": "Glass blur",
  "Aurore": "Aurora",
  "Taille du texte": "Text size",
  "Replier les tuiles": "Collapse tiles",
  "Fondu entre titres": "Crossfade",
  "Système": "System",
  "Configuration invalide": "Invalid configuration",
  "Aléatoire": "Shuffle",
  "Précédent": "Previous",
  "Lecture": "Play",
  "Suivant": "Next",
  "Répéter": "Repeat",
  "Appui long : relire la bibliothèque": "Long press: rescan the library",
  "Personnalisée": "Custom",
  "Personnalisé": "Custom",
  "Égaliseur · 10 bandes": "Equalizer · 10 bands",
  "Préréglages en fichier .feq": "Presets from .feq files",
  "‹ Précédent": "‹ Back",
  "Tout lire": "Play all",
  "Chercher : artiste, album, titre…": "Search: artist, album, title…",
  "« ": "“",
  " » : version suivante": "”: coming in a later version",
  "Lecteur Spotify non réglé (éditeur de la carte)": "Spotify player not set (card editor)",
  "En lecture · ": "Playing · ",
  "Lecture du dossier…": "Reading folder…",
  " titres": " tracks",
  "Dossier": "Folder",
  "Non réglé": "Not set",
  "Entité introuvable": "Entity not found",
  "Coupé": "Off",
  " listes": " lists",
  "Listes et file": "Lists and queue",
  "Thème ": "Theme ",
  " · réglé ici": " · set here",
  "Bientôt": "Soon",
  "Dossier non réglé (éditeur de la carte)": "Folder not set (card editor)",
  "Dossier illisible : ": "Folder unreadable: ",
  "Aucun serveur DLNA (intégration DLNA Digital Media Server absente)": "No DLNA server (DLNA Digital Media Server integration missing)",
  "Bibliothèque": "Library",
  "Mise à jour de la bibliothèque…": "Updating the library…",
  "Service pyscript.neon_media_index absent : relecture seule": "Service pyscript.neon_media_index missing: rescan only",
  "Mise à jour refusée : ": "Update refused: ",
  "Bibliothèque : ": "Library: ",
  "Index introuvable": "Index not found",
  "EQ coupé": "EQ off",
  "EQ actif": "EQ on",
  "Égaliseur sans effet sur Spotify : le son sort ailleurs": "Equalizer has no effect on Spotify: audio plays elsewhere",
  "Égaliseur sans effet : le son sort sur ": "Equalizer has no effect: audio plays on ",
  "Égaliseur sans effet sur ce flux (autre serveur)": "Equalizer has no effect on this stream (other server)",
  "format inattendu": "unexpected format",
  "Préréglage borné à ±12 dB": "Preset clamped to ±12 dB",
  "Préréglage illisible : ": "Preset unreadable: ",
  "Bloqué : flux http dans une page https": "Blocked: http stream in an https page",
  "Lecture impossible : ": "Cannot play: ",
  "titre": "track",
  "Prêt": "Ready",
  "Touchez pour lire": "Tap to play",
  "Ce lecteur ne sait pas avancer dans le titre": "This player cannot seek",
  " ne s'allume pas": " does not turn on",
  "Sortie audio indisponible : ": "Audio output unavailable: ",
  "Navigateur": "Browser",
  "Où sort le son": "Where audio plays",
  "Accès refusé : noms des sorties indisponibles": "Access denied: output names unavailable",
  "en lecture": "playing",
  "en pause": "paused",
  "en attente": "idle",
  "éteint": "off",
  "allumé": "on",
  "injoignable": "unavailable",
  "chargement": "buffering",
  "Ce navigateur": "This browser",
  "Sortie par défaut": "Default output",
  "celle du système": "the system one",
  "AirPlay ou réglages de l'appareil pour changer": "use AirPlay or the device settings to change it",
  "Sortie audio ": "Audio output ",
  "Lister les sorties": "List outputs",
  "demande l'accès au micro une fois, pour leurs noms": "asks for microphone access once, to read their names",
  "Lecteurs de la maison · MP3": "Home players · MP3",
  "Aucun lecteur : option outputs de la carte": "No player: card option outputs",
  " · enchaîne seul": " · queues by itself",
  " · enchaîné par la carte": " · queued by the card",
  "introuvable": "not found",
  "Lecteur Spotify non réglé": "Spotify player not set",
  "Aucun appareil Spotify Connect": "No Spotify Connect device",
  "Spotify sur ": "Spotify on ",
  "Sortie des MP3 : ": "MP3 output: ",
  "ce navigateur": "this browser",
  " (Spotify garde son appareil)": " (Spotify keeps its device)",
  "Cet appareil": "This device",
  "Revenir à la valeur de la carte": "Back to the card value",
  "Façade": "Faceplate",
  "Thème": "Theme",
  "Couleurs": "Colors",
  "Thème HA": "HA theme",
  "Teintes de la couleur principale et de la couleur d'accent du thème Home Assistant": "Hues of the Home Assistant theme primary and accent colors",
  "Écran": "Display",
  "Police": "Font",
  "Son": "Sound",
  "Relire le dossier MP3": "Rescan the MP3 folder",
  "Lecture en cours…": "Reading…",
  " · index du ": " · index of ",
  "régénère l'index côté HA puis le relit": "rebuilds the index on HA, then reloads it",
  "Revenir aux réglages de la carte": "Back to the card settings",
  " réglages faits ici, prioritaires": " settings made here override",
  " réglage fait ici, prioritaire": " setting made here overrides",
  " sur ceux de l'éditeur": " the editor ones",
  "aucun réglage propre à cet appareil": "no setting specific to this device",
  "Réglages de la carte rétablis": "Card settings restored",
  "Lecteur Spotify introuvable": "Spotify player not found",
  "Réveil de Spotify sur ": "Waking Spotify on ",
  "Spotify ne répond pas sur ": "Spotify does not respond on ",
  "Chargement…": "Loading…",
  "Lecture : ": "Playing: ",
  "Disque du jour": "Record of the day",
  "Rien ici": "Nothing here",
  "Spotify indisponible": "Spotify unavailable",
  "Service pyscript.neon_media_playlists absent : seule la file en cours est disponible": "Service pyscript.neon_media_playlists missing: only the current queue is available",
  "Listes illisibles : ": "Lists unreadable: ",
  "‹ Annuler": "‹ Cancel",
  "Fichiers (": "Files (",
  "dossier ": "folder ",
  "racine": "root",
  " titre": " track",
  "‹ Listes": "‹ Lists",
  "Artiste": "Artist",
  "Aucun titre audio dans ce dossier": "No audio track in this folder",
  "Valider": "OK",
  "Ajouter « ": "Add “",
  " » à…": "” to…",
  "File en cours": "Current queue",
  "vide": "empty",
  "Nouvelle liste": "New list",
  "Chargement des listes…": "Loading lists…",
  "+ Titre en cours": "+ Current track",
  "Ce titre seulement": "This track only",
  "Tout le dossier « ": "Whole folder “",
  " » (": "” (",
  "Trier": "Sort",
  "Nom": "Name",
  "Mélanger": "Shuffle",
  "Inverser": "Reverse",
  "Ajouter ces ": "Add these ",
  " titres à une liste": " tracks to a list",
  "Enregistrer comme liste": "Save as list",
  "Renommer": "Rename",
  "Supprimer": "Delete",
  "File vide : lancez une source": "Queue empty: start a source",
  "Liste vide : ajoutez des titres depuis la file (+)": "List empty: add tracks from the queue (+)",
  "Aucun titre pour « ": "No track for “",
  " »": "”",
  "Ajouter à une liste": "Add to a list",
  "Retirer de la liste": "Remove from the list",
  "Nom vide": "Empty name",
  "Trop de titres : ": "Too many tracks: ",
  " au plus par liste, affinez la recherche": " at most per list, refine the search",
  "File trop longue : ": "Queue too long: ",
  " titres au plus par liste": " tracks at most per list",
  "Enregistrer la file": "Save the queue",
  "Renommer la liste": "Rename the list",
  "Dossier trop grand : ": "Folder too large: ",
  " titres au plus": " tracks at most",
  "Listes indisponibles": "Lists unavailable",
  " listes au plus": " lists at most",
  "Ajouté à « ": "Added to “",
  "Liste pleine : ": "List full: ",
  " » modifiée sur un autre appareil : rechargée": "” changed on another device: reloaded",
  "Enregistrement refusé : ": "Save refused: ",
  "erreur": "error",
  "Confirmer la suppression": "Confirm deletion",
  "Suppression refusée : ": "Deletion refused: ",
  "Liste « ": "List “",
  " » supprimée": "” deleted",
  "Lecture aléatoire coupée : la file suit l'ordre choisi": "Shuffle off: the queue follows the chosen order",
  "Spotify en veille": "Spotify asleep",
  "Lecteur introuvable": "Player not found",
  "Aspect": "Appearance",
  "Égaliseur et fondu": "Equalizer and crossfade",
  "Façade d'autoradio double DIN : dossier de médias, DLNA, Spotify et webradio, spectre WebGL, égaliseur 10 bandes, fondu enchaîné.": "Double-DIN car radio faceplate: media folder, DLNA, Spotify and web radio, WebGL spectrum, 10-band equalizer, crossfade.",
  "Lecteur Spotify (media_player)": "Spotify player (media_player)",
  "Appareil à réveiller si Spotify dort (sinon le premier de la liste)": "Device to wake if Spotify sleeps (otherwise the first in the list)",
  "Disque du jour (capteur dont l'état est un lien spotify:, optionnel)": "Record of the day (sensor whose state is a spotify: link, optional)",
  "Lecteurs proposés dans Sorties (vide = aucun)": "Players offered in Outputs (empty = none)",
  "Dossier MP3 (media-source)": "MP3 folder (media-source)",
  "Dossier DLNA (media-source)": "DLNA folder (media-source)",
  "Index de la bibliothèque (URL, généré par pyscript)": "Library index (URL, built by pyscript)",
  "Police de l'écran": "Display font",
  "Couleurs du thème Home Assistant (remplacent les teintes)": "Home Assistant theme colors (replace the hues)",
  "Halo de la courbe": "Curve glow",
  "Remplissage sous la courbe": "Fill under the curve",
  "Spectre derrière la courbe": "Spectrum behind the curve",
  "Taille des curseurs": "Slider size",
  "Largeur des bandes (Q)": "Band width (Q)",
  "Fondu entre titres (s, 0 = coupé)": "Crossfade (s, 0 = off)",
  "Replier les tuiles après (s sans geste, 0 = jamais)": "Collapse tiles after (s without touch, 0 = never)",
  "Dossier des préréglages .feq (URL, avec index.json)": "Folder of .feq presets (URL, with index.json)",
  "Seconde teinte (mélangée à la première)": "Second hue (blended with the first)",
  "Éclat des couleurs (0 = pastel d'origine, 1 = couleur pure)": "Color vividness (0 = original pastel, 1 = pure color)",
  "Flou du verre (px)": "Glass blur (px)",
  "Favoris": "Favorites",
  "Parcourir": "Browse",
  "favori": "favorite",
  "favoris": "favorites",
  "Webradio": "Web radio",
  "Chercher une station…": "Search a station…",
  "Choisissez une station": "Pick a station",
  "EN DIRECT": "LIVE",
  "Station injoignable : ": "Station unreachable: ",
  "Flux interrompu : ": "Stream interrupted: ",
  "Aucun favori : touchez l'étoile d'une station.": "No favorites: tap a station's star.",
  "Aucune station pour « ": "No station for “",
  "Recherche impossible : radio-browser.info ne répond pas": "Search failed: radio-browser.info is not answering",
  "Ajouter aux favoris": "Add to favorites",
  "Retirer des favoris": "Remove from favorites",
  "Station injoignable en https : ": "Station unreachable over https: ",
  "Flux HLS : non lu par ce navigateur": "HLS stream: not played by this browser",
  "Parcours impossible : radio-browser.info ne répond pas": "Browsing failed: radio-browser.info is not answering",
  "Près de chez vous": "Near you",
  "Populaires": "Popular",
  "Langues": "Languages",
  "Pays": "Countries",
  " favoris au plus": " favorites at most",
  "Favoris modifiés ailleurs : rechargés, refaites le geste": "Favorites changed elsewhere: reloaded, try again",
  "Favoris non enregistrés : ": "Favorites not saved: ",
};

const AUDIO_RE = /\.(mp3|flac|ogg|oga|opus|m4a|aac|wav|webm)$/i;
const LONG_MS = 650;
// Bits MediaPlayerEntityFeature : sans appareil actif, l'intégration Spotify n'annonce que SELECT_SOURCE.
const SP_PLAY = 16384, SP_PLAY_MEDIA = 512, SP_BROWSE = 131072;
// Lecteurs de la maison : fonctions media_player utilisées par la page Sorties.
const MP_SEEK = 2, MP_PREV = 16, MP_NEXT = 32, MP_ON = 128, MP_STOP = 4096, MP_ENQUEUE = 2097152;
const PAL_MS = 450; // fondu entre deux palettes
const XQ = 0.8; // durée du fondu sur précédent/suivant (s)
const OUT_DFLT = [];
// Titres confiés d'avance à un lecteur qui a sa propre file (Sonos) : il enchaîne même carte fermée.
const RM_WIN = 30;
const RM_ASK_MS = 6000; // après un ordre de la carte, les états transitoires du lecteur ne comptent pas
// Titres suivants signés d'avance pour le son du navigateur (≈ 2 h) : HA coupe la connexion d'une page
// cachée depuis 5 min, et sans connexion plus aucune URL ne peut être signée.
const PRESIGN = 30;
// Le son de Web Audio sort par l'AudioContext : seul son setSinkId change la sortie (Chrome, pas Safari).
const SINK = typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
const PL_MAX = 2000, PL_LISTS = 100; // plafonds du service pyscript.neon_media_playlists
const PL_DRAG_MAX = 2000; // au-delà, le glisser dans la file n'a plus de sens : tris seulement
const PL_SAVE_MS = 600;
const SP_MAX = 300; // vignettes rendues par niveau (l'intégration plafonne déjà ses listes)
const SP_LABEL = { current_user_playlists: "Playlists", current_user_followed_artists: "Artistes suivis", current_user_saved_albums: "Albums",
  current_user_saved_tracks: "Titres likés", current_user_saved_shows: "Podcasts", current_user_recently_played: "Écoutés récemment",
  current_user_top_artists: "Top artistes", current_user_top_tracks: "Top titres" };

const TILES = [
  { id: "mp3", ic: "mp3", t: "MP3", src: true },
  { id: "spotify", ic: "spotify", t: "Spotify", src: true },
  { id: "dlna", ic: "dlna", t: "DLNA", src: true },
  { id: "radio", ic: "radio", t: "Radio", src: true },
  { id: "lists", ic: "lists", t: "Playlists" },
  { id: "eq", ic: "eq", t: "Égaliseur" },
  { id: "out", ic: "out", t: "Sorties" },
  { id: "set", ic: "gear", t: "Réglages" },
];
// Webradio : station = {id, url, title, sub, thumb, live}. id = média Radio Browser de HA quand l'intégration est là
// (Sonos le reçoit alors en mode radio), sinon l'URL du flux ; url = flux joué tel quel par le navigateur.
const RB = "media-source://radio_browser";
const RB_API = "https://all.api.radio-browser.info/json/";
const RD_MAX = 200; // plafond du service pyscript.neon_media_playlists (MAX_RADIOS)
const RD_TRIES = 3; // reconnexions d'un flux coupé avant d'abandonner
const RF_ICON = (k) => "https://www.radiofrance.fr/external/favicons/" + k + "/favicon.png";
const RF = (uuid, k, title) => ({ id: RB + "/" + uuid, url: "https://icecast.radiofrance.fr/" + k + "-hifi.aac", title, sub: "FR · AAC · 192 kb/s", thumb: RF_ICON(k), live: true });
const DEFAULT_RADIOS = [
  RF("31074f8a-e6f4-11e9-a96c-52543be04c81", "franceinfo", "France Info"),
  RF("f760fce4-6d26-4203-9eb6-cf25e8799716", "franceinter", "France Inter"),
  RF("a349e1e9-2844-443a-973b-09a02fa12c8e", "fip", "FIP"),
  RF("6a1440b2-e6f0-11e9-a96c-52543be04c81", "franceculture", "France Culture"),
];
const RD_FLAG = (cc) => "https://flagcdn.com/w80/" + cc.toLowerCase() + ".png";
// Le drapeau HLS de l'API n'est pas enregistré : il se déduit de l'URL au rechargement.
const rdHls = (u) => /\.m3u8(\?|$)/i.test(u || "");
// Ligne enregistrée [id, url, titre, sous-titre, image] -> station ; un id http(s) sert aussi d'URL.
const rdRow = (t) => {
  if (!Array.isArray(t) || typeof t[0] !== "string" || !t[2]) return null;
  const url = t[1] || (/^https?:\/\//.test(t[0]) ? t[0] : "");
  return { id: t[0], url, title: String(t[2]), sub: t[3] || "", thumb: t[4] || "", hls: rdHls(url), live: true };
};
// Même station sous deux formes : id Radio Browser (avec ou sans l'intégration HA) ou même flux.
const rdSame = (a, b) => !!a && !!b && (a.id === b.id || (!!a.url && a.url === b.url) ||
  (!!a.uuid && b.id === RB + "/" + a.uuid) || (!!b.uuid && a.id === RB + "/" + b.uuid));
const KEYS = [["power", "Marche / arrêt"], ["home", "Accueil"], ["back", "Retour"], ["volup", "Volume +"], ["voldn", "Volume −"]];

/* ── égaliseur : 10 bandes d'octave ; l'axe x est logarithmique et centre chaque bande dans sa colonne ── */
const FREQ = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FLAB = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
const F0 = FREQ[0] / Math.SQRT2, F1 = FREQ[9] * Math.SQRT2;
const fOf = (x) => F0 * Math.pow(F1 / F0, x);
const GMAX = 12;
const qg = (g) => clamp(Math.round(g * 2) / 2, -GMAX, GMAX);
const PRESETS = [
  ["Plat", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["Rock", [5, 4, 3, 1, -1, -1, 1, 3, 4, 5]],
  ["Pop", [-1, 1, 3, 4, 3, 1, -1, -1, 0, 1]],
  ["Jazz", [3, 2, 1, 2, -1, -1, 0, 1, 2, 3]],
  ["Classique", [3, 2, 1, 0, 0, 0, -1, -1, 1, 2]],
  ["Électro", [6, 5, 1, 0, -2, 1, 1, 2, 4, 5]],
  ["Basses+", [8, 7, 5, 2, 0, 0, 0, 0, 0, 0]],
  ["Voix", [-3, -2, -1, 1, 4, 5, 4, 2, 0, -2]],
];
// Valeurs réglées à l'œil au banc de l'égaliseur (ha-card-preview-bench, 2026-11-17) : ne pas les rechoisir au jugé.
const EQ_LOOK = { eq_curve_glow: 1.0, eq_fill: 0.18, eq_spec: 0.55, eq_thumb: 1.0, eq_q: 1.4 };
const XFADE = 4;
const TILES_HIDE = 15;
// Page Réglages : ce qu'on règle sur l'appareil, gardé dans ce navigateur et prioritaire sur la config de la carte.
// Palettes : [nom, teinte, seconde teinte]. La première est l'aspect par défaut.
const PALETTES = [["Origine", 217, 272], ["Tokyo", 188, 318], ["Vapor", 275, 175], ["Boréale", 150, 200], ["Glace", 195, 230],
  ["Coucher", 18, 330], ["Braise", 2, 32], ["Ambre", 32, 48], ["Jade", 160, 95], ["Améthyste", 265, 300]];
const SET_UI = {
  hue: ["Teinte", (v) => v + "°"], hue2: ["Seconde teinte", (v) => v + "°"], vivid: ["Éclat des couleurs", (v) => Math.round(v * 100) + " %"], glow: ["Halo", (v) => v.toFixed(2)], glass: ["Opacité du verre", (v) => v.toFixed(2)],
  blur: ["Flou du verre", (v) => v + " px"], aurora: ["Aurore", (v) => v.toFixed(2)], text: ["Taille du texte", (v) => Math.round(v * 100) + " %"],
  tiles_hide: ["Replier les tuiles", (v) => (v ? tx("après ") + v + " s" : tx("jamais"))], crossfade: ["Fondu entre titres", (v) => (v ? v + " s" : tx("coupé"))],
};
const SET_KEYS = ["theme", "font", "palette_ha", ...Object.keys(SET_UI)];
const WAKE_ZONE = 0.335; // largeur de la colonne des tuiles (grid-template-columns de .ui dans neon-media-card.css)
const WAKE_DWELL = 600; // ms d'arrêt de la souris dans cette zone avant de rouvrir : un simple passage ne compte pas
Object.assign(RANGES, {
  eq_curve_glow: [0, 2, 0.05], eq_fill: [0, 0.6, 0.01], eq_spec: [0, 1, 0.05], eq_thumb: [0.6, 1.6, 0.05], eq_q: [0.5, 3, 0.1],
  crossfade: [0, 12, 1], tiles_hide: [0, 120, 5],
});

// Fichiers .feq de foobar2000 : 18 gains en dB, un par ligne, sur ces bandes ; ramenés à nos 10 octaves en log2 f.
const FEQ18 = [55, 77, 110, 156, 220, 311, 440, 622, 880, 1200, 1800, 2500, 3500, 5000, 7000, 10000, 14000, 20000];
function cap(t) {
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
function feqTo10(g) {
  if (g.length === 10) return g;
  const xs = FEQ18.map(Math.log2);
  return FREQ.map((f) => {
    const x = Math.log2(f);
    if (x <= xs[0]) return g[0];
    for (let i = 0; i < 17; i++) if (x <= xs[i + 1]) return g[i] + ((g[i + 1] - g[i]) * (x - xs[i])) / (xs[i + 1] - xs[i]);
    return g[17];
  });
}

// Réponse en dB d'un BiquadFilterNode, d'après les formules de la spec Web Audio (shelf S = 1).
// Calculée ici plutôt que par getFrequencyResponse, qui lit le gain en cours de lissage (setTargetAtTime).
function biquadDb(type, f0, gain, q, fs, f) {
  const A = Math.pow(10, gain / 40), w0 = (2 * Math.PI * f0) / fs, c = Math.cos(w0), s = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === "peaking") {
    const al = s / (2 * q);
    [b0, b1, b2, a0, a1, a2] = [1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A];
  } else {
    const al = (s / 2) * Math.SQRT2, k = 2 * Math.sqrt(A) * al, sg = type === "lowshelf" ? 1 : -1;
    b0 = A * (A + 1 - sg * (A - 1) * c + k);
    b1 = sg * 2 * A * (A - 1 - sg * (A + 1) * c);
    b2 = A * (A + 1 - sg * (A - 1) * c - k);
    a0 = A + 1 + sg * (A - 1) * c + k;
    a1 = -sg * 2 * (A - 1 + sg * (A + 1) * c);
    a2 = A + 1 + sg * (A - 1) * c - k;
  }
  const w = (2 * Math.PI * f) / fs, cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * cw + b2 * c2, ni = b1 * sw + b2 * s2, dr = a0 + a1 * cw + a2 * c2, di = a1 * sw + a2 * s2;
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/* ── WebGL : aurore + spectre LED 32 bandes + reflet de la vitre ── */
const NB = 32;
const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FS = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH", "precision highp float;", "#else", "precision mediump float;", "#endif",
  "uniform vec2 R;uniform float T,AUR,GLW,ON,SPI,BASE,NSEG;uniform vec3 A,A2;uniform vec4 SP;uniform sampler2D B;",
  "float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
  "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
  " return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}",
  "float fbm(vec2 p){float s=0.,a=.5;for(int k=0;k<5;k++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}",
  "void main(){",
  " vec2 fc=gl_FragCoord.xy, p=fc/R; float asp=R.x/R.y;",
  " vec3 col=mix(vec3(.010,.013,.024),vec3(.022,.020,.045),p.y);",
  " for(int k=0;k<2;k++){ float fk=float(k);",
  "  float w=fbm(vec2(p.x*asp*.55+T*.025+fk*3.1,T*.04+fk));",
  "  float y0=.62-fk*.22+(w-.5)*.45;",
  "  float d=p.y-y0; float curtain=exp(-d*d*(d>0.?9.:38.));",
  "  float str=.55+.45*fbm(vec2(p.x*asp*7.+fk*5.,T*.15));",
  "  col+=AUR*curtain*str*mix(A,A2,clamp(p.x+fk*.3-.1,0.,1.))*(.42-fk*.12);",
  " }",
  " col*=1.-.55*pow(length((p-.5)*vec2(1.,1.3)),2.2);",
  " vec3 c0=col;",
  " vec2 q=(fc-SP.xy)/SP.zw;",
  " if(q.x>=0.&&q.x<=1.&&q.y>=0.&&q.y<=1.){",
  "  float fi=floor(q.x*32.); float u=fract(q.x*32.);",
  "  vec4 b=texture2D(B,vec2((fi+.5)/32.,.5)); float lev=b.r, pkv=b.g;",
  "  float base=BASE, hh=1.-base, segH=hh/NSEG;",
  "  float cell=step(.14,u)*step(u,.86), hb=step(.001,BASE);",
  "  float y=q.y-base;",
  "  vec3 bc=mix(A,A2,q.x); vec3 hot=mix(bc,vec3(1.),.55);",
  "  if(y>=0.){",
  "   float seg=step(fract(y/segH),.72);",
  "   float on=step(y,lev*hh);",
  "   vec3 c=mix(bc,hot,y/hh);",
  "   col=mix(col,c*1.15,on*seg*cell);",
  "   col+=c*mix(.05,.07,hb)*seg*cell*(1.-on);",
  "   float pkY=pkv*hh; col+=hot*cell*smoothstep(segH*.35,0.,abs(y-pkY))*.95*step(.02,pkv);",
  "   col+=hb*bc*GLW*.18*exp(-max(y-lev*hh,0.)*22.)*smoothstep(0.,.5,u*(1.-u)*4.);",
  "  } else {",
  "   float ry=-y; float seg=step(fract(ry/segH),.72);",
  "   float on=step(ry,lev*hh*.55);",
  "   col+=bc*on*seg*cell*.22*(1.-ry/base);",
  "  }",
  "  col=mix(c0,col,SPI);",
  " }",
  " float g=p.x*.55+p.y; col+=vec3(.9,.95,1.)*.035*smoothstep(.95,1.15,g)*smoothstep(1.55,1.15,g);",
  " float v=clamp((ON-.15)/.85,0.,1.), hw=clamp(ON/.15,0.,1.);",
  " float hh2=mix(.004,.62,v*v), ww=mix(0.,.62,hw*hw); vec2 dc=abs(p-.5);",
  " float msk=(1.-smoothstep(hh2-.004,hh2+.004,dc.y))*(1.-smoothstep(ww-.01,ww+.01,dc.x));",
  " col=(col+vec3(.85,.9,1.)*(1.-v)*step(.001,ON)*.9)*msk;",
  " col+=vec3(.9,.95,1.)*.03*smoothstep(1.2,1.5,g)*(1.-ON);",
  " gl_FragColor=vec4(col,1.);",
  "}",
].join("\n");

// Éclat 0 = aspect validé au banc (90 %/62 %, 85 %/66 %) ; 1 = couleur pure (100 %/50 %).
function fontLoad(f) {
  const id = TAG + "-font-" + f[0];
  if (!f[2] || document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = "@font-face{font-family:'" + f[1] + "';src:url(" + new URL("font-" + f[0] + ".woff2" + Q, MODULE_URL).href +
    ") format('woff2');font-weight:" + f[2] + ";font-display:swap}";
  document.head.appendChild(el);
}
function fontStack(f) {
  return f[2] ? "'" + f[1] + "'," + SYS_FONT : SYS_FONT;
}
function accCols(h, h2, v) {
  return [hsl(h, 0.9 + 0.1 * v, 0.62 - 0.12 * v), hsl(h2, 0.85 + 0.15 * v, 0.66 - 0.16 * v)];
}
function rgbs(v, a) {
  const c = v.map((x) => Math.round(x * 255)).join(",");
  return a === undefined ? "rgb(" + c + ")" : "rgba(" + c + "," + a + ")";
}
function hsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

class NeonMediaCard extends HTMLElement {
  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states ?? {});
    return { entity: ids.find((id) => id.startsWith("media_player.spotify")) ?? "", media_folder: "media-source://media_source/local" };
  }

  static getConfigElement() {
    return document.createElement(TAG + "-editor");
  }

  constructor() {
    super();
    this._cfg = null;
    this._hass = null;
    this._root = this.attachShadow({ mode: "open" });
    this._built = false;
    this._raf = 0;
    this._tick = 0;
    this._detach = 0;
    this._visible = true;
    this._lv = new Float32Array(NB);
    this._pk = new Float32Array(NB);
    this._px = new Uint8Array(NB * 4);
    // src : source affichée ; queue : pistes du navigateur [{id,title}] ; libs : dossiers déjà parcourus
    this.S = { on: true, src: "mp3", vol: 50, shuffle: false, repeat: true, queue: [], idx: -1, fails: 0, libs: {}, loading: "", page: "home", eq: this._eqLoad() };
    Object.assign(this.S, this._playLoad());
    this._timers = new Map();
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error(tx("Configuration invalide"));
    this._cfgRaw = config;
    if (this._adopted) { this._adopted.setConfig(config); return; }
    config = { ...config, ...this._setLoad() };
    const c = { theme: "graphite", media_folder: "media-source://media_source/local", dlna_folder: "media-source://dlna_dms", entity: "", source: "", ...config };
    const dflt = { ...LOOK, ...EQ_LOOK, crossfade: XFADE, tiles_hide: TILES_HIDE };
    for (const k of Object.keys(dflt)) c[k] = clamp(num(config[k], dflt[k]), RANGES[k][0], RANGES[k][1]);
    // seconde teinte non réglée : elle suit la teinte (écart historique de 55°)
    if (!Number.isFinite(+config.hue2) || config.hue2 === null || config.hue2 === "") c.hue2 = (c.hue + 55) % 360;
    c.index_url = typeof config.index_url === "string" && config.index_url.trim() ? config.index_url.trim() : DATA_BASE + "index.json";
    const outs = Array.isArray(config.outputs) ? config.outputs : typeof config.outputs === "string" ? [config.outputs] : [];
    c.outputs = outs.filter((e) => typeof e === "string" && e.startsWith("media_player.")).map((e) => e.trim());
    c.eq_folder = typeof config.eq_folder === "string" && config.eq_folder.trim() ? config.eq_folder.trim() : DATA_BASE + "eq/";
    if (!THEMES.includes(c.theme)) c.theme = "graphite";
    if (!FONT_IDS.includes(c.font)) c.font = "system";
    c.palette_ha = config.palette_ha === true || Number(config.palette_ha) === 1;
    const prev = this._cfg;
    this._cfg = c;
    if (prev && (prev.media_folder !== c.media_folder || prev.dlna_folder !== c.dlna_folder || prev.index_url !== c.index_url)) { this.S.libs = {}; this._idxP = null; }
    if (prev && prev.eq_folder !== c.eq_folder) this._feqP = this._feq = null;
    if (this._built) { this._applyLook(); this._idleArm(); }
    else if (this.isConnected) this.connectedCallback();
  }

  set hass(h) {
    setLang(h);
    this._hass = h;
    if (this._adopted) { this._adopted.hass = h; return; }
    // Les variables du theme sont posees par HA apres la mise a jour de hass : relecture differee.
    const tk = JSON.stringify([h.themes?.theme, h.themes?.darkMode, h.selectedTheme]);
    if (tk !== this._thk) { this._thk = tk; if (this._built && this._cfg.palette_ha) setTimeout(() => { this._applyLook(); this._setRender(); }, 80); }
    if (this._built) {
      this._syncSpotify(); this._syncRemote();
      if (this.S.page === "out") this._outRender();
      const tr = this.S.queue[this.S.idx];
      if (tr && this._tagFor !== tr.id && this._tagC?.get(tr.id)?.lost && !this._offline()) this._tagsFor(tr);
    }
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  connectedCallback() {
    clearTimeout(this._detach);
    this._rmUnwatch(); // HA lui passe de nouveau hass
    if (!this._cfg) return;
    if (this._adopted) {
      if (this._adopted.parentNode === this._root) return; // reconnectee avec l'hote
      if (!this._adopted.isConnected) { this._root.appendChild(this._adopted); return; }
      this._adopted = null; // reprise entre-temps par une autre carte
    }
    if (!this._built) {
      const o = [...LIVE].reverse().find((x) => !x.isConnected && (x._playing() || x._rmSub || (x._audio && x.S.queue.length)));
      if (o) { this._adopt(o); return; }
      this._build();
      LIVE.add(this);
    }
    if (!this._gl && !this._glFailed) this._initGL();
    this._idleArm();
    this._loop();
  }

  // La carte orpheline est deplacee telle quelle : audio, graphe WebAudio et ecouteurs restent lies au meme objet.
  _adopt(o) {
    this._adopted = o;
    const s = document.createElement("style");
    s.textContent = ":host{display:block}";
    this._root.append(s, o);
    o.setConfig(this._cfgRaw);
    if (this._hass) o.hass = this._hass;
    if (o._audio && !o._audio.paused) o._msOwn();
  }

  disconnectedCallback() {
    if (this._adopted) return;
    this._dwellStop();
    this._tagAb?.abort();
    this._tagFor = null;
    clearTimeout(this._idleT);
    cancelAnimationFrame(this._raf);
    clearTimeout(this._tick);
    this._raf = this._tick = 0;
    clearTimeout(this._detach);
    this._rmWatch();
    // Changement de vue : on garde tout une minute ; la musique du navigateur continue même au-delà.
    // Entre deux titres rien ne joue : une sortie suivie ou une reprise attendue compte comme une lecture.
    this._detach = setTimeout(() => {
      if (this.isConnected) return;
      this._releaseGL();
      if (!this._playing() && !this._rmSub && !this._connW) { this._releaseAudio(); LIVE.delete(this); }
    }, DETACH_MS);
  }

  /* ── construction du DOM ── */
  _build() {
    const theme = new URL("facade-" + this._cfg.theme + ".webp" + Q, MODULE_URL).href;
    this._themeOf = this._cfg.theme;
    this._cover = new URL("cover.webp" + Q, MODULE_URL).href;
    this._root.innerHTML =
      '<link rel="stylesheet" href="' + new URL("neon-media-card.css" + Q, MODULE_URL).href + '">' +
      "<style>:host{display:block}ha-card{background:none;border:0;box-shadow:none;overflow:visible}</style>" +
      '<ha-card><div class="ar" style="background-image:url(' + theme + ')">' +
      '<div class="keys">' + KEYS.map((k) => '<button class="key" data-k="' + k[0] + '" aria-label="' + tx(k[1]) + '"><span>' + svg(k[0]) + "</span></button>").join("") + "</div>" +
      '<div class="knob" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="cap"></div><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="46"/><circle class="arc" cx="50" cy="50" r="46" transform="rotate(135 50 50)"/></svg></div>' +
      '<div class="screen"><canvas></canvas><div class="ui">' +
      '<header class="status"><span class="clock">--:--</span>' +
      '<span class="pill"><i></i><span class="srcn"></span></span><span class="sp"></span>' +
      '<span class="pill"><span class="ic">' + svg("out") + '</span><span class="outn"></span></span>' +
      '<span class="pill"><span class="ic">' + svg("volup") + '</span><span class="voln"></span></span></header>' +
      '<section class="np glass"><div class="cover"><img alt="" referrerpolicy="no-referrer"></div><div class="meta">' +
      '<div class="kicker"></div><div class="title"></div><div class="artist"></div>' +
      '<div class="prog"><span class="t0">0:00</span><div class="bar"><i></i></div><span class="t1"></span></div>' +
      '<div class="transport">' +
      '<button class="tb mini" data-t="shuffle" aria-label="' + tx("Aléatoire") + '"><span>' + svg("shuffle") + "</span></button>" +
      '<button class="tb" data-t="prev" aria-label="' + tx("Précédent") + '"><span>' + svg("prev") + "</span></button>" +
      '<button class="tb big" data-t="play" aria-label="' + tx("Lecture") + '"><span class="pp">' + svg("play") + "</span></button>" +
      '<button class="tb" data-t="next" aria-label="' + tx("Suivant") + '"><span>' + svg("next") + "</span></button>" +
      '<button class="tb mini" data-t="repeat" aria-label="' + tx("Répéter") + '"><span>' + svg("repeat") + "</span></button>" +
      "</div></div></section>" +
      '<div class="spec"></div>' +
      '<nav class="tiles">' + TILES.map((t) =>
        '<button class="tile glass" style="--i:' + TILES.indexOf(t) + '" data-id="' + t.id + '"' + (t.id === "mp3" ? ' title="' + tx("Appui long : relire la bibliothèque") + '"' : "") + '><span class="ic">' + svg(t.ic) +
        "</span><span><b>" + tx(t.t) + "</b><small></small></span></button>").join("") +
      "</nav>" + this._eqHTML() + this._spHTML() + "</div>" +
      '<div class="toast" role="status"></div><div class="volpop"></div></div></div></ha-card>';
    const $ = (s) => this._root.querySelector(s);
    this.$ = $;
    this._ar = $(".ar");
    this._scr = $(".screen");
    this._spec = $(".ui > .spec");
    this._espec = $(".zone .spec");
    this._zone = $(".zone");
    this._bindBands();
    $("select.feq").addEventListener("change", (e) => { if (e.target.value) this._feqLoad(e.target.value); });
    this._arc = $(".knob .arc");
    this._ARC = 2 * Math.PI * 46 * 0.75; // anneau de 270°
    this._arc.style.strokeDasharray = this._ARC + " 999";
    $(".cover img").src = this._cover;
    this._ar.addEventListener("click", (e) => this._onClick(e));
    this._bindLongPress();
    for (const ev of ["pointerdown", "pointermove", "pointerleave", "wheel", "keydown"]) this._ar.addEventListener(ev, (e) => this._wake(e), { passive: true });
    // L'encart change de largeur à la fin du repli : le défilement du titre se recalcule.
    $(".ui").addEventListener("transitionend", (e) => { if (e.propertyName === "grid-template-columns") this._mq(); });
    this._bindKnob();
    new ResizeObserver(() => { this._fit(); this._mq(); if (this.S.page === "lists" && this._plView) this._plRows(true); }).observe(this._scr);
    this.$(".spg").addEventListener("scroll", () => { if (this.S.page === "lists" && this._plView) this._plRows(); }, { passive: true });
    this.$(".spg").addEventListener("pointerdown", (e) => this._plDragStart(e));
    this.$(".spg").addEventListener("input", (e) => {
      const r = e.target.closest?.('input[type="range"][data-k]');
      if (!r || this.S.page !== "set") return;
      const k = r.dataset.k;
      if ((k === "hue" || k === "hue2") && this._cfg.palette_ha) this._setPut({ hue: this._cfg.hue, hue2: this._cfg.hue2, [k]: +r.value, palette_ha: 0 });
      else this._setPut(k, +r.value);
      r.closest(".setr").querySelector(".nm small").textContent = SET_UI[k][1](this._cfg[k]);
      if (k === "vivid") this._root.querySelectorAll('.spg [data-a="setpal"] .sw').forEach((e, i) => {
        const [A, A2] = accCols(PALETTES[i][1], PALETTES[i][2], this._cfg.vivid);
        e.style.background = "linear-gradient(90deg," + rgbs(A) + "," + rgbs(A2) + ")";
      });
      if (k === "hue" || k === "hue2") {
        // mise à jour sur place : redessiner la page détruirait le curseur en plein geste
        const c = this._cfg, i = PALETTES.findIndex((p) => p[1] === c.hue && p[2] === c.hue2);
        this._root.querySelectorAll('.spg [data-a="setpal"]').forEach((b) => b.classList.toggle("on", +b.dataset.o === i));
        const pl = this.$('.spg [data-a="setpal"]')?.closest(".setr")?.querySelector(".nm small");
        if (pl) pl.textContent = i < 0 ? tx("Personnalisée") : tx(PALETTES[i][0]);
        this.$('.spg [data-a="setpalha"]')?.classList.remove("on");
      }
    });
    this.$(".spg").addEventListener("change", (e) => { if (this.S.page === "set" && e.target.matches?.('input[type="range"]')) this._setRender(); });
    // Logos de stations : beaucoup d'URL mortes ; l'icône radio remplace l'image cassée.
    this.$(".spg").addEventListener("error", (e) => { const t = e.target; if (this.S.page === "radio" && t.tagName === "IMG") { t.insertAdjacentHTML("afterend", svg("radio")); t.remove(); } }, true);
    const plq = this.$(".plq");
    // Même champ pour le filtre de la page Playlists et la recherche de stations.
    const q = (v) => (this.S.page === "radio" ? this._rdSearch(v) : this._plFilter(v));
    plq.addEventListener("input", () => q(plq.value));
    // Le conteneur écoute le clavier pour le réveil de l'écran : la saisie ne doit pas lui parvenir.
    for (const ev of ["keydown", "keyup", "keypress"]) plq.addEventListener(ev, (e) => {
      e.stopPropagation();
      if (ev === "keydown" && e.key === "Escape" && plq.value) { e.preventDefault(); plq.value = ""; q(""); }
    });
    new IntersectionObserver((en) => { this._visible = en[0]?.isIntersecting !== false; }).observe(this._ar);
    this._built = true;
    this._applyLook();
    this._setVol(this.S.vol, false);
    this._showSource();
    this._eqPaint();
  }

  _eqHTML() {
    return '<section class="eqpanel glass">' +
      '<div class="eqhead"><span class="kicker">' + tx("Égaliseur · 10 bandes") + '</span><span class="pre"></span>' +
      '<select class="chip feq" aria-label="' + tx("Préréglages en fichier .feq") + '" hidden></select>' +
      '<button class="chip" data-a="bypass"></button></div>' +
      '<div class="zone"><div class="spec"></div>' +
      [-6, 6].map((g) => '<div class="gridl" style="top:' + (50 - (g / GMAX) * 50) + '%"></div>').join("") +
      '<div class="grid0"></div>' +
      '<svg class="curve" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><linearGradient id="eqf" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient></defs><path class="fl" fill="url(#eqf)"/><path class="ln"/></svg>' +
      '<div class="bands">' + FLAB.map((l, i) => '<div class="band" data-i="' + i + '" role="slider" tabindex="0" aria-label="' + l +
        ' Hz" aria-valuemin="-12" aria-valuemax="12"><span class="g">0</span><span class="tr"></span><span class="fi"></span><span class="th"></span><span class="f">' +
        l + "</span></div>").join("") + "</div></div></section>" +
      '<nav class="presets">' + PRESETS.map((p, i) => '<button class="chip" data-p="' + i + '">' + tx(p[0]) + "</button>").join("") +
      '<span class="sp"></span><button class="chip" data-a="back">' + tx("Retour") + '</button></nav>';
  }

  _spHTML() {
    return '<section class="sppanel glass"><div class="sphead"><span class="kicker">Spotify</span><span class="spt"></span><span class="spsort"></span></div>' +
      '<div class="spg"></div></section>' +
      '<nav class="spnav"><button class="chip" data-a="spup" hidden>' + tx("‹ Précédent") + '</button><button class="chip" data-a="spall" hidden>' + tx("Tout lire") + '</button>' +
      '<span class="plnav"></span><input class="plq" type="search" placeholder="' + tx("Chercher : artiste, album, titre…") + '" spellcheck="false" autocomplete="off" hidden>' +
      '<span class="sp"></span><button class="chip" data-a="back">' + tx("Retour") + '</button></nav>';
  }

  _applyLook() {
    const c = this._cfg, st = this._ar.style;
    // _own : teintes de la carte, reprises quand le theme n'a pas de couleur exploitable.
    if (c.palette_ha) { c._own ??= [c.hue, c.hue2]; [c.hue, c.hue2] = this._haHues() || c._own; }
    if (this._themeOf !== c.theme) {
      const theme = new URL("facade-" + c.theme + ".webp" + Q, MODULE_URL).href, old = this._cover, img = this.$(".cover img");
      this._themeOf = c.theme;
      this._cover = new URL("cover.webp" + Q, MODULE_URL).href;
      st.backgroundImage = "url(" + theme + ")";
      // Seule la pochette par défaut suit le thème (y compris le repli d'une pochette de titre injoignable).
      if (img.getAttribute("src") === old) { delete img.dataset.src; this._setCover(""); }
    }
    const ink = c.palette_ha && this._haInk();
    if (ink) { st.setProperty("--ink", ink); st.setProperty("--ink-hi", ink); }
    else { st.removeProperty("--ink"); st.removeProperty("--ink-hi"); }
    const F = FONTS.find((f) => f[0] === c.font);
    fontLoad(F);
    st.setProperty("--ff", fontStack(F));
    this._paletteTo([num(c.hue, LOOK.hue), num(c.hue2, LOOK.hue), num(c.vivid, 0)]);
    st.setProperty("--glow", c.glow);
    st.setProperty("--glass", c.glass);
    st.setProperty("--blur", c.blur + "px");
    st.setProperty("--ts", c.text);
    st.setProperty("--cg", c.eq_curve_glow);
    st.setProperty("--thumb", c.eq_thumb);
    this.$(".curve .s0").setAttribute("stop-opacity", c.eq_fill);
    this.$(".curve .s1").setAttribute("stop-opacity", 0);
    this._filt?.forEach((b, i) => { if (i && i < 9) b.Q.value = c.eq_q; });
    this._eqCurve();
  }

  // Changement de teintes : glissement de PAL_MS (teinte par le plus court chemin) au lieu d'un saut ;
  // this._pal = teintes affichées, lues aussi par le shader.
  _paletteTo(to) {
    cancelAnimationFrame(this._palR);
    const from = this._pal;
    if (!from || REDUCED || from.every((v, i) => v === to[i])) { this._pal = to; this._paintCols(to); return; }
    const t0 = performance.now(), arc = (a, b) => ((b - a + 540) % 360) - 180;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / PAL_MS), e = k * (2 - k);
      this._pal = k >= 1 ? to : [(from[0] + arc(from[0], to[0]) * e + 360) % 360, (from[1] + arc(from[1], to[1]) * e + 360) % 360, from[2] + (to[2] - from[2]) * e];
      this._paintCols(this._pal);
      if (k < 1) this._palR = requestAnimationFrame(step);
    };
    this._palR = requestAnimationFrame(step);
  }

  _paintCols([h, h2, v]) {
    const st = this._ar.style, [A, A2] = accCols(h, h2, v);
    st.setProperty("--h", h);
    st.setProperty("--h2", h2);
    st.setProperty("--acc", rgbs(A));
    st.setProperty("--acc-soft", rgbs(A, 0.22));
    st.setProperty("--acc-2", rgbs(A2));
    st.setProperty("--vs", 90 + 10 * v + "%");
    st.setProperty("--vl", -12 * v + "%");
    this.$(".curve .s0").setAttribute("stop-color", rgbs(A2));
    this.$(".curve .s1").setAttribute("stop-color", rgbs(A));
  }

  _flash(el, txt) {
    if (txt) el.textContent = txt;
    el.classList.add("show");
    clearTimeout(this._timers.get(el));
    this._timers.set(el, setTimeout(() => el.classList.remove("show"), 1600));
  }

  _toast(t) {
    this._flash(this.$(".toast"), t);
  }

  /* ── interactions ── */
  _onClick(e) {
    const tile = e.target.closest(".tile"), key = e.target.closest(".key"), tb = e.target.closest(".tb"), bar = e.target.closest(".bar");
    if (e.target.closest(".np .cover")) { this._coverZoom(); return; }
    const pre = e.target.closest("[data-p]"), act = e.target.closest("[data-a]"), spi = e.target.closest("[data-sp]"), rdi = e.target.closest("[data-rd]");
    if (pre) this._eqSet(PRESETS[+pre.dataset.p][1].slice(), PRESETS[+pre.dataset.p][0]);
    else if (act) {
      const a = act.dataset.a;
      if (a === "back") this._page("home");
      else if (a === "spup") this.S.page === "lists" ? this._plUp() : this.S.page === "radio" ? this._rdUp() : this._spUp();
      else if (a === "spall") this.S.page === "lists" ? this._plPlayView(-1) : this._spPlay(this._spNode);
      else if (a.startsWith("pl")) this._plAct(a, act);
      else if (a.startsWith("rd")) this._rdAct(a, act);
      else if (a.startsWith("out")) this._outAct(a, act.dataset.o ?? "");
      else if (a.startsWith("set")) this._setAct(a, act.dataset.o ?? "");
      else if (a === "disc") this._spPlayDisc();
      else if (a === "bypass") { this.S.eq.bypass = !this.S.eq.bypass; this._eqApply(); this._eqPaint(); this._eqSave(); }
    } else if (rdi) this._rdPick(+rdi.dataset.rd);
    else if (spi) this.S.page === "lists" ? this._plPick(+spi.dataset.sp) : this._spPick(+spi.dataset.sp);
    else if (tile) {
      if (this._lpFired) { this._lpFired = false; return; }
      const t = TILES.find((x) => x.id === tile.dataset.id);
      if (t.src) { this._selectSource(t.id); if (t.id === "spotify" || t.id === "radio") this._page(t.id); }
      else if (t.id === "eq") this._page("eq");
      else if (t.id === "lists") this._page("lists");
      else if (t.id === "out") this._page("out");
      else if (t.id === "set") this._page("set");
      else this._toast(tx("« ") + tx(t.t) + tx(" » : version suivante"));
    } else if (key) {
      const k = key.dataset.k;
      if (k === "power") this._power();
      else if (k === "volup") this._setVol(this.S.vol + 4);
      else if (k === "voldn") this._setVol(this.S.vol - 4);
      else if (k === "back" && this.S.page === "spotify" && this._spNav?.length) this._spUp();
      else if (k === "back" && this.S.page === "lists" && (this._plName || this._plPend || this._plView)) this._plUp();
      else if (k === "back" && this.S.page === "radio" && this._rdMode === "browse" && !this._rdQ && this._rdNav?.length) this._rdUp();
      else if (this.S.page !== "home") this._page("home");
      else if (this._cvz) this._coverZoom(false);
      else this._toast(k === "home" ? tx("Accueil") : tx("Retour"));
    } else if (tb) {
      const t = tb.dataset.t;
      if (t === "play") this._playPause();
      else if (t === "prev") this._step(-1);
      else if (t === "next") this._step(1);
      else if (t === "shuffle") this._toggleShuffle();
      else if (t === "repeat") this._toggleRepeat();
    } else if (bar) {
      const r = bar.getBoundingClientRect();
      this._seek(clamp((e.clientX - r.left) / r.width, 0, 1));
    }
  }

  _bindKnob() {
    const knob = this.$(".knob");
    let drag = null;
    const ang = (e) => {
      const r = knob.getBoundingClientRect();
      return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
    };
    knob.addEventListener("pointerdown", (e) => { drag = { a: ang(e), v: this.S.vol }; knob.setPointerCapture(e.pointerId); knob.classList.add("grab"); });
    knob.addEventListener("pointermove", (e) => {
      if (!drag) return;
      let d = ang(e) - drag.a;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      drag.v += (d * 100) / (1.5 * Math.PI);
      drag.a = ang(e);
      this._setVol(drag.v);
    });
    const end = () => { drag = null; knob.classList.remove("grab"); };
    knob.addEventListener("pointerup", end);
    knob.addEventListener("pointercancel", end);
    knob.addEventListener("wheel", (e) => { e.preventDefault(); this._setVol(this.S.vol + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
    knob.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); this._setVol(this.S.vol + 2); }
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); this._setVol(this.S.vol - 2); }
    });
  }

  _setVol(v, user = true) {
    const S = this.S;
    S.vol = clamp(Math.round(v), 0, 100);
    this._arc.style.strokeDashoffset = this._ARC * (1 - S.vol / 100);
    // Le repère du capuchon suit l'anneau : -135° à 0 %, +135° à 100 % (anneau de 270° qui part en bas à gauche).
    this.$(".knob .cap").style.rotate = (-135 + 2.7 * S.vol) + "deg";
    this.$(".voln").textContent = S.vol;
    this.$(".knob").setAttribute("aria-valuenow", S.vol);
    if (!user) return;
    this._playSave();
    this._flash(this.$(".volpop"), "Volume " + S.vol);
    if (S.src === "spotify") {
      // volume_set à chaque cran de molette saturerait l'API Spotify : un appel 300 ms après le dernier geste.
      clearTimeout(this._volT);
      this._volLock = Date.now() + 2500;
      this._volT = setTimeout(() => this._call("volume_set", { volume_level: S.vol / 100 }), 300);
    } else if (this._rmE()) {
      clearTimeout(this._volT);
      this._volLock = Date.now() + 2500;
      this._volT = setTimeout(() => this._rmCall("volume_set", { volume_level: S.vol / 100 }, true), 300);
    } else for (const a of [this._auWA, this._auWA2, this._auDirect]) if (a) a.volume = S.vol / 100;
  }

  _power() {
    const S = this.S;
    S.on = !S.on;
    this._scr.classList.toggle("off", !S.on);
    if (!S.on) {
      if (S.src === "spotify") { if (this._spState()?.state === "playing") this._call("media_pause"); }
      else if (this._rmPlaying()) this._rmHalt();
      else if (this._rdLive()) this._rdStop();
      else this._audio?.pause();
    }
  }

  /* ── sources ── */
  _selectSource(id) {
    const S = this.S;
    if (!S.on) this._power();
    if (S.src !== id && S.src !== "spotify") {
      if (this._rdLive()) this._rdStop(); else this._audio?.pause();
      if (this._rmPlaying()) this._rmHalt();
    }
    S.src = id;
    this._playSave();
    this._showSource();
    if (id === "spotify") {
      if (!this._cfg.entity) this._toast(tx("Lecteur Spotify non réglé (éditeur de la carte)"));
      this._syncSpotify(true);
    } else if (id === "radio") this._rdFavLoad(); // la station se choisit dans la page, rien ne part seul
    else this._loadLib(id, true);
  }

  _showSource() {
    const S = this.S;
    for (const el of this._root.querySelectorAll(".tile")) el.classList.toggle("active", el.dataset.id === S.src);
    const t = TILES.find((x) => x.id === S.src);
    this.$(".srcn").textContent = tx(t.t) + " · " + this._tileSub(S.src);
    this.$(".kicker").textContent = (this._playing() ? tx("En lecture · ") : tx("Source · ")) + tx(t.t);
    this.$(".outn").textContent = this._outName();
    for (const tile of TILES) {
      const el = this._root.querySelector('.tile[data-id="' + tile.id + '"] small');
      if (el) el.textContent = this._tileSub(tile.id);
    }
    this.$('.tb[data-t="shuffle"]').classList.toggle("on", S.src === "spotify" ? !!this._spState()?.attributes?.shuffle : S.shuffle);
    this.$('.tb[data-t="repeat"]').classList.toggle("on", S.src === "spotify" ? (this._spState()?.attributes?.repeat ?? "off") !== "off" : S.repeat);
    if (S.src !== "spotify") this._showTrack();
  }

  _tileSub(id) {
    const S = this.S;
    if (id === "mp3" || id === "dlna") {
      const lib = S.libs[id];
      if (S.loading === id) return tx("Lecture du dossier…");
      if (lib) return lib.title + " · " + lib.tracks.length + (lib.truncated ? "+" : "") + tx(" titres");
      const f = id === "mp3" ? this._cfg.media_folder : this._cfg.dlna_folder;
      return f ? f.replace(/^media-source:\/\//, "").split("/").filter(Boolean).pop() || tx("Dossier") : tx("Non réglé");
    }
    if (id === "spotify") {
      const st = this._spState();
      return st ? st.attributes?.friendly_name || this._cfg.entity : this._cfg.entity ? tx("Entité introuvable") : tx("Non réglé");
    }
    if (id === "eq") { const E = this.S.eq; return E.bypass ? tx("Coupé") : tx(E.preset || "Personnalisé"); }
    if (id === "out") return this._outName();
    if (id === "lists") return this._pl?.lists ? this._pl.lists.length + tx(" listes") : tx("Listes et file");
    if (id === "set") return tx("Thème ") + cap(this._cfg.theme) + (Object.keys(this._setLoad()).length ? tx(" · réglé ici") : "");
    if (id === "radio") {
      if (this._rdOwn() && S.queue[S.idx]) return S.queue[S.idx].title;
      const n = this._rdFavs().length;
      return n + " " + tx(n > 1 ? "favoris" : "favori");
    }
    return tx("Bientôt");
  }

  // Parcours en largeur : une bibliothèque rangée Artiste/Album n'a aucun titre à sa racine.
  async _loadLib(id, autoplay) {
    const S = this.S;
    const folder = id === "mp3" ? this._cfg.media_folder : this._cfg.dlna_folder;
    if (!folder) { this._toast(tx("Dossier non réglé (éditeur de la carte)")); return; }
    if (!S.libs[id]) {
      if (S.loading) return;
      S.loading = id;
      this._showSource();
      try {
        const fromIdx = await this._libFromIndex(folder);
        if (fromIdx) S.libs[id] = fromIdx;
        else await this._browseLib(id, folder);
      } catch (e) {
        // Sans l'intégration dlna_dms, HA répond « Unknown media source » : absence normale, pas une panne.
        if (/unknown media source/i.test(e?.message || "")) this._toast(id === "dlna" ? tx("Aucun serveur DLNA (intégration DLNA Digital Media Server absente)") : tx("Dossier illisible : ") + e.message);
        else {
          console.warn(TAG + ": parcours de " + folder, e);
          this._toast(tx("Dossier illisible : ") + (e.message || e));
        }
      } finally {
        S.loading = "";
      }
    }
    const lib = S.libs[id];
    if (S.src !== id) return;
    this._showSource();
    if (!lib) return;
    if (!lib.tracks.length) { this._toast(tx("Aucun titre audio dans ce dossier")); return; }
    if (S.queueOf !== id) { S.queue = lib.tracks; S.queueOf = id; S.idx = S.shuffle ? Math.floor(Math.random() * S.queue.length) : 0; }
    if (autoplay) this._playIdx(S.idx);
    else this._showTrack();
  }

  // Repli sans index : le navigateur ne voit qu'un dossier par requête, d'où les plafonds.
  async _browseLib(id, folder) {
        const S = this.S;
        const { browseFolder } = await mediaSource();
        const tracks = [], todo = [folder];
        let title = "", visited = 0, truncated = false;
        while (todo.length && visited < 80 && tracks.length < 1000) {
          const r = await browseFolder(this._hass, todo.shift());
          if (!visited) title = r.title || tx("Dossier");
          visited++;
          for (const it of r.items) tracks.push({ id: it.media_content_id, title: it.title, thumb: it.thumbnail || "" });
          truncated ||= r.truncated;
          todo.push(...r.folders.map((f) => f.media_content_id));
        }
        S.libs[id] = { title, tracks: tracks.slice(0, 1000), truncated: truncated || todo.length > 0 || tracks.length > 1000 };
  }

  /* ── index de la bibliothèque (pyscript neon_media_index : index.json, servi gzip par HA) ── */
  _index(force) {
    if (force) this._idxP = null;
    return (this._idxP ||= fetch(this._cfg.index_url, { cache: force ? "reload" : "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.v === 1 && typeof j.root === "string" && Array.isArray(j.dirs) && Array.isArray(j.t) ? j : null))
      .catch(() => null));
  }

  // null si l'index manque ou ne couvre pas ce dossier : l'appelant retombe sur le parcours.
  async _libFromIndex(folder) {
    const j = await this._index();
    if (!j) return null;
    const root = j.root.replace(/\/+$/, ""), f = folder.replace(/\/+$/, "");
    let rel;
    if (f === root || root.startsWith(f + "/")) rel = "";
    else if (f.startsWith(root + "/")) rel = f.slice(root.length + 1);
    else return null;
    const keep = j.dirs.map((d) => !rel || d === rel || d.startsWith(rel + "/"));
    const tracks = [], img = j.img && typeof j.img === "object" ? j.img : {};
    for (const [di, name] of j.t) {
      if (!keep[di] || typeof name !== "string") continue;
      const d = j.dirs[di], base = root + "/" + (d ? d + "/" : "");
      tracks.push({ id: base + name, title: name.replace(AUDIO_RE, ""), thumb: "", cover: img[di] ? base + img[di] : "" });
    }
    if (!tracks.length) return null;
    return { title: rel ? rel.split("/").pop() : tx("Bibliothèque"), tracks, truncated: false, indexed: j.generated || "" };
  }

  // Appui long sur la tuile MP3 : régénère l'index côté HA (≈45 s pour 30 000 titres) puis le relit.
  async _refreshLib() {
    const S = this.S;
    if (S.loading) return;
    S.loading = "mp3";
    this._showSource();
    const svc = !!this._hass?.services?.pyscript?.neon_media_index;
    this._toast(svc ? tx("Mise à jour de la bibliothèque…") : tx("Service pyscript.neon_media_index absent : relecture seule"));
    try {
      if (svc) await this._hass.callService("pyscript", "neon_media_index", {});
    } catch (e) {
      this._toast(tx("Mise à jour refusée : ") + (e.message || e));
    }
    await this._index(true);
    const old = S.libs.mp3;
    delete S.libs.mp3;
    S.loading = "";
    const folder = this._cfg.media_folder;
    try {
      const lib = folder && (await this._libFromIndex(folder));
      if (lib) S.libs.mp3 = lib;
      else if (old) S.libs.mp3 = old;
    } catch (e) {
      if (old) S.libs.mp3 = old;
    }
    const lib = S.libs.mp3;
    if (lib && S.queueOf === "mp3" && lib !== old) {
      const cur = S.queue[S.idx]?.id;
      S.queue = lib.tracks;
      S.idx = Math.max(0, lib.tracks.findIndex((t) => t.id === cur));
    }
    this._showSource();
    this._toast(lib ? tx("Bibliothèque : ") + lib.tracks.length.toLocaleString(LOC()) + tx(" titres") : tx("Index introuvable"));
  }

  _bindLongPress() {
    const nav = this.$(".tiles");
    let t = 0;
    const stop = () => clearTimeout(t);
    nav.addEventListener("pointerdown", (e) => {
      if (!e.target.closest('.tile[data-id="mp3"]')) return;
      this._lpFired = false;
      t = setTimeout(() => { this._lpFired = true; this._refreshLib(); }, LONG_MS);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) nav.addEventListener(ev, stop);
    nav.addEventListener("contextmenu", (e) => { if (e.target.closest(".tile")) e.preventDefault(); });
  }

  /* ── tuiles repliées après tiles_hide s sans geste sur l'accueil ── */
  _idleArm() {
    clearTimeout(this._idleT);
    const d = this._cfg?.tiles_hide;
    if (!this._built || !d || this.S.page !== "home") { this._setIdle(false); return; }
    this._idleT = setTimeout(() => this._setIdle(true), d * 1000);
  }

  // Repliées, les tuiles ne reviennent au survol que si la souris s'attarde WAKE_DWELL ms sur leur emplacement
  // (bande de droite de l'écran) ; la molette règle le volume et ne les rouvre pas. Clic, toucher, clavier : partout sauf sur les commandes du lecteur.
  _wake(e) {
    if (this._idle && e && (e.type === "wheel" || e.type === "pointerleave")) { this._dwellStop(); return; }
    if (this._idle && e && e.type === "pointermove" && e.pointerType !== "touch") {
      const r = this.$(".ui").getBoundingClientRect();
      const inZone = e.clientX >= r.right - r.width * WAKE_ZONE && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inZone) this._dwellStop();
      else this._dwellT ||= setTimeout(() => { this._dwellT = null; this._setIdle(false); this._idleArm(); }, WAKE_DWELL);
      return;
    }
    // Les commandes du lecteur (transport, barre de lecture, volume) ne rouvrent pas les tuiles repliées.
    if (this._idle && e?.target?.closest?.(".tb, .bar, .knob")) return;
    if (this._idle) this._setIdle(false);
    this._idleArm();
  }

  // Retour des tuiles : elles arrivent l'une après l'autre (animation CSS .tiles.in, retirée une fois jouée).
  _tilesIn() {
    if (REDUCED) return;
    const nav = this.$(".tiles");
    nav.classList.remove("in");
    void nav.offsetWidth;
    nav.classList.add("in");
    clearTimeout(this._tinT);
    this._tinT = setTimeout(() => nav.classList.remove("in"), 1400);
  }

  _dwellStop() {
    clearTimeout(this._dwellT);
    this._dwellT = null;
  }

  _setIdle(on) {
    this._dwellStop();
    if (!this._built || this._idle === on) return;
    this._idle = on;
    this.$(".ui").classList.toggle("idle", on);
    if (!on) this._tilesIn();
  }

  /* ── touches multimédia du clavier et lecteur du système (Media Session) ── */
  // Le navigateur n'envoie ces touches qu'à la page qui joue : seul le son du navigateur est concerné,
  // pas Spotify (le son sort ailleurs). Les gestionnaires sont globaux : la carte qui joue les reprend.
  _msOwn(release) {
    const ms = navigator.mediaSession;
    if (!ms) return;
    if (release && MS_OWNER && MS_OWNER !== this) return;
    MS_OWNER = release ? null : this;
    const h = release ? {} : {
      play: () => { if (!this._playing()) this._playPause(); },
      pause: () => { if (this._playing()) this._playPause(); },
      stop: () => { if (this._playing()) this._playPause(); },
      previoustrack: () => this._step(-1),
      nexttrack: () => this._step(1),
      // Un direct n'a pas de position : sans gestionnaire, le système retire la barre de son lecteur.
      seekto: this._rdLive() ? null : (d) => { if (this._audio && Number.isFinite(d.seekTime)) this._audio.currentTime = d.seekTime; },
    };
    for (const k of ["play", "pause", "stop", "previoustrack", "nexttrack", "seekto"]) {
      try { ms.setActionHandler(k, h[k] || null); } catch (e) { /* action inconnue de ce navigateur */ }
    }
    if (release) ms.metadata = null;
    ms.playbackState = release ? "none" : "playing";
  }

  _msMeta(title, artist, album, art) {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata !== "function" || this.S.src === "spotify") return;
    try { ms.metadata = new MediaMetadata({ title, artist, album, artwork: art ? [{ src: art }] : [] }); } catch (e) { /* idem */ }
  }

  /* ── réglages de lecture gardés d'un chargement à l'autre ── */
  _playLoad() {
    try {
      const v = JSON.parse(localStorage.getItem(TAG + ".play") || "null");
      if (!v || typeof v !== "object") return {};
      const o = {};
      if (TILES.some((t) => t.src && t.id === v.src)) o.src = v.src;
      if (Number.isFinite(v.vol)) o.vol = clamp(Math.round(v.vol), 0, 100);
      if (typeof v.shuffle === "boolean") o.shuffle = v.shuffle;
      if (typeof v.repeat === "boolean") o.repeat = v.repeat;
      if (typeof v.out === "string" && (!v.out || v.out.startsWith("media_player."))) o.out = v.out;
      return o;
    } catch (e) {
      return {};
    }
  }

  _playSave() {
    clearTimeout(this._playT);
    const S = this.S;
    this._playT = setTimeout(() => {
      try { localStorage.setItem(TAG + ".play", JSON.stringify({ src: S.src, vol: S.vol, shuffle: S.shuffle, repeat: S.repeat, out: S.out || "" })); } catch (e) { /* stockage bloqué */ }
    }, 400);
  }

  /* ── titre : défile s'il déborde ── */
  _setTitle(t) {
    const el = this.$(".title");
    if (el.dataset.t === t) return;
    el.dataset.t = t;
    el.innerHTML = '<span class="mqi">' + esc(t) + "</span>";
    this._mq();
  }

  _mq() {
    const el = this.$?.(".title"), inner = el?.firstElementChild;
    if (!inner) return;
    const over = inner.offsetWidth - el.clientWidth;
    const on = over > 2 && el.clientWidth > 0 && !REDUCED;
    el.classList.toggle("mq", on);
    if (!on) return;
    el.style.setProperty("--mq", -over + "px");
    // ≈40 px/s, plus les pauses aux deux bouts (15 % de chaque passe).
    el.style.setProperty("--mqd", (2 + over / 40).toFixed(1) + "s");
  }

  /* ── lecteur du navigateur ── */
  _ensureAudio() {
    if (this._audio) return;
    // Deux éléments reliés à Web Audio (même origine : égaliseur, vrai spectre, fondu de l'un à l'autre),
    // un direct pour les URL étrangères sans CORS (serveur DLNA), que Web Audio rendrait muettes.
    const mk = (cors) => {
      const a = new Audio();
      if (cors) a.crossOrigin = "anonymous";
      a.preload = "auto";
      a.addEventListener("ended", () => { if (a === this._audio) this._onEnded(); });
      a.addEventListener("timeupdate", () => this._xfCheck(a));
      a.addEventListener("error", () => this._onError(a));
      a.addEventListener("playing", () => {
        this.S.fails = 0;
        if (a === this._audio) { this._rdAt = Date.now(); this._rdEver = true; clearTimeout(this._rdWD); clearTimeout(this._rdRT); }
        this._msOwn();
        this._showSource();
        this._presign();
      });
      // Flux figé sans erreur ni fin (serveur muet, réseau perdu sans coupure) : relancé après 15 s d'attente.
      a.addEventListener("waiting", () => {
        if (a !== this._audio || !this._rdLive()) return;
        clearTimeout(this._rdWD);
        this._rdWD = setTimeout(() => { if (a === this._audio && this._rdLive() && !a.paused && a.readyState < 3) this._rdRetry(); }, 15000);
      });
      a.addEventListener("pause", () => { if (a === this._audio && navigator.mediaSession) navigator.mediaSession.playbackState = "paused"; this._showSource(); });
      return a;
    };
    this._auWA = mk(true);
    this._auWA2 = mk(true);
    this._auDirect = mk(false);
    this._audio = this._auWA;
    if (this._sinkId()) this._applySink();
  }

  _ensureGraph() {
    if (this._actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // éléments → gain de fondu (un par élément) → préampli → 10 filtres → analyser → sortie
    const ac = (this._actx = new AC());
    this._pre = ac.createGain();
    this._filt = FREQ.map((f, i) => {
      const b = ac.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === 9 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = this._cfg.eq_q;
      b.gain.value = 0;
      return b;
    });
    this._an = ac.createAnalyser();
    this._an.fftSize = 2048;
    this._an.smoothingTimeConstant = 0.55;
    this._pre.connect(this._filt[0]);
    for (let i = 0; i < 9; i++) this._filt[i].connect(this._filt[i + 1]);
    this._filt[9].connect(this._an);
    this._an.connect(ac.destination);
    this._xg = [this._auWA, this._auWA2].map((a) => {
      const g = ac.createGain();
      ac.createMediaElementSource(a).connect(g);
      g.connect(this._pre);
      return g;
    });
    this._eqApply(true);
    if (this._sinkId()) this._applySink();
    this._fft = new Uint8Array(this._an.frequencyBinCount);
    const sr = ac.sampleRate, N = this._an.fftSize;
    // Bandes logarithmiques, au moins un bin chacune.
    const bins = (fa) => Array.from({ length: NB }, (_, i) => {
      const k0 = Math.max(1, Math.floor((fa(i / NB) * N) / sr));
      return [k0, Math.max(k0 + 1, Math.min(N / 2, Math.ceil((fa((i + 1) / NB) * N) / sr)))];
    });
    this._bands = bins((x) => 40 * Math.pow(400, x)); // accueil : 40 Hz → 16 kHz
    this._bandsEq = bins(fOf); // page égaliseur : même axe que la courbe
  }

  _wa(a) {
    return !!a && (a === this._auWA || a === this._auWA2);
  }

  // Coupe un fondu en cours : seul `keep` continue, à plein gain.
  _xfStop(keep) {
    this._xf = null;
    for (const a of [this._auWA, this._auWA2, this._auDirect]) if (a && a !== keep && !a.paused) a.pause();
    if (!this._xg) return;
    const t = this._actx.currentTime;
    [this._auWA, this._auWA2].forEach((a, i) => {
      const p = this._xg[i].gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(a === keep ? 1 : 0, t);
    });
  }

  // Fondu court (précédent/suivant) : `to` muet jusqu'à ce que sa lecture parte, `from` garde son gain d'ici là.
  _xfQuick(from, to) {
    this._xf = null;
    if (this._auDirect && !this._auDirect.paused) this._auDirect.pause();
    const t = this._actx.currentTime, g = this._xg[to === this._auWA ? 0 : 1].gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
  }

  _xfRamp(from, to) {
    const t = this._actx.currentTime, d = Math.min(XQ, this._cfg.crossfade);
    [[to, 1], [from, 0]].forEach(([a, v]) => {
      const g = this._xg[a === this._auWA ? 0 : 1].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(v, t + d);
    });
    clearTimeout(this._xqT);
    this._xqT = setTimeout(() => { if (from !== this._audio && !from.paused) from.pause(); }, d * 1000 + 80);
  }

  _xfCheck(a) {
    const S = this.S, xf = this._cfg.crossfade;
    if (!xf || this._xf || a !== this._audio || !this._wa(a) || a.paused || S.src === "spotify" || S.queue.length < 2 || this._rdLive()) return;
    const dur = a.duration;
    if (!Number.isFinite(dur) || dur < xf * 3 || dur - a.currentTime > xf) return;
    const i = this._nextIdx(1, true);
    if (i < 0 || S.queue[i].live) return;
    this._xf = { from: a }; // reste posé si le fondu échoue : « ended » enchaîne alors sans fondu
    this._crossTo(a, i).catch((e) => console.warn(TAG + ": fondu", e));
  }

  async _crossTo(from, i) {
    const S = this.S, n = S.queue.length;
    i = ((i % n) + n) % n;
    const tr = S.queue[i];
    const url = await this._resolve(tr.id);
    if (S.queue[i] !== tr) i = S.queue.indexOf(tr);
    if (i < 0) return;
    if (this._xf?.from !== from || from !== this._audio || new URL(url, location.href).origin !== location.origin) return;
    const k = from === this._auWA ? 0 : 1, to = k ? this._auWA : this._auWA2;
    const gIn = this._xg[1 - k].gain, gOut = this._xg[k].gain;
    gIn.cancelScheduledValues(this._actx.currentTime);
    gIn.setValueAtTime(0, this._actx.currentTime);
    to.src = url;
    to.volume = S.vol / 100;
    await to.play();
    if (this._xf?.from !== from) { to.pause(); return; }
    const t = this._actx.currentTime, rem = Math.max(0.3, from.duration - from.currentTime);
    gIn.setValueAtTime(0, t);
    gIn.linearRampToValueAtTime(1, t + rem);
    gOut.cancelScheduledValues(t);
    gOut.setValueAtTime(1, t);
    gOut.linearRampToValueAtTime(0, t + rem);
    this._audio = to;
    S.idx = i;
    this._xf = null;
    this._showTrack();
    this._presign();
  }

  _nextIdx(d, auto) {
    const S = this.S;
    if (S.shuffle && S.queue.length > 1) {
      const j = d > 0 ? this._shufPeek() : -1;
      return j >= 0 ? j : (S.idx + 1 + Math.floor(Math.random() * (S.queue.length - 1))) % S.queue.length;
    }
    const i = S.idx + d;
    return auto && !S.shuffle && !S.repeat && i >= S.queue.length ? -1 : i;
  }

  // Aléatoire : tirage fait d'avance pour que les titres à venir soient signés ; le suivant est le premier de la liste.
  _shufPeek() {
    const S = this.S, L = this._shuf;
    if (!L || this._shufQ !== S.queue) return -1;
    while (L.length) {
      const j = L[0] === S.queue[S.idx] ? -1 : S.queue.indexOf(L[0]);
      if (j >= 0) return j;
      L.shift(); // titre en cours (déjà tiré) ou retiré de la file
    }
    return -1;
  }

  _shufFill(n) {
    const S = this.S, n0 = S.queue.length;
    if (this._shufQ !== S.queue) { this._shuf = []; this._shufQ = S.queue; }
    const L = this._shuf, cur = S.queue[S.idx];
    while (L.length && L[0] === cur) L.shift();
    const seen = new Set(L).add(cur);
    for (let k = 0; L.length < n && seen.size < n0 && k < n * 20; k++) {
      const t = S.queue[Math.floor(Math.random() * n0)];
      if (!seen.has(t)) { seen.add(t); L.push(t); }
    }
    return L;
  }

  _presign() {
    const S = this.S;
    if (!this._resolve || this._rmE() || S.src === "spotify" || S.queue.length < 2 || this._offline() || this._rdLive()) return;
    const next = S.shuffle ? this._shufFill(PRESIGN) : this._rmAhead(S.idx, PRESIGN).map((j) => S.queue[j]);
    for (const t of next) this._resolve(t.id).catch(() => {});
  }

  _offline() {
    const c = this._hass?.connection;
    return !!c && !c.connected;
  }

  // Connexion coupée (page cachée, réseau) : le titre ne peut pas être signé. Pas un échec de lecture :
  // il part quand la connexion revient.
  _waitConn(tr) {
    this._connUnwait();
    const w = { conn: this._hass.connection };
    w.f = () => {
      if (this._connW !== w) return;
      this._connUnwait();
      const S = this.S;
      if (S.on && S.src !== "spotify" && !this._rmE() && S.queue[S.idx] === tr && !this._playing()) this._playIdx(S.idx);
    };
    w.conn.addEventListener("ready", w.f);
    this._connW = w;
  }

  _connUnwait() {
    const w = this._connW;
    if (!w) return;
    this._connW = null;
    // Différé : la connexion parcourt ses écouteurs pendant qu'on retire celui-ci, le suivant serait sauté.
    setTimeout(() => w.conn.removeEventListener("ready", w.f), 0);
  }

  /* ── égaliseur ── */
  _eqLoad() {
    try {
      const v = JSON.parse(localStorage.getItem(TAG + ".eq") || "null");
      if (v && Array.isArray(v.gains) && v.gains.length === 10)
        return { gains: v.gains.map((g) => qg(num(g, 0))), preset: typeof v.preset === "string" ? v.preset : "", bypass: !!v.bypass };
    } catch (e) { /* stockage bloqué : réglage plat */ }
    return { gains: new Array(10).fill(0), preset: "Plat", bypass: false };
  }

  _eqSave() {
    clearTimeout(this._eqT);
    this._eqT = setTimeout(() => { try { localStorage.setItem(TAG + ".eq", JSON.stringify(this.S.eq)); } catch (e) { /* idem */ } }, 400);
  }

  // Préampli : retire la moitié du gain positif maximal pour éviter l'écrêtage à fond de bande.
  _eqApply(now) {
    if (!this._actx) return;
    const E = this.S.eq, t = this._actx.currentTime, tc = now ? 0.001 : 0.03;
    let mx = 0;
    this._filt.forEach((b, i) => { const g = E.bypass ? 0 : E.gains[i]; mx = Math.max(mx, g); b.gain.setTargetAtTime(g, t, tc); });
    this._pre.gain.setTargetAtTime(Math.pow(10, (-mx * 0.5) / 20), t, tc);
  }

  _eqSet(gains, preset) {
    const E = this.S.eq;
    E.gains = gains.map(qg);
    E.preset = preset;
    this._eqApply();
    this._eqPaint();
    this._eqSave();
  }

  _eqGain(i, g) {
    const E = this.S.eq;
    E.gains[i] = qg(g);
    E.preset = "";
    this._eqApply();
    this._eqPaint();
    this._eqSave();
  }

  _eqPaint() {
    if (!this._bandEls) return;
    const E = this.S.eq;
    this._bandEls.forEach((el, i) => {
      const g = E.gains[i], y = 50 - (g / GMAX) * 50, fi = el.querySelector(".fi");
      el.querySelector(".th").style.top = y + "%";
      fi.style.top = Math.min(50, y) + "%";
      fi.style.height = Math.abs(50 - y) + "%";
      el.querySelector(".g").textContent = (g > 0 ? "+" : "") + g;
      el.setAttribute("aria-valuenow", g);
    });
    for (const c of this._root.querySelectorAll("[data-p]")) c.classList.toggle("on", PRESETS[+c.dataset.p][0] === E.preset);
    const sel = this.$("select.feq");
    sel.value = [...sel.options].find((o) => o.value && o.value.replace(/\.feq$/i, "") === E.preset)?.value ?? "";
    this.$(".pre").textContent = tx(E.preset || "Personnalisé");
    const by = this.$('[data-a="bypass"]');
    by.classList.toggle("on", !E.bypass);
    by.textContent = E.bypass ? tx("EQ coupé") : tx("EQ actif");
    const sub = this._root.querySelector('.tile[data-id="eq"] small');
    if (sub) sub.textContent = this._tileSub("eq");
    this._eqCurve();
  }

  // Courbe = somme des 10 filtres, calculée d'après leurs coefficients (biquadDb).
  _eqCurve() {
    if (!this._bandEls) return;
    const E = this.S.eq, fs = this._actx?.sampleRate || 48000, q = this._cfg.eq_q;
    let d = "";
    for (let i = 0; i < 160; i++) {
      const x = i / 159, f = Math.min(fOf(x), fs * 0.499);
      let db = 0;
      if (!E.bypass) for (let b = 0; b < 10; b++) if (E.gains[b]) db += biquadDb(b === 0 ? "lowshelf" : b === 9 ? "highshelf" : "peaking", FREQ[b], E.gains[b], q, fs, f);
      d += (i ? "L" : "M") + (x * 1000).toFixed(1) + " " + (500 - (clamp(db, -GMAX, GMAX) / GMAX) * 500).toFixed(1);
    }
    this.$(".curve .ln").setAttribute("d", d);
    this.$(".curve .fl").setAttribute("d", d + "L1000 500L0 500Z");
  }

  _bindBands() {
    this._bandEls = [...this._root.querySelectorAll(".band")];
    this._bandEls.forEach((el, i) => {
      const at = (e) => { const r = this._zone.getBoundingClientRect(); return (0.5 - (e.clientY - r.top) / r.height) * 2 * GMAX; };
      el.addEventListener("pointerdown", (e) => { el.setPointerCapture(e.pointerId); el.classList.add("drag"); this._eqGain(i, at(e)); });
      el.addEventListener("pointermove", (e) => { if (el.classList.contains("drag")) this._eqGain(i, at(e)); });
      const end = () => el.classList.remove("drag");
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      el.addEventListener("dblclick", () => this._eqGain(i, 0));
      el.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); this._eqGain(i, this.S.eq.gains[i] + 0.5); }
        if (e.key === "ArrowDown") { e.preventDefault(); this._eqGain(i, this.S.eq.gains[i] - 0.5); }
      });
    });
  }

  _coverZoom(on = !this._cvz) {
    this._cvz = on;
    this.$(".ui").classList.toggle("cvz", on);
    if (on) { clearTimeout(this._idleT); this._setIdle(false); } else this._idleArm();
    requestAnimationFrame(() => this._mq());
  }

  _page(p) {
    const S = this.S;
    S.page = p;
    if (p !== "home" && this._cvz) this._coverZoom(false);
    if (p === "home") this._idleArm();
    else { clearTimeout(this._idleT); this._setIdle(false); }
    this.$(".ui").classList.toggle("eqp", p === "eq");
    this.$(".ui").classList.toggle("spp", p === "spotify" || p === "lists" || p === "out" || p === "set" || p === "radio");
    this.$(".spg").classList.toggle("rd", p === "radio");
    this.$(".plq").placeholder = p === "radio" ? tx("Chercher une station…") : tx("Chercher : artiste, album, titre…");
    if (p === "radio") { this._rdOpen(); return; }
    if (p === "out") { this._outOpen(); return; }
    if (p === "set") { this._setOpen(); return; }
    if (p === "spotify") { this._spOpen(); return; }
    if (p === "lists") { this._plOpen(); return; }
    if (p !== "eq") return;
    this._eqPaint();
    this._feqList();
    if (S.src === "spotify") this._toast(tx("Égaliseur sans effet sur Spotify : le son sort ailleurs"));
    else if (this._rmE()) this._toast(tx("Égaliseur sans effet : le son sort sur ") + this._outName());
    else if (this._audio && !this._wa(this._audio)) this._toast(tx("Égaliseur sans effet sur ce flux (autre serveur)"));
  }

  // Préréglages .feq déposés dans eq_folder, listés par index.json (HTTP ne liste pas un dossier).
  _feqList() {
    if (this._feqP) return this._feqP;
    const base = this._cfg.eq_folder.replace(/\/?$/, "/");
    this._feqP = fetch(base + "index.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => (Array.isArray(j) ? j.filter((x) => typeof x === "string" && /\.feq$/i.test(x)) : []))
      .catch(() => [])
      .then((l) => {
        this._feq = l;
        const sel = this.$("select.feq");
        sel.hidden = !l.length;
        sel.innerHTML = '<option value="">' + tx("Fichiers (") + l.length + ")</option>" +
          l.map((f) => '<option value="' + esc(f) + '">' + esc(f.replace(/\.feq$/i, "")) + "</option>").join("");
        this._eqPaint();
        return l;
      });
    return this._feqP;
  }

  async _feqLoad(name) {
    try {
      const r = await fetch(this._cfg.eq_folder.replace(/\/?$/, "/") + encodeURIComponent(name), { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const g = (await r.text()).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map(Number);
      if (!(g.length === 18 || g.length === 10) || g.some((v) => !Number.isFinite(v))) throw new Error(tx("format inattendu"));
      const g10 = feqTo10(g);
      this._eqSet(g10, name.replace(/\.feq$/i, ""));
      if (g10.some((v) => Math.abs(v) > GMAX)) this._toast(tx("Préréglage borné à ±12 dB"));
    } catch (e) {
      this._toast(tx("Préréglage illisible : ") + (e.message || e));
      this._eqPaint();
    }
  }

  async _playIdx(i) {
    const S = this.S;
    this._connUnwait();
    clearTimeout(this._rdRT);
    clearTimeout(this._rdWD);
    if (!S.queue.length) return;
    S.idx = ((i % S.queue.length) + S.queue.length) % S.queue.length;
    const tr = S.queue[S.idx];
    // Compteurs de reconnexion propres à la station : une autre station repart de zéro.
    if (tr !== this._rdOf) { this._rdOf = tr; this._rdAt = 0; this._rdTry = 0; this._rdEver = false; }
    if (tr.live) this._rdKeep(tr);
    if (this._rmE()) { this._xfStop(null); this._showTrack(); this._rmPlay(); return; }
    this._ensureAudio();
    this._ensureGraph();
    this._showTrack();
    // Flux d'une station : son URL est connue, aucune attente avant de changer d'élément (voir _onError).
    let url = tr.live ? tr.url : "";
    if (!url) {
      try {
        this._resolve ||= (await mediaSource()).lazyResolver(() => this._hass);
        url = await this._resolve(tr.id);
      } catch (e) {
        if (this._offline()) { if (S.queue[S.idx] === tr) this._waitConn(tr); }
        else this._onError(null, e);
        return;
      }
      if (S.queue[S.idx] !== tr) return; // un autre titre a été demandé pendant la résolution
    }
    this._liveUp = false;
    if (location.protocol === "https:" && url.startsWith("http:")) {
      if (!tr.live) { this._toast(tx("Bloqué : flux http dans une page https")); return; }
      // Page https : le flux http serait bloqué, sa version https est tentée (Chrome fait de même avec l'audio).
      url = "https:" + url.slice(5);
      this._liveUp = true;
    }
    const same = new URL(url, location.href).origin === location.origin;
    // Une station étrangère passe d'abord par Web Audio (égaliseur, vrai spectre) : la plupart envoient l'en-tête CORS.
    // Sans lui l'élément échoue, l'URL est notée et le flux rejoué sur l'élément direct.
    if (tr.live) this._liveUrl = url;
    const cur = this._audio, wa = this._wa(cur) ? cur : this._auWA;
    // Changement de titre pendant la lecture : fondu court sur l'autre élément Web Audio au lieu d'une coupure.
    const quick = !tr.live && same && this._cfg.crossfade > 0 && this._xg && this._auWA2 && this._wa(cur) && !cur.paused;
    const next = quick ? (cur === this._auWA ? this._auWA2 : this._auWA)
      : tr.live ? (this._noCors?.has(url) ? this._auDirect : wa) : same ? wa : this._auDirect;
    if (quick) this._xfQuick(cur, next);
    else this._xfStop(next);
    this._audio = next;
    next.src = url;
    next.volume = S.vol / 100;
    try {
      if (this._actx?.state === "suspended") await this._actx.resume();
      await next.play();
      if (quick && this._audio === next) this._xfRamp(cur, next);
    } catch (e) {
      // Chargement raté : l'élément émet « error » (traité par son écouteur) puis rejette play() en NotSupportedError.
      // Le traiter aussi ici compterait l'échec deux fois ; element.error ne peut pas trier, load() dans l'écouteur le remet à null.
      if (e.name !== "AbortError" && e.name !== "NotSupportedError") this._onError(next, e);
    }
  }

  _onEnded() {
    const S = this.S;
    if (this._rdLive()) { this._rdRetry(); return; } // un direct qui « finit » a été coupé
    if (!S.repeat && !S.shuffle && S.idx >= S.queue.length - 1) { this._showSource(); return; }
    this._step(1, true);
  }

  _onError(a, e) {
    const S = this.S;
    if (a && a !== this._audio) return;
    if (this._rdLive()) {
      const url = this._liveUrl, t = S.queue[S.idx].title;
      // NotAllowedError = lecture refusée faute de geste (autoplay) : ni CORS ni réseau.
      if (e?.name === "NotAllowedError") { this._toast(tx("Lecture impossible : ") + t); this._showSource(); return; }
      // La station a déjà joué : coupure réseau, on retente.
      if (this._rdEver) { this._rdRetry(); return; }
      // Premier essai sur un élément Web Audio : le serveur n'envoie sans doute pas l'en-tête CORS.
      if (this._wa(a) && url && !this._noCors?.has(url)) {
        (this._noCors ||= new Set()).add(url);
        // URL gardée sur la station : le rejeu change d'élément sans attendre une nouvelle résolution.
        const tr = S.queue[S.idx];
        if (!tr.url) tr.url = url;
        this._playIdx(S.idx);
        return;
      }
      console.warn(TAG + ": station", t, e || a?.error);
      this._toast(tx(this._liveUp ? "Station injoignable en https : " : "Station injoignable : ") + t);
      this._showSource();
      return;
    }
    console.warn(TAG + ": lecture", S.queue[S.idx]?.title, e || a?.error);
    S.fails++;
    this._toast(tx("Lecture impossible : ") + (S.queue[S.idx]?.title || tx("titre")));
    if (S.fails < 3 && S.queue.length > 1) this._step(1, true);
  }

  _playing() {
    if (this.S.src === "spotify") return this._spState()?.state === "playing";
    if (this._rmE()) return this._rmSt()?.state === "playing";
    return !!this._audio && !this._audio.paused && !this._audio.ended;
  }

  _showTrack() {
    const S = this.S, tr = S.queue[S.idx];
    if (S.src === "radio") {
      const t = this._rdOwn() && tr ? tr : this._rdLast();
      this._setTitle(t ? t.title : tx("Choisissez une station"));
      this.$(".artist").textContent = t?.sub || "";
      const art = t?.thumb || "";
      this._setCover(art);
      if (t) this._msMeta(t.title, t.sub || "", tx("Radio"), art || this._cover);
      this.$(".pp").innerHTML = svg(this._playing() ? "pause" : "play");
      if (S.page === "lists" && this._plView?.kind === "queue" && !this._plDrag) this._plRows(true);
      return;
    }
    const lib = S.libs[S.src];
    const m = tr && this._tagC?.get(tr.id);
    const title = m?.title || (tr ? tr.title.replace(/\.(mp3|flac|ogg|opus|m4a|aac|wav)$/i, "") : lib ? tx("Prêt") : tx("Touchez pour lire"));
    this._setTitle(m?.artist ? m.artist + " - " + title : title);
    this.$(".artist").textContent = lib ? (m?.album || lib.title) + (tr ? " · " + (S.idx + 1) + "/" + S.queue.length : "") : "";
    const art = m?.art || (tr?.thumb ? this._abs(tr.thumb) : "");
    // Tags du titre pas encore lus : l'ancienne pochette reste, le fondu ira droit vers la nouvelle (sans passer par la neutre).
    if (!tr || m || tr.thumb) this._setCover(art);
    if (tr) this._msMeta(title, m?.artist || lib?.title || "", m?.album || lib?.title || "", art || this._cover);
    if (tr && !m) this._tagsFor(tr);
    else if (tr) this._tagsAhead();
    this.$(".pp").innerHTML = svg(this._playing() ? "pause" : "play");
    if (S.page === "lists" && this._plView?.kind === "queue" && !this._plDrag) this._plRows(true);
  }

  /* ── tags et pochette du titre courant : APIC/PICTURE intégré (tags.js), sinon image du dossier ── */
  // Lu à l'affichage du titre, deux requêtes Range au plus : pas de lecture de toute la bibliothèque.
  async _tagsFor(tr) {
    if (this.S.src === "spotify" || tr.live || this._tagFor === tr.id) return;
    this._tagFor = tr.id;
    this._tagAb?.abort();
    const ab = (this._tagAb = new AbortController());
    const m = await this._tagsRead(tr, ab);
    if (!m) return;
    if (m.lost && this._tagFor === tr.id) this._tagFor = null;
    this._tagPut(tr, m);
    if (this.S.queue[this.S.idx] === tr) this._showTrack();
  }

  // Titre suivant lu d'avance (pochette, artiste) : il s'affiche dès son départ, y compris sur une sortie déportée.
  async _tagsAhead() {
    const S = this.S;
    if (S.src === "spotify" || S.src === "radio" || S.queue.length < 2 || this._offline()) return;
    const tr = S.shuffle ? this._shufFill(1)[0] : S.queue[this._rmAhead(S.idx, 1)[0]];
    if (!tr || tr.live || this._tagC?.has(tr.id) || this._tagPre === tr.id) return;
    this._tagPre = tr.id;
    this._tagPreAb?.abort();
    const ab = (this._tagPreAb = new AbortController());
    const m = await this._tagsRead(tr, ab);
    if (this._tagPre === tr.id) this._tagPre = null;
    if (!m || m.lost || this._tagC?.has(tr.id)) { if (m?.art.startsWith("blob:")) URL.revokeObjectURL(m.art); return; }
    this._tagPut(tr, m);
    if (S.queue[S.idx] === tr) this._showTrack();
  }

  _tagPut(tr, m) {
    const c = (this._tagC ||= new Map()), was = c.get(tr.id)?.art;
    // Même titre lu deux fois (d'avance et à son départ) : l'image remplacée est libérée si elle n'est pas affichée.
    if (was && was !== m.art && was.startsWith("blob:") && this.$(".cover img")?.dataset.src !== was) URL.revokeObjectURL(was);
    c.set(tr.id, m);
    while (c.size > TAG_CACHE) {
      const [k, old] = c.entries().next().value;
      c.delete(k);
      if (old.art.startsWith("blob:") && this.$(".cover img")?.dataset.src !== old.art) URL.revokeObjectURL(old.art);
    }
  }

  // null = lecture abandonnée (un autre titre a été demandé).
  async _tagsRead(tr, ab) {
    const m = { title: "", artist: "", album: "", art: "" };
    try {
      if (tr.id.startsWith("media-source://")) {
        this._resolve ||= (await mediaSource()).lazyResolver(() => this._hass);
        const url = await this._resolve(tr.id);
        // Les flux d'ailleurs refuseraient la lecture partielle (CORS) : seuls les fichiers de HA.
        if (new URL(url, location.href).origin === location.origin) {
          const t = await (await tagsMod()).readTags(url, ab.signal);
          if (t) {
            m.title = t.title || ""; m.artist = t.artist || ""; m.album = t.album || "";
            if (t.pic) m.art = URL.createObjectURL(new Blob([t.pic.data], { type: t.pic.mime }));
          }
        }
        if (!m.art && tr.cover && !ab.signal.aborted) m.art = await this._resolve(tr.cover);
      }
      if (!m.art && m.artist && !ab.signal.aborted) m.art = await this._discogsCover(m);
    } catch (e) {
      // Connexion coupée : ce qui a été lu reste affiché, le reste est redemandé à son retour (set hass).
      if (this._offline()) m.lost = true;
      else if (!ab.signal.aborted) console.debug(TAG + ": tags", e.message || e);
    }
    if (ab.signal.aborted) { if (m.art.startsWith("blob:")) URL.revokeObjectURL(m.art); return null; }
    return m;
  }

  // Dernier recours : service pyscript.neon_media_cover (Discogs, jeton côté serveur, cache disque).
  // Absent chez qui n'a pas le pyscript : on n'appelle rien.
  async _discogsCover(m) {
    if (!this._hass?.services?.pyscript?.neon_media_cover) return "";
    const key = m.artist + "|" + (m.album || m.title);
    const c = (this._dcC ||= new Map());
    if (!c.has(key)) {
      c.set(key, this._hass.callWS({ type: "call_service", domain: "pyscript", service: "neon_media_cover",
        service_data: { artist: m.artist, album: m.album, title: m.title }, return_response: true })
        .then((r) => r?.response?.url || "", (e) => {
          // Connexion coupée : pas de réponse à garder, la demande sera refaite.
          if (this._offline()) { c.delete(key); throw e; }
          return "";
        }));
    }
    return c.get(key);
  }

  // Nouvelle pochette : l'ancienne reste par-dessus le temps que la nouvelle charge, puis s'efface (fondu enchaîné).
  _setCover(src) {
    const img = this.$(".cover img"), want = src || this._cover;
    if (img.dataset.src === want) return;
    img.dataset.src = want;
    const box = img.parentNode;
    let ghost = null;
    if (img.complete && img.naturalWidth && !REDUCED) {
      box.querySelector(".ghost")?.remove();
      ghost = img.cloneNode();
      ghost.className = "ghost";
      ghost.removeAttribute("data-src");
      box.appendChild(ghost);
    }
    const fade = () => {
      img.onload = img.onerror = null;
      this._ar.style.setProperty("--cvu", 'url("' + img.src.replace(/"/g, "%22") + '")');
      if (!ghost) return;
      // Image déjà en cache : le chargement peut tomber avant le premier rendu du calque, l'effacement partirait de 0.
      requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add("out")));
      setTimeout(() => ghost.remove(), 900);
    };
    img.onload = fade;
    img.onerror = () => { if (img.src !== this._cover) img.src = this._cover; else fade(); };
    img.src = want;
  }

  _abs(u) {
    return u.startsWith("/") && typeof this._hass?.hassUrl === "function" ? this._hass.hassUrl(u) : u;
  }

  /* ── transport (navigateur ou Spotify) ── */
  _playPause() {
    const S = this.S;
    if (!S.on) this._power();
    if (S.src === "spotify") { this._spPlayPause(); return; }
    // Carte rouverte pendant que le lecteur joue : elle n'a plus la main, play/pause pilote ce qui s'y trouve.
    // Une URL http en pause est presque toujours la file qu'elle y avait posée ; le reste (radio, file Sonos) est remplacé.
    const rs = this._rmE() && !this._rmOwn() && !this._rm?.pend ? this._rmSt() : null;
    if (rs?.state === "playing") { this._rmCall("media_pause"); return; }
    if (rs?.state === "paused" && /^https?:/.test(rs.attributes?.media_content_id || "")) { this._rmCall("media_play"); return; }
    // Source Radio sans file de stations : la dernière écoutée repart, sinon la page des favoris s'ouvre.
    if (S.src === "radio" && (!this._rdOwn() || !S.queue.length)) { this._rdResume(); return; }
    if (!S.queue.length || (S.queueOf !== S.src && !S.queueOf?.startsWith(S.src + ":"))) { this._loadLib(S.src, true); return; }
    if (this._rmE()) {
      if (this._rm?.pend) return; // lecteur en cours d'allumage
      if (!this._rmOwn()) this._playIdx(Math.max(0, S.idx));
      // Un direct ne se met pas en pause : il s'arrête, et la lecture renvoie la station.
      else if (this._rdLive()) { if (this._rmPlaying()) this._rmHalt(); else this._playIdx(S.idx); }
      else this._rmCall(this._rmPlaying() ? "media_pause" : "media_play");
      return;
    }
    if (!this._audio?.src) { this._playIdx(S.idx); return; }
    if (this._audio.paused) {
      this._actx?.resume();
      this._audio.play().catch((e) => this._onError(this._audio, e));
    } else if (this._rdLive()) this._rdStop();
    else {
      this._xfStop(this._audio);
      this._audio.pause();
    }
  }

  _step(d, auto = false) {
    const S = this.S;
    if (S.src === "spotify") { this._call(d < 0 ? "media_previous_track" : "media_next_track"); this._spKick(); return; }
    // Source Radio sans station en file : la dernière écoutée repart ; une fin de titre d'une autre source ne lance rien.
    if (S.src === "radio" && (!this._rdOwn() || !S.queue.length)) { if (!auto) this._rdResume(); return; }
    if (!S.queue.length) return;
    // Stations : précédent/suivant passent à la voisine, sans aléatoire ni retour au début du titre.
    if (this._rdLive()) { this._playIdx(S.idx + d); return; }
    if (this._rmE() && this._rmOwn()) { this._rmStep(d, auto); return; }
    if (d < 0 && this._audio && this._audio.currentTime > 3) { this._audio.currentTime = 0; return; }
    const i = this._nextIdx(d, auto);
    if (i >= 0) this._playIdx(i);
  }

  _seek(f) {
    if (this.S.src === "radio" || (this.S.src !== "spotify" && this._rdLive())) return;
    if (this.S.src === "spotify") {
      const dur = this._spState()?.attributes?.media_duration;
      if (dur) this._call("media_seek", { seek_position: Math.round(f * dur) });
    } else if (this._rmE()) {
      const dur = this._rmPos()[1];
      if (!this._rmOwn() || !dur) return;
      if (this._rmHas(MP_SEEK)) this._rmCall("media_seek", { seek_position: Math.round(f * dur) });
      else this._toast(tx("Ce lecteur ne sait pas avancer dans le titre"));
    } else if (this._audio && Number.isFinite(this._audio.duration)) this._audio.currentTime = f * this._audio.duration;
  }

  _toggleShuffle() {
    const S = this.S;
    if (S.src === "spotify") this._call("shuffle_set", { shuffle: !this._spState()?.attributes?.shuffle });
    else { S.shuffle = !S.shuffle; this._playSave(); this._showSource(); }
  }

  _toggleRepeat() {
    const S = this.S;
    if (S.src === "spotify") this._call("repeat_set", { repeat: (this._spState()?.attributes?.repeat ?? "off") === "off" ? "all" : "off" });
    else { S.repeat = !S.repeat; this._playSave(); this._showSource(); }
  }

  /* ── lecteurs de la maison : la carte garde la file, le lecteur joue ── */
  // S.out : "" = ce navigateur, sinon un media_player. Spotify garde son appareil Connect.
  _rmE() {
    const e = this.S.out;
    return e && this.S.src !== "spotify" && this._hass?.states?.[e] ? e : "";
  }

  _rmSt() {
    const e = this._rmE();
    return e ? this._hass.states[e] : null;
  }

  _rmHas(bit) {
    return (num(this._rmSt()?.attributes?.supported_features, 0) & bit) === bit;
  }

  // La carte n'a la main que sur ce qu'elle a lancé : une radio partie d'ailleurs reste à son appli.
  _rmOwn() {
    return !!this._rm?.own && this._rm.e === this._rmE();
  }

  _rmPlaying() {
    return this._rmOwn() && this._rmSt()?.state === "playing";
  }

  // Un direct s'arrête au lieu de se mettre en pause : le lecteur garderait le flux et reprendrait en retard.
  _rmHalt() { this._rmCall(this._rdLive() && this._rmHas(MP_STOP) ? "media_stop" : "media_pause"); }

  _rmCall(service, data = {}, quiet) {
    const e = this._rmE();
    if (!e) return Promise.resolve(false);
    if (!quiet) this._rmAsk = Date.now() + RM_ASK_MS;
    return this._hass.callService("media_player", service, { entity_id: e, ...data }).then(() => true,
      (err) => { this._toast(this._outName() + " : " + (err.message || err)); return false; });
  }

  _rmPos() {
    const st = this._rmSt(), a = st?.attributes || {};
    let pos = num(a.media_position, 0);
    if (st?.state === "playing" && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    return [Math.min(pos, num(a.media_duration, 0) || pos), num(a.media_duration, 0)];
  }

  // Titres suivants dans l'ordre de la carte (aléatoire compris), sans doublon.
  _rmAhead(from, n) {
    const S = this.S, L = S.queue.length, out = [], seen = new Set([from]);
    let j = from;
    while (out.length < n && seen.size < L) {
      if (S.shuffle) { do j = Math.floor(Math.random() * L); while (seen.has(j)); }
      else { j++; if (j >= L) { if (!S.repeat) break; j = 0; } if (seen.has(j)) break; }
      seen.add(j);
      out.push(j);
    }
    return out;
  }

  async _rmPlay() {
    const S = this.S, e = this._rmE(), tr = S.queue[S.idx];
    if (!e || !tr) return;
    const tok = (this._rmTok = (this._rmTok || 0) + 1);
    this._rm = { e, own: true, cid: "", win: null, last: null, pend: true };
    this._rmAsk = Date.now() + RM_ASK_MS;
    if (this._rmSt().state === "off" && this._rmHas(MP_ON)) {
      // Un récepteur Cast en veille met parfois plus de 10 s à lancer son appli : HA lève alors un délai dépassé
      // alors que l'appareil finit par s'allumer. Seul l'état fait foi, attendu jusqu'à 25 s.
      await this._hass.callService("media_player", "turn_on", { entity_id: e }).catch(() => {});
      for (let i = 0; i < 100 && this._rmSt()?.state === "off"; i++) await sleep(250);
      if (tok !== this._rmTok) return;
      if (this._rmSt()?.state === "off") { this._rm.own = this._rm.pend = false; this._toast(this._outName() + tx(" ne s'allume pas")); return; }
    }
    this._rm.pend = false;
    // Station : un seul flux, sans file ; un id Radio Browser laisse HA donner au lecteur l'URL qu'il sait jouer.
    if (tr.live) { if (!(await this._rmCall("play_media", { media_content_id: this._rdRemoteId(tr), media_content_type: "music" }))) this._rm.own = false; return; }
    const play = (t, enqueue) => this._rmCall("play_media", { media_content_id: t.id, media_content_type: "music", ...(enqueue ? { enqueue } : {}) });
    if (!this._rmHas(MP_ENQUEUE | MP_NEXT)) { if (!(await play(tr))) this._rm.own = false; return; }
    // File du lecteur : son aléatoire et sa répétition coupés, l'ordre est celui de la carte.
    const a = this._rmSt().attributes || {};
    if (a.shuffle) await this._rmCall("shuffle_set", { shuffle: false });
    if (a.repeat && a.repeat !== "off") await this._rmCall("repeat_set", { repeat: "off" });
    if (tok !== this._rmTok) return;
    if (!(await play(tr, "replace"))) { this._rm.own = false; return; }
    this._rm.win = [S.idx];
    await this._rmFill(tok);
  }

  // Complète la file du lecteur jusqu'à RM_WIN titres d'avance, un appel par titre (enqueue add).
  async _rmFill(tok) {
    const R = this._rm, S = this.S;
    if (!R?.win || this._rmFilling) return;
    this._rmFilling = true;
    try {
      const pos = num(this._rmSt()?.attributes?.queue_position, 1), want = pos - 1 + RM_WIN;
      for (const j of this._rmAhead(R.win[R.win.length - 1], Math.max(0, want - R.win.length))) {
        if (tok !== this._rmTok || this._rm !== R || !S.queue[j]) return;
        if (!(await this._rmCall("play_media", { media_content_id: S.queue[j].id, media_content_type: "music", enqueue: "add" }))) return;
        R.win.push(j);
      }
    } finally {
      this._rmFilling = false;
    }
  }

  _rmStep(d, auto) {
    const S = this.S, R = this._rm, a = this._rmSt()?.attributes || {};
    if (d < 0 && this._rmPos()[0] > 3 && this._rmHas(MP_SEEK)) { this._rmCall("media_seek", { seek_position: 0 }); return; }
    if (R.win) {
      const p = num(a.queue_position, 0);
      if (d > 0 && p && p < R.win.length) { this._rmCall("media_next_track"); return; }
      if (d < 0 && p > 1) { this._rmCall("media_previous_track"); return; }
    }
    const i = this._nextIdx(d, auto);
    if (i >= 0) this._playIdx(i);
  }

  // Carte retirée de la page (autre vue, panneau d'une page cachée) : HA ne lui passe plus hass.
  // Elle suit alors elle-même la sortie qu'elle pilote, sinon la fin du titre passerait inaperçue.
  _rmWatch() {
    const e = this._rmE(), conn = this._hass?.connection;
    if (this._rmSub || !e || !this._rmOwn() || !conn) return;
    const sub = { e };
    // Connexion suspendue : la promesse attend son retour, l'abonnement est rétabli à chaque reconnexion.
    sub.p = conn.subscribeMessage((m) => this._rmFeed(sub, m), { type: "subscribe_entities", entity_ids: [e] });
    sub.p.catch(() => { if (this._rmSub === sub) this._rmSub = null; });
    this._rmSub = sub;
  }

  _rmUnwatch() {
    const sub = this._rmSub;
    if (!sub) return;
    this._rmSub = null;
    sub.p.then((u) => u()).catch(() => {});
  }

  // Messages compressés de subscribe_entities : a = état complet, c = changements (+ ajouts, - attributs retirés), r = supprimée.
  _rmFeed(sub, m) {
    if (this._rmSub !== sub) return;
    if (this.isConnected) { this._rmUnwatch(); return; }
    const e = sub.e, h = this._hass, a = m.a?.[e], c = m.c?.[e];
    let st = h.states[e];
    if (m.r?.includes(e)) { this._rmUnwatch(); return; }
    if (a) st = { entity_id: e, state: a.s, attributes: a.a || {} };
    else if (c && st) {
      st = { ...st, attributes: { ...st.attributes } };
      if (c["+"]) { if ("s" in c["+"]) st.state = c["+"].s; Object.assign(st.attributes, c["+"].a || {}); }
      for (const k of c["-"]?.a || []) delete st.attributes[k];
    } else return;
    this._hass = { ...h, states: { ...h.states, [e]: st } };
    this._syncRemote();
    if (!this._rmOwn()) this._rmUnwatch();
  }

  // Suit le lecteur : titre en cours (file du lecteur), fin de titre (titre par titre), perte de la main.
  _syncRemote() {
    const e = this._rmE();
    if (!e) return;
    const S = this.S, st = this._hass.states[e], a = st.attributes || {}, R = this._rm;
    const key = [e, st.state, a.media_content_id, a.queue_position, a.queue_size, a.volume_level, a.media_position_updated_at].join("|");
    if (key === this._rmKey) return;
    this._rmKey = key;
    if (Number.isFinite(a.volume_level) && Date.now() > (this._volLock || 0)) this._setVol(a.volume_level * 100, false);
    if (R?.own && R.e === e) {
      const busy = Date.now() < (this._rmAsk || 0) || this._rmFilling;
      const prev = R.last;
      if (st.state === "playing") R.last = { pos: num(a.media_position, 0), at: Date.parse(a.media_position_updated_at || "") || Date.now(), dur: num(a.media_duration, 0) };
      if (R.win) {
        const p = num(a.queue_position, 0);
        // Une file remplacée ailleurs (appli Sonos, Spotify) n'a plus la taille de la nôtre.
        if (!busy && a.queue_size !== undefined && a.queue_size !== R.win.length) R.own = false;
        else if (p && R.win[p - 1] !== undefined && R.win[p - 1] !== S.idx) { S.idx = R.win[p - 1]; this._showTrack(); }
        if (R.own && !busy && st.state === "playing" && p && R.win.length - p < RM_WIN / 3) this._rmFill(this._rmTok);
      } else if (!busy) {
        if (st.state === "playing" && !R.cid) R.cid = a.media_content_id || "-";
        else if (R.cid && a.media_content_id && a.media_content_id !== R.cid) R.own = false;
        // Fin du titre : jugée sur la dernière position connue en lecture, l'état d'arrêt la remet souvent à 0.
        // Éteint ou injoignable = geste de quelqu'un : on n'enchaîne pas.
        // Un direct n'a pas de fin : son arrêt vient d'un geste, la station suivante ne part pas seule.
        if (R.own && prev && !S.queue[S.idx]?.live && st.state !== "playing" && !["off", "unavailable", "unknown"].includes(st.state)) {
          const at = prev.pos + (Date.now() - prev.at) / 1000;
          if (st.state === "idle" || (prev.dur && at >= prev.dur - 4)) { R.last = null; this._step(1, true); }
        }
      }
      // Hors lecture, la position ne court plus : la garder ferait compter une pause comme une fin de titre.
      if (st.state !== "playing") R.last = null;
    }
    this._showSource();
  }

  /* ── page Sorties ── */
  _outs() {
    const st = this._hass?.states || {};
    return this._cfg.outputs.length ? this._cfg.outputs : OUT_DFLT.filter((e) => st[e]);
  }

  _sinkId() {
    try { return localStorage.getItem(TAG + ".sink") || ""; } catch (e) { return ""; }
  }

  async _applySink() {
    const id = this._sinkId();
    try {
      if (SINK && this._actx) await this._actx.setSinkId(id);
      if (this._auDirect?.setSinkId) await this._auDirect.setSinkId(id);
    } catch (e) {
      this._toast(tx("Sortie audio indisponible : ") + (e.message || e));
    }
  }

  _outName() {
    const S = this.S;
    if (S.src === "spotify") return this._spState()?.attributes?.source || "Spotify Connect";
    const e = this._rmE();
    if (e) return this._hass.states[e].attributes?.friendly_name || e;
    const d = this._sinkId() && this._devs?.find((x) => x.deviceId === this._sinkId());
    return d?.label || tx("Navigateur");
  }

  _outOpen() {
    this.$(".sphead .kicker").textContent = tx("Sorties");
    this.$(".spt").textContent = tx("Où sort le son");
    this.$('[data-a="spup"]').hidden = this.$('[data-a="spall"]').hidden = true;
    this.$(".spsort").innerHTML = this.$(".plnav").innerHTML = "";
    this.$(".plq").hidden = true;
    this.$(".spg").classList.remove("virt");
    this._outKey = null;
    this._outRender();
    if (SINK) this._outDevs(false);
  }

  // Sans accès au micro, Chrome masque les noms des sorties : on ne le demande qu'au geste.
  async _outDevs(ask) {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    if (ask) {
      try { (await md.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); }
      catch (e) { this._toast(tx("Accès refusé : noms des sorties indisponibles")); }
    }
    try { this._devs = (await md.enumerateDevices()).filter((d) => d.kind === "audiooutput" && d.deviceId !== "communications"); }
    catch (e) { this._devs = []; }
    this._outKey = null;
    if (this.S.page === "out") this._outRender();
  }

  _outRender() {
    if (this.S.page !== "out") return;
    const S = this.S, st = this._hass?.states || {}, sp = this._spState(), outs = this._outs();
    const key = JSON.stringify([S.src, S.out, this._sinkId(), this._devs?.map((d) => d.deviceId + d.label), outs.map((e) => st[e]?.state + st[e]?.attributes?.friendly_name),
      sp?.attributes?.source, sp?.attributes?.source_list]);
    if (key === this._outKey) return;
    this._outKey = key;
    const row = (a, o, ic, name, sub, cur, off) => '<button class="spi' + (cur ? " cur" : "") + '" data-a="' + a + '" data-o="' + esc(o) + '"' + (off ? " disabled" : "") +
      '><span class="art">' + svg(ic) + '</span><span class="nm">' + esc(name) + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span></button>";
    const ST = { playing: "en lecture", paused: "en pause", idle: "en attente", off: "éteint", on: "allumé", unavailable: "injoignable", buffering: "chargement" };
    const mp3 = S.src !== "spotify", loc = !S.out;
    let h = '<p class="sph">' + tx("Ce navigateur") + '</p>';
    const devs = (this._devs || []).filter((d) => d.deviceId && d.deviceId !== "default"), sink = this._sinkId();
    h += row("outbr", "", "out", tx("Sortie par défaut"), SINK ? tx("celle du système") : tx("AirPlay ou réglages de l'appareil pour changer"), loc && !sink, false);
    devs.forEach((d, i) => { h += row("outbr", d.deviceId, "out", d.label || tx("Sortie audio ") + (i + 1), "", loc && sink === d.deviceId, false); });
    if (SINK && (!this._devs || devs.some((d) => !d.label) || !devs.length)) h += row("outlist", "", "out", tx("Lister les sorties"), tx("demande l'accès au micro une fois, pour leurs noms"), false, false);
    h += '<p class="sph">' + tx("Lecteurs de la maison · MP3") + '</p>';
    if (!outs.length) h += '<p class="spmsg">' + tx("Aucun lecteur : option outputs de la carte") + '</p>';
    for (const e of outs) {
      const s = st[e], q = s && (num(s.attributes?.supported_features, 0) & MP_ENQUEUE);
      h += row("outrm", e, "volup", s?.attributes?.friendly_name || e, s ? (tx(ST[s.state]) || s.state) + (q ? tx(" · enchaîne seul") : tx(" · enchaîné par la carte")) : tx("introuvable"),
        S.out === e, !s || s.state === "unavailable");
    }
    h += '<p class="sph">Spotify Connect</p>';
    const L = sp?.attributes?.source_list || [];
    if (!this._cfg.entity) h += '<p class="spmsg">' + tx("Lecteur Spotify non réglé") + '</p>';
    else if (!L.length) h += '<p class="spmsg">' + tx("Aucun appareil Spotify Connect") + '</p>';
    for (const n of L) h += row("outsp", n, "spotify", n, "", sp.attributes.source === n, false);
    const g = this.$(".spg"), y = g.scrollTop;
    g.classList.add("rows");
    g.classList.toggle("dim", !mp3);
    g.innerHTML = h;
    g.scrollTop = y;
  }

  async _outAct(a, o) {
    const S = this.S;
    if (a === "outlist") { this._outDevs(true); return; }
    if (a === "outsp") {
      if (!this._cfg.entity) { this._toast(tx("Lecteur Spotify non réglé")); return; }
      this._toast(tx("Spotify sur ") + o);
      await this._call("select_source", { source: o });
      return;
    }
    const from = this._rmE(), was = S.src !== "spotify" && (from ? this._rmPlaying() : this._playing());
    if (a === "outbr") {
      if (from && this._rmPlaying()) this._rmHalt();
      try { if (o) localStorage.setItem(TAG + ".sink", o); else localStorage.removeItem(TAG + ".sink"); } catch (e) { /* stockage bloqué */ }
      S.out = "";
      this._rm = null;
      for (const x of [this._auWA, this._auWA2, this._auDirect]) if (x) x.volume = S.vol / 100;
      this._applySink();
    } else if (a === "outrm") {
      if (from === o) return;
      if (from && this._rmPlaying()) this._rmHalt();
      if (this._rdLive()) this._rdStop(); else this._audio?.pause();
      S.out = o;
      this._rm = null;
      this._rmKey = null;
      // On lit le volume de l'ampli, on ne lui impose pas celui de la carte.
      const v = this._hass?.states?.[o]?.attributes?.volume_level;
      if (Number.isFinite(v)) this._setVol(v * 100, false);
    }
    this._playSave();
    this._outKey = null;
    this._showSource();
    this._outRender();
    if (S.src === "spotify") this._toast(tx("Sortie des MP3 : ") + (S.out ? this._hass.states[S.out]?.attributes?.friendly_name || S.out : tx("ce navigateur")) + tx(" (Spotify garde son appareil)"));
    else if (was && S.queue[S.idx]) this._playIdx(S.idx);
  }

  /* ── page Réglages : surcharges propres à cet appareil ── */
  _setLoad() {
    let o;
    try { o = JSON.parse(localStorage.getItem(TAG + ".set") || "{}"); } catch (e) { o = this._setMem; }
    const r = {};
    if (!o || typeof o !== "object") return r;
    for (const k of SET_KEYS) {
      if (k === "theme" ? THEMES.includes(o[k]) : k === "font" ? FONT_IDS.includes(o[k]) : Number.isFinite(o[k])) r[k] = o[k];
    }
    return r;
  }

  _setPut(k, v) {
    const o = this._setLoad();
    if (k === null) for (const x of Object.keys(o)) delete o[x];
    else if (typeof k === "object") Object.assign(o, k);
    else if (v === undefined) delete o[k];
    else o[k] = v;
    this._setMem = o;
    try {
      if (Object.keys(o).length) localStorage.setItem(TAG + ".set", JSON.stringify(o));
      else localStorage.removeItem(TAG + ".set");
    } catch (e) { /* stockage bloqué : réglage gardé jusqu'au rechargement */ }
    this.setConfig(this._cfgRaw);
    this._showSource();
  }

  _setOpen() {
    this.$(".sphead .kicker").textContent = tx("Réglages");
    this.$(".spt").textContent = tx("Cet appareil");
    this.$('[data-a="spup"]').hidden = this.$('[data-a="spall"]').hidden = true;
    this.$(".spsort").innerHTML = this.$(".plnav").innerHTML = "";
    this.$(".plq").hidden = true;
    const g = this.$(".spg");
    g.classList.remove("virt", "dim");
    g.classList.add("rows");
    g.scrollTop = 0;
    this._setRender();
  }

  _setRender() {
    if (this.S.page !== "set") return;
    const c = this._cfg, ov = this._setLoad(), S = this.S, n = Object.keys(ov).length;
    const mod = (k) => (k in ov ? " mod" : "");
    const rst = (k) => (k in ov ? '<button class="chip rst" data-a="setrst" data-o="' + k + '" title="' + tx("Revenir à la valeur de la carte") + '" aria-label="' + tx("Revenir à la valeur de la carte") + '">↺</button>' : "");
    const sl = (k) => {
      const [l0, fmt] = SET_UI[k], lab = tx(l0), [lo, hi, step] = RANGES[k];
      return '<div class="setr' + mod(k) + (k === "hue" || k === "hue2" ? " " + k : "") + '"><span class="nm">' + lab + "<small>" + fmt(c[k]) + "</small></span>" +
        '<input type="range" data-k="' + k + '" min="' + lo + '" max="' + hi + '" step="' + step + '" value="' + c[k] + '" aria-label="' + lab + '">' + rst(k) + "</div>";
    };
    const btn = (a, ic, name, sub, off) => '<button class="spi" data-a="' + a + '"' + (off ? " disabled" : "") + '><span class="art">' + ic +
      '</span><span class="nm">' + esc(name) + "<small>" + esc(sub) + "</small></span></button>";
    let h = '<p class="sph">' + tx("Façade") + '</p><div class="setr' + mod("theme") + '"><span class="nm">' + tx("Thème") + '<small>' + cap(c.theme) + '</small></span><span class="setc">' +
      THEMES.map((t) => '<button class="chip' + (c.theme === t ? " on" : "") + '" data-a="setth" data-o="' + t + '">' + cap(t) + "</button>").join("") + "</span>" + rst("theme") + "</div>";
    const sw = (a, b) => { const [A, A2] = accCols(a, b, c.vivid); return '<i class="sw" style="background:linear-gradient(90deg,' + rgbs(A) + "," + rgbs(A2) + ')"></i>'; };
    const ht = c.palette_ha ? [c.hue, c.hue2] : this._haHues(), pon = (p) => !c.palette_ha && p[1] === c.hue && p[2] === c.hue2;
    h += '<p class="sph">' + tx("Couleurs") + '</p><div class="setr"><span class="nm">' + tx("Palette") + '<small>' + (c.palette_ha ? tx("Thème HA") : tx(PALETTES.find(pon)?.[0] || "Personnalisée")) +
      '</small></span><span class="setc"><button class="chip pal' + (c.palette_ha ? " on" : "") + '" data-a="setpalha"' + (ht ? "" : " disabled") +
      ' title="' + tx("Teintes de la couleur principale et de la couleur d'accent du thème Home Assistant") + '">' + (ht ? sw(ht[0], ht[1]) : "") + tx("Thème HA") + "</button>" +
      PALETTES.map((p, i) => '<button class="chip pal' + (pon(p) ? " on" : "") + '" data-a="setpal" data-o="' + i + '">' +
      sw(p[1], p[2]) + tx(p[0]) + "</button>").join("") + "</span></div>" + ["hue", "hue2", "vivid"].map(sl).join("");
    FONTS.forEach(fontLoad);
    h += '<p class="sph">' + tx("Écran") + '</p><div class="setr' + mod("font") + '"><span class="nm">' + tx("Police") + '<small>' + tx(FONTS.find((f) => f[0] === c.font)[1]) +
      '</small></span><span class="setc">' + FONTS.map((f) => '<button class="chip' + (c.font === f[0] ? " on" : "") + '" data-a="setfont" data-o="' + f[0] +
      '" style="font-family:' + esc(fontStack(f)) + '">' + tx(f[1]) + "</button>").join("") + "</span>" + rst("font") + "</div>" + ["glow", "glass", "blur", "aurora", "text", "tiles_hide"].map(sl).join("");
    h += '<p class="sph">' + tx("Son") + '</p>' + sl("crossfade");
    const lib = S.libs.mp3;
    h += '<p class="sph">' + tx("Bibliothèque") + '</p>' + btn("setlib", svg(TILES.find((t) => t.id === "mp3").ic), tx("Relire le dossier MP3"),
      S.loading === "mp3" ? tx("Lecture en cours…") : lib ? lib.tracks.length.toLocaleString(LOC()) + tx(" titres") + (lib.indexed ? tx(" · index du ") + lib.indexed : "") : tx("régénère l'index côté HA puis le relit"), !!S.loading);
    h += '<p class="sph">' + tx("Cet appareil") + '</p>' + btn("setall", svg("back"), tx("Revenir aux réglages de la carte"),
      n ? n + (n > 1 ? tx(" réglages faits ici, prioritaires") : tx(" réglage fait ici, prioritaire")) + tx(" sur ceux de l'éditeur") : tx("aucun réglage propre à cet appareil"), !n);
    h += '<p class="setv">' + TAG + " " + VERSION + "</p>";
    const g = this.$(".spg"), y = g.scrollTop, f = this._root.activeElement?.dataset?.k;
    g.innerHTML = h;
    g.scrollTop = y;
    if (f) g.querySelector('input[data-k="' + f + '"]')?.focus();
  }

  // Teintes de --primary-color et --accent-color du theme actif ; null si le theme n'en donne pas de coloree.
  // Une sonde resout la couleur (hex, rgb, var() en chaine) comme le navigateur la rend.
  _haHues() {
    const p = this._haP();
    const hueOf = (v) => {
      p.style.color = "var(" + v + ", transparent)";
      const m = getComputedStyle(p).color.match(/[\d.]+/g);
      if (!m || (m.length > 3 && +m[3] === 0)) return null;
      const [r, g, b] = m.slice(0, 3).map((x) => x / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
      if (d < 0.08) return null;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return Math.round((h * 60 + 360) % 360);
    };
    const a = hueOf("--primary-color");
    if (a === null) return null;
    const b = hueOf("--accent-color");
    return [a, b === null || b === a ? (a + 55) % 360 : b];
  }

  _haP() {
    if (!this._haProbe) { this._haProbe = document.createElement("i"); this._haProbe.style.display = "none"; this._root.appendChild(this._haProbe); }
    return this._haProbe;
  }

  // --primary-text-color du theme en "r g b" ; null si elle serait illisible sur la facade sombre (theme clair).
  _haInk() {
    const p = this._haP();
    p.style.color = "var(--primary-text-color, transparent)";
    const m = getComputedStyle(p).color.match(/[\d.]+/g);
    if (!m || (m.length > 3 && +m[3] === 0)) return null;
    const [r, g, b] = m.slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.6 ? null : r + " " + g + " " + b;
  }

  _setAct(a, o) {
    if (a === "setth" && THEMES.includes(o)) this._setPut("theme", o);
    else if (a === "setfont" && FONT_IDS.includes(o)) this._setPut("font", o);
    else if (a === "setpal" && PALETTES[+o]) this._setPut({ hue: PALETTES[+o][1], hue2: PALETTES[+o][2], palette_ha: 0 });
    else if (a === "setpalha") this._setPut({ palette_ha: 1 });
    else if (a === "setrst" && SET_KEYS.includes(o)) this._setPut(o, undefined);
    else if (a === "setall") { this._setPut(null); this._toast(tx("Réglages de la carte rétablis")); }
    else if (a === "setlib") this._refreshLib().then(() => this._setRender());
    this._setRender();
  }

  /* ── Spotify via le media_player ── */
  _spState() {
    return this._cfg?.entity ? this._hass?.states?.[this._cfg.entity] : null;
  }

  _call(service, data = {}) {
    if (!this._hass || !this._cfg.entity) return Promise.resolve();
    return this._hass.callService("media_player", service, { entity_id: this._cfg.entity, ...data })
      .catch((e) => this._toast("Spotify : " + (e.message || e)));
  }

  async _spPlayPause() {
    const st = this._spState();
    if (!st) { this._toast(tx("Lecteur Spotify introuvable")); return; }
    if (st.state === "playing") { this._call("media_pause"); return; }
    if (await this._spWake(SP_PLAY)) this._call("media_play");
  }

  // Réveil au geste seulement : transfert vers l'appareil réglé, sinon le premier connu de Spotify Connect.
  // Le transfert ne lance pas la lecture ; il rend à l'entité ses fonctions (parcours, play_media…).
  async _spWake(bit) {
    const has = () => (num(this._spState()?.attributes?.supported_features, 0) & bit) === bit;
    if (has()) return true;
    const st = this._spState();
    if (!st) { this._toast(tx("Lecteur Spotify introuvable")); return false; }
    const dev = this._cfg.source || st.attributes?.source_list?.[0];
    if (!dev) { this._toast(tx("Aucun appareil Spotify Connect")); return false; }
    this._toast(tx("Réveil de Spotify sur ") + dev + "…");
    await this._call("select_source", { source: dev });
    for (let i = 0; i < 40 && !has(); i++) await sleep(250);
    if (!has()) this._toast(tx("Spotify ne répond pas sur ") + dev);
    return has();
  }

  /* ── page Spotify : arbre browse_media de l'intégration, niveaux déjà vus gardés en pile ── */
  _spOpen() {
    this.$(".sphead .kicker").textContent = "Spotify";
    this.$('[data-a="spup"]').textContent = tx("‹ Précédent");
    this.$(".spsort").innerHTML = this.$(".plnav").innerHTML = "";
    this.$(".plq").hidden = true;
    this.$(".spg").classList.remove("virt");
    this._spNav ||= [];
    this._spRender();
    if (!this._spNode) this._spBrowse(null);
  }

  async _spBrowse(item) {
    const tok = (this._spTok = (this._spTok || 0) + 1), g = this.$(".spg");
    g.innerHTML = '<p class="spmsg">' + tx("Chargement…") + '</p>';
    let r = null;
    try {
      if (await this._spWake(SP_BROWSE))
        r = await this._hass.callWS({ type: "media_player/browse_media", entity_id: this._cfg.entity,
          ...(item ? { media_content_type: item.media_content_type, media_content_id: item.media_content_id } : {}) });
    } catch (e) {
      this._toast("Spotify : " + (e.message || e));
    }
    if (tok !== this._spTok || this.S.page !== "spotify") return;
    if (r) {
      if (item) this._spNav.push(this._spNode);
      this._spNode = r;
    }
    this._spRender();
  }

  _spUp() {
    if (!this._spNav?.length) return;
    this._spTok = (this._spTok || 0) + 1; // un chargement en cours ne doit plus remplacer ce niveau
    this._spNode = this._spNav.pop();
    this._spRender();
  }

  _spPick(i) {
    const c = this._spNode?.children?.[i];
    if (!c) return;
    if (c.can_expand) this._spBrowse(c);
    else if (c.can_play) this._spPlay(c);
  }

  async _spPlay(c) {
    if (!c?.can_play || !(await this._spWake(SP_PLAY_MEDIA))) return;
    await this._call("play_media", { media_content_id: c.media_content_id, media_content_type: c.media_content_type });
    this._toast(tx("Lecture : ") + c.title);
    this._page("home");
  }

  // Capteur dont l'état est un lien spotify: (album_entity).
  _spDisc() {
    const s = this._hass?.states ?? {};
    const id = this._cfg.album_entity || "";
    const st = id ? s[id] : null;
    return st && /^spotify:(album|playlist|artist|track):/.test(st.state) ? st : null;
  }

  _spPlayDisc() {
    const st = this._spDisc();
    if (st) this._spPlay({ can_play: true, media_content_id: st.state, media_content_type: st.state.split(":")[1], title: st.attributes.album || st.state });
  }

  _spRender() {
    const n = this._spNode, root = !this._spNav?.length, g = this.$(".spg");
    const rows = !root && n?.children_media_class === "track";
    this.$(".spt").textContent = root ? tx("Bibliothèque") : n.title;
    this.$('[data-a="spup"]').hidden = root;
    this.$('[data-a="spall"]').hidden = root || !n?.can_play;
    const img = (u) => '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(this._abs(u)) + '">';
    let h = "";
    if (n && root) {
      const d = this._spDisc(), a = d?.attributes ?? {};
      if (d) h += '<button class="spi disc" data-a="disc"><span class="art">' + (a.cover ? img(a.cover) : svg("spotify")) + '</span><span class="nm"><small class="k">' + tx("Disque du jour") + '</small>' +
        esc(a.album || a.record || d.state) + "<small>" + esc(a.artist || "") + "</small></span></button>";
    }
    h += (n?.children ?? []).slice(0, SP_MAX).map((c, i) => {
      const art = c.thumbnail ? img(c.thumbnail) : rows ? "" : svg(root ? "lists" : "spotify");
      return '<button class="spi" data-sp="' + i + '">' + (rows ? '<span class="no">' + (i + 1) + "</span>" : "") +
        (art ? '<span class="art">' + art + "</span>" : "") + '<span class="nm">' + esc(root ? (isFr() && SP_LABEL[c.media_content_type]) || c.title : c.title) + "</span></button>";
    }).join("");
    g.classList.toggle("rows", rows);
    g.innerHTML = h || '<p class="spmsg">' + (n ? tx("Rien ici") : tx("Spotify indisponible")) + "</p>";
    g.scrollTop = 0;
  }

  /* ── page Radio : favoris (pyscript.neon_media_playlists, sinon ce navigateur), recherche et parcours par api.radio-browser.info ── */
  // Parcours par l'API publique, triée par écoutes et sans flux morts : les dossiers de l'intégration HA sont triés
  // par nom (2 800 stations FR, 594 langues dont du bruit) ; l'intégration ne sert qu'à l'id envoyé à Sonos.
  _rdHA() { return !!this._hass?.config?.components?.includes("radio_browser"); }
  _rdOwn() { return (this.S.queueOf || "").split(":")[0] === "radio"; }
  _rdLive() { const S = this.S; return !!S.queue[S.idx]?.live; }

  _rdKeep(tr) {
    this._rdL = { id: tr.id, url: tr.url || "", title: tr.title, sub: tr.sub || "", thumb: tr.thumb || "", hls: !!tr.hls, live: true };
    try { localStorage.setItem(TAG + ".radio", JSON.stringify(this._rdL)); } catch (e) { /* stockage bloqué */ }
  }
  _rdLast() {
    if (this._rdL === undefined) {
      this._rdL = null;
      try { const v = JSON.parse(localStorage.getItem(TAG + ".radio") || "null"); if (v && (v.url || v.id) && v.title) this._rdL = { ...v, hls: v.hls ?? rdHls(v.url), live: true }; } catch (e) { /* stockage bloqué */ }
    }
    return this._rdL || this._rdFavs()[0] || null;
  }
  _rdLocal() {
    try { const v = JSON.parse(localStorage.getItem(TAG + ".radios") || "null"); return Array.isArray(v) ? v.filter((x) => x?.title && (x.url || x.id)).map((x) => ({ ...x, hls: x.hls ?? rdHls(x.url), live: true })) : null; }
    catch (e) { return null; }
  }
  _rdFavs() {
    if (this._rdF) return this._rdF.items;
    if (this._rdLoc === undefined) this._rdLoc = this._rdLocal(); // null = rien dans ce navigateur
    return this._rdLoc ?? DEFAULT_RADIOS;
  }

  // Favoris lus côté HA (null = jamais enregistrés : ceux de ce navigateur, sinon ceux d'origine).
  _rdFSet(v) {
    this._rdF = v && Array.isArray(v.items) ? { rev: v.rev ?? null, items: v.items.map(rdRow).filter(Boolean) }
      : { rev: null, items: this._rdLocal() ?? DEFAULT_RADIOS.map((x) => ({ ...x })) };
    if (this.S.page === "radio") this._rdRender(true);
    this._showSource();
  }
  async _rdFavLoad() {
    if (!this._plSvc()) return;
    const tok = (this._rdFTok = (this._rdFTok || 0) + 1);
    // Écriture en cours d'abord : le serveur ne garantit pas l'ordre, la lecture rendrait la version d'avant le geste.
    await this._rdSave;
    if (tok !== this._rdFTok) return;
    let r;
    try { r = await this._plCall({ op: "radios_get" }); } catch (e) { console.warn(TAG + ": favoris radio", e); return; }
    if (tok !== this._rdFTok || !("radios" in r)) return;
    this._rdFSet(r.radios);
  }
  // Écritures enchaînées : chacune part avec la rev rendue par la précédente ; un conflit recharge la version en place.
  _rdFavSave() {
    this._rdFTok = (this._rdFTok || 0) + 1; // un chargement en vol n'écrase plus ce geste
    if (!this._plSvc()) {
      try { localStorage.setItem(TAG + ".radios", JSON.stringify(this._rdFavs().map(({ id, url, title, sub, thumb, hls }) => ({ id, url, title, sub, thumb, hls: !!hls })))); }
      catch (e) { this._toast(tx("Favoris non enregistrés : ") + (e.message || e)); }
      return;
    }
    this._rdSave = (this._rdSave || Promise.resolve()).then(async () => {
      const F = this._rdF;
      if (!F) return;
      try {
        const r = await this._plCall({ op: "radios_put", radios: { rev: F.rev, items: F.items.map((x) => [x.id, x.url || "", x.title, x.sub || "", x.thumb || ""]) } });
        if (r.ok) { if (this._rdF === F) F.rev = r.radios?.rev ?? F.rev; return; }
        if ("radios" in r) { this._rdFSet(r.radios); this._toast(tx("Favoris modifiés ailleurs : rechargés, refaites le geste")); }
        else this._toast(tx("Favoris non enregistrés : ") + (r.error || "?"));
      } catch (e) { this._toast(tx("Favoris non enregistrés : ") + (e.message || e)); }
    });
  }

  async _rdGet(path, p) {
    const r = await fetch(RB_API + path + "?" + new URLSearchParams(p),
      { referrerPolicy: "no-referrer", ...(AbortSignal.timeout ? { signal: AbortSignal.timeout(10000) } : {}) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error(tx("format inattendu"));
    return j;
  }
  _rdFromApi(s) {
    const url = String(s?.url_resolved || s?.url || "").trim();
    if (!/^https?:\/\//i.test(url) || !s.stationuuid) return null;
    const fav = String(s.favicon || "").trim(), codec = s.codec && s.codec !== "UNKNOWN" ? s.codec : "";
    return { id: this._rdHA() ? RB + "/" + s.stationuuid : url, uuid: s.stationuuid, url, title: String(s.name || "").trim() || url,
      sub: [s.countrycode, codec, s.bitrate ? s.bitrate + " kb/s" : ""].filter(Boolean).join(" · "),
      thumb: /^https?:\/\//i.test(fav) ? fav : "", hls: s.hls === 1 || rdHls(url), live: true };
  }
  // Noms de langue et de pays traduits par le navigateur ; l'API ne donne qu'un nom anglais.
  _rdName(type, code, dflt) {
    try {
      const D = ((this._rdDN ||= {})[type + LOC()] ||= new Intl.DisplayNames([LOC()], { type }));
      const n = code && D.of(code);
      if (n && n.toLowerCase() !== String(code).toLowerCase()) return cap(n);
    } catch (e) { /* code inconnu ou Intl.DisplayNames absent */ }
    return cap(String(dflt || code || ""));
  }
  _rdRoot() {
    const cc = String(this._hass?.config?.country || "").toUpperCase();
    return [
      ...(/^[A-Z]{2}$/.test(cc) ? [{ folder: true, k: "cc:" + cc, title: tx("Près de chez vous"), sub: this._rdName("region", cc), thumb: RD_FLAG(cc) }] : []),
      { folder: true, k: "top", title: tx("Populaires") },
      { folder: true, k: "tags", title: tx("Genres") },
      { folder: true, k: "langs", title: tx("Langues") },
      { folder: true, k: "ctry", title: tx("Pays") },
    ];
  }
  // Listes de l'API gardées pour la séance : remonter ou revenir dans un dossier ne refait aucun appel.
  async _rdLoad(k) {
    const C = (this._rdC ||= new Map());
    if (C.has(k)) return C.get(k);
    const st = async (p) => (await this._rdGet("stations/search", { ...p, hidebroken: "true", order: "clickcount", reverse: "true", limit: SP_MAX }))
      .map((s) => this._rdFromApi(s)).filter(Boolean);
    const n = (c) => Number(c?.stationcount) || 0, cnt = (c) => n(c).toLocaleString(LOC()) + " stations";
    const byT = (a, b) => COLL.compare(a.title, b.title);
    let items;
    if (k === "top") items = await st({});
    else if (k.startsWith("cc:")) items = await st({ countrycode: k.slice(3) });
    else if (k.startsWith("tag:")) items = await st({ tag: k.slice(4), tagExact: "true" });
    else if (k.startsWith("lang:")) items = await st({ language: k.slice(5), languageExact: "true" });
    else if (k === "ctry") items = (await this._rdGet("countries", { hidebroken: "true" }))
      .filter((c) => /^[a-z]{2}$/i.test(c?.iso_3166_1 || "") && n(c) > 0)
      .map((c) => { const cc = c.iso_3166_1.toUpperCase(); return { folder: true, k: "cc:" + cc, title: this._rdName("region", cc, c.name), sub: cnt(c), thumb: RD_FLAG(cc) }; }).sort(byT);
    else {
      const lang = k === "langs";
      items = (await this._rdGet(lang ? "languages" : "tags", { order: "stationcount", reverse: "true", hidebroken: "true", limit: 100 }))
        .filter((c) => c?.name && n(c) > 0)
        .map((c) => ({ folder: true, k: (lang ? "lang:" : "tag:") + c.name, title: lang ? this._rdName("language", c.iso_639, c.name) : cap(c.name), sub: cnt(c) })).sort(byT);
    }
    C.set(k, items);
    return items;
  }

  _rdOpen() {
    this.$(".sphead .kicker").textContent = tx("Radio");
    this.$('[data-a="spup"]').textContent = tx("‹ Précédent");
    this.$('[data-a="spall"]').hidden = true;
    this.$(".plnav").innerHTML = "";
    const q = this.$(".plq");
    q.hidden = false;
    q.value = this._rdQ || "";
    this.$(".spg").classList.remove("virt");
    this._rdMode ||= "fav";
    this._rdNav ||= [];
    this._rdRender();
    this._rdFavLoad();
    if (this._rdQ && this._rdHits?.q !== this._rdQ) this._rdSearch(this._rdQ);
  }
  // top : true = défilement gardé, nombre = position à rétablir, sinon en haut.
  _rdRender(top) {
    const S = this.S, g = this.$(".spg"), q = this._rdQ || "", H = this._rdHits, browse = !q && this._rdMode === "browse";
    const node = browse ? this._rdNode : null;
    const mode = (m, t) => '<button class="chip' + (this._rdMode === m ? " on" : "") + '" data-a="rdmode-' + m + '">' + t + "</button>";
    this.$(".spsort").innerHTML = q ? "" : mode("fav", tx("Favoris")) + mode("browse", tx("Parcourir"));
    this.$(".spt").textContent = q ? tx("« ") + q + tx(" »") : browse ? node?.title || tx("Parcourir") : tx("Favoris");
    this.$('[data-a="spup"]').hidden = !browse || !this._rdNav?.length;
    // Pendant la frappe, les résultats précédents restent affichés jusqu'aux nouveaux.
    const items = q ? (H && (H.q === q || H.items.length) ? H.items : null) : browse ? (this._rdBusy ? null : node ? node.items : this._rdRoot()) : this._rdFavs();
    const F = this._rdFavs(), ids = new Set(F.map((f) => f.id)), urls = new Set(F.map((f) => f.url).filter(Boolean));
    const fav = (s) => ids.has(s.id) || (!!s.uuid && ids.has(RB + "/" + s.uuid)) || (!!s.url && urls.has(s.url));
    const cur = S.src === "radio" && this._rdOwn() ? S.queue[S.idx] : null;
    const L = (this._rdItems = (items || []).slice(0, SP_MAX));
    const img = (u) => '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(u) + '">';
    let h = L.map((s, i) => {
      const on = !s.folder && fav(s), t = esc(tx(on ? "Retirer des favoris" : "Ajouter aux favoris"));
      return '<div class="spi' + (s.folder ? "" : (rdSame(cur, s) ? " cur" : "") + (this._rdPlayable(s) ? "" : " off")) + '" data-rd="' + i + '">' +
        '<span class="art">' + (s.thumb ? img(s.thumb) : svg(s.folder ? "lists" : "radio")) + '</span><span class="nm">' + esc(s.title) +
        (s.sub ? "<small>" + esc(s.sub) + "</small>" : "") + "</span>" +
        (s.folder ? "" : '<button class="rb' + (on ? " on" : "") + '" data-a="rdfav" data-i="' + i + '" title="' + t + '" aria-label="' + t + '">' + svg("star") + "</button>") + "</div>";
    }).join("");
    if (!items) h = '<p class="spmsg">' + tx("Chargement…") + "</p>";
    else if (!L.length) h = '<p class="spmsg">' + (q ? tx("Aucune station pour « ") + esc(q) + tx(" »") : browse ? tx("Rien ici") : tx("Aucun favori : touchez l'étoile d'une station.")) + "</p>";
    const prev = g.scrollTop;
    g.classList.add("rows");
    g.innerHTML = h;
    g.scrollTop = top === true ? prev : top || 0;
  }
  _rdSearch(v) {
    v = String(v || "").trim();
    this._rdQ = v;
    clearTimeout(this._rdST);
    const tok = (this._rdSTok = (this._rdSTok || 0) + 1);
    if (!v) { this._rdHits = null; this._rdRender(); return; }
    this._rdRender(true);
    this._rdST = setTimeout(async () => {
      let items = [];
      try {
        items = (await this._rdGet("stations/search", { name: v, hidebroken: "true", order: "clickcount", reverse: "true", limit: 100 }))
          .map((s) => this._rdFromApi(s)).filter(Boolean);
      } catch (e) { if (tok === this._rdSTok) this._toast(tx("Recherche impossible : radio-browser.info ne répond pas")); }
      if (tok !== this._rdSTok) return;
      this._rdHits = { q: v, items };
      if (this.S.page === "radio") this._rdRender();
    }, 400);
  }
  // HLS : seuls certains navigateurs le lisent sans bibliothèque ; un lecteur de la maison (Sonos) le lit lui-même.
  _rdPlayable(s) { return !s.hls || !!this._rmE() || (this._hlsOk ??= !!new Audio().canPlayType("application/vnd.apple.mpegurl")); }
  async _rdBrowse(it) {
    const tok = (this._rdBTok = (this._rdBTok || 0) + 1), top = this.$(".spg").scrollTop;
    this._rdBusy = true;
    this._rdRender();
    let items = null;
    try { items = await this._rdLoad(it.k); }
    catch (e) { if (tok === this._rdBTok) this._toast(tx("Parcours impossible : radio-browser.info ne répond pas")); }
    if (tok !== this._rdBTok) return;
    this._rdBusy = false;
    if (items) { this._rdNav.push({ n: this._rdNode, top }); this._rdNode = { title: it.title, items }; }
    if (this.S.page === "radio") this._rdRender(items ? 0 : top);
  }
  _rdUp() {
    if (!this._rdNav?.length) return;
    this._rdBTok = (this._rdBTok || 0) + 1; // un chargement en cours ne doit plus remplacer ce niveau
    this._rdBusy = false;
    const { n, top } = this._rdNav.pop();
    this._rdNode = n;
    this._rdRender(top);
  }
  _rdPick(i) {
    const S = this.S, it = this._rdItems?.[i];
    if (!it) return;
    if (it.folder) { this._rdBrowse(it); return; }
    if (!this._rdPlayable(it)) { this._toast(tx("Flux HLS : non lu par ce navigateur")); return; }
    if (S.src === "radio" && this._rdOwn() && rdSame(S.queue[S.idx], it) && this._playing()) { this._page("home"); return; }
    if (!S.on) this._power();
    if (S.src !== "radio") {
      // Pas de pause du lecteur distant : play_media suit aussitôt et la pause pourrait arriver après.
      if (S.src !== "spotify") { if (this._rdLive()) this._rdStop(); else this._audio?.pause(); }
      S.src = "radio";
      this._playSave();
    }
    // La liste affichée devient la file : précédent/suivant passent à la station voisine.
    const L = this._rdItems.filter((x) => !x.folder && this._rdPlayable(x));
    S.queue = L.map((x) => ({ ...x }));
    S.queueOf = "radio";
    S.idx = L.indexOf(it);
    this._showSource();
    this._page("home");
    this._playIdx(S.idx);
  }
  _rdFavIdx(st) {
    const u = st.uuid ? RB + "/" + st.uuid : "";
    return this._rdFavs().findIndex((f) => f.id === st.id || (!!u && f.id === u) || (!!st.url && f.url === st.url));
  }
  _rdAct(a, act) {
    if (a.startsWith("rdmode-")) {
      this._rdMode = a.slice(7);
      clearTimeout(this._rdST);
      this._rdSTok = (this._rdSTok || 0) + 1;
      this._rdBTok = (this._rdBTok || 0) + 1;
      this._rdBusy = false;
      this._rdQ = ""; this._rdHits = null; this.$(".plq").value = "";
      this._rdRender();
      return;
    }
    if (a !== "rdfav") return;
    const st = this._rdItems?.[+act.dataset.i];
    if (!st || st.folder) return;
    const L = this._rdFavs().slice(), k = this._rdFavIdx(st);
    if (k >= 0) L.splice(k, 1);
    else if (L.length >= RD_MAX) { this._toast(RD_MAX + tx(" favoris au plus")); return; }
    else L.push({ id: st.id, url: st.url || "", title: st.title, sub: st.sub || "", thumb: st.thumb || "", hls: !!st.hls, live: true });
    // _rdF reste la liste affichée même si le service a disparu depuis son chargement (_rdFavs le lit en premier).
    if (this._plSvc() || this._rdF) (this._rdF ||= { rev: null, items: [] }).items = L;
    else this._rdLoc = L;
    this._rdFavSave();
    this._rdRender(true);
    this._showSource();
  }
  _rdStop() {
    clearTimeout(this._rdRT); clearTimeout(this._rdWD);
    const a = this._audio; if (!a) return;
    this._xfStop(a); a.pause();
    // Un direct en pause garderait la connexion ouverte et reprendrait en retard : on la ferme, la lecture rouvre le flux.
    a.removeAttribute("src"); a.load(); this._showSource();
  }
  _rdRetry() {
    const S = this.S, tr = S.queue[S.idx];
    clearTimeout(this._rdRT); clearTimeout(this._rdWD);
    // Un flux qui a tenu 30 s repart avec un compteur neuf : seules les coupures rapprochées épuisent les essais.
    if (this._rdAt && Date.now() - this._rdAt > 30000) this._rdTry = 0;
    this._rdAt = 0;
    if ((this._rdTry || 0) >= RD_TRIES) { this._rdTry = 0; this._rdStop(); this._toast(tx(this._rdEver ? "Flux interrompu : " : "Station injoignable : ") + (tr?.title || "")); return; }
    const n = (this._rdTry = (this._rdTry || 0) + 1);
    // Pas de test _playing() : après une erreur réseau l'élément n'est pas mis en pause.
    this._rdRT = setTimeout(() => { if (S.on && S.queue[S.idx] === tr && S.src !== "spotify" && !this._rmE()) this._playIdx(S.idx); }, 1000 * n * n);
  }
  // Source Radio sans file : la dernière station repart, les favoris derrière elle pour précédent/suivant.
  // Rien n'est attendu avant la lecture : Safari refuse play() hors du geste.
  _rdResume() {
    const S = this.S, last = this._rdLast();
    if (!last) { this._page("radio"); return; }
    const q = this._rdFavs().filter((x) => this._rdPlayable(x)).map((x) => ({ ...x }));
    let i = q.findIndex((x) => rdSame(x, last));
    if (i < 0) { q.unshift({ ...last }); i = 0; }
    S.queue = q; S.queueOf = "radio"; S.idx = i;
    this._showSource();
    this._playIdx(i);
  }
  _rdRemoteId(tr) { return tr.id?.startsWith(RB + "/") && this._rdHA() ? tr.id : tr.url || tr.id; }

  /* ── page Playlists : listes enregistrées côté HA (pyscript.neon_media_playlists) et file en cours ── */
  // Une liste = {id, name, rev, tracks:[[media_id, titre, artiste, album]]}. rev : le service refuse
  // une écriture faite sur une version périmée et renvoie celle en place.
  _plSvc() {
    return !!this._hass?.services?.pyscript?.neon_media_playlists;
  }

  async _plCall(data) {
    const r = await this._hass.callWS({ type: "call_service", domain: "pyscript", service: "neon_media_playlists", service_data: data, return_response: true });
    return r?.response ?? {};
  }

  async _plOpen() {
    this.$(".sphead .kicker").textContent = "Playlists";
    this._plName = null;
    this._pl ||= { lists: null, err: "" };
    this._plRender();
    this._plImgs();
    if (!this._plSvc()) {
      this._pl = { lists: null, err: tx("Service pyscript.neon_media_playlists absent : seule la file en cours est disponible") };
      this._plRender();
      return;
    }
    if (this._plTimers?.size || this._plBusy) return; // écritures en attente : la copie locale fait foi
    const tok = (this._plTok = (this._plTok || 0) + 1);
    try {
      const r = await this._plCall({ op: "get" });
      if (tok !== this._plTok) return;
      this._pl = { lists: Array.isArray(r.lists) ? r.lists : [], err: "" };
    } catch (e) {
      if (tok !== this._plTok) return;
      this._pl = { lists: this._pl.lists, err: tx("Listes illisibles : ") + (e.message || e) };
    }
    this._plTile();
    if (this.S.page === "lists" && !this._plName) this._plRender(true);
  }

  // Dossier -> image de dossier : un titre de liste garde la pochette de repli de son album.
  async _plImgs() {
    if (this._plImg) return this._plImg;
    const j = await this._index(), m = new Map();
    if (!j) return m;
    const root = j.root.replace(/\/+$/, ""), img = j.img && typeof j.img === "object" ? j.img : {};
    j.dirs.forEach((d, i) => { if (img[i]) m.set(root + (d ? "/" + d : ""), img[i]); });
    return (this._plImg = m);
  }

  _plTile() {
    const el = this._root.querySelector('.tile[data-id="lists"] small');
    if (el) el.textContent = this._tileSub("lists");
  }

  _plList(id = this._plView?.id) {
    return this._pl?.lists?.find((l) => l.id === id) || null;
  }

  _plCur() {
    const S = this.S;
    return S.src !== "spotify" ? S.queue[S.idx] || null : null;
  }

  _plBase(id) {
    return id.slice(id.lastIndexOf("/") + 1).replace(AUDIO_RE, "");
  }

  _plDir(id) {
    const p = id.split("/");
    return p.length > 2 ? p[p.length - 2] : "";
  }

  _plFromQ(tr) {
    const m = this._tagC?.get(tr.id);
    return [tr.id, m?.title || tr.title.replace(AUDIO_RE, ""), m?.artist || "", m?.album || ""];
  }

  _plToQ(t, img) {
    // Station rangée dans une liste : elle reste un direct (pas de barre, reconnexion), son URL vient de HA.
    if (t[0].startsWith(RB + "/")) return { id: t[0], url: "", title: t[1] || this._plBase(t[0]), sub: "", thumb: "", live: true };
    const dir = t[0].slice(0, t[0].lastIndexOf("/")), im = img?.get(dir);
    return { id: t[0], title: t[1] || this._plBase(t[0]), thumb: "", cover: im ? dir + "/" + im : "" };
  }

  // [titre, complément] d'une ligne : élément de la file (q) ou titre de liste.
  _plLabel(r, q) {
    if (q) {
      const m = this._tagC?.get(r.id);
      return [m?.title || r.title.replace(AUDIO_RE, ""), m?.artist || this._plDir(r.id)];
    }
    return [r[1] || this._plBase(r[0]), r[2] ? r[2] + (r[3] ? " · " + r[3] : "") : this._plDir(r[0])];
  }

  _plRowsData() {
    return this._plView?.kind === "queue" ? this.S.queue : this._plList()?.tracks ?? [];
  }

  _plRender(keep) {
    const v = this._plView, g = this.$(".spg"), P = this._pl || { lists: null, err: "" }, S = this.S;
    const up = this.$('[data-a="spup"]'), all = this.$('[data-a="spall"]'), sort = this.$(".spsort"), nav = this.$(".plnav");
    const chip = (a, t, x = "") => '<button class="chip' + x + '" data-a="' + a + '">' + t + "</button>";
    const st = keep ? g.scrollTop : 0;
    sort.innerHTML = nav.innerHTML = "";
    g.classList.remove("rows", "virt");
    const plq = this.$(".plq");
    plq.hidden = !v || !!this._plName;
    if (plq.value !== (this._plFq || "")) plq.value = this._plFq || "";
    this._plFc = null;
    up.textContent = tx("‹ Annuler");
    all.textContent = tx("Tout lire");
    if (this._plName) {
      this.$(".spt").textContent = this._plName.title;
      up.hidden = false;
      all.hidden = true;
      g.innerHTML = '<div class="plname"><input type="text" maxlength="80" spellcheck="false" autocomplete="off" value="' + esc(this._plName.value) + '">' +
        chip("plok", tx("Valider"), " on") + "</div>";
      const inp = g.querySelector("input");
      // Le conteneur écoute le clavier pour le réveil de l'écran : la saisie ne doit pas lui parvenir.
      for (const ev of ["keydown", "keyup", "keypress"]) inp.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev !== "keydown") return;
        if (e.key === "Enter") { e.preventDefault(); this._plNameOk(); }
        else if (e.key === "Escape") { e.preventDefault(); this._plUp(); }
      });
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
      return;
    }
    if (!v) {
      const pend = this._plPend;
      this.$(".spt").textContent = pend ? tx("Ajouter « ") + pend.label + tx(" » à…") : "Playlists";
      up.hidden = !pend;
      all.hidden = true;
      const lists = (P.lists ?? []).slice().sort((a, b) => COLL.compare(a.name, b.name));
      const items = (this._plItems = []);
      const tile = (it, icon, name, sub) => {
        items.push(it);
        return '<button class="spi" data-sp="' + (items.length - 1) + '"><span class="art">' + svg(icon) + '</span><span class="nm">' + esc(name) +
          (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span></button>";
      };
      let h = "";
      if (!pend) h += tile({ k: "queue" }, "mp3", tx("File en cours"), S.queue.length ? S.queue.length.toLocaleString(LOC()) + tx(" titres") : tx("vide"));
      for (const l of lists) h += tile({ k: "list", id: l.id }, "lists", l.name, l.tracks.length + tx(" titre") + (l.tracks.length > 1 ? "s" : ""));
      if (P.lists) h += tile({ k: "new" }, "plus", tx("Nouvelle liste"), "");
      if (P.err || !P.lists) h += '<p class="spmsg">' + esc(P.err || tx("Chargement des listes…")) + "</p>";
      g.innerHTML = h;
      g.scrollTop = st;
      if (!pend && P.lists && this._plCur()) nav.innerHTML = chip("plcur", tx("+ Titre en cours"));
      if (pend?.dir) nav.innerHTML = chip("pldir", pend.whole ? tx("Ce titre seulement") : tx("Tout le dossier « ") + esc(pend.dir.name) + tx(" » (") + pend.dir.n + ")", pend.whole ? " on" : "");
      return;
    }
    const q = v.kind === "queue", L = q ? null : this._plList();
    if (!q && !L) { this._plView = null; this._plRender(); return; }
    const n = this._plRowsData().length;
    this.$(".spt").textContent = q ? tx("File en cours") : L.name;
    up.hidden = false;
    up.textContent = tx("‹ Listes");
    all.hidden = q || !n;
    if (n > 1) sort.innerHTML = '<span class="lbl">' + tx("Trier") + '</span>' + chip("plsort-name", tx("Nom")) +
      (q ? "" : chip("plsort-artist", tx("Artiste")) + chip("plsort-album", "Album")) + chip("plsort-dir", tx("Dossier")) +
      chip("plsort-mix", tx("Mélanger")) + chip("plsort-rev", tx("Inverser")) + (q && /:q$/.test(S.queueOf || "") ? chip("plsort-orig", tx("Origine")) : "");
    const fn = this._plFq ? this._plIdx().length : -1;
    nav.innerHTML = q ? (!P.lists || !n ? "" : fn >= 0 ? (fn ? chip("pladdall", tx("Ajouter ces ") + fn.toLocaleString(LOC()) + tx(" titres à une liste")) : "")
      : chip("plsave", tx("Enregistrer comme liste"))) : chip("plren", tx("Renommer")) + chip("pldel", tx("Supprimer"));
    g.classList.add("rows", "virt");
    g.innerHTML = n ? '<div class="vl"></div>' : '<p class="spmsg">' + (q ? tx("File vide : lancez une source") : tx("Liste vide : ajoutez des titres depuis la file (+)")) + "</p>";
    this._plWin = null;
    this._plRows(true);
    g.scrollTop = keep ? st : q && S.idx >= 0 && !this._plFq ? Math.max(0, S.idx * this._rh - g.clientHeight / 2) : 0;
    this._plRows(true);
  }

  // Liste virtualisée : seules les lignes visibles existent dans le DOM (la file peut compter 30 000 titres).
  _plRows(force) {
    const g = this.$(".spg"), vl = g.querySelector(".vl");
    if (!vl || !this._plView) return;
    const rows = this._plRowsData(), F = this._plIdx(), n = F ? F.length : rows.length, q = this._plView.kind === "queue";
    const rh = (this._rh = Math.max(26, Math.round(this._ar.clientWidth * 0.034)));
    g.style.setProperty("--rh", rh + "px");
    vl.style.height = n * rh + "px";
    const a = Math.max(0, Math.floor(g.scrollTop / rh) - 8), b = Math.min(n, Math.ceil((g.scrollTop + g.clientHeight) / rh) + 8);
    const key = a + ":" + b + ":" + n;
    if (!force && key === this._plWin) return;
    this._plWin = key;
    const cur = q && this.S.src !== "spotify" ? this.S.idx : -1, D = this._plDrag, drag = !F && n <= PL_DRAG_MAX;
    let h = "";
    if (F && !n) h = '<p class="spmsg">' + tx("Aucun titre pour « ") + esc(this._plFq) + tx(" »") + "</p>";
    for (let k = a; k < b; k++) {
      const i = F ? F[k] : k, [t, sub] = this._plLabel(rows[i], q);
      h += '<div class="spi' + (i === cur ? " cur" : "") + (D && D.from === i ? " drag" : "") + '" data-sp="' + i + '" style="top:' + k * rh + 'px">' +
        (drag ? '<span class="hdl" data-a="plnop" data-i="' + i + '">' + svg("grip") + "</span>" : "") +
        '<span class="no">' + (i + 1) + '</span><span class="nm">' + esc(t) + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span>" +
        '<button class="rb" data-a="' + (q ? "pladd" : "plrm") + '" data-i="' + i + '" title="' + (q ? tx("Ajouter à une liste") : tx("Retirer de la liste")) + '">' +
        svg(q ? "plus" : "x") + "</button></div>";
    }
    if (D && D.to >= 0) h += '<div class="drop" style="top:' + D.to * rh + 'px"></div>';
    vl.innerHTML = h;
  }

  _plPick(i) {
    const v = this._plView;
    if (v?.kind === "queue") { this._plQPlay(i); return; }
    if (v) { this._plPlayView(i); return; }
    const it = this._plItems?.[i];
    if (!it) return;
    const pend = this._plPend;
    if (it.k === "new") this._plAsk(tx("Nouvelle liste"), "", (nm) => this._plCreate(nm, pend ? pend.tracks : []));
    else if (pend) this._plAddTo(it.id, pend.tracks);
    else { this._plView = it.k === "queue" ? { kind: "queue" } : { kind: "list", id: it.id }; this._plFq = ""; this._plRender(); }
  }

  // Remonte d'un cran : saisie, puis choix de la liste de destination, puis vue ouverte.
  _plUp() {
    if (this._plName) this._plName = null;
    else if (this._plPend) { this._plView = this._plPend.ret; this._plPend = null; }
    else { this._plView = null; this._plFq = ""; }
    this._plRender();
  }

  _plAsk(title, value, done) {
    this._plName = { title, value, done };
    this._plRender();
  }

  _plNameOk() {
    const nm = (this.$(".plname input")?.value || "").trim().slice(0, 80);
    if (!nm) { this._toast(tx("Nom vide")); return; }
    const done = this._plName.done;
    this._plName = null;
    done(nm);
  }

  _plAct(a, el) {
    const i = +el.dataset.i, S = this.S;
    if (a === "plnop") return;
    if (a === "plok") this._plNameOk();
    else if (a === "plcur") { const t = this._plCur(); if (t) this._plPendStart([t]); }
    else if (a === "pladd") { if (S.queue[i]) this._plPendStart([S.queue[i]], true); }
    else if (a === "pladdall") {
      const F = this._plIdx() || [];
      if (F.length > PL_MAX) { this._toast(tx("Trop de titres : ") + PL_MAX + tx(" au plus par liste, affinez la recherche")); return; }
      this._plPendStart(F.map((k) => S.queue[k]));
    } else if (a === "pldir") this._plDirToggle();
    else if (a === "plrm") this._plEdit((L) => L.tracks.splice(i, 1));
    else if (a === "plsave") {
      if (S.queue.length > PL_MAX) { this._toast(tx("File trop longue : ") + PL_MAX + tx(" titres au plus par liste")); return; }
      const trs = S.queue.map((t) => this._plFromQ(t));
      this._plAsk(tx("Enregistrer la file"), "", (nm) => this._plCreate(nm, trs));
    } else if (a === "plren") { const L = this._plList(); if (L) this._plAsk(tx("Renommer la liste"), L.name, (nm) => this._plEdit((x) => { x.name = nm; })); }
    else if (a === "pldel") this._plDelete(el);
    else if (a.startsWith("plsort-")) this._plSort(a.slice(7));
  }

  // one : un seul titre de la file, qu'on peut étendre à tout son dossier.
  _plDirToggle() {
    const p = this._plPend;
    if (!p?.dir) return;
    p.whole = !p.whole;
    const trs = p.whole ? p.dir.all : p.dir.one;
    if (trs.length > PL_MAX) { p.whole = false; this._toast(tx("Dossier trop grand : ") + PL_MAX + tx(" titres au plus")); return; }
    p.tracks = trs.map((x) => this._plFromQ(x));
    p.label = p.whole ? tx("dossier ") + p.dir.name : this._plLabel(trs[0], true)[0];
    this._plRender();
  }

  // Recherche dans la vue : tous les mots doivent figurer dans le chemin, le titre ou les tags connus.
  _plFilter(v) {
    this._plFq = v.trim();
    this._plFc = null;
    if (this.S.page !== "lists" || !this._plView) return;
    clearTimeout(this._plFt);
    // Sur 30 000 titres, un filtre par frappe reste sous 50 ms ; on regroupe quand même les frappes rapides.
    this._plFt = setTimeout(() => this._plRender(), this._plRowsData().length > 5000 ? 120 : 0);
  }

  // Positions des lignes qui passent le filtre (null = pas de filtre), recalculées quand la vue change.
  _plIdx() {
    const fq = this._plFq;
    if (!fq || !this._plView) return null;
    const rows = this._plRowsData(), c = this._plFc;
    if (c && c.rows === rows && c.fq === fq && c.n === rows.length) return c.F;
    const words = fold(fq).split(/\s+/).filter(Boolean), q = this._plView.kind === "queue", K = (this._plK ||= new Map()), F = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], id = q ? r.id : r[0];
      let key = K.get(id);
      if (key === undefined) {
        let p = id.replace(/^media-source:\/\/[^/]+\/[^/]+\//, "");
        try { p = decodeURIComponent(p); } catch {}
        key = fold(p.replace(/[_./-]+/g, " "));
        if (K.size > 60000) K.clear();
        K.set(id, key);
      }
      const m = q ? this._tagC?.get(id) : null, extra = q ? (m ? fold((m.title || "") + " " + (m.artist || "") + " " + (m.album || "")) : "")
        : fold((r[1] || "") + " " + (r[2] || "") + " " + (r[3] || ""));
      if (words.every((w) => key.includes(w) || extra.includes(w))) F.push(i);
    }
    this._plFc = { rows, fq, n: rows.length, F };
    return F;
  }

  _plPendStart(trs, one) {
    if (!this._pl?.lists) { this._toast(this._pl?.err || tx("Listes indisponibles")); return; }
    const label = trs.length > 1 ? trs.length.toLocaleString(LOC()) + tx(" titres") : this._plLabel(trs[0], true)[0];
    let dir = null;
    if (one) {
      const d = trs[0].id.slice(0, trs[0].id.lastIndexOf("/") + 1), all = this.S.queue.filter((t) => t.id.startsWith(d) && !t.id.includes("/", d.length));
      if (all.length > 1) dir = { name: this._plDir(trs[0].id) || tx("racine"), n: all.length, all, one: trs };
    }
    this._plPend = { tracks: trs.map((x) => this._plFromQ(x)), label, dir, whole: false, ret: this._plView };
    this._plView = null;
    this._plRender();
  }

  _plCreate(name, tracks) {
    const P = this._pl, pend = this._plPend;
    if (!P?.lists) { this._plRender(); return; }
    if (P.lists.length >= PL_LISTS) { this._toast(PL_LISTS + tx(" listes au plus")); this._plRender(); return; }
    const L = { id: "pl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, rev: 0, tracks: tracks.slice(0, PL_MAX) };
    P.lists.push(L);
    if (pend) { this._plView = pend.ret; this._plPend = null; this._toast(tx("Ajouté à « ") + name + tx(" »")); }
    else this._plView = { kind: "list", id: L.id };
    this._plPut(L.id, 0);
    this._plTile();
    this._plRender();
  }

  _plAddTo(id, tracks) {
    const L = this._plList(id);
    this._plView = this._plPend?.ret ?? null;
    this._plPend = null;
    if (L && L.tracks.length + tracks.length > PL_MAX) this._toast(tx("Liste pleine : ") + PL_MAX + tx(" titres au plus"));
    else if (L) {
      L.tracks.push(...tracks);
      this._plPut(L.id);
      this._toast(tx("Ajouté à « ") + L.name + tx(" »"));
    }
    this._plRender(true);
  }

  _plEdit(fn) {
    const L = this._plList();
    if (!L) return;
    fn(L);
    this._plPut(L.id);
    this._plRender(true);
  }

  // Écritures groupées (glisser, tris successifs) puis envoyées l'une après l'autre : chaque envoi
  // reprend la rev rendue par le précédent.
  _plPut(id, delay = PL_SAVE_MS) {
    this._plTimers ||= new Map();
    clearTimeout(this._plTimers.get(id));
    this._plTimers.set(id, setTimeout(() => {
      this._plTimers.delete(id);
      this._plQueue(() => this._plSend(id));
    }, delay));
  }

  _plQueue(fn) {
    this._plBusy = (this._plBusy || 0) + 1;
    this._plQ = (this._plQ || Promise.resolve()).then(fn).catch((e) => this._toast("Playlists : " + (e.message || e))).finally(() => this._plBusy--);
  }

  async _plSend(id) {
    const L = this._plList(id);
    if (!L) return;
    const r = await this._plCall({ op: "put", list: { id: L.id, name: L.name, rev: L.rev, tracks: L.tracks } });
    if (r.ok && r.list) L.rev = r.list.rev;
    else if (r.list) {
      clearTimeout(this._plTimers.get(id));
      this._plTimers.delete(id);
      const P = this._pl, k = P.lists.indexOf(L);
      if (k >= 0) P.lists[k] = r.list;
      this._toast(tx("« ") + r.list.name + tx(" » modifiée sur un autre appareil : rechargée"));
      if (this.S.page === "lists" && !this._plName) this._plRender(true);
    } else this._toast(tx("Enregistrement refusé : ") + (r.error || tx("erreur")));
  }

  _plDelete(el) {
    const L = this._plList();
    if (!L) return;
    if (!el.classList.contains("warn")) {
      el.classList.add("warn");
      el.textContent = tx("Confirmer la suppression");
      clearTimeout(this._plDelT);
      this._plDelT = setTimeout(() => { el.classList.remove("warn"); el.textContent = tx("Supprimer"); }, 3000);
      return;
    }
    clearTimeout(this._plDelT);
    clearTimeout(this._plTimers?.get(L.id));
    this._plTimers?.delete(L.id);
    this._pl.lists = this._pl.lists.filter((x) => x !== L);
    this._plView = null;
    this._plQueue(async () => {
      const r = await this._plCall({ op: "delete", id: L.id });
      if (!r.ok) this._toast(tx("Suppression refusée : ") + (r.error || tx("erreur")));
    });
    this._toast(tx("Liste « ") + L.name + tx(" » supprimée"));
    this._plTile();
    this._plRender();
  }

  _plSort(k) {
    const q = this._plView?.kind === "queue", S = this.S;
    if (q && k === "orig") {
      const base = (S.queueOf || S.src).split(":")[0], lib = S.libs[base];
      if (lib) this._plQSet(lib.tracks, true);
      return;
    }
    let arr = (q ? S.queue : this._plList()?.tracks ?? []).slice();
    const id = (r) => (q ? r.id : r[0]), dir = (r) => id(r).slice(0, id(r).lastIndexOf("/"));
    // Clés calculées une fois par titre : 30 000 titres, ~450 000 comparaisons.
    const by = (...fs) => arr.map((r) => [r, fs.map((f) => f(r))])
      .sort((x, y) => { for (let i = 0; i < fs.length; i++) { const c = COLL.compare(x[1][i], y[1][i]); if (c) return c; } return 0; })
      .map((x) => x[0]);
    if (k === "name") arr = by((r) => this._plLabel(r, q)[0], id);
    else if (k === "dir") arr = by(id);
    else if (k === "artist") arr = by((r) => r[2] || dir(r), (r) => r[3] || dir(r), id);
    else if (k === "album") arr = by((r) => r[3] || dir(r), id);
    else if (k === "mix") for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    else if (k === "rev") arr.reverse();
    else return;
    if (q) this._plQSet(arr);
    else this._plEdit((L) => { L.tracks = arr; });
  }

  // Nouvel ordre de la file : le titre en cours garde sa place dans la lecture, et la file
  // ne suit plus la bibliothèque (une relecture de l'index ne la remplace plus).
  _plQSet(arr, orig) {
    const S = this.S, cur = S.queue[S.idx], base = (S.queueOf || S.src).split(":")[0];
    S.queue = arr;
    if (cur) S.idx = Math.max(0, arr.indexOf(cur));
    if (orig) S.queueOf = base;
    else if (S.queueOf === base) S.queueOf = base + ":q";
    if (S.shuffle) { S.shuffle = false; this._playSave(); this._toast(tx("Lecture aléatoire coupée : la file suit l'ordre choisi")); }
    this._showSource();
    this._plRender(true);
  }

  _plMove(from, to) {
    if (this._plView?.kind === "queue") {
      const a = this.S.queue.slice();
      a.splice(to, 0, a.splice(from, 1)[0]);
      this._plQSet(a);
    } else this._plEdit((L) => { L.tracks.splice(to, 0, L.tracks.splice(from, 1)[0]); });
  }

  _plQPlay(i) {
    const S = this.S, src = (S.queueOf || "mp3").split(":")[0];
    if (!S.on) this._power();
    if (S.src !== src) { S.src = src; this._playSave(); this._showSource(); }
    this._playIdx(i);
  }

  // i < 0 : « Tout lire », au hasard si la lecture aléatoire est active.
  async _plPlayView(i) {
    const L = this._plList(), S = this.S;
    if (!L?.tracks.length) return;
    const img = await this._plImgs();
    if (!S.on) this._power();
    if (S.src !== "mp3") { if (S.src !== "spotify") { if (this._rdLive()) this._rdStop(); else this._audio?.pause(); } S.src = "mp3"; this._playSave(); }
    S.queue = L.tracks.map((t) => this._plToQ(t, img));
    S.queueOf = "mp3:pl:" + L.id;
    if (i < 0) i = S.shuffle ? Math.floor(Math.random() * S.queue.length) : 0;
    this._showSource();
    this._toast("Playlist : " + L.name);
    this._page("home");
    this._playIdx(i);
  }

  // Glisser par la poignée ; le pointeur est suivi sur window car les lignes sont recréées au défilement.
  _plDragStart(e) {
    const h = e.target.closest?.(".hdl");
    if (!h || this.S.page !== "lists" || !this._plView || e.button > 0 || this._plFq) return;
    const g = this.$(".spg"), n = this._plRowsData().length;
    if (n > PL_DRAG_MAX) return;
    e.preventDefault();
    const D = (this._plDrag = { from: +h.dataset.i, to: -1, y: e.clientY, id: e.pointerId, raf: 0 });
    const upd = () => {
      const r = g.getBoundingClientRect();
      const to = clamp(Math.round((D.y - r.top + g.scrollTop) / this._rh), 0, n);
      if (to !== D.to) { D.to = to; this._plRows(true); }
    };
    const tick = () => {
      if (this._plDrag !== D) return;
      const r = g.getBoundingClientRect(), edge = this._rh * 1.2;
      const dir = D.y < r.top + edge ? -1 : D.y > r.bottom - edge ? 1 : 0;
      if (dir) { g.scrollTop += dir * Math.max(4, this._rh / 3); upd(); }
      D.raf = requestAnimationFrame(tick);
    };
    const move = (ev) => { if (ev.pointerId === D.id) { D.y = ev.clientY; upd(); } };
    const end = (ev) => {
      if (ev.pointerId !== D.id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cancelAnimationFrame(D.raf);
      this._plDrag = null;
      if (ev.type === "pointerup" && D.to >= 0 && D.to !== D.from && D.to !== D.from + 1) this._plMove(D.from, D.to > D.from ? D.to - 1 : D.to);
      else this._plRows(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    upd();
    D.raf = requestAnimationFrame(tick);
  }

  _syncSpotify(force) {
    if (this.S.src !== "spotify") return;
    const st = this._spState(), a = st?.attributes || {};
    const key = [st?.state, a.media_title, a.media_artist, a.entity_picture, a.volume_level, a.shuffle, a.repeat, a.source].join("|");
    if (!force && key === this._spKey) return;
    this._spKey = key;
    if (a.media_title !== this._spT) { this._spT = a.media_title; this.$(".np").classList.remove("wait"); }
    this._setTitle(a.media_title || (st ? (st.state === "idle" || st.state === "off" ? tx("Spotify en veille") : "—") : tx("Lecteur introuvable")));
    this.$(".artist").textContent = [a.media_artist, a.media_album_name].filter(Boolean).join(" — ");
    this._setCover(a.entity_picture ? this._abs(a.entity_picture) : "");
    this.$(".pp").innerHTML = svg(st?.state === "playing" ? "pause" : "play");
    if (Number.isFinite(a.volume_level) && Date.now() > (this._volLock || 0)) this._setVol(a.volume_level * 100, false);
    this._showSource();
  }

  // L'intégration relit Spotify 1 s après l'ordre, souvent trop tôt (l'API rend encore l'ancien titre),
  // puis seulement au cycle de 30 s : relances update_entity tant que le titre n'a pas changé.
  _spKick() {
    const title = () => this._spState()?.attributes?.media_title, was = title();
    clearTimeout(this._spKickT);
    this.$(".np").classList.add("wait");
    const steps = [1800, 3500, 6000, 10000];
    const go = (i) => {
      if (title() !== was || i >= steps.length) { this.$(".np").classList.remove("wait"); return; }
      this._spKickT = setTimeout(() => {
        if (title() === was && this._hass) this._hass.callService("homeassistant", "update_entity", { entity_id: this._cfg.entity }).catch(() => {});
        go(i + 1);
      }, steps[i] - (steps[i - 1] || 0));
    };
    go(0);
  }

  _spPos() {
    const a = this._spState()?.attributes || {};
    let pos = num(a.media_position, 0);
    if (this._spState()?.state === "playing" && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    return [Math.min(pos, num(a.media_duration, 0) || pos), num(a.media_duration, 0)];
  }

  /* ── spectre : AnalyserNode si le son passe par Web Audio, sinon simulé ── */
  _spectrum(t) {
    const S = this.S, lv = this._lv, pk = this._pk, px = this._px;
    const eqp = S.page === "eq", bands = eqp ? this._bandsEq : this._bands;
    const live = S.on && S.src !== "spotify" && this._an && this._wa(this._audio) && this._playing();
    this._live = live;
    if (live) this._an.getByteFrequencyData(this._fft);
    // Sur la page égaliseur, un spectre simulé ferait croire que l'égaliseur agit : rien plutôt.
    const sim = S.on && !live && !eqp && this._playing();
    const beat = Math.pow(Math.max(0, Math.cos((t * Math.PI * 118) / 60)), 8);
    for (let i = 0; i < NB; i++) {
      const f = i / (NB - 1);
      let target = 0;
      if (live) {
        const [k0, k1] = bands[i];
        let m = 0;
        for (let k = k0; k < k1 && k < this._fft.length; k++) m = Math.max(m, this._fft[k]);
        target = Math.pow(m / 255, 1.4);
      } else if (sim) {
        const env = 0.78 - 0.45 * f;
        const wob = 0.5 + 0.5 * Math.sin(t * (1.3 + i * 0.37) + i * 1.7) * Math.sin(t * 0.7 + i * 0.21);
        target = Math.min(1, env * (0.35 + 0.55 * wob) + beat * (1 - f) * 0.45 + Math.random() * 0.08);
      }
      lv[i] += (target - lv[i]) * (target > lv[i] ? 0.45 : 0.12);
      pk[i] = Math.max(pk[i] - 0.008, lv[i]);
      px[i * 4] = lv[i] * 255;
      px[i * 4 + 1] = pk[i] * 255;
      px[i * 4 + 3] = 255;
    }
  }

  /* ── WebGL ── */
  _initGL() {
    let cv = this.$(".screen canvas");
    if (this._glLost) { // un contexte perdu ne revient pas sur le même canvas
      const fresh = document.createElement("canvas");
      cv.replaceWith(fresh);
      cv = fresh;
      this._glLost = false;
    }
    this._cv = cv;
    try {
      const gl = cv.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
      if (!gl) throw new Error("WebGL indisponible");
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("Shader : " + gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("Link : " + gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const U = {};
      for (const k of ["R", "T", "AUR", "GLW", "ON", "SPI", "BASE", "NSEG", "A", "A2", "SP", "B"]) U[k] = gl.getUniformLocation(prog, k);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(U.B, 0);
      cv.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        console.warn(TAG + ": contexte WebGL perdu, fond CSS de secours");
        this._gl = null;
        this._glLost = true;
        this._scr.classList.add("nogl");
      }, { once: true });
      this._gl = gl;
      this._U = U;
      this._tex = tex;
      this._scr.classList.remove("nogl");
      this._fit();
    } catch (err) {
      console.warn(TAG + ":", err.message);
      this._gl = null;
      this._glFailed = true; // shader refusé ou pas de WebGL : inutile de réessayer
      this._scr.classList.add("nogl");
    }
  }

  _releaseGL() {
    if (!this._gl) return;
    this._gl.getExtension("WEBGL_lose_context")?.loseContext();
    this._gl = null;
    this._glLost = true;
  }

  _releaseAudio() {
    this._connUnwait();
    this._audio?.pause();
    this._msOwn(true);
    this._xfStop(null);
    for (const a of [this._auWA, this._auWA2, this._auDirect]) if (a) { a.removeAttribute("src"); a.load(); }
    this._actx?.close();
    this._actx = this._an = this._audio = this._auWA = this._auWA2 = this._auDirect = this._pre = this._filt = this._xg = null;
  }

  _fit() {
    if (!this._cv) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(this._scr.clientWidth * d), h = Math.round(this._scr.clientHeight * d);
    if (w && h && (this._cv.width !== w || this._cv.height !== h)) { this._cv.width = w; this._cv.height = h; }
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    clearTimeout(this._tick);
    const frame = (now) => {
      if (!this.isConnected) return;
      this._frame(now || performance.now());
      // Sans animation : quatre images par seconde suffisent à l'horloge et à la progression.
      if (REDUCED) this._tick = setTimeout(() => frame(performance.now()), 250);
      else this._raf = requestAnimationFrame(frame);
    };
    frame();
  }

  _frame(now) {
    const S = this.S, c = this._cfg, t = now / 1000;
    let pos = 0, dur = 0;
    // Un direct a une durée infinie dans le navigateur : ni barre ni compte à rebours, le temps d'écoute seul.
    // Source Radio sans station choisie : la file en place est encore celle d'une autre source, sa position ne compte pas.
    const idle = S.src === "radio" && !this._rdOwn();
    const live = idle || (S.src !== "spotify" && this._rdLive());
    if (S.src === "spotify") [pos, dur] = this._spPos();
    else if (idle) [pos, dur] = [0, 0];
    else if (this._rmE()) [pos, dur] = this._rmOwn() && !live ? this._rmPos() : [0, 0];
    else if (this._audio) { pos = this._audio.currentTime || 0; dur = live ? 0 : this._audio.duration || 0; }
    if (!Number.isFinite(dur)) dur = 0;
    if (live !== this._liveOf) { this._liveOf = live; this.$(".prog").classList.toggle("live", live); }
    this.$(".bar i").style.width = (dur ? (100 * pos) / dur : 0) + "%";
    this.$(".t0").textContent = live && (this._rmE() || idle) ? "" : fmt(pos);
    this.$(".t1").textContent = live ? tx("EN DIRECT") : dur ? "-" + fmt(dur - pos) : "--:--";
    const d = new Date(), clock = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (clock !== this._clock) { this.$(".clock").textContent = clock; this._clock = clock; }
    const pp = this._playing() ? "pause" : "play";
    if (pp !== this._pp) { this.$(".pp").innerHTML = svg(pp); this._pp = pp; }

    const gl = this._gl;
    if (!gl || !this._visible || document.hidden) return;
    this._spectrum(t);
    const dt = Math.min(0.1, Math.max(0, t - (this._lt ?? t)));
    this._lt = t;
    // Énergie des graves (8 premières bandes) : l'aurore accélère et s'avive quand ça tape.
    // Seulement sur un son réellement analysé : le spectre simulé (Spotify, Sonos, Onkyo) battrait un faux tempo.
    let en = 0;
    if (this._live) { for (let i = 0; i < 8; i++) en += this._lv[i]; en /= 8; }
    const e0 = this._en ?? 0;
    this._en = e0 + (en - e0) * (en > e0 ? 0.25 : 0.04);
    this._aT = (this._aT ?? t) + dt * (1 + 1.2 * this._en);
    // Marche/arrêt : ON glisse sur 0,6 s ; le shader replie l'image en ligne puis en point (tube cathodique).
    const onT = S.on ? 1 : 0;
    if (REDUCED || this._onV == null) this._onV = onT;
    // Arrivée exacte sur la cible : sans le cas d'égalité, 1 retombait sous 1 une image sur deux (voile blanc qui scintille).
    else if (onT !== this._onV) this._onV = onT > this._onV ? Math.min(1, this._onV + dt / 0.6) : Math.max(0, this._onV - dt / 0.6);
    const eqp = S.page === "eq";
    const sr = this._scr.getBoundingClientRect(), pr = (eqp ? this._espec : this._spec).getBoundingClientRect();
    if (!sr.width) return;
    const k = this._cv.width / sr.width, U = this._U;
    gl.viewport(0, 0, this._cv.width, this._cv.height);
    gl.uniform2f(U.R, this._cv.width, this._cv.height);
    gl.uniform1f(U.T, REDUCED ? 12 : this._aT);
    gl.uniform1f(U.AUR, c.aurora * (1 + 0.6 * this._en));
    gl.uniform1f(U.GLW, c.glow);
    gl.uniform1f(U.ON, this._onV);
    // Page égaliseur : 20 segments, sans reflet sous la base, intensité réglable (banc 2026-11-17).
    gl.uniform1f(U.SPI, eqp ? c.eq_spec : 1);
    gl.uniform1f(U.BASE, eqp ? 0 : 0.3);
    gl.uniform1f(U.NSEG, eqp ? 20 : 14);
    const [A, A2] = this._pal ? accCols(...this._pal) : accCols(c.hue, c.hue2, c.vivid);
    gl.uniform3fv(U.A, A);
    gl.uniform3fv(U.A2, A2);
    gl.uniform4f(U.SP, (pr.left - sr.left) * k, (sr.bottom - pr.bottom) * k, pr.width * k, pr.height * k);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NB, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._px);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/* ── éditeur ── */
const LABELS = {
  entity: "Lecteur Spotify (media_player)",
  source: "Appareil à réveiller si Spotify dort (sinon le premier de la liste)",
  album_entity: "Disque du jour (capteur dont l'état est un lien spotify:, optionnel)",
  outputs: "Lecteurs proposés dans Sorties (vide = aucun)",
  media_folder: "Dossier MP3 (media-source)",
  dlna_folder: "Dossier DLNA (media-source)",
  index_url: "Index de la bibliothèque (URL, généré par pyscript)",
  theme: "Thème",
  font: "Police de l'écran",
  palette_ha: "Couleurs du thème Home Assistant (remplacent les teintes)",
  eq_curve_glow: "Halo de la courbe", eq_fill: "Remplissage sous la courbe", eq_spec: "Spectre derrière la courbe",
  eq_thumb: "Taille des curseurs", eq_q: "Largeur des bandes (Q)", crossfade: "Fondu entre titres (s, 0 = coupé)", tiles_hide: "Replier les tuiles après (s sans geste, 0 = jamais)",
  eq_folder: "Dossier des préréglages .feq (URL, avec index.json)",
  hue: "Teinte", hue2: "Seconde teinte (mélangée à la première)", vivid: "Éclat des couleurs (0 = pastel d'origine, 1 = couleur pure)", glow: "Halo", glass: "Opacité du verre", blur: "Flou du verre (px)", aurora: "Aurore", text: "Taille du texte",
};

class NeonMediaCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._root = this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(h) {
    setLang(h);
    this._hass = h;
    if (this._form) this._form.hass = h;
    else this._render();
  }

  _schema() {
    const sl = (k) => ({ name: k, selector: { number: { min: RANGES[k][0], max: RANGES[k][1], step: RANGES[k][2], mode: "slider" } } });
    return [
      { name: "entity", selector: { entity: { domain: "media_player" } } },
      { name: "source", selector: { text: {} } },
      { name: "album_entity", selector: { entity: { domain: "sensor" } } },
      { name: "outputs", selector: { entity: { domain: "media_player", multiple: true } } },
      { name: "media_folder", selector: { text: {} } },
      { name: "dlna_folder", selector: { text: {} } },
      { name: "index_url", selector: { text: {} } },
      { name: "theme", selector: { select: { options: THEMES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) } } },
      { type: "expandable", name: "look", flatten: true, title: tx("Aspect"), schema: [
        { name: "font", selector: { select: { mode: "dropdown", options: FONTS.map((f) => ({ value: f[0], label: tx(f[1]) })) } } },
        { name: "palette_ha", selector: { boolean: {} } },
        ...Object.keys(LOOK).map(sl), sl("tiles_hide")] },
      { type: "expandable", name: "eqx", flatten: true, title: tx("Égaliseur et fondu"),
        schema: [...Object.keys(EQ_LOOK).map(sl), sl("crossfade"), { name: "eq_folder", selector: { text: {} } }] },
    ];
  }

  _render() {
    if (!this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => tx(LABELS[s.name] ?? s.name);
      this._form.addEventListener("value-changed", (e) => {
        const next = { ...e.detail.value };
        for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined || (Array.isArray(next[k]) && !next[k].length)) delete next[k];
        this._config = next;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
      });
      this._root.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = { theme: "graphite", font: "system", ...LOOK, hue2: (num(this._config.hue, LOOK.hue) + 55) % 360, ...EQ_LOOK, crossfade: XFADE, tiles_hide: TILES_HIDE, ...this._config };
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, NeonMediaCard);
if (!customElements.get(TAG + "-editor")) customElements.define(TAG + "-editor", NeonMediaCardEditor);
// Un constructeur ne se déclare qu'une fois : l'ancien type passe par une sous-classe, absente du sélecteur.
if (!customElements.get(OLD_TAG)) customElements.define(OLD_TAG, class extends NeonMediaCard {});
(window.customCards = window.customCards || []).push({
  type: TAG,
  name: "Neon Media",
  description: tx("Façade d'autoradio double DIN : dossier de médias, DLNA, Spotify et webradio, spectre WebGL, égaliseur 10 bandes, fondu enchaîné."),
  preview: false,
});
console.info("%c NEON-MEDIA-CARD %c " + VERSION + " ", "background:#0b1a2e;color:#5ab0ff;font-weight:700", "color:#5ab0ff");
