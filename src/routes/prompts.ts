import { Router, Request, Response, NextFunction } from 'express';
import {
  listPrompts,
  getPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
  setPromptAsDefault,
  previewPrompt,
  initializeDefaultPrompts,
} from '../services/prompts';
import { PromptType } from '../types/workflow';

const router = Router();

// Async handler wrapper
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// Initialize default prompts on startup
router.post(
  '/initialize',
  asyncHandler(async (req, res) => {
    await initializeDefaultPrompts();
    res.json({ success: true, message: 'Default prompts initialized' });
  })
);

// List prompts
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const type = req.query.type as PromptType | undefined;
    const activeOnly = req.query.active === 'true';

    // Validate type if provided
    if (type && !['enhance', 'blog', 'social'].includes(type)) {
      res.status(400).json({ error: 'Invalid prompt type. Must be: enhance, blog, or social' });
      return;
    }

    const prompts = await listPrompts({ type, activeOnly });
    res.json({ prompts });
  })
);

// Get a single prompt
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const prompt = await getPrompt(req.params.id);
    if (!prompt) {
      res.status(404).json({ error: 'Prompt not found' });
      return;
    }
    res.json(prompt);
  })
);

// Create a new prompt
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, type, description, systemPrompt, userPromptTemplate, model, temperature, maxTokens, isDefault } =
      req.body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (!type || !['enhance', 'blog', 'social'].includes(type)) {
      res.status(400).json({ error: 'type is required and must be: enhance, blog, or social' });
      return;
    }

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      res.status(400).json({ error: 'systemPrompt is required' });
      return;
    }

    if (!userPromptTemplate || typeof userPromptTemplate !== 'string') {
      res.status(400).json({ error: 'userPromptTemplate is required' });
      return;
    }

    const prompt = await createPrompt({
      name,
      type,
      description,
      systemPrompt,
      userPromptTemplate,
      model,
      temperature,
      maxTokens,
      isDefault,
    });

    res.status(201).json(prompt);
  })
);

// Update a prompt
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name, description, systemPrompt, userPromptTemplate, model, temperature, maxTokens, isActive } = req.body;

    const prompt = await updatePrompt(req.params.id, {
      name,
      description,
      systemPrompt,
      userPromptTemplate,
      model,
      temperature,
      maxTokens,
      isActive,
    });

    res.json(prompt);
  })
);

// Delete a prompt
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deletePrompt(req.params.id);
    res.status(204).send();
  })
);

// Set prompt as default
router.post(
  '/:id/set-default',
  asyncHandler(async (req, res) => {
    const prompt = await setPromptAsDefault(req.params.id);
    res.json(prompt);
  })
);

// Preview prompt with sample data
router.post(
  '/:id/preview',
  asyncHandler(async (req, res) => {
    const { sampleData } = req.body;

    if (!sampleData || typeof sampleData !== 'object') {
      res.status(400).json({ error: 'sampleData object is required' });
      return;
    }

    const prompt = await getPrompt(req.params.id);
    if (!prompt) {
      res.status(404).json({ error: 'Prompt not found' });
      return;
    }

    const preview = previewPrompt(prompt, sampleData);
    res.json(preview);
  })
);

export default router;
