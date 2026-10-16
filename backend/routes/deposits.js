const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const Deposit = require('../models/Deposit');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Notification = require('../models/Notification');
const upload = require('../middleware/upload');
const Settings = require('../models/Settings');
const { sendTransactionEmail } = require('../utils/emailService');
const { creditBalance, runWithTransaction } = require('../utils/ledger');

// @route   POST /api/deposits
// @desc    Create a new deposit request
// @access  Private
router.post('/', auth, upload.single('btcProof'), async (req, res) => {
  try {
    const { amount } = req.body;

    const settings = await Settings.findOne();
    const minDeposit = settings?.minimumDeposit || 50;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    if (parseFloat(amount) < minDeposit) {
      return res.status(400).json({ success: false, message: `Minimum deposit amount is $${minDeposit}` });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Proof of payment is required' });
    }
    
    const btcProofPath = `/uploads/deposits/${req.file.filename}`;
    console.log('Saving deposit with proof path:', btcProofPath);
    
    const deposit = await Deposit.create({
      userId: req.user._id,
      amount: parseFloat(amount),
      btcProof: btcProofPath
    });
    
    // Create transaction record
    await Transaction.create({
      userId: req.user._id,
      type: 'deposit',
      amount: parseFloat(amount),
      status: 'pending',
      description: 'BTC Deposit',
      referenceId: deposit._id
    });
    
    // Notify admin (in real app, use socket.io or email)
    console.log(`New deposit request from ${req.user.email}: $${amount}`);
    
    res.status(201).json({
      success: true,
      message: 'Deposit request submitted successfully',
      data: deposit
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/deposits
// @desc    Get deposits (user gets own, admin gets all)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    
    let query = {};
    
    if (req.user.role !== 'admin') {
      query.userId = req.user._id;
    }
    
    if (status) query.status = status;
    
    const deposits = await Deposit.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Deposit.countDocuments(query);
    
    res.json({
      success: true,
      data: deposits,
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/deposits/:id/approve
// @desc    Approve a deposit
// @access  Private/Admin
router.put('/admin/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const deposit = await Deposit.findById(id);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }
    
    if (deposit.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Deposit already processed' });
    }
    
    deposit.status = 'approved';
    if (adminNote) deposit.adminNote = adminNote;

    // Credit balance and pay the one-time referral bonus atomically when possible
    await runWithTransaction(async (session) => {
      await deposit.save({ session });

      await creditBalance(deposit.userId, deposit.amount, {
        type: 'deposit',
        description: 'BTC Deposit approved',
        referenceId: String(deposit._id) + ':credit',
        session
      });

      // Update the pending transaction record
      await Transaction.findOneAndUpdate(
        { referenceId: deposit._id },
        { status: 'approved' }
      ).session(session);

      // Referral % bonus: paid once per referred user, claimed atomically
      const depositor = await User.findById(deposit.userId).session(session);
      if (depositor && depositor.referredBy && String(depositor.referredBy) !== String(depositor._id)) {
        const claim = await User.updateOne(
          { _id: depositor._id, referrerDepositBonusPaid: { $ne: true } },
          { $set: { referrerDepositBonusPaid: true } }
        ).session(session);

        if (claim.modifiedCount === 1) {
          const settings = await Settings.findOne().session(session);
          const bonusPercent = settings?.referralBonusPercent || 5;
          const bonusAmount = (deposit.amount * bonusPercent) / 100;

          await creditBalance(depositor.referredBy, bonusAmount, {
            type: 'referral_bonus',
            description: `Referral bonus from ${depositor.name}`,
            referenceId: String(deposit._id) + ':refbonus',
            session
          });

          await Notification.create([{
            userId: depositor.referredBy,
            title: 'Referral Bonus',
            message: `You received $${bonusAmount.toFixed(2)} referral bonus`,
            type: 'success'
          }], { session });
        }
      }

      await Notification.create([{
        userId: deposit.userId,
        title: 'Deposit Approved',
        message: `Your deposit of $${deposit.amount} has been approved`,
        type: 'success'
      }], { session });
    });

    sendTransactionEmail(deposit.userId, { title: 'Deposit approved', amount: deposit.amount, description: 'Deposit credited to your checking balance', status: 'completed' });

    res.json({
      success: true,
      message: 'Deposit approved successfully',
      data: deposit
    });
  } catch (error) {
    console.error('Approve deposit error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/deposits/:id/decline
// @desc    Decline a deposit
// @access  Private/Admin
router.put('/admin/:id/decline', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const deposit = await Deposit.findById(id);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }
    
    if (deposit.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Deposit already processed' });
    }
    
    deposit.status = 'declined';
    if (adminNote) deposit.adminNote = adminNote;
    await deposit.save();
    
    // Update transaction status
    await Transaction.findOneAndUpdate(
      { referenceId: deposit._id },
      { status: 'declined' }
    );
    
    // Create notification
    await Notification.create({
      userId: deposit.userId,
      title: 'Deposit Declined',
      message: `Your deposit of $${deposit.amount} has been declined. Reason: ${adminNote || 'No reason provided'}`,
      type: 'error'
    });
    
    sendTransactionEmail(deposit.userId, { title: 'Deposit declined', amount: deposit.amount, description: 'Your deposit request was declined' + (adminNote ? `: ${adminNote}` : ''), status: 'declined' });

    res.json({
      success: true,
      message: 'Deposit declined successfully',
      data: deposit
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
