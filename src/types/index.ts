export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  correctedText?: string;
}

export interface Transcript {
  id: string;
  videoPath: string;
  videoName: string;
  segments: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface KeyFrame {
  timestamp: number;
  reason: string;
  segmentId: string;
}

export interface KeyFrameAnalysis {
  transcriptId: string;
  keyFrames: KeyFrame[];
  createdAt: string;
}

export type ProcessingStatus =
  | 'pending'
  | 'downloading_video'
  | 'extracting_audio'
  | 'transcribing'
  | 'saving_transcript'
  | 'analyzing'
  | 'capturing'
  | 'completed'
  | 'error';

export interface ProcessingProgressEvent {
  status: ProcessingStatus;
  message: string;
  timestamp: string;
}

export interface ProcessingSummaryFrame {
  timestamp: number;
  reason: string;
  screenshotPath: string;
  publicPath: string;
}

export interface ProcessingSummary {
  transcriptId: string;
  videoName: string;
  segments: number;
  keyFrameCount: number;
  outputDir?: string;
  duration?: number;
  frames: ProcessingSummaryFrame[];
  galleryUrl?: string;
}

export interface ProcessingJob {
  id: string;
  source: string;
  videoPath?: string;
  status: ProcessingStatus;
  audioPath?: string;
  transcript?: Transcript;
  keyFrames?: KeyFrame[];
  outputDir?: string;
  error?: string;
  provider: 'whisper-local' | 'openai' | 'groq';
  model?: string;
  language?: string;
  analysisModel?: string;
  maxKeyFrames?: number;
  createdAt: string;
  updatedAt: string;
  progress: ProcessingProgressEvent[];
  summary?: ProcessingSummary;
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface OpenRouterResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface TranscriptionResponse {
  text: string;
  segments: {
    start: number;
    end: number;
    text: string;
  }[];
}
