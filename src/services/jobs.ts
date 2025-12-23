import fs from 'fs';
import path from 'path';
import { pipeline, Readable } from 'stream';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { extractAudio } from './ffmpeg';
import { transcribeAudio, saveTranscript, TranscriptionOptions } from './transcribe';
import { analyzeTranscriptForKeyFrames } from './analyzer';
import { captureVideoFrames, generateCaptureReport, CaptureResult } from './capturer';
import { isYouTubeUrl, downloadYouTubeVideo } from './youtube';
import {
  ProcessingJob,
  ProcessingProgressEvent,
  ProcessingSummaryFrame,
} from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const TEMP_DIR = path.join(process.cwd(), 'temp');
const VIDEO_STORAGE_DIR = path.join(DATA_DIR, 'videos');
const streamPipeline = promisify(pipeline);

export interface CreateJobRequest {
  videoSource: string;
  provider?: 'whisper-local' | 'openai' | 'groq';
  model?: string;
  language?: string;
  analysisModel?: string;
  maxKeyFrames?: number;
  capture?: {
    headless?: boolean;
    width?: number;
    height?: number;
  };
}

const jobs: Record<string, ProcessingJob> = {};

export function listJobs(): ProcessingJob[] {
  return Object.values(jobs).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getJob(jobId: string): ProcessingJob | undefined {
  return jobs[jobId];
}

export function createProcessingJob(request: CreateJobRequest): ProcessingJob {
  if (!request.videoSource || !request.videoSource.trim()) {
    throw new Error('Video source is required');
  }

  const provider = request.provider || 'whisper-local';
  const jobId = uuidv4();
  const now = new Date().toISOString();

  const job: ProcessingJob = {
    id: jobId,
    source: request.videoSource.trim(),
    status: 'pending',
    provider,
    model: request.model,
    language: request.language,
    analysisModel: request.analysisModel,
    maxKeyFrames: request.maxKeyFrames,
    createdAt: now,
    updatedAt: now,
    progress: [],
  };

  jobs[jobId] = job;

  // Kick off async processing without blocking the response
  queueMicrotask(() => {
    runProcessingJob(job, request).catch((error) => {
      console.error(`Job ${job.id} failed:`, error);
    });
  });

  return job;
}

async function runProcessingJob(job: ProcessingJob, request: CreateJobRequest): Promise<void> {
  const jobTempDir = path.join(TEMP_DIR, job.id);
  await fs.promises.mkdir(jobTempDir, { recursive: true });

  try {
    pushProgress(job, 'pending', 'Job queued');

    const remoteSource = isRemoteSource(job.source);
    const youtubeSource = isYouTubeUrl(job.source);
    if (remoteSource) {
      const sourceType = youtubeSource ? 'YouTube video' : 'remote video';
      pushProgress(job, 'downloading_video', `Downloading ${sourceType}`);
    }

    const resolved = await resolveVideoSource(job.source, job.id, (message) => {
      pushProgress(job, 'downloading_video', message);
    });
    job.videoPath = resolved.videoPath;
    if (remoteSource) {
      pushProgress(job, 'downloading_video', `Downloaded video to ${resolved.videoPath}`);
    }

    pushProgress(job, 'extracting_audio', 'Extracting audio with FFmpeg');
    const { audioPath, duration } = await extractAudio(job.videoPath, jobTempDir);
    job.audioPath = audioPath;

    pushProgress(job, 'transcribing', `Transcribing audio via ${job.provider}`);
    const transcriptionOptions: TranscriptionOptions = {
      provider: job.provider,
      model: job.model,
      language: job.language,
    };
    const transcript = await transcribeAudio(audioPath, job.videoPath, transcriptionOptions);
    job.transcript = transcript;

    pushProgress(job, 'saving_transcript', 'Saving transcript to disk');
    saveTranscript(transcript, DATA_DIR);

    pushProgress(job, 'analyzing', 'Analyzing transcript for key frames');
    const analysis = await analyzeTranscriptForKeyFrames(transcript, {
      model: job.analysisModel,
      maxKeyFrames: job.maxKeyFrames,
    });
    job.keyFrames = analysis.keyFrames;

    const outputDir = path.join(OUTPUT_DIR, transcript.videoName);
    job.outputDir = outputDir;
    let captureResults: CaptureResult[] = [];

    if (analysis.keyFrames.length > 0) {
      pushProgress(job, 'capturing', `Capturing ${analysis.keyFrames.length} screenshots`);
      captureResults = await captureVideoFrames(
        transcript.videoPath,
        analysis.keyFrames,
        outputDir,
        request.capture
      );
      generateCaptureReport(captureResults, outputDir, transcript.videoName);
    } else {
      pushProgress(job, 'capturing', 'No key frames identified; skipping screenshot capture');
    }

    const galleryPath = path.join(outputDir, 'gallery.html');

    job.summary = {
      transcriptId: transcript.id,
      videoName: transcript.videoName,
      segments: transcript.segments.length,
      keyFrameCount: analysis.keyFrames.length,
      outputDir,
      duration,
      frames: captureResults.map((result) => toSummaryFrame(result)),
      galleryUrl: captureResults.length > 0 && fs.existsSync(galleryPath) ? toPublicPath(galleryPath) : undefined,
    };

    pushProgress(job, 'completed', 'Processing complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.error = message;
    pushProgress(job, 'error', message);
  } finally {
    job.updatedAt = new Date().toISOString();
    try {
      if (fs.existsSync(jobTempDir)) {
        await fs.promises.rm(jobTempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn(`Failed to clean up temp dir for job ${job.id}:`, cleanupErr);
    }
  }
}

function pushProgress(job: ProcessingJob, status: ProcessingJob['status'], message: string): void {
  const event: ProcessingProgressEvent = {
    status,
    message,
    timestamp: new Date().toISOString(),
  };
  job.progress.push(event);
  job.status = status;
  job.updatedAt = event.timestamp;
}

async function resolveVideoSource(
  source: string,
  jobId: string,
  onProgress?: (message: string) => void
): Promise<{ videoPath: string }> {
  const trimmed = source.trim();
  const isRemote = isRemoteSource(trimmed);

  if (!isRemote) {
    const absolutePath = path.resolve(trimmed);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Video file not found: ${absolutePath}`);
    }
    return { videoPath: absolutePath };
  }

  await fs.promises.mkdir(VIDEO_STORAGE_DIR, { recursive: true });

  // Check if this is a YouTube URL
  if (isYouTubeUrl(trimmed)) {
    onProgress?.('Checking for existing download...');
    const result = await downloadYouTubeVideo(trimmed, VIDEO_STORAGE_DIR, (progress) => {
      onProgress?.(`Downloading: ${progress.percent.toFixed(1)}% at ${progress.speed} (ETA: ${progress.eta})`);
    });

    if ((result as any).alreadyExists) {
      onProgress?.(`Using existing video: ${result.title}`);
    } else {
      onProgress?.(`Downloaded: ${result.title}`);
    }
    return { videoPath: result.videoPath };
  }

  // Handle regular remote URLs
  const url = new URL(trimmed);
  const ext = path.extname(url.pathname) || '.mp4';
  const baseName = sanitizeBaseName(path.basename(url.pathname, ext)) || `remote-video-${jobId}`;

  let candidate = baseName;
  let destination = path.join(VIDEO_STORAGE_DIR, `${candidate}${ext}`);
  let counter = 1;
  while (fs.existsSync(destination)) {
    candidate = `${baseName}-${counter++}`;
    destination = path.join(VIDEO_STORAGE_DIR, `${candidate}${ext}`);
  }

  await downloadToFile(trimmed, destination);
  return {
    videoPath: destination,
  };
}

async function downloadToFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download video (${response.status})`);
  }

  const tempPath = `${destination}.download`;
  const nodeStream = Readable.fromWeb(response.body as any);
  await streamPipeline(nodeStream, fs.createWriteStream(tempPath));
  await fs.promises.rename(tempPath, destination);
}

function sanitizeBaseName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function toSummaryFrame(result: CaptureResult): ProcessingSummaryFrame {
  return {
    timestamp: result.timestamp,
    reason: result.reason,
    screenshotPath: result.screenshotPath,
    publicPath: toPublicPath(result.screenshotPath),
  };
}

function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

function toPublicPath(targetPath: string): string {
  const relative = path.relative(OUTPUT_DIR, targetPath).split(path.sep).join('/');
  return `/output/${relative}`;
}
