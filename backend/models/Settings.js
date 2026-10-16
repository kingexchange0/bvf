const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  btcWalletAddress: {
    type: String,
    default: ''
  },
  depositRedirectLink: {
    type: String,
    default: ''
  },
  supportEmail: {
    type: String,
    default: 'support@brightvale.com'
  },
  telegramLink: {
    type: String,
    default: ''
  },
  whatsappNumber: {
    type: String,
    default: ''
  },
  responseTime: {
    type: String,
    default: '24 hours'
  },
  tawkScript: {
    type: String,
    default: ''
  },
  broadcastMessage: {
    type: String,
    default: ''
  },
  siteName: {
    type: String,
    default: 'BrightVale Finance'
  },
  siteLogo: {
    type: String,
    default: ''
  },
  referralBonusPercent: {
    type: Number,
    default: 5
  },
  minimumDeposit: {
    type: Number,
    default: 50
  },
  minimumWithdrawal: {
    type: Number,
    default: 100
  },
  bankRoutingNumber: {
    type: String,
    default: ''
  },
  bankName: {
    type: String,
    default: 'BrightVale Finance'
  },
  welcomeNotificationTitle: {
    type: String,
    default: 'Welcome to BrightVale Finance!'
  },
  welcomeNotificationMessage: {
    type: String,
    default: 'Thank you for joining BrightVale Finance. Start your investment journey today!'
  },
  // SMTP Email Settings
  smtpHost: {
    type: String,
    default: ''
  },
  smtpPort: {
    type: Number,
    default: 587
  },
  smtpUser: {
    type: String,
    default: ''
  },
  smtpPass: {
    type: String,
    default: ''
  },
  emailSenderName: {
    type: String,
    default: 'BrightVale Finance'
  },
  // Display-only deposit addresses configured by admins. No on-chain
  // verification occurs until a custody/payment provider is integrated.
  cryptoWallets: {
    type: [{
      coin: { type: String, required: true },
      network: { type: String, required: true },
      address: { type: String, required: true },
      updatedAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Settings', settingsSchema);
