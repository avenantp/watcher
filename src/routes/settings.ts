import { Router, Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../services/supabase';

const router = Router();

// Async handler wrapper
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// Default settings to initialize
const DEFAULT_SETTINGS: Record<string, { value: Record<string, unknown>; description: string }> = {
  transcription: {
    value: {
      defaultProvider: 'whisper-local',
      defaultModel: null,
      defaultLanguage: null,
    },
    description: 'Default transcription settings',
  },
  analysis: {
    value: {
      defaultModel: 'anthropic/claude-3.5-sonnet',
      defaultMaxKeyFrames: 20,
    },
    description: 'Default analysis settings',
  },
  capture: {
    value: {
      headless: true,
      width: 1920,
      height: 1080,
    },
    description: 'Default screenshot capture settings',
  },
  output: {
    value: {
      baseDir: 'output',
      createGallery: true,
    },
    description: 'Output directory settings',
  },
};

// Initialize default settings
router.post(
  '/initialize',
  asyncHandler(async (req, res) => {
    const supabase = getSupabaseClient();

    for (const [key, setting] of Object.entries(DEFAULT_SETTINGS)) {
      const { data: existing } = await supabase.from('settings').select('key').eq('key', key).single();

      if (!existing) {
        await supabase.from('settings').insert({
          key,
          value: setting.value,
          description: setting.description,
        });
      }
    }

    res.json({ success: true, message: 'Default settings initialized' });
  })
);

// Get all settings
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.from('settings').select('*');

    if (error) {
      throw new Error(`Failed to get settings: ${error.message}`);
    }

    // Convert array to object
    const settings: Record<string, unknown> = {};
    for (const row of data || []) {
      settings[row.key] = row.value;
    }

    res.json({ settings });
  })
);

// Get a specific setting
router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.from('settings').select('*').eq('key', req.params.key).single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Setting not found' });
        return;
      }
      throw new Error(`Failed to get setting: ${error.message}`);
    }

    res.json({ key: data.key, value: data.value, description: data.description });
  })
);

// Update a setting
router.patch(
  '/:key',
  asyncHandler(async (req, res) => {
    const { value } = req.body;

    if (value === undefined) {
      res.status(400).json({ error: 'value is required' });
      return;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', req.params.key)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Setting not found' });
        return;
      }
      throw new Error(`Failed to update setting: ${error.message}`);
    }

    res.json({ key: data.key, value: data.value });
  })
);

// Create a new setting (upsert)
router.put(
  '/:key',
  asyncHandler(async (req, res) => {
    const { value, description } = req.body;

    if (value === undefined) {
      res.status(400).json({ error: 'value is required' });
      return;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('settings')
      .upsert(
        {
          key: req.params.key,
          value,
          description: description || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to upsert setting: ${error.message}`);
    }

    res.json({ key: data.key, value: data.value });
  })
);

// Delete a setting
router.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const supabase = getSupabaseClient();

    const { error } = await supabase.from('settings').delete().eq('key', req.params.key);

    if (error) {
      throw new Error(`Failed to delete setting: ${error.message}`);
    }

    res.status(204).send();
  })
);

export default router;
