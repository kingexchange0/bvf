const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const cron = require('node-cron');

// Load environment variables
dotenv.config();

// This machine's DNS config hands Node's c-ares resolver a local resolver
// (127.0.0.1) that refuses its queries, breaking mongodb+srv:// SRV lookups
// with ECONNREFUSED. Fall back to public DNS resolvers in that case.
const dns = require('dns');
if (dns.getServers().every(s => /^(127\.0\.0\.1|::1)$/.test(s))) {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
}

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Explicit configured origins always allowed
    const allowed = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500').split(',');
    // In non-production, allow any localhost/127.0.0.1 origin on any port
    // (Live Server, http-server, etc. pick arbitrary ports)
    const isDevLocal = process.env.NODE_ENV !== 'production'
      && origin && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (!origin || isDevLocal || allowed.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/deposits', require('./routes/deposits'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/investment-plans', require('./routes/investmentPlans'));
app.use('/api/investments', require('./routes/investments'));
app.use('/api/loan-plans', require('./routes/loanPlans'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/kyc', require('./routes/kyc'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/files', require('./routes/files'));
app.use('/api/transfers', require('./routes/transfers'));
app.use('/api/cards', require('./routes/cards'));
app.use('/api/crypto', require('./routes/crypto'));

// Investment maturity checker (runs every hour)
function scheduleMaturityCron() {
  cron.schedule('0 * * * *', async () => {
    console.log('Checking for matured investments...');
    const Investment = require('./models/Investment');
    const { creditBalance, hasCompletedTx } = require('./utils/ledger');

    const now = new Date();
    let processed = 0;
    let failed = 0;

    try {
      const maturedInvestments = await Investment.find({
        status: 'active',
        endDate: { $lte: now },
        maturedProcessed: { $ne: true }
      });

      for (const inv of maturedInvestments) {
        try {
          // Claim the investment atomically so concurrent runs can't double-credit
          const claim = await Investment.updateOne(
            { _id: inv._id, status: 'active', maturedProcessed: { $ne: true } },
            { $set: { maturedProcessed: true, status: 'completed', maturedAt: now } }
          );
          if (claim.modifiedCount !== 1) continue;

          const profit = (inv.amount * inv.ROI) / 100;
          const returns = inv.amount + profit;
          const referenceId = String(inv._id) + ':maturity';

          if (!(await hasCompletedTx(inv.userId, 'investment_return', referenceId))) {
            await creditBalance(inv.userId, returns, {
              type: 'investment_return',
              referenceId,
              description: `Investment maturity: ${inv.planName} — principal $${inv.amount} + profit $${profit}`
            });
            require('./utils/emailService').sendTransactionEmail(inv.userId, {
              title: 'Investment matured',
              amount: returns,
              description: `${inv.planName} — principal + profit credited`,
              status: 'completed'
            });
          }
          processed++;
        } catch (itemError) {
          failed++;
          console.error(`Error processing matured investment ${inv._id}:`, itemError.message);
        }
      }
      console.log(`Maturity cron finished: ${processed} processed, ${failed} failed, ${maturedInvestments.length} candidates`);
    } catch (error) {
      console.error('Error processing matured investments:', error);
    }
  });
}

// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    success: false,
    message: isProduction ? 'Something went wrong!' : (err.message || 'Something went wrong!')
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Connect to MongoDB first; only listen and schedule cron once connected
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crestcoin', {
  serverSelectionTimeoutMS: 10000
})
  .then(() => {
    console.log('MongoDB Connected');
    require('./utils/seedProducts').seedDefaults();

    // Email configuration validation — no silent fallbacks
    const { validateEmailConfig } = require('./utils/emailService');
    const emailCheck = validateEmailConfig();
    if (!emailCheck.ok) {
      const summary = `Email provider not configured: ${emailCheck.errors.join('; ')}`;
      if (process.env.NODE_ENV === 'production') {
        console.error(`FATAL: ${summary}`);
        process.exit(1);
      }
      console.warn(`WARNING: ${summary}. All email sends will fail until EMAIL_PROVIDER and its credentials are set in .env.`);
    } else {
      console.log(`Email provider ready: ${emailCheck.config.provider} (from: ${emailCheck.config.fromEmail})`);
    }

    scheduleMaturityCron();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB Connection Error:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  try {
    await mongoose.disconnect();
  } finally {
    process.exit(0);
  }
});
