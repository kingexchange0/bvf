const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['deposit', 'withdraw', 'invest', 'investment_return', 'loan', 'loan_repayment', 'referral_bonus', 'admin_adjustment', 'withdraw_refund', 'transfer'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'declined', 'completed'],
    default: 'pending'
  },
  description: {
    type: String,
    default: ''
  },
  referenceId: {
    type: String,
    default: null
  },
  hidden: {
    type: Boolean,
    default: false
  },
  // Marks ledger entries created by the admin demo-history generator so they
  // can be listed, toggled via hide/show, or purged as a group.
  generated: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Transaction', transactionSchema);
