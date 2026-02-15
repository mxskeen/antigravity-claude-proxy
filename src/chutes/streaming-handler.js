/**
 * Chutes Streaming Handler
 * Handles streaming SSE requests to the Chutes.ai API (OpenAI-compatible)
 * Converts OpenAI streaming format to Anthropic SSE events
 */

import crypto from 'crypto';
import { convertAnthropicToOpenAI } from './request-converter.js';
import { logger } from '../utils/logger.js';
import { throttledFetch } from '../utils/helpers.js';

/**
 * Send a streaming request to Chutes API and yield Anthropic-format SSE events
 *
 * @param {Object} anthropicRequest - The Anthropic-format request
 * @param {string} apiKey - Chutes API key
 * @param {string} baseUrl - Chutes API base URL
 * @yields {Object} Anthropic-format SSE events
 */
export async function* sendMessageStream(anthropicRequest, apiKey, baseUrl) {
    const openaiRequest = convertAnthropicToOpenAI(anthropicRequest);
    openaiRequest.stream = true;
    openaiRequest.stream_options = { include_usage: true };

    const url = `${baseUrl}/v1/chat/completions`;

    logger.debug(`[Chutes] Sending streaming request to ${url} for model: ${openaiRequest.model}`);

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
        logger.error(`[Chutes] Streaming API error: ${response.status} - ${errorText}`);

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

    const messageId = `msg_${crypto.randomBytes(16).toString('hex')}`;
    let hasEmittedStart = false;
    let blockIndex = 0;
    let currentBlockType = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = null;

    // Track tool call accumulation (OpenAI sends tool calls in chunks)
    const toolCallBuffers = new Map(); // index -> { id, name, arguments }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data:')) continue;

            const jsonText = line.slice(5).trim();
            if (jsonText === '[DONE]') continue;
            if (!jsonText) continue;

            try {
                const data = JSON.parse(jsonText);

                // Extract usage if present
                if (data.usage) {
                    inputTokens = data.usage.prompt_tokens || inputTokens;
                    outputTokens = data.usage.completion_tokens || outputTokens;
                }

                const choice = data.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta || {};

                // Emit message_start on first content
                if (!hasEmittedStart && (delta.content || delta.tool_calls || delta.reasoning_content)) {
                    hasEmittedStart = true;
                    yield {
                        type: 'message_start',
                        message: {
                            id: messageId,
                            type: 'message',
                            role: 'assistant',
                            content: [],
                            model: anthropicRequest.model,
                            stop_reason: null,
                            stop_sequence: null,
                            usage: {
                                input_tokens: inputTokens,
                                output_tokens: 0,
                                cache_read_input_tokens: 0,
                                cache_creation_input_tokens: 0
                            }
                        }
                    };
                }

                // Handle reasoning/thinking content
                if (delta.reasoning_content) {
                    if (currentBlockType !== 'thinking') {
                        if (currentBlockType !== null) {
                            yield { type: 'content_block_stop', index: blockIndex };
                            blockIndex++;
                        }
                        currentBlockType = 'thinking';
                        yield {
                            type: 'content_block_start',
                            index: blockIndex,
                            content_block: { type: 'thinking', thinking: '' }
                        };
                    }

                    yield {
                        type: 'content_block_delta',
                        index: blockIndex,
                        delta: { type: 'thinking_delta', thinking: delta.reasoning_content }
                    };
                }

                // Handle text content
                if (delta.content) {
                    if (currentBlockType !== 'text') {
                        if (currentBlockType !== null) {
                            yield { type: 'content_block_stop', index: blockIndex };
                            blockIndex++;
                        }
                        currentBlockType = 'text';
                        yield {
                            type: 'content_block_start',
                            index: blockIndex,
                            content_block: { type: 'text', text: '' }
                        };
                    }

                    yield {
                        type: 'content_block_delta',
                        index: blockIndex,
                        delta: { type: 'text_delta', text: delta.content }
                    };
                }

                // Handle tool calls
                if (delta.tool_calls) {
                    for (const toolCallDelta of delta.tool_calls) {
                        const tcIndex = toolCallDelta.index ?? 0;

                        if (!toolCallBuffers.has(tcIndex)) {
                            // New tool call - close any open block
                            if (currentBlockType !== null) {
                                yield { type: 'content_block_stop', index: blockIndex };
                                blockIndex++;
                            }
                            currentBlockType = 'tool_use';
                            stopReason = 'tool_use';

                            const toolId = toolCallDelta.id || `toolu_${crypto.randomBytes(12).toString('hex')}`;
                            const toolName = toolCallDelta.function?.name || '';

                            toolCallBuffers.set(tcIndex, {
                                id: toolId,
                                name: toolName,
                                arguments: '',
                                blockIndex
                            });

                            yield {
                                type: 'content_block_start',
                                index: blockIndex,
                                content_block: {
                                    type: 'tool_use',
                                    id: toolId,
                                    name: toolName,
                                    input: {}
                                }
                            };
                        }

                        // Accumulate arguments
                        if (toolCallDelta.function?.arguments) {
                            const tc = toolCallBuffers.get(tcIndex);
                            tc.arguments += toolCallDelta.function.arguments;

                            yield {
                                type: 'content_block_delta',
                                index: tc.blockIndex,
                                delta: {
                                    type: 'input_json_delta',
                                    partial_json: toolCallDelta.function.arguments
                                }
                            };
                        }
                    }
                }

                // Check finish reason
                if (choice.finish_reason && !stopReason) {
                    if (choice.finish_reason === 'length') {
                        stopReason = 'max_tokens';
                    } else if (choice.finish_reason === 'stop') {
                        stopReason = 'end_turn';
                    } else if (choice.finish_reason === 'tool_calls') {
                        stopReason = 'tool_use';
                    }
                }

            } catch (parseError) {
                logger.warn('[Chutes] SSE parse error:', parseError.message);
            }
        }
    }

    // If no content was streamed, emit a minimal response
    if (!hasEmittedStart) {
        yield {
            type: 'message_start',
            message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model: anthropicRequest.model,
                stop_reason: null,
                stop_sequence: null,
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_input_tokens: 0,
                    cache_creation_input_tokens: 0
                }
            }
        };
    }

    // Close any open block
    if (currentBlockType !== null) {
        yield { type: 'content_block_stop', index: blockIndex };
    }

    // Emit message_delta and message_stop
    yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason || 'end_turn', stop_sequence: null },
        usage: {
            output_tokens: outputTokens,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0
        }
    };

    yield { type: 'message_stop' };
}
