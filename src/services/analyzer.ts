import { Transcript, KeyFrame, KeyFrameAnalysis } from '../types';
import { createOpenRouterClient } from './openrouter';

const KEY_FRAME_DETECTION_PROMPT = `You are an expert at analyzing video transcripts to identify key moments that would benefit from visual documentation.

Given a transcript with timestamps, identify the most important moments where a screenshot would be valuable. Look for:
1. Topic changes or new concepts being introduced
2. Demonstrations or visual explanations being described
3. Key technical terms or processes being explained
4. Step-by-step instructions or procedures
5. Important conclusions or summaries
6. References to things being shown on screen ("as you can see", "here we have", etc.)

For each key moment, provide:
- The exact timestamp (in seconds) when the screenshot should be captured
- A brief reason explaining why this moment is important

Respond in JSON format:
{
  "keyFrames": [
    {
      "timestamp": 12.5,
      "reason": "Introduction of main topic: Kubernetes deployment",
      "segmentId": "seg-0"
    }
  ]
}

Important guidelines:
- Space key frames at least 10-15 seconds apart to avoid redundancy
- Aim for 1 key frame per 30-60 seconds of video content
- Focus on moments that would be meaningless without the visual context
- Prefer moments just before or at the start of visual demonstrations`;

export async function analyzeTranscriptForKeyFrames(
  transcript: Transcript,
  options: { model?: string; maxKeyFrames?: number } = {}
): Promise<KeyFrameAnalysis> {
  const client = createOpenRouterClient();
  const model = options.model || 'anthropic/claude-3.5-sonnet';

  // Format transcript for the AI
  const formattedTranscript = transcript.segments
    .map((seg) => {
      const text = seg.correctedText || seg.text;
      return `[${formatTimestamp(seg.start)} - ${formatTimestamp(seg.end)}] (${seg.id}): ${text}`;
    })
    .join('\n');

  const userMessage = `Analyze this transcript and identify key frames for screenshots:

Video: ${transcript.videoName}

Transcript:
${formattedTranscript}

${options.maxKeyFrames ? `Limit to approximately ${options.maxKeyFrames} key frames.` : ''}`;

  console.log('Analyzing transcript for key frames...');

  const response = await client.chat(
    [
      { role: 'system', content: KEY_FRAME_DETECTION_PROMPT },
      { role: 'user', content: userMessage },
    ],
    model,
    { temperature: 0.3 }
  );

  // Parse the JSON response
  let keyFrames: KeyFrame[];
  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);
    keyFrames = parsed.keyFrames || [];
  } catch (error) {
    console.error('Failed to parse AI response:', response);
    throw new Error(`Failed to parse key frame analysis: ${error}`);
  }

  // Validate and clean up key frames
  keyFrames = keyFrames
    .filter((kf) => typeof kf.timestamp === 'number' && kf.timestamp >= 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  console.log(`Identified ${keyFrames.length} key frames`);

  return {
    transcriptId: transcript.id,
    keyFrames,
    createdAt: new Date().toISOString(),
  };
}

export async function refineKeyFramesWithContext(
  keyFrames: KeyFrame[],
  transcript: Transcript,
  additionalContext: string,
  options: { model?: string } = {}
): Promise<KeyFrame[]> {
  const client = createOpenRouterClient();
  const model = options.model || 'anthropic/claude-3.5-sonnet';

  const currentKeyFramesJson = JSON.stringify(keyFrames, null, 2);

  const userMessage = `Given the following key frames identified for a video, and additional context about what's important to capture, refine the list:

Current key frames:
${currentKeyFramesJson}

Additional context from user:
${additionalContext}

Original transcript segments around key frames:
${keyFrames
  .map((kf) => {
    const segment = transcript.segments.find((s) => s.id === kf.segmentId);
    return segment ? `[${formatTimestamp(kf.timestamp)}]: ${segment.correctedText || segment.text}` : '';
  })
  .filter(Boolean)
  .join('\n')}

Respond with an updated JSON array of key frames, keeping, removing, or adding frames as appropriate based on the context.`;

  const response = await client.chat(
    [
      { role: 'system', content: KEY_FRAME_DETECTION_PROMPT },
      { role: 'user', content: userMessage },
    ],
    model,
    { temperature: 0.3 }
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.keyFrames || keyFrames;
  } catch (error) {
    console.warn('Failed to parse refined key frames, keeping original:', error);
    return keyFrames;
  }
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
