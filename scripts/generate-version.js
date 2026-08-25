// Erzeugt src/app/version.ts frisch vor jedem Build/Start - liefert eine bei jedem Commit garantiert
// eindeutige Versionsnummer, damit man im Browser (oben links) auf einen Blick sieht, ob ein
// Merge/Deploy schon angekommen ist, ohne die Nummer von Hand pflegen zu müssen.
//
// Bewusst NICHT die Commit-Anzahl (git rev-list --count HEAD) - CI-Systeme wie Netlify/Cloudflare
// Pages checken das Repo meist als Shallow Clone aus (nur der neueste Commit, keine volle
// Historie), wodurch die Commit-Anzahl dort immer "1" ergeben würde, egal welcher Commit gebaut
// wird. Datum + kurzer Commit-Hash funktionieren auch im Shallow Clone zuverlässig, da beide nur
// Metadaten des jeweils ausgecheckten Commits selbst brauchen, keine Historie.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, fallback) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

const commitDate = run('git log -1 --date=format:%Y%m%d --format=%cd', '00000000');
const shortHash = run('git rev-parse --short HEAD', 'dev');

const content = `// Automatisch generiert von scripts/generate-version.js - nicht von Hand bearbeiten.
export const APP_VERSION = 'v${commitDate}-${shortHash}';
export const APP_COMMIT = '${shortHash}';
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'app', 'version.ts'), content);
console.log(`Version generiert: v${commitDate}-${shortHash}`);
