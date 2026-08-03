const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSettings, updateSettings } = require('../db/settings');
const { logAction } = require('../db/audit');

const router = express.Router();

router.get('/settings', requireAuth, requireRole('admin'), async (req, res) => {
  const settings = await getSettings();
  res.render('settings', { user: req.session, settings, csrfToken: req.csrfToken(), saved: false });
});

router.post('/settings', requireAuth, requireRole('admin'), async (req, res) => {
  const { company_name, company_address, company_contact, payment_instructions, default_tax_rate } = req.body;

  if (!company_name || !company_name.trim()) {
    const settings = await getSettings();
    return res.status(400).render('settings', {
      user: req.session,
      settings,
      csrfToken: req.csrfToken(),
      saved: false,
      error: 'Company name is required.'
    });
  }

  await updateSettings({
    companyName: company_name.trim(),
    companyAddress: (company_address || '').trim(),
    companyContact: (company_contact || '').trim(),
    paymentInstructions: (payment_instructions || '').trim(),
    defaultTaxRate: Math.max(0, Number(default_tax_rate) || 0)
  });

  await logAction({ userId: req.session.userId, action: 'settings.update', ip: req.ip });

  const settings = await getSettings();
  res.render('settings', { user: req.session, settings, csrfToken: req.csrfToken(), saved: true });
});

module.exports = router;
