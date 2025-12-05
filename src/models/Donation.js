import mongoose from 'mongoose';

const donationSchema = new mongoose.Schema({
  donorName: String,
  donorEmail: String,
  amount: { type: Number, required: true },
  currency: { type: String, default: 'usd' },
  causeType: { type: String, enum: ['beneficiary', 'general'], default: 'general' },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reference: String,
  status: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },
  stripeSessionId: String,
  stripePaymentIntentId: String,
  date: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('Donation', donationSchema);
