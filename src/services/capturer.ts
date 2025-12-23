import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { KeyFrame } from '../types';
import { formatTimestampForFilename } from './analyzer';

export interface CaptureOptions {
  width?: number;
  height?: number;
  fullPage?: boolean;
  quality?: number;
}

export interface CaptureResult {
  timestamp: number;
  screenshotPath: string;
  reason: string;
}

export class VideoFrameCapturer {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async initialize(options: { headless?: boolean } = {}): Promise<void> {
    this.browser = await chromium.launch({
      headless: options.headless ?? true,
    });
    this.page = await this.browser.newPage();
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async captureKeyFrames(
    videoPath: string,
    keyFrames: KeyFrame[],
    outputDir: string,
    options: CaptureOptions = {}
  ): Promise<CaptureResult[]> {
    if (!this.page) {
      throw new Error('Capturer not initialized. Call initialize() first.');
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert video path to file URL
    const absoluteVideoPath = path.resolve(videoPath);
    const videoUrl = `file:///${absoluteVideoPath.replace(/\\/g, '/')}`;

    // Set viewport size
    await this.page.setViewportSize({
      width: options.width || 1920,
      height: options.height || 1080,
    });

    // Create HTML page with video player
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            background: #000;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          video {
            max-width: 100%;
            max-height: 100vh;
            width: auto;
            height: auto;
          }
        </style>
      </head>
      <body>
        <video id="video" src="${videoUrl}" preload="auto"></video>
        <script>
          const video = document.getElementById('video');
          window.seekTo = (time) => {
            return new Promise((resolve) => {
              video.currentTime = time;
              video.onseeked = () => resolve(video.currentTime);
            });
          };
          window.getVideoInfo = () => ({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            currentTime: video.currentTime,
            readyState: video.readyState
          });
        </script>
      </body>
      </html>
    `;

    await this.page.setContent(htmlContent);

    // Wait for video to be ready
    await this.page.waitForFunction(`
      (function() {
        const video = document.getElementById('video');
        return video && video.readyState >= 2;
      })()
    `, { timeout: 30000 });

    const videoInfo = await this.page.evaluate(`
      (function() {
        return window.getVideoInfo();
      })()
    `) as { duration: number; width: number; height: number };
    console.log(`Video loaded: ${videoInfo.duration.toFixed(1)}s, ${videoInfo.width}x${videoInfo.height}`);

    const results: CaptureResult[] = [];

    for (let i = 0; i < keyFrames.length; i++) {
      const kf = keyFrames[i];
      console.log(`Capturing frame ${i + 1}/${keyFrames.length} at ${kf.timestamp.toFixed(1)}s: ${kf.reason}`);

      // Seek to timestamp
      await this.page.evaluate(`window.seekTo(${kf.timestamp})`);

      // Small delay to ensure frame is rendered
      await this.page.waitForTimeout(100);

      // Generate filename
      const filename = `frame_${formatTimestampForFilename(kf.timestamp)}.png`;
      const screenshotPath = path.join(outputDir, filename);

      // Capture screenshot
      const videoElement = await this.page.$('video');
      if (videoElement) {
        await videoElement.screenshot({
          path: screenshotPath,
          type: 'png',
        });
      } else {
        // Fallback to full page
        await this.page.screenshot({
          path: screenshotPath,
          type: 'png',
          fullPage: false,
        });
      }

      results.push({
        timestamp: kf.timestamp,
        screenshotPath,
        reason: kf.reason,
      });
    }

    return results;
  }

  async captureAtTimestamps(
    videoPath: string,
    timestamps: number[],
    outputDir: string,
    options: CaptureOptions = {}
  ): Promise<string[]> {
    const keyFrames: KeyFrame[] = timestamps.map((t, i) => ({
      timestamp: t,
      reason: `Manual capture ${i + 1}`,
      segmentId: '',
    }));

    const results = await this.captureKeyFrames(videoPath, keyFrames, outputDir, options);
    return results.map((r) => r.screenshotPath);
  }
}

export async function captureVideoFrames(
  videoPath: string,
  keyFrames: KeyFrame[],
  outputDir: string,
  options: CaptureOptions & { headless?: boolean } = {}
): Promise<CaptureResult[]> {
  const capturer = new VideoFrameCapturer();

  try {
    await capturer.initialize({ headless: options.headless });
    const results = await capturer.captureKeyFrames(videoPath, keyFrames, outputDir, options);
    return results;
  } finally {
    await capturer.close();
  }
}

export function generateCaptureReport(
  results: CaptureResult[],
  outputDir: string,
  videoName: string
): void {
  const reportPath = path.join(outputDir, 'capture_report.json');
  const report = {
    videoName,
    capturedAt: new Date().toISOString(),
    frameCount: results.length,
    frames: results.map((r) => ({
      timestamp: r.timestamp,
      timestampFormatted: formatTimestampForFilename(r.timestamp),
      filename: path.basename(r.screenshotPath),
      reason: r.reason,
    })),
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Capture report saved to: ${reportPath}`);

  // Also generate a simple HTML gallery
  const htmlPath = path.join(outputDir, 'gallery.html');
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Key Frames: ${videoName}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #1a1a1a; color: #fff; }
    h1 { border-bottom: 1px solid #333; padding-bottom: 10px; }
    .frame { margin: 20px 0; background: #2a2a2a; border-radius: 8px; overflow: hidden; }
    .frame img { width: 100%; display: block; }
    .frame-info { padding: 15px; }
    .timestamp { font-size: 14px; color: #888; }
    .reason { margin-top: 5px; }
  </style>
</head>
<body>
  <h1>Key Frames: ${videoName}</h1>
  <p>Captured ${results.length} frames on ${new Date().toLocaleString()}</p>
  ${results
    .map(
      (r) => `
    <div class="frame">
      <img src="${path.basename(r.screenshotPath)}" alt="Frame at ${r.timestamp}s">
      <div class="frame-info">
        <div class="timestamp">${formatTimestampForFilename(r.timestamp)} (${r.timestamp.toFixed(1)}s)</div>
        <div class="reason">${r.reason}</div>
      </div>
    </div>
  `
    )
    .join('')}
</body>
</html>
  `;

  fs.writeFileSync(htmlPath, htmlContent);
  console.log(`Gallery saved to: ${htmlPath}`);
}
