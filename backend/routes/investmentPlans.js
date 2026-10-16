const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const InvestmentPlan = require('../models/InvestmentPlan');

// @route   GET /api/investment-plans
// @desc    Get all active investment plans
// @access  Public
router.get('/', async (req, res) => {
  try {
    const plans = await InvestmentPlan.find({ isActive: true })
      .sort({ minAmount: 1 });
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/investment-plans/all
// @desc    Get all investment plans (admin)
// @access  Private/Admin
router.get('/all', auth, adminOnly, async (req, res) => {
  try {
    const plans = await InvestmentPlan.find().sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/investment-plans
// @desc    Create a new investment plan
// @access  Private/Admin
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, ROI, durationDays, minAmount, maxAmount, description } = req.body;
    
    if (!name || !ROI || !durationDays || !minAmount || !maxAmount) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    const plan = await InvestmentPlan.create({
      name,
      ROI,
      durationDays,
      minAmount,
      maxAmount,
      description
    });
    
    res.status(201).json({
      success: true,
      message: 'Investment plan created successfully',
      data: plan
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/investment-plans/:id
// @desc    Update an investment plan
// @access  Private/Admin
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, ROI, durationDays, minAmount, maxAmount, description, isActive } = req.body;
    
    const plan = await InvestmentPlan.findByIdAndUpdate(
      id,
      { name, ROI, durationDays, minAmount, maxAmount, description, isActive },
      { new: true }
    );
    
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Investment plan not found' });
    }
    
    res.json({
      success: true,
      message: 'Investment plan updated successfully',
      data: plan
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/admin/investment-plans/:id
// @desc    Delete an investment plan
// @access  Private/Admin
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    
    const plan = await InvestmentPlan.findByIdAndDelete(id);
    
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Investment plan not found' });
    }
    
    res.json({
      success: true,
      message: 'Investment plan deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
