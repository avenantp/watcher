import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

export interface AudioExtractionResult {
  audioPath: string;
  duration: number;
}

export async function extractAudio(videoPath: string, outputDir: string): Promise<AudioExtractionResult> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(videoPath)) {
      reject(new Error(`Video file not found: ${videoPath}`));
      return;
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const videoName = path.basename(videoPath, path.extname(videoPath));
    const audioPath = path.join(outputDir, `${videoName}.mp3`);

    let duration = 0;

    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('codecData', (data) => {
        const timeParts = data.duration.split(':');
        if (timeParts.length === 3) {
          duration =
            parseFloat(timeParts[0]) * 3600 +
            parseFloat(timeParts[1]) * 60 +
            parseFloat(timeParts[2]);
        }
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\rExtracting audio: ${progress.percent.toFixed(1)}%`);
        }
      })
      .on('end', () => {
        console.log('\nAudio extraction complete');
        resolve({ audioPath, duration });
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg error: ${err.message}`));
      })
      .save(audioPath);
  });
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`FFprobe error: ${err.message}`));
        return;
      }
      resolve(metadata.format.duration || 0);
    });
  });
}

export async function captureFrameAtTime(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(new Error(`Frame capture error: ${err.message}`));
      })
      .save(outputPath);
  });
}
