if (!globalThis.ReadableStream) {
  try {
    const process = require('node:process');
    const { emitWarning } = process;
    try {
      process.emitWarning = () => {
      };
      Object.assign(globalThis, require('node:stream/web'));
      process.emitWarning = emitWarning;
    } catch (error) {
      process.emitWarning = emitWarning;
      throw error;
    }
  } catch (error) {
    // fallback to polyfill implementation
    Object.assign(globalThis, require('web-streams-polyfill/dist/ponyfill.es2018.js'));
  }
}