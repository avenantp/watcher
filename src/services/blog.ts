import fs from 'fs';
import path from 'path';
import { Step3Output, Step4Output, Step6Output } from '../types/workflow';
import { createOpenRouterClient } from './openrouter';
import { getOrCreateDefaultPrompt, getPrompt, renderPromptTemplate } from './prompts';

export interface GenerateBlogOptions {
  promptId?: string;
  videoName: string;
  outputDir: string;
}

// Generate a blog post from enhanced transcript and screenshots
export async function generateBlogPost(
  step3Output: Step3Output,
  step4Output: Step4Output,
  options: GenerateBlogOptions
): Promise<Step6Output> {
  const client = createOpenRouterClient();

  // Get the prompt to use
  let prompt;
  if (options.promptId) {
    prompt = await getPrompt(options.promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${options.promptId}`);
    }
  } else {
    prompt = await getOrCreateDefaultPrompt('blog');
  }

  // Format screenshots for the template
  const screenshotsData = step4Output.screenshots.map((s) => ({
    timestamp: s.timestamp,
    reason: s.reason,
    path: `./screenshots/${path.basename(s.path)}`,
    filename: path.basename(s.path),
  }));

  // Render the user prompt template
  const userPrompt = renderPromptTemplate(prompt.userPromptTemplate, {
    videoName: options.videoName,
    enhancedTranscript: step3Output.enhancedTranscript,
    sections: step3Output.sections,
    keyFrames: step3Output.keyFrames,
    screenshots: screenshotsData,
  });

  console.log('Generating blog post with AI...');

  const response = await client.chat(
    [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    prompt.model,
    { temperature: prompt.temperature, maxTokens: prompt.maxTokens }
  );

  // The response should be markdown content
  let blogContent = response.trim();

  // If the response is wrapped in code blocks, extract it
  const markdownMatch = blogContent.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
  if (markdownMatch) {
    blogContent = markdownMatch[1].trim();
  }

  // Ensure output directory exists
  await fs.promises.mkdir(options.outputDir, { recursive: true });

  // Save the blog post
  const blogPath = path.join(options.outputDir, 'blog.md');
  await fs.promises.writeFile(blogPath, blogContent, 'utf-8');

  console.log(`Blog post saved to ${blogPath}`);

  return {
    blogPath,
    blogUrl: `/output/${path.basename(options.outputDir)}/blog.md`,
    promptId: prompt.id,
    generatedAt: new Date().toISOString(),
  };
}

// Regenerate blog with additional instructions
export async function refineBlogPost(
  currentBlogPath: string,
  additionalInstructions: string,
  options: { promptId?: string; outputDir: string }
): Promise<Step6Output> {
  const client = createOpenRouterClient();

  // Read current blog content
  const currentContent = await fs.promises.readFile(currentBlogPath, 'utf-8');

  // Get the prompt to use
  let prompt;
  if (options.promptId) {
    prompt = await getPrompt(options.promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${options.promptId}`);
    }
  } else {
    prompt = await getOrCreateDefaultPrompt('blog');
  }

  const userMessage = `Refine the following blog post based on the additional instructions:

Current blog post:
${currentContent}

Additional instructions:
${additionalInstructions}

Provide the complete updated blog post in markdown format.`;

  const response = await client.chat(
    [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: userMessage },
    ],
    prompt.model,
    { temperature: prompt.temperature, maxTokens: prompt.maxTokens }
  );

  let blogContent = response.trim();

  // If the response is wrapped in code blocks, extract it
  const markdownMatch = blogContent.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
  if (markdownMatch) {
    blogContent = markdownMatch[1].trim();
  }

  // Save the updated blog post
  const blogPath = path.join(options.outputDir, 'blog.md');
  await fs.promises.writeFile(blogPath, blogContent, 'utf-8');

  console.log(`Refined blog post saved to ${blogPath}`);

  return {
    blogPath,
    blogUrl: `/output/${path.basename(options.outputDir)}/blog.md`,
    promptId: prompt.id,
    generatedAt: new Date().toISOString(),
  };
}

// Read the generated blog post
export async function readBlogPost(blogPath: string): Promise<string> {
  if (!fs.existsSync(blogPath)) {
    throw new Error(`Blog post not found: ${blogPath}`);
  }
  return fs.promises.readFile(blogPath, 'utf-8');
}
