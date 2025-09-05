const { createLogger, format, transports } = require('winston');
const rfs = require('rotating-file-stream');
const path = require('path');
const { LOG_DIR } = require('./config/storage');

const stream = rfs.createStream('app.log', {
  interval: '1d',
  maxFiles: 7,
  path: LOG_DIR,
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [
    new transports.Stream({ stream }),
    new transports.Console(),
  ],
});

// Patch console methods to use logger
console.log = (...args) => logger.info(args.join(' '));
console.warn = (...args) => logger.warn(args.join(' '));
console.error = (...args) => logger.error(args.join(' '));

module.exports = logger;
