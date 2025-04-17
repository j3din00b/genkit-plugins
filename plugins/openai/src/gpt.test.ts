/**
 * Copyright 2024 The Fire Company
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect } from '@jest/globals';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall,
  ChatCompletionRole,
} from 'openai/resources/index.mjs';
import type OpenAI from 'openai';
import type { GenerateRequest, Genkit, MessageData, Part, Role } from 'genkit';
import type { CandidateData } from 'genkit/model';

import {
  gpt4o,
  fromOpenAiChoice,
  fromOpenAiChunkChoice,
  fromOpenAiToolCall,
  gptModel,
  toOpenAIRole,
  toOpenAiMessages,
  toOpenAiRequestBody,
  toOpenAiTextAndMedia,
  gptRunner,
} from './gpt';
import type { OpenAiConfigSchema } from './gpt';

jest.mock('@genkit-ai/ai/model', () => ({
  ...jest.requireActual('@genkit-ai/ai/model'),
  defineModel: jest.fn(),
}));

describe('toOpenAIRole', () => {
  const testCases: {
    genkitRole: Role;
    expectedOpenAiRole: ChatCompletionRole;
  }[] = [
    {
      genkitRole: 'user',
      expectedOpenAiRole: 'user',
    },
    {
      genkitRole: 'model',
      expectedOpenAiRole: 'assistant',
    },
    {
      genkitRole: 'system',
      expectedOpenAiRole: 'system',
    },
    {
      genkitRole: 'tool',
      expectedOpenAiRole: 'tool',
    },
  ];

  for (const test of testCases) {
    it(`should map Genkit "${test.genkitRole}" role to OpenAI "${test.expectedOpenAiRole}" role`, () => {
      const actualOutput = toOpenAIRole(test.genkitRole);
      expect(actualOutput).toBe(test.expectedOpenAiRole);
    });
  }

  it('should throw an error for unknown roles', () => {
    expect(() => toOpenAIRole('unknown' as Role)).toThrowError(
      "role unknown doesn't map to an OpenAI role."
    );
  });
});

describe('toOpenAiTextAndMedia', () => {
  it('should transform text content correctly', () => {
    const part: Part = { text: 'hi' };
    const actualOutput = toOpenAiTextAndMedia(part, 'low');
    expect(actualOutput).toStrictEqual({ type: 'text', text: 'hi' });
  });

  it('should transform media content correctly', () => {
    const part: Part = {
      media: {
        contentType: 'image/jpeg',
        url: 'https://example.com/image.jpg',
      },
    };
    const actualOutput = toOpenAiTextAndMedia(part, 'low');
    expect(actualOutput).toStrictEqual({
      type: 'image_url',
      image_url: {
        url: 'https://example.com/image.jpg',
        detail: 'low',
      },
    });
  });

  it('should throw an error for unknown parts', () => {
    const part: Part = { data: 'hi' };
    expect(() => toOpenAiTextAndMedia(part, 'low')).toThrowError(
      `Unsupported genkit part fields encountered for current message role: {"data":"hi"}`
    );
  });
});

describe('toOpenAiMessages', () => {
  const testCases = [
    {
      should: 'should transform tool request content correctly',
      inputMessages: [
        {
          role: 'model',
          content: [
            {
              toolRequest: {
                ref: 'call_SVDpFV2l2fW88QRFtv85FWwM',
                name: 'tellAFunnyJoke',
                input: { topic: 'bob' },
              },
            },
          ],
        },
      ],
      expectedOutput: [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_SVDpFV2l2fW88QRFtv85FWwM',
              type: 'function',
              function: {
                name: 'tellAFunnyJoke',
                arguments: '{"topic":"bob"}',
              },
            },
          ],
        },
      ],
    },
    {
      should: 'should transform tool response text content correctly',
      inputMessages: [
        {
          role: 'tool',
          content: [
            {
              toolResponse: {
                ref: 'call_SVDpFV2l2fW88QRFtv85FWwM',
                name: 'tellAFunnyJoke',
                output: 'Why did the bob cross the road?',
              },
            },
          ],
        },
      ],
      expectedOutput: [
        {
          role: 'tool',
          tool_call_id: 'call_SVDpFV2l2fW88QRFtv85FWwM',
          content: 'Why did the bob cross the road?',
        },
      ],
    },
    {
      should: 'should transform tool response json content correctly',
      inputMessages: [
        {
          role: 'tool',
          content: [
            {
              toolResponse: {
                ref: 'call_SVDpFV2l2fW88QRFtv85FWwM',
                name: 'tellAFunnyJoke',
                output: { test: 'example' },
              },
            },
          ],
        },
      ],
      expectedOutput: [
        {
          role: 'tool',
          tool_call_id: 'call_SVDpFV2l2fW88QRFtv85FWwM',
          content: JSON.stringify({ test: 'example' }),
        },
      ],
    },
    {
      should: 'should transform text content correctly',
      inputMessages: [
        { role: 'user', content: [{ text: 'hi' }] },
        { role: 'model', content: [{ text: 'how can I help you?' }] },
        { role: 'user', content: [{ text: 'I am testing' }] },
      ],
      expectedOutput: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'how can I help you?' },
        { role: 'user', content: 'I am testing' },
      ],
    },
    {
      should: 'should transform multi-modal (text + media) content correctly',
      inputMessages: [
        {
          role: 'user',
          content: [
            { text: 'describe the following image:' },
            {
              media: {
                contentType: 'image/jpeg',
                url: 'https://img.freepik.com/free-photo/abstract-autumn-beauty-multi-colored-leaf-vein-pattern-generated-by-ai_188544-9871.jpg?size=626&ext=jpg&ga=GA1.1.735520172.1710720000&semt=ais',
              },
            },
          ],
        },
      ],
      expectedOutput: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe the following image:' },
            {
              type: 'image_url',
              image_url: {
                url: 'https://img.freepik.com/free-photo/abstract-autumn-beauty-multi-colored-leaf-vein-pattern-generated-by-ai_188544-9871.jpg?size=626&ext=jpg&ga=GA1.1.735520172.1710720000&semt=ais',
                detail: 'auto',
              },
            },
          ],
        },
      ],
    },
    {
      should: 'should transform system messages correctly',
      inputMessages: [
        { role: 'system', content: [{ text: 'system message' }] },
      ],
      expectedOutput: [{ role: 'system', content: 'system message' }],
    },
  ];

  for (const test of testCases) {
    it(test.should, () => {
      const actualOutput = toOpenAiMessages(
        test.inputMessages as MessageData[]
      );
      expect(actualOutput).toStrictEqual(test.expectedOutput);
    });
  }
});

describe('fromOpenAiToolCall', () => {
  it('should transform tool call correctly', () => {
    const toolCall: ChatCompletionMessageToolCall = {
      id: 'call_SVDpFV2l2fW88QRFtv85FWwM',
      type: 'function',
      function: {
        name: 'tellAFunnyJoke',
        arguments: '{"topic":"bob"}',
      },
    };
    const actualOutput = fromOpenAiToolCall(toolCall, {
      message: { tool_calls: [toolCall] },
      finish_reason: 'tool_calls',
    } as ChatCompletion.Choice);
    expect(actualOutput).toStrictEqual({
      toolRequest: {
        ref: 'call_SVDpFV2l2fW88QRFtv85FWwM',
        name: 'tellAFunnyJoke',
        input: { topic: 'bob' },
      },
    });
  });

  it('should proxy null-ish arguments', () => {
    const toolCall: ChatCompletionMessageToolCall = {
      id: 'call_SVDpFV2l2fW88QRFtv85FWwM',
      type: 'function',
      function: {
        name: 'tellAFunnyJoke',
        arguments: '',
      },
    };
    const actualOutput = fromOpenAiToolCall(toolCall, {
      message: { tool_calls: [toolCall] },
      finish_reason: 'tool_calls',
    } as ChatCompletion.Choice);
    expect(actualOutput).toStrictEqual({
      toolRequest: {
        ref: 'call_SVDpFV2l2fW88QRFtv85FWwM',
        name: 'tellAFunnyJoke',
        input: '',
      },
    });
  });

  it('should throw an error if tool call is missing required fields', () => {
    const toolCall: ChatCompletionMessageToolCall = {
      id: 'call_SVDpFV2l2fW88QRFtv85FWwM',
      type: 'function',
      function: undefined as any,
    };

    expect(() =>
      fromOpenAiToolCall(toolCall, {
        message: { tool_calls: [toolCall] },
        finish_reason: 'tool_calls',
      } as ChatCompletion.Choice)
    ).toThrowError(
      'Unexpected openAI chunk choice. tool_calls was provided but one or more tool_calls is missing.'
    );
  });
});

describe('fromOpenAiChoice', () => {
  const testCases: {
    should: string;
    choice: ChatCompletion.Choice;
    jsonMode?: boolean;
    expectedOutput: CandidateData;
  }[] = [
    {
      should: 'should work with text',
      choice: {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Tell a joke about dogs.',
          refusal: null,
        },
        finish_reason: 'whatever' as any,
        logprobs: null,
      },
      expectedOutput: {
        index: 0,
        finishReason: 'other',
        message: {
          role: 'model',
          content: [{ text: 'Tell a joke about dogs.' }],
        },
        custom: {},
      },
    },
    {
      should: 'should work with json',
      choice: {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({ json: 'test' }),
          refusal: null,
        },
        finish_reason: 'content_filter',
        logprobs: null,
      },
      jsonMode: true,
      expectedOutput: {
        index: 0,
        finishReason: 'blocked',
        message: {
          role: 'model',
          content: [{ data: { json: 'test' } }],
        },
        custom: {},
      },
    },
    {
      should: 'should work with tools',
      choice: {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Tool call',
          refusal: null,
          tool_calls: [
            {
              id: 'ref123',
              type: 'function',
              function: {
                name: 'exampleTool',
                arguments: JSON.stringify({ param: 'value' }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
        logprobs: null,
      },
      expectedOutput: {
        index: 0,
        message: {
          role: 'model',
          content: [
            {
              toolRequest: {
                name: 'exampleTool',
                input: { param: 'value' },
                ref: 'ref123',
              },
            },
          ],
        },
        finishReason: 'stop',
        custom: {},
      },
    },
  ];

  for (const test of testCases) {
    it(test.should, () => {
      const actualOutput = fromOpenAiChoice(test.choice, test.jsonMode);
      expect(actualOutput).toStrictEqual(test.expectedOutput);
    });
  }
});

describe('fromOpenAiChunkChoice', () => {
  const testCases: {
    should: string;
    chunkChoice: ChatCompletionChunk.Choice;
    jsonMode?: boolean;
    expectedOutput: CandidateData;
  }[] = [
    {
      should: 'should work with text',
      chunkChoice: {
        index: 0,
        delta: {
          role: 'assistant',
          content: 'Tell a joke about dogs.',
        },
        finish_reason: 'whatever' as any,
      },
      expectedOutput: {
        index: 0,
        finishReason: 'other',
        message: {
          role: 'model',
          content: [{ text: 'Tell a joke about dogs.' }],
        },
        custom: {},
      },
    },
    {
      should: 'should work with json',
      chunkChoice: {
        index: 0,
        delta: {
          role: 'assistant',
          content: JSON.stringify({ json: 'test' }),
        },
        finish_reason: null,
        logprobs: null,
      },
      jsonMode: true,
      expectedOutput: {
        index: 0,
        finishReason: 'unknown',
        message: {
          role: 'model',
          content: [{ data: { json: 'test' } }],
        },
        custom: {},
      },
    },
    {
      should: 'should work with tools',
      chunkChoice: {
        index: 0,
        delta: {
          role: 'assistant',
          content: 'Tool call',
          tool_calls: [
            {
              index: 0,
              id: 'ref123',
              function: {
                name: 'exampleTool',
                arguments: JSON.stringify({ param: 'value' }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
      expectedOutput: {
        index: 0,
        message: {
          role: 'model',
          content: [
            {
              toolRequest: {
                name: 'exampleTool',
                input: { param: 'value' },
                ref: 'ref123',
              },
            },
          ],
        },
        finishReason: 'stop',
        custom: {},
      },
    },
  ];

  for (const test of testCases) {
    it(test.should, () => {
      const actualOutput = fromOpenAiChunkChoice(
        test.chunkChoice,
        test.jsonMode
      );
      expect(actualOutput).toStrictEqual(test.expectedOutput);
    });
  }
});

describe('toOpenAiRequestBody', () => {
  const testCases = [
    {
      should: '(gpt-3.5-turbo) handles request with text messages',
      modelName: 'gpt-3.5-turbo',
      genkitRequest: {
        messages: [
          { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
        ],
        tools: [],
        output: { format: 'text' },
        config: {
          frequencyPenalty: 0.7,
          logitBias: {
            science: 12,
            technology: 8,
            politics: -5,
            sports: 3,
          },
          logProbs: true,
          presencePenalty: -0.3,
          seed: 42,
          topLogProbs: 10,
          user: 'exampleUser123',
        },
      },
      expectedOutput: {
        messages: [
          {
            role: 'user',
            content: 'Tell a joke about dogs.',
          },
        ],
        model: 'gpt-3.5-turbo',
        response_format: { type: 'text' },
        frequency_penalty: 0.7,
        logit_bias: {
          science: 12,
          technology: 8,
          politics: -5,
          sports: 3,
        },
        logprobs: true,
        presence_penalty: -0.3,
        seed: 42,
        top_logprobs: 10,
        user: 'exampleUser123',
      },
    },
    {
      should: '(gpt-3.5-turbo) handles request with text messages and tools',
      modelName: 'gpt-3.5-turbo',
      genkitRequest: {
        messages: [
          { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
          {
            role: 'model',
            content: [
              {
                toolRequest: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  input: { topic: 'dogs' },
                },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                toolResponse: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  output: 'Why did the dogs cross the road?',
                },
              },
            ],
          },
        ],
        tools: [
          {
            name: 'tellAFunnyJoke',
            description:
              'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
            inputSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
            outputSchema: {
              type: 'string',
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
          },
        ],
        output: { format: 'text' },
      },
      expectedOutput: {
        messages: [
          {
            role: 'user',
            content: 'Tell a joke about dogs.',
          },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                type: 'function',
                function: {
                  name: 'tellAFunnyJoke',
                  arguments: '{"topic":"dogs"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
            content: 'Why did the dogs cross the road?',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'tellAFunnyJoke',
              parameters: {
                type: 'object',
                properties: { topic: { type: 'string' } },
                required: ['topic'],
                additionalProperties: false,
                $schema: 'http://json-schema.org/draft-07/schema#',
              },
            },
          },
        ],
        model: 'gpt-3.5-turbo',
        response_format: {
          type: 'text',
        },
      },
    },
    {
      should: '(gpt-3.5-turbo) sets response_format if output.format=json',
      modelName: 'gpt-3.5-turbo',
      genkitRequest: {
        messages: [
          { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
          {
            role: 'model',
            content: [
              {
                toolRequest: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  input: { topic: 'dogs' },
                },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                toolResponse: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  output: 'Why did the dogs cross the road?',
                },
              },
            ],
          },
        ],
        tools: [
          {
            name: 'tellAFunnyJoke',
            description:
              'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
            inputSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
            outputSchema: {
              type: 'string',
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
          },
        ],
        output: { format: 'json' },
      },
      expectedOutput: {
        messages: [
          {
            role: 'user',
            content: 'Tell a joke about dogs.',
          },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                type: 'function',
                function: {
                  name: 'tellAFunnyJoke',
                  arguments: '{"topic":"dogs"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
            content: 'Why did the dogs cross the road?',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'tellAFunnyJoke',
              parameters: {
                type: 'object',
                properties: { topic: { type: 'string' } },
                required: ['topic'],
                additionalProperties: false,
                $schema: 'http://json-schema.org/draft-07/schema#',
              },
            },
          },
        ],
        model: 'gpt-3.5-turbo',
        response_format: { type: 'json_object' },
      },
    },
    {
      should: '(gpt-4-turbo) sets response_format if output.format=json',
      modelName: 'gpt-4-turbo',
      genkitRequest: {
        messages: [
          { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
          {
            role: 'model',
            content: [
              {
                toolRequest: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  input: { topic: 'dogs' },
                },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                toolResponse: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  output: 'Why did the dogs cross the road?',
                },
              },
            ],
          },
        ],
        tools: [
          {
            name: 'tellAFunnyJoke',
            description:
              'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
            inputSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
            outputSchema: {
              type: 'string',
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
          },
        ],
        output: { format: 'json' },
      },
      expectedOutput: {
        messages: [
          {
            role: 'user',
            content: 'Tell a joke about dogs.',
          },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                type: 'function',
                function: {
                  name: 'tellAFunnyJoke',
                  arguments: '{"topic":"dogs"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
            content: 'Why did the dogs cross the road?',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'tellAFunnyJoke',
              parameters: {
                type: 'object',
                properties: { topic: { type: 'string' } },
                required: ['topic'],
                additionalProperties: false,
                $schema: 'http://json-schema.org/draft-07/schema#',
              },
            },
          },
        ],
        model: 'gpt-4-turbo',
        response_format: { type: 'json_object' },
      },
    },
    {
      should: '(gpt-4o) sets response_format if output.format=json',
      modelName: 'gpt-4o',
      genkitRequest: {
        messages: [
          { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
          {
            role: 'model',
            content: [
              {
                toolRequest: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  input: { topic: 'dogs' },
                },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                toolResponse: {
                  ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                  name: 'tellAFunnyJoke',
                  output: 'Why did the dogs cross the road?',
                },
              },
            ],
          },
        ],
        tools: [
          {
            name: 'tellAFunnyJoke',
            description:
              'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
            inputSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
            outputSchema: {
              type: 'string',
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
          },
        ],
        output: { format: 'json' },
      },
      expectedOutput: {
        messages: [
          {
            role: 'user',
            content: 'Tell a joke about dogs.',
          },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                type: 'function',
                function: {
                  name: 'tellAFunnyJoke',
                  arguments: '{"topic":"dogs"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
            content: 'Why did the dogs cross the road?',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'tellAFunnyJoke',
              parameters: {
                type: 'object',
                properties: { topic: { type: 'string' } },
                required: ['topic'],
                additionalProperties: false,
                $schema: 'http://json-schema.org/draft-07/schema#',
              },
            },
          },
        ],
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
      },
    },
  ];
  for (const test of testCases) {
    it(test.should, () => {
      const actualOutput = toOpenAiRequestBody(
        test.modelName,
        test.genkitRequest as GenerateRequest<typeof OpenAiConfigSchema>
      );
      expect(actualOutput).toStrictEqual(test.expectedOutput);
    });
  }

  it('(gpt4) does NOT set response_format in openai request body', () => {
    // In either case - output.format='json' or output.format='text' - do NOT set response_format in the OpenAI request body explicitly.
    const modelName = 'gpt-4';
    const genkitRequestTextFormat = {
      messages: [
        { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
        {
          role: 'model',
          content: [
            {
              toolRequest: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                input: { topic: 'dogs' },
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              toolResponse: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                output: 'Why did the dogs cross the road?',
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'tellAFunnyJoke',
          description:
            'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
          inputSchema: {
            type: 'object',
            properties: { topic: { type: 'string' } },
            required: ['topic'],
            additionalProperties: false,
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
          outputSchema: {
            type: 'string',
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        },
      ],
      output: { format: 'text' },
    };
    const genkitRequestJsonFormat = {
      messages: [
        { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
        {
          role: 'model',
          content: [
            {
              toolRequest: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                input: { topic: 'dogs' },
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              toolResponse: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                output: 'Why did the dogs cross the road?',
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'tellAFunnyJoke',
          description:
            'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
          inputSchema: {
            type: 'object',
            properties: { topic: { type: 'string' } },
            required: ['topic'],
            additionalProperties: false,
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
          outputSchema: {
            type: 'string',
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        },
      ],
      output: { format: 'json' },
    };
    const expectedOutput = {
      messages: [
        {
          role: 'user',
          content: 'Tell a joke about dogs.',
        },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
              type: 'function',
              function: {
                name: 'tellAFunnyJoke',
                arguments: '{"topic":"dogs"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
          content: 'Why did the dogs cross the road?',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'tellAFunnyJoke',
            parameters: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
          },
        },
      ],
      model: 'gpt-4',
    };
    const actualOutput1 = toOpenAiRequestBody(
      modelName,
      genkitRequestTextFormat as GenerateRequest<typeof OpenAiConfigSchema>
    );
    const actualOutput2 = toOpenAiRequestBody(
      modelName,
      genkitRequestJsonFormat as GenerateRequest<typeof OpenAiConfigSchema>
    );
    expect(actualOutput1).toStrictEqual(expectedOutput);
    expect(actualOutput2).toStrictEqual(expectedOutput);
  });
  it('(gpt4-vision) does NOT set response_format in openai request body', () => {
    // In either case - output.format='json' or output.format='text' - do NOT set response_format in the OpenAI request body explicitly.
    const modelName = 'gpt-4-vision';
    const genkitRequestTextFormat = {
      messages: [
        { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
        {
          role: 'model',
          content: [
            {
              toolRequest: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                input: { topic: 'dogs' },
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              toolResponse: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                output: 'Why did the dogs cross the road?',
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'tellAFunnyJoke',
          description:
            'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
          inputSchema: {
            type: 'object',
            properties: { topic: { type: 'string' } },
            required: ['topic'],
            additionalProperties: false,
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
          outputSchema: {
            type: 'string',
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        },
      ],
      output: { format: 'text' },
    };
    const genkitRequestJsonFormat = {
      messages: [
        { role: 'user', content: [{ text: 'Tell a joke about dogs.' }] },
        {
          role: 'model',
          content: [
            {
              toolRequest: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                input: { topic: 'dogs' },
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              toolResponse: {
                ref: 'call_yTnDw3xY3KH3pkvDvccCizn1',
                name: 'tellAFunnyJoke',
                output: 'Why did the dogs cross the road?',
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: 'tellAFunnyJoke',
          description:
            'Tells jokes about an input topic. Use this tool whenever user asks you to tell a joke.',
          inputSchema: {
            type: 'object',
            properties: { topic: { type: 'string' } },
            required: ['topic'],
            additionalProperties: false,
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
          outputSchema: {
            type: 'string',
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        },
      ],
      output: { format: 'json' },
    };
    const expectedOutput = {
      messages: [
        {
          role: 'user',
          content: 'Tell a joke about dogs.',
        },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
              type: 'function',
              function: {
                name: 'tellAFunnyJoke',
                arguments: '{"topic":"dogs"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_yTnDw3xY3KH3pkvDvccCizn1',
          content: 'Why did the dogs cross the road?',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'tellAFunnyJoke',
            parameters: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
          },
        },
      ],
      model: 'gpt-4-vision',
    };
    const actualOutput1 = toOpenAiRequestBody(
      modelName,
      genkitRequestTextFormat as GenerateRequest<typeof OpenAiConfigSchema>
    );
    const actualOutput2 = toOpenAiRequestBody(
      modelName,
      genkitRequestJsonFormat as GenerateRequest<typeof OpenAiConfigSchema>
    );
    expect(actualOutput1).toStrictEqual(expectedOutput);
    expect(actualOutput2).toStrictEqual(expectedOutput);
  });

  it('should throw for unknown models', () => {
    expect(() =>
      toOpenAiRequestBody(
        'unknown-model',
        {} as GenerateRequest<typeof OpenAiConfigSchema>
      )
    ).toThrowError('Unsupported model: unknown-model');
  });

  it('should throw if model does not support specified output format', () => {
    expect(() =>
      toOpenAiRequestBody('gpt-4o', {
        messages: [],
        tools: [],
        output: { format: 'media' },
      })
    ).toThrowError('media format is not supported for GPT models currently');
  });
});

describe('gptRunner', () => {
  it('should correctly run non-streaming requests', async () => {
    const openaiClient = {
      chat: {
        completions: {
          create: jest.fn(async () => ({
            choices: [{ message: { content: 'response' } }],
          })),
        },
      },
    };
    const runner = gptRunner('gpt-4o', openaiClient as unknown as OpenAI);
    await runner({ messages: [] });
    expect(openaiClient.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o',
    });
  });

  it('should correctly run streaming requests', async () => {
    const openaiClient = {
      beta: {
        chat: {
          completions: {
            stream: jest.fn(
              () =>
                // Simluate OpenAI SDK request streaming
                new (class {
                  isFirstRequest = true;
                  [Symbol.asyncIterator]() {
                    return {
                      next: async () => {
                        const returnValue = this.isFirstRequest
                          ? {
                              value: {
                                choices: [{ delta: { content: 'response' } }],
                              },
                              done: false,
                            }
                          : { done: true };
                        this.isFirstRequest = false;
                        return returnValue;
                      },
                    };
                  }
                  async finalChatCompletion() {
                    return { choices: [{ message: { content: 'response' } }] };
                  }
                })()
            ),
          },
        },
      },
    };
    const streamingCallback = jest.fn();
    const runner = gptRunner('gpt-4o', openaiClient as unknown as OpenAI);
    await runner({ messages: [] }, streamingCallback);
    expect(openaiClient.beta.chat.completions.stream).toHaveBeenCalledWith({
      model: 'gpt-4o',
      stream: true,
    });
  });
});

describe('gptModel', () => {
  let ai: Genkit;

  beforeEach(() => {
    ai = {
      defineModel: jest.fn(),
    } as unknown as Genkit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should correctly define supported GPT models', () => {
    jest.spyOn(ai, 'defineModel').mockImplementation((() => ({})) as any);
    gptModel(ai, 'gpt-4o', {} as OpenAI);
    expect(ai.defineModel).toHaveBeenCalledWith(
      {
        name: gpt4o.name,
        ...gpt4o.info,
        configSchema: gpt4o.configSchema,
      },
      expect.any(Function)
    );
  });

  it('should correctly define gpt-4.1, gpt-4.1-mini, and gpt-4.1-nano', () => {
    jest.spyOn(ai, 'defineModel').mockImplementation((() => ({})) as any);
    gptModel(ai, 'gpt-4.1', {} as OpenAI);
    expect(ai.defineModel).toHaveBeenCalledWith(
      {
        name: 'openai/gpt-4.1',
        ...require('./gpt').gpt41.info,
        configSchema: require('./gpt').gpt41.configSchema,
      },
      expect.any(Function)
    );
    gptModel(ai, 'gpt-4.1-mini', {} as OpenAI);
    expect(ai.defineModel).toHaveBeenCalledWith(
      {
        name: 'openai/gpt-4.1-mini',
        ...require('./gpt').gpt41Mini.info,
        configSchema: require('./gpt').gpt41Mini.configSchema,
      },
      expect.any(Function)
    );
    gptModel(ai, 'gpt-4.1-nano', {} as OpenAI);
    expect(ai.defineModel).toHaveBeenCalledWith(
      {
        name: 'openai/gpt-4.1-nano',
        ...require('./gpt').gpt41Nano.info,
        configSchema: require('./gpt').gpt41Nano.configSchema,
      },
      expect.any(Function)
    );
  });
});

// Additional test to ensure toOpenAiRequestBody works for new models

describe('toOpenAiRequestBody for new GPT-4.1 variants', () => {
  const baseRequest = { messages: [] } as GenerateRequest<
    typeof OpenAiConfigSchema
  >;
  it('should not throw for gpt-4.1', () => {
    expect(() => toOpenAiRequestBody('gpt-4.1', baseRequest)).not.toThrow();
  });
  it('should not throw for gpt-4.1-mini', () => {
    expect(() =>
      toOpenAiRequestBody('gpt-4.1-mini', baseRequest)
    ).not.toThrow();
  });
  it('should not throw for gpt-4.1-nano', () => {
    expect(() =>
      toOpenAiRequestBody('gpt-4.1-nano', baseRequest)
    ).not.toThrow();
  });
});
