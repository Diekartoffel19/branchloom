import { execFileSync } from 'node:child_process';

execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
console.log('Jarvis Studio pre-push guard installed for this clone.');
