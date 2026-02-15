/**
 * Chutes Message Handler
 * Handles non-streaming requests to the Chutes.ai API (OpenAI-compatible)
 */

import { convertAnthropicToOpenAI } from './request-converter.js';
import { convertOpenAIToAnthropic } from './response-converter.js';
import { logger } from '../utils/logger.js';
import { throttledFetch } from '../utils/helpers.js';

/**
 * Send a non-streaming request to Chutes API
 *
 * @param {Object} anthropicRequest - The Anthropic-format request
 * @param {string} apiKey - Chutes API key
 * @param {string} baseUrl - Chutes API base URL
 * @returns {Promise<Object>} Anthropic-format response
 */
export async function sendMessage(anthropicRequest, apiKey, baseUrl) {
    const openaiRequest = convertAnthropicToOpenAI(anthropicRequest);
    openaiRequest.stream = false;

    const url = `${baseUrl}/v1/chat/completions`;

    logger.debug(`[Chutes] Sending non-streaming request to ${url} for model: ${openaiRequest.model}`);

    const response = await throttledFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(openaiRequest)
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Chutes] API error: ${response.status} - ${errorText}`);

        if (response.status === 429) {
            throw new Error(`RESOURCE_EXHAUSTED: Rate limited on ${anthropicRequest.model}. ${errorText}`);
        }
        if (response.status === 401) {
            throw new Error(`AUTH_INVALID: Invalid Chutes API key. ${errorText}`);
        }
        if (response.status === 400) {
            throw new Error(`invalid_request_error: ${errorText}`);
        }
        throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    logger.debug('[Chutes] Response received');

    return convertOpenAIToAnthropic(data, anthropicRequest.model);
}
