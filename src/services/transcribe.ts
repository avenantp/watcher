import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Transcript, TranscriptSegment } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TranscriptionOptions {
  provider: 'whisper-local' | 'openai' | 'groq';
  model?: string;
  language?: string;
}

export async function transcribeAudio(
  audioPath: string,
  videoPath: string,
  options: TranscriptionOptions = { provider: 'whisper-local' }
): Promise<Transcript> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  let segments: { start: number; end: number; text: string }[];

  switch (options.provider) {
    case 'whisper-local':
      segments = await transcribeWithLocalWhisper(audioPath, options);
      break;
    case 'openai':
      segments = await transcribeWithOpenAI(audioPath, options);
      break;
    case 'groq':
      segments = await transcribeWithGroq(audioPath, options);
      break;
    default:
      throw new Error(`Unknown transcription provider: ${options.provider}`);
  }

  const videoName = path.basename(videoPath, path.extname(videoPath));
  const transcript: Transcript = {
    id: uuidv4(),
    videoPath,
    videoName,
    segments: segments.map((seg, idx) => ({
      id: `seg-${idx}`,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return transcript;
}

async function transcribeWithLocalWhisper(
  audioPath: string,
  options: TranscriptionOptions
): Promise<{ start: number; end: number; text: string }[]> {
  const model = options.model || 'base';
  const outputDir = path.dirname(audioPath);
  const baseName = path.basename(audioPath, path.extname(audioPath));

  console.log(`Running local Whisper with model: ${model}`);

  try {
    // Run whisper CLI (assumes whisper is installed: pip install openai-whisper)
    await execAsync(
      `whisper "${audioPath}" --model ${model} --output_format json --output_dir "${outputDir}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );

    const jsonPath = path.join(outputDir, `${baseName}.json`);
    if (!fs.existsSync(jsonPath)) {
      throw new Error('Whisper output file not found');
    }

    const result = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    return result.segments.map((seg: { start: number; end: number; text: string }) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    }));
  } catch (error) {
    throw new Error(
      `Local Whisper transcription failed. Ensure whisper is installed: pip install openai-whisper\n${error}`
    );
  }
}

async function transcribeWithOpenAI(
  audioPath: string,
  options: TranscriptionOptions
): Promise<{ start: number; end: number; text: string }[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const audioData = fs.readFileSync(audioPath);
  const formData = new FormData();
  formData.append('file', new Blob([audioData]), path.basename(audioPath));
  formData.append('model', options.model || 'whisper-1');
  formData.append('response_format', 'verbose_json');
  if (options.language) {
    formData.append('language', options.language);
  }

  console.log('Sending audio to OpenAI Whisper API...');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const result = await response.json() as { segments: { start: number; end: number; text: string }[] };
  return result.segments.map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }));
}

async function transcribeWithGroq(
  audioPath: string,
  options: TranscriptionOptions
): Promise<{ start: number; end: number; text: string }[]> {
  // Groq provides fast Whisper transcription
  // Can use either GROQ_API_KEY or OPENROUTER_API_KEY
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY or OPENROUTER_API_KEY environment variable is not set');
  }

  const audioData = fs.readFileSync(audioPath);
  const formData = new FormData();
  formData.append('file', new Blob([audioData]), path.basename(audioPath));
  formData.append('model', options.model || 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  if (options.language) {
    formData.append('language', options.language);
  }

  console.log('Sending audio to Groq Whisper API...');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const result = await response.json() as { segments?: { start: number; end: number; text: string }[] };
  return (result.segments || []).map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }));
}

export function saveTranscript(transcript: Transcript, dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const filePath = path.join(dataDir, `${transcript.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2));
}

export function loadTranscript(transcriptId: string, dataDir: string): Transcript | null {
  const filePath = path.join(dataDir, `${transcriptId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadAllTranscripts(dataDir: string): Transcript[] {
  if (!fs.existsSync(dataDir)) {
    return [];
  }
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8')));
}

export function updateTranscriptSegment(
  transcript: Transcript,
  segmentId: string,
  correctedText: string
): Transcript {
  const segment = transcript.segments.find((s) => s.id === segmentId);
  if (segment) {
    segment.correctedText = correctedText;
  }
  transcript.updatedAt = new Date().toISOString();
  return transcript;
}
