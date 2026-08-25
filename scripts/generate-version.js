// Erzeugt src/app/version.ts frisch vor jedem Build/Start - liefert eine bei jedem Commit garantiert
// eindeutige, automatisch hochzählende Versionsnummer (Anzahl Commits) plus den kurzen Commit-Hash,
// damit man im Browser (oben links) auf einen Blick sieht, ob ein Merge/Deploy schon angekommen ist,
// ohne die Nummer von Hand pflegen zu müssen.
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

const commitCount = run('git rev-list --count HEAD', '0');
const shortHash = run('git rev-parse --short HEAD', 'dev');

const content = `// Automatisch generiert von scripts/generate-version.js - nicht von Hand bearbeiten.
export const APP_VERSION = 'v0.${commitCount}';
export const APP_COMMIT = '${shortHash}';
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'app', 'version.ts'), content);
console.log(`Version generiert: v0.${commitCount} (${shortHash})`);
