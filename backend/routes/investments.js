const express = require('express');
const router = express.Router();
const { auth, adminOnly, requireKyc } = require('../middleware/auth');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const Notification = require('../models/Notification');
const { debitBalance, runWithTransaction } = require('../utils/ledger');
const { sendTransactionEmail } = require('../utils/emailService');

// @route   POST /api/investments
// @desc    Create a new investment
// @access  Private
router.post('/', auth, requireKyc, async (req, res) => {
  try {
    const { planId, amount } = req.body;
    
    // Validate plan
    const plan = await InvestmentPlan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({ success: false, message: 'Investment plan not found' });
    }
    
    // Validate amount
    const investAmount = parseFloat(amount);
    if (investAmount < plan.minAmount || investAmount > plan.maxAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Amount must be between $${plan.minAmount} and $${plan.maxAmount}` 
      });
    }
    
    // Calculate returns and end date
    const expectedReturns = investAmount + (investAmount * plan.ROI / 100);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    // Create the investment and debit the balance atomically when possible
    let investment;
    await runWithTransaction(async (session) => {
      investment = await Investment.create([{
        userId: req.user._id,
        planId: plan._id,
        planName: plan.name,
        amount: investAmount,
        ROI: plan.ROI,
        durationDays: plan.durationDays,
        expectedReturns,
        endDate
      }], { session }).then(docs => docs[0]);

      const debit = await debitBalance(req.user._id, investAmount, {
        type: 'invest',
        description: `Investment in ${plan.name}`,
        referenceId: String(investment._id) + ':invest',
        session
      });

      if (!debit.ok) {
        throw Object.assign(new Error('Insufficient balance'), { statusCode: 400 });
      }

      await Notification.create([{
        userId: req.user._id,
        title: 'Investment Created',
        message: `You have invested $${investAmount} in ${plan.name}. Expected returns: $${expectedReturns.toFixed(2)}`,
        type: 'success'
      }], { session });
    });
    
    sendTransactionEmail(req.user._id, { title: 'Investment started', amount: investAmount, description: `${plan.name} — matures in ${plan.durationDays} days`, status: 'active' });

    res.status(201).json({
      success: true,
      message: 'Investment created successfully',
      data: investment
    });
  } catch (error) {
    console.error('Investment error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// @route   GET /api/investments
// @desc    Get user investments
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = { userId: req.user._id };
    if (status) query.status = status;
    
    const investments = await Investment.find(query)
      .populate('planId', 'name ROI durationDays')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Investment.countDocuments(query);
    
    res.json({
      success: true,
      data: investments,
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

// @route   GET /api/admin/investments
// @desc    Get all investments (admin)
// @access  Private/Admin
router.get('/admin/all', auth, adminOnly, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (status) query.status = status;
    
    const investments = await Investment.find(query)
      .populate('userId', 'name email')
      .populate('planId', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Investment.countDocuments(query);
    
    // Calculate totals
    const totalActive = await Investment.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalCompleted = await Investment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    res.json({
      success: true,
      data: investments,
      stats: {
        totalActive: totalActive[0]?.total || 0,
        totalCompleted: totalCompleted[0]?.total || 0,
        activeCount: await Investment.countDocuments({ status: 'active' })
      },
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

// @route   GET /api/investments/:id
// @desc    Get investment by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id)
      .populate('planId', 'name ROI durationDays minAmount maxAmount');
    
    if (!investment) {
      return res.status(404).json({ success: false, message: 'Investment not found' });
    }
    
    // Check ownership
    if (investment.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    res.json({
      success: true,
      data: investment
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
