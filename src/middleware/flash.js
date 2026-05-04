const { format } = require('util');

function flash() {
  return (req, res, next) => {
    req.flash = function flashMessage(type, message, ...args) {
      if (!req.session) throw new Error('req.flash() requiere sesiones');

      const messages = req.session.flash || {};
      req.session.flash = messages;

      if (type && message !== undefined) {
        const values = Array.isArray(message)
          ? message
          : [args.length ? format(message, ...args) : message];

        messages[type] = messages[type] || [];
        values.forEach(value => messages[type].push(value));
        return messages[type].length;
      }

      if (type) {
        const values = messages[type] || [];
        delete messages[type];
        return values;
      }

      req.session.flash = {};
      return messages;
    };

    next();
  };
}

module.exports = flash;
