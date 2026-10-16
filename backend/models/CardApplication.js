const mongoose = require('mongoose');

// Never store card numbers, CVVs, or PINs here — application metadata only.
const cardApplicationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CardProduct',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'issued'],
    default: 'pending'
  },
  adminNote: {
    type: String,
    default: ''
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

cardApplicationSchema.index({ userId: 1, productId: 1, status: 1 });

module.exports = mongoose.model('CardApplication', cardApplicationSchema);
