const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { auth, requireKyc } = require('../middleware/auth');
const { hasCompletedTx, runWithTransaction } = require('../utils/ledger');
const { sendTransactionEmail } = require('../utils/emailService');

const router = express.Router();

const ACCOUNTS = ['checking', 'savings'];
const BALANCE_FIELD = { checking: 'balanceUSD', savings: 'savingsBalance' };
const PER_TRANSFER_LIMIT = 100000;

// @route POST /api/transfers
// @desc Internal transfer between the user's own checking and savings accounts
// @access Private
router.post('/', auth, requireKyc, async (req, res, next) => {
  try {
    const { from, to, idempotencyKey } = req.body;
    const amount = Math.round(Number(req.body.amount) * 100) / 100;
    const key = idempotencyKey ? String(idempotencyKey).trim() : null;

    if (!ACCOUNTS.includes(from) || !ACCOUNTS.includes(to) || from === to) {
      return res.status(400).json({ success: false, message: 'Source and destination accounts must be different (checking or savings)' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid transfer amount' });
    }
    if (amount > PER_TRANSFER_LIMIT) {
      return res.status(400).json({ success: false, message: `Per-transfer limit is $${PER_TRANSFER_LIMIT.toLocaleString()}` });
    }
    if (key && key.length > 80) {
      return res.status(400).json({ success: false, message: 'Invalid idempotency key' });
    }

    // Replay protection: a reused key returns the original outcome without mutating.
    if (key && await hasCompletedTx(req.user._id, 'transfer', key)) {
      return res.status(200).json({ success: true, message: 'Transfer already processed', data: { duplicate: true } });
    }

    const referenceId = key || String(new mongoose.Types.ObjectId());
    const description = `Transfer from ${from === 'checking' ? 'Checking' : 'Savings'} to ${to === 'checking' ? 'Checking' : 'Savings'}`;
    const debitField = BALANCE_FIELD[from];
    const creditField = BALANCE_FIELD[to];
    const userId = req.user._id;

    const result = await runWithTransaction(async (session) => {
      // Atomic debit: the balance check IS the authorization (no frontend trust).
      const user = await User.findOneAndUpdate(
        { _id: userId, [debitField]: { $gte: amount } },
        { $inc: { [debitField]: -amount } },
        { new: true, session }
      );
      if (!user) {
        const err = new Error(`Insufficient funds in ${from}`);
        err.statusCode = 400;
        throw err;
      }
      await User.updateOne({ _id: userId }, { $inc: { [creditField]: amount } }, { session });
      await Transaction.create([{
        userId,
        type: 'transfer',
        amount,
        status: 'completed',
        description,
        referenceId
      }], { session });
      return { ok: true };
    });

    await Notification.create({
      userId,
      title: 'Transfer completed',
      message: `${description}: $${amount.toFixed(2)}`,
      type: 'success',
      link: '/user/transfers.html'
    });

    sendTransactionEmail(userId, { title: 'Transfer completed', amount, description, status: 'completed' });

    return res.json({ success: true, message: 'Transfer completed', data: result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    return next(err);
  }
});

// @route GET /api/transfers
// @desc Transfer history (own transfers; admins see all)
// @access Private
router.get('/', auth, async (req, res, next) => {
  try {
    const filter = { type: 'transfer' };
    if (req.user.role !== 'admin') {
      filter.userId = req.user._id;
    }
    const [transfers, total] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).limit(100),
      Transaction.countDocuments(filter)
    ]);
    return res.json({ success: true, message: 'Transfers retrieved', data: { transfers, total } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
