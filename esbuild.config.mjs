import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  external: ['vscode', 'ajv', 'ajv-formats'],
  logLevel: 'info',
});
