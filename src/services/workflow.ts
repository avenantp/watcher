import fs from 'fs';
import path from 'path';
import { getSupabaseClient } from './supabase';
import {
  Workflow,
  WorkflowRow,
  WorkflowConfig,
  WorkflowLog,
  WorkflowLogRow,
  StepStatuses,
  StepStatus,
  Step1Output,
  Step2Output,
  Step3Output,
  Step4Output,
  Step5Output,
  Step6Output,
  Step7Output,
  workflowRowToWorkflow,
  workflowLogRowToWorkflowLog,
  canExecuteStep,
  getStepDefinition,
  STEP_DEFINITIONS,
} from '../types/workflow';

const DATA_DIR = path.join(process.cwd(), 'data');
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const TEMP_DIR = path.join(process.cwd(), 'temp');
const VIDEO_STORAGE_DIR = path.join(DATA_DIR, 'videos');

// Ensure directories exist
[DATA_DIR, OUTPUT_DIR, TEMP_DIR, VIDEO_STORAGE_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Create a new workflow
export async function createWorkflow(options: {
  videoSource: string;
  config?: WorkflowConfig;
  enhancePromptId?: string;
  blogPromptId?: string;
  socialPromptId?: string;
}): Promise<Workflow> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('workflows')
    .insert({
      video_source: options.videoSource.trim(),
      config: options.config || {},
      enhance_prompt_id: options.enhancePromptId || null,
      blog_prompt_id: options.blogPromptId || null,
      social_prompt_id: options.socialPromptId || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create workflow: ${error.message}`);
  }

  return workflowRowToWorkflow(data as WorkflowRow);
}

// List workflows with optional filtering
export async function listWorkflows(options?: {
  status?: Workflow['status'];
  limit?: number;
  offset?: number;
}): Promise<{ workflows: Workflow[]; total: number }> {
  const supabase = getSupabaseClient();

  let query = supabase.from('workflows').select('*', { count: 'exact' });

  if (options?.status) {
    query = query.eq('status', options.status);
  }

  query = query.order('created_at', { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list workflows: ${error.message}`);
  }

  return {
    workflows: (data as WorkflowRow[]).map(workflowRowToWorkflow),
    total: count || 0,
  };
}

// Get a single workflow by ID
export async function getWorkflow(id: string): Promise<Workflow | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get workflow: ${error.message}`);
  }

  return workflowRowToWorkflow(data as WorkflowRow);
}

// Delete a workflow
export async function deleteWorkflow(id: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from('workflows').delete().eq('id', id);

  if (error) {
    throw new Error(`Failed to delete workflow: ${error.message}`);
  }
}

// Update workflow fields
export async function updateWorkflow(
  id: string,
  updates: Partial<{
    videoPath: string;
    videoName: string;
    videoId: string;
    status: Workflow['status'];
    currentStep: number;
    errorMessage: string | null;
    stepStatuses: StepStatuses;
    step1Output: Step1Output;
    step2Output: Step2Output;
    step3Output: Step3Output;
    step4Output: Step4Output;
    step5Output: Step5Output;
    step6Output: Step6Output;
    step7Output: Step7Output;
    config: WorkflowConfig;
    startedAt: string;
    completedAt: string;
  }>
): Promise<Workflow> {
  const supabase = getSupabaseClient();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.videoPath !== undefined) updateData.video_path = updates.videoPath;
  if (updates.videoName !== undefined) updateData.video_name = updates.videoName;
  if (updates.videoId !== undefined) updateData.video_id = updates.videoId;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.currentStep !== undefined) updateData.current_step = updates.currentStep;
  if (updates.errorMessage !== undefined) updateData.error_message = updates.errorMessage;
  if (updates.stepStatuses !== undefined) updateData.step_statuses = updates.stepStatuses;
  if (updates.step1Output !== undefined) updateData.step_1_output = updates.step1Output;
  if (updates.step2Output !== undefined) updateData.step_2_output = updates.step2Output;
  if (updates.step3Output !== undefined) updateData.step_3_output = updates.step3Output;
  if (updates.step4Output !== undefined) updateData.step_4_output = updates.step4Output;
  if (updates.step5Output !== undefined) updateData.step_5_output = updates.step5Output;
  if (updates.step6Output !== undefined) updateData.step_6_output = updates.step6Output;
  if (updates.step7Output !== undefined) updateData.step_7_output = updates.step7Output;
  if (updates.config !== undefined) updateData.config = updates.config;
  if (updates.startedAt !== undefined) updateData.started_at = updates.startedAt;
  if (updates.completedAt !== undefined) updateData.completed_at = updates.completedAt;

  const { data, error } = await supabase
    .from('workflows')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update workflow: ${error.message}`);
  }

  return workflowRowToWorkflow(data as WorkflowRow);
}

// Update step status
export async function updateStepStatus(
  id: string,
  step: number,
  status: StepStatus
): Promise<Workflow> {
  const workflow = await getWorkflow(id);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const newStepStatuses = { ...workflow.stepStatuses };
  newStepStatuses[String(step) as keyof StepStatuses] = status;

  return updateWorkflow(id, {
    stepStatuses: newStepStatuses,
    currentStep: status === 'in_progress' ? step : workflow.currentStep,
  });
}

// Log workflow progress
export async function logWorkflowProgress(
  workflowId: string,
  step: number,
  status: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from('workflow_logs').insert({
    workflow_id: workflowId,
    step,
    status,
    message,
    metadata: metadata || null,
  });

  if (error) {
    console.error(`Failed to log workflow progress: ${error.message}`);
  }

  // Also log to console
  console.log(`[Workflow ${workflowId}] Step ${step}: ${message}`);
}

// Get workflow logs
export async function getWorkflowLogs(
  workflowId: string,
  options?: { step?: number; limit?: number }
): Promise<WorkflowLog[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('workflow_logs')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false });

  if (options?.step !== undefined) {
    query = query.eq('step', options.step);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get workflow logs: ${error.message}`);
  }

  return (data as WorkflowLogRow[]).map(workflowLogRowToWorkflowLog);
}

// Check if a step can be executed
export function checkStepPrerequisites(
  workflow: Workflow,
  step: number
): { canExecute: boolean; missingPrerequisites: number[]; stepName: string } {
  const result = canExecuteStep(workflow, step);
  const definition = getStepDefinition(step);

  return {
    ...result,
    stepName: definition?.name || `Step ${step}`,
  };
}

// Get step status info
export function getStepStatus(
  workflow: Workflow,
  step: number
): {
  step: number;
  name: string;
  status: StepStatus;
  output: unknown;
  canExecute: boolean;
  missingPrerequisites: number[];
} {
  const definition = getStepDefinition(step);
  const prereqCheck = canExecuteStep(workflow, step);

  const outputMap: Record<number, unknown> = {
    1: workflow.step1Output,
    2: workflow.step2Output,
    3: workflow.step3Output,
    4: workflow.step4Output,
    5: workflow.step5Output,
    6: workflow.step6Output,
    7: workflow.step7Output,
  };

  return {
    step,
    name: definition?.name || `Step ${step}`,
    status: workflow.stepStatuses[String(step) as keyof StepStatuses],
    output: outputMap[step] || null,
    canExecute: prereqCheck.canExecute,
    missingPrerequisites: prereqCheck.missingPrerequisites,
  };
}

// Get all step definitions with current status
export function getAllStepStatuses(workflow: Workflow): Array<{
  step: number;
  name: string;
  description: string;
  status: StepStatus;
  canExecute: boolean;
  missingPrerequisites: number[];
}> {
  return STEP_DEFINITIONS.map((def) => {
    const prereqCheck = canExecuteStep(workflow, def.step);
    return {
      step: def.step,
      name: def.name,
      description: def.description,
      status: workflow.stepStatuses[String(def.step) as keyof StepStatuses],
      canExecute: prereqCheck.canExecute,
      missingPrerequisites: prereqCheck.missingPrerequisites,
    };
  });
}

// Start workflow execution
export async function startWorkflow(
  id: string,
  fromStep?: number
): Promise<Workflow> {
  const workflow = await getWorkflow(id);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const now = new Date().toISOString();
  const updates: Parameters<typeof updateWorkflow>[1] = {
    status: 'in_progress',
    errorMessage: null,
  };

  if (!workflow.startedAt) {
    updates.startedAt = now;
  }

  // Reset steps from the specified step onwards if restarting
  if (fromStep !== undefined && fromStep >= 1 && fromStep <= 7) {
    const newStepStatuses = { ...workflow.stepStatuses };
    for (let i = fromStep; i <= 7; i++) {
      newStepStatuses[String(i) as keyof StepStatuses] = 'pending';
    }
    updates.stepStatuses = newStepStatuses;
    updates.currentStep = fromStep;
  }

  return updateWorkflow(id, updates);
}

// Pause workflow
export async function pauseWorkflow(id: string): Promise<Workflow> {
  const workflow = await getWorkflow(id);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  return updateWorkflow(id, {
    status: 'paused',
  });
}

// Mark workflow as completed
export async function completeWorkflow(id: string): Promise<Workflow> {
  return updateWorkflow(id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
}

// Mark workflow as errored
export async function failWorkflow(id: string, errorMessage: string): Promise<Workflow> {
  return updateWorkflow(id, {
    status: 'error',
    errorMessage,
  });
}

// Helper to get output directory for a workflow
export function getWorkflowOutputDir(videoName: string): string {
  return path.join(OUTPUT_DIR, videoName);
}

// Helper to get temp directory for a workflow
export function getWorkflowTempDir(workflowId: string): string {
  return path.join(TEMP_DIR, workflowId);
}

// Helper to convert path to public URL
export function toPublicPath(targetPath: string): string {
  const relative = path.relative(OUTPUT_DIR, targetPath).split(path.sep).join('/');
  return `/output/${relative}`;
}

// Export directory constants
export { DATA_DIR, OUTPUT_DIR, TEMP_DIR, VIDEO_STORAGE_DIR };
