/**
 * Chutes Model API
 * Lists available models from Chutes.ai API (OpenAI-compatible /v1/models)
 */

import { logger } from '../utils/logger.js';
import { throttledFetch } from '../utils/helpers.js';

/**
 * List available models from Chutes API in Anthropic format
 *
 * @param {string} apiKey - Chutes API key
 * @param {string} baseUrl - Chutes API base URL
 * @returns {Promise<{object: string, data: Array}>} Anthropic-format model list
 */
export async function listModels(apiKey, baseUrl) {
    try {
        const url = `${baseUrl}/v1/models`;

        logger.debug(`[Chutes] Fetching models from ${url}`);

        const response = await throttledFetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.warn(`[Chutes] Failed to fetch models: ${response.status} - ${errorText}`);
            return { object: 'list', data: [] };
        }

        const data = await response.json();
        const models = data.data || [];

        // Convert to Anthropic format
        const modelList = models.map(m => ({
            id: m.id,
            object: 'model',
            created: m.created || Math.floor(Date.now() / 1000),
            owned_by: m.owned_by || 'chutes',
            description: m.id
        }));

        return {
            object: 'list',
            data: modelList
        };
    } catch (error) {
        logger.error('[Chutes] Error fetching models:', error.message);
        return { object: 'list', data: [] };
    }
}
