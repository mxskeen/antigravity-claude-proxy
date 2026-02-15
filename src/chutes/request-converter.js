/**
 * Chutes Request Converter
 * Converts Anthropic Messages API requests to OpenAI Chat Completions format
 * for use with Chutes.ai (OpenAI-compatible API)
 */

import crypto from 'crypto';

import { logger } from '../utils/logger.js';

/**
 * Convert Anthropic role to OpenAI role
 * @param {string} role - Anthropic role ('user', 'assistant')
 * @returns {string} OpenAI role ('user', 'assistant')
 */
function convertRole(role) {
    if (role === 'assistant') return 'assistant';
    if (role === 'user') return 'user';
    return 'user';
}

/**
 * Convert Anthropic content blocks to OpenAI message content
 * @param {string|Array} content - Anthropic content (string or array of blocks)
 * @returns {string|Array} OpenAI content (string or array of content parts)
 */
function convertContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return String(content);
    }

    // Check if content is all text - simplify to string
    const nonTextBlocks = content.filter(b => b && b.type !== 'text' && b.type !== 'thinking');
    if (nonTextBlocks.length === 0) {
        const textParts = content
            .filter(b => b && b.type === 'text' && b.text)
            .map(b => b.text);
        return textParts.join('\n') || '';
    }

    // Mixed content - convert to OpenAI content parts
    const parts = [];
    for (const block of content) {
        if (!block) continue;

        if (block.type === 'text') {
            if (block.text) {
                parts.push({ type: 'text', text: block.text });
            }
        } else if (block.type === 'image') {
            if (block.source?.type === 'base64') {
                parts.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${block.source.media_type};base64,${block.source.data}`
                    }
                });
            } else if (block.source?.type === 'url') {
                parts.push({
                    type: 'image_url',
                    image_url: { url: block.source.url }
                });
            }
        } else if (block.type === 'thinking') {
            // Skip thinking blocks in outgoing requests
        }
    }

    return parts.length > 0 ? parts : '';
}

/**
 * Convert Anthropic Messages API request to OpenAI Chat Completions format
 *
 * @param {Object} anthropicRequest - Anthropic format request
 * @returns {Object} OpenAI Chat Completions request body
 */
export function convertAnthropicToOpenAI(anthropicRequest) {
    const {
        model,
        messages = [],
        system,
        max_tokens,
        temperature,
        top_p,
        stop_sequences,
        tools,
        tool_choice,
        thinking,
        stream
    } = anthropicRequest;

    const openaiMessages = [];

    // Add system message
    if (system) {
        if (typeof system === 'string') {
            openaiMessages.push({ role: 'system', content: system });
        } else if (Array.isArray(system)) {
            const systemText = system
                .filter(s => s.type === 'text')
                .map(s => s.text)
                .join('\n');
            if (systemText) {
                openaiMessages.push({ role: 'system', content: systemText });
            }
        }
    }

    // Convert messages
    for (const msg of messages) {
        if (!msg) continue;

        const role = convertRole(msg.role);

        // Handle content arrays with tool_use and tool_result blocks
        if (Array.isArray(msg.content)) {
            const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use');
            const toolResultBlocks = msg.content.filter(b => b.type === 'tool_result');

            if (role === 'assistant' && toolUseBlocks.length > 0) {
                // Assistant message with tool calls
                const textContent = msg.content
                    .filter(b => b.type === 'text' && b.text)
                    .map(b => b.text)
                    .join('\n');

                const toolCalls = toolUseBlocks.map(block => ({
                    id: block.id || `call_${crypto.randomBytes(12).toString('hex')}`,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input || {})
                    }
                }));

                openaiMessages.push({
                    role: 'assistant',
                    content: textContent || null,
                    tool_calls: toolCalls
                });
                continue;
            }

            if (role === 'user' && toolResultBlocks.length > 0) {
                // User message with tool results - convert to tool role messages
                // First add any non-tool-result content as user message
                const otherContent = msg.content.filter(
                    b => b.type !== 'tool_result'
                );
                if (otherContent.length > 0) {
                    const converted = convertContent(otherContent);
                    if (converted) {
                        openaiMessages.push({ role: 'user', content: converted });
                    }
                }

                // Add tool results as tool messages
                for (const result of toolResultBlocks) {
                    let resultContent = '';
                    if (typeof result.content === 'string') {
                        resultContent = result.content;
                    } else if (Array.isArray(result.content)) {
                        resultContent = result.content
                            .filter(c => c.type === 'text')
                            .map(c => c.text)
                            .join('\n');
                    }

                    openaiMessages.push({
                        role: 'tool',
                        tool_call_id: result.tool_use_id || 'unknown',
                        content: resultContent || ''
                    });
                }
                continue;
            }
        }

        // Regular message
        openaiMessages.push({
            role,
            content: convertContent(msg.content)
        });
    }

    // Build OpenAI request
    const openaiRequest = {
        model: model,
        messages: openaiMessages,
        stream: !!stream
    };

    // Optional parameters
    if (max_tokens) openaiRequest.max_tokens = max_tokens;
    if (temperature !== undefined && temperature !== null) openaiRequest.temperature = temperature;
    if (top_p !== undefined && top_p !== null) openaiRequest.top_p = top_p;
    if (stop_sequences && stop_sequences.length > 0) openaiRequest.stop = stop_sequences;

    // Convert tools
    if (tools && tools.length > 0) {
        openaiRequest.tools = tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.input_schema || {}
            }
        }));
    }

    // Convert tool_choice
    if (tool_choice) {
        if (tool_choice.type === 'auto') {
            openaiRequest.tool_choice = 'auto';
        } else if (tool_choice.type === 'any') {
            openaiRequest.tool_choice = 'required';
        } else if (tool_choice.type === 'tool' && tool_choice.name) {
            openaiRequest.tool_choice = {
                type: 'function',
                function: { name: tool_choice.name }
            };
        }
    }

    // Enable streaming options for tool calls
    if (stream && openaiRequest.tools) {
        openaiRequest.stream_options = { include_usage: true };
    } else if (stream) {
        openaiRequest.stream_options = { include_usage: true };
    }

    return openaiRequest;
}
