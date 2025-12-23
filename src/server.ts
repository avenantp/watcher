import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { Transcript, KeyFrame } from './types';
import {
  loadTranscript,
  saveTranscript,
  loadAllTranscripts,
  updateTranscriptSegment,
} from './services/transcribe';
import { analyzeTranscriptForKeyFrames } from './services/analyzer';
import { captureVideoFrames, generateCaptureReport } from './services/capturer';
import { createProcessingJob, listJobs, getJob, CreateJobRequest } from './services/jobs';

// New route imports
import workflowsRouter from './routes/workflows';
import promptsRouter from './routes/prompts';
import settingsRouter from './routes/settings';
import videosRouter from './routes/videos';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(process.cwd(), 'data');
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const UI_PATH = path.join(process.cwd(), 'public', 'index.html');

let cachedUi: string | null = null;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/output', express.static(OUTPUT_DIR));

// =====================================
// NEW WORKFLOW API ROUTES
// =====================================
app.use('/api/workflows', workflowsRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/videos', videosRouter);

// =====================================
// LEGACY JOB ENDPOINTS (for backward compatibility)
// =====================================
app.get('/api/jobs', (_req: Request, res: Response) => {
  try {
    res.json(listJobs());
  } catch (error) {
    res.status(500).json({ error: `Failed to list jobs: ${error}` });
  }
});

app.get('/api/jobs/:id', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

app.post('/api/jobs', (req: Request, res: Response) => {
  try {
    const body = req.body as CreateJobRequest;
    const job = createProcessingJob(body);
    res.status(202).json(job);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// =====================================
// LEGACY TRANSCRIPT ENDPOINTS (for backward compatibility)
// =====================================
app.get('/api/transcripts', (_req: Request, res: Response) => {
  try {
    const transcripts = loadAllTranscripts(DATA_DIR);
    res.json(transcripts);
  } catch (error) {
    res.status(500).json({ error: `Failed to load transcripts: ${error}` });
  }
});

app.get('/api/transcripts/:id', (req: Request, res: Response) => {
  try {
    const transcript = loadTranscript(req.params.id, DATA_DIR);
    if (!transcript) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }
    res.json(transcript);
  } catch (error) {
    res.status(500).json({ error: `Failed to load transcript: ${error}` });
  }
});

app.patch('/api/transcripts/:id/segments/:segmentId', (req: Request, res: Response) => {
  try {
    const { correctedText } = req.body as { correctedText: string };
    let transcript = loadTranscript(req.params.id, DATA_DIR);

    if (!transcript) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }

    transcript = updateTranscriptSegment(transcript, req.params.segmentId, correctedText);
    saveTranscript(transcript, DATA_DIR);
    res.json(transcript);
  } catch (error) {
    res.status(500).json({ error: `Failed to update segment: ${error}` });
  }
});

app.patch('/api/transcripts/:id/segments', (req: Request, res: Response) => {
  try {
    const { segments } = req.body as { segments: { id: string; correctedText: string }[] };
    let transcript = loadTranscript(req.params.id, DATA_DIR);

    if (!transcript) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }

    for (const seg of segments) {
      transcript = updateTranscriptSegment(transcript, seg.id, seg.correctedText);
    }
    saveTranscript(transcript, DATA_DIR);
    res.json(transcript);
  } catch (error) {
    res.status(500).json({ error: `Failed to update segments: ${error}` });
  }
});

app.post('/api/transcripts/:id/analyze', async (req: Request, res: Response) => {
  try {
    const { model, maxKeyFrames } = req.body as { model?: string; maxKeyFrames?: number };
    const transcript = loadTranscript(req.params.id, DATA_DIR);

    if (!transcript) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }

    const analysis = await analyzeTranscriptForKeyFrames(transcript, { model, maxKeyFrames });
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: `Failed to analyze transcript: ${error}` });
  }
});

app.post('/api/transcripts/:id/capture', async (req: Request, res: Response) => {
  try {
    const { keyFrames } = req.body as { keyFrames: KeyFrame[] };
    const transcript = loadTranscript(req.params.id, DATA_DIR);

    if (!transcript) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }

    const outputDir = path.join(OUTPUT_DIR, transcript.videoName);
    const results = await captureVideoFrames(transcript.videoPath, keyFrames, outputDir);
    generateCaptureReport(results, outputDir, transcript.videoName);

    res.json({
      success: true,
      outputDir,
      frameCount: results.length,
      frames: results,
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to capture frames: ${error}` });
  }
});

// =====================================
// HEALTH CHECK
// =====================================
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    features: {
      workflows: true,
      prompts: true,
      settings: true,
      videos: true,
      legacyJobs: true,
    },
  });
});

// =====================================
// UI ROUTES
// =====================================
app.get('/', (_req: Request, res: Response) => {
  res.send(getHtmlUI());
});

// =====================================
// ERROR HANDLER
// =====================================
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: err.message || 'Internal server error',
  });
});

function getHtmlUI(): string {
  // In development, don't cache
  if (process.env.NODE_ENV !== 'production') {
    cachedUi = null;
  }

  if (cachedUi) {
    return cachedUi;
  }

  try {
    cachedUi = fs.readFileSync(UI_PATH, 'utf-8');
    return cachedUi;
  } catch (error) {
    return `
      <!DOCTYPE html>
      <html>
        <head><title>Watcher Dashboard</title></head>
        <body style="font-family: sans-serif; background: #111; color: #eee; padding: 40px;">
          <h1>Dashboard not found</h1>
          <p>Create <code>${UI_PATH}</code> to customize the dashboard UI.</p>
          <pre>${String(error)}</pre>
        </body>
      </html>
    `;
  }
}

export function startServer(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  app.listen(PORT, () => {
    console.log(`\n?? Video KeyFrame Capturer Server v2.0`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`\n   New Workflow API:`);
    console.log(`   - Workflows: /api/workflows`);
    console.log(`   - Prompts: /api/prompts`);
    console.log(`   - Settings: /api/settings`);
    console.log(`   - Videos: /api/videos`);
    console.log(`\nPress Ctrl+C to stop\n`);
  });
}

if (require.main === module) {
  startServer();
}
