import { spawn, spawnSync } from 'node:child_process';

/** esbuild needs piped child-process communication, not just executable access. */
console.log(`Node ${process.version}: ${process.execPath}`);
console.log(`Workspace: ${process.cwd()}`);
if (process.platform === 'win32') {
  const identity = spawnSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  console.log(`Execution identity: ${identity.stdout?.trim() || `unavailable (${identity.error?.code ?? identity.status})`}`);
}
let failed = false;
for (const stdio of ['ignore', 'pipe']) {
  const result = spawnSync(process.execPath, ['--version'], { stdio, windowsHide: true, timeout: 5000 });
  const passed = !result.error && result.status === 0;
  console.log(`${stdio === 'pipe' ? 'Piped' : 'Uncaptured'} child process: ${passed ? 'PASS' : `FAIL (${result.error?.code ?? result.status})`}`);
  failed ||= !passed;
}
/** Exercise asynchronous bidirectional pipes and hidden children as used by esbuild. */
const asynchronous = await new Promise(resolve => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
    stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
  });
  let output = '';
  let settled = false;
  const finish = result => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };
  const timer = setTimeout(() => {
    child.kill();
    finish('timeout');
  }, 5000);
  child.on('error', error => finish(error.code));
  child.stdin.on('error', error => finish(error.code));
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('close', code => finish(code === 0 && output === 'pipe-check' ? null : `exit ${code}, echo matched: ${output === 'pipe-check'}`));
  child.stdin.end('pipe-check');
});
console.log(`Asynchronous pipe round trip: ${asynchronous === null ? 'PASS' : `FAIL (${asynchronous})`}`);
failed ||= asynchronous !== null;
if (failed) {
  console.error('The current execution environment cannot support the build toolchain.');
  console.error('esbuild requires piped child processes. See docs/windows-build-runtime.md.');
  console.error('A successful allow-listed command is not proof that the sandbox works.');
  process.exitCode = 1;
}
