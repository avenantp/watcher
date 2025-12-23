import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  deleteWorkflow,
  updateWorkflow,
  updateStepStatus,
  logWorkflowProgress,
  getWorkflowLogs,
  checkStepPrerequisites,
  getStepStatus,
  getAllStepStatuses,
  startWorkflow,
  pauseWorkflow,
  completeWorkflow,
  failWorkflow,
  getWorkflowOutputDir,
  getWorkflowTempDir,
  toPublicPath,
  DATA_DIR,
  OUTPUT_DIR,
  TEMP_DIR,
  VIDEO_STORAGE_DIR,
} from '../services/workflow';
import { Workflow, StepStatuses } from '../types/workflow';
import { extractAudio, getVideoDuration } from '../services/ffmpeg';
import { transcribeAudio, saveTranscript, TranscriptionOptions } from '../services/transcribe';
import { enhanceTranscript } from '../services/enhance';
import { captureVideoFrames, generateCaptureReport } from '../services/capturer';
import { saveTranscriptAsMarkdown } from '../services/markdown';
import { generateBlogPost } from '../services/blog';
import { generateSocialPosts } from '../services/social';
import { isYouTubeUrl, downloadYouTubeVideo, extractVideoId, findExistingVideo } from '../services/youtube';

const router = Router();

// Async handler wrapper
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// Create a new workflow
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { videoSource, config, enhancePromptId, blogPromptId, socialPromptId } = req.body;

    if (!videoSource || typeof videoSource !== 'string') {
      res.status(400).json({ error: 'videoSource is required' });
      return;
    }

    const workflow = await createWorkflow({
      videoSource: videoSource.trim(),
      config,
      enhancePromptId,
      blogPromptId,
      socialPromptId,
    });

    res.status(201).json(workflow);
  })
);

// List workflows
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = req.query.status as Workflow['status'] | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = await listWorkflows({ status, limit, offset });
    res.json(result);
  })
);

// Get a single workflow
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const workflow = await getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(workflow);
  })
);

// Delete a workflow
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteWorkflow(req.params.id);
    res.status(204).send();
  })
);

// Get all step statuses for a workflow
router.get(
  '/:id/steps',
  asyncHandler(async (req, res) => {
    const workflow = await getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(getAllStepStatuses(workflow));
  })
);

// Get step status
router.get(
  '/:id/steps/:step',
  asyncHandler(async (req, res) => {
    const workflow = await getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const step = parseInt(req.params.step, 10);
    if (isNaN(step) || step < 1 || step > 7) {
      res.status(400).json({ error: 'Invalid step number (1-7)' });
      return;
    }

    res.json(getStepStatus(workflow, step));
  })
);

// Execute a specific step
router.post(
  '/:id/steps/:step/execute',
  asyncHandler(async (req, res) => {
    const { force } = req.body;
    const step = parseInt(req.params.step, 10);

    if (isNaN(step) || step < 1 || step > 7) {
      res.status(400).json({ error: 'Invalid step number (1-7)' });
      return;
    }

    let workflow = await getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    // Check prerequisites
    const prereqCheck = checkStepPrerequisites(workflow, step);
    if (!prereqCheck.canExecute && !force) {
      res.status(400).json({
        error: `Cannot execute step ${step}: missing prerequisites`,
        missingPrerequisites: prereqCheck.missingPrerequisites,
      });
      return;
    }

    // Check if already completed (unless force)
    const currentStatus = workflow.stepStatuses[String(step) as keyof StepStatuses];
    if (currentStatus === 'completed' && !force) {
      res.status(400).json({ error: 'Step already completed. Use force=true to re-run.' });
      return;
    }

    // Mark step as in progress
    workflow = await updateStepStatus(req.params.id, step, 'in_progress');
    await logWorkflowProgress(workflow.id, step, 'in_progress', `Starting step ${step}`);

    try {
      // Execute the step
      let stepOutput: unknown;

      switch (step) {
        case 1:
          stepOutput = await executeStep1(workflow);
          break;
        case 2:
          stepOutput = await executeStep2(workflow);
          break;
        case 3:
          stepOutput = await executeStep3(workflow);
          break;
        case 4:
          stepOutput = await executeStep4(workflow);
          break;
        case 5:
          stepOutput = await executeStep5(workflow);
          break;
        case 6:
          stepOutput = await executeStep6(workflow);
          break;
        case 7:
          stepOutput = await executeStep7(workflow);
          break;
      }

      // Update workflow with output and mark complete
      const outputKey = `step${step}Output` as keyof typeof workflow;
      workflow = await updateWorkflow(req.params.id, {
        [outputKey]: stepOutput,
      });
      workflow = await updateStepStatus(req.params.id, step, 'completed');
      await logWorkflowProgress(workflow.id, step, 'completed', `Step ${step} completed`);

      // Check if all steps are complete
      const allComplete = Object.values(workflow.stepStatuses).every(
        (s) => s === 'completed' || s === 'skipped'
      );
      if (allComplete) {
        workflow = await completeWorkflow(req.params.id);
      }

      res.json({
        success: true,
        workflow,
        stepOutput,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateStepStatus(req.params.id, step, 'error');
      await logWorkflowProgress(workflow.id, step, 'error', message);
      await failWorkflow(req.params.id, message);

      res.status(500).json({
        success: false,
        error: message,
      });
    }
  })
);

// Start/resume workflow
router.post(
  '/:id/start',
  asyncHandler(async (req, res) => {
    const { fromStep } = req.body;
    const workflow = await startWorkflow(req.params.id, fromStep);
    res.json(workflow);
  })
);

// Pause workflow
router.post(
  '/:id/pause',
  asyncHandler(async (req, res) => {
    const workflow = await pauseWorkflow(req.params.id);
    res.json(workflow);
  })
);

// Get workflow logs
router.get(
  '/:id/logs',
  asyncHandler(async (req, res) => {
    const step = req.query.step ? parseInt(req.query.step as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    const logs = await getWorkflowLogs(req.params.id, { step, limit });
    res.json({ logs });
  })
);

// Step execution functions
async function executeStep1(workflow: Workflow): Promise<unknown> {
  const source = workflow.videoSource.trim();
  const isRemote = /^https?:\/\//i.test(source);

  if (!isRemote) {
    // Local file
    const absolutePath = path.resolve(source);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Video file not found: ${absolutePath}`);
    }

    const stats = await fs.promises.stat(absolutePath);
    const duration = await getVideoDuration(absolutePath);
    const videoName = path.basename(absolutePath, path.extname(absolutePath));

    await updateWorkflow(workflow.id, {
      videoPath: absolutePath,
      videoName,
    });

    return {
      videoPath: absolutePath,
      duration,
      fileSize: stats.size,
      downloadedAt: new Date().toISOString(),
      alreadyExisted: true,
    };
  }

  // Remote source
  await fs.promises.mkdir(VIDEO_STORAGE_DIR, { recursive: true });

  if (isYouTubeUrl(source)) {
    const videoId = extractVideoId(source);
    const existingPath = videoId ? findExistingVideo(videoId, VIDEO_STORAGE_DIR) : null;

    if (existingPath) {
      const stats = await fs.promises.stat(existingPath);
      const duration = await getVideoDuration(existingPath);
      const videoName = path.basename(existingPath, '.mp4');

      await updateWorkflow(workflow.id, {
        videoPath: existingPath,
        videoName,
        videoId: videoId || undefined,
      });

      return {
        videoPath: existingPath,
        duration,
        fileSize: stats.size,
        videoId,
        downloadedAt: new Date().toISOString(),
        alreadyExisted: true,
      };
    }

    // Download YouTube video
    const result = await downloadYouTubeVideo(source, VIDEO_STORAGE_DIR);
    const stats = await fs.promises.stat(result.videoPath);
    const duration = await getVideoDuration(result.videoPath);

    await updateWorkflow(workflow.id, {
      videoPath: result.videoPath,
      videoName: result.title,
      videoId: result.videoId,
    });

    return {
      videoPath: result.videoPath,
      duration,
      fileSize: stats.size,
      videoId: result.videoId,
      downloadedAt: new Date().toISOString(),
      alreadyExisted: false,
    };
  }

  // Direct URL download
  const url = new URL(source);
  const ext = path.extname(url.pathname) || '.mp4';
  const baseName = path.basename(url.pathname, ext) || `video-${workflow.id}`;
  const sanitizedName = baseName.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  const destination = path.join(VIDEO_STORAGE_DIR, `${sanitizedName}${ext}`);

  const response = await fetch(source);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download video (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.promises.writeFile(destination, Buffer.from(arrayBuffer));

  const stats = await fs.promises.stat(destination);
  const duration = await getVideoDuration(destination);

  await updateWorkflow(workflow.id, {
    videoPath: destination,
    videoName: sanitizedName,
  });

  return {
    videoPath: destination,
    duration,
    fileSize: stats.size,
    downloadedAt: new Date().toISOString(),
    alreadyExisted: false,
  };
}

async function executeStep2(workflow: Workflow): Promise<unknown> {
  if (!workflow.videoPath) {
    throw new Error('No video path available. Run step 1 first.');
  }

  const tempDir = getWorkflowTempDir(workflow.id);
  await fs.promises.mkdir(tempDir, { recursive: true });

  try {
    // Extract audio
    const { audioPath, duration } = await extractAudio(workflow.videoPath, tempDir);

    // Transcribe
    const config = workflow.config || {};
    const transcriptionOptions: TranscriptionOptions = {
      provider: config.provider || 'whisper-local',
      model: config.model,
      language: config.language,
    };

    const transcript = await transcribeAudio(audioPath, workflow.videoPath, transcriptionOptions);

    // Save transcript to data directory
    saveTranscript(transcript, DATA_DIR);

    return {
      transcriptId: transcript.id,
      segments: transcript.segments,
      audioPath,
      provider: transcriptionOptions.provider,
      transcribedAt: new Date().toISOString(),
    };
  } finally {
    // Cleanup temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to cleanup temp directory:', e);
    }
  }
}

async function executeStep3(workflow: Workflow): Promise<unknown> {
  if (!workflow.step2Output) {
    throw new Error('No transcript available. Run step 2 first.');
  }

  // Load transcript from file
  const transcriptPath = path.join(DATA_DIR, `${workflow.step2Output.transcriptId}.json`);
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`);
  }

  const transcript = JSON.parse(await fs.promises.readFile(transcriptPath, 'utf-8'));

  const result = await enhanceTranscript(transcript, {
    promptId: workflow.enhancePromptId || undefined,
    maxKeyFrames: workflow.config?.maxKeyFrames,
  });

  return result;
}

async function executeStep4(workflow: Workflow): Promise<unknown> {
  if (!workflow.step3Output || !workflow.videoPath || !workflow.videoName) {
    throw new Error('Missing prerequisites. Run steps 1-3 first.');
  }

  const outputDir = getWorkflowOutputDir(workflow.videoName);
  await fs.promises.mkdir(outputDir, { recursive: true });

  const keyFrames = workflow.step3Output.keyFrames;

  if (keyFrames.length === 0) {
    return {
      screenshots: [],
      outputDir,
      galleryUrl: '',
      capturedAt: new Date().toISOString(),
    };
  }

  const captureResults = await captureVideoFrames(
    workflow.videoPath,
    keyFrames,
    outputDir,
    workflow.config?.capture
  );

  generateCaptureReport(captureResults, outputDir, workflow.videoName);

  const galleryPath = path.join(outputDir, 'gallery.html');
  const galleryUrl = fs.existsSync(galleryPath) ? toPublicPath(galleryPath) : '';

  return {
    screenshots: captureResults.map((r) => ({
      timestamp: r.timestamp,
      reason: r.reason,
      path: r.screenshotPath,
      publicPath: toPublicPath(r.screenshotPath),
    })),
    outputDir,
    galleryUrl,
    capturedAt: new Date().toISOString(),
  };
}

async function executeStep5(workflow: Workflow): Promise<unknown> {
  if (!workflow.step2Output || !workflow.videoName) {
    throw new Error('Missing prerequisites. Run steps 1-2 first.');
  }

  const outputDir = getWorkflowOutputDir(workflow.videoName);

  const result = await saveTranscriptAsMarkdown(workflow.step2Output, {
    videoName: workflow.videoName,
    outputDir,
    includeEnhanced: !!workflow.step3Output,
    step3Output: workflow.step3Output || undefined,
  });

  return result;
}

async function executeStep6(workflow: Workflow): Promise<unknown> {
  if (!workflow.step3Output || !workflow.step4Output || !workflow.videoName) {
    throw new Error('Missing prerequisites. Run steps 1-4 first.');
  }

  const outputDir = getWorkflowOutputDir(workflow.videoName);

  const result = await generateBlogPost(workflow.step3Output, workflow.step4Output, {
    promptId: workflow.blogPromptId || undefined,
    videoName: workflow.videoName,
    outputDir,
  });

  return result;
}

async function executeStep7(workflow: Workflow): Promise<unknown> {
  if (!workflow.step3Output || !workflow.videoName) {
    throw new Error('Missing prerequisites. Run steps 1-3 first.');
  }

  const outputDir = getWorkflowOutputDir(workflow.videoName);

  const result = await generateSocialPosts(workflow.step3Output, {
    promptId: workflow.socialPromptId || undefined,
    videoName: workflow.videoName,
    outputDir,
  });

  return result;
}

export default router;
