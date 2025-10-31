import { Router } from 'express';
import Donation from '../models/Donation.js';

const router = Router();

// Simple placeholder donation endpoint (integrate Paystack/Stripe client-side and verify here)
router.post('/', async (req, res) => {
  const { donorName, amount, memberId, reference } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount required' });
  const d = await Donation.create({ donorName, amount, memberId: memberId || null, reference });
  res.json({ success: true, donation: d });
});

export default router;
