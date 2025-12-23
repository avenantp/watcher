import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const YOUTUBE_PATTERNS = [
  /^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+/i,
  /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/[\w-]+/i,
  /^https?:\/\/youtu\.be\/[\w-]+/i,
  /^https?:\/\/(?:www\.)?youtube\.com\/embed\/[\w-]+/i,
  /^https?:\/\/(?:www\.)?youtube\.com\/v\/[\w-]+/i,
];

export function isYouTubeUrl(url: string): boolean {
  const trimmed = url.trim();
  return YOUTUBE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function extractVideoId(url: string): string | null {
  const trimmed = url.trim();

  // youtu.be/VIDEO_ID
  const shortMatch = trimmed.match(/youtu\.be\/([\w-]+)/);
  if (shortMatch) return shortMatch[1];

  // youtube.com/watch?v=VIDEO_ID
  const watchMatch = trimmed.match(/[?&]v=([\w-]+)/);
  if (watchMatch) return watchMatch[1];

  // youtube.com/shorts/VIDEO_ID
  const shortsMatch = trimmed.match(/\/shorts\/([\w-]+)/);
  if (shortsMatch) return shortsMatch[1];

  // youtube.com/embed/VIDEO_ID or /v/VIDEO_ID
  const embedMatch = trimmed.match(/\/(?:embed|v)\/([\w-]+)/);
  if (embedMatch) return embedMatch[1];

  return null;
}

export interface YouTubeDownloadResult {
  videoPath: string;
  title: string;
  videoId: string;
}

export interface YouTubeDownloadProgress {
  percent: number;
  speed: string;
  eta: string;
}

/**
 * Find an existing video file by video ID in the output directory.
 * Videos are stored with the video ID embedded in a metadata comment or filename pattern.
 */
export function findExistingVideo(videoId: string, outputDir: string): string | null {
  if (!fs.existsSync(outputDir)) {
    return null;
  }

  const files = fs.readdirSync(outputDir);

  // Look for .mp4 files and check if they match this video ID
  // We store a .meta file alongside each video with the video ID
  for (const file of files) {
    if (file.endsWith('.mp4')) {
      const metaPath = path.join(outputDir, file.replace('.mp4', '.meta'));
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.videoId === videoId) {
            return path.join(outputDir, file);
          }
        } catch {
          // Ignore invalid meta files
        }
      }
    }
  }

  return null;
}

export async function downloadYouTubeVideo(
  url: string,
  outputDir: string,
  onProgress?: (progress: YouTubeDownloadProgress) => void
): Promise<YouTubeDownloadResult> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`Could not extract video ID from URL: ${url}`);
  }

  await fs.promises.mkdir(outputDir, { recursive: true });

  // Check if this video has already been downloaded
  const existingPath = findExistingVideo(videoId, outputDir);
  if (existingPath) {
    // Read the metadata to get the title
    const metaPath = existingPath.replace('.mp4', '.meta');
    let title = videoId;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        title = meta.title || videoId;
      } catch {
        // Use videoId as fallback
      }
    }
    return {
      videoPath: existingPath,
      title,
      videoId,
      alreadyExists: true,
    } as YouTubeDownloadResult & { alreadyExists: boolean };
  }

  // Get the video title
  const title = await getVideoTitle(url);
  const sanitizedTitle = sanitizeFilename(title || videoId);

  // Generate unique filename
  let outputPath = path.join(outputDir, `${sanitizedTitle}.mp4`);
  let counter = 1;
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(outputDir, `${sanitizedTitle}-${counter++}.mp4`);
  }

  // Download the video using yt-dlp
  await runYtDlp(url, outputPath, onProgress);

  // Save metadata for future lookups
  const metaPath = outputPath.replace('.mp4', '.meta');
  fs.writeFileSync(metaPath, JSON.stringify({
    videoId,
    title: title || videoId,
    url,
    downloadedAt: new Date().toISOString(),
  }, null, 2));

  return {
    videoPath: outputPath,
    title: title || videoId,
    videoId,
  };
}

async function getVideoTitle(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', ['--get-title', '--no-warnings', url], {
      shell: true,
    });

    let output = '';
    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        resolve(null);
      }
    });

    ytdlp.on('error', () => {
      resolve(null);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      ytdlp.kill();
      resolve(null);
    }, 30000);
  });
}

async function runYtDlp(
  url: string,
  outputPath: string,
  onProgress?: (progress: YouTubeDownloadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outputPath,
      '--no-playlist',
      '--no-warnings',
      '--progress',
      url,
    ];

    const ytdlp = spawn('yt-dlp', args, {
      shell: true,
    });

    let stderr = '';

    ytdlp.stdout.on('data', (data) => {
      const output = data.toString();

      // Parse progress from yt-dlp output
      // Example: [download]  45.2% of 50.00MiB at 2.50MiB/s ETA 00:10
      const progressMatch = output.match(/\[download\]\s+([\d.]+)%.*?at\s+([\d.]+\w+\/s).*?ETA\s+(\S+)/);
      if (progressMatch && onProgress) {
        onProgress({
          percent: parseFloat(progressMatch[1]),
          speed: progressMatch[2],
          eta: progressMatch[3],
        });
      }
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0) {
        // Verify the file exists
        if (fs.existsSync(outputPath)) {
          resolve();
        } else {
          reject(new Error(`Download completed but file not found: ${outputPath}`));
        }
      } else {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
      }
    });

    ytdlp.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}. Make sure yt-dlp is installed.`));
    });
  });
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .substring(0, 200); // Limit length
}
