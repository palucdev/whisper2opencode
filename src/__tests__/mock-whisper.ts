import { mock } from 'bun:test';

export const mockWhisperState = {
  failInit: false,
  failFullDefault: false,
  reset() {
    mockWhisperState.failInit = false;
    mockWhisperState.failFullDefault = false;
  },
};

const mockWhisperFactory = (options: { print: (text: string) => void; printErr: (text: string) => void }) =>
  Promise.resolve({
    FS_createDataFile: () => {},
    init: () => !mockWhisperState.failInit,
    full_default: () => {
      if (mockWhisperState.failFullDefault) {
        options.printErr('mock whisper execution failed');
        return 1;
      }
      options.print('[00:00:00.000 --> 00:00:00.500] And so my fellow Americans');
      options.print('[00:00:00.500 --> 00:00:01.000] ask not what you can do for your country ask what you can do for your country');
      return 0;
    },
    free: () => {},
    PThread: { terminateAllThreads: () => {} },
  });

mock.module('whisper.cpp', () => ({
  default: mockWhisperFactory,
  __esModule: true,
}));
