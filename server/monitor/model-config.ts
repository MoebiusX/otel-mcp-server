/**
 * Model Configuration
 * 
 * Shared mutable model config for on-the-fly switching
 * between LLM models without server restart.
 */

import { createLogger } from '../lib/logger';

const logger = createLogger('model-config');

// Available models (validated on set)
const AVAILABLE_MODELS = [
    'llama3.2:1b',
    'XavierThibaudon/anomaly-analyzer',
] as const;

type ModelName = typeof AVAILABLE_MODELS[number] | string;

// Current active model (mutable)
let currentModel: string = process.env.OLLAMA_MODEL || 'llama3.2:1b';

/**
 * Get the currently active model name
 */
export function getModel(): string {
    return currentModel;
}

/**
 * Switch to a different model at runtime
 */
export function setModel(model: string): { success: boolean; model: string; error?: string } {
    if (!model || typeof model !== 'string') {
        return { success: false, model: currentModel, error: 'Model name is required' };
    }

    const previousModel = currentModel;
    currentModel = model;

    logger.info({ previousModel, newModel: model }, 'LLM model switched');

    return { success: true, model: currentModel };
}

/**
 * Get list of known available models
 */
export function getAvailableModels(): readonly string[] {
    return AVAILABLE_MODELS;
}
