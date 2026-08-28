import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

/** Keyless paper-agent adapter: one real paper_run call, then a final answer. */
class CliMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const args = JSON.stringify({
        format: 'markdown',
        data: [
          '# A Study of Volcanic Basalts',
          '',
          '## Methods',
          '',
          'We "sampled" the basalts across the plateau.',
          '',
          '## References',
          '',
          '[1] Smith J. Volcanic basalts of the plateau. J Geol. 2020.',
        ].join('\n'),
        source: 'example-manuscript',
        pipeline: {
          name: 'academic-polish-smoke',
          description: 'Keyless paper-agent smoke pipeline',
          steps: [
            { id: 'ingest', type: 'ingest', config: { markdownHeadings: true, detectTitle: true } },
            { id: 'revise', type: 'revise', config: { clarity: true, flagPassiveVoice: true, flagClichés: true } },
            { id: 'format', type: 'format', config: { numberedHeadings: true, spacing: true, typographicQuotes: true } },
            { id: 'cite', type: 'cite', config: { style: 'gb7714', sort: true } },
          ],
        },
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: CallId('paper-smoke-call'),
        name: 'paper_run',
        argumentsDelta: args,
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: CallId('paper-smoke-call'), name: 'paper_run', arguments: args },
      }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const toolText = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = `Paper pipeline round trip complete: ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'cli-mock-llm'
export const inject = ['llm']

/** Register the keyless `cli-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new CliMockAdapter())
  ctx.on('agent/request', async ({ step }, next) => {
    const config = await next()
    return step === 2 ? { ...config, reasoningEffort: OFF } : config
  })
}
