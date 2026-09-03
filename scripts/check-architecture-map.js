// Prüft, ob die Architektur-Karte in CLAUDE.md noch zum Repo passt.
//
// Warum es dieses Skript gibt: Die Karte spart jeder Session die Neu-Erkundung des Projekts, aber
// nur solange sie stimmt. Eine falsche Karte ist schlimmer als gar keine - sie schickt gezielt an
// den falschen Ort. Genau das ist schon passiert: Die Karte entstand in PR #164 und war vier
// Commits später falsch, weil die i18n-Aufteilung (PR #165) sie nicht mitzog; die Korrektur musste
// als eigener PR #167 nachkommen. Niemand hatte etwas falsch gemacht - es hat schlicht niemand
// daran gedacht. Dagegen hilft keine Bitte, sondern nur eine Prüfung, die fehlschlägt.
//
// Absichtlich KEIN Auto-Fix: Die Karte enthält Prosa-Einordnungen ("Vollbild-Overlays",
// "Infrastruktur"), die kein Skript sinnvoll schreiben kann. Das Skript sagt, was fehlt - einsortiert
// wird von Hand.
//
// Absichtlich NICHT in "npm run build" eingehängt: Cloudflare Pages baut mit genau diesem Kommando.
// Eine veraltete Karte würde sonst das Produktiv-Deployment blockieren.
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'src/app');

const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(repoRoot, p));
const lineCount = (p) => read(p).split('\n').length;

/**
 * Dateien in src/app/, die bewusst nicht in der Services-Tabelle stehen.
 * Jeder Eintrag braucht eine Begründung - sonst wird die Liste zum Abfalleimer, in dem Drift
 * versickert, statt aufzufallen.
 */
const NICHT_IN_DER_KARTE = {
  'app.ts': 'Die Shell steht im Abschnitt "Navigation", nicht in der Services-Tabelle.',
  'app.config.ts': 'Angular-Bootstrap, kein Projektwissen - für "wo liegt X?" irrelevant.',
  'app-recovery.ts':
    'Interner Helfer neben dem gelisteten app-recovery.service.ts, kein eigener Anlaufpunkt.',
  'models.ts': 'Steht im Abschnitt "Weitere Orte" unter Typen.',
  'tournament.models.ts': 'Steht im Abschnitt "Weitere Orte" unter Typen.',
  'supabase.client.ts': 'Steht in "Das Projekt in fünf Zeilen".',
};

const fehler = [];
const melde = (titel, zeilen) => {
  if (zeilen.length) fehler.push({ titel, zeilen });
};

// ---------------------------------------------------------------------------
// Die Karte einlesen
// ---------------------------------------------------------------------------

const karte = read('CLAUDE.md');

/**
 * Die Karte schreibt Tabs als `src/app/{match,search,stats,group,profile}-tab/`. Ohne Auflösung
 * dieser Sammelschreibweise meldet der Vergleich vier Komponenten fälschlich als fehlend.
 */
function expandiereKlammern(token) {
  const treffer = token.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!treffer) return [token];
  const [, vorn, mitte, hinten] = treffer;
  return mitte.split(',').flatMap((teil) => expandiereKlammern(`${vorn}${teil.trim()}${hinten}`));
}

// Alles, was in der Karte in Backticks steht - Tabellen, Prosa und Aufzählungen gleichermaßen.
// Bewusst nicht tabellenweise geparst: Die Karte darf umformuliert und umsortiert werden, ohne
// dass dieses Skript bricht.
const erwaehnt = new Set();
// Tokens, die in der Karte mit "/" enden, meinen ein Verzeichnis - das lässt sich gezielt
// gegenprüfen, ohne dass Prosa-Backticks wie `de` oder `npm run build` Lärm erzeugen.
const genannteVerzeichnisse = new Set();
for (const [, roh] of karte.matchAll(/`([^`\n]+)`/g)) {
  for (const token of expandiereKlammern(roh.trim())) {
    const ohneSlash = token.replace(/\/$/, '');
    // Leerzeichen heißt: ein Beispielkommando wie `grep -rn "..." src/app/i18n/`, kein Eintrag.
    if (token.endsWith('/') && !token.includes(' ')) genannteVerzeichnisse.add(ohneSlash);
    erwaehnt.add(ohneSlash);
    // Auch ohne "src/app/"-Präfix ablegen: Die Karte nennt Komponenten mal als `deck-list/`,
    // Services mal als `deck.service.ts`, Typen aber als `src/app/models.ts`.
    erwaehnt.add(ohneSlash.replace(/^src\/app\//, ''));
  }
}

const istErwaehnt = (name) => erwaehnt.has(name) || erwaehnt.has(`src/app/${name}`);

// ---------------------------------------------------------------------------
// 1. Vollständigkeit: Steht alles, was es gibt, auch in der Karte?
// ---------------------------------------------------------------------------

const eintraege = fs.readdirSync(appDir, { withFileTypes: true });

const komponenten = eintraege
  .filter((e) => e.isDirectory() && !['i18n', 'ui'].includes(e.name))
  .map((e) => e.name);
melde(
  'Diese Komponenten fehlen in der Komponenten-Tabelle',
  komponenten.filter((name) => !istErwaehnt(name)),
);

const services = eintraege
  .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts'))
  .map((e) => e.name)
  .filter((name) => !NICHT_IN_DER_KARTE[name]);
melde(
  'Diese Dateien aus src/app/ fehlen in der Services-Tabelle',
  services.filter((name) => !istErwaehnt(name)),
);

// Verzeichnisse nennt die Karte ohne Endung (`bar-chart`), lose Dateien mit (`chart-scale.ts`) -
// beide Schreibweisen gelten.
const bausteine = fs.readdirSync(path.join(appDir, 'ui'));
melde(
  'Diese Bausteine aus src/app/ui/ fehlen in der Karte',
  bausteine.filter((name) => !istErwaehnt(name) && !istErwaehnt(name.replace(/\.ts$/, ''))),
);

const i18nModule = fs
  .readdirSync(path.join(appDir, 'i18n'))
  .filter((n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'))
  .map((n) => n.replace(/\.ts$/, ''));
melde(
  'Diese i18n-Module fehlen in der Karte',
  i18nModule.filter((name) => !istErwaehnt(name) && !istErwaehnt(`${name}.ts`)),
);

// Die Karte nennt die Anzahl der i18n-Module im Fließtext ("13 Module").
const behaupteteModulzahl = karte.match(/(\d+)\s+Module\s*\(/);
if (behaupteteModulzahl && Number(behaupteteModulzahl[1]) !== i18nModule.length) {
  melde('Die Karte nennt die falsche Anzahl i18n-Module', [
    `Karte sagt ${behaupteteModulzahl[1]}, tatsächlich sind es ${i18nModule.length}.`,
  ]);
}

// ---------------------------------------------------------------------------
// 2. Gegenrichtung: Existiert noch alles, was die Karte nennt?
//    Fängt Umbenennungen ab, die sonst still ins Leere zeigen.
// ---------------------------------------------------------------------------

const genannteWurzeln = /^(src|public|functions|scripts|sql)\//;
const totePfade = [...erwaehnt].filter(
  (token) =>
    genannteWurzeln.test(token) &&
    !token.includes('*') &&
    !token.includes(' ') &&
    !exists(token) &&
    // version.ts wird bei jedem Build erzeugt und ist gitignored - im frischen Checkout fehlt sie.
    token !== 'src/app/version.ts',
);
// Verzeichnisse nennt die Komponenten-Tabelle meist ohne "src/app/"-Präfix (`deck-list/`). Ohne
// diese Prüfung bliebe ein veralteter Eintrag stehen, wenn beim Umbenennen nur der neue Name
// ergänzt wurde.
const toteVerzeichnisse = [...genannteVerzeichnisse].filter(
  (token) => !exists(token) && !exists(`src/app/${token}`),
);
melde('Diese Pfade nennt die Karte, es gibt sie aber nicht mehr', [
  ...totePfade,
  ...toteVerzeichnisse,
]);

// ---------------------------------------------------------------------------
// 3. Die Tabelle "Große Dateien"
// ---------------------------------------------------------------------------

const GRENZE = 1000;
const TOLERANZ = 0.1; // Ohne Toleranz färbt jeder Commit in deck-viewer.service.ts den Check rot.

const gelisteteGrosse = new Map();
for (const [, zahl, datei] of karte.matchAll(/^\|\s*(\d{3,})\s*\|\s*`([^`]+)`\s*\|/gm)) {
  gelisteteGrosse.set(datei, Number(zahl));
}

const abweichungen = [];
for (const [datei, behauptet] of gelisteteGrosse) {
  if (!exists(datei)) continue; // schon als toter Pfad gemeldet
  const echt = lineCount(datei);
  if (echt <= GRENZE) {
    abweichungen.push(`${datei}: nur noch ${echt} Zeilen - gehört nicht mehr in die Tabelle.`);
  } else if (Math.abs(echt - behauptet) / behauptet > TOLERANZ) {
    abweichungen.push(`${datei}: Karte sagt ${behauptet}, tatsächlich ${echt} Zeilen.`);
  }
}
melde('Die Tabelle "Große Dateien" stimmt nicht mehr', abweichungen);

// Gegenrichtung: Welche Datei ist über die Grenze gewachsen, ohne in der Tabelle zu landen?
function sammleQuellen(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const voll = path.join(dir, e.name);
    if (e.isDirectory()) return sammleQuellen(voll);
    return /\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts') ? [voll] : [];
  });
}
const fehlendeGrosse = sammleQuellen(path.join(repoRoot, 'src'))
  .map((voll) => path.relative(repoRoot, voll))
  .filter((rel) => lineCount(rel) > GRENZE && !gelisteteGrosse.has(rel));
melde(
  `Diese Dateien sind über ${GRENZE} Zeilen und fehlen in der Tabelle "Große Dateien"`,
  fehlendeGrosse,
);

// ---------------------------------------------------------------------------
// 4. Die i18n-Präfix-Tabelle gegen i18n-keys.spec.ts
//    Beide Tabellen sagen dasselbe; ohne Abgleich driften sie auseinander.
// ---------------------------------------------------------------------------

const spec = read('src/app/i18n/i18n-keys.spec.ts');
const modulBlock = spec.slice(spec.indexOf('const MODULES'), spec.indexOf('const entries'));

const specPraefixe = new Map();
for (const [, modul, liste] of modulBlock.matchAll(
  /(\w+):\s*\{[\s\S]*?prefixes:\s*\[([\s\S]*?)\]/g,
)) {
  specPraefixe.set(modul, [...liste.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort());
}

// "deck-view.ts" in der Karte entspricht dem Modul "deckView" in der Spec.
const alsModulname = (datei) =>
  datei.replace(/\.ts$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());

const kartenPraefixe = new Map();
for (const [, praefixSpalte, datei] of karte.matchAll(
  /^\|\s*((?:`\w+`(?:,\s*)?)+)\s*\|\s*`([\w-]+\.ts)`\s*\|/gm,
)) {
  kartenPraefixe.set(
    alsModulname(datei),
    [...praefixSpalte.matchAll(/`(\w+)`/g)].map((m) => m[1]).sort(),
  );
}

const praefixFehler = [];
for (const [modul, erwartet] of specPraefixe) {
  const inKarte = kartenPraefixe.get(modul);
  if (!inKarte) {
    praefixFehler.push(`${modul}: fehlt in der Präfix-Tabelle in CLAUDE.md.`);
  } else if (inKarte.join(',') !== erwartet.join(',')) {
    praefixFehler.push(
      `${modul}: Karte nennt [${inKarte.join(', ')}], die Spec [${erwartet.join(', ')}].`,
    );
  }
}
for (const modul of kartenPraefixe.keys()) {
  if (!specPraefixe.has(modul)) {
    praefixFehler.push(`${modul}: steht in CLAUDE.md, aber nicht in i18n-keys.spec.ts.`);
  }
}
melde('Die i18n-Präfix-Tabelle weicht von i18n-keys.spec.ts ab', praefixFehler);

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------

if (!fehler.length) {
  console.log('Architektur-Karte in CLAUDE.md passt zum Repo.');
  process.exit(0);
}

console.error('Die Architektur-Karte in CLAUDE.md ist nicht mehr aktuell:\n');
for (const { titel, zeilen } of fehler) {
  console.error(`  ${titel}:`);
  for (const zeile of zeilen) console.error(`    - ${zeile}`);
  console.error('');
}
console.error('Bitte CLAUDE.md im selben PR nachziehen.');
process.exit(1);
