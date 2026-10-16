const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanPlan',
    required: true
  },
  planName: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  interestRate: {
    type: Number,
    required: true
  },
  durationMonths: {
    type: Number,
    required: true
  },
  totalRepayment: {
    type: Number,
    required: true
  },
  repaidAmount: {
    type: Number,
    default: 0
  },
  monthlyPayment: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'declined', 'active', 'completed', 'defaulted'],
    default: 'pending'
  },
  purpose: {
    type: String,
    default: ''
  },
  adminNote: {
    type: String,
    default: ''
  },
  approvedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Loan', loanSchema);
