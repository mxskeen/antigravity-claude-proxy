/**
 * Chutes Response Converter
 * Converts OpenAI Chat Completions responses to Anthropic Messages API format
 */

import crypto from 'crypto';

/**
 * Convert OpenAI Chat Completions response to Anthropic Messages API format
 *
 * @param {Object} openaiResponse - OpenAI format response
 * @param {string} model - The model name used
 * @returns {Object} Anthropic format response
 */
export function convertOpenAIToAnthropic(openaiResponse, model) {
    const choice = openaiResponse.choices?.[0] || {};
    const message = choice.message || {};

    const anthropicContent = [];
    let hasToolCalls = false;

    // Handle text content
    if (message.content) {
        anthropicContent.push({
            type: 'text',
            text: message.content
        });
    }

    // Handle reasoning/thinking content (some models support this)
    if (message.reasoning_content) {
        // Prepend thinking block before text
        anthropicContent.unshift({
            type: 'thinking',
            thinking: message.reasoning_content,
            signature: '' // OpenAI-compatible models don't use signatures
        });
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
        hasToolCalls = true;
        for (const toolCall of message.tool_calls) {
            if (toolCall.type === 'function') {
                let input = {};
                try {
                    input = JSON.parse(toolCall.function.arguments || '{}');
                } catch {
                    input = { raw: toolCall.function.arguments };
                }

                anthropicContent.push({
                    type: 'tool_use',
                    id: toolCall.id || `toolu_${crypto.randomBytes(12).toString('hex')}`,
                    name: toolCall.function.name,
                    input
                });
            }
        }
    }

    // Determine stop reason
    const finishReason = choice.finish_reason;
    let stopReason = 'end_turn';
    if (finishReason === 'stop') {
        stopReason = 'end_turn';
    } else if (finishReason === 'length') {
        stopReason = 'max_tokens';
    } else if (finishReason === 'tool_calls' || hasToolCalls) {
        stopReason = 'tool_use';
    }

    // Extract usage
    const usage = openaiResponse.usage || {};

    return {
        id: `msg_${crypto.randomBytes(16).toString('hex')}`,
        type: 'message',
        role: 'assistant',
        content: anthropicContent.length > 0 ? anthropicContent : [{ type: 'text', text: '' }],
        model: model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0
        }
    };
}
