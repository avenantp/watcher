import { OpenRouterRequest, OpenRouterResponse, OpenRouterMessage } from '../types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('OpenRouter API key is required');
    }
    this.apiKey = apiKey;
  }

  async chat(
    messages: OpenRouterMessage[],
    model: string = 'anthropic/claude-3.5-sonnet',
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    const request: OpenRouterRequest = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Video KeyFrame Capturer',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenRouter');
    }

    return data.choices[0].message.content;
  }

  async transcribeAudio(audioBase64: string, model: string = 'openai/whisper-large-v3'): Promise<{
    text: string;
    segments: { start: number; end: number; text: string }[];
  }> {
    // OpenRouter doesn't directly support Whisper API, so we'll use a workaround
    // For actual transcription, we'll call OpenAI-compatible endpoint or use a different approach
    // This is a placeholder - in production, you'd use a dedicated transcription service

    const response = await fetch(`${OPENROUTER_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        file: audioBase64,
        response_format: 'verbose_json',
      }),
    });

    if (!response.ok) {
      // If audio transcription isn't available, fall back to a message
      console.warn('Direct audio transcription not available via OpenRouter');
      throw new Error('Audio transcription endpoint not available. Consider using local Whisper or OpenAI API directly.');
    }

    return response.json() as Promise<{
      text: string;
      segments: { start: number; end: number; text: string }[];
    }>;
  }
}

export function createOpenRouterClient(): OpenRouterClient {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }
  return new OpenRouterClient(apiKey);
}
