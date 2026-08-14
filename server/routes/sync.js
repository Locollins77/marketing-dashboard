const express = require('express');
const asyncHandler = require('../asyncHandler');
const { runWhatConvertsSync } = require('../sync');

const router = express.Router();

router.post('/whatconverts', asyncHandler(async (req, res) => {
  const summary = await runWhatConvertsSync();
  res.json(summary);
}));

module.exports = router;
