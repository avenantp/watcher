import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { VIDEO_STORAGE_DIR } from '../services/workflow';
import { listWorkflows } from '../services/workflow';

const router = Router();

// Async handler wrapper
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

interface VideoInfo {
  path: string;
  name: string;
  size: number;
  downloadedAt: string;
  videoId?: string;
  title?: string;
  hasWorkflow: boolean;
  workflowId?: string;
}

// List all downloaded videos
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Ensure directory exists
    if (!fs.existsSync(VIDEO_STORAGE_DIR)) {
      await fs.promises.mkdir(VIDEO_STORAGE_DIR, { recursive: true });
      res.json({ videos: [] });
      return;
    }

    const files = await fs.promises.readdir(VIDEO_STORAGE_DIR);
    const videoFiles = files.filter((f) => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));

    // Get all workflows to check associations
    const { workflows } = await listWorkflows({ limit: 1000 });
    const workflowsByPath = new Map<string, string>();
    for (const wf of workflows) {
      if (wf.videoPath) {
        workflowsByPath.set(wf.videoPath, wf.id);
      }
    }

    const videos: VideoInfo[] = [];

    for (const file of videoFiles) {
      const filePath = path.join(VIDEO_STORAGE_DIR, file);
      const stats = await fs.promises.stat(filePath);
      const name = path.basename(file, path.extname(file));

      // Check for metadata file
      const metaPath = filePath.replace(/\.(mp4|mkv|webm)$/, '.meta');
      let videoId: string | undefined;
      let title: string | undefined;
      let downloadedAt = stats.mtime.toISOString();

      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
          videoId = meta.videoId;
          title = meta.title;
          downloadedAt = meta.downloadedAt || downloadedAt;
        } catch {
          // Ignore invalid meta files
        }
      }

      const workflowId = workflowsByPath.get(filePath);

      videos.push({
        path: filePath,
        name,
        size: stats.size,
        downloadedAt,
        videoId,
        title,
        hasWorkflow: !!workflowId,
        workflowId,
      });
    }

    // Sort by download date, newest first
    videos.sort((a, b) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime());

    res.json({ videos });
  })
);

// Get a specific video info
router.get(
  '/:name',
  asyncHandler(async (req, res) => {
    const name = req.params.name;

    // Try to find the video with various extensions
    const extensions = ['.mp4', '.mkv', '.webm'];
    let filePath: string | null = null;

    for (const ext of extensions) {
      const candidate = path.join(VIDEO_STORAGE_DIR, `${name}${ext}`);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }

    if (!filePath) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const stats = await fs.promises.stat(filePath);

    // Check for metadata file
    const metaPath = filePath.replace(/\.(mp4|mkv|webm)$/, '.meta');
    let videoId: string | undefined;
    let title: string | undefined;
    let downloadedAt = stats.mtime.toISOString();
    let sourceUrl: string | undefined;

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
        videoId = meta.videoId;
        title = meta.title;
        downloadedAt = meta.downloadedAt || downloadedAt;
        sourceUrl = meta.url;
      } catch {
        // Ignore invalid meta files
      }
    }

    // Find associated workflows
    const { workflows } = await listWorkflows({ limit: 1000 });
    const associatedWorkflows = workflows.filter((wf) => wf.videoPath === filePath);

    res.json({
      path: filePath,
      name,
      size: stats.size,
      downloadedAt,
      videoId,
      title,
      sourceUrl,
      workflows: associatedWorkflows.map((wf) => ({
        id: wf.id,
        status: wf.status,
        currentStep: wf.currentStep,
        createdAt: wf.createdAt,
      })),
    });
  })
);

// Delete a video and optionally its workflows
router.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const name = req.params.name;
    const deleteWorkflows = req.query.deleteWorkflows === 'true';

    // Try to find the video with various extensions
    const extensions = ['.mp4', '.mkv', '.webm'];
    let filePath: string | null = null;

    for (const ext of extensions) {
      const candidate = path.join(VIDEO_STORAGE_DIR, `${name}${ext}`);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }

    if (!filePath) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Find associated workflows
    if (deleteWorkflows) {
      const { workflows } = await listWorkflows({ limit: 1000 });
      const associatedWorkflows = workflows.filter((wf) => wf.videoPath === filePath);

      // Import deleteWorkflow function
      const { deleteWorkflow } = await import('../services/workflow');

      for (const wf of associatedWorkflows) {
        await deleteWorkflow(wf.id);
      }
    }

    // Delete the video file
    await fs.promises.unlink(filePath);

    // Delete metadata file if exists
    const metaPath = filePath.replace(/\.(mp4|mkv|webm)$/, '.meta');
    if (fs.existsSync(metaPath)) {
      await fs.promises.unlink(metaPath);
    }

    res.status(204).send();
  })
);

// Get video file size formatted
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default router;
