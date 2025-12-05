import express, { Router } from 'express';
import Donation from '../models/Donation.js';
import { body, validationResult } from 'express-validator';
import { ok, badRequest, serverError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import Member from '../models/Member.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Recent donations for admin notifications
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const donations = await Donation.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    ok(res, { donations });
  } catch (err) {
    logger.error('Failed to fetch recent donations', err);
    serverError(res, 'Failed to fetch recent donations');
  }
});

// Simple placeholder donation endpoint (legacy create record)
router.post('/', [
  body('amount').isFloat({ gt: 0 }),
  body('donorName').optional().isString().trim(),
  body('memberId').optional().isString().trim(),
  body('reference').optional().isString().trim(),
], async (req, res) => {
  const { donorName, amount, memberId, reference } = req.body;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return badRequest(res, errors.array());
  try {
    const d = await Donation.create({ donorName, amount, memberId: memberId || null, reference });
    ok(res, { donation: d });
  } catch (err) {
    logger.error('Failed to create donation', err);
    serverError(res, 'Failed to create donation');
  }
});

// Stripe Checkout session creation
router.post('/create-checkout-session', [
  body('amount').isFloat({ gt: 0 }),
  body('currency').optional().isString().isIn(['usd','ngn','eur','gbp']).default('usd'),
  body('donorName').optional().isString().trim(),
  body('donorEmail').optional().isEmail(),
  body('causeType').isString().isIn(['beneficiary','general']),
  body('memberId').optional().isString().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return badRequest(res, errors.array());
  const { amount, currency = 'usd', donorName, donorEmail, causeType, memberId } = req.body;
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return serverError(res, 'Stripe is not configured');
    }
    const stripe = new Stripe(secret);

    const frontendBase = (req.get('origin') || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const label = causeType === 'beneficiary' ? 'Donation to Beneficiary' : 'Donation to Foundation';
    const description = causeType === 'beneficiary' && memberId ? `Beneficiary ID: ${memberId}` : 'General cause';

    const pmByCurrency = {
      usd: ['card', 'link', 'cashapp', 'affirm', 'afterpay_clearpay', 'us_bank_account', 'alipay', 'klarna'],
      eur: ['card', 'link', 'bancontact', 'giropay', 'ideal', 'sepa_debit', 'sofort', 'klarna', 'alipay'],
      gbp: ['card', 'link', 'sepa_debit', 'klarna', 'afterpay_clearpay', 'alipay'],
      ngn: ['card', 'link'],
    };
    const paymentMethodTypes = pmByCurrency[(currency || 'usd').toLowerCase()] || ['card', 'link'];

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: paymentMethodTypes,
        customer_email: donorEmail,
        line_items: [
          {
            price_data: {
              currency,
              product_data: { name: label, description },
              unit_amount: Math.round(Number(amount) * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${frontendBase}/#/donation?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendBase}/#/donation?status=cancel`,
        metadata: {
          donorName: donorName || '',
          causeType,
          memberId: memberId || '',
        },
      });
    } catch (pmErr) {
      const safeTypes = (currency || 'usd').toLowerCase() === 'usd'
        ? ['card', 'link', 'us_bank_account']
        : (currency || 'usd').toLowerCase() === 'eur'
        ? ['card', 'link', 'sepa_debit']
        : ['card', 'link'];
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: safeTypes,
        customer_email: donorEmail,
        line_items: [
          {
            price_data: {
              currency,
              product_data: { name: label, description },
              unit_amount: Math.round(Number(amount) * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${frontendBase}/#/donation?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendBase}/#/donation?status=cancel`,
        metadata: {
          donorName: donorName || '',
          causeType,
          memberId: memberId || '',
        },
      });
    }

    ok(res, { url: session.url, id: session.id });
  } catch (err) {
    logger.error('Stripe checkout session error', err);
    serverError(res, 'Failed to create checkout session');
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !webhookSecret) return res.status(500).json({ error: 'Stripe is not configured' });
  const stripe = new Stripe(secret);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const amountTotal = session.amount_total || 0;
      const currency = session.currency || 'usd';
      const donorEmail = session.customer_details?.email || session.customer_email || '';
      const meta = session.metadata || {};
      const donorName = meta.donorName || '';
      const causeType = meta.causeType === 'beneficiary' ? 'beneficiary' : 'general';
      const memberId = meta.memberId || null;
      const paymentIntentId = session.payment_intent || '';
      const donation = await Donation.create({
        donorName,
        donorEmail,
        amount: Math.round(Number(amountTotal) / 100),
        currency,
        causeType,
        memberId: memberId || null,
        reference: session.id,
        status: 'succeeded',
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
      });

      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });
        const amountFmt = `${donation.currency.toUpperCase()} ${donation.amount.toLocaleString()}`;
        const beneficiaryText = donation.causeType === 'beneficiary' && donation.memberId ? `Beneficiary ID: ${donation.memberId}` : 'Foundation General Cause';

        const buildReceiptPdf = async () => {
          const doc = new PDFDocument({ size: 'A4', margin: 50 });
          const chunks = [];
          doc.on('data', (d) => chunks.push(d));
          return new Promise((resolve) => {
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.fontSize(20).text('United Link Foundation', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(14).text('Donation Receipt', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Date: ${new Date(donation.createdAt).toLocaleString()}`);
            doc.text(`Reference: ${donation.reference}`);
            doc.moveDown();
            doc.fontSize(12).text(`Donor: ${donation.donorName || 'Anonymous'}`);
            if (donation.donorEmail) doc.text(`Email: ${donation.donorEmail}`);
            doc.moveDown();
            doc.fontSize(12).text(`Amount: ${amountFmt}`);
            doc.text(`Cause: ${beneficiaryText}`);
            doc.moveDown(2);
            doc.fontSize(10).fillColor('#666').text('Thank you for supporting our mission at United Link Foundation.', { align: 'center' });
            doc.end();
          });
        };
        const pdfBuffer = await buildReceiptPdf();

        // Donor receipt
        if (donorEmail) {
          await transporter.sendMail({
            from: `United Link Foundation <${process.env.EMAIL_USER}>`,
            to: donorEmail,
            subject: 'Donation Receipt — United Link Foundation',
            html: `
              <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
                <h2 style="color:#2563eb;margin:0 0 8px">Donation Receipt</h2>
                <p style="margin:0 0 6px">Dear ${donorName || 'Donor'},</p>
                <p style="margin:0 0 12px">Thank you for your generous donation.</p>
                <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px">
                  <div><strong>Amount:</strong> ${amountFmt}</div>
                  <div><strong>Cause:</strong> ${beneficiaryText}</div>
                  <div><strong>Reference:</strong> ${donation.reference}</div>
                  <div><strong>Date:</strong> ${new Date(donation.createdAt).toLocaleString()}</div>
                </div>
                <p style="margin:0 0 8px">Warm regards,<br/>United Link Foundation</p>
              </div>
            `,
            attachments: [
              { filename: 'UnitedLink-Donation-Receipt.pdf', content: pdfBuffer }
            ],
          });
        }

        // Foundation notification
        const foundationEmail = process.env.FOUNDATION_EMAIL || process.env.EMAIL_USER;
        if (foundationEmail) {
          await transporter.sendMail({
            from: `United Link Foundation <${process.env.EMAIL_USER}>`,
            to: foundationEmail,
            subject: 'New Donation Received',
            html: `
              <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
                <h2 style="color:#16a34a;margin:0 0 8px">New Donation Received</h2>
                <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
                  <div><strong>Donor:</strong> ${donorName || donorEmail || 'Anonymous'}</div>
                  <div><strong>Amount:</strong> ${amountFmt}</div>
                  <div><strong>Cause:</strong> ${beneficiaryText}</div>
                  <div><strong>Reference:</strong> ${donation.reference}</div>
                  <div><strong>Date:</strong> ${new Date(donation.createdAt).toLocaleString()}</div>
                </div>
              </div>
            `,
          });
        }
      } catch (mailErr) {
        logger.error('Failed to send donation emails', mailErr);
      }
    }
    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook processing failed', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Donation stats for dashboard
router.get('/stats', async (_req, res) => {
  try {
    const succeeded = await Donation.find({ status: 'succeeded' });
    const totalDonations = succeeded.length;
    const totalAmount = succeeded.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = succeeded.filter((d) => new Date(d.createdAt) >= monthStart).length;
    ok(res, { totalDonations, totalAmount, donationsThisMonth: thisMonth });
  } catch (err) {
    logger.error('Failed to compute donation stats', err);
    serverError(res, 'Failed to compute donation stats');
  }
});

router.get('/recent', async (_req, res) => {
  try {
    const recent = await Donation.find({ status: 'succeeded' }).sort({ createdAt: -1 }).limit(10).lean();
    ok(res, { recent });
  } catch (err) {
    logger.error('Failed to fetch recent donations', err);
    serverError(res, 'Failed to fetch recent donations');
  }
});

// All donations made to a specific member (admin only)
router.get('/by-member/:memberId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const memberId = req.params.memberId;
    const donations = await Donation.find({ memberId, status: 'succeeded' })
      .sort({ createdAt: -1 })
      .lean();
    ok(res, { donations });
  } catch (err) {
    logger.error('Failed to fetch donations for member', err);
    serverError(res, 'Failed to fetch donations for member');
  }
});

// Get donation detail by id (admin only)
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const d = await Donation.findById(req.params.id).lean();
    if (!d) return badRequest(res, 'Donation not found');
    ok(res, { donation: d });
  } catch (err) {
    logger.error('Failed to fetch donation by id', err);
    serverError(res, 'Failed to fetch donation');
  }
});

export default router;
// Receipt PDF download for a donation (admin only)
router.get('/:id/receipt', requireAuth, requireAdmin, async (req, res) => {
  try {
    const d = await Donation.findById(req.params.id).lean();
    if (!d) return badRequest(res, 'Donation not found');
    let beneficiary = null;
    if (d.causeType === 'beneficiary' && d.memberId) {
      try {
        beneficiary = await Member.findById(d.memberId).lean();
      } catch {}
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="UnitedLink-Donation-Receipt.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    const amountFmt = `${String(d.currency || 'usd').toUpperCase()} ${Number(d.amount || 0).toLocaleString()}`;
    const beneficiaryText = d.causeType === 'beneficiary' && beneficiary
      ? `Beneficiary: ${beneficiary.name} (${beneficiary.role || 'Member'})`
      : 'Foundation General Cause';
    doc.fontSize(20).text('United Link Foundation', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).text('Donation Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Date: ${new Date(d.createdAt).toLocaleString()}`);
    if (d.reference) doc.text(`Reference: ${d.reference}`);
    doc.moveDown();
    doc.fontSize(12).text(`Donor: ${d.donorName || d.donorEmail || 'Anonymous'}`);
    if (d.donorEmail) doc.text(`Email: ${d.donorEmail}`);
    if (beneficiary) {
      doc.moveDown();
      doc.fontSize(12).text(`Beneficiary: ${beneficiary.name}`);
      doc.text(`Role: ${beneficiary.role || 'Member'}`);
    }
    doc.moveDown();
    doc.fontSize(12).text(`Amount: ${amountFmt}`);
    doc.text(`Cause: ${beneficiaryText}`);
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#666').text('Thank you for supporting our mission at United Link Foundation.', { align: 'center' });
    doc.end();
  } catch (err) {
    logger.error('Failed to generate receipt PDF', err);
    serverError(res, 'Failed to generate receipt');
  }
});
