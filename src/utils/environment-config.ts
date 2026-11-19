export interface EnvironmentConfig {
  ffmpegPath?: string;
  whisperModelPath?: string;
}

const defaultEnvironmentSource = Reflect.get(process, 'env') as Record<string, string | undefined>;

export const getEnvironmentConfig = (environmentSource: Record<string, string | undefined> = defaultEnvironmentSource): EnvironmentConfig => ({
  ffmpegPath: environmentSource.FFMPEG_PATH,
  whisperModelPath: environmentSource.WHISPER_MODEL_PATH,
});
