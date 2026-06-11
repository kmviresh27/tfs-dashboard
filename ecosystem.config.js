/**
 * PM2 Ecosystem Configuration
 *
 * ⚠️  IMPORTANT: Always run as a SINGLE instance (instances: 1, exec_mode: 'fork').
 *
 * This app uses in-process state that is NOT safe for multi-instance deployments:
 *   - express-session (in-memory store)
 *   - Response cache (responseCache.js)
 *   - Rate limiter (rateLimiter.js)
 *   - node-cron scheduler (would fire from every instance)
 *   - Cache bust (bustCache) is in-process only
 *
 * If you need true multi-instance, replace all of the above with shared external
 * stores (Redis, etc.) first.
 *
 * Usage:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   ← auto-start on machine reboot
 *   pm2 logs av-dashboard
 *   pm2 restart av-dashboard
 *   pm2 stop av-dashboard
 */
module.exports = {
  apps: [
    {
      name:         'av-dashboard',
      script:       'server.js',

      // ── Single-process fork mode — do NOT change instances to > 1 ──────────
      instances:    1,
      exec_mode:    'fork',

      // ── Restart policy ────────────────────────────────────────────────────
      watch:        false,          // Don't auto-restart on file changes in production
      restart_delay: 2000,          // Wait 2s before restarting after a crash
      max_restarts:  10,            // Stop restarting after 10 rapid crashes
      min_uptime:    '10s',         // Consider stable if up for 10+ seconds

      // ── Logging ───────────────────────────────────────────────────────────
      out_file:      'logs/out.log',
      error_file:    'logs/error.log',
      merge_logs:    true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // ── Environment ───────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
