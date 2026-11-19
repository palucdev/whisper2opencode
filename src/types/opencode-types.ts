// workaround til something is not done with issue https://github.com/anomalyco/opencode/issues/24065

export interface OpenCodeAgentConfig {
  prompt?: string;
  description?: string;
  mode?: string;
  model?: string;
  hidden?: boolean;
  tools?: Record<string, boolean>;
  permission?: Record<string, string>;
}

export interface OpenCodeSkillsConfig {
  paths?: string[];
  [key: string]: unknown;
}

export interface OpenCodeCommand {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

export interface OpenCodeConfig {
  agent: Record<string, OpenCodeAgentConfig>;
  command: Record<string, OpenCodeCommand>;
  skills: OpenCodeSkillsConfig;
  tools?: Record<string, boolean>;
  permission?: Record<string, string>;
}
