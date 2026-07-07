'use strict';

module.exports = {
  identity: {
    name: 'ICCU APIS',
    tagline: 'Rest API simple, free, dan 100% lebih lengkap.',
    version: '1.0.0'
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '8430060783:AAFuXyzlfad7zrtpgIFvgtlnNJwaIQCryVk',
    ownerIds: (process.env.TELEGRAM_OWNER_IDS || '8774505908')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
};