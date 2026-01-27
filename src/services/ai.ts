import Anthropic from '@anthropic-ai/sdk';

// Model configuration - easy to swap between models
export const MODELS = {
  // Fast, cheap - good for simple tasks
  haiku: 'claude-haiku-4-5-20251001',

  // Balanced - good for most tasks
  sonnet: 'claude-sonnet-4-20250514',

  // Most capable - for complex reasoning
  opus: 'claude-opus-4-20250514',
} as const;

export type ModelType = keyof typeof MODELS;

// Default models for different use cases - easy to adjust
export const MODEL_CONFIG = {
  // Main chat/conversation
  chat: MODELS.sonnet,

  // Food parsing (needs good estimation)
  nutrition: MODELS.sonnet,

  // Workout screenshot parsing
  vision: MODELS.sonnet,

  // Analytics/insights
  analytics: MODELS.sonnet,
} as const;

// Shared Anthropic client
export const anthropic = new Anthropic();

// Non-streaming message params (excludes stream: true)
type NonStreamingMessageParams = Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>;

// Helper to create a message with the right model (non-streaming)
export async function createMessage(
  useCase: keyof typeof MODEL_CONFIG,
  options: NonStreamingMessageParams
): Promise<Anthropic.Message> {
  return anthropic.messages.create({
    model: MODEL_CONFIG[useCase],
    ...options,
  });
}

// Override model for a specific call (useful for testing)
export async function createMessageWithModel(
  model: ModelType,
  options: NonStreamingMessageParams
): Promise<Anthropic.Message> {
  return anthropic.messages.create({
    model: MODELS[model],
    ...options,
  });
}
