import mongoose from 'mongoose';

const donationSchema = new mongoose.Schema({
  donorName: String,
  amount: { type: Number, required: true },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reference: String, // payment gateway reference
  date: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('Donation', donationSchema);
