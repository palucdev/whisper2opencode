import path from 'node:path';
import { fileSystem } from './file-system.js';

export const TAR_BLOCK_SIZE = 512;
export const TAR_FILENAME_LIMIT = 100;
export const TAR_SIZE_OFFSET = 124;
export const TAR_SIZE_LENGTH = 12;
export const TAR_TYPE_OFFSET = 156;
export const OCTAL_RADIX = 8;
export const DEFAULT_FILE_TYPE_CODE = 48;

const decodeNullTerminatedString = (buffer: Buffer): string => {
  const nullByteIndex = buffer.indexOf(0);
  const slice = nullByteIndex === -1 ? buffer : buffer.subarray(0, nullByteIndex);
  return slice.toString('utf8').trim();
};

const resolveMemberDestination = (targetDirectory: string, memberName: string): string => {
  const memberPath = path.resolve(targetDirectory, memberName);
  const relativeMemberPath = path.relative(targetDirectory, memberPath);
  if (!relativeMemberPath || relativeMemberPath.startsWith('..') || path.isAbsolute(relativeMemberPath)) {
    throw new Error(
      `Tarball member "${memberName}" escapes the extraction directory "${targetDirectory}". Hint: The archive contains an unsafe member path (absolute or '..' traversal); verify the package source before extracting.`,
    );
  }
  return memberPath;
};

export function unpackTarballBuffer(tarBuffer: Buffer, targetDirectory: string): void {
  let offset = 0;
  while (offset + TAR_BLOCK_SIZE <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const rawName = decodeNullTerminatedString(header.subarray(0, TAR_FILENAME_LIMIT));
    const sizeOctal = decodeNullTerminatedString(header.subarray(TAR_SIZE_OFFSET, TAR_SIZE_OFFSET + TAR_SIZE_LENGTH));
    const rawByte = header.readUInt8(TAR_TYPE_OFFSET);
    const typeFlag = String.fromCodePoint(rawByte === 0 ? DEFAULT_FILE_TYPE_CODE : rawByte);

    offset += TAR_BLOCK_SIZE;
    const size = Math.max(0, Math.min(Number.parseInt(sizeOctal, OCTAL_RADIX) || 0, tarBuffer.length - offset));

    if (rawName && (typeFlag === '0' || typeFlag === '\0')) {
      const relativePath = rawName.replace(/^package\//, '');
      const outFilePath = resolveMemberDestination(targetDirectory, relativePath);
      fileSystem.mkdirSync(path.dirname(outFilePath), { recursive: true });
      fileSystem.writeFileSync(outFilePath, tarBuffer.subarray(offset, offset + size));
    }

    const blockCount = Math.ceil(size / TAR_BLOCK_SIZE);
    offset += blockCount * TAR_BLOCK_SIZE;
  }
}
