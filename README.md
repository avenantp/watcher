# Video KeyFrame Capturer

Extract key frames from videos based on AI-analyzed transcripts. This tool:

1. Extracts audio from video files using FFmpeg
2. Transcribes audio using Whisper (via Groq, OpenAI, or local)
3. Provides a UI to correct transcription errors (especially technical terms)
4. Uses AI to analyze the transcript and identify key moments
5. Captures screenshots at those key moments using Playwright

## Prerequisites

- **Node.js** 18+
- **FFmpeg** installed and in PATH
- **API Keys** (at least one):
  - `GROQ_API_KEY` - For fast Whisper transcription via Groq
  - `OPENROUTER_API_KEY` - For AI analysis (Claude, GPT-4, etc.)
  - `OPENAI_API_KEY` - Alternative for transcription

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
OPENROUTER_API_KEY=your_openrouter_key
GROQ_API_KEY=your_groq_key  # Optional, for transcription
```

## Usage

### Complete Workflow

```bash
# Step 1: Process video (extract audio + transcribe)
npm run process -- --video path/to/video.mp4

# Step 2: Start correction UI to review/fix transcript
npm run server

# Step 3: Open http://localhost:3000
# - Review and correct technical terms in the transcript
# - Click "Analyze for Key Frames" to detect important moments
# - Click "Capture Screenshots" to generate images
```

### CLI Commands

```bash
# Process a video file
npm run process -- --video <path> [--provider groq|openai|whisper-local]

# List all transcripts
npm run dev -- list

# Analyze transcript for key frames (without UI)
npm run dev -- analyze --transcript <id>

# Capture screenshots (without UI)
npm run dev -- capture --transcript <id>

# Start the correction UI server
npm run dev -- server --port 3000
```

### Transcription Providers

- **groq** (default): Fast Whisper via Groq API - requires `GROQ_API_KEY`
- **openai**: OpenAI Whisper API - requires `OPENAI_API_KEY`
- **whisper-local**: Local Whisper - requires `pip install openai-whisper`

## Project Structure

```
src/
  index.ts           # CLI entry point
  server.ts          # Express server + correction UI
  services/
    ffmpeg.ts        # Audio extraction
    openrouter.ts    # OpenRouter API client
    transcribe.ts    # Transcription (Groq/OpenAI/local)
    analyzer.ts      # AI key frame detection
    capturer.ts      # Playwright screenshot capture
  types/
    index.ts         # TypeScript interfaces

data/                # Stored transcripts (JSON)
output/              # Captured screenshots
temp/                # Extracted audio files
```

## Output

Screenshots are saved to `output/<video-name>/` with:
- Individual PNG files named by timestamp
- `capture_report.json` with metadata
- `gallery.html` for viewing all captures

## Tips for Better Results

1. **Correct technical terms** in the transcript before analysis - the AI uses the transcript to understand context
2. **Add domain-specific vocabulary** to help with consistent corrections
3. **Review key frames** in the UI before capturing - you can remove irrelevant ones
4. For long videos, consider the `--max-frames` option during analysis
