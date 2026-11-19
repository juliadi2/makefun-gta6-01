// SOLMAR HEAT — gta6-01 entry program (Node 22, standard library only).
//
// Hands the game in: copies this repository's game/ (the playable static game)
// and screenshots/ (renders of the game itself) into the output directory and
// writes dossier.json there with make.fun's vendored library, which is what
// the judge reads. Runs twice in the grader; both runs must write identical
// bytes, so this program only copies files and derives the dossier from them.
//
// Locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader: MAKEFUN_OUTPUT_DIR is unset and the output is /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), {
    recursive: true,
  });
}

// The scorer's own caps (from the competition's gate): only text_max_bytes
// shapes the dossier's bytes; the other caps refuse an entry the scorer would
// refuse (more than 4 screenshots or one over 256 KiB; game/ past 993 entries
// or 48 MiB; a game path over 1000 bytes).
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
