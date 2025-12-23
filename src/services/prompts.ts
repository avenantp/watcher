import Handlebars from 'handlebars';
import { getSupabaseClient } from './supabase';
import {
  Prompt,
  PromptRow,
  PromptType,
  promptRowToPrompt,
} from '../types/workflow';

// Default prompts to insert if none exist
const DEFAULT_PROMPTS: Omit<PromptRow, 'id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'Default Transcript Enhancement',
    type: 'enhance',
    description: 'Enhances transcripts and identifies key frames for screenshots',
    system_prompt: `You are an expert at enhancing video transcripts. Your task is to:
1. Fix any transcription errors or unclear text
2. Add proper punctuation and formatting
3. Identify key moments that would benefit from screenshots
4. Structure the content into logical sections

For key frames, look for:
- Topic changes or new concepts
- Visual demonstrations being described
- Step-by-step instructions
- Important conclusions
- References to on-screen content ("as you can see", "here we have", etc.)

Space key frames 10-15 seconds apart to avoid redundancy.
Aim for 1 key frame per 30-60 seconds of content.`,
    user_prompt_template: `Enhance this transcript and identify key frames for screenshots:

Video: {{videoName}}

Original Transcript:
{{transcript}}

{{#if maxKeyFrames}}Limit to approximately {{maxKeyFrames}} key frames.{{/if}}

Respond in JSON format:
{
  "enhancedTranscript": "The improved transcript text with proper formatting...",
  "sections": [
    { "title": "Section Title", "startTime": 0, "endTime": 60 }
  ],
  "keyFrames": [
    { "timestamp": 12.5, "reason": "Description of why this moment needs a screenshot", "segmentId": "seg-0" }
  ]
}`,
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.3,
    max_tokens: 8192,
    is_default: true,
    is_active: true,
  },
  {
    name: 'Default Blog Generation',
    type: 'blog',
    description: 'Generates blog posts from video content with embedded screenshots',
    system_prompt: `You are an expert content writer who transforms video transcripts into engaging blog posts. Create well-structured, SEO-friendly content that:
1. Uses proper headings (H2, H3)
2. Includes relevant screenshots at appropriate points
3. Adds context and explanations where helpful
4. Maintains the original message while improving readability
5. Uses markdown formatting

When including screenshots, use the provided paths in markdown image syntax.`,
    user_prompt_template: `Create a blog post from this video content:

Video Title: {{videoName}}

Enhanced Transcript:
{{enhancedTranscript}}

Available Screenshots:
{{#each screenshots}}
- {{this.timestamp}}s: {{this.reason}} (path: {{this.path}})
{{/each}}

Write a comprehensive blog post in markdown format. Include screenshots using relative paths like: ![Description](./screenshots/filename.png)

The blog should:
- Have an engaging title
- Include an introduction
- Use the screenshots at relevant points in the content
- Have a conclusion
- Be formatted in clean markdown`,
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.7,
    max_tokens: 8192,
    is_default: true,
    is_active: true,
  },
  {
    name: 'Default Social Media Posts',
    type: 'social',
    description: 'Generates social media posts for multiple platforms',
    system_prompt: `You are a social media expert who creates engaging posts from video content. Create multiple posts for different platforms:
1. Twitter/X (280 chars max, with relevant hashtags)
2. LinkedIn (professional tone, up to 3000 chars)
3. Short-form hooks for TikTok/Reels/Shorts

Each post should highlight key insights and drive engagement. Be concise but impactful.`,
    user_prompt_template: `Create social media posts for this video content:

Video Title: {{videoName}}

Summary:
{{summary}}

Key Points:
{{#each keyFrames}}
- {{this.reason}}
{{/each}}

Create posts in JSON format:
{
  "twitter": ["Tweet 1 with #hashtags", "Tweet 2 with #hashtags", "Tweet 3 with #hashtags"],
  "linkedin": "Full LinkedIn post with professional tone...",
  "shortForm": ["Hook 1 for short-form video", "Hook 2 for short-form video"]
}`,
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.8,
    max_tokens: 4096,
    is_default: true,
    is_active: true,
  },
];

// Compile and render a Handlebars template
export function renderPromptTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  const compiled = Handlebars.compile(template);
  return compiled(data);
}

// List prompts with optional filtering
export async function listPrompts(options?: {
  type?: PromptType;
  activeOnly?: boolean;
}): Promise<Prompt[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from('prompts').select('*');

  if (options?.type) {
    query = query.eq('type', options.type);
  }

  if (options?.activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list prompts: ${error.message}`);
  }

  return (data as PromptRow[]).map(promptRowToPrompt);
}

// Get a single prompt by ID
export async function getPrompt(id: string): Promise<Prompt | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get prompt: ${error.message}`);
  }

  return promptRowToPrompt(data as PromptRow);
}

// Get default prompt by type
export async function getDefaultPrompt(type: PromptType): Promise<Prompt | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('type', type)
    .eq('is_default', true)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get default prompt: ${error.message}`);
  }

  return promptRowToPrompt(data as PromptRow);
}

// Create a new prompt
export async function createPrompt(prompt: {
  name: string;
  type: PromptType;
  description?: string;
  systemPrompt: string;
  userPromptTemplate: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  isDefault?: boolean;
}): Promise<Prompt> {
  const supabase = getSupabaseClient();

  // If setting as default, unset other defaults of same type
  if (prompt.isDefault) {
    await supabase
      .from('prompts')
      .update({ is_default: false })
      .eq('type', prompt.type)
      .eq('is_default', true);
  }

  const { data, error } = await supabase
    .from('prompts')
    .insert({
      name: prompt.name,
      type: prompt.type,
      description: prompt.description || null,
      system_prompt: prompt.systemPrompt,
      user_prompt_template: prompt.userPromptTemplate,
      model: prompt.model || 'anthropic/claude-3.5-sonnet',
      temperature: prompt.temperature ?? 0.7,
      max_tokens: prompt.maxTokens ?? 4096,
      is_default: prompt.isDefault ?? false,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create prompt: ${error.message}`);
  }

  return promptRowToPrompt(data as PromptRow);
}

// Update an existing prompt
export async function updatePrompt(
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    systemPrompt: string;
    userPromptTemplate: string;
    model: string;
    temperature: number;
    maxTokens: number;
    isActive: boolean;
  }>
): Promise<Prompt> {
  const supabase = getSupabaseClient();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.systemPrompt !== undefined) updateData.system_prompt = updates.systemPrompt;
  if (updates.userPromptTemplate !== undefined)
    updateData.user_prompt_template = updates.userPromptTemplate;
  if (updates.model !== undefined) updateData.model = updates.model;
  if (updates.temperature !== undefined) updateData.temperature = updates.temperature;
  if (updates.maxTokens !== undefined) updateData.max_tokens = updates.maxTokens;
  if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

  const { data, error } = await supabase
    .from('prompts')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update prompt: ${error.message}`);
  }

  return promptRowToPrompt(data as PromptRow);
}

// Delete a prompt
export async function deletePrompt(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('prompts').delete().eq('id', id);

  if (error) {
    throw new Error(`Failed to delete prompt: ${error.message}`);
  }
}

// Set a prompt as the default for its type
export async function setPromptAsDefault(id: string): Promise<Prompt> {
  const supabase = getSupabaseClient();

  // Get the prompt to find its type
  const prompt = await getPrompt(id);
  if (!prompt) {
    throw new Error('Prompt not found');
  }

  // Unset other defaults of same type
  await supabase
    .from('prompts')
    .update({ is_default: false })
    .eq('type', prompt.type)
    .eq('is_default', true);

  // Set this one as default
  const { data, error } = await supabase
    .from('prompts')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to set prompt as default: ${error.message}`);
  }

  return promptRowToPrompt(data as PromptRow);
}

// Preview a prompt with sample data
export function previewPrompt(
  prompt: Prompt,
  sampleData: Record<string, unknown>
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt: renderPromptTemplate(prompt.userPromptTemplate, sampleData),
  };
}

// Initialize default prompts if none exist
export async function initializeDefaultPrompts(): Promise<void> {
  const supabase = getSupabaseClient();

  for (const defaultPrompt of DEFAULT_PROMPTS) {
    // Check if a default prompt of this type already exists
    const { data: existing } = await supabase
      .from('prompts')
      .select('id')
      .eq('type', defaultPrompt.type)
      .eq('is_default', true)
      .single();

    if (!existing) {
      // Insert the default prompt
      const { error } = await supabase.from('prompts').insert(defaultPrompt);

      if (error) {
        console.error(`Failed to insert default ${defaultPrompt.type} prompt:`, error.message);
      } else {
        console.log(`Inserted default ${defaultPrompt.type} prompt`);
      }
    }
  }
}

// Get or create default prompt for a type
export async function getOrCreateDefaultPrompt(type: PromptType): Promise<Prompt> {
  let prompt = await getDefaultPrompt(type);

  if (!prompt) {
    // Create the default prompt
    const defaultDef = DEFAULT_PROMPTS.find((p) => p.type === type);
    if (!defaultDef) {
      throw new Error(`No default prompt definition for type: ${type}`);
    }

    prompt = await createPrompt({
      name: defaultDef.name,
      type: defaultDef.type,
      description: defaultDef.description || undefined,
      systemPrompt: defaultDef.system_prompt,
      userPromptTemplate: defaultDef.user_prompt_template,
      model: defaultDef.model,
      temperature: defaultDef.temperature,
      maxTokens: defaultDef.max_tokens,
      isDefault: true,
    });
  }

  return prompt;
}
