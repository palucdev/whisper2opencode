const BUFFER_MEGABYTES = 256;
const BYTES_PER_KILOBYTE = 1024;
const KILOBYTES_PER_MEGABYTE = 1024;

export const DEFAULT_AUDIO_SAMPLE_RATE = 16_000;
export const SAMPLE_RATE = DEFAULT_AUDIO_SAMPLE_RATE;
export const FLOAT32_BYTES_PER_SAMPLE = 4;
export const MAX_FFMPEG_BUFFER_SIZE = BUFFER_MEGABYTES * KILOBYTES_PER_MEGABYTE * BYTES_PER_KILOBYTE;
export const TAIL_ERROR_LINE_COUNT = 3;

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.mov',
  '.avi',
  '.webm',
  '.flv',
  '.m4v',
  '.ts',
  '.mts',
  '.m2ts',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.wmv',
  '.ogv',
  '.vob',
]);
