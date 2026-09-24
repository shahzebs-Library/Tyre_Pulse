import { spawnSync } from 'node:child_process';

// Vercel: exit 0 skips deployment; exit 1 requests a build.
// Compare the whole undeployed range, never just the final commit of a push.
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
if (!previous || !/^[a-f0-9]{40,64}$/i.test(previous)) {
  console.log('Build required: previous successful deployment SHA unavailable.');
  process.exit(1);
}

const result = spawnSync('git', [
  'diff', '--quiet', previous, 'HEAD', '--', '.',
  ':(exclude)mobile', ':(exclude)*.md', ':(exclude)MIGRATIONS_*.sql',
  ':(exclude)store-assets', ':(exclude).claude', ':(exclude).github',
  ':(exclude)tyre_pulse_app', ':(exclude)tyre_pulse_flutter',
  // marketing/ is a standalone Next.js app with its own root. This project
  // builds the Vite web app from the repository root and never reads it, so a
  // marketing-only push was starting a production build that could not contain
  // any of the change. Same reasoning as the two mobile apps above.
  ':(exclude)marketing',
], { stdio: 'inherit' });

// Missing shallow-clone history or any Git error must also request a build.
const unchanged = result.status === 0;
console.log(unchanged
  ? 'Skipping: no web changes since the last successful deployment.'
  : 'Build required: undeployed web changes or unavailable Git history.');
process.exit(unchanged ? 0 : 1);
