#!/usr/bin/env node
// PostToolUse hook — keep mockups/tokens.css in sync with theme.ts.
//
// When src/three/ui/theme.ts is edited, regenerate mockups/tokens.css via
// `npm run gen:tokens`, so the verify:tokens deploy gate can never drift red.
// The generated file lands in the working tree immediately; stage it alongside
// theme.ts in the same commit (it is GENERATED — never hand-edit it).
//
// Implemented in Node (not a shell one-liner) so it runs identically on
// Windows, macOS, and CI without depending on jq, bash, or pwsh being present.
// Wired in .claude/settings.json under hooks.PostToolUse.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- parse the hook payload (JSON on stdin) ----------------------------------
let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0); // no/!JSON stdin (e.g. run by hand) — nothing to do
}

// --- only react to edits of the ONE token source ----------------------------
const filePath = String(input?.tool_input?.file_path || '').replace(/\\/g, '/');
if (!/src\/three\/ui\/theme\.ts$/.test(filePath)) {
  process.exit(0); // not theme.ts — fast no-op (this fires after every edit)
}

// repo root = two levels up from .claude/hooks/
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  // Route the generator's own stdout/stderr to OUR stderr (fd 2) so its chatter
  // never corrupts the JSON control object we print on stdout — the harness
  // parses a hook's stdout as JSON.
  execSync('npm run gen:tokens', { cwd: repoRoot, stdio: ['ignore', 2, 2] });
  process.stdout.write(
    JSON.stringify({
      systemMessage: 'theme.ts changed → regenerated mockups/tokens.css (gen:tokens).',
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'theme.ts was edited, so mockups/tokens.css was regenerated via `npm run gen:tokens`. ' +
          'Stage mockups/tokens.css alongside theme.ts in the SAME commit — it is generated, do not hand-edit it. ' +
          'The verify:tokens deploy gate will now pass.',
      },
    }),
  );
} catch {
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        'gen:tokens hook FAILED — run `npm run gen:tokens` manually before committing, or verify:tokens will be red.',
    }),
  );
}
process.exit(0);
