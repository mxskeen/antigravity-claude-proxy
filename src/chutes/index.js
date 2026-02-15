/**
 * Chutes Client for Antigravity Claude Proxy
 *
 * Communicates with Chutes.ai's OpenAI-compatible API.
 * Converts between Anthropic Messages API format and OpenAI Chat Completions format.
 *
 * Supports streaming and non-streaming requests, tool use, and model listing.
 */

export { sendMessage } from './message-handler.js';
export { sendMessageStream } from './streaming-handler.js';
export { listModels } from './model-api.js';
export { convertAnthropicToOpenAI } from './request-converter.js';
export { convertOpenAIToAnthropic } from './response-converter.js';
