import { Router } from 'express';
import { callStore } from '../callStore.ts';
import { ingest } from '../ingest.ts';
import { AiSettingsUpdateSchema, settings } from '../settingsStore.ts';
import { testDeepgram } from '../sttManager.ts';
import { pbxRouter, sendError } from './pbx.ts';

export const apiRouter = Router();

apiRouter.get('/calls', (_req, res) => res.json(callStore.list()));
apiRouter.get('/pbx-status', (_req, res) => res.json(ingest.status()));
apiRouter.use('/pbx', pbxRouter);

apiRouter.get('/settings/ai', (_req, res) => res.json(settings.aiView()));
apiRouter.put('/settings/ai', (req, res) => {
  try {
    settings.updateAi(AiSettingsUpdateSchema.parse(req.body));
    res.json(settings.aiView());
  } catch (err) {
    sendError(res, err);
  }
});

/** Test with the values currently in the form (key falls back to the stored one). */
apiRouter.post('/settings/ai/test', async (req, res) => {
  try {
    const form = AiSettingsUpdateSchema.partial().parse(req.body ?? {});
    const ai = {
      ...settings.ai,
      ...Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined && v !== '')),
    };
    if (form.clearApiKey) ai.apiKey = '';
    res.json(await testDeepgram(ai, 8000));
  } catch (err) {
    sendError(res, err);
  }
});
