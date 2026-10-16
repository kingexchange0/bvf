const express = require('express');
const CardProduct = require('../models/CardProduct');
const CardApplication = require('../models/CardApplication');
const Notification = require('../models/Notification');
const { auth, adminOnly, requireKyc } = require('../middleware/auth');

const router = express.Router();

// @route GET /api/cards/products
// @desc List active card products
// @access Private
router.get('/products', auth, async (req, res, next) => {
  try {
    const products = await CardProduct.find({ isActive: true }).sort({ createdAt: 1 });
    return res.json({ success: true, message: 'Card products retrieved', data: { products } });
  } catch (err) {
    return next(err);
  }
});

// @route POST /api/cards/apply
// @desc Apply for a card product (application only — no card data collected)
// @access Private
router.post('/apply', auth, requireKyc, async (req, res, next) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ success: false, message: 'Select a card product' });
    }
    const product = await CardProduct.findOne({ _id: productId, isActive: true });
    if (!product) {
      return res.status(400).json({ success: false, message: 'Card product not found or unavailable' });
    }
    const existing = await CardApplication.findOne({ userId: req.user._id, productId, status: 'pending' });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have a pending application for this card' });
    }
    const application = await CardApplication.create({
      userId: req.user._id,
      productId: product._id,
      productName: product.name
    });
    await Notification.create({
      userId: req.user._id,
      title: 'Card application received',
      message: `Your application for ${product.name} is pending review.`,
      type: 'info',
      link: '/user/cards.html'
    });
    return res.json({ success: true, message: 'Card application submitted', data: { application } });
  } catch (err) {
    return next(err);
  }
});

// @route GET /api/cards
// @desc Own applications; admins see all
// @access Private
router.get('/', auth, async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { userId: req.user._id };
    const applications = await CardApplication.find(filter).sort({ createdAt: -1 }).limit(200);
    return res.json({ success: true, message: 'Card applications retrieved', data: { applications } });
  } catch (err) {
    return next(err);
  }
});

// @route POST /api/cards/products
// @desc Create a card product
// @access Admin
router.post('/products', auth, adminOnly, async (req, res, next) => {
  try {
    const { name, type, annualFee, description, perks } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Product name is required' });
    }
    const fee = Number(annualFee) || 0;
    if (fee < 0) {
      return res.status(400).json({ success: false, message: 'Annual fee cannot be negative' });
    }
    const product = await CardProduct.create({
      name: String(name).trim(),
      type: type === 'physical' ? 'physical' : 'virtual',
      annualFee: fee,
      description: String(description || '').slice(0, 500),
      perks: Array.isArray(perks) ? perks.map(String).slice(0, 10) : []
    });
    return res.json({ success: true, message: 'Card product created', data: { product } });
  } catch (err) {
    return next(err);
  }
});

// @route PUT /api/cards/products/:id
// @desc Update a card product
// @access Admin
router.put('/products/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const product = await CardProduct.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Card product not found' });
    }
    return res.json({ success: true, message: 'Card product updated', data: { product } });
  } catch (err) {
    return next(err);
  }
});

// @route DELETE /api/cards/products/:id
// @desc Deactivate a card product (keeps history)
// @access Admin
router.delete('/products/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const product = await CardProduct.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Card product not found' });
    }
    return res.json({ success: true, message: 'Card product deactivated', data: { product } });
  } catch (err) {
    return next(err);
  }
});

// @route PUT /api/cards/admin/:id/approve
// @desc Approve a card application (idempotent)
// @access Admin
router.put('/admin/:id/approve', auth, adminOnly, async (req, res, next) => {
  try {
    const application = await CardApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    if (application.status === 'approved' || application.status === 'issued') {
      return res.json({ success: true, message: 'Application already approved', data: { application } });
    }
    application.status = 'approved';
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();
    application.adminNote = '';
    await application.save();
    await Notification.create({
      userId: application.userId,
      title: 'Card application approved',
      message: `Your application for ${application.productName} was approved. Card issuance completes through the issuer — you'll be notified when your card ships or activates.`,
      type: 'success',
      link: '/user/cards.html'
    });
    return res.json({ success: true, message: 'Application approved', data: { application } });
  } catch (err) {
    return next(err);
  }
});

// @route PUT /api/cards/admin/:id/reject
// @desc Reject a card application with a reason
// @access Admin
router.put('/admin/:id/reject', auth, adminOnly, async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: 'A rejection reason is required' });
    }
    const application = await CardApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    if (application.status === 'rejected') {
      return res.json({ success: true, message: 'Application already rejected', data: { application } });
    }
    application.status = 'rejected';
    application.adminNote = String(reason).trim();
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();
    await application.save();
    await Notification.create({
      userId: application.userId,
      title: 'Card application declined',
      message: `Your application for ${application.productName} was declined: ${application.adminNote}`,
      type: 'warning',
      link: '/user/cards.html'
    });
    return res.json({ success: true, message: 'Application rejected', data: { application } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
