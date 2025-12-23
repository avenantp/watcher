import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { extractAudio } from './services/ffmpeg';
import { transcribeAudio, saveTranscript, loadTranscript, TranscriptionOptions } from './services/transcribe';
import { analyzeTranscriptForKeyFrames } from './services/analyzer';
import { captureVideoFrames, generateCaptureReport } from './services/capturer';
import { startServer } from './server';

dotenv.config();

const program = new Command();
const DATA_DIR = path.join(process.cwd(), 'data');

program
  .name('video-keyframe-capturer')
  .description('Extract key frames from videos based on AI-analyzed transcripts')
  .version('1.0.0');

program
  .command('process')
  .description('Process a video file: extract audio, transcribe, and prepare for correction')
  .requiredOption('-v, --video <path>', 'Path to the video file')
  .option('-p, --provider <provider>', 'Transcription provider: whisper-local, openai, groq', 'whisper-local')
  .option('-m, --model <model>', 'Transcription model to use')
  .option('-l, --language <lang>', 'Language code (e.g., en, es, fr)')
  .action(async (options) => {
    try {
      const videoPath = path.resolve(options.video);
      console.log(`\n🎬 Processing video: ${videoPath}\n`);

      if (!fs.existsSync(videoPath)) {
        console.error(`Error: Video file not found: ${videoPath}`);
        process.exit(1);
      }

      // Create directories
      const videoName = path.basename(videoPath, path.extname(videoPath));
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Step 1: Extract audio
      console.log('📢 Step 1: Extracting audio...');
      const { audioPath } = await extractAudio(videoPath, tempDir);
      console.log(`   Audio saved to: ${audioPath}\n`);

      // Step 2: Transcribe
      console.log('📝 Step 2: Transcribing audio...');
      const transcriptionOptions: TranscriptionOptions = {
        provider: options.provider as 'whisper-local' | 'openai' | 'groq',
        model: options.model,
        language: options.language,
      };
      const transcript = await transcribeAudio(audioPath, videoPath, transcriptionOptions);
      console.log(`   Transcribed ${transcript.segments.length} segments\n`);

      // Save transcript
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      saveTranscript(transcript, DATA_DIR);
      console.log(`   Transcript saved with ID: ${transcript.id}\n`);

      console.log('✅ Processing complete!\n');
      console.log('Next steps:');
      console.log(`   1. Start the correction UI: npm run server`);
      console.log(`   2. Open http://localhost:3000 to review and correct the transcript`);
      console.log(`   3. Click "Analyze for Key Frames" to detect key moments`);
      console.log(`   4. Click "Capture Screenshots" to generate images\n`);
      console.log(`Or use the CLI to analyze directly:`);
      console.log(`   npm run process -- analyze --transcript ${transcript.id}\n`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze a transcript to detect key frames')
  .requiredOption('-t, --transcript <id>', 'Transcript ID')
  .option('-m, --model <model>', 'AI model for analysis', 'anthropic/claude-3.5-sonnet')
  .option('--max-frames <number>', 'Maximum number of key frames', parseInt)
  .action(async (options) => {
    try {
      console.log(`\n🔍 Analyzing transcript: ${options.transcript}\n`);

      const transcript = loadTranscript(options.transcript, DATA_DIR);
      if (!transcript) {
        console.error(`Error: Transcript not found: ${options.transcript}`);
        process.exit(1);
      }

      const analysis = await analyzeTranscriptForKeyFrames(transcript, {
        model: options.model,
        maxKeyFrames: options.maxFrames,
      });

      console.log(`\n📍 Detected ${analysis.keyFrames.length} key frames:\n`);
      analysis.keyFrames.forEach((kf, i) => {
        const mins = Math.floor(kf.timestamp / 60);
        const secs = Math.floor(kf.timestamp % 60);
        console.log(`   ${i + 1}. [${mins}:${secs.toString().padStart(2, '0')}] ${kf.reason}`);
      });

      // Save analysis
      const analysisPath = path.join(DATA_DIR, `${transcript.id}_analysis.json`);
      fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
      console.log(`\n   Analysis saved to: ${analysisPath}\n`);

      console.log('To capture screenshots:');
      console.log(`   npm run process -- capture --transcript ${transcript.id}\n`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('capture')
  .description('Capture screenshots at key frame timestamps')
  .requiredOption('-t, --transcript <id>', 'Transcript ID')
  .option('--headless', 'Run browser in headless mode', true)
  .option('--width <pixels>', 'Viewport width', parseInt, 1920)
  .option('--height <pixels>', 'Viewport height', parseInt, 1080)
  .action(async (options) => {
    try {
      console.log(`\n📸 Capturing key frames for: ${options.transcript}\n`);

      const transcript = loadTranscript(options.transcript, DATA_DIR);
      if (!transcript) {
        console.error(`Error: Transcript not found: ${options.transcript}`);
        process.exit(1);
      }

      // Load analysis
      const analysisPath = path.join(DATA_DIR, `${transcript.id}_analysis.json`);
      if (!fs.existsSync(analysisPath)) {
        console.error('Error: Analysis not found. Run analyze command first.');
        process.exit(1);
      }
      const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));

      // Capture frames
      const outputDir = path.join(process.cwd(), 'output', transcript.videoName);
      const results = await captureVideoFrames(transcript.videoPath, analysis.keyFrames, outputDir, {
        headless: options.headless,
        width: options.width,
        height: options.height,
      });

      generateCaptureReport(results, outputDir, transcript.videoName);

      console.log(`\n✅ Captured ${results.length} frames to: ${outputDir}\n`);
      console.log(`   Open ${path.join(outputDir, 'gallery.html')} to view the results\n`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('server')
  .description('Start the correction UI server')
  .option('-p, --port <number>', 'Port number', '3000')
  .action((options) => {
    process.env.PORT = options.port;
    startServer();
  });

program
  .command('list')
  .description('List all transcripts')
  .action(() => {
    if (!fs.existsSync(DATA_DIR)) {
      console.log('\nNo transcripts found.\n');
      return;
    }

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.includes('_analysis'));
    if (files.length === 0) {
      console.log('\nNo transcripts found.\n');
      return;
    }

    console.log('\n📋 Transcripts:\n');
    files.forEach(f => {
      const transcript = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      console.log(`   ID: ${transcript.id}`);
      console.log(`   Video: ${transcript.videoName}`);
      console.log(`   Segments: ${transcript.segments.length}`);
      console.log(`   Updated: ${new Date(transcript.updatedAt).toLocaleString()}`);
      console.log('');
    });
  });

// Default to process command with --video
program
  .option('-v, --video <path>', 'Path to the video file (shorthand for process command)')
  .action(async (options) => {
    if (options.video) {
      await program.parseAsync(['node', 'index', 'process', '--video', options.video]);
    } else {
      program.help();
    }
  });

program.parse();
