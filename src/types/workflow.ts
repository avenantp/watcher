import { TranscriptSegment, KeyFrame } from './index';

// Step status
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped';

// Workflow overall status
export type WorkflowStatus = 'created' | 'in_progress' | 'paused' | 'completed' | 'error';

// Prompt types
export type PromptType = 'enhance' | 'blog' | 'social';

// Step 1: Download Video
export interface Step1Output {
  videoPath: string;
  duration: number;
  fileSize: number;
  videoId?: string;
  downloadedAt: string;
  alreadyExisted: boolean;
}

// Step 2: Extract & Transcribe
export interface Step2Output {
  transcriptId: string;
  segments: TranscriptSegment[];
  audioPath: string;
  provider: string;
  transcribedAt: string;
}

// Step 3: Enhance Transcript
export interface Step3Output {
  enhancedTranscript: string;
  sections: Array<{ title: string; startTime: number; endTime: number }>;
  keyFrames: KeyFrame[];
  promptId: string;
  enhancedAt: string;
}

// Step 4: Capture Screenshots
export interface Step4Output {
  screenshots: Array<{
    timestamp: number;
    reason: string;
    path: string;
    publicPath: string;
  }>;
  outputDir: string;
  galleryUrl: string;
  capturedAt: string;
}

// Step 5: Save Transcript as Markdown
export interface Step5Output {
  markdownPath: string;
  markdownUrl: string;
  savedAt: string;
}

// Step 6: Generate Blog
export interface Step6Output {
  blogPath: string;
  blogUrl: string;
  promptId: string;
  generatedAt: string;
}

// Step 7: Generate Social Posts
export interface Step7Output {
  posts: {
    twitter: string[];
    linkedin: string;
    shortForm: string[];
  };
  socialJsonPath: string;
  promptId: string;
  generatedAt: string;
}

// Workflow configuration
export interface WorkflowConfig {
  provider?: 'whisper-local' | 'openai' | 'groq';
  model?: string;
  language?: string;
  maxKeyFrames?: number;
  capture?: {
    headless?: boolean;
    width?: number;
    height?: number;
  };
}

// Step statuses map
export interface StepStatuses {
  '1': StepStatus;
  '2': StepStatus;
  '3': StepStatus;
  '4': StepStatus;
  '5': StepStatus;
  '6': StepStatus;
  '7': StepStatus;
}

// Main workflow interface
export interface Workflow {
  id: string;
  videoSource: string;
  videoPath: string | null;
  videoName: string | null;
  videoId: string | null;

  status: WorkflowStatus;
  currentStep: number;
  errorMessage: string | null;

  stepStatuses: StepStatuses;

  step1Output: Step1Output | null;
  step2Output: Step2Output | null;
  step3Output: Step3Output | null;
  step4Output: Step4Output | null;
  step5Output: Step5Output | null;
  step6Output: Step6Output | null;
  step7Output: Step7Output | null;

  config: WorkflowConfig;

  enhancePromptId: string | null;
  blogPromptId: string | null;
  socialPromptId: string | null;

  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// Prompt interface
export interface Prompt {
  id: string;
  name: string;
  type: PromptType;
  description: string | null;
  systemPrompt: string;
  userPromptTemplate: string;
  model: string;
  temperature: number;
  maxTokens: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Settings interface
export interface Setting {
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  updatedAt: string;
}

// Workflow log interface
export interface WorkflowLog {
  id: string;
  workflowId: string;
  step: number;
  status: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Step definition for state machine
export interface StepDefinition {
  step: number;
  name: string;
  description: string;
  prerequisites: number[];
}

// Step execution context
export interface StepContext {
  workflowId: string;
  onProgress: (message: string, metadata?: Record<string, unknown>) => Promise<void>;
}

// Database row types (snake_case for Supabase)
export interface WorkflowRow {
  id: string;
  video_source: string;
  video_path: string | null;
  video_name: string | null;
  video_id: string | null;
  status: WorkflowStatus;
  current_step: number;
  error_message: string | null;
  step_statuses: StepStatuses;
  step_1_output: Step1Output | null;
  step_2_output: Step2Output | null;
  step_3_output: Step3Output | null;
  step_4_output: Step4Output | null;
  step_5_output: Step5Output | null;
  step_6_output: Step6Output | null;
  step_7_output: Step7Output | null;
  config: WorkflowConfig;
  enhance_prompt_id: string | null;
  blog_prompt_id: string | null;
  social_prompt_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface PromptRow {
  id: string;
  name: string;
  type: PromptType;
  description: string | null;
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SettingRow {
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  updated_at: string;
}

export interface WorkflowLogRow {
  id: string;
  workflow_id: string;
  step: number;
  status: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// Conversion helpers
export function workflowRowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    videoSource: row.video_source,
    videoPath: row.video_path,
    videoName: row.video_name,
    videoId: row.video_id,
    status: row.status,
    currentStep: row.current_step,
    errorMessage: row.error_message,
    stepStatuses: row.step_statuses,
    step1Output: row.step_1_output,
    step2Output: row.step_2_output,
    step3Output: row.step_3_output,
    step4Output: row.step_4_output,
    step5Output: row.step_5_output,
    step6Output: row.step_6_output,
    step7Output: row.step_7_output,
    config: row.config,
    enhancePromptId: row.enhance_prompt_id,
    blogPromptId: row.blog_prompt_id,
    socialPromptId: row.social_prompt_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function promptRowToPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function workflowLogRowToWorkflowLog(row: WorkflowLogRow): WorkflowLog {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    step: row.step,
    status: row.status,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

// Step definitions with prerequisites
export const STEP_DEFINITIONS: StepDefinition[] = [
  {
    step: 1,
    name: 'Download Video',
    description: 'Download video from YouTube or URL',
    prerequisites: [],
  },
  {
    step: 2,
    name: 'Extract & Transcribe',
    description: 'Extract audio and transcribe via Whisper',
    prerequisites: [1],
  },
  {
    step: 3,
    name: 'Enhance Transcript',
    description: 'AI-enhance transcript and identify key frames',
    prerequisites: [2],
  },
  {
    step: 4,
    name: 'Capture Screenshots',
    description: 'Capture screenshots at key timestamps',
    prerequisites: [3],
  },
  {
    step: 5,
    name: 'Save Transcript',
    description: 'Export transcript as markdown',
    prerequisites: [3],
  },
  {
    step: 6,
    name: 'Generate Blog',
    description: 'AI-generate blog post with screenshots',
    prerequisites: [3, 4],
  },
  {
    step: 7,
    name: 'Generate Social',
    description: 'AI-generate social media posts',
    prerequisites: [3],
  },
];

// Check if step can execute
export function canExecuteStep(
  workflow: Workflow,
  step: number
): { canExecute: boolean; missingPrerequisites: number[] } {
  const definition = STEP_DEFINITIONS.find((d) => d.step === step);
  if (!definition) {
    return { canExecute: false, missingPrerequisites: [] };
  }

  const stepStatuses = workflow.stepStatuses;
  const missing = definition.prerequisites.filter(
    (prereq) => stepStatuses[String(prereq) as keyof StepStatuses] !== 'completed'
  );

  return {
    canExecute: missing.length === 0,
    missingPrerequisites: missing,
  };
}

// Get step definition by step number
export function getStepDefinition(step: number): StepDefinition | undefined {
  return STEP_DEFINITIONS.find((d) => d.step === step);
}
