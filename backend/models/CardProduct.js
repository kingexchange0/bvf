const mongoose = require('mongoose');

const cardProductSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  type: {
    type: String,
    enum: ['virtual', 'physical'],
    default: 'virtual'
  },
  annualFee: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    default: '',
    maxlength: 500
  },
  perks: {
    type: [String],
    default: []
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

module.exports = mongoose.model('CardProduct', cardProductSchema);
