const express = require('express');
const asyncHandler = require('../asyncHandler');
const { runWhatConvertsSync, runGoogleAdsSync, runMetaAdsSync } = require('../sync');

const router = express.Router();

router.post('/whatconverts', asyncHandler(async (req, res) => {
  const summary = await runWhatConvertsSync();
  res.json(summary);
}));

router.post('/google-ads', asyncHandler(async (req, res) => {
  const summary = await runGoogleAdsSync();
  res.json(summary);
}));

router.post('/meta-ads', asyncHandler(async (req, res) => {
  const summary = await runMetaAdsSync();
  res.json(summary);
}));

module.exports = router;
