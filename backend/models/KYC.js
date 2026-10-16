const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  level: {
    type: Number,
    enum: [1, 2],
    default: 1
  },
  // Level 1 — identity
  fullName: {
    type: String,
    default: '',
    trim: true
  },
  address: {
    type: String,
    default: '',
    trim: true
  },
  idType: {
    type: String,
    enum: ['', 'passport', 'drivers_license', 'national_id', 'voters_card'],
    default: ''
  },
  idNumber: {
    type: String,
    default: '',
    trim: true
  },
  frontImage: {
    type: String,
    default: ''
  },
  backImage: {
    type: String,
    default: ''
  },
  selfieImage: {
    type: String,
    default: ''
  },
  // Level 2 — SSN
  ssnNumber: {
    type: String,
    default: '',
    trim: true
  },
  ssnImage: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  adminNote: {
    type: String,
    default: ''
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date
  }
});

kycSchema.index({ userId: 1, level: 1 }, { unique: true });

module.exports = mongoose.model('KYC', kycSchema);
