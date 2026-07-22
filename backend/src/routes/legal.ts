import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

const ALLOWED_POLICIES: Record<string, { file: string; title: string }> = {
  'terms-and-conditions': {
    file: 'TERMS_AND_CONDITIONS.md',
    title: 'Terms and Conditions',
  },
  'sla': {
    file: 'SLA.md',
    title: 'Service Level Agreement (SLA)',
  },
  'customization-policy': {
    file: 'CUSTOMIZATION_POLICY.md',
    title: 'Customization Policy',
  },
};

// In-memory static policy cache
const policyCache = new Map<string, string>();

/**
 * GET /api/legal/:policyName
 * Reads and returns the content of the Markdown policy files from the docs/ folder.
 */
router.get('/:policyName', async (req: Request, res: Response): Promise<void> => {
  const { policyName } = req.params;

  const policy = ALLOWED_POLICIES[policyName.toLowerCase().trim()];
  if (!policy) {
    res.status(404).json({
      error: 'Policy Not Found',
      message: `The legal policy "${policyName}" does not exist. Available policies: ${Object.keys(ALLOWED_POLICIES).join(', ')}.`,
    });
    return;
  }

  // Resolve filepath to docs/ folder at the project root
  const docsPath = path.resolve(__dirname, '../../../docs');
  const filePath = path.join(docsPath, policy.file);

  try {
    let content = policyCache.get(policy.file);
    
    // Serve from cache if available, otherwise read asynchronously
    if (!content) {
      content = await fs.promises.readFile(filePath, 'utf8');
      policyCache.set(policy.file, content);
    }

    res.status(200).json({
      success: true,
      policyName,
      title: policy.title,
      content,
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({
        error: 'Policy File Missing',
        message: 'The requested policy document could not be found on the server.',
      });
      return;
    }
    res.status(500).json({
      error: 'Internal Server Error',
      message: `Failed to load policy document: ${error.message}`,
    });
  }
});

export default router;
