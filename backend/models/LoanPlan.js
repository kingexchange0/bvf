const mongoose = require('mongoose');

const loanPlanSchema = new mongoose.Schema({
  name: {
    type: String,
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
  maxAmount: {
    type: Number,
    required: true
  },
  minAmount: {
    type: Number,
    default: 100
  },
  description: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('LoanPlan', loanPlanSchema);
