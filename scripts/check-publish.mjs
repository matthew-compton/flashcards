import { spawnSync } from 'node:child_process';

const check = spawnSync('git', [
  '-c', 'core.askPass=',
  '-c', 'credential.interactive=false',
  'push', '--dry-run', '--no-verify', '--no-follow-tags', '--porcelain',
  '--recurse-submodules=no', 'origin', 'HEAD:refs/heads/main'
], {
  encoding: 'utf8',
  timeout: 20_000,
  env: {
    ...process.env,
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never'
  }
});

if (check.status === 0) {
  console.log('Publish check passed. Git did not update any remote refs.');
} else {
  const output = `${check.stderr ?? ''}\n${check.stdout ?? ''}`;
  if (/NtCreateDirectoryObject[^\n]*0xC0000022|waitpid[^\n]*git-credential[^\n]*No child processes/i.test(output)) {
    console.error('Publish check blocked. The Windows sandbox prevented Git from starting its credential helper. Retry with host approval.');
  } else if (/credential|authentication failed|could not read username|permission denied/i.test(output)) {
    console.error('Publish check blocked. This session could not use an authorized Git credential.');
  } else if (/non-fast-forward|fetch first/i.test(output)) {
    console.error('Publish check blocked. The remote branch has changes to reconcile.');
  } else if (check.error?.code === 'ETIMEDOUT') {
    console.error('Publish check timed out. Check whether the remote is reachable.');
  } else {
    console.error('Publish check failed. Check the current branch, remote, and Git installation.');
  }
  process.exitCode = 1;
}
