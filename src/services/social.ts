import fs from 'fs';
import path from 'path';
import { Step3Output, Step7Output } from '../types/workflow';
import { createOpenRouterClient } from './openrouter';
import { getOrCreateDefaultPrompt, getPrompt, renderPromptTemplate } from './prompts';
import { createSummary } from './enhance';

export interface GenerateSocialOptions {
  promptId?: string;
  videoName: string;
  outputDir: string;
}

export interface SocialPosts {
  twitter: string[];
  linkedin: string;
  shortForm: string[];
}

// Generate social media posts from enhanced transcript
export async function generateSocialPosts(
  step3Output: Step3Output,
  options: GenerateSocialOptions
): Promise<Step7Output> {
  const client = createOpenRouterClient();

  // Get the prompt to use
  let prompt;
  if (options.promptId) {
    prompt = await getPrompt(options.promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${options.promptId}`);
    }
  } else {
    prompt = await getOrCreateDefaultPrompt('social');
  }

  // Create a summary for the social posts
  const summary = createSummary(step3Output, 1000);

  // Render the user prompt template
  const userPrompt = renderPromptTemplate(prompt.userPromptTemplate, {
    videoName: options.videoName,
    summary,
    enhancedTranscript: step3Output.enhancedTranscript,
    sections: step3Output.sections,
    keyFrames: step3Output.keyFrames,
  });

  console.log('Generating social media posts with AI...');

  const response = await client.chat(
    [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    prompt.model,
    { temperature: prompt.temperature, maxTokens: prompt.maxTokens }
  );

  // Parse the JSON response
  let posts: SocialPosts;
  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    posts = {
      twitter: Array.isArray(parsed.twitter) ? parsed.twitter : [],
      linkedin: typeof parsed.linkedin === 'string' ? parsed.linkedin : '',
      shortForm: Array.isArray(parsed.shortForm) ? parsed.shortForm : [],
    };
  } catch (error) {
    console.error('Failed to parse AI response:', response);
    throw new Error(`Failed to parse social posts response: ${error}`);
  }

  // Ensure output directory exists
  await fs.promises.mkdir(options.outputDir, { recursive: true });

  // Save the social posts as JSON
  const socialJsonPath = path.join(options.outputDir, 'social.json');
  await fs.promises.writeFile(socialJsonPath, JSON.stringify(posts, null, 2), 'utf-8');

  console.log(`Social posts saved to ${socialJsonPath}`);

  return {
    posts,
    socialJsonPath,
    promptId: prompt.id,
    generatedAt: new Date().toISOString(),
  };
}

// Regenerate social posts with additional instructions
export async function refineSocialPosts(
  currentPosts: SocialPosts,
  additionalInstructions: string,
  options: { promptId?: string; videoName: string; outputDir: string }
): Promise<Step7Output> {
  const client = createOpenRouterClient();

  // Get the prompt to use
  let prompt;
  if (options.promptId) {
    prompt = await getPrompt(options.promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${options.promptId}`);
    }
  } else {
    prompt = await getOrCreateDefaultPrompt('social');
  }

  const userMessage = `Refine the following social media posts based on the additional instructions:

Current posts:
${JSON.stringify(currentPosts, null, 2)}

Additional instructions:
${additionalInstructions}

Respond with the complete updated posts in JSON format:
{
  "twitter": ["tweet1", "tweet2", "tweet3"],
  "linkedin": "Full LinkedIn post...",
  "shortForm": ["hook1", "hook2"]
}`;

  const response = await client.chat(
    [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: userMessage },
    ],
    prompt.model,
    { temperature: prompt.temperature, maxTokens: prompt.maxTokens }
  );

  let posts: SocialPosts;
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    posts = {
      twitter: Array.isArray(parsed.twitter) ? parsed.twitter : currentPosts.twitter,
      linkedin: typeof parsed.linkedin === 'string' ? parsed.linkedin : currentPosts.linkedin,
      shortForm: Array.isArray(parsed.shortForm) ? parsed.shortForm : currentPosts.shortForm,
    };
  } catch (error) {
    console.warn('Failed to parse refined social posts, keeping original:', error);
    posts = currentPosts;
  }

  // Save the updated social posts
  const socialJsonPath = path.join(options.outputDir, 'social.json');
  await fs.promises.writeFile(socialJsonPath, JSON.stringify(posts, null, 2), 'utf-8');

  console.log(`Refined social posts saved to ${socialJsonPath}`);

  return {
    posts,
    socialJsonPath,
    promptId: prompt.id,
    generatedAt: new Date().toISOString(),
  };
}

// Read the generated social posts
export async function readSocialPosts(socialJsonPath: string): Promise<SocialPosts> {
  if (!fs.existsSync(socialJsonPath)) {
    throw new Error(`Social posts not found: ${socialJsonPath}`);
  }
  const content = await fs.promises.readFile(socialJsonPath, 'utf-8');
  return JSON.parse(content) as SocialPosts;
}

// Format posts for display
export function formatSocialPostsForDisplay(posts: SocialPosts): string {
  let output = '## Twitter/X Posts\n\n';
  posts.twitter.forEach((tweet, i) => {
    output += `${i + 1}. ${tweet}\n\n`;
  });

  output += '## LinkedIn Post\n\n';
  output += `${posts.linkedin}\n\n`;

  output += '## Short-Form Hooks (TikTok/Reels)\n\n';
  posts.shortForm.forEach((hook, i) => {
    output += `${i + 1}. ${hook}\n\n`;
  });

  return output;
}
