import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  TAR_BLOCK_SIZE,
  TAR_FILENAME_LIMIT,
  TAR_SIZE_LENGTH,
  TAR_SIZE_OFFSET,
  TAR_TYPE_OFFSET,
  unpackTarballBuffer,
} from '../../utils/tar-utility.js';
import { createMinimalTarGz } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'tar-utility');

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('unpackTarballBuffer', () => {
  test('extracts package members into the target directory', () => {
    const tarBuffer = zlib.gunzipSync(createMinimalTarGz('console.log("whisper");'));
    const targetDirectory = path.join(TEST_ROOT, 'unpacked');

    unpackTarballBuffer(tarBuffer, targetDirectory);

    const extractedFile = path.join(targetDirectory, 'whisper.js');
    expect(fs.readFileSync(extractedFile, 'utf8')).toBe('console.log("whisper");');
  });

  test('rejects members that escape the target directory', () => {
    const tarBuffer = Buffer.alloc(TAR_BLOCK_SIZE);
    tarBuffer.write('../outside.js', 0, TAR_FILENAME_LIMIT, 'utf8');
    tarBuffer.write('00000000000\0', TAR_SIZE_OFFSET, TAR_SIZE_LENGTH, 'utf8');
    tarBuffer.write('0', TAR_TYPE_OFFSET, 1, 'utf8');

    expect(() => unpackTarballBuffer(tarBuffer, path.join(TEST_ROOT, 'safe'))).toThrow(/escapes the extraction directory/);
    expect(fs.existsSync(path.join(TEST_ROOT, 'outside.js'))).toBe(false);
  });
});
