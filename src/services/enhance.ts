import { Transcript, KeyFrame, TranscriptSegment } from '../types';
import { Step3Output } from '../types/workflow';
import { createOpenRouterClient } from './openrouter';
import { getOrCreateDefaultPrompt, getPrompt, renderPromptTemplate } from './prompts';

export interface EnhanceTranscriptOptions {
  promptId?: string;
  maxKeyFrames?: number;
}

export interface EnhanceResult {
  enhancedTranscript: string;
  sections: Array<{ title: string; startTime: number; endTime: number }>;
  keyFrames: KeyFrame[];
}

// Enhance transcript using AI with configurable prompt
export async function enhanceTranscript(
  transcript: Transcript,
  options: EnhanceTranscriptOptions = {}
): Promise<Step3Output> {
  const client = createOpenRouterClient();

  // Get the prompt to use
  let prompt;
  if (options.promptId) {
    prompt = await getPrompt(options.promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${options.promptId}`);
    }
  } else {
    prompt = await getOrCreateDefaultPrompt('enhance');
  }

  // Format transcript for the AI
  const formattedTranscript = transcript.segments
    .map((seg) => {
      const text = seg.correctedText || seg.text;
      return `[${formatTimestamp(seg.start)} - ${formatTimestamp(seg.end)}] (${seg.id}): ${text}`;
    })
    .join('\n');

  // Render the user prompt template
  const userPrompt = renderPromptTemplate(prompt.userPromptTemplate, {
    videoName: transcript.videoName,
    transcript: formattedTranscript,
    maxKeyFrames: options.maxKeyFrames,
    segments: transcript.segments,
  });

  console.log('Enhancing transcript with AI...');

  const response = await client.chat(
    [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    prompt.model,
    { temperature: prompt.temperature, maxTokens: prompt.maxTokens }
  );

  // Parse the JSON response
  let result: EnhanceResult;
  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    result = {
      enhancedTranscript: parsed.enhancedTranscript || '',
      sections: parsed.sections || [],
      keyFrames: (parsed.keyFrames || [])
        .filter((kf: KeyFrame) => typeof kf.timestamp === 'number' && kf.timestamp >= 0)
        .sort((a: KeyFrame, b: KeyFrame) => a.timestamp - b.timestamp),
    };
  } catch (error) {
    console.error('Failed to parse AI response:', response);
    throw new Error(`Failed to parse enhancement response: ${error}`);
  }

  console.log(`Enhanced transcript with ${result.sections.length} sections and ${result.keyFrames.length} key frames`);

  return {
    enhancedTranscript: result.enhancedTranscript,
    sections: result.sections,
    keyFrames: result.keyFrames,
    promptId: prompt.id,
    enhancedAt: new Date().toISOString(),
  };
}

// Re-enhance with additional context
export async function refineEnhancement(
  currentResult: Step3Output,
  transcript: Transcript,
  additionalContext: string,
  options: { promptId?: string } = {}
): Promise<Step3Output> {
  const client = createOpenRouterClient();

  // Get the prompt to use
  let prompt;
  if (options.promptId) {
    prompt = await getPrompt(options.promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${options.promptId}`);
    }
  } else {
    prompt = await getOrCreateDefaultPrompt('enhance');
  }

  const currentStateJson = JSON.stringify({
    enhancedTranscript: currentResult.enhancedTranscript,
    sections: currentResult.sections,
    keyFrames: currentResult.keyFrames,
  }, null, 2);

  const userMessage = `Given the following enhancement result and additional context, refine the output:

Current enhancement:
${currentStateJson}

Additional context from user:
${additionalContext}

Relevant transcript segments:
${currentResult.keyFrames
  .map((kf) => {
    const segment = transcript.segments.find((s) => s.id === kf.segmentId);
    return segment ? `[${formatTimestamp(kf.timestamp)}]: ${segment.correctedText || segment.text}` : '';
  })
  .filter(Boolean)
  .join('\n')}

Respond with an updated JSON object containing:
- enhancedTranscript: The refined transcript
- sections: Updated sections
- keyFrames: Updated key frames array`;

  const response = await client.chat(
    [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: userMessage },
    ],
    prompt.model,
    { temperature: prompt.temperature }
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      enhancedTranscript: parsed.enhancedTranscript || currentResult.enhancedTranscript,
      sections: parsed.sections || currentResult.sections,
      keyFrames: (parsed.keyFrames || currentResult.keyFrames)
        .filter((kf: KeyFrame) => typeof kf.timestamp === 'number' && kf.timestamp >= 0)
        .sort((a: KeyFrame, b: KeyFrame) => a.timestamp - b.timestamp),
      promptId: prompt.id,
      enhancedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('Failed to parse refined enhancement, keeping original:', error);
    return currentResult;
  }
}

// Create a summary from enhanced transcript
export function createSummary(step3Output: Step3Output, maxLength: number = 500): string {
  const { enhancedTranscript, sections } = step3Output;

  // If we have sections, create a summary from section titles
  if (sections.length > 0) {
    const sectionSummary = sections.map(s => `- ${s.title}`).join('\n');
    if (sectionSummary.length <= maxLength) {
      return sectionSummary;
    }
  }

  // Otherwise, use the first part of the enhanced transcript
  if (enhancedTranscript.length <= maxLength) {
    return enhancedTranscript;
  }

  return enhancedTranscript.substring(0, maxLength - 3) + '...';
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function formatTimestampForFilename(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s`;
}
