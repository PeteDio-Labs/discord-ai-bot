import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolExecutor } from './ToolExecutor.js';
import { OllamaClient } from './OllamaClient.js';
import { registry } from './ToolRegistry.js';
import { getMetrics, resetMetrics } from '../metrics/index.js';
import type { ITool } from './types.js';
import type { Ollama } from 'ollama';
import * as SummarizerModule from './SummarizerClient.js';
import * as LoggerModule from '../utils/logger.js';

// Helper to create a mock Ollama client
function createMockOllamaClient() {
  return {
    chat: vi.fn(),
    list: vi.fn(),
  } as unknown as Ollama;
}

describe('ToolExecutor Metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('Tool execution metrics', () => {
    it('should track successful tool execution count', async () => {
      // Create a mock tool
      const mockTool: ITool = {
        name: 'test_tool',
        schema: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        execute: vi.fn().mockResolvedValue({ success: true, result: 'test result' }),
      };
      registry.register(mockTool);

      const mockOllama = createMockOllamaClient();
      (mockOllama.chat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'test_tool',
                  arguments: {} as Record<string, unknown>,
                },
              },
            ],
          },
          done: true,
        })
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: 'Final response',
          },
          done: true,
        });

      const ollamaClient = new OllamaClient({
        host: 'http://localhost:11434',
        model: 'test-model',
        timeout: 30000,
        client: mockOllama,
      });

      const executor = new ToolExecutor(ollamaClient, 5);
      await executor.processMessage('test message');

      const metrics = await getMetrics();
      expect(metrics).toContain('tool_executions_total');
      expect(metrics).toMatch(/tool_executions_total\{tool="test_tool",status="success"\} 1/);
    });

    it('should track failed tool execution count', async () => {
      // Create a mock tool that fails
      const mockTool: ITool = {
        name: 'failing_tool',
        schema: {
          name: 'failing_tool',
          description: 'A failing tool',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        execute: vi.fn().mockRejectedValue(new Error('Tool failed')),
      };
      registry.register(mockTool);

      const mockOllama = createMockOllamaClient();
      (mockOllama.chat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'failing_tool',
                  arguments: {} as Record<string, unknown>,
                },
              },
            ],
          },
          done: true,
        })
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: 'Final response',
          },
          done: true,
        });

      const ollamaClient = new OllamaClient({
        host: 'http://localhost:11434',
        model: 'test-model',
        timeout: 30000,
        client: mockOllama,
      });

      const executor = new ToolExecutor(ollamaClient, 5);
      await executor.processMessage('test message');

      const metrics = await getMetrics();
      expect(metrics).toMatch(/tool_executions_total\{tool="failing_tool",status="error"\} 1/);
    });

    it('should track tool execution duration', async () => {
      const mockTool: ITool = {
        name: 'timed_tool',
        schema: {
          name: 'timed_tool',
          description: 'A timed tool',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        execute: vi.fn().mockResolvedValue({ success: true, result: 'done' }),
      };
      registry.register(mockTool);

      const mockOllama = createMockOllamaClient();
      (mockOllama.chat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'timed_tool',
                  arguments: {} as Record<string, unknown>,
                },
              },
            ],
          },
          done: true,
        })
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: 'Final',
          },
          done: true,
        });

      const ollamaClient = new OllamaClient({
        host: 'http://localhost:11434',
        model: 'test-model',
        timeout: 30000,
        client: mockOllama,
      });

      const executor = new ToolExecutor(ollamaClient, 5);
      await executor.processMessage('test');

      const metrics = await getMetrics();
      expect(metrics).toContain('tool_execution_duration_seconds');
      expect(metrics).toMatch(/tool_execution_duration_seconds_count\{tool="timed_tool"\} 1/);
    });
  });
});

describe('ToolExecutor Logging', () => {
  let loggerDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMetrics();
    loggerDebugSpy = vi.spyOn(LoggerModule.logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerDebugSpy.mockRestore();
  });

  it('should log tool execution details via logger.debug', async () => {
    const mockTool: ITool = {
      name: 'logging_test_tool',
      schema: {
        name: 'logging_test_tool',
        description: 'Test tool for logging',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      execute: vi.fn().mockResolvedValue({ success: true, data: 'test' }),
    };
    registry.register(mockTool);

    const mockOllama = createMockOllamaClient();
    (mockOllama.chat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'logging_test_tool', arguments: {} } }],
        },
        done: true,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Done' },
        done: true,
      });

    const ollamaClient = new OllamaClient({
      host: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      client: mockOllama,
    });

    const executor = new ToolExecutor(ollamaClient, 5);
    await executor.processMessage('test logging');

    // The executor should have been created and processed the message
    expect(mockTool.execute).toHaveBeenCalled();
    // Logger should have been called with debug messages
    expect(loggerDebugSpy).toHaveBeenCalled();
    expect(loggerDebugSpy).toHaveBeenCalledWith(expect.stringContaining('[ToolExecutor]'));
  });
});

describe('ToolExecutor Summarizer Integration', () => {
  let mockSummarizer: { summarize: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resetMetrics();
    mockSummarizer = {
      summarize: vi.fn().mockResolvedValue('Summarized: You have 2 downloads in progress'),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call summarizer for mission_control torrent_list results', async () => {
    vi.spyOn(SummarizerModule, 'getSummarizer').mockReturnValue(
      mockSummarizer as unknown as SummarizerModule.SummarizerClient
    );

    const mockTool: ITool = {
      name: 'mission_control',
      schema: {
        name: 'mission_control',
        description: 'Mission Control tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      execute: vi.fn().mockResolvedValue({
        success: true,
        action: 'torrent_list',
        count: 2,
        torrents: [{ name: 'Movie1' }, { name: 'Movie2' }],
      }),
    };
    registry.register(mockTool);

    const mockOllama = createMockOllamaClient();
    (mockOllama.chat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'mission_control', arguments: { action: 'torrent_list' } } }],
        },
        done: true,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Here are your downloads' },
        done: true,
      });

    const ollamaClient = new OllamaClient({
      host: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      client: mockOllama,
    });

    const executor = new ToolExecutor(ollamaClient, 5);
    await executor.processMessage('show my downloads');

    expect(mockSummarizer.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, action: 'torrent_list', count: 2 }),
      'show my downloads'
    );
  });

  it('should not call summarizer for non-qbittorrent tools', async () => {
    vi.spyOn(SummarizerModule, 'getSummarizer').mockReturnValue(
      mockSummarizer as unknown as SummarizerModule.SummarizerClient
    );

    const mockTool: ITool = {
      name: 'calculate',
      schema: {
        name: 'calculate',
        description: 'Calculator tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      execute: vi.fn().mockResolvedValue({ success: true, result: 42 }),
    };
    registry.register(mockTool);

    const mockOllama = createMockOllamaClient();
    (mockOllama.chat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'calculate', arguments: {} } }],
        },
        done: true,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '42' },
        done: true,
      });

    const ollamaClient = new OllamaClient({
      host: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      client: mockOllama,
    });

    const executor = new ToolExecutor(ollamaClient, 5);
    await executor.processMessage('what is 6 * 7?');

    expect(mockSummarizer.summarize).not.toHaveBeenCalled();
  });

  it('should not call summarizer when disabled', async () => {
    vi.spyOn(SummarizerModule, 'getSummarizer').mockReturnValue(null);

    const mockTool: ITool = {
      name: 'mission_control',
      schema: {
        name: 'mission_control',
        description: 'Mission Control tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      execute: vi.fn().mockResolvedValue({ success: true, action: 'torrent_list', torrents: [] }),
    };
    registry.register(mockTool);

    const mockOllama = createMockOllamaClient();
    (mockOllama.chat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'mission_control', arguments: { action: 'torrent_list' } } }],
        },
        done: true,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'No downloads' },
        done: true,
      });

    const ollamaClient = new OllamaClient({
      host: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      client: mockOllama,
    });

    const executor = new ToolExecutor(ollamaClient, 5);
    await executor.processMessage('show downloads');

    expect(mockSummarizer.summarize).not.toHaveBeenCalled();
  });

  it('should fallback to raw result when summarizer fails', async () => {
    mockSummarizer.summarize.mockRejectedValueOnce(new Error('Summarizer error'));
    vi.spyOn(SummarizerModule, 'getSummarizer').mockReturnValue(
      mockSummarizer as unknown as SummarizerModule.SummarizerClient
    );

    const mockTool: ITool = {
      name: 'mission_control',
      schema: {
        name: 'mission_control',
        description: 'Mission Control tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      execute: vi.fn().mockResolvedValue({ success: true, action: 'transfer_speeds', downloadSpeed: 1000 }),
    };
    registry.register(mockTool);

    const mockOllama = createMockOllamaClient();
    (mockOllama.chat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'mission_control', arguments: { action: 'transfer_speeds' } } }],
        },
        done: true,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Speed is 1000' },
        done: true,
      });

    const ollamaClient = new OllamaClient({
      host: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      client: mockOllama,
    });

    const executor = new ToolExecutor(ollamaClient, 5);
    const result = await executor.processMessage('what is my speed?');

    // Should still complete without throwing
    expect(result.response).toBeDefined();
    expect(mockSummarizer.summarize).toHaveBeenCalled();
  });

  it('should not summarize failed tool results', async () => {
    vi.spyOn(SummarizerModule, 'getSummarizer').mockReturnValue(
      mockSummarizer as unknown as SummarizerModule.SummarizerClient
    );

    const mockTool: ITool = {
      name: 'mission_control',
      schema: {
        name: 'mission_control',
        description: 'Mission Control tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      execute: vi.fn().mockResolvedValue({ success: false, error: 'Connection failed' }),
    };
    registry.register(mockTool);

    const mockOllama = createMockOllamaClient();
    (mockOllama.chat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'mission_control', arguments: { action: 'torrent_list' } } }],
        },
        done: true,
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Error occurred' },
        done: true,
      });

    const ollamaClient = new OllamaClient({
      host: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      client: mockOllama,
    });

    const executor = new ToolExecutor(ollamaClient, 5);
    await executor.processMessage('show downloads');

    // Should not summarize error results
    expect(mockSummarizer.summarize).not.toHaveBeenCalled();
  });
});
