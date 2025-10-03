// Consolidated wizard + suggestion endpoints extracted from server-charlie.js
import { Router } from 'express';
import { SETUP_WIZARDS, calculateWizardConfidence, mergeDiscoveryContext, WizardStateManager } from './wizards/index.js';
import { executeWizardStepWithValidation, validateWizardStepData } from './wizards/execution.js';

// Shared state manager instance (singleton aligned with execution engine)
globalThis.__wizardStateManager = globalThis.__wizardStateManager || new WizardStateManager();
const wizardState = globalThis.__wizardStateManager;

export function createWizardRouter({ asyncHandler }) {
  const r = Router();

  // List wizards (unique)
  r.get('/setup/wizards', asyncHandler(async (req, res) => {
    const list = Object.values(SETUP_WIZARDS).map(w => ({ id: w.id, name: w.name, steps: w.steps.length }));
    res.json({ ok: true, wizards: list });
  }));

  // Get wizard definition
  r.get('/setup/wizards/:wizardId', asyncHandler(async (req, res) => {
    const wiz = SETUP_WIZARDS[req.params.wizardId];
    if (!wiz) return res.status(404).json({ ok: false, error: 'wizard not found' });
    res.json({ ok: true, wizard: wiz });
  }));

  // Execute step (unvalidated legacy variant)
  r.post('/setup/wizards/:wizardId/execute', asyncHandler(async (req, res) => {
    const { wizardId } = req.params;
    const { stepId, data, context } = req.body || {};
    if (!stepId) return res.status(400).json({ ok: false, error: 'stepId required' });
    const result = await executeWizardStepWithValidation(wizardId, stepId, data || {}, context || null);
    // Ensure legacy callers get a top-level success flag
    const success = result && typeof result.success === 'boolean' ? result.success : true;
    res.json({ ok: true, success, result });
  }));

  // Execute step with validation (preferred)
  r.post('/setup/wizards/:wizardId/execute-validated', asyncHandler(async (req, res) => {
    const { wizardId } = req.params;
    const { stepId, data } = req.body || {};
    if (!stepId) return res.status(400).json({ ok: false, error: 'stepId required' });
    let validation;
    try {
      validation = validateWizardStepData(SETUP_WIZARDS[wizardId], stepId, data || {});
    } catch (e) {
      return res.status(400).json({ ok: false, success: false, errors: [e.message] });
    }
    if (!validation.isValid) return res.status(400).json({ ok: false, success: false, errors: validation.errors });
    const result = await executeWizardStepWithValidation(wizardId, stepId, data || {});
    res.json({ ok: true, success: true, result });
  }));

  // Wizard status
  r.get('/setup/wizards/:wizardId/status', asyncHandler(async (req, res) => {
    const { wizardId } = req.params;
    const state = wizardState.getWizardState ? (wizardState.getWizardState(wizardId) || {}) : {};
    const wiz = SETUP_WIZARDS[wizardId];
    const totalSteps = Array.isArray(wiz?.steps) ? wiz.steps.length : 0;
    const stepIndex = Number(state.currentStep || 0);
    const completed = Boolean(state.completed || false);
    const ratio = totalSteps > 0 ? Math.min(stepIndex, totalSteps) / totalSteps : 0;
    const percent = Math.round(ratio * 100);
    const status = { progress: ratio, percent, stepIndex, totalSteps, completed };
    // Include original state for backward-compat
    res.json({ ok: true, success: true, wizardId, status, state });
  }));

  // Reset wizard
  r.delete('/setup/wizards/:wizardId', asyncHandler(async (req, res) => {
    const { wizardId } = req.params;
    if (wizardState.resetWizard) wizardState.resetWizard(wizardId);
    res.json({ ok: true, wizardId, reset: true });
  }));

  // Bulk operations placeholder (preserved)
  r.post('/setup/wizards/bulk/:operation', asyncHandler(async (req, res) => {
    const { operation } = req.params;
    if (operation === 'reset-all' && wizardState.resetAll) {
      wizardState.resetAll();
      return res.json({ ok: true, resetAll: true });
    }
    res.status(400).json({ ok: false, error: 'unknown operation' });
  }));

  // Suggest wizards (with minConfidence filter)
  r.post('/discovery/suggest-wizards', asyncHandler(async (req, res) => {
    const { devices = [], context = {}, minConfidence = 0 } = req.body || {};
    const suggestions = devices.map(device => {
      // Calculate confidence directly using device and optional discovery context
      const recs = Object.values(SETUP_WIZARDS)
        .map(w => ({
          wizardId: w.id,
          name: w.name,
          confidence: calculateWizardConfidence(device, w, context)
        }))
        .filter(r => r.confidence >= minConfidence)
        .sort((a, b) => b.confidence - a.confidence);
      return { device, recommendedWizards: recs };
    });
    res.json({ ok: true, success: true, suggestions });
  }));

  return r;
}
