import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { build, runIfMain } from '../build.js';

describe('build.js', () => {
  it('builds Apps Script output without export statements', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groq-gas-'));
    const srcDir = path.join(tempDir, 'src');
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'Code.js'),
      [
        'export function greet() { return "hi"; }',
        'export { greet };'
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(path.join(tempDir, 'appsscript.json'), '{"timeZone":"UTC"}', 'utf8');

    build({ rootDir: tempDir });

    const compiled = fs.readFileSync(path.join(distDir, 'Code.gs'), 'utf8');
    const manifest = fs.readFileSync(path.join(distDir, 'appsscript.json'), 'utf8');

    expect(compiled).toContain('function greet()');
    expect(compiled).not.toContain('export');
    expect(manifest).toBe('{"timeZone":"UTC"}');
  });

  it('runIfMain executes build when module is main', () => {
    const buildFn = vi.fn();
    const current = {};
    const result = runIfMain({ main: current, current, buildFn });

    expect(result).toBe(true);
    expect(buildFn).toHaveBeenCalled();
  });

  it('runIfMain skips build when module is not main', () => {
    const buildFn = vi.fn();
    const result = runIfMain({ main: {}, current: null, buildFn });

    expect(result).toBe(false);
    expect(buildFn).not.toHaveBeenCalled();
  });
});
