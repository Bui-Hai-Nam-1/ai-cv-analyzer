
function log(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'analysis-service',
    event,
    ...details
  };

  const output = JSON.stringify(entry);

  if (level === 'ERROR') {
    console.error(output);
  } else {
    console.log(output);
  }
}

module.exports = {
  info(event, details) {
    log('INFO', event, details);
  },

  warn(event, details) {
    log('WARN', event, details);
  },

  error(event, details) {
    log('ERROR', event, details);
  }
};
