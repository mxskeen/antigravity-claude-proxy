/**
 * Test Chutes Format Conversion - Unit Tests
 *
 * Tests the Chutes provider format conversion between Anthropic and OpenAI formats:
 * - Request conversion: Anthropic Messages API → OpenAI Chat Completions
 * - Response conversion: OpenAI Chat Completions → Anthropic Messages API
 *
 * No server required - these are pure unit tests.
 */

async function runTests() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           CHUTES FORMAT CONVERSION TEST SUITE                ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Dynamic imports for ESM modules
    const { convertAnthropicToOpenAI } = await import('../src/chutes/request-converter.js');
    const { convertOpenAIToAnthropic } = await import('../src/chutes/response-converter.js');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`✓ ${name}`);
            passed++;
        } catch (e) {
            console.log(`✗ ${name}`);
            console.log(`  Error: ${e.message}`);
            failed++;
        }
    }

    function assertEqual(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    }

    function assertDeepEqual(actual, expected, message = '') {
        const actualStr = JSON.stringify(actual);
        const expectedStr = JSON.stringify(expected);
        if (actualStr !== expectedStr) {
            throw new Error(`${message}: expected ${expectedStr}, got ${actualStr}`);
        }
    }

    function assertTrue(value, message = '') {
        if (!value) {
            throw new Error(`${message}: expected truthy, got ${value}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // REQUEST CONVERSION TESTS (Anthropic → OpenAI)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── Request Conversion (Anthropic → OpenAI) ──\n');

    test('Basic text message conversion', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [
                { role: 'user', content: 'Hello world' }
            ]
        });

        assertEqual(result.model, 'test-model', 'model');
        assertEqual(result.messages.length, 1, 'message count');
        assertEqual(result.messages[0].role, 'user', 'role');
        assertEqual(result.messages[0].content, 'Hello world', 'content');
    });

    test('System prompt conversion', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            system: 'You are a helpful assistant.',
            messages: [
                { role: 'user', content: 'Hi' }
            ]
        });

        assertEqual(result.messages.length, 2, 'message count');
        assertEqual(result.messages[0].role, 'system', 'system role');
        assertEqual(result.messages[0].content, 'You are a helpful assistant.', 'system content');
        assertEqual(result.messages[1].role, 'user', 'user role');
    });

    test('System prompt as array', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            system: [
                { type: 'text', text: 'System instruction 1' },
                { type: 'text', text: 'System instruction 2' }
            ],
            messages: [
                { role: 'user', content: 'Hi' }
            ]
        });

        assertEqual(result.messages[0].role, 'system', 'system role');
        assertTrue(result.messages[0].content.includes('System instruction 1'), 'contains instruction 1');
        assertTrue(result.messages[0].content.includes('System instruction 2'), 'contains instruction 2');
    });

    test('Content array with text blocks', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Part 1' },
                        { type: 'text', text: 'Part 2' }
                    ]
                }
            ]
        });

        // Text-only content should be simplified to string
        assertEqual(typeof result.messages[0].content, 'string', 'content is string');
        assertTrue(result.messages[0].content.includes('Part 1'), 'contains part 1');
        assertTrue(result.messages[0].content.includes('Part 2'), 'contains part 2');
    });

    test('Image content conversion (base64)', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'What is this?' },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/png',
                                data: 'base64data'
                            }
                        }
                    ]
                }
            ]
        });

        assertTrue(Array.isArray(result.messages[0].content), 'content is array');
        assertEqual(result.messages[0].content[0].type, 'text', 'first part is text');
        assertEqual(result.messages[0].content[1].type, 'image_url', 'second part is image');
        assertTrue(result.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'), 'data URI');
    });

    test('Tool use conversion (assistant)', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Let me check.' },
                        {
                            type: 'tool_use',
                            id: 'call_123',
                            name: 'search',
                            input: { query: 'test' }
                        }
                    ]
                }
            ]
        });

        assertEqual(result.messages[0].role, 'assistant', 'role');
        assertTrue(result.messages[0].tool_calls !== undefined, 'has tool_calls');
        assertEqual(result.messages[0].tool_calls.length, 1, 'one tool call');
        assertEqual(result.messages[0].tool_calls[0].type, 'function', 'function type');
        assertEqual(result.messages[0].tool_calls[0].function.name, 'search', 'function name');
        assertEqual(result.messages[0].tool_calls[0].function.arguments, '{"query":"test"}', 'function args');
    });

    test('Tool result conversion (user)', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'call_123',
                            content: 'Search results here'
                        }
                    ]
                }
            ]
        });

        // Tool results should become tool role messages
        const toolMsg = result.messages.find(m => m.role === 'tool');
        assertTrue(toolMsg !== undefined, 'has tool message');
        assertEqual(toolMsg.tool_call_id, 'call_123', 'tool_call_id');
        assertEqual(toolMsg.content, 'Search results here', 'content');
    });

    test('Tools definition conversion', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [
                {
                    name: 'get_weather',
                    description: 'Get weather info',
                    input_schema: {
                        type: 'object',
                        properties: {
                            location: { type: 'string' }
                        }
                    }
                }
            ]
        });

        assertTrue(result.tools !== undefined, 'has tools');
        assertEqual(result.tools.length, 1, 'one tool');
        assertEqual(result.tools[0].type, 'function', 'function type');
        assertEqual(result.tools[0].function.name, 'get_weather', 'tool name');
        assertEqual(result.tools[0].function.description, 'Get weather info', 'tool description');
    });

    test('Tool choice conversion', () => {
        const autoResult = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [{ name: 'test', input_schema: {} }],
            tool_choice: { type: 'auto' }
        });
        assertEqual(autoResult.tool_choice, 'auto', 'auto tool_choice');

        const anyResult = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [{ name: 'test', input_schema: {} }],
            tool_choice: { type: 'any' }
        });
        assertEqual(anyResult.tool_choice, 'required', 'any -> required');

        const specificResult = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [{ name: 'test', input_schema: {} }],
            tool_choice: { type: 'tool', name: 'test' }
        });
        assertEqual(specificResult.tool_choice.type, 'function', 'specific tool type');
        assertEqual(specificResult.tool_choice.function.name, 'test', 'specific tool name');
    });

    test('Optional parameters preserved', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 1024,
            temperature: 0.5,
            top_p: 0.9,
            stop_sequences: ['STOP']
        });

        assertEqual(result.max_tokens, 1024, 'max_tokens');
        assertEqual(result.temperature, 0.5, 'temperature');
        assertEqual(result.top_p, 0.9, 'top_p');
        assertDeepEqual(result.stop, ['STOP'], 'stop');
    });

    test('Streaming flag set correctly', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hi' }],
            stream: true
        });

        assertEqual(result.stream, true, 'stream is true');
        assertTrue(result.stream_options !== undefined, 'has stream_options');
    });

    test('Thinking blocks are skipped in output', () => {
        const result = convertAnthropicToOpenAI({
            model: 'test-model',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'thinking', thinking: 'My reasoning...' },
                        { type: 'text', text: 'Hello' }
                    ]
                }
            ]
        });

        // Should only contain text, thinking is skipped
        assertEqual(typeof result.messages[0].content, 'string', 'simplified to string');
        assertEqual(result.messages[0].content, 'Hello', 'only text preserved');
    });

    // ═══════════════════════════════════════════════════════════════
    // RESPONSE CONVERSION TESTS (OpenAI → Anthropic)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── Response Conversion (OpenAI → Anthropic) ──\n');

    test('Basic text response conversion', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: { content: 'Hello!' },
                finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 }
        }, 'test-model');

        assertEqual(result.type, 'message', 'type');
        assertEqual(result.role, 'assistant', 'role');
        assertEqual(result.content.length, 1, 'content length');
        assertEqual(result.content[0].type, 'text', 'content type');
        assertEqual(result.content[0].text, 'Hello!', 'content text');
        assertEqual(result.stop_reason, 'end_turn', 'stop reason');
        assertEqual(result.model, 'test-model', 'model');
        assertEqual(result.usage.input_tokens, 10, 'input tokens');
        assertEqual(result.usage.output_tokens, 5, 'output tokens');
    });

    test('Tool call response conversion', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{
                        id: 'call_abc',
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            arguments: '{"location":"NYC"}'
                        }
                    }]
                },
                finish_reason: 'tool_calls'
            }],
            usage: { prompt_tokens: 20, completion_tokens: 15 }
        }, 'test-model');

        assertEqual(result.stop_reason, 'tool_use', 'stop reason');
        const toolBlock = result.content.find(c => c.type === 'tool_use');
        assertTrue(toolBlock !== undefined, 'has tool_use block');
        assertEqual(toolBlock.id, 'call_abc', 'tool id');
        assertEqual(toolBlock.name, 'get_weather', 'tool name');
        assertDeepEqual(toolBlock.input, { location: 'NYC' }, 'tool input');
    });

    test('Multiple tool calls response conversion', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: {
                    content: 'I will check both.',
                    tool_calls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: { name: 'search', arguments: '{"q":"a"}' }
                        },
                        {
                            id: 'call_2',
                            type: 'function',
                            function: { name: 'read', arguments: '{"f":"b"}' }
                        }
                    ]
                },
                finish_reason: 'tool_calls'
            }]
        }, 'test-model');

        assertEqual(result.content.length, 3, '3 blocks (text + 2 tools)');
        assertEqual(result.content[0].type, 'text', 'first is text');
        assertEqual(result.content[1].type, 'tool_use', 'second is tool_use');
        assertEqual(result.content[2].type, 'tool_use', 'third is tool_use');
    });

    test('Max tokens stop reason', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: { content: 'Truncated...' },
                finish_reason: 'length'
            }]
        }, 'test-model');

        assertEqual(result.stop_reason, 'max_tokens', 'length -> max_tokens');
    });

    test('Reasoning content becomes thinking block', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: {
                    content: 'The answer is 42.',
                    reasoning_content: 'Let me think step by step...'
                },
                finish_reason: 'stop'
            }]
        }, 'test-model');

        assertEqual(result.content.length, 2, 'has 2 blocks');
        assertEqual(result.content[0].type, 'thinking', 'first is thinking');
        assertEqual(result.content[0].thinking, 'Let me think step by step...', 'thinking content');
        assertEqual(result.content[1].type, 'text', 'second is text');
        assertEqual(result.content[1].text, 'The answer is 42.', 'text content');
    });

    test('Empty response has default content', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: {},
                finish_reason: 'stop'
            }]
        }, 'test-model');

        assertEqual(result.content.length, 1, 'has 1 block');
        assertEqual(result.content[0].type, 'text', 'default text block');
        assertEqual(result.content[0].text, '', 'empty text');
    });

    test('Response has valid Anthropic structure', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: { content: 'Test' },
                finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 5, completion_tokens: 3 }
        }, 'my-model');

        assertTrue(result.id.startsWith('msg_'), 'id starts with msg_');
        assertEqual(result.type, 'message', 'type');
        assertEqual(result.role, 'assistant', 'role');
        assertEqual(result.model, 'my-model', 'model preserved');
        assertEqual(result.stop_sequence, null, 'stop_sequence is null');
        assertTrue(result.usage !== undefined, 'has usage');
        assertEqual(result.usage.cache_read_input_tokens, 0, 'cache tokens default');
    });

    test('Malformed tool arguments handled gracefully', () => {
        const result = convertOpenAIToAnthropic({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{
                        id: 'call_bad',
                        type: 'function',
                        function: {
                            name: 'test',
                            arguments: 'not valid json'
                        }
                    }]
                },
                finish_reason: 'tool_calls'
            }]
        }, 'test-model');

        const toolBlock = result.content.find(c => c.type === 'tool_use');
        assertTrue(toolBlock !== undefined, 'has tool_use block');
        assertTrue(toolBlock.input.raw !== undefined, 'raw fallback for bad json');
    });

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('═'.repeat(60));

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
});
