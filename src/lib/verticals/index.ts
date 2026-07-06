import presets from './presets.json';

export type VerticalId = 'clinica' | 'clube' | 'agencia' | 'generico';

export type AiTier = 'off' | 'simple' | 'advanced';

export interface PipelineStage {
  name: string;
  color: string;
}

export interface VerticalPreset {
  id: VerticalId;
  label: string;
  description: string;
  aiTier: AiTier;
  systemPrompt: string;
  pipelineName: string;
  pipelineStages: PipelineStage[];
  quickReplies: string[];
  knowledgeSeed: string;
}

export const VERTICALS: Record<VerticalId, VerticalPreset> =
  presets as Record<VerticalId, VerticalPreset>;

export const VERTICAL_LIST: VerticalPreset[] = Object.values(VERTICALS);

export function getVertical(id: string): VerticalPreset | null {
  return (VERTICALS as Record<string, VerticalPreset | undefined>)[id] ?? null;
}
